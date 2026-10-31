import { h, icon } from './util.js';
import { S } from './state.js';

// ---------- prévia (quadro) de uma transmissão ----------
const thumbs = new Map(); // uid -> { url, at }
export function snapshot(uid, stream) {
  const old = thumbs.get(uid);
  if (old && Date.now() - old.at < 15000) return Promise.resolve(old.url);
  if (!stream?.getVideoTracks().length) return Promise.resolve(old?.url || null);
  return new Promise((res) => {
    const v = h('video', { muted: true, playsInline: true }); v.muted = true; v.srcObject = stream;
    const done = (url) => { v.srcObject = null; if (url) thumbs.set(uid, { url, at: Date.now() }); res(url || old?.url || null); };
    const t = setTimeout(() => done(null), 2500);
    v.onloadeddata = () => {
      clearTimeout(t);
      try {
        const c = document.createElement('canvas'), w = Math.min(v.videoWidth || 640, 480);
        c.width = w; c.height = Math.round(w * (v.videoHeight || 360) / (v.videoWidth || 640));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        done(c.toDataURL('image/jpeg', .7));
      } catch { done(null); }
    };
    v.play?.().catch(() => { });
  });
}

// ---------- cartão ao passar o mouse no "Ao vivo" da lista de voz ----------
let card = null, cardTimer = null;
export function hideStreamCard() { clearTimeout(cardTimer); card?.remove(); card = null; }
export function streamHover(row, { uid, mine, getStream, onWatch }) {
  row.addEventListener('mouseenter', () => {
    clearTimeout(cardTimer);
    cardTimer = setTimeout(async () => {
      hideStreamCard();
      const img = h('img', { draggable: false }), ph = h('div.sc-ph', icon('screen', 32));
      const prev = h('div.sc-prev', { onclick: () => { hideStreamCard(); onWatch(); } }, ph, img, h('div.sc-hover', mine ? 'Você está transmitindo!' : 'Assistir transmissão'));
      const watch = h('button.btn.sc-btn' + (mine ? '' : '.green'), { disabled: mine, onclick: () => { hideStreamCard(); onWatch(); } }, icon('screen', 16), mine ? 'Você está transmitindo!' : 'Assistir transmissão');
      card = h('div.streamcard', { onmouseleave: hideStreamCard },
        h('div.sc-head', h('span', 'Transmitindo agora'), h('span.live', 'Ao vivo')), prev, watch);
      document.body.append(card);
      const r = row.getBoundingClientRect(), cw = 260, ch = card.offsetHeight;
      card.style.left = Math.min(r.right + 8, innerWidth - cw - 8) + 'px';
      card.style.top = Math.max(8, Math.min(r.top, innerHeight - ch - 8)) + 'px';
      const url = await snapshot(uid, getStream());
      if (url && card?.contains(prev)) { img.src = url; prev.classList.add('has'); }
    }, 350);
  });
  row.addEventListener('mouseleave', (e) => { clearTimeout(cardTimer); if (!e.relatedTarget?.closest?.('.streamcard')) setTimeout(() => { if (card && !card.matches(':hover')) hideStreamCard(); }, 120); });
}

// ---------- janela flutuante (miniatura) ----------
// ctx: { voice, roomName(), openRoom(), settings(), stop(), streamOf(uid), nameOf(uid) }
let pip = null, pipKey = null;
const pos = { x: null, y: null, w: 320 };
const clamp = () => {
  if (!pip) return;
  const w = pip.offsetWidth, hh = pip.offsetHeight;
  pos.x = Math.max(8, Math.min(pos.x ?? innerWidth - w - 24, innerWidth - w - 8));
  pos.y = Math.max(8, Math.min(pos.y ?? innerHeight - hh - 24, innerHeight - hh - 8));
  pip.style.transform = `translate(${pos.x}px,${pos.y}px)`;
};
function build() {
  pip = h('div.livepip');
  pip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button,.lp-resize')) return;
    const sx = e.clientX - (pos.x ?? 0), sy = e.clientY - (pos.y ?? 0);
    pip.classList.add('drag'); pip.setPointerCapture(e.pointerId);
    const mv = (m) => { pos.x = m.clientX - sx; pos.y = m.clientY - sy; clamp(); };
    const up = () => { pip.classList.remove('drag'); pip.removeEventListener('pointermove', mv); pip.removeEventListener('pointerup', up); };
    pip.addEventListener('pointermove', mv); pip.addEventListener('pointerup', up);
  });
  document.body.append(pip);
}
function resizer() {
  return h('div.lp-resize', {
    onpointerdown: (e) => {
      e.stopPropagation(); const el = e.currentTarget, sx = e.clientX, w0 = pos.w; el.setPointerCapture(e.pointerId);
      const mv = (m) => { pos.w = Math.max(240, Math.min(640, w0 + m.clientX - sx)); pip.style.width = pos.w + 'px'; clamp(); };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    },
  });
}
export function removePip() { pip?.remove(); pip = null; pipKey = null; }
export function updatePip(ctx) {
  const { voice } = ctx;
  const outside = voice?.active && S.view.cid !== voice.channelId;
  const mineUp = !!voice?.screen;
  const theirs = outside && !mineUp ? [...voice.peers.keys()].find(uid => S.voice.get(uid)?.screen && !voice.closedStreams.has(uid) && ctx.streamOf(uid)) : null;
  if (!outside || (!mineUp && !theirs)) return removePip();
  const key = mineUp ? 'me' : theirs, stream = mineUp ? null : ctx.streamOf(theirs);
  if (!pip) build();
  if (pipKey !== key + (stream?.id || '')) {
    pipKey = key + (stream?.id || '');
    let body;
    if (mineUp) body = h('div.lp-idle', h('b', 'Sua transmissão continua ativa!'), h('span', 'Pausamos esta prévia para economizar recursos.'));
    else { const v = h('video', { autoplay: true, playsInline: true, muted: true, disablePictureInPicture: true }); v.muted = true; v.srcObject = stream; v.play?.().catch(() => { }); body = v; }
    pip.replaceChildren(
      h('div.lp-video', body),
      h('div.lp-top', h('div.lp-title', { role: 'button', title: 'Voltar para a sala', onclick: ctx.openRoom }, icon('chevl', 18), h('span', ctx.roomName()))),
      h('div.lp-bottom', h('span.lp-name', mineUp ? S.me.display_name : ctx.nameOf(theirs)),
        h('span.lp-btns', mineUp && h('button.ibtn', { title: 'Configurações da transmissão', onclick: ctx.settings }, icon('gear', 20)),
          h('button.ibtn', { title: mineUp ? 'Parar transmissão' : 'Fechar transmissão', onclick: () => (mineUp ? ctx.stop() : (voice.closeStream(theirs), updatePip(ctx))) }, icon(mineUp ? 'screen' : 'x', 20)))),
      resizer());
  }
  pip.style.width = pos.w + 'px';
  clamp();
}
addEventListener('resize', clamp);
