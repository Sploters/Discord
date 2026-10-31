// Clipes de transmissão: mantém um buffer circular (~65s) em WebM e corta os últimos 5/15/30/60s sob demanda
import { api, toast } from './state.js';

const KEEP = 65000, CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
const bufs = new Map(); // chave da transmissão -> { rec, stream, header, chunks: [{ start, size, t, blob }], clusters: [{ off, t }] }

export const clipping = (key) => bufs.has(key);
export const clipLengths = [5, 15, 30, 60];

// os pedaços do MediaRecorder são cortes arbitrários do mesmo fluxo WebM: acha os inícios de cluster (que começam em quadro-chave) varrendo os bytes
const findClusters = (bytes, base) => {
  const out = [];
  for (let i = 0; i <= bytes.length - 4; i++) if (bytes[i] === CLUSTER[0] && bytes[i + 1] === CLUSTER[1] && bytes[i + 2] === CLUSTER[2] && bytes[i + 3] === CLUSTER[3]) out.push(base + i);
  return out;
};

export function startBuffer(key, stream, audio) {
  const cur = bufs.get(key);
  if (cur && cur.stream === stream) return;
  if (cur) stopBuffer(key);
  if (!stream || !window.MediaRecorder) return;
  const tracks = [...stream.getVideoTracks(), ...(audio?.getAudioTracks() || []), ...(stream.getAudioTracks())].filter(t => t.readyState === 'live');
  if (!tracks.some(t => t.kind === 'video')) return;
  const hasAudio = tracks.some(t => t.kind === 'audio');
  const mimeType = [hasAudio ? 'video/webm;codecs=vp8,opus' : 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  let rec;
  try { rec = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 128_000, videoKeyFrameIntervalDuration: 1000 }); } catch { return; }
  const buf = { rec, stream, header: null, chunks: [], clusters: [], size: 0, tail: new Uint8Array(0), q: Promise.resolve() };
  const ingest = async (blob, t) => {
    const bytes = new Uint8Array(await blob.arrayBuffer()), start = buf.size;
    const joined = new Uint8Array(buf.tail.length + bytes.length); joined.set(buf.tail); joined.set(bytes, buf.tail.length);
    for (const off of findClusters(joined, start - buf.tail.length)) {
      if (!buf.header && start === 0) buf.header = blob.slice(0, off);
      buf.clusters.push({ off, t: t - 1000 }); // o pedaço chega no fim do seu segundo: o cluster começou ~1s antes
    }
    if (!buf.header && start === 0) buf.header = blob; // sem cluster no 1º pedaço: ele inteiro é só cabeçalho
    buf.tail = bytes.slice(-3); buf.size += bytes.length;
    buf.chunks.push({ start, size: bytes.length, t, blob });
    while (buf.chunks.length > 1 && buf.chunks[0].t < t - KEEP) buf.chunks.shift();
    const first = buf.chunks[0].start;
    while (buf.clusters.length && buf.clusters[0].off < first) buf.clusters.shift();
  };
  rec.ondataavailable = (e) => { if (e.data?.size) { const t = Date.now(); buf.q = buf.q.then(() => ingest(e.data, t)).catch(() => { }); } };
  rec.onerror = rec.onstop = () => { if (bufs.get(key) === buf) bufs.delete(key); };
  bufs.set(key, buf); rec.start(1000);
}
export function stopBuffer(key) {
  const b = bufs.get(key); bufs.delete(key);
  try { if (b?.rec.state !== 'inactive') b.rec.stop(); } catch { /* já parado */ }
  if (b) { b.chunks = []; b.clusters = []; b.header = null; }
}
export const stopAllBuffers = () => [...bufs.keys()].forEach(stopBuffer);
export const pruneBuffers = (live) => [...bufs.keys()].forEach(k => { if (!live.has(k)) stopBuffer(k); });

// corta os últimos `secs` segundos, envia e posta no chat do canal
export async function saveClip(key, secs, { channelId, who }) {
  const b = bufs.get(key);
  if (b) await b.q;
  if (!b?.header || !b.clusters.length) return toast('Ainda não há vídeo gravado. Aguarde alguns segundos.', true);
  const from = Date.now() - secs * 1000;
  const cl = b.clusters.find(c => c.t >= from) || b.clusters[b.clusters.length - 1];
  const i = b.chunks.findIndex(c => cl.off >= c.start && cl.off < c.start + c.size);
  if (i < 0) return toast('Não foi possível montar o clipe, tente de novo em alguns segundos.', true);
  const parts = [b.header, b.chunks[i].blob.slice(cl.off - b.chunks[i].start), ...b.chunks.slice(i + 1).map(c => c.blob)];
  const blob = new Blob(parts, { type: 'video/webm' });
  const d = new Date(), name = `clipe-${secs}s-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.webm`;
  toast('Enviando clipe…');
  try {
    const r = await api('POST', `/upload?name=${encodeURIComponent(name)}`, blob);
    await api('POST', `/channels/${channelId}/messages`, { content: `🎬 Clipe de ${secs}s da transmissão de ${who}`, attachments: [{ url: r.url, name: r.name, size: r.size, type: 'video/webm' }] });
    toast('Clipe postado no chat da sala');
  } catch (e) { toast('Falha ao enviar o clipe: ' + e.message, true); }
}
