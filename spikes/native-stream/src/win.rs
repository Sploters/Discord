//! Windows: Windows Graphics Capture (sem o intervalo mínimo padrão de ~20,8 ms) -> conversão BGRA -> NV12 na GPU
//! (ID3D11VideoProcessor) -> codificador H.264 de hardware do Media Foundation (NVENC/AMF/QuickSync, modo assíncrono,
//! texturas D3D11 direto, sem passar pela CPU) -> RTP.
//! Mensagens no console só em ASCII (o console do PowerShell estraga acentos).
use crate::{rtp::RtpSender, summary, Meter, Opts};
use std::collections::HashMap;
use std::mem::ManuallyDrop;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use windows::core::{factory, Interface, GUID, PWSTR};
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Graphics::Capture::{Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{HMODULE, POINT, RECT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_NV12, DXGI_RATIONAL, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Variant::{VARIANT, VT_BOOL, VT_UI4};
use windows::Win32::Foundation::VARIANT_BOOL;
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

type R<T> = Result<T, String>;
fn e<T>(r: windows::core::Result<T>, what: &str) -> R<T> { r.map_err(|x| format!("{what}: {} (0x{:08X})", x.message(), x.code().0 as u32)) }

const NV12_RING: usize = 8;

struct Encoder { mft: IMFTransform, events: IMFMediaEventGenerator, codec: Option<ICodecAPI>, provides: bool, out_size: u32, name: String }
impl Encoder {
    /// SPS/PPS que alguns codificadores só põem no tipo de saída (e não nos quadros)
    fn seq_header(&self) -> Option<Vec<u8>> { unsafe { let t = self.mft.GetOutputCurrentType(0).ok()?; let mut p: *mut u8 = std::ptr::null_mut(); let mut l = 0u32; t.GetAllocatedBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut p, &mut l).ok()?; let v = std::slice::from_raw_parts(p, l as usize).to_vec(); CoTaskMemFree(Some(p as _)); Some(v) } }
}

fn var_u32(v: u32) -> VARIANT { let mut x = VARIANT::default(); unsafe { let i = &mut *x.Anonymous.Anonymous; i.vt = VT_UI4; i.Anonymous.ulVal = v; } x }
fn var_bool(v: bool) -> VARIANT { let mut x = VARIANT::default(); unsafe { let i = &mut *x.Anonymous.Anonymous; i.vt = VT_BOOL; i.Anonymous.boolVal = VARIANT_BOOL(if v { -1 } else { 0 }); } x }
fn set_u32(c: &ICodecAPI, api: &GUID, v: u32) -> bool { let var = var_u32(v); unsafe { c.SetValue(api, &var).is_ok() } }
fn set_bool(c: &ICodecAPI, api: &GUID, v: bool) -> bool { let var = var_bool(v); unsafe { c.SetValue(api, &var).is_ok() } }


/// Tenta os codificadores de hardware em ordem: primeiro o da mesma placa de vídeo da captura (LUID), depois os outros.
fn make_encoder(device: &ID3D11Device, luid: u64, w: u32, h: u32, fps: u32, kbps: u32) -> R<Encoder> {
    let mut acts: Vec<(IMFActivate, String, bool)> = Vec::new();
    unsafe {
        let inp = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_NV12 };
        let out = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_H264 };
        let mut arr: *mut Option<IMFActivate> = std::ptr::null_mut(); let mut n = 0u32;
        e(MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER, Some(&inp), Some(&out), &mut arr, &mut n), "MFTEnumEx")?;
        if n == 0 || arr.is_null() { return Err("nenhum codificador H.264 de hardware encontrado (placa de video sem NVENC/AMF/QuickSync?)".into()); }
        let list = std::slice::from_raw_parts_mut(arr, n as usize);
        for a in list.iter_mut() {
            if let Some(a) = a.take() {
                let mut p = PWSTR::null(); let mut l = 0u32; let mut name = "?".to_string();
                if a.GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut p, &mut l).is_ok() { name = p.to_string().unwrap_or_default(); CoTaskMemFree(Some(p.0 as _)); }
                let same = a.GetUINT64(&MFT_ENUM_ADAPTER_LUID).map(|x| x == luid).unwrap_or(false);
                acts.push((a, name, same));
            }
        }
        CoTaskMemFree(Some(arr as _));
    }
    eprintln!("  codificadores de hardware: {}", acts.iter().map(|a| format!("{}{}", a.1, if a.2 { " (mesma placa)" } else { "" })).collect::<Vec<_>>().join(" | "));
    acts.sort_by_key(|a| !a.2);
    let mut errs = Vec::new();
    for (a, name, _) in acts {
        match init_encoder(device, &a, &name, w, h, fps, kbps) { Ok(x) => return Ok(x), Err(x) => { eprintln!("  {name}: {x}"); errs.push(format!("{name}: {x}")); } }
    }
    Err(format!("nenhum codificador aceitou a configuracao: {}", errs.join(" / ")))
}

fn init_encoder(device: &ID3D11Device, act: &IMFActivate, name: &str, w: u32, h: u32, fps: u32, kbps: u32) -> R<Encoder> {
    let name = name.to_string();
    unsafe {
        let mft: IMFTransform = e(act.ActivateObject(), "ActivateObject")?;

        let attrs = e(mft.GetAttributes(), "GetAttributes")?;
        if attrs.GetUINT32(&MF_TRANSFORM_ASYNC).unwrap_or(0) == 0 { return Err(format!("o codificador '{name}' nao e assincrono (inesperado para hardware)")); }
        e(attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1), "ASYNC_UNLOCK")?;
        let _ = attrs.SetUINT32(&MF_LOW_LATENCY, 1);

        let mut token = 0u32; let mut mgr: Option<IMFDXGIDeviceManager> = None;
        e(MFCreateDXGIDeviceManager(&mut token, &mut mgr), "MFCreateDXGIDeviceManager")?;
        let mgr = mgr.ok_or("sem device manager")?;
        e(mgr.ResetDevice(device, token), "ResetDevice")?;
        e(mft.ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, mgr.as_raw() as usize), "SET_D3D_MANAGER")?;
        std::mem::forget(mgr.clone()); // o codificador guarda a referência

        let codec: Option<ICodecAPI> = mft.cast().ok();
        if let Some(c) = &codec { // antes dos tipos: alguns drivers só aceitam assim
            set_u32(c, &CODECAPI_AVEncCommonRateControlMode, eAVEncCommonRateControlMode_CBR.0 as u32);
            set_u32(c, &CODECAPI_AVEncCommonMeanBitRate, kbps * 1000);
            set_bool(c, &CODECAPI_AVLowLatencyMode, true);
            set_u32(c, &CODECAPI_AVEncMPVGOPSize, fps * 2);
            set_u32(c, &CODECAPI_AVEncMPVDefaultBPictureCount, 0);
        }

        let ot = e(MFCreateMediaType(), "MFCreateMediaType")?;
        e(ot.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video), "out major")?;
        e(ot.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264), "out subtype")?;
        e(ot.SetUINT32(&MF_MT_AVG_BITRATE, kbps * 1000), "out bitrate")?;
        e(ot.SetUINT64(&MF_MT_FRAME_SIZE, ((w as u64) << 32) | h as u64), "out size")?;
        e(ot.SetUINT64(&MF_MT_FRAME_RATE, ((fps as u64) << 32) | 1), "out rate")?;
        e(ot.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32), "out interlace")?;
        e(ot.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1), "out par")?;
        e(ot.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Base.0 as u32), "out profile")?;
        e(mft.SetOutputType(0, &ot, 0), "SetOutputType (H.264 Baseline)")?;

        let mut set = false;
        for i in 0..32 {
            let Ok(t) = mft.GetInputAvailableType(0, i) else { break };
            if t.GetGUID(&MF_MT_SUBTYPE).ok() != Some(MFVideoFormat_NV12) { continue; }
            let _ = t.SetUINT64(&MF_MT_FRAME_SIZE, ((w as u64) << 32) | h as u64);
            let _ = t.SetUINT64(&MF_MT_FRAME_RATE, ((fps as u64) << 32) | 1);
            if mft.SetInputType(0, &t, 0).is_ok() { set = true; break; }
        }
        if !set {
            let it = e(MFCreateMediaType(), "MFCreateMediaType")?;
            let _ = it.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video); let _ = it.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12);
            let _ = it.SetUINT64(&MF_MT_FRAME_SIZE, ((w as u64) << 32) | h as u64); let _ = it.SetUINT64(&MF_MT_FRAME_RATE, ((fps as u64) << 32) | 1);
            let _ = it.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32);
            e(mft.SetInputType(0, &it, 0), "SetInputType (NV12)")?;
        }
        if let Some(c) = &codec { // de novo depois dos tipos (outros drivers só aceitam assim)
            set_u32(c, &CODECAPI_AVEncCommonRateControlMode, eAVEncCommonRateControlMode_CBR.0 as u32);
            set_u32(c, &CODECAPI_AVEncCommonMeanBitRate, kbps * 1000);
            set_bool(c, &CODECAPI_AVLowLatencyMode, true);
        }
        let info = e(mft.GetOutputStreamInfo(0), "GetOutputStreamInfo")?;
        let provides = info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES.0 as u32) != 0;
        let events: IMFMediaEventGenerator = e(mft.cast(), "IMFMediaEventGenerator")?;
        e(mft.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0), "FLUSH")?;
        e(mft.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0), "BEGIN_STREAMING")?;
        e(mft.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0), "START_OF_STREAM")?;
        Ok(Encoder { mft, events, codec, provides, out_size: info.cbSize.max(1 << 20), name })
    }
}

impl Encoder {
    /// Tira um quadro pronto do codificador (Annex-B) e o carimbo de tempo (100 ns).
    fn take_output(&self) -> R<Option<(Vec<u8>, i64)>> {
        unsafe {
            let sample = if self.provides { None } else {
                let s = e(MFCreateSample(), "MFCreateSample")?; let b = e(MFCreateMemoryBuffer(self.out_size), "MFCreateMemoryBuffer")?; e(s.AddBuffer(&b), "AddBuffer")?; Some(s)
            };
            let mut out = [MFT_OUTPUT_DATA_BUFFER { dwStreamID: 0, pSample: ManuallyDrop::new(sample), dwStatus: 0, pEvents: ManuallyDrop::new(None) }];
            let mut status = 0u32;
            let r = self.mft.ProcessOutput(0, &mut out, &mut status);
            let sample = ManuallyDrop::take(&mut out[0].pSample); let _ev = ManuallyDrop::take(&mut out[0].pEvents);
            match r {
                Ok(()) => {}
                Err(x) if x.code() == MF_E_TRANSFORM_STREAM_CHANGE => { // o codificador mudou o formato de saída: aceita o novo
                    let t = e(self.mft.GetOutputAvailableType(0, 0), "GetOutputAvailableType")?; e(self.mft.SetOutputType(0, &t, 0), "SetOutputType (mudanca)")?; return Ok(None);
                }
                Err(x) if x.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(None),
                Err(x) => return Err(format!("ProcessOutput: {} (0x{:08X})", x.message(), x.code().0 as u32)),
            }
            let Some(s) = sample else { return Ok(None) };
            let t = s.GetSampleTime().unwrap_or(0);
            let b = e(s.ConvertToContiguousBuffer(), "ConvertToContiguousBuffer")?;
            let mut p: *mut u8 = std::ptr::null_mut(); let mut len = 0u32;
            e(b.Lock(&mut p, None, Some(&mut len)), "Lock")?;
            let v = std::slice::from_raw_parts(p, len as usize).to_vec();
            let _ = b.Unlock();
            Ok(Some((v, t)))
        }
    }
    fn force_key(&self) { if let Some(c) = &self.codec { set_u32(c, &CODECAPI_AVEncVideoForceKeyFrame, 1); } }
}

pub fn run(o: &Opts) -> R<()> {
    unsafe { let _ = RoInitialize(RO_INIT_MULTITHREADED); e(MFStartup(MF_VERSION, MFSTARTUP_FULL), "MFStartup")?; }

    // GPU
    let mut device: Option<ID3D11Device> = None; let mut ctx: Option<ID3D11DeviceContext> = None;
    unsafe { e(D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut device), None, Some(&mut ctx)), "D3D11CreateDevice")?; }
    let (device, ctx) = (device.ok_or("sem D3D11")?, ctx.ok_or("sem contexto")?);
    if let Ok(mt) = device.cast::<ID3D11Multithread>() { unsafe { let _ = mt.SetMultithreadProtected(true); } }
    let dxgi: IDXGIDevice = e(device.cast(), "IDXGIDevice")?;
    let (luid, gpu) = unsafe { dxgi.GetAdapter().and_then(|a| a.GetDesc()).map(|d| ((((d.AdapterLuid.HighPart as u32) as u64) << 32) | d.AdapterLuid.LowPart as u64, String::from_utf16_lossy(&d.Description).trim_end_matches('\0').to_string())).unwrap_or((0, "?".into())) };
    eprintln!("  placa de video: {gpu}");
    let d3d: IDirect3DDevice = e(unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }.and_then(|x| x.cast()), "IDirect3DDevice")?;

    // captura: monitor principal, sem intervalo mínimo
    let hmon = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) };
    let interop = e(factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>(), "interop")?;
    let item: GraphicsCaptureItem = e(unsafe { interop.CreateForMonitor(hmon) }, "CreateForMonitor")?;
    let size = e(item.Size(), "Size")?;
    let (cw, ch) = (size.Width as u32, size.Height as u32);
    let oh = (o.height.min(ch) / 2) * 2; let ow = ((cw as u64 * oh as u64 / ch as u64) as u32 / 2) * 2;
    eprintln!("  tela {}x{} -> envio {}x{} a {} fps", cw, ch, ow, oh, o.fps);
    let pool = e(Direct3D11CaptureFramePool::CreateFreeThreaded(&d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 3, size), "FramePool")?;
    let session = e(pool.CreateCaptureSession(&item), "CaptureSession")?;
    let _ = session.SetIsCursorCaptureEnabled(true);
    let _ = session.SetIsBorderRequired(false);
    let iv_note = match session.SetMinUpdateInterval(TimeSpan { Duration: 0 }) { Ok(_) => "0 ms".to_string(), Err(x) => format!("falhou ({})", x.message()) };
    eprintln!("  intervalo minimo da captura: {iv_note}");
    let signal = Arc::new((Mutex::new(false), Condvar::new()));
    let sig2 = signal.clone();
    e(pool.FrameArrived(&TypedEventHandler::new(move |_, _| { let (m, c) = &*sig2; *m.lock().unwrap() = true; c.notify_one(); Ok(()) })), "FrameArrived")?;

    // conversão BGRA -> NV12 (com escala) na GPU
    let vdev: ID3D11VideoDevice = e(device.cast(), "ID3D11VideoDevice")?;
    let vctx: ID3D11VideoContext = e(ctx.cast(), "ID3D11VideoContext")?;
    let rate = DXGI_RATIONAL { Numerator: o.fps, Denominator: 1 };
    let cdesc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC { InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, InputFrameRate: rate, InputWidth: cw, InputHeight: ch, OutputFrameRate: rate, OutputWidth: ow, OutputHeight: oh, Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED };
    let venum = e(unsafe { vdev.CreateVideoProcessorEnumerator(&cdesc) }, "VideoProcessorEnumerator")?;
    let vproc = e(unsafe { vdev.CreateVideoProcessor(&venum, 0) }, "VideoProcessor")?;
    unsafe {
        // entrada RGB 0-255; saída YCbCr BT.709 16-235 (o que o navegador espera de H.264 sem metadados de cor)
        vctx.VideoProcessorSetStreamColorSpace(&vproc, 0, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 0 });
        vctx.VideoProcessorSetOutputColorSpace(&vproc, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: (1 << 2) | (1 << 4) });
        vctx.VideoProcessorSetStreamFrameFormat(&vproc, 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
        vctx.VideoProcessorSetStreamSourceRect(&vproc, 0, true, Some(&RECT { left: 0, top: 0, right: cw as i32, bottom: ch as i32 }));
        vctx.VideoProcessorSetStreamDestRect(&vproc, 0, true, Some(&RECT { left: 0, top: 0, right: ow as i32, bottom: oh as i32 }));
        vctx.VideoProcessorSetOutputTargetRect(&vproc, true, Some(&RECT { left: 0, top: 0, right: ow as i32, bottom: oh as i32 }));
        vctx.VideoProcessorSetStreamAutoProcessingMode(&vproc, 0, false);
    }
    let mut ring: Vec<(ID3D11Texture2D, ID3D11VideoProcessorOutputView)> = Vec::new();
    for _ in 0..NV12_RING {
        let td = D3D11_TEXTURE2D_DESC { Width: ow, Height: oh, MipLevels: 1, ArraySize: 1, Format: DXGI_FORMAT_NV12, SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 }, Usage: D3D11_USAGE_DEFAULT, BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32, CPUAccessFlags: 0, MiscFlags: 0 };
        let mut t: Option<ID3D11Texture2D> = None;
        let td2 = D3D11_TEXTURE2D_DESC { BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_VIDEO_ENCODER.0) as u32, ..td };
        if unsafe { device.CreateTexture2D(&td2, None, Some(&mut t)) }.is_err() { e(unsafe { device.CreateTexture2D(&td, None, Some(&mut t)) }, "textura NV12")?; }
        let t = t.unwrap();
        let od = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC { ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D, Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 } } };
        let mut ov: Option<ID3D11VideoProcessorOutputView> = None;
        e(unsafe { vdev.CreateVideoProcessorOutputView(&t, &venum, &od, Some(&mut ov)) }, "OutputView")?;
        ring.push((t, ov.unwrap()));
    }
    let ivd = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC { FourCC: 0, ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D, Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 } } };

    let enc = make_encoder(&device, luid, ow, oh, o.fps, o.kbps)?;
    eprintln!("  codificador em uso: {}", enc.name);
    let mut tx = RtpSender::new(&o.host, o.port, o.ssrc, o.pt).map_err(|x| format!("UDP: {x}"))?;
    if let Some(h) = enc.seq_header() { tx.set_params(&h); }
    let mut inputs = 0u64;

    let mut m = Meter::new(o.secs);
    let iv = 1.0 / o.fps as f64;
    let (mut next_due, mut need, mut slot) = (0.0f64, 0u32, 0usize);
    let mut t0: Option<i64> = None;
    let mut inflight: HashMap<i64, Instant> = HashMap::new();
    let (mut blt_err, mut in_err) = (None::<String>, None::<String>);
    e(session.StartCapture(), "StartCapture")?;
    eprintln!("  transmitindo... (nao feche esta janela)");

    while !m.done() {
        // eventos do codificador (sem bloquear)
        loop {
            let ev = match unsafe { enc.events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } { Ok(ev) => ev, Err(_) => break };
            let typ = unsafe { ev.GetType() }.unwrap_or(0);
            if typ == METransformNeedInput.0 as u32 { need += 1; }
            else if typ == METransformHaveOutput.0 as u32 {
                if let Some((data, t)) = enc.take_output()? {
                    if let Some(at) = inflight.remove(&t) { m.enc_ms.push(at.elapsed().as_secs_f64() * 1000.0); }
                    let ts = ((t - t0.unwrap_or(0)).max(0) as u64 * 9 / 1000) as u32; // 100 ns -> 90 kHz
                    if !tx.has_params() { if let Some(h) = enc.seq_header() { tx.set_params(&h); } }
                    let before = tx.stats.bytes; tx.send_frame(&data, ts); m.sent((tx.stats.bytes - before) as usize);
                }
            } else if typ == METransformDrainComplete.0 as u32 { break; }
            else if typ == MEError.0 as u32 { return Err(format!("o codificador avisou erro: 0x{:08X}", unsafe { ev.GetStatus() }.map(|h| h.0 as u32).unwrap_or(0))); }
        }
        tx.poll_rtcp();
        if tx.want_key { tx.want_key = false; enc.force_key(); }
        m.tick(&tx.stats);

        // quadro novo da tela? (pega só o mais recente)
        let mut latest: Option<Direct3D11CaptureFrame> = None;
        while let Ok(f) = pool.TryGetNextFrame() { m.captured(); latest = Some(f); }
        let Some(frame) = latest else {
            let (mx, cv) = &*signal; let g = mx.lock().unwrap();
            let (mut g, _) = cv.wait_timeout(g, Duration::from_millis(1)).unwrap(); *g = false;
            continue;
        };
        let now = m.elapsed();
        if now + iv * 0.3 < next_due { continue; } // acima do fps pedido: descarta
        next_due = if next_due < now - iv { now + iv } else { next_due + iv };
        if need == 0 { m.skipped_busy += 1; continue; } // codificador ainda ocupado
        let st = frame.SystemRelativeTime().map(|t| t.Duration).unwrap_or(0);
        if t0.is_none() { t0 = Some(st); }
        let Ok(surf) = frame.Surface() else { continue };
        let Ok(acc) = surf.cast::<IDirect3DDxgiInterfaceAccess>() else { continue };
        let Ok(tex) = (unsafe { acc.GetInterface::<ID3D11Texture2D>() }) else { continue };
        let (dst, ov) = &ring[slot % NV12_RING]; slot += 1;
        let mut inview: Option<ID3D11VideoProcessorInputView> = None;
        if let Err(x) = unsafe { vdev.CreateVideoProcessorInputView(&tex, &venum, &ivd, Some(&mut inview)) } { blt_err.get_or_insert(format!("InputView: {}", x.message())); continue; }
        let mut stream = D3D11_VIDEO_PROCESSOR_STREAM { Enable: true.into(), pInputSurface: ManuallyDrop::new(inview), ..Default::default() };
        let r = unsafe { vctx.VideoProcessorBlt(&vproc, ov, 0, std::slice::from_ref(&stream)) };
        unsafe { ManuallyDrop::drop(&mut stream.pInputSurface); }
        drop(frame);
        if let Err(x) = r { blt_err.get_or_insert(format!("VideoProcessorBlt: {}", x.message())); continue; }
        // amostra com a textura NV12 (fica na GPU)
        let res: windows::core::Result<()> = (|| unsafe {
            let buf = MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, dst, 0, false)?;
            if let Ok(b2) = buf.cast::<IMF2DBuffer>() { if let Ok(l) = b2.GetContiguousLength() { let _ = buf.SetCurrentLength(l); } }
            let s = MFCreateSample()?; s.AddBuffer(&buf)?;
            let t = st; s.SetSampleTime(t)?; s.SetSampleDuration(10_000_000 / o.fps as i64)?;
            inflight.insert(t, Instant::now());
            enc.mft.ProcessInput(0, &s, 0)
        })();
        match res { Ok(()) => { need -= 1; inputs += 1; } Err(x) => { in_err.get_or_insert(format!("ProcessInput: {} (0x{:08X})", x.message(), x.code().0 as u32)); } }
        if inflight.len() > 512 { inflight.clear(); }
        if inputs > 60 && tx.stats.frames == 0 { return Err(format!("nenhum quadro saiu do codificador em 5 s. {} {}", blt_err.unwrap_or_default(), in_err.unwrap_or_default())); }
    }
    let _ = session.Close(); let _ = pool.Close();
    unsafe { let _ = enc.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0); }
    let extra = format!(",\"encoder\":{:?},\"size\":\"{}x{}\",\"screen\":\"{}x{}\",\"minUpdateInterval\":{:?},\"bltError\":{:?},\"inputError\":{:?}", enc.name, ow, oh, cw, ch, iv_note, blt_err.unwrap_or_default(), in_err.unwrap_or_default());
    summary(&m, &tx.stats, &extra);
    Ok(())
}
