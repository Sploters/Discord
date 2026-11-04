//! RTP H.264 (RFC 6184, packetization-mode 1) por UDP para um PlainTransport do mediasoup (comedia, rtcp-mux).
//! - NAL que cabe no MTU vai inteira; maior vai em fragmentos FU-A; marcador no último pacote do quadro.
//! - Guarda os últimos pacotes e reenvia os pedidos por NACK; PLI/FIR pedem um quadro-chave.
//! - SPS/PPS: guardados e reenviados antes de todo IDR que vier sem eles.
use std::net::UdpSocket;
use std::time::{Duration, Instant};

pub const MTU_PAYLOAD: usize = 1180;
const HISTORY: usize = 2048;

pub struct Stats { pub packets: u64, pub bytes: u64, pub frames: u64, pub keyframes: u64, pub nacks: u64, pub resent: u64, pub plis: u64 }

pub struct RtpSender {
    sock: UdpSocket,
    ssrc: u32, pt: u8, seq: u16,
    sps: Option<Vec<u8>>, pps: Option<Vec<u8>>,
    hist: Vec<Option<(u16, Vec<u8>)>>,
    pub want_key: bool,
    pub stats: Stats,
    last_sr: Instant, first_ts: Option<(Instant, u32)>,
}

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

impl RtpSender {
    pub fn new(host: &str, port: u16, ssrc: u32, pt: u8) -> std::io::Result<Self> {
        let sock = UdpSocket::bind("0.0.0.0:0")?;
        sock.connect((host, port))?;
        sock.set_nonblocking(true)?;
        Ok(Self { sock, ssrc, pt, seq: (ssrc as u16).wrapping_mul(7), sps: None, pps: None, hist: vec![None; HISTORY], want_key: false,
            stats: Stats { packets: 0, bytes: 0, frames: 0, keyframes: 0, nacks: 0, resent: 0, plis: 0 }, last_sr: Instant::now(), first_ts: None })
    }

    fn send_raw(&mut self, pkt: Vec<u8>) {
        let _ = self.sock.send(&pkt);
        self.stats.packets += 1; self.stats.bytes += pkt.len() as u64;
        let s = self.seq.wrapping_sub(1);
        self.hist[s as usize % HISTORY] = Some((s, pkt));
    }

    fn packet(&mut self, ts: u32, marker: bool, payload: &[&[u8]]) {
        let len: usize = payload.iter().map(|p| p.len()).sum();
        let mut p = Vec::with_capacity(12 + len);
        p.push(0x80); p.push(self.pt | if marker { 0x80 } else { 0 });
        p.extend_from_slice(&self.seq.to_be_bytes()); p.extend_from_slice(&ts.to_be_bytes()); p.extend_from_slice(&self.ssrc.to_be_bytes());
        for x in payload { p.extend_from_slice(x); }
        self.seq = self.seq.wrapping_add(1);
        self.send_raw(p);
    }

    fn send_nal(&mut self, nal: &[u8], ts: u32, last: bool) {
        if nal.len() <= MTU_PAYLOAD { self.packet(ts, last, &[nal]); return; }
        let (hdr, body) = (nal[0], &nal[1..]);
        let ind = (hdr & 0xE0) | 28; let typ = hdr & 0x1F;
        let chunks: Vec<&[u8]> = body.chunks(MTU_PAYLOAD - 2).collect();
        let n = chunks.len();
        for (i, c) in chunks.into_iter().enumerate() {
            let fu = typ | if i == 0 { 0x80 } else { 0 } | if i == n - 1 { 0x40 } else { 0 };
            self.packet(ts, last && i == n - 1, &[&[ind, fu], c]);
        }
    }

    pub fn has_params(&self) -> bool { self.sps.is_some() && self.pps.is_some() }
    /// SPS/PPS vindos do cabeçalho do codificador (Annex-B ou já separados)
    pub fn set_params(&mut self, blob: &[u8]) {
        for n in split_annexb(blob) { if n.is_empty() { continue; } match n[0] & 0x1F { 7 => self.sps = Some(n.to_vec()), 8 => self.pps = Some(n.to_vec()), _ => {} } }
    }
    /// Um quadro codificado (Annex-B). ts em 90 kHz.
    pub fn send_frame(&mut self, annexb: &[u8], ts: u32) -> bool {
        let nals: Vec<&[u8]> = split_annexb(annexb).into_iter().filter(|n| !n.is_empty() && (n[0] & 0x1F) != 9).collect(); // tira AUD
        let mut key = false; let (mut has_sps, mut has_pps) = (false, false);
        for n in &nals { match n[0] & 0x1F { 5 => key = true, 7 => { has_sps = true; self.sps = Some(n.to_vec()); } 8 => { has_pps = true; self.pps = Some(n.to_vec()); } _ => {} } }
        let mut list: Vec<Vec<u8>> = Vec::new();
        if key && !has_sps { if let Some(s) = &self.sps { list.push(s.clone()); } }
        if key && !has_pps { if let Some(p) = &self.pps { list.push(p.clone()); } }
        for n in nals { list.push(n.to_vec()); }
        let k = list.len();
        for (i, n) in list.iter().enumerate() { self.send_nal(n, ts, i == k - 1); }
        if self.first_ts.is_none() { self.first_ts = Some((Instant::now(), ts)); }
        self.stats.frames += 1; if key { self.stats.keyframes += 1; }
        self.maybe_sr(ts);
        key
    }

    /// Relatório do remetente a cada 1 s (o mediasoup e o navegador usam para sincronizar e estimar atraso).
    fn maybe_sr(&mut self, ts: u32) {
        if self.last_sr.elapsed() < Duration::from_secs(1) { return; }
        self.last_sr = Instant::now();
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        let ntp_s = now.as_secs() + 2_208_988_800; let ntp_f = ((now.subsec_nanos() as u64) << 32) / 1_000_000_000;
        let mut p = vec![0x80, 200, 0, 6];
        p.extend_from_slice(&self.ssrc.to_be_bytes());
        p.extend_from_slice(&(ntp_s as u32).to_be_bytes()); p.extend_from_slice(&(ntp_f as u32).to_be_bytes());
        p.extend_from_slice(&ts.to_be_bytes());
        p.extend_from_slice(&(self.stats.packets as u32).to_be_bytes()); p.extend_from_slice(&(self.stats.bytes as u32).to_be_bytes());
        let _ = self.sock.send(&p);
    }

    /// Lê o RTCP que o servidor manda de volta: NACK (reenvia), PLI/FIR (pede quadro-chave).
    pub fn poll_rtcp(&mut self) {
        let mut buf = [0u8; 1500];
        while let Ok(n) = self.sock.recv(&mut buf) {
            let mut off = 0;
            while off + 4 <= n {
                let b = &buf[off..n];
                let fmt = b[0] & 0x1F; let pt = b[1]; let len = (u16::from_be_bytes([b[2], b[3]]) as usize + 1) * 4;
                if len > b.len() { break; }
                if pt == 205 && fmt == 1 && len >= 16 { // NACK genérico: PID + BLP
                    let mut i = 12;
                    while i + 4 <= len {
                        let pid = u16::from_be_bytes([b[i], b[i + 1]]); let blp = u16::from_be_bytes([b[i + 2], b[i + 3]]);
                        self.resend(pid); for k in 0..16 { if blp & (1 << k) != 0 { self.resend(pid.wrapping_add(k + 1)); } }
                        self.stats.nacks += 1; i += 4;
                    }
                } else if pt == 206 && (fmt == 1 || fmt == 4) { self.want_key = true; self.stats.plis += 1; }
                off += len;
            }
        }
    }
    fn resend(&mut self, seq: u16) {
        if let Some(Some((s, p))) = self.hist.get(seq as usize % HISTORY) { if *s == seq { let _ = self.sock.send(p); self.stats.resent += 1; } }
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
        let mut s = RtpSender::new("127.0.0.1", port, 1234, 102).unwrap();
        let mut nal = vec![0x65]; nal.extend(std::iter::repeat(7u8).take(3000));
        let mut f = vec![0, 0, 0, 1]; f.extend(&nal);
        s.send_frame(&f, 9000);
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
