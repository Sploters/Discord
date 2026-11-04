// Clipes de transmissão: buffer circular por transmissão e envio do corte (5/15/30/60s) para o chat da sala e a galeria
import { api, toast } from './state.js';
import { createBuffer, trackSig } from './clipbuf.js';
import { openTrimmer } from './cliptrim.js';

const bufs = new Map(); // chave da transmissão -> buffer
export const clipping = (key) => bufs.has(key);
export const clipLengths = [5, 15, 30, 60];
export const clipKeys = () => [...bufs.keys()];

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

const p2 = (n) => String(n).padStart(2, '0');
// envia o vídeo e posta no chat do canal (o servidor também guarda na galeria). Devolve true se deu certo.
export async function postClip(blob, { channelId, secs, streamerId, hasAudio = true, title, who }) {
  const d = new Date(), name = `clipe-${secs}s-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.webm`;
  toast('Enviando clipe…');
  try {
    const r = await api('POST', `/upload?name=${encodeURIComponent(name)}`, blob);
    const t = title || `${who} — ${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`; // nome padrão distinto (dá para renomear na galeria)
    await api('POST', `/channels/${channelId}/clips`, { url: r.url, name: r.name, size: r.size, secs, streamer_id: streamerId, has_audio: hasAudio, title: t });
    toast(hasAudio ? 'Clipe salvo na galeria e postado no chat da sala' : 'Clipe salvo, mas sem áudio: esta transmissão não está enviando som.', !hasAudio);
    return true;
  } catch (e) { toast('Falha ao enviar o clipe: ' + e.message, true); return false; }
}

// corta os últimos `secs` segundos, envia e posta no chat do canal
export async function saveClip(key, secs, { channelId, who }) {
  const b = bufs.get(key);
  if (!b) return toast('Ative os clipes primeiro.', true);
  const blob = await b.cut(secs);
  if (!blob) return toast('Ainda não há vídeo suficiente gravado. Aguarde alguns segundos.', true);
  return postClip(blob, { channelId, secs, streamerId: key.slice(2), hasAudio: !!b.hasAudio, who });
}

// pega o que estiver gravado (até 60 s) e abre o editor para escolher o trecho antes de postar
export async function saveClipTrim(key, { channelId, who }) {
  const b = bufs.get(key);
  if (!b) return toast('Ative os clipes primeiro.', true);
  const blob = await b.cut(60);
  if (!blob) return toast('Ainda não há vídeo suficiente gravado. Aguarde alguns segundos.', true);
  const d = new Date();
  openTrimmer(new Uint8Array(await blob.arrayBuffer()), { title: `${who} — ${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`,
    onSave: ({ blob: cut, secs, title }) => postClip(cut, { channelId, secs, streamerId: key.slice(2), hasAudio: !!b.hasAudio, title, who }) });
}
