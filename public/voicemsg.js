// Mensagens de voz: grava com MediaRecorder (webm/opus), guarda a forma de onda ao gravar e mostra um player com barras.
import { h, icon } from './util.js';
import { S, api, toast } from './state.js';

const MAX_SEC = 300, BARS = 64;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const toB64 = (a) => btoa(String.fromCharCode(...a));
const fromB64 = (s) => { try { return [...atob(s)].map(c => c.charCodeAt(0)); } catch { return []; } };

// reduz os picos medidos durante a gravação a BARS barras de 0 a 255
function shrink(peaks) {
  if (!peaks.length) return new Array(BARS).fill(20);
  const out = [];
  for (let i = 0; i < BARS; i++) {
    const a = Math.floor(i * peaks.length / BARS), b = Math.max(a + 1, Math.floor((i + 1) * peaks.length / BARS));
    out.push(Math.max(...peaks.slice(a, b)));
  }
  const top = Math.max(...out, 0.05);
  return out.map(v => Math.round(Math.max(0.08, v / top) * 255));
}

let current = null; // um áudio por vez
function bars(wave) { return (wave.length ? wave : new Array(BARS).fill(60)).map(v => h('i', { style: { height: Math.round(12 + v / 255 * 88) + '%' } })); }

// Player de uma mensagem de voz já enviada (f = anexo)
export function voiceEl(f) { return player(f.url, f.duration || 0, fromB64(f.waveform || ''), f.name); }
function player(src, dur, wave, name) {
  const audio = new Audio(); audio.preload = 'metadata'; audio.src = src;
  const bs = bars(wave), waveEl = h('div.vwave', bs), time = h('span.vtime', fmt(dur));
  const total = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : dur);
  const play = h('button.vplay', { title: 'Ouvir' }, icon('play', 18));
  const speeds = [1, 1.5, 2], spd = h('button.vspd', { title: 'Velocidade' }, '1x');
  const paint = () => { const f = total() ? audio.currentTime / total() : 0; bs.forEach((b, i) => b.classList.toggle('on', i / bs.length < f)); };
  const setIcon = (playing) => play.replaceChildren(icon(playing ? 'pause' : 'play', 18));
  play.onclick = () => {
    if (audio.paused) { if (current && current !== audio) current.pause(); current = audio; audio.play().catch(() => toast('Não foi possível reproduzir o áudio', true)); } else audio.pause();
  };
  audio.onplay = () => setIcon(true);
  audio.onpause = () => setIcon(false);
  audio.onended = () => { audio.currentTime = 0; setIcon(false); paint(); time.textContent = fmt(total()); };
  audio.ontimeupdate = () => { paint(); time.textContent = fmt(audio.paused && !audio.currentTime ? total() : audio.currentTime); };
  waveEl.onclick = (e) => {
    const r = waveEl.getBoundingClientRect(), t = total(); if (!t) return;
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * t; paint();
  };
  spd.onclick = () => { audio.playbackRate = speeds[(speeds.indexOf(audio.playbackRate) + 1) % speeds.length]; spd.textContent = audio.playbackRate + 'x'; };
  return h('div.vmsg', play, waveEl, time, spd, h('a.vdl', { href: src + '?download=1', download: name || 'mensagem-de-voz.webm', title: 'Baixar' }, icon('dl', 16)));
}

// Barra de gravação no lugar do compositor. host = #composer; onSent chamado após enviar.
export async function recordVoiceMessage(ch, host, { onSent } = {}) {
  if (host.classList.contains('recording')) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Este navegador não consegue gravar áudio', true);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: S.prefs.inputId ? { exact: S.prefs.inputId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) { return toast('Sem acesso ao microfone: ' + (e.message || e.name), true); }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
  const chunks = [], peaks = [];
  const ctx = new (window.AudioContext || window.webkitAudioContext)(), an = ctx.createAnalyser(); an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  const level = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); return m / 128; };
  const cv = h('canvas.vlive', { width: 360, height: 40 }), g = cv.getContext('2d');
  const t0 = Date.now(); let blob = null, dur = 0, timer, tick, sending = false;
  const clock = h('span.vtime', '0:00');

  const cleanup = () => { clearInterval(timer); cancelAnimationFrame(tick); stream.getTracks().forEach(t => t.stop()); ctx.close().catch(() => { }); };
  const close = () => { cleanup(); if (rec.state !== 'inactive') { rec.onstop = null; rec.stop(); } bar.remove(); host.classList.remove('recording'); };
  const draw = () => {
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#5865f2';
    const n = Math.floor(cv.width / 6), tail = peaks.slice(-n);
    tail.forEach((p, i) => { const hh = Math.max(3, p * cv.height); g.fillRect((n - tail.length + i) * 6, (cv.height - hh) / 2, 3, hh); });
    tick = requestAnimationFrame(draw);
  };
  const stop = () => { if (rec.state === 'recording') rec.stop(); };
  const send = async () => {
    if (sending || !blob) return; sending = true; sendBtn.disabled = true;
    try {
      const r = await api('POST', '/upload?name=' + encodeURIComponent('mensagem-de-voz.webm'), blob);
      const att = { url: r.url, name: r.name, size: r.size, type: blob.type, voice: true, duration: Math.round(dur * 10) / 10, waveform: toB64(shrink(peaks)) };
      await api('POST', `/channels/${ch.id}/messages`, { content: '', reply_to: S.replyTo?.id, attachments: [att] });
      onSent?.(); close();
    } catch (e) { toast('Falha ao enviar o áudio: ' + e.message, true); sending = false; sendBtn.disabled = false; }
  };
  const trash = h('button.ibtn', { title: 'Cancelar', onclick: close }, icon('trash', 22));
  const stopBtn = h('button.vstop', { title: 'Parar e ouvir', onclick: stop }, icon('stop', 18));
  const sendBtn = h('button.vsend', { title: 'Enviar mensagem de voz', onclick: send }, icon('send', 20));
  const dot = h('span.vdot');
  const bar = h('div.vrec', trash, dot, clock, cv, stopBtn);
  host.classList.add('recording'); host.append(bar);

  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    cleanup(); dur = Math.min((Date.now() - t0) / 1000, MAX_SEC);
    blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    if (dur < 0.6) { toast('Gravação muito curta'); return close(); }
    bar.replaceChildren(trash, player(URL.createObjectURL(blob), dur, shrink(peaks)), sendBtn);
  };
  rec.start(250);
  timer = setInterval(() => {
    const s = (Date.now() - t0) / 1000; clock.textContent = fmt(s);
    if (s >= MAX_SEC) stop();
  }, 250);
  const sample = setInterval(() => { if (rec.state !== 'recording') return clearInterval(sample); peaks.push(level()); }, 100);
  draw();
}
