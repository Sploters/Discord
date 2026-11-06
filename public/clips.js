// Clipes de transmissão: buffer circular por transmissão e envio do corte (5/15/30/60s) para o chat da sala e a galeria
import { api, toast } from './state.js';
import { createBuffer, createMixer } from './clipbuf.js';
import { openTrimmer } from './cliptrim.js';

const bufs = new Map(); // chave da transmissão -> buffer
export const clipping = (key) => bufs.has(key);
export const clipLengths = [5, 15, 30, 60];
export const clipKeys = () => [...bufs.keys()];
// diagnóstico (relatório de problema / testes): quantas fontes de áudio entram no clipe de cada transmissão
export const clipInfo = (key) => { const b = bufs.get(key); return b && { hasAudio: !!b.hasAudio, audioSources: b.mixer?.size ?? (b.hasAudio ? 1 : 0) }; };

// audio: fontes de áudio do clipe — o áudio da transmissão e o MICROFONE de quem transmite (só no clipe: na transmissão ao
// vivo a voz continua indo separada, como voz da call). ctx: AudioContext para misturar (sem ele, usa só a primeira fonte).
const vsig = (stream) => stream.getVideoTracks().map(t => t.id).join(',');
export function startBuffer(key, stream, audio = [], ctx = null) {
  const sources = (Array.isArray(audio) ? audio : [audio]).filter(Boolean), cur = bufs.get(key);
  if (cur && cur.stream === stream && cur.vsig === vsig(stream)) { cur.mixer?.set(sources); return; } // áudio mudou (microfone trocado, chegou depois): só remistura, sem perder o que já foi gravado
  if (cur) stopBuffer(key);
  const mixer = ctx ? createMixer(ctx) : null;
  mixer?.set(sources);
  const b = createBuffer(new MediaStream(stream.getVideoTracks()), mixer ? mixer.stream : sources.find(s => s.getAudioTracks().length)); if (!b) { mixer?.stop(); return; }
  Object.assign(b, { stream, vsig: vsig(stream), mixer });
  if (mixer) Object.defineProperty(b, 'hasAudio', { get: () => mixer.had });
  b.onEnd = () => { if (bufs.get(key) === b) { bufs.delete(key); mixer?.stop(); } };
  bufs.set(key, b);
}
export function stopBuffer(key) { const b = bufs.get(key); bufs.delete(key); b?.stop(); b?.mixer?.stop(); }
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

// corta os últimos `secs` segundos, envia e posta no chat do canal.
// onCaptured(ok, motivo): chamado logo depois do corte (local, instantâneo), antes do envio — é a hora do aviso "capturado"
export async function saveClip(key, secs, { channelId, who, onCaptured }) {
  const b = bufs.get(key);
  if (!b) { onCaptured?.(false, 'Os clipes não estão ligados'); return toast('Ative os clipes primeiro.', true); }
  const blob = await b.cut(secs);
  if (!blob) { onCaptured?.(false, 'Ainda não há vídeo suficiente gravado'); return toast('Ainda não há vídeo suficiente gravado. Aguarde alguns segundos.', true); }
  onCaptured?.(true);
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
