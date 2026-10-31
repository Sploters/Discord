import { h, icon } from './util.js';

// zoom das transmissões (como no Discord): botões, controle deslizante, minimapa, roda do mouse e arrastar
const st = new Map(); // chave do quadro -> { z, cx, cy } (cx/cy = centro visível, de 0 a 1)
const get = (k) => { let s = st.get(k); if (!s) st.set(k, s = { z: 1, cx: .5, cy: .5 }); return s; };
export const pruneZoom = (live) => { for (const k of [...st.keys()]) if (!live.has(k)) st.delete(k); };
const MIN = 1, MAX = 5;

export function zoomControls(key, vid, stream) {
  const s = get(key);
  vid.style.transformOrigin = '0 0';
  const slider = h('input', { type: 'range', min: MIN, max: MAX, step: .01, value: s.z, 'aria-label': 'Nível de zoom' });
  const mv = h('video', { muted: true, playsInline: true, autoplay: true }); mv.muted = true;
  const ind = h('div.zm-ind'), mini = h('div.zm-mini', mv, ind);
  let mvOn = false;
  const clampC = () => { const m = .5 / s.z; s.cx = Math.max(m, Math.min(1 - m, s.cx)); s.cy = Math.max(m, Math.min(1 - m, s.cy)); };
  const sync = () => {
    s.z = Math.max(MIN, Math.min(MAX, s.z)); clampC();
    vid.style.transform = s.z > 1.001 ? `translate(${(.5 - s.cx * s.z) * 100}%, ${(.5 - s.cy * s.z) * 100}%) scale(${s.z})` : '';
    vid.classList.toggle('zoomed', s.z > 1.001);
    slider.value = s.z; slider.style.setProperty('--p', ((s.z - MIN) / (MAX - MIN)) * 100 + '%');
    mini.style.display = s.z > 1.001 ? '' : 'none';
    if (s.z > 1.001 && !mvOn) { mvOn = true; mv.srcObject = stream; mv.play?.().catch(() => { }); }
    Object.assign(ind.style, { left: (s.cx - .5 / s.z) * 100 + '%', top: (s.cy - .5 / s.z) * 100 + '%', width: 100 / s.z + '%', height: 100 / s.z + '%' });
    box.classList.toggle('on', s.z > 1.001);
  };
  const setZ = (z, px, py) => { // dá zoom mantendo o ponto (px, py) do conteúdo, de 0 a 1, no mesmo lugar da tela
    const old = s.z; s.z = Math.max(MIN, Math.min(MAX, z));
    if (px != null) { const u = .5 + (px - s.cx) * old, w = .5 + (py - s.cy) * old; s.cx = px - (u - .5) / s.z; s.cy = py - (w - .5) / s.z; }
    sync();
  };
  const stop = (e) => e.stopPropagation();
  const step = (d) => setZ(Math.round((s.z + d) * 100) / 100);
  const miniMove = (e) => { const r = mini.getBoundingClientRect(); s.cx = (e.clientX - r.left) / r.width; s.cy = (e.clientY - r.top) / r.height; sync(); };
  mini.onpointerdown = (e) => { e.stopPropagation(); mini.setPointerCapture(e.pointerId); miniMove(e); mini.onpointermove = miniMove; mini.onpointerup = () => { mini.onpointermove = mini.onpointerup = null; }; };
  slider.oninput = () => setZ(+slider.value);
  const box = h('div.zoomctl', { onclick: stop, ondblclick: stop, oncontextmenu: stop, onpointerdown: stop },
    mini,
    h('div.zm-row',
      h('button.ibtn', { title: 'Diminuir zoom', onclick: () => step(-.5) }, icon('minus', 16)), slider,
      h('button.ibtn', { title: 'Aumentar zoom', onclick: () => step(.5) }, icon('plus', 16)),
      h('button.ibtn.zm-reset', { title: 'Restaurar', onclick: () => { s.z = 1; s.cx = s.cy = .5; sync(); } }, icon('rotate', 16))));
  // roda do mouse: zoom; arrastar com zoom: move o quadro
  let drag = null, moved = false;
  vid.onwheel = (e) => {
    e.preventDefault(); const r = vid.getBoundingClientRect();
    setZ(s.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  vid.onpointerdown = (e) => {
    if (e.button !== 0 || s.z <= 1.001) return;
    drag = { x: e.clientX, y: e.clientY, cx: s.cx, cy: s.cy }; moved = false; vid.setPointerCapture(e.pointerId); vid.classList.add('panning');
  };
  vid.onpointermove = (e) => {
    if (!drag) return;
    const r = vid.getBoundingClientRect(), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    s.cx = drag.cx - dx / r.width / 1; s.cy = drag.cy - dy / r.height / 1; sync();
  };
  vid.onpointerup = vid.onpointercancel = () => { drag = null; vid.classList.remove('panning'); };
  vid.onclick = (e) => { if (moved) { e.stopPropagation(); moved = false; } };
  sync();
  return box;
}
