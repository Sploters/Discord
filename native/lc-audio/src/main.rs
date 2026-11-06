//! Áudio da transmissão como o Discord faz no Windows: em vez do "loopback" do PC inteiro (que pega música, navegador,
//! a voz dos amigos na call...), captura só o áudio de UM programa (o jogo) com o loopback por processo do WASAPI
//! (Windows 10 2004 / build 19041 ou mais novo). Também lista as janelas, inclusive as minimizadas (jogo em tela cheia
//! some da lista do Chromium depois do alt+tab).
//!
//! Modos:
//!   --probe     {"ok":bool,"build":n}  (o loopback por processo existe neste Windows?)
//!   --windows   [{"hwnd","pid","title","exe","minimized","fullscreen"}...] (uma linha JSON)
//!   --capture   lê a configuração (JSON, 1 linha) da entrada padrão: {"pid":n,"mode":"include"|"exclude"}
//!               include = só esse processo e os filhos dele (o jogo); exclude = tudo menos ele e os filhos (a Resenha).
//!               Saída padrão: PCM float32 little-endian, 48 kHz, estéreo, intercalado (binário, sem cabeçalho).
//!               Erro padrão: eventos JSON por linha: {"t":"started"} | {"t":"error","error":"..."}.
//!               Encerra quando a entrada padrão fecha ou recebe "stop".
//! Fora do Windows (testes): --capture gera um tom de 440 Hz e --windows devolve uma lista fixa.

use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub const RATE: u32 = 48000;
pub const CH: u16 = 2;

fn emit_err(v: serde_json::Value) { let mut e = std::io::stderr().lock(); let _ = writeln!(e, "{v}"); let _ = e.flush(); }

/// fecha quando a entrada padrão acaba (o app fechou) ou chega "stop"
fn watch_stdin(stop: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() { match line { Ok(l) if l.trim() == "stop" => break, Ok(_) => {}, Err(_) => break } }
        stop.store(true, Ordering::SeqCst);
    });
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let has = |f: &str| args.iter().any(|a| a == f);
    if has("--probe") { println!("{}", sys::probe()); return; }
    if has("--windows") { println!("{}", sys::windows()); return; }
    if has("--capture") {
        let mut line = String::new();
        if std::io::stdin().lock().read_line(&mut line).is_err() { emit_err(serde_json::json!({ "t": "error", "error": "sem configuração" })); std::process::exit(2); }
        let cfg: serde_json::Value = serde_json::from_str(line.trim()).unwrap_or(serde_json::Value::Null);
        let pid = cfg["pid"].as_u64().unwrap_or(0) as u32;
        let include = cfg["mode"].as_str() != Some("exclude");
        if pid == 0 { emit_err(serde_json::json!({ "t": "error", "error": "processo inválido" })); std::process::exit(2); }
        let stop = Arc::new(AtomicBool::new(false));
        watch_stdin(stop.clone());
        if let Err(e) = sys::capture(pid, include, stop) { emit_err(serde_json::json!({ "t": "error", "error": e })); std::process::exit(1); }
        return;
    }
    eprintln!("uso: lc-audio --probe | --windows | --capture  (ver o cabeçalho de src/main.rs)");
    std::process::exit(2);
}

#[cfg(not(windows))]
mod sys {
    use super::*;
    pub fn probe() -> serde_json::Value { serde_json::json!({ "ok": false, "build": 0, "error": "só no Windows" }) }
    pub fn windows() -> serde_json::Value {
        serde_json::json!([{ "hwnd": 1234, "pid": 42, "title": "Jogo de Teste", "exe": "C:\\Games\\Teste\\teste.exe", "minimized": true, "fullscreen": true }])
    }
    /// tom de teste (440 Hz, -12 dB) no mesmo formato da captura real, em tempo real
    pub fn capture(_pid: u32, _include: bool, stop: Arc<AtomicBool>) -> Result<(), String> {
        emit_err(serde_json::json!({ "t": "started", "rate": RATE, "channels": CH }));
        let mut out = std::io::stdout().lock();
        let (frames, mut n) = (480usize, 0u64);
        let t0 = std::time::Instant::now();
        while !stop.load(Ordering::SeqCst) {
            let mut buf = Vec::with_capacity(frames * 8);
            for _ in 0..frames { let v = (n as f32 * 440.0 * std::f32::consts::TAU / RATE as f32).sin() * 0.25; n += 1; for _ in 0..CH { buf.extend_from_slice(&v.to_le_bytes()); } }
            if out.write_all(&buf).and_then(|_| out.flush()).is_err() { break; }
            let due = std::time::Duration::from_secs_f64(n as f64 / RATE as f64);
            if let Some(w) = due.checked_sub(t0.elapsed()) { std::thread::sleep(w); }
        }
        Ok(())
    }
}

#[cfg(windows)]
mod sys {
    use super::*;
    use windows::core::{implement, Interface, BOOL, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, RECT, WAIT_OBJECT_0};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{CoInitializeEx, BLOB, COINIT_MULTITHREADED};
    use windows::Win32::System::Threading::{CreateEventW, OpenProcess, QueryFullProcessImageNameW, SetEvent, WaitForSingleObject, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::System::Variant::VT_BLOB;
    use windows::Win32::UI::WindowsAndMessaging::*;

    // ---------- versão do Windows (RtlGetVersion não mente como GetVersionEx) ----------
    #[repr(C)]
    struct OsVer { size: u32, major: u32, minor: u32, build: u32, platform: u32, csd: [u16; 128] }
    #[link(name = "ntdll")]
    extern "system" { fn RtlGetVersion(v: *mut OsVer) -> i32; }
    fn build() -> u32 { let mut v = OsVer { size: std::mem::size_of::<OsVer>() as u32, major: 0, minor: 0, build: 0, platform: 0, csd: [0; 128] }; unsafe { RtlGetVersion(&mut v) }; if v.major >= 10 { v.build } else { 0 } }
    pub fn probe() -> serde_json::Value { let b = build(); serde_json::json!({ "ok": b >= 19041, "build": b }) }

    // ---------- janelas ----------
    fn exe_of(pid: u32) -> String {
        unsafe {
            let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
            let mut buf = [0u16; 1024]; let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
            let _ = CloseHandle(h);
            if ok { String::from_utf16_lossy(&buf[..len as usize]) } else { String::new() }
        }
    }
    unsafe extern "system" fn each(hwnd: HWND, lp: LPARAM) -> BOOL {
        let out = &mut *(lp.0 as *mut Vec<serde_json::Value>);
        // janelas de verdade: visíveis (minimizada continua "visível"), sem dono, sem ser ferramenta, não escondidas pelo DWM
        if !IsWindowVisible(hwnd).as_bool() { return true.into(); }
        if GetWindow(hwnd, GW_OWNER).map(|o| !o.is_invalid()).unwrap_or(false) { return true.into(); }
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if ex & WS_EX_TOOLWINDOW.0 != 0 { return true.into(); }
        let mut cloaked = 0u32;
        if DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut _, 4).is_ok() && cloaked != 0 { return true.into(); }
        let n = GetWindowTextLengthW(hwnd); if n <= 0 { return true.into(); }
        let mut t = vec![0u16; n as usize + 1]; let got = GetWindowTextW(hwnd, &mut t);
        let title = String::from_utf16_lossy(&t[..got.max(0) as usize]);
        let mut pid = 0u32; GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let minimized = IsIconic(hwnd).as_bool();
        // tela cheia: o tamanho "normal" da janela cobre o monitor inteiro (vale também quando está minimizada)
        let mut wp = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
        let mut r = RECT::default();
        if minimized { if GetWindowPlacement(hwnd, &mut wp).is_ok() { r = wp.rcNormalPosition; } } else { let _ = GetWindowRect(hwnd, &mut r); }
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        // (compara o tamanho, não a posição: a posição "normal" vem em coordenadas da área de trabalho, deslocada pela barra de tarefas)
        let fullscreen = GetMonitorInfoW(mon, &mut mi).as_bool() && r.right - r.left >= mi.rcMonitor.right - mi.rcMonitor.left && r.bottom - r.top >= mi.rcMonitor.bottom - mi.rcMonitor.top;
        if std::env::var_os("LC_DEBUG").is_some() { eprintln!("{title}: rect {:?} monitor {:?}", (r.left, r.top, r.right, r.bottom), (mi.rcMonitor.left, mi.rcMonitor.top, mi.rcMonitor.right, mi.rcMonitor.bottom)); }
        out.push(serde_json::json!({ "hwnd": hwnd.0 as isize, "pid": pid, "title": title, "exe": exe_of(pid), "minimized": minimized, "fullscreen": fullscreen }));
        true.into()
    }
    pub fn windows() -> serde_json::Value {
        let mut out: Vec<serde_json::Value> = Vec::new();
        unsafe { let _ = EnumWindows(Some(each), LPARAM(&mut out as *mut _ as isize)); }
        serde_json::Value::Array(out)
    }

    // ---------- captura por processo ----------
    #[implement(IActivateAudioInterfaceCompletionHandler)]
    struct Done(HANDLE);
    impl IActivateAudioInterfaceCompletionHandler_Impl for Done_Impl {
        fn ActivateCompleted(&self, _op: windows_core::Ref<'_, IActivateAudioInterfaceAsyncOperation>) -> windows::core::Result<()> {
            unsafe { let _ = SetEvent(self.0); }
            Ok(())
        }
    }

    fn activate(pid: u32, include: bool) -> Result<IAudioClient, String> {
        unsafe {
            let params = AUDIOCLIENT_ACTIVATION_PARAMS {
                ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
                Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                    ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                        TargetProcessId: pid,
                        ProcessLoopbackMode: if include { PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE } else { PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE },
                    },
                },
            };
            let mut pv = PROPVARIANT::default();
            {
                let inner = &mut *pv.Anonymous.Anonymous;
                inner.vt = VT_BLOB;
                inner.Anonymous.blob = BLOB { cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32, pBlobData: &params as *const _ as *mut u8 };
            }
            let ev = CreateEventW(None, false, false, None).map_err(|e| e.to_string())?;
            let handler: IActivateAudioInterfaceCompletionHandler = Done(ev).into();
            let op = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, &IAudioClient::IID, Some(&pv), &handler)
                .map_err(|e| format!("ActivateAudioInterfaceAsync: {e}"))?;
            // o PROPVARIANT aponta para `params` (na pilha): não pode ser liberado pelo Drop como se fosse do COM
            std::mem::forget(pv);
            if WaitForSingleObject(ev, 5000) != WAIT_OBJECT_0 { let _ = CloseHandle(ev); return Err("o Windows não respondeu à ativação do áudio".into()); }
            let _ = CloseHandle(ev);
            let mut hr = windows::core::HRESULT(0);
            let mut unk: Option<windows::core::IUnknown> = None;
            op.GetActivateResult(&mut hr, &mut unk).map_err(|e| format!("GetActivateResult: {e}"))?;
            hr.ok().map_err(|e| format!("ativação: {e}"))?;
            unk.ok_or("ativação sem resultado")?.cast::<IAudioClient>().map_err(|e| e.to_string())
        }
    }

    pub fn capture(pid: u32, include: bool, stop: Arc<AtomicBool>) -> Result<(), String> {
        if build() < 19041 { return Err("Windows 10 versão 2004 ou mais novo é necessário para o áudio só do jogo".into()); }
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let client = activate(pid, include)?;
            // o loopback por processo não informa o formato (GetMixFormat falha): pede float 48 kHz estéreo e o Windows converte
            let block = CH as u32 * 4;
            let fmt = WAVEFORMATEX { wFormatTag: 3 /* WAVE_FORMAT_IEEE_FLOAT */, nChannels: CH, nSamplesPerSec: RATE, nAvgBytesPerSec: RATE * block, nBlockAlign: block as u16, wBitsPerSample: 32, cbSize: 0 };
            client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                2_000_000 /* 200 ms */, 0, &fmt, None).map_err(|e| format!("Initialize: {e}"))?;
            let ev = CreateEventW(None, false, false, None).map_err(|e| e.to_string())?;
            client.SetEventHandle(ev).map_err(|e| format!("SetEventHandle: {e}"))?;
            let cap: IAudioCaptureClient = client.GetService().map_err(|e| format!("GetService: {e}"))?;
            client.Start().map_err(|e| format!("Start: {e}"))?;
            emit_err(serde_json::json!({ "t": "started", "rate": RATE, "channels": CH }));
            let mut out = std::io::stdout().lock();
            let mut zeros: Vec<u8> = Vec::new();
            'run: while !stop.load(Ordering::SeqCst) {
                // sem som no jogo, o Windows não manda nada: o tempo limite só serve para olhar o "stop"
                if WaitForSingleObject(ev, 200) != WAIT_OBJECT_0 { continue; }
                loop {
                    let n = cap.GetNextPacketSize().map_err(|e| format!("GetNextPacketSize: {e}"))?;
                    if n == 0 { break; }
                    let mut data: *mut u8 = std::ptr::null_mut();
                    let (mut frames, mut flags) = (0u32, 0u32);
                    cap.GetBuffer(&mut data, &mut frames, &mut flags, None, None).map_err(|e| format!("GetBuffer: {e}"))?;
                    let bytes = frames as usize * block as usize;
                    let res = if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                        zeros.resize(bytes, 0); out.write_all(&zeros)
                    } else { out.write_all(std::slice::from_raw_parts(data, bytes)) };
                    let _ = cap.ReleaseBuffer(frames);
                    if res.and_then(|_| out.flush()).is_err() { break 'run; } // o app fechou a leitura
                }
            }
            let _ = client.Stop();
            let _ = CloseHandle(ev);
        }
        Ok(())
    }
}
