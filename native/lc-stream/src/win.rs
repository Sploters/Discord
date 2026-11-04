//! Windows: Windows Graphics Capture (sem o intervalo mínimo padrão de ~20,8 ms) -> conversão BGRA -> NV12 na GPU
//! (ID3D11VideoProcessor) -> codificador H.264 de hardware do Media Foundation (NVENC/AMF/QuickSync, modo assíncrono,
//! texturas D3D11 direto, sem passar pela CPU) -> RTP.
//! Mensagens no console só em ASCII (o console do PowerShell estraga acentos).
use crate::{emit, sender, summary, Layer, Meter, Opts, Source};
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashMap;
use std::mem::ManuallyDrop;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use windows::core::{factory, Interface, GUID, PWSTR};
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Graphics::Capture::{Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{HMODULE, HWND, POINT, RECT};
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
fn make_encoder(device: &ID3D11Device, luid: u64, w: u32, h: u32, fps: u32, kbps: u32, verbose: bool) -> R<Encoder> {
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
    if verbose { eprintln!("  codificadores de hardware: {}", acts.iter().map(|a| format!("{}{}", a.1, if a.2 { " (mesma placa)" } else { "" })).collect::<Vec<_>>().join(" | ")); }
    acts.sort_by_key(|a| !a.2);
    let mut errs = Vec::new();
    for (a, name, _) in acts {
        match init_encoder(device, &a, &name, w, h, fps, kbps) { Ok(x) => return Ok(x), Err(x) => { if verbose { eprintln!("  {name}: {x}"); } errs.push(format!("{name}: {x}")); } }
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

/// Para o app: há codificador H.264 de hardware? (não abre captura)
pub fn probe() -> serde_json::Value {
    unsafe {
        if MFStartup(MF_VERSION, MFSTARTUP_FULL).is_err() { return serde_json::json!({ "ok": false, "error": "Media Foundation indisponivel" }); }
        let inp = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_NV12 };
        let out = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_H264 };
        let mut arr: *mut Option<IMFActivate> = std::ptr::null_mut(); let mut n = 0u32;
        let mut names = Vec::new();
        if MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER, Some(&inp), Some(&out), &mut arr, &mut n).is_ok() && !arr.is_null() {
            for a in std::slice::from_raw_parts_mut(arr, n as usize).iter_mut() {
                if let Some(a) = a.take() { let mut p = PWSTR::null(); let mut l = 0u32; if a.GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut p, &mut l).is_ok() { names.push(p.to_string().unwrap_or_default()); CoTaskMemFree(Some(p.0 as _)); } }
            }
            CoTaskMemFree(Some(arr as _));
        }
        let wgc = GraphicsCaptureSession::IsSupported().unwrap_or(false);
        serde_json::json!({ "ok": !names.is_empty() && wgc, "encoders": names, "wgc": wgc })
    }
}

/// Retângulo de destino que cabe em (ow, oh) mantendo a proporção de (w, h), centralizado.
fn fit(w: u32, h: u32, ow: u32, oh: u32) -> RECT {
    let (w, h) = (w.max(1) as f64, h.max(1) as f64);
    let s = (ow as f64 / w).min(oh as f64 / h);
    let (dw, dh) = ((w * s).round() as i32 & !1, (h * s).round() as i32 & !1);
    let (x, y) = ((ow as i32 - dw) / 2 & !1, (oh as i32 - dh) / 2 & !1);
    RECT { left: x, top: y, right: x + dw, bottom: y + dh }
}

/// Uma camada: conversor (escala + NV12) e codificador próprios, ritmo próprio.
struct WinLayer {
    enc: Encoder, vproc: ID3D11VideoProcessor, venum: ID3D11VideoProcessorEnumerator,
    ring: Vec<(ID3D11Texture2D, ID3D11VideoProcessorOutputView)>, ow: u32, oh: u32, fps: u32,
    need: u32, next_due: f64, slot: usize, last_slot: Option<usize>, last_input: f64, last_st: i64,
    inflight: HashMap<i64, Instant>, inputs: u64,
}

fn make_layer(device: &ID3D11Device, vdev: &ID3D11VideoDevice, vctx: &ID3D11VideoContext, luid: u64, cw: u32, ch: u32, l: &Layer, verbose: bool) -> R<WinLayer> {
    let oh = (l.height.min(ch) / 2) * 2; let ow = ((cw as u64 * oh as u64 / ch as u64) as u32 / 2 * 2).max(2);
    let rate = DXGI_RATIONAL { Numerator: l.fps, Denominator: 1 };
    // o enumerador aceita entradas de outros tamanhos (a janela pode crescer): declara um teto generoso
    let cdesc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC { InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, InputFrameRate: rate, InputWidth: cw.max(3840), InputHeight: ch.max(2160), OutputFrameRate: rate, OutputWidth: ow, OutputHeight: oh, Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED };
    let venum = e(unsafe { vdev.CreateVideoProcessorEnumerator(&cdesc) }, "VideoProcessorEnumerator")?;
    let vproc = e(unsafe { vdev.CreateVideoProcessor(&venum, 0) }, "VideoProcessor")?;
    unsafe {
        // entrada RGB 0-255; saída YCbCr BT.709 16-235 (o que o navegador espera de H.264 sem metadados de cor)
        vctx.VideoProcessorSetStreamColorSpace(&vproc, 0, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 0 });
        vctx.VideoProcessorSetOutputColorSpace(&vproc, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: (1 << 2) | (1 << 4) });
        vctx.VideoProcessorSetStreamFrameFormat(&vproc, 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
        vctx.VideoProcessorSetOutputTargetRect(&vproc, true, Some(&RECT { left: 0, top: 0, right: ow as i32, bottom: oh as i32 }));
        vctx.VideoProcessorSetOutputBackgroundColor(&vproc, false, &D3D11_VIDEO_COLOR { Anonymous: D3D11_VIDEO_COLOR_0 { RGBA: D3D11_VIDEO_COLOR_RGBA { R: 0.0, G: 0.0, B: 0.0, A: 1.0 } } });
        vctx.VideoProcessorSetStreamAutoProcessingMode(&vproc, 0, false);
    }
    let mut ring = Vec::new();
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
    let enc = make_encoder(device, luid, ow, oh, l.fps, l.kbps, verbose)?;
    Ok(WinLayer { enc, vproc, venum, ring, ow, oh, fps: l.fps, need: 0, next_due: 0.0, slot: 0, last_slot: None, last_input: 0.0, last_st: 0, inflight: HashMap::new(), inputs: 0 })
}

impl WinLayer {
    fn set_rects(&self, vctx: &ID3D11VideoContext, w: u32, h: u32) { unsafe {
        vctx.VideoProcessorSetStreamSourceRect(&self.vproc, 0, true, Some(&RECT { left: 0, top: 0, right: w as i32, bottom: h as i32 }));
        vctx.VideoProcessorSetStreamDestRect(&self.vproc, 0, true, Some(&fit(w, h, self.ow, self.oh)));
    } }
    /// entrega uma textura NV12 ao codificador
    fn feed(&mut self, slot: usize, t: i64) -> windows::core::Result<()> { unsafe {
        let buf = MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, &self.ring[slot].0, 0, false)?;
        if let Ok(b2) = buf.cast::<IMF2DBuffer>() { if let Ok(l) = b2.GetContiguousLength() { let _ = buf.SetCurrentLength(l); } }
        let s = MFCreateSample()?; s.AddBuffer(&buf)?;
        s.SetSampleTime(t)?; s.SetSampleDuration(10_000_000 / self.fps as i64)?;
        self.inflight.insert(t, Instant::now());
        if self.inflight.len() > 512 { self.inflight.clear(); }
        self.enc.mft.ProcessInput(0, &s, 0)
    } }
}

pub fn run(o: &Opts) -> R<()> {
    unsafe { let _ = RoInitialize(RO_INIT_MULTITHREADED); e(MFStartup(MF_VERSION, MFSTARTUP_FULL), "MFStartup")?; }
    let say = |s: String| if !o.app { eprintln!("{s}"); };

    // GPU
    let mut device: Option<ID3D11Device> = None; let mut ctx: Option<ID3D11DeviceContext> = None;
    unsafe { e(D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut device), None, Some(&mut ctx)), "D3D11CreateDevice")?; }
    let (device, ctx) = (device.ok_or("sem D3D11")?, ctx.ok_or("sem contexto")?);
    if let Ok(mt) = device.cast::<ID3D11Multithread>() { unsafe { let _ = mt.SetMultithreadProtected(true); } }
    let dxgi: IDXGIDevice = e(device.cast(), "IDXGIDevice")?;
    let (luid, gpu) = unsafe { dxgi.GetAdapter().and_then(|a| a.GetDesc()).map(|d| ((((d.AdapterLuid.HighPart as u32) as u64) << 32) | d.AdapterLuid.LowPart as u64, String::from_utf16_lossy(&d.Description).trim_end_matches('\0').to_string())).unwrap_or((0, "?".into())) };
    say(format!("  placa de video: {gpu}"));
    let d3d: IDirect3DDevice = e(unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }.and_then(|x| x.cast()), "IDirect3DDevice")?;

    // o que capturar: monitor (ponto dentro dele, em pixels físicos), janela (HWND) ou o principal
    let interop = e(factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>(), "interop")?;
    let item: GraphicsCaptureItem = match o.source {
        Source::Window(hwnd) => e(unsafe { interop.CreateForWindow(HWND(hwnd as *mut core::ffi::c_void)) }, "CreateForWindow (a janela fechou ou nao pode ser capturada)")?,
        Source::Monitor(x, y) => { let hm = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTOPRIMARY) }; e(unsafe { interop.CreateForMonitor(hm) }, "CreateForMonitor")? }
        Source::Primary => { let hm = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) }; e(unsafe { interop.CreateForMonitor(hm) }, "CreateForMonitor")? }
    };
    let closed = Arc::new(AtomicBool::new(false));
    { let c = closed.clone(); let _ = item.Closed(&TypedEventHandler::new(move |_, _| { c.store(true, Ordering::Relaxed); Ok(()) })); }
    let mut size = e(item.Size(), "Size")?;
    let (cw, ch) = (size.Width.max(2) as u32, size.Height.max(2) as u32);
    let pool = e(Direct3D11CaptureFramePool::CreateFreeThreaded(&d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 3, size), "FramePool")?;
    let session = e(pool.CreateCaptureSession(&item), "CaptureSession")?;
    let _ = session.SetIsCursorCaptureEnabled(true);
    let _ = session.SetIsBorderRequired(false);
    let iv_note = match session.SetMinUpdateInterval(TimeSpan { Duration: 0 }) { Ok(_) => "0 ms".to_string(), Err(x) => format!("falhou ({})", x.message()) };
    say(format!("  intervalo minimo da captura: {iv_note}"));
    let signal = Arc::new((Mutex::new(false), Condvar::new()));
    let sig2 = signal.clone();
    e(pool.FrameArrived(&TypedEventHandler::new(move |_, _| { let (m, c) = &*sig2; *m.lock().unwrap() = true; c.notify_one(); Ok(()) })), "FrameArrived")?;

    // camadas: a última é a cheia; se a placa não abrir uma sessão extra para a leve, segue só com a cheia
    let vdev: ID3D11VideoDevice = e(device.cast(), "ID3D11VideoDevice")?;
    let vctx: ID3D11VideoContext = e(ctx.cast(), "ID3D11VideoContext")?;
    let top_i = o.layers.len() - 1;
    let top = make_layer(&device, &vdev, &vctx, luid, cw, ch, &o.layers[top_i], !o.app)?;
    let mut layers: Vec<(usize, WinLayer)> = Vec::new(); // (índice do fluxo RTP, camada)
    let mut layer_err = String::new();
    for (i, l) in o.layers.iter().enumerate().take(top_i) {
        match make_layer(&device, &vdev, &vctx, luid, cw, ch, l, !o.app) { Ok(x) => layers.push((i, x)), Err(x) => { layer_err = format!("camada {}p{}: {x}", l.height, l.fps); say(format!("  {layer_err}")); } }
    }
    layers.push((top_i, top));
    for (_, l) in &layers { l.set_rects(&vctx, cw, ch); }
    let (ow, oh) = (layers.last().unwrap().1.ow, layers.last().unwrap().1.oh);
    say(format!("  fonte {}x{} -> {}", cw, ch, layers.iter().map(|(_, l)| format!("{}x{}@{}", l.ow, l.oh, l.fps)).collect::<Vec<_>>().join(" + ")));
    say(format!("  codificador em uso: {}", layers.last().unwrap().1.enc.name));
    let mut tx = sender(o)?;
    for (i, l) in &layers { if let Some(h) = l.enc.seq_header() { tx.set_params(*i, &h); } }

    let mut m = Meter::new(o); m.size = (ow, oh);
    let (mut blt_err, mut in_err) = (None::<String>, None::<String>);
    let ivd = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC { FourCC: 0, ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D, Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 } } };
    e(session.StartCapture(), "StartCapture")?;
    if o.app { emit(serde_json::json!({ "t": "started", "w": ow, "h": oh, "encoder": layers.last().unwrap().1.enc.name, "gpu": gpu, "minUpdateInterval": iv_note,
        "layers": layers.iter().map(|(_, l)| format!("{}p{}", l.oh, l.fps)).collect::<Vec<_>>(), "layerError": layer_err })); }
    say("  transmitindo... (nao feche esta janela)".into());

    while !m.done() {
        if closed.load(Ordering::Relaxed) { return Err("a janela transmitida foi fechada".into()); }
        // eventos dos codificadores (sem bloquear)
        for (i, l) in layers.iter_mut() {
            loop {
                let ev = match unsafe { l.enc.events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } { Ok(ev) => ev, Err(_) => break };
                let typ = unsafe { ev.GetType() }.unwrap_or(0);
                if typ == METransformNeedInput.0 as u32 { l.need += 1; }
                else if typ == METransformHaveOutput.0 as u32 {
                    if let Some((data, t)) = l.enc.take_output()? {
                        if *i == top_i { if let Some(at) = l.inflight.remove(&t) { m.enc_ms.push(at.elapsed().as_secs_f64() * 1000.0); } } else { l.inflight.remove(&t); }
                        let ts = (t.max(0) as u64 * 9 / 1000) as u32; // 100 ns -> 90 kHz, mesmo relógio para as camadas
                        if !tx.has_params(*i) { if let Some(h) = l.enc.seq_header() { tx.set_params(*i, &h); } }
                        let before = tx.streams[*i].stats.bytes; tx.send_frame(*i, &data, ts); m.sent(*i, (tx.streams[*i].stats.bytes - before) as usize);
                    }
                } else if typ == MEError.0 as u32 { return Err(format!("o codificador avisou erro: 0x{:08X}", unsafe { ev.GetStatus() }.map(|h| h.0 as u32).unwrap_or(0))); }
            }
        }
        tx.poll_rtcp();
        for (i, l) in &layers { if tx.streams[*i].want_key { tx.streams[*i].want_key = false; l.enc.force_key(); } }
        m.tick(&tx.total());

        // quadro novo da tela? (pega só o mais recente)
        let mut latest: Option<Direct3D11CaptureFrame> = None;
        while let Ok(f) = pool.TryGetNextFrame() { m.captured(); latest = Some(f); }
        let now = m.elapsed();
        let Some(frame) = latest else {
            // tela parada: repete o último quadro ~10x/s (quem entra depois recebe imagem e o servidor sabe que segue vivo)
            for (_, l) in layers.iter_mut() {
                if let Some(ls) = l.last_slot { if now - l.last_input > 0.1 && l.need > 0 {
                    l.last_st += ((now - l.last_input) * 1e7) as i64; l.last_input = now;
                    let st = l.last_st; if l.feed(ls, st).is_ok() { l.need -= 1; m.repeats += 1; }
                } }
            }
            let (mx, cv) = &*signal; let g = mx.lock().unwrap();
            let (mut g, _) = cv.wait_timeout(g, Duration::from_millis(1)).unwrap(); *g = false;
            continue;
        };
        // janela mudou de tamanho: recria o pool e reposiciona (barras pretas mantêm a proporção)
        if let Ok(cs) = frame.ContentSize() {
            if cs.Width != size.Width || cs.Height != size.Height {
                if cs.Width > 0 && cs.Height > 0 { size = cs; let _ = pool.Recreate(&d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 3, size); for (_, l) in &layers { l.set_rects(&vctx, size.Width as u32, size.Height as u32); } }
                continue;
            }
        }
        // quais camadas querem este quadro (cada uma no seu fps)
        let st = (now * 1e7) as i64;
        let mut want: Vec<usize> = Vec::new();
        for (k, (i, l)) in layers.iter_mut().enumerate() {
            let iv = 1.0 / l.fps as f64;
            if now + iv * 0.3 < l.next_due { continue; } // acima do fps desta camada: descarta
            l.next_due = if l.next_due < now - iv { now + iv } else { l.next_due + iv };
            if l.need == 0 { if *i == top_i { m.skipped_busy += 1; } continue; } // codificador ainda ocupado
            want.push(k);
        }
        if want.is_empty() { continue; }
        let Ok(surf) = frame.Surface() else { continue };
        let Ok(acc) = surf.cast::<IDirect3DDxgiInterfaceAccess>() else { continue };
        let Ok(tex) = (unsafe { acc.GetInterface::<ID3D11Texture2D>() }) else { continue };
        for k in want {
            let l = &mut layers[k].1;
            let cur = l.slot % NV12_RING; l.slot += 1;
            let mut inview: Option<ID3D11VideoProcessorInputView> = None;
            if let Err(x) = unsafe { vdev.CreateVideoProcessorInputView(&tex, &l.venum, &ivd, Some(&mut inview)) } { blt_err.get_or_insert(format!("InputView: {}", x.message())); continue; }
            let mut stream = D3D11_VIDEO_PROCESSOR_STREAM { Enable: true.into(), pInputSurface: ManuallyDrop::new(inview), ..Default::default() };
            let r = unsafe { vctx.VideoProcessorBlt(&l.vproc, &l.ring[cur].1, 0, std::slice::from_ref(&stream)) };
            unsafe { ManuallyDrop::drop(&mut stream.pInputSurface); }
            if let Err(x) = r { blt_err.get_or_insert(format!("VideoProcessorBlt: {}", x.message())); continue; }
            match l.feed(cur, st) { Ok(()) => { l.need -= 1; l.inputs += 1; l.last_slot = Some(cur); l.last_input = now; l.last_st = st; } Err(x) => { in_err.get_or_insert(format!("ProcessInput: {} (0x{:08X})", x.message(), x.code().0 as u32)); } }
        }
        drop(frame);
        let t = &layers.last().unwrap().1;
        if t.inputs > 60 && tx.streams[top_i].stats.frames == 0 { return Err(format!("nenhum quadro saiu do codificador. {} {}", blt_err.unwrap_or_default(), in_err.unwrap_or_default())); }
    }
    let _ = session.Close(); let _ = pool.Close();
    for (_, l) in &layers { unsafe { let _ = l.enc.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0); } }
    summary(&m, &tx.total(), serde_json::json!({ "encoder": layers.last().unwrap().1.enc.name, "size": format!("{ow}x{oh}"), "screen": format!("{cw}x{ch}"), "minUpdateInterval": iv_note, "bltError": blt_err.unwrap_or_default(), "inputError": in_err.unwrap_or_default(), "repeats": m.repeats, "rtcpBad": tx.rtcp_bad, "layers": layers.len(), "layerError": layer_err }));
    Ok(())
}
