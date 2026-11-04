//! Transmissão nativa: captura a tela/janela sem o limite de 48 fps, comprime em H.264 na placa de vídeo e envia
//! por SRTP para o servidor do LocalCord (PlainTransport do mediasoup).
//! Modos:
//!   --code "LC120 <host> <porta> <ssrc> <pt> [<chave> <chave do servidor>]" [--secs 60] [--fps 120] [--height 1080] [--kbps 16000]
//!       teste do pacote: imprime um resumo JSON no fim
//!   --stdin   usado pelo app desktop: lê a configuração (JSON, 1 linha) da entrada padrão; "stop" ou fim da entrada encerra.
//!             Escreve eventos JSON por linha na saída: started, stats (1/s), error, ended
//!   --probe   diz se há codificador H.264 de hardware (JSON)
//! Fora do Windows (testes): a "captura" é um ffmpeg (testsrc) gerando H.264.
mod rtp;
mod srtp;
#[cfg(windows)]
mod win;

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

pub fn arg(name: &str, default: &str) -> String {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1)).cloned().unwrap_or_else(|| default.to_string())
}
fn flag(name: &str) -> bool { std::env::args().any(|x| x == name) }

#[derive(Clone, Debug)]
pub enum Source { Primary, Monitor(i32, i32), Window(isize) }

#[derive(Clone)]
pub struct Opts { pub host: String, pub port: u16, pub ssrc: u32, pub pt: u8, pub key: Option<(String, String)>, pub secs: u64, pub fps: u32, pub height: u32, pub kbps: u32, pub source: Source, pub app: bool, pub stop: Arc<AtomicBool> }

pub fn emit(v: serde_json::Value) { let mut o = std::io::stdout().lock(); let _ = writeln!(o, "{v}"); let _ = o.flush(); }

/// Contadores por segundo; no modo app manda "stats" a cada segundo, no teste guarda a série e imprime um resumo.
pub struct Meter { start: Instant, sec: u64, cap: u32, sent: u32, bytes: u64, pub hist_cap: Vec<u32>, pub hist_sent: Vec<u32>, pub hist_bytes: Vec<u64>, pub enc_ms: Vec<f64>, pub skipped_busy: u64, pub repeats: u64, secs: u64, app: bool, pub stop: Arc<AtomicBool>, pub size: (u32, u32) }
impl Meter {
    pub fn new(o: &Opts) -> Self { Self { start: Instant::now(), sec: 0, cap: 0, sent: 0, bytes: 0, hist_cap: vec![], hist_sent: vec![], hist_bytes: vec![], enc_ms: vec![], skipped_busy: 0, repeats: 0, secs: o.secs, app: o.app, stop: o.stop.clone(), size: (0, 0) } }
    pub fn elapsed(&self) -> f64 { self.start.elapsed().as_secs_f64() }
    pub fn captured(&mut self) { self.cap += 1; }
    pub fn sent(&mut self, bytes: usize) { self.sent += 1; self.bytes += bytes as u64; }
    pub fn tick(&mut self, s: &rtp::Stats) {
        let now = self.elapsed() as u64;
        while self.sec < now {
            self.sec += 1;
            let (c, t, b) = (self.cap, self.sent, self.bytes); self.cap = 0; self.sent = 0; self.bytes = 0;
            self.hist_cap.push(c); self.hist_sent.push(t); self.hist_bytes.push(b);
            if self.app {
                let em = if self.enc_ms.is_empty() { 0.0 } else { pct(&self.enc_ms[self.enc_ms.len().saturating_sub(c.max(1) as usize)..], 0.5) };
                emit(serde_json::json!({ "t": "stats", "fps": t, "cap": c, "kbps": b * 8 / 1000, "w": self.size.0, "h": self.size.1, "encMs": (em * 100.0).round() / 100.0, "busy": self.skipped_busy, "nacks": s.nacks, "keyReq": s.plis, "repeats": self.repeats }));
                if self.enc_ms.len() > 4000 { self.enc_ms.drain(..2000); }
            } else {
                eprintln!("  {:>3}s  capturados {:>3}  enviados {:>3} fps  {:>5.1} Mbps  (quadros-chave {}, pedidos de reenvio {})", self.sec, c, t, b as f64 * 8.0 / 1e6, s.keyframes, s.nacks);
            }
        }
    }
    pub fn done(&self) -> bool { self.stop.load(Ordering::Relaxed) || (self.secs > 0 && self.elapsed() >= self.secs as f64 + 1.0) }
}
pub fn pct(v: &[f64], p: f64) -> f64 { if v.is_empty() { return 0.0; } let mut s = v.to_vec(); s.sort_by(|a, b| a.partial_cmp(b).unwrap()); s[((s.len() as f64 * p) as usize).min(s.len() - 1)] }

pub fn summary(m: &Meter, s: &rtp::Stats, extra: serde_json::Value) {
    if m.app { let mut v = serde_json::json!({ "t": "ended", "frames": s.frames, "keyframes": s.keyframes, "nacks": s.nacks }); merge(&mut v, extra); emit(v); return; }
    // ignora o 1º segundo (aquecimento)
    let win = |v: &Vec<u32>| -> Vec<f64> { v.iter().skip(1).map(|&x| x as f64).collect() };
    let (cap, sent) = (win(&m.hist_cap), win(&m.hist_sent));
    let mbps: Vec<f64> = m.hist_bytes.iter().skip(1).map(|&b| b as f64 * 8.0 / 1e6).collect();
    let mean = |v: &Vec<f64>| if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 };
    let r1 = |x: f64| (x * 10.0).round() / 10.0;
    let mut v = serde_json::json!({ "capturedFps": r1(mean(&cap)), "sentFps": r1(mean(&sent)), "sentMin": sent.iter().cloned().fold(f64::MAX, f64::min).min(9999.0), "sentP5": pct(&sent, 0.05), "sentMedian": pct(&sent, 0.5), "mbps": r1(mean(&mbps)),
        "encodeMsMedian": (pct(&m.enc_ms, 0.5) * 100.0).round() / 100.0, "encodeMsP95": (pct(&m.enc_ms, 0.95) * 100.0).round() / 100.0, "skippedEncoderBusy": m.skipped_busy, "keyframes": s.keyframes, "nacks": s.nacks, "resent": s.resent, "keyRequests": s.plis, "packets": s.packets, "rtcpBad": 0, "seriesSent": m.hist_sent.iter().skip(1).collect::<Vec<_>>() });
    merge(&mut v, extra);
    println!("{v}");
}
fn merge(v: &mut serde_json::Value, extra: serde_json::Value) { if let (Some(a), serde_json::Value::Object(b)) = (v.as_object_mut(), extra) { for (k, x) in b { a.insert(k, x); } } }

fn parse_code(code: &str) -> Option<(String, u16, u32, u8, Option<(String, String)>)> {
    let p: Vec<&str> = code.split_whitespace().collect();
    if !(p.len() == 5 || p.len() == 7) || p[0] != "LC120" { return None; }
    let key = if p.len() == 7 { Some((p[5].to_string(), p[6].to_string())) } else { None };
    Some((p[1].to_string(), p[2].parse().ok()?, p[3].parse().ok()?, p[4].parse().ok()?, key))
}

fn main() {
    if flag("--probe") { return probe(); }
    let stop = Arc::new(AtomicBool::new(false));
    let o = if flag("--stdin") {
        let mut line = String::new();
        if std::io::stdin().read_line(&mut line).is_err() { std::process::exit(2); }
        let v: serde_json::Value = match serde_json::from_str(&line) { Ok(v) => v, Err(e) => { emit(serde_json::json!({ "t": "error", "error": format!("configuracao invalida: {e}") })); std::process::exit(2); } };
        let src = if let Some(w) = v["window"].as_i64() { Source::Window(w as isize) } else if let (Some(x), Some(y)) = (v["monitor"][0].as_i64(), v["monitor"][1].as_i64()) { Source::Monitor(x as i32, y as i32) } else { Source::Primary };
        let st = stop.clone();
        std::thread::spawn(move || { let mut l = String::new(); loop { l.clear(); match std::io::stdin().read_line(&mut l) { Ok(0) | Err(_) => break, Ok(_) if l.trim() == "stop" => break, _ => {} } } st.store(true, Ordering::Relaxed); });
        Opts { host: v["host"].as_str().unwrap_or("").into(), port: v["port"].as_u64().unwrap_or(0) as u16, ssrc: v["ssrc"].as_u64().unwrap_or(0) as u32, pt: v["pt"].as_u64().unwrap_or(102) as u8,
            key: match (v["key"].as_str(), v["serverKey"].as_str()) { (Some(a), Some(b)) => Some((a.into(), b.into())), _ => None },
            secs: v["secs"].as_u64().unwrap_or(0), fps: v["fps"].as_u64().unwrap_or(120) as u32, height: v["height"].as_u64().unwrap_or(1080) as u32, kbps: v["kbps"].as_u64().unwrap_or(16000) as u32, source: src, app: true, stop }
    } else {
        let Some((host, port, ssrc, pt, key)) = parse_code(&arg("--code", "")) else {
            eprintln!("Codigo invalido. Gere o codigo no LocalCord (Configuracoes > Transmissao > Teste 120 FPS) e cole aqui.");
            std::process::exit(2);
        };
        Opts { host, port, ssrc, pt, key, secs: arg("--secs", "60").parse().unwrap_or(60), fps: arg("--fps", "120").parse().unwrap_or(120), height: arg("--height", "1080").parse().unwrap_or(1080), kbps: arg("--kbps", "16000").parse().unwrap_or(16000), source: Source::Primary, app: false, stop }
    };
    if !o.app { eprintln!("  enviando para {}:{} (ssrc {}), {} fps, {} p, {} kbps, {} s{}", o.host, o.port, o.ssrc, o.fps, o.height, o.kbps, o.secs, if o.key.is_some() { ", criptografado (SRTP)" } else { "" }); }
    if let Err(e) = run(&o) {
        if o.app { emit(serde_json::json!({ "t": "error", "error": e })); } else { println!("{}", serde_json::json!({ "error": e })); eprintln!("  ERRO: {e}"); }
        std::process::exit(1);
    }
}

pub fn sender(o: &Opts) -> Result<rtp::RtpSender, String> {
    let mut tx = rtp::RtpSender::new(&o.host, o.port, o.ssrc, o.pt).map_err(|e| format!("UDP: {e}"))?;
    if let Some((a, b)) = &o.key { tx.set_srtp(a, b)?; }
    Ok(tx)
}

#[cfg(windows)]
fn run(o: &Opts) -> Result<(), String> { win::run(o) }
#[cfg(windows)]
fn probe() { emit(win::probe()); }

#[cfg(not(windows))]
fn probe() { emit(serde_json::json!({ "ok": std::process::Command::new("ffmpeg").arg("-version").output().is_ok(), "encoders": ["ffmpeg libx264 (teste)"], "test": true })); }

/// Fora do Windows: ffmpeg gera H.264 Annex-B com AUD (testsrc2) no lugar da captura + placa; enviado no ritmo pedido.
#[cfg(not(windows))]
fn run(o: &Opts) -> Result<(), String> {
    use std::io::Read;
    let h = o.height; let w = (h * 16 / 9) / 2 * 2;
    let mut ff = std::process::Command::new("ffmpeg").args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", &format!("testsrc2=size={w}x{h}:rate={}", o.fps), "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-profile:v", "baseline",
        "-x264-params", &format!("aud=1:keyint={}", o.fps * 2), "-b:v", &format!("{}k", o.kbps), "-f", "h264", "-"]).stdout(std::process::Stdio::piped()).stdin(std::process::Stdio::null()).spawn().map_err(|e| format!("ffmpeg: {e}"))?;
    let mut stdin = ff.stdout.take().unwrap();
    let mut tx = sender(o)?;
    let mut m = Meter::new(o); m.size = (w, h);
    if o.app { emit(serde_json::json!({ "t": "started", "w": w, "h": h, "encoder": "ffmpeg libx264 (teste)", "source": format!("{:?}", o.source) })); }
    let mut buf: Vec<u8> = Vec::new(); let mut chunk = vec![0u8; 1 << 16];
    let iv = 1.0 / o.fps as f64; let mut k: u64 = 0; let t0 = Instant::now();
    let aud = |b: &[u8], from: usize| -> Option<usize> { (from..b.len().saturating_sub(4)).find(|&i| b[i] == 0 && b[i + 1] == 0 && b[i + 2] == 0 && b[i + 3] == 1 && i + 4 < b.len() && b[i + 4] & 0x1F == 9) };
    'outer: while !m.done() {
        let (s, e) = loop {
            if let Some(s) = aud(&buf, 0) { if let Some(e) = aud(&buf, s + 5) { break (s, e); } }
            let n = stdin.read(&mut chunk).map_err(|e| e.to_string())?; if n == 0 { break 'outer; }
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
    let _ = ff.kill();
    summary(&m, &tx.stats, serde_json::json!({ "encoder": "ffmpeg libx264 (teste)", "rtcpBad": tx.rtcp_bad }));
    Ok(())
}
