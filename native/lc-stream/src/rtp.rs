//! RTP H.264 (RFC 6184, packetization-mode 1) por UDP para um PlainTransport do mediasoup (comedia, rtcp-mux).
//! - NAL que cabe no MTU vai inteira; maior vai em fragmentos FU-A; marcador no último pacote do quadro.
//! - Guarda os últimos pacotes e reenvia os pedidos por NACK; PLI/FIR pedem um quadro-chave.
//! - SPS/PPS: guardados e reenviados antes de todo IDR que vier sem eles.
use std::net::UdpSocket;
use std::time::{Duration, Instant};

pub const MTU_PAYLOAD: usize = 1180;
const HISTORY: usize = 2048;

#[derive(Default, Clone, Copy)]
pub struct Stats { pub packets: u64, pub bytes: u64, pub frames: u64, pub keyframes: u64, pub nacks: u64, pub resent: u64, pub plis: u64 }

/// Um fluxo de vídeo (uma camada do simulcast): ssrc próprio, numeração, histórico para NACK e SRTP próprio (ROC por ssrc).
pub struct Stream {
    ssrc: u32, pt: u8, seq: u16,
    sps: Option<Vec<u8>>, pps: Option<Vec<u8>>,
    hist: Vec<Option<(u16, Vec<u8>)>>,
    pub want_key: bool,
    pub stats: Stats,
    last_sr: Instant,
    tx: Option<crate::srtp::Tx>,
}

/// Um socket UDP (o PlainTransport aprende o endereço do primeiro pacote: todas as camadas saem dele) e N fluxos.
pub struct Session { sock: UdpSocket, rx: Option<crate::srtp::Rx>, key: Option<String>, pub streams: Vec<Stream>, pub rtcp_bad: u64 }

pub fn split_annexb(buf: &[u8]) -> Vec<&[u8]> {
    let mut out = Vec::new();
    let mut i = 0; let mut start: Option<usize> = None;
    while i + 3 <= buf.len() {
        let sc3 = buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 1;
        let sc4 = i + 4 <= buf.len() && buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 0 && buf[i + 3] == 1;
        if sc3 || sc4 {
            if let Some(s) = start { let mut e = i; while e > s && buf[e - 1] == 0 { e -= 1; } if e > s { out.push(&buf[s..e]); } }
            i += if sc4 { 4 } else { 3 }; start = Some(i);
        } else { i += 1; }
    }
    if let Some(s) = start { if s < buf.len() { out.push(&buf[s..]); } } else if !buf.is_empty() { out.push(buf); } // sem start code: NAL única
    out
}


impl Session {
    pub fn new(host: &str, port: u16) -> std::io::Result<Self> {
        let sock = UdpSocket::bind("0.0.0.0:0")?;
        sock.connect((host, port))?;
        sock.set_nonblocking(true)?;
        Ok(Self { sock, rx: None, key: None, streams: Vec::new(), rtcp_bad: 0 })
    }
    /// Liga o SRTP: nossa chave (para o que enviamos) e a do servidor (para abrir o RTCP que ele manda).
    pub fn set_srtp(&mut self, ours: &str, server: &str) -> Result<(), String> {
        crate::srtp::parse_key(ours).ok_or("chave SRTP invalida")?;
        let (k2, s2) = crate::srtp::parse_key(server).ok_or("chave SRTP do servidor invalida")?;
        self.rx = Some(crate::srtp::Rx::new(&k2, &s2)); self.key = Some(ours.to_string());
        for st in &mut self.streams { st.tx = Some(Self::tx_for(ours)); }
        Ok(())
    }
    fn tx_for(key: &str) -> crate::srtp::Tx { let (k, s) = crate::srtp::parse_key(key).unwrap(); crate::srtp::Tx::new(&k, &s) }
    pub fn add_stream(&mut self, ssrc: u32, pt: u8) -> usize {
        self.streams.push(Stream { ssrc, pt, seq: (ssrc as u16).wrapping_mul(7), sps: None, pps: None, hist: vec![None; HISTORY], want_key: false, stats: Stats::default(), last_sr: Instant::now(), tx: self.key.as_deref().map(Self::tx_for) });
        self.streams.len() - 1
    }
    pub fn total(&self) -> Stats {
        let mut t = Stats::default();
        for s in &self.streams { t.packets += s.stats.packets; t.bytes += s.stats.bytes; t.frames += s.stats.frames; t.keyframes += s.stats.keyframes; t.nacks += s.stats.nacks; t.resent += s.stats.resent; t.plis += s.stats.plis; }
        t
    }
    pub fn has_params(&self, i: usize) -> bool { self.streams[i].sps.is_some() && self.streams[i].pps.is_some() }
    /// SPS/PPS vindos do cabeçalho do codificador (Annex-B ou já separados)
    pub fn set_params(&mut self, i: usize, blob: &[u8]) {
        let st = &mut self.streams[i];
        for n in split_annexb(blob) { if n.is_empty() { continue; } match n[0] & 0x1F { 7 => st.sps = Some(n.to_vec()), 8 => st.pps = Some(n.to_vec()), _ => {} } }
    }

    fn packet(&mut self, i: usize, ts: u32, marker: bool, payload: &[&[u8]]) {
        let st = &mut self.streams[i];
        let len: usize = payload.iter().map(|p| p.len()).sum();
        let mut p = Vec::with_capacity(12 + len + 10);
        p.push(0x80); p.push(st.pt | if marker { 0x80 } else { 0 });
        p.extend_from_slice(&st.seq.to_be_bytes()); p.extend_from_slice(&ts.to_be_bytes()); p.extend_from_slice(&st.ssrc.to_be_bytes());
        for x in payload { p.extend_from_slice(x); }
        let seq = st.seq; st.seq = st.seq.wrapping_add(1);
        let p = match &mut st.tx { Some(tx) => tx.protect_rtp(&p), None => p };
        let _ = self.sock.send(&p);
        st.stats.packets += 1; st.stats.bytes += p.len() as u64;
        st.hist[seq as usize % HISTORY] = Some((seq, p));
    }

    fn send_nal(&mut self, i: usize, nal: &[u8], ts: u32, last: bool) {
        if nal.len() <= MTU_PAYLOAD { self.packet(i, ts, last, &[nal]); return; }
        let (hdr, body) = (nal[0], &nal[1..]);
        let ind = (hdr & 0xE0) | 28; let typ = hdr & 0x1F;
        let chunks: Vec<&[u8]> = body.chunks(MTU_PAYLOAD - 2).collect();
        let n = chunks.len();
        for (k, c) in chunks.into_iter().enumerate() {
            let fu = typ | if k == 0 { 0x80 } else { 0 } | if k == n - 1 { 0x40 } else { 0 };
            self.packet(i, ts, last && k == n - 1, &[&[ind, fu], c]);
        }
    }

    /// Um quadro codificado (Annex-B) no fluxo i. ts em 90 kHz. Devolve se era quadro-chave.
    pub fn send_frame(&mut self, i: usize, annexb: &[u8], ts: u32) -> bool {
        let nals: Vec<&[u8]> = split_annexb(annexb).into_iter().filter(|n| !n.is_empty() && (n[0] & 0x1F) != 9).collect(); // tira AUD
        let mut key = false; let (mut has_sps, mut has_pps) = (false, false);
        { let st = &mut self.streams[i];
          for n in &nals { match n[0] & 0x1F { 5 => key = true, 7 => { has_sps = true; st.sps = Some(n.to_vec()); } 8 => { has_pps = true; st.pps = Some(n.to_vec()); } _ => {} } } }
        let mut list: Vec<Vec<u8>> = Vec::new();
        { let st = &self.streams[i];
          if key && !has_sps { if let Some(s) = &st.sps { list.push(s.clone()); } }
          if key && !has_pps { if let Some(p) = &st.pps { list.push(p.clone()); } } }
        for n in nals { list.push(n.to_vec()); }
        let k = list.len();
        for (j, n) in list.iter().enumerate() { self.send_nal(i, n, ts, j == k - 1); }
        let st = &mut self.streams[i];
        st.stats.frames += 1; if key { st.stats.keyframes += 1; }
        self.maybe_sr(i, ts);
        key
    }

    /// Relatório do remetente a cada 1 s por fluxo: o mediasoup usa para alinhar as camadas ao trocar de uma para outra.
    fn maybe_sr(&mut self, i: usize, ts: u32) {
        let st = &mut self.streams[i];
        if st.last_sr.elapsed() < Duration::from_secs(1) { return; }
        st.last_sr = Instant::now();
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        let ntp_s = now.as_secs() + 2_208_988_800; let ntp_f = ((now.subsec_nanos() as u64) << 32) / 1_000_000_000;
        let mut p = vec![0x80, 200, 0, 6];
        p.extend_from_slice(&st.ssrc.to_be_bytes());
        p.extend_from_slice(&(ntp_s as u32).to_be_bytes()); p.extend_from_slice(&(ntp_f as u32).to_be_bytes());
        p.extend_from_slice(&ts.to_be_bytes());
        p.extend_from_slice(&(st.stats.packets as u32).to_be_bytes()); p.extend_from_slice(&(st.stats.bytes as u32).to_be_bytes());
        let p = match &mut st.tx { Some(tx) => tx.protect_rtcp(&p), None => p };
        let _ = self.sock.send(&p);
    }

    /// Lê o RTCP que o servidor manda de volta: NACK (reenvia), PLI/FIR (pede quadro-chave) — para o fluxo do ssrc indicado.
    pub fn poll_rtcp(&mut self) {
        let mut buf = [0u8; 1500];
        while let Ok(n0) = self.sock.recv(&mut buf) {
            let plain: Vec<u8> = match &self.rx { Some(rx) => match rx.unprotect_rtcp(&buf[..n0]) { Some(v) => v, None => { self.rtcp_bad += 1; continue; } }, None => buf[..n0].to_vec() };
            let n = plain.len();
            let mut off = 0;
            while off + 4 <= n {
                let b = &plain[off..n];
                let fmt = b[0] & 0x1F; let pt = b[1]; let len = (u16::from_be_bytes([b[2], b[3]]) as usize + 1) * 4;
                if len > b.len() { break; }
                let media = if len >= 12 { u32::from_be_bytes([b[8], b[9], b[10], b[11]]) } else { 0 };
                let idx: Vec<usize> = (0..self.streams.len()).filter(|&i| media == 0 || self.streams[i].ssrc == media).collect();
                if pt == 205 && fmt == 1 && len >= 16 { // NACK genérico: PID + BLP
                    let mut k = 12;
                    while k + 4 <= len {
                        let pid = u16::from_be_bytes([b[k], b[k + 1]]); let blp = u16::from_be_bytes([b[k + 2], b[k + 3]]);
                        for &i in &idx { self.resend(i, pid); for j in 0..16 { if blp & (1 << j) != 0 { self.resend(i, pid.wrapping_add(j + 1)); } } self.streams[i].stats.nacks += 1; }
                        k += 4;
                    }
                } else if pt == 206 && fmt == 1 { for &i in &idx { self.streams[i].want_key = true; self.streams[i].stats.plis += 1; } }
                else if pt == 206 && fmt == 4 && len >= 20 { // FIR: o ssrc pedido vem no FCI
                    let fs = u32::from_be_bytes([b[12], b[13], b[14], b[15]]);
                    for st in &mut self.streams { if st.ssrc == fs { st.want_key = true; st.stats.plis += 1; } }
                }
                off += len;
            }
        }
    }
    fn resend(&mut self, i: usize, seq: u16) {
        let st = &mut self.streams[i];
        if let Some(Some((s, p))) = st.hist.get(seq as usize % HISTORY) { if *s == seq { let _ = self.sock.send(p); st.stats.resent += 1; } }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split() {
        let b = [0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 9, 9];
        let n = split_annexb(&b);
        assert_eq!(n.len(), 3); assert_eq!(n[0], &[0x67, 1, 2]); assert_eq!(n[1], &[0x68, 3]); assert_eq!(n[2], &[0x65, 9, 9]);
    }
    #[test]
    fn fua() {
        let rx = UdpSocket::bind("127.0.0.1:0").unwrap(); let port = rx.local_addr().unwrap().port();
        let mut s = Session::new("127.0.0.1", port).unwrap(); s.add_stream(1234, 102);
        let mut nal = vec![0x65]; nal.extend(std::iter::repeat(7u8).take(3000));
        let mut f = vec![0, 0, 0, 1]; f.extend(&nal);
        s.send_frame(0, &f, 9000);
        let mut got = Vec::new(); let mut buf = [0u8; 2000];
        rx.set_read_timeout(Some(Duration::from_millis(200))).unwrap();
        while let Ok(n) = rx.recv(&mut buf) { got.push(buf[..n].to_vec()); }
        assert_eq!(got.len(), 3);
        assert_eq!(got[0][12] & 0x1F, 28); assert_eq!(got[0][13], 0x80 | 5); assert_eq!(got[2][13], 0x40 | 5);
        assert_eq!(got[2][1] & 0x80, 0x80); assert_eq!(got[0][1] & 0x80, 0);
        let body: Vec<u8> = got.iter().flat_map(|p| p[14..].to_vec()).collect();
        assert_eq!(body, nal[1..].to_vec());
    }
}
