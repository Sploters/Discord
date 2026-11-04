//! Spike B — transmissão nativa: captura a tela sem o limite de 48 fps, comprime em H.264 na placa de vídeo e envia
//! por RTP para o servidor do LocalCord (PlainTransport do mediasoup). O app mede, do outro lado, quantos quadros chegam.
//! Uso: transmitir --code "LC120 <host> <porta> <ssrc> <pt>" [--secs 60] [--fps 120] [--height 1080] [--kbps 16000]
//! Fora do Windows (teste no Linux): lê H.264 Annex-B com AUD da entrada padrão (ffmpeg ... -x264-params aud=1 -f h264 -).
mod rtp;
#[cfg(windows)]
mod win;

use std::time::Instant;

pub fn arg(name: &str, default: &str) -> String {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1)).cloned().unwrap_or_else(|| default.to_string())
}

pub struct Opts { pub host: String, pub port: u16, pub ssrc: u32, pub pt: u8, pub secs: u64, pub fps: u32, pub height: u32, pub kbps: u32 }

fn parse_code(code: &str) -> Option<(String, u16, u32, u8)> {
    let p: Vec<&str> = code.split_whitespace().collect();
    if p.len() != 5 || p[0] != "LC120" { return None; }
    Some((p[1].to_string(), p[2].parse().ok()?, p[3].parse().ok()?, p[4].parse().ok()?))
}

/// Contadores por segundo e resumo final (JSON numa linha, lido pelo script do teste).
pub struct Meter { start: Instant, pub per_cap: Vec<u32>, pub per_sent: Vec<u32>, pub per_bytes: Vec<u64>, pub enc_ms: Vec<f64>, pub skipped_busy: u64, last_print: u64, pub secs: u64 }
impl Meter {
    pub fn new(secs: u64) -> Self { Self { start: Instant::now(), per_cap: vec![0; secs as usize + 2], per_sent: vec![0; secs as usize + 2], per_bytes: vec![0; secs as usize + 2], enc_ms: Vec::new(), skipped_busy: 0, last_print: 0, secs } }
    pub fn elapsed(&self) -> f64 { self.start.elapsed().as_secs_f64() }
    fn idx(&self) -> usize { (self.elapsed() as usize).min(self.per_cap.len() - 1) }
    pub fn captured(&mut self) { let i = self.idx(); self.per_cap[i] += 1; }
    pub fn sent(&mut self, bytes: usize) { let i = self.idx(); self.per_sent[i] += 1; self.per_bytes[i] += bytes as u64; }
    pub fn tick(&mut self, s: &rtp::Stats) {
        let sec = self.elapsed() as u64;
        if sec > self.last_print && sec >= 1 {
            self.last_print = sec; let i = (sec - 1) as usize;
            if i < self.per_cap.len() {
                eprintln!("  {:>3}s  capturados {:>3}  enviados {:>3} fps  {:>5.1} Mbps  (quadros-chave {}, pedidos de reenvio {})",
                    sec, self.per_cap[i], self.per_sent[i], self.per_bytes[i] as f64 * 8.0 / 1e6, s.keyframes, s.nacks);
            }
        }
    }
    pub fn done(&self) -> bool { self.elapsed() >= self.secs as f64 + 1.0 }
}
fn pct(v: &[f64], p: f64) -> f64 { if v.is_empty() { return 0.0; } let mut s = v.to_vec(); s.sort_by(|a, b| a.partial_cmp(b).unwrap()); s[((s.len() as f64 * p) as usize).min(s.len() - 1)] }

pub fn summary(m: &Meter, s: &rtp::Stats, extra: &str) {
    // ignora o 1º segundo (aquecimento) e o último (incompleto)
    let n = m.secs as usize;
    let win = |v: &Vec<u32>| -> Vec<f64> { v.iter().skip(1).take(n.saturating_sub(1)).map(|&x| x as f64).collect() };
    let (cap, sent) = (win(&m.per_cap), win(&m.per_sent));
    let mbps: Vec<f64> = m.per_bytes.iter().skip(1).take(n.saturating_sub(1)).map(|&b| b as f64 * 8.0 / 1e6).collect();
    let mean = |v: &Vec<f64>| if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 };
    println!("{{\"capturedFps\":{:.1},\"sentFps\":{:.1},\"sentMin\":{:.0},\"sentP5\":{:.0},\"sentMedian\":{:.0},\"mbps\":{:.1},\"encodeMsMedian\":{:.2},\"encodeMsP95\":{:.2},\"skippedEncoderBusy\":{},\"keyframes\":{},\"nacks\":{},\"resent\":{},\"keyRequests\":{},\"packets\":{},\"seriesSent\":{:?}{}}}",
        mean(&cap), mean(&sent), sent.iter().cloned().fold(f64::MAX, f64::min).min(9999.0), pct(&sent, 0.05), pct(&sent, 0.5), mean(&mbps),
        pct(&m.enc_ms, 0.5), pct(&m.enc_ms, 0.95), m.skipped_busy, s.keyframes, s.nacks, s.resent, s.plis, s.packets,
        sent.iter().map(|x| *x as u32).collect::<Vec<_>>(), extra);
}

fn main() {
    let code = arg("--code", "");
    let Some((host, port, ssrc, pt)) = parse_code(&code) else {
        eprintln!("Codigo invalido. Gere o codigo no LocalCord (Configuracoes > Transmissao > Teste 120 FPS) e cole aqui.");
        std::process::exit(2);
    };
    let o = Opts { host, port, ssrc, pt, secs: arg("--secs", "60").parse().unwrap_or(60), fps: arg("--fps", "120").parse().unwrap_or(120),
        height: arg("--height", "1080").parse().unwrap_or(1080), kbps: arg("--kbps", "16000").parse().unwrap_or(16000) };
    eprintln!("  enviando para {}:{} (ssrc {}), {} fps, {} p, {} kbps, {} s", o.host, o.port, o.ssrc, o.fps, o.height, o.kbps, o.secs);
    let r = run(&o);
    if let Err(e) = r { println!("{{\"error\":{:?}}}", e); eprintln!("  ERRO: {e}"); std::process::exit(1); }
}

#[cfg(windows)]
fn run(o: &Opts) -> Result<(), String> { win::run(o) }

/// Linux/macOS: H.264 Annex-B com AUD vindo da entrada padrão (ex.: ffmpeg testsrc), no ritmo pedido.
#[cfg(not(windows))]
fn run(o: &Opts) -> Result<(), String> {
    use std::io::Read;
    let mut tx = rtp::RtpSender::new(&o.host, o.port, o.ssrc, o.pt).map_err(|e| e.to_string())?;
    let mut m = Meter::new(o.secs);
    let mut stdin = std::io::stdin(); let mut buf: Vec<u8> = Vec::new(); let mut chunk = vec![0u8; 1 << 16];
    let iv = 1.0 / o.fps as f64; let mut k: u64 = 0; let t0 = Instant::now();
    let aud = |b: &[u8], from: usize| -> Option<usize> { (from..b.len().saturating_sub(4)).find(|&i| b[i] == 0 && b[i + 1] == 0 && b[i + 2] == 0 && b[i + 3] == 1 && i + 4 < b.len() && b[i + 4] & 0x1F == 9) };
    loop {
        if m.done() { break; }
        // um quadro = do AUD atual até o próximo
        let (s, e) = loop {
            if let Some(s) = aud(&buf, 0) { if let Some(e) = aud(&buf, s + 5) { break (s, e); } }
            let n = stdin.read(&mut chunk).map_err(|e| e.to_string())?; if n == 0 { return { summary(&m, &tx.stats, ""); Ok(()) }; }
            buf.extend_from_slice(&chunk[..n]);
        };
        let frame: Vec<u8> = buf[s..e].to_vec(); buf.drain(..e);
        let due = t0 + std::time::Duration::from_secs_f64(k as f64 * iv);
        let now = Instant::now(); if due > now { std::thread::sleep(due - now); }
        m.captured();
        tx.poll_rtcp();
        let ts = (k as f64 * iv * 90000.0) as u32;
        let before = tx.stats.bytes;
        tx.send_frame(&frame, ts);
        m.sent((tx.stats.bytes - before) as usize);
        m.tick(&tx.stats);
        k += 1;
    }
    summary(&m, &tx.stats, "");
    Ok(())
}
