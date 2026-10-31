// Clipes de transmissão: mantém um buffer circular (~65s) em WebM e corta os últimos 5/15/30/60s sob demanda
import { api, toast } from './state.js';

const KEEP = 65000, CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
const bufs = new Map(); // chave da transmissão -> { rec, stream, init, chunks: [{ t, blob }], trimmed }

export const clipping = (key) => bufs.has(key);
export const clipLengths = [5, 15, 30, 60];

// o 1º pedaço do MediaRecorder traz o cabeçalho + o primeiro cluster; o resto continua o mesmo fluxo de bytes
const startsCluster = async (blob) => { const b = new Uint8Array(await blob.slice(0, 4).arrayBuffer()); return CLUSTER.every((x, i) => b[i] === x); };
async function headerOf(init) {
  const b = new Uint8Array(await init.slice(0, 65536).arrayBuffer());
  for (let i = 0; i < b.length - 3; i++) if (b[i] === CLUSTER[0] && b[i + 1] === CLUSTER[1] && b[i + 2] === CLUSTER[2] && b[i + 3] === CLUSTER[3]) return init.slice(0, i);
  return null;
}

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
  const buf = { rec, stream, init: null, chunks: [], trimmed: false };
  rec.ondataavailable = (e) => {
    if (!e.data?.size) return;
    if (!buf.init) { buf.init = e.data; return; }
    const now = Date.now(); buf.chunks.push({ t: now, blob: e.data });
    while (buf.chunks.length && buf.chunks[0].t < now - KEEP) { buf.chunks.shift(); buf.trimmed = true; }
  };
  rec.onerror = rec.onstop = () => { if (bufs.get(key) === buf) bufs.delete(key); };
  bufs.set(key, buf); rec.start(1000);
}
export function stopBuffer(key) {
  const b = bufs.get(key); bufs.delete(key);
  try { if (b?.rec.state !== 'inactive') b.rec.stop(); } catch { /* já parado */ }
  if (b) { b.chunks = []; b.init = null; }
}
export const stopAllBuffers = () => [...bufs.keys()].forEach(stopBuffer);
export const pruneBuffers = (live) => [...bufs.keys()].forEach(k => { if (!live.has(k)) stopBuffer(k); });

// corta os últimos `secs` segundos, envia e posta no chat do canal
export async function saveClip(key, secs, { channelId, who }) {
  const b = bufs.get(key);
  if (!b?.init || !b.chunks.length) return toast('Ainda não há vídeo gravado. Aguarde alguns segundos.', true);
  const from = Date.now() - secs * 1000;
  let pick = b.chunks.filter(c => c.t > from);
  if (!pick.length) pick = b.chunks.slice(-1);
  let parts;
  if (!b.trimmed && pick.length === b.chunks.length) parts = [b.init, ...pick.map(c => c.blob)]; // clipe pega desde o início do buffer: usa o 1º pedaço inteiro
  else {
    const head = await headerOf(b.init); if (!head) return toast('Não foi possível montar o clipe.', true);
    let i = 0; while (i < pick.length && !(await startsCluster(pick[i].blob))) i++; // o corte precisa começar num cluster
    if (i >= pick.length) return toast('Não foi possível montar o clipe, tente de novo em alguns segundos.', true);
    parts = [head, ...pick.slice(i).map(c => c.blob)];
  }
  const blob = new Blob(parts, { type: 'video/webm' });
  const d = new Date(), name = `clipe-${secs}s-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.webm`;
  toast('Enviando clipe…');
  try {
    const r = await api('POST', `/upload?name=${encodeURIComponent(name)}`, blob);
    await api('POST', `/channels/${channelId}/messages`, { content: `🎬 Clipe de ${secs}s da transmissão de ${who}`, attachments: [{ url: r.url, name: r.name, size: r.size, type: 'video/webm' }] });
    toast('Clipe postado no chat da sala');
  } catch (e) { toast('Falha ao enviar o clipe: ' + e.message, true); }
}
