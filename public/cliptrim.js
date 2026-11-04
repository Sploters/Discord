// Cortar clipe: escolhe o trecho numa linha do tempo (miniaturas + duas alças) e corta o WebM sem recomprimir.
// O início encaixa no quadro-chave mais próximo (os clipes têm um a cada ~1 s); o fim é exato.
import { h, icon } from './util.js';
import { modal, toast } from './state.js';
import { trimWebm, keyframeTimes } from './webm.js';

const fmt = (ms) => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };

// miniaturas da linha do tempo: um vídeo escondido vai pulando pelo arquivo e desenha cada quadro
async function filmstrip(url, durMs, n, box) {
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
  try { await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = no; setTimeout(no, 8000); }); } catch { return; }
  for (let i = 0; i < n; i++) {
    if (!box.isConnected) break;
    try { v.currentTime = (durMs / 1000) * (i + 0.5) / n; await new Promise((ok) => { v.onseeked = ok; setTimeout(ok, 1500); }); } catch { break; }
    const c = h('canvas', { width: 128, height: 72 }); try { c.getContext('2d').drawImage(v, 0, 0, 128, 72); } catch { }
    box.children[i]?.replaceWith(c);
  }
  v.removeAttribute('src'); v.load();
}

/**
 * Abre o editor. bytes: Uint8Array do WebM. opts: { title, action: 'Postar clipe', onSave: async ({ blob, secs, title, startMs, endMs }) => bool }
 */
export function openTrimmer(bytes, opts = {}) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
  const video = h('video.trvid', { src: url, playsInline: true, preload: 'auto' });
  const strip = h('div.trstrip', Array.from({ length: 10 }, () => h('i')));
  const sel = h('div.trsel'), head = h('div.trhead');
  const hs = h('div.trhandle.s', { title: 'Início (arraste)' }), he = h('div.trhandle.e', { title: 'Fim (arraste)' });
  const track = h('div.trtrack', strip, sel, head, hs, he);
  const lab = h('div.trlab'), note = h('div.qinfo');
  const title = h('input', { maxLength: 100, value: opts.title || '' });
  const play = h('button.btn.grey.trplay', { onclick: () => toggle() }, icon('play', 16), 'Assistir trecho');
  let dur = 0, a = 0, b = 0, snapped = 0, loop = false;
  const keysAt = keyframeTimes(bytes); // calculado uma vez: arrastar não relê o arquivo

  const pos = (ms) => (dur ? (ms / dur) * 100 : 0) + '%';
  const paint = () => {
    hs.style.left = pos(a); he.style.left = pos(b); sel.style.left = pos(a); sel.style.width = dur ? ((b - a) / dur) * 100 + '%' : '0';
    // onde o corte vai começar de verdade (quadro-chave anterior)
    snapped = keysAt.filter(t => t <= a).pop() ?? keysAt[0] ?? a;
    lab.replaceChildren(h('span', 'Início ', h('b', fmt(snapped))), h('span', 'Fim ', h('b', fmt(b))), h('span', 'Duração ', h('b', ((b - snapped) / 1000).toFixed(1) + ' s')));
    note.textContent = snapped < a - 50 ? `O começo encaixa no quadro-chave anterior (${((a - snapped) / 1000).toFixed(1)} s antes) para não recomprimir o vídeo.` : 'O corte não recomprime o vídeo: é instantâneo e sem perda de qualidade.';
  };
  const toggle = () => {
    if (!video.paused && loop) { video.pause(); return; }
    loop = true; video.currentTime = snapped / 1000; video.play().catch(() => { });
  };
  video.addEventListener('play', () => play.replaceChildren(icon('pause', 16), 'Pausar'));
  video.addEventListener('pause', () => play.replaceChildren(icon('play', 16), 'Assistir trecho'));
  video.addEventListener('timeupdate', () => {
    head.style.left = pos(video.currentTime * 1000);
    if (loop && video.currentTime * 1000 >= b) video.currentTime = snapped / 1000; // repete o trecho
  });
  // arrastar as alças (ou clicar na faixa: move a alça mais próxima)
  const msAt = (e) => { const r = track.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur); };
  const drag = (which) => (e) => {
    e.preventDefault(); e.stopPropagation(); track.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const t = msAt(ev);
      if (which === 's') a = Math.min(t, b - 500); else b = Math.max(t, a + 500);
      a = Math.max(0, a); b = Math.min(dur, b);
      video.pause(); loop = false; video.currentTime = (which === 's' ? a : b) / 1000; paint();
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  hs.addEventListener('pointerdown', drag('s')); he.addEventListener('pointerdown', drag('e'));
  track.addEventListener('pointerdown', (e) => { const t = msAt(e); drag(Math.abs(t - a) < Math.abs(t - b) ? 's' : 'e')(e); });

  video.addEventListener('loadedmetadata', () => {
    dur = Math.round((isFinite(video.duration) ? video.duration : 0) * 1000);
    if (!dur) { lab.textContent = 'Não consegui ler a duração deste vídeo.'; return; }
    a = 0; b = dur; paint(); filmstrip(url, dur, 10, strip);
  });
  // atalhos: espaço = assistir/pausar, I/O = marcar início/fim onde o vídeo está
  const keys = (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    if (e.key === 'i' || e.key === 'I') { a = Math.min(Math.round(video.currentTime * 1000), b - 500); paint(); }
    if (e.key === 'o' || e.key === 'O') { b = Math.max(Math.round(video.currentTime * 1000), a + 500); paint(); }
  };
  addEventListener('keydown', keys);
  const cleanup = () => { removeEventListener('keydown', keys); video.pause(); URL.revokeObjectURL(url); };
  const body = h('div.trimmer', video, track, lab, h('div.trrow', play, h('small.mut', 'Espaço: assistir · I / O: marcar início / fim no ponto atual')), note, h('label.f', 'Título', title));
  const m = modal('Cortar clipe', 'Arraste as alças para escolher o trecho.', body, [
    { label: 'Cancelar', cls: 'link', fn: () => cleanup() },
    { label: opts.action || 'Postar clipe', cls: 'green', fn: async () => {
      const r = trimWebm(bytes, a, b);
      if (!r) { toast('Não consegui cortar este vídeo', true); return false; }
      const ok = await opts.onSave?.({ blob: new Blob([r.bytes], { type: 'video/webm' }), secs: Math.max(1, Math.round((r.endMs - r.startMs) / 1000)), title: title.value.trim(), startMs: r.startMs, endMs: r.endMs });
      if (ok === false) return false;
      cleanup();
    } }], { width: '760px', sticky: true });
  setTimeout(() => { if (document.activeElement === title) title.blur(); }, 0); // o modal foca o título; os atalhos (espaço, I, O) valem fora dele
  return m;
}
