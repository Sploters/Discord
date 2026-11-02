//! Spike A — Windows Graphics Capture: quantos quadros por segundo o capturador NATIVO entrega?
//! Só captura e descarta (sem codificar). Mede pelo evento FrameArrived e pelo SystemRelativeTime de cada quadro.
//! Uso: wgc-capture-spike [--secs 30] [--min-interval-ms default|0|1|2|4|8] [--cursor 1|0] [--border 1|0] [--buffers 4]
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use windows::core::{factory, Interface};
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{HMODULE, POINT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{D3D11CreateDevice, ID3D11Device, ID3D11Texture2D, D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::System::WinRT::Direct3D11::IDirect3DDxgiInterfaceAccess;
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
use windows::Win32::System::WinRT::Direct3D11::CreateDirect3D11DeviceFromDXGIDevice;
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

fn arg(name: &str, default: &str) -> String {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1)).cloned().unwrap_or_else(|| default.to_string())
}

fn pct(v: &[f64], p: f64) -> f64 {
    if v.is_empty() { return 0.0; }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    s[((s.len() as f64 * p) as usize).min(s.len() - 1)]
}

fn main() -> windows::core::Result<()> {
    let secs: u64 = arg("--secs", "30").parse().unwrap_or(30);
    let min_iv = arg("--min-interval-ms", "default");
    let cursor = arg("--cursor", "1") == "1";
    let border = arg("--border", "1") == "1";
    let buffers: i32 = arg("--buffers", "4").parse().unwrap_or(4);

    unsafe { RoInitialize(RO_INIT_MULTITHREADED)?; }

    if arg("--api", "wgc") == "dxgi" { return dxgi_main(secs); }

    // dispositivo D3D11 (GPU) e o item de captura = monitor principal
    let mut device: Option<ID3D11Device> = None;
    unsafe {
        D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut device), None, None)?;
    }
    let device = device.expect("sem dispositivo D3D11");
    let dxgi: IDXGIDevice = device.cast()?;
    let d3d: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
    let hmon = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) };
    let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
    let item: GraphicsCaptureItem = unsafe { interop.CreateForMonitor(hmon)? };
    let size = item.Size()?;

    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, buffers, size)?;
    let session = pool.CreateCaptureSession(&item)?;
    let _ = session.SetIsCursorCaptureEnabled(cursor);
    let mut border_note = "padrão".to_string();
    if !border { border_note = match session.SetIsBorderRequired(false) { Ok(_) => "removida".into(), Err(e) => format!("não removível ({})", e.message()) }; }
    let mut iv_note = "padrão do sistema".to_string();
    if min_iv != "default" {
        let ms: f64 = min_iv.parse().unwrap_or(0.0);
        let t = TimeSpan { Duration: (ms * 10_000.0) as i64 }; // unidades de 100 ns
        iv_note = match session.SetMinUpdateInterval(t) { Ok(_) => format!("{ms} ms"), Err(e) => format!("falhou ({})", e.message()) };
    }

    // cada quadro: instante local e carimbo do sistema (SystemRelativeTime, 100 ns)
    let verify = arg("--verify", "0") == "1";
    // leitura do número do quadro gravado pela animação (32 células de 8x8 px no canto superior esquerdo)
    let staging: Option<ID3D11Texture2D> = if verify {
        let desc = D3D11_TEXTURE2D_DESC { Width: 256, Height: 8, MipLevels: 1, ArraySize: 1, Format: DXGI_FORMAT_B8G8R8A8_UNORM, SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 }, Usage: D3D11_USAGE_STAGING, BindFlags: 0, CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32, MiscFlags: 0 };
        let mut t: Option<ID3D11Texture2D> = None;
        unsafe { device.CreateTexture2D(&desc, None, Some(&mut t))?; }
        t
    } else { None };
    let ctx = unsafe { device.GetImmediateContext()? };
    let ctx = Arc::new(Mutex::new(ctx));
    let frames: Arc<Mutex<Vec<(Instant, i64, u32)>>> = Arc::new(Mutex::new(Vec::with_capacity(secs as usize * 300)));
    let sink = frames.clone();
    pool.FrameArrived(&TypedEventHandler::new(move |p: windows::core::Ref<Direct3D11CaptureFramePool>, _| {
        if let Some(p) = p.as_ref() {
            while let Ok(f) = p.TryGetNextFrame() {
                let st = f.SystemRelativeTime().map(|t| t.Duration).unwrap_or(0);
                let mut id: u32 = 0;
                if let Some(stg) = &staging {
                    if let Ok(surf) = f.Surface() {
                        if let Ok(acc) = surf.cast::<IDirect3DDxgiInterfaceAccess>() {
                            if let Ok(tex) = unsafe { acc.GetInterface::<ID3D11Texture2D>() } {
                                let c = ctx.lock().unwrap();
                                let bx = D3D11_BOX { left: 0, top: 0, front: 0, right: 256, bottom: 8, back: 1 };
                                unsafe { c.CopySubresourceRegion(stg, 0, 0, 0, 0, &tex, 0, Some(&bx)); }
                                let mut m = D3D11_MAPPED_SUBRESOURCE::default();
                                let mr = unsafe { c.Map(stg, 0, D3D11_MAP_READ, 0, Some(&mut m)) };
                                if let Err(e) = &mr { if std::env::var("SPIKE_DEBUG").is_ok() { eprintln!("Map falhou: {e}"); } }
                                if mr.is_ok() {
                                    let row = unsafe { std::slice::from_raw_parts((m.pData as *const u8).add(4 * m.RowPitch as usize), 256 * 4) };
                                    for b in 0..32usize { if row[(b * 8 + 4) * 4 + 1] > 128 { id |= 1 << b; } }
                                    if std::env::var("SPIKE_DEBUG").is_ok() { static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0); if N.fetch_add(1, std::sync::atomic::Ordering::Relaxed) < 3 { let g: Vec<u8> = (0..32usize).map(|b| row[(b * 8 + 4) * 4 + 1]).collect(); eprintln!("pitch={} G por celula={:?} primeiros px={:?}", m.RowPitch, g, &row[0..16]); } }
                                    unsafe { c.Unmap(stg, 0); }
                                }
                            }
                        }
                    }
                }
                if std::env::var("SPIKE_DEBUG").is_ok() && id == 0 { eprintln!("id=0 (ou leitura falhou)"); }
                sink.lock().unwrap().push((Instant::now(), st, id));
            }
        }
        Ok(())
    }))?;

    let start = Instant::now();
    session.StartCapture()?;
    std::thread::sleep(Duration::from_secs(secs + 2));
    session.Close()?;
    pool.Close()?;

    // janela de medição: descarta 2 s de aquecimento
    let all = frames.lock().unwrap().clone();
    let w: Vec<&(Instant, i64, u32)> = all.iter().filter(|f| f.0.duration_since(start).as_secs_f64() >= 2.0).collect();
    let dur = if w.len() > 1 { w.last().unwrap().0.duration_since(w[0].0).as_secs_f64() } else { 0.0 };
    let mean = if dur > 0.0 { (w.len() as f64 - 1.0) / dur } else { 0.0 };
    // série por segundo
    let mut per = vec![0u32; secs as usize];
    for f in &w { let s = (f.0.duration_since(start).as_secs_f64() - 2.0) as usize; if s < per.len() { per[s] += 1; } }
    let series: Vec<f64> = per.iter().map(|&x| x as f64).collect();
    // intervalos pelo carimbo do sistema (ms)
    let iv: Vec<f64> = w.windows(2).map(|p| (p[1].1 - p[0].1) as f64 / 10_000.0).collect();
    // conteúdo: quadros únicos, repetidos e saltos (quadros da fonte que a captura nunca entregou)
    let (mut uniq, mut dup, mut span) = (0usize, 0usize, 0i64);
    if verify && w.len() > 1 {
        let mut prev = w[0].2; uniq = 1;
        for f in &w[1..] { if f.2 == prev { dup += 1; } else { uniq += 1; } prev = f.2; }
        span = w[w.len() - 1].2 as i64 - w[0].2 as i64;
    }
    let uniq_fps = if dur > 0.0 { uniq as f64 / dur } else { 0.0 };
    let src_fps = if dur > 0.0 { span as f64 / dur } else { 0.0 };
    println!("{{\"verify\":{},\"uniqueFps\":{:.1},\"duplicateFrames\":{},\"sourceFramesSpanFps\":{:.1}}}", verify, uniq_fps, dup, src_fps);
    println!(
        "{{\"api\":\"WGC\",\"size\":\"{}x{}\",\"secs\":{},\"minUpdateInterval\":\"{}\",\"cursor\":{},\"border\":\"{}\",\"buffers\":{},\"frames\":{},\"meanFps\":{:.1},\"perSecMin\":{:.0},\"perSecP5\":{:.0},\"perSecMedian\":{:.0},\"perSecMax\":{:.0},\"ivMedMs\":{:.2},\"ivP95Ms\":{:.2},\"ivMaxMs\":{:.2},\"series\":{:?}}}",
        size.Width, size.Height, secs, iv_note, cursor, border_note, buffers, w.len(), mean,
        series.iter().cloned().fold(f64::MAX, f64::min), pct(&series, 0.05), pct(&series, 0.5), series.iter().cloned().fold(0.0, f64::max),
        pct(&iv, 0.5), pct(&iv, 0.95), iv.iter().cloned().fold(0.0, f64::max), per
    );
    Ok(())
}

/// Comparação: DXGI Desktop Duplication (AcquireNextFrame). Conta só quadros com apresentação nova (LastPresentTime != 0).
fn dxgi_main(secs: u64) -> windows::core::Result<()> {
    use windows::Win32::Graphics::Dxgi::{IDXGIOutput1, DXGI_OUTDUPL_FRAME_INFO, IDXGIResource};
    let mut device: Option<ID3D11Device> = None;
    unsafe { D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut device), None, None)?; }
    let device = device.expect("sem dispositivo D3D11");
    let dxgi: IDXGIDevice = device.cast()?;
    let adapter = unsafe { dxgi.GetAdapter()? };
    let output = unsafe { adapter.EnumOutputs(0)? };
    let output1: IDXGIOutput1 = output.cast()?;
    let dup = unsafe { output1.DuplicateOutput(&device)? };
    let start = Instant::now();
    let mut times: Vec<f64> = Vec::new();
    let mut acc_total: u64 = 0;
    while start.elapsed().as_secs() < secs + 2 {
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut res: Option<IDXGIResource> = None;
        match unsafe { dup.AcquireNextFrame(100, &mut info, &mut res) } {
            Ok(_) => {
                if info.LastPresentTime != 0 { times.push(start.elapsed().as_secs_f64()); acc_total += info.AccumulatedFrames as u64; }
                drop(res);
                unsafe { dup.ReleaseFrame()?; }
            }
            Err(e) if e.code() == windows::Win32::Graphics::Dxgi::DXGI_ERROR_WAIT_TIMEOUT => {}
            Err(e) => return Err(e),
        }
    }
    let w: Vec<f64> = times.into_iter().filter(|t| *t >= 2.0).collect();
    let dur = if w.len() > 1 { w[w.len() - 1] - w[0] } else { 0.0 };
    let mean = if dur > 0.0 { (w.len() as f64 - 1.0) / dur } else { 0.0 };
    let mut per = vec![0u32; secs as usize];
    for t in &w { let i = (*t - 2.0) as usize; if i < per.len() { per[i] += 1; } }
    let series: Vec<f64> = per.iter().map(|&x| x as f64).collect();
    let iv: Vec<f64> = w.windows(2).map(|p| (p[1] - p[0]) * 1000.0).collect();
    println!(
        "{{\"api\":\"DXGI-DD\",\"size\":\"?\",\"secs\":{},\"minUpdateInterval\":\"n/a\",\"cursor\":true,\"border\":\"n/a\",\"buffers\":0,\"frames\":{},\"meanFps\":{:.1},\"perSecMin\":{:.0},\"perSecP5\":{:.0},\"perSecMedian\":{:.0},\"perSecMax\":{:.0},\"ivMedMs\":{:.2},\"ivP95Ms\":{:.2},\"ivMaxMs\":{:.2},\"series\":{:?},\"accumulatedFramesTotal\":{}}}",
        secs, w.len(), mean,
        series.iter().cloned().fold(f64::MAX, f64::min), pct(&series, 0.05), pct(&series, 0.5), series.iter().cloned().fold(0.0, f64::max),
        pct(&iv, 0.5), pct(&iv, 0.95), iv.iter().cloned().fold(0.0, f64::max), per, acc_total
    );
    Ok(())
}
