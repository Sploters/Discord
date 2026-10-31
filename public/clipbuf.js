// Buffer circular de uma transmissão: MediaRecorder em WebM, ~65s, e corte dos últimos N segundos. Sem imports de UI (testável).
import { findClusters, parseCluster, buildClip } from './webm.js';

const KEEP = 65000;

// faixas que entram no clipe (vídeo da transmissão + áudio da transmissão, que chega num stream separado)
const liveTracks = (stream, audio) => [...stream.getVideoTracks(), ...(audio?.getAudioTracks() || []), ...stream.getAudioTracks()].filter(t => t.readyState === 'live');
export const trackSig = (stream, audio) => liveTracks(stream, audio).map(t => t.id).join(',');

export function createBuffer(stream, audio, opts = {}) {
  if (!stream || !window.MediaRecorder) return null;
  const tracks = liveTracks(stream, audio);
  if (!tracks.some(t => t.kind === 'video')) return null;
  const hasAudio = tracks.some(t => t.kind === 'audio');
  // o clipe grava a 30 fps mesmo que a transmissão seja de 120: codificar todos os quadros custava metade da CPU
  const vt0 = tracks.find(t => t.kind === 'video'), vt = opts.fullRate ? vt0 : vt0.clone();
  if (vt !== vt0) vt.applyConstraints({ frameRate: { ideal: 30, max: 30 } }).catch(() => { });
  const rtracks = tracks.map(t => (t === vt0 ? vt : t));
  const mimeType = (opts.mimes || (hasAudio ? ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'] : ['video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8']).concat('video/webm')).find(m => MediaRecorder.isTypeSupported(m));
  // qualidade: VP9 com bitrate proporcional à resolução da transmissão (teto 8 Mb/s: 60s ficam em ~60 MB, abaixo do limite de upload de 100 MB)
  const st = tracks.find(t => t.kind === 'video').getSettings?.() || {};
  const bps = opts.bps || Math.round(Math.min(8_000_000, Math.max(3_000_000, (st.width || 1920) * (st.height || 1080) * Math.min(30, st.frameRate || 30) * 0.15)));
  let rec;
  try { rec = new MediaRecorder(new MediaStream(rtracks), { mimeType, videoBitsPerSecond: bps, audioBitsPerSecond: 160_000, videoKeyFrameIntervalDuration: 1000 }); } catch { if (vt !== vt0) vt.stop(); return null; }
  const buf = { hasAudio, stream, sig: trackSig(stream, audio), rec, header: null, chunks: [], clusters: [], size: 0, tail: new Uint8Array(0), q: Promise.resolve(), onEnd: null };
  const ingest = async (blob, t) => {
    const bytes = new Uint8Array(await blob.arrayBuffer()), start = buf.size;
    const joined = new Uint8Array(buf.tail.length + bytes.length); joined.set(buf.tail); joined.set(bytes, buf.tail.length);
    for (const off of findClusters(joined, start - buf.tail.length)) {
      if (!buf.header && start === 0) buf.header = bytes.slice(0, off);
      buf.clusters.push({ off, t: t - 1000 }); // o pedaço chega no fim do seu segundo: o cluster começou ~1s antes
    }
    buf.tail = bytes.slice(-3); buf.size += bytes.length;
    buf.chunks.push({ start, size: bytes.length, t, blob });
    while (buf.chunks.length > 1 && buf.chunks[0].t < t - KEEP) buf.chunks.shift();
    const first = buf.chunks[0].start;
    while (buf.clusters.length && buf.clusters[0].off < first) buf.clusters.shift();
  };
  rec.ondataavailable = (e) => { if (e.data?.size) { const t = Date.now(); buf.q = buf.q.then(() => ingest(e.data, t)).catch(() => { }); } };
  rec.onerror = rec.onstop = () => buf.onEnd?.();
  rec.start(1000);

  // devolve um Blob WebM com os últimos `secs` segundos (começa no quadro-chave mais próximo, até ~1s antes), ou null
  buf.cut = async (secs) => {
    await buf.q;
    if (!buf.header || !buf.clusters.length) return null;
    const cl = buf.clusters, base = cl[0].off;
    const slice = (a, z) => { // bytes absolutos [a, z) dos pedaços guardados
      const parts = [];
      for (const c of buf.chunks) { if (c.start + c.size <= a || c.start >= z) continue; parts.push(c.blob.slice(Math.max(0, a - c.start), Math.min(c.size, z - c.start))); }
      return new Blob(parts);
    };
    const all = new Uint8Array(await slice(base, buf.size).arrayBuffer());
    const list = cl.map((c, i) => all.subarray(c.off - base, (cl[i + 1]?.off ?? buf.size) - base));
    const info = list.map(parseCluster), last = info[info.length - 1];
    if (!last) return null;
    const endTs = last.ts + Math.max(0, buf.chunks[buf.chunks.length - 1].t - cl[cl.length - 1].t); // tempo de mídia ao fim do que foi gravado
    let pick = -1;
    for (let i = 0; i < list.length; i++) if (info[i]?.keyStart && info[i].ts <= endTs - secs * 1000) pick = i; // quadro-chave mais recente que ainda cobre o pedido
    if (pick < 0) pick = info.findIndex(x => x?.keyStart); // buffer menor que o pedido: tudo desde o 1º quadro-chave
    if (pick < 0) return null;
    const out = buildClip(buf.header, list.slice(pick), endTs);
    return out && new Blob([out], { type: 'video/webm' });
  };
  buf.stop = () => { try { if (rec.state !== 'inactive') rec.stop(); } catch { /* já parado */ } if (vt !== vt0) vt.stop(); buf.chunks = []; buf.clusters = []; buf.header = null; };
  return buf;
}
