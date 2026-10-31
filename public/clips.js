// Clipes de transmissão: buffer circular por transmissão e envio do corte (5/15/30/60s) para o chat da sala
import { api, toast } from './state.js';
import { createBuffer, trackSig } from './clipbuf.js';

const bufs = new Map(); // chave da transmissão -> buffer
export const clipping = (key) => bufs.has(key);
export const clipLengths = [5, 15, 30, 60];

export function startBuffer(key, stream, audio) {
  const cur = bufs.get(key);
  if (cur && cur.stream === stream && cur.sig === trackSig(stream, audio)) return; // o áudio da transmissão pode chegar depois do vídeo: reinicia para incluí-lo
  if (cur) stopBuffer(key);
  const b = createBuffer(stream, audio); if (!b) return;
  b.onEnd = () => { if (bufs.get(key) === b) bufs.delete(key); };
  bufs.set(key, b);
}
export function stopBuffer(key) { const b = bufs.get(key); bufs.delete(key); b?.stop(); }
export const stopAllBuffers = () => [...bufs.keys()].forEach(stopBuffer);
export const pruneBuffers = (live) => [...bufs.keys()].forEach(k => { if (!live.has(k)) stopBuffer(k); });

// corta os últimos `secs` segundos, envia e posta no chat do canal
export async function saveClip(key, secs, { channelId, who }) {
  const b = bufs.get(key);
  if (!b) return toast('Ative os clipes primeiro.', true);
  const blob = await b.cut(secs);
  if (!blob) return toast('Ainda não há vídeo suficiente gravado. Aguarde alguns segundos.', true);
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0'), name = `clipe-${secs}s-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.webm`;
  toast('Enviando clipe…');
  try {
    const r = await api('POST', `/upload?name=${encodeURIComponent(name)}`, blob);
    await api('POST', `/channels/${channelId}/messages`, { content: `🎬 Clipe de ${secs}s da transmissão de ${who}`, attachments: [{ url: r.url, name: r.name, size: r.size, type: 'video/webm' }] });
    toast(b.hasAudio ? 'Clipe postado no chat da sala' : 'Clipe postado, mas sem áudio: esta transmissão não está enviando som.', !b.hasAudio);
  } catch (e) { toast('Falha ao enviar o clipe: ' + e.message, true); }
}
