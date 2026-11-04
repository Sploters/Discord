//! SRTP/SRTCP AES_CM_128_HMAC_SHA1_80 (RFC 3711), o mesmo do mediasoup. Chave mestra = 16 bytes + sal de 14 (30, em base64).
//! Protege o que vai ao servidor e abre o RTCP que volta (NACK/PLI).
use aes::cipher::{KeyIvInit, StreamCipher};
use hmac::{Hmac, Mac};
use sha1::Sha1;

type Ctr = ctr::Ctr128BE<aes::Aes128>;
type HmacSha1 = Hmac<Sha1>;
const TAG: usize = 10;

struct Keys { enc: [u8; 16], auth: [u8; 20], salt: [u8; 14] }

fn kdf(master: &[u8; 16], msalt: &[u8; 14], label: u8, out: &mut [u8]) {
    let mut iv = [0u8; 16];
    iv[..14].copy_from_slice(msalt);
    iv[7] ^= label;
    for b in out.iter_mut() { *b = 0; }
    Ctr::new(master.into(), &iv.into()).apply_keystream(out);
}
fn derive(master: &[u8; 16], msalt: &[u8; 14], base: u8) -> Keys {
    let mut k = Keys { enc: [0; 16], auth: [0; 20], salt: [0; 14] };
    kdf(master, msalt, base, &mut k.enc); kdf(master, msalt, base + 1, &mut k.auth); kdf(master, msalt, base + 2, &mut k.salt);
    k
}
fn iv_for(salt: &[u8; 14], ssrc: u32, index: u64) -> [u8; 16] {
    let mut iv = [0u8; 16];
    iv[..14].copy_from_slice(salt);
    for (i, b) in ssrc.to_be_bytes().iter().enumerate() { iv[4 + i] ^= b; }
    let ix = index.to_be_bytes(); // 8 bytes; usa os 6 de baixo
    for i in 0..6 { iv[8 + i] ^= ix[2 + i]; }
    iv
}
fn tag(key: &[u8; 20], parts: &[&[u8]]) -> [u8; TAG] {
    let mut m = <HmacSha1 as Mac>::new_from_slice(key).unwrap();
    for p in parts { m.update(p); }
    let full = m.finalize().into_bytes();
    let mut t = [0u8; TAG]; t.copy_from_slice(&full[..TAG]); t
}

pub fn parse_key(b64: &str) -> Option<([u8; 16], [u8; 14])> {
    use base64::Engine;
    let v = base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok()?;
    if v.len() != 30 { return None; }
    let mut k = [0u8; 16]; let mut s = [0u8; 14]; k.copy_from_slice(&v[..16]); s.copy_from_slice(&v[16..]);
    Some((k, s))
}

/// Envio (nossa chave): protege RTP e RTCP.
pub struct Tx { rtp: Keys, rtcp: Keys, roc: u32, last_seq: Option<u16>, rtcp_index: u32 }
impl Tx {
    pub fn new(master: &[u8; 16], salt: &[u8; 14]) -> Self { Self { rtp: derive(master, salt, 0), rtcp: derive(master, salt, 3), roc: 0, last_seq: None, rtcp_index: 0 } }
    /// RTP sem CSRC/extensões (cabeçalho de 12 bytes). Devolve o pacote protegido.
    pub fn protect_rtp(&mut self, pkt: &[u8]) -> Vec<u8> {
        let seq = u16::from_be_bytes([pkt[2], pkt[3]]);
        if let Some(l) = self.last_seq { if seq < l && l.wrapping_sub(seq) > 0x8000 { self.roc = self.roc.wrapping_add(1); } }
        self.last_seq = Some(seq);
        self.protect_rtp_with(pkt, self.roc)
    }
    /// Reenvio (NACK): mesmo índice -> mesmo resultado
    pub fn protect_rtp_with(&self, pkt: &[u8], roc: u32) -> Vec<u8> {
        let seq = u16::from_be_bytes([pkt[2], pkt[3]]);
        let ssrc = u32::from_be_bytes([pkt[8], pkt[9], pkt[10], pkt[11]]);
        let index = ((roc as u64) << 16) | seq as u64;
        let mut out = pkt.to_vec();
        Ctr::new((&self.rtp.enc).into(), (&iv_for(&self.rtp.salt, ssrc, index)).into()).apply_keystream(&mut out[12..]);
        let t = tag(&self.rtp.auth, &[&out, &roc.to_be_bytes()]);
        out.extend_from_slice(&t);
        out
    }
    pub fn protect_rtcp(&mut self, pkt: &[u8]) -> Vec<u8> {
        let ssrc = u32::from_be_bytes([pkt[4], pkt[5], pkt[6], pkt[7]]);
        self.rtcp_index = (self.rtcp_index + 1) & 0x7FFF_FFFF;
        let mut out = pkt.to_vec();
        Ctr::new((&self.rtcp.enc).into(), (&iv_for(&self.rtcp.salt, ssrc, self.rtcp_index as u64)).into()).apply_keystream(&mut out[8..]);
        out.extend_from_slice(&(0x8000_0000u32 | self.rtcp_index).to_be_bytes());
        let t = tag(&self.rtcp.auth, &[&out]);
        out.extend_from_slice(&t);
        out
    }
}

/// Recepção (chave do servidor): abre o SRTCP que volta. None se a assinatura não bate.
pub struct Rx { rtcp: Keys }
impl Rx {
    pub fn new(master: &[u8; 16], salt: &[u8; 14]) -> Self { Self { rtcp: derive(master, salt, 3) } }
    pub fn unprotect_rtcp(&self, pkt: &[u8]) -> Option<Vec<u8>> {
        if pkt.len() < 8 + 4 + TAG { return None; }
        let (body, t) = pkt.split_at(pkt.len() - TAG);
        if tag(&self.rtcp.auth, &[body]) != t { return None; }
        let (data, e) = body.split_at(body.len() - 4);
        let ei = u32::from_be_bytes([e[0], e[1], e[2], e[3]]);
        let mut out = data.to_vec();
        if ei & 0x8000_0000 != 0 {
            let ssrc = u32::from_be_bytes([out[4], out[5], out[6], out[7]]);
            Ctr::new((&self.rtcp.enc).into(), (&iv_for(&self.rtcp.salt, ssrc, (ei & 0x7FFF_FFFF) as u64)).into()).apply_keystream(&mut out[8..]);
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hex(s: &str) -> Vec<u8> { (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect() }
    #[test]
    fn rfc3711_kdf() { // RFC 3711 B.3
        let mk: [u8; 16] = hex("E1F97A0D3E018BE0D64FA32C06DE4139").try_into().unwrap();
        let ms: [u8; 14] = hex("0EC675AD498AFEEBB6960B3AABE6").try_into().unwrap();
        let k = derive(&mk, &ms, 0);
        assert_eq!(k.enc.to_vec(), hex("C61E7A93744F39EE10734AFE3FF7A087"));
        assert_eq!(k.salt.to_vec(), hex("30CBBC08863D8C85D49DB34A9AE1"));
        assert_eq!(k.auth[..20].to_vec(), hex("CEBE321F6FF7716B6FD4AB49AF256A156D38BAA4"));
    }
    #[test]
    fn rtcp_roundtrip() {
        let mk = [7u8; 16]; let ms = [9u8; 14];
        let mut tx = Tx::new(&mk, &ms); let rx = Rx::new(&mk, &ms);
        let p = vec![0x81, 205, 0, 3, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 0, 0];
        let s = tx.protect_rtcp(&p);
        assert_ne!(&s[8..16], &p[8..16]);
        assert_eq!(rx.unprotect_rtcp(&s).unwrap(), p);
        let mut bad = s.clone(); bad[9] ^= 1; assert!(rx.unprotect_rtcp(&bad).is_none());
    }
}
