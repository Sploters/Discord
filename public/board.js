import { h, icon } from './util.js';
import { S } from './state.js';

// Lousa compartilhada e desenhos sobre as transmissões: traços em coordenadas de 0 a 1, enviados pela sala de voz
const boards = new Map(); // id ('wb' ou 's:<uid>') -> [{ id, uid, color, w, pts }]
const views = new Set(); // canvases abertos: { id, canvas, paint }
const zooms = new Map(); // id -> { z, x, y }: zoom e deslocamento da lousa (só na minha tela)
let send = () => { };
export const initBoard = (fn) => { send = fn; };
export const tool = { color: '#ff4d4d', w: 4, erase: false };
const COLORS = ['#ff4d4d', '#ff922b', '#ffd43b', '#51cf66', '#20c997', '#4dabf7', '#7950f2', '#f06595', '#ffffff', '#adb5bd', '#8d6e63', '#111111'];
const ZMIN = .25, ZMAX = 6;
const list = (id) => { let l = boards.get(id); if (!l) boards.set(id, l = []); return l; };
const repaint = (id) => { for (const v of views) { if (!v.canvas.isConnected) views.delete(v); else if (!id || v.id === id) v.paint(); } };
const zoomOf = (id) => { let z = zooms.get(id); if (!z) zooms.set(id, z = { z: 1, x: 0, y: 0 }); return z; };

export function boardState(map) { boards.clear(); for (const [id, l] of Object.entries(map || {})) boards.set(id, l); repaint(); }
export function onDraw(d) {
  const l = list(d.board);
  if (d.op === 'clear') boards.set(d.board, []);
  else if (d.op === 'undo') { const i = l.findLastIndex(s => s.uid === d.user_id); if (i >= 0) l.splice(i, 1); }
  else if (d.op === 'erase') { const ids = new Set(d.ids || []); boards.set(d.board, l.filter(s => !ids.has(s.id))); }
  else if (d.op === 'stroke' && d.stroke) {
    let s = l.find(x => x.id === d.stroke.id && x.uid === d.user_id);
    if (!s) l.push(s = { id: d.stroke.id, uid: d.user_id, color: d.stroke.color, w: d.stroke.w, pts: [] });
    s.pts.push(...d.stroke.pts);
  }
  repaint(d.board);
}
export const hasStrokes = (id) => (boards.get(id)?.length || 0) > 0;

// distância de um ponto a um segmento
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// canvas de um quadro. video: se for sobre uma transmissão, acompanha a área real do vídeo e o zoom dele
export function boardCanvas(id, { interactive = false, video = null } = {}) {
  const canvas = h('canvas.board' + (video ? '.over' : '.wb') + (interactive ? '.live' : ''));
  const zoomable = !video; // a lousa tem zoom próprio; sobre uma transmissão vale o zoom do vídeo
  const area = () => { // retângulo (em px do canvas) onde o conteúdo aparece: o vídeo usa "contain"
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!video?.videoWidth) return { x: 0, y: 0, w: cw, h: ch };
    const k = Math.min(cw / video.videoWidth, ch / video.videoHeight), w = video.videoWidth * k, hh = video.videoHeight * k;
    return { x: (cw - w) / 2, y: (ch - hh) / 2, w, h: hh };
  };
  const paint = () => {
    const dpr = devicePixelRatio || 1, cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    const g = canvas.getContext('2d'), a = area(), vw = zoomable ? zoomOf(id) : { z: 1, x: 0, y: 0 };
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.toggle('empty', !(boards.get(id) || []).length); // app desktop: sem desenho, a camada some de cima do vídeo
    g.setTransform(dpr * vw.z, 0, 0, dpr * vw.z, dpr * vw.x, dpr * vw.y);
    g.lineCap = g.lineJoin = 'round';
    for (const s of boards.get(id) || []) {
      g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = s.w * Math.max(.5, a.w / 800);
      const p = s.pts; if (!p.length) continue;
      if (p.length === 1) { g.beginPath(); g.arc(a.x + p[0][0] * a.w, a.y + p[0][1] * a.h, g.lineWidth / 2, 0, 7); g.fill(); continue; }
      g.beginPath(); g.moveTo(a.x + p[0][0] * a.w, a.y + p[0][1] * a.h);
      for (let i = 1; i < p.length; i++) g.lineTo(a.x + p[i][0] * a.w, a.y + p[i][1] * a.h);
      g.stroke();
    }
  };
  const view = { id, canvas, paint }; views.add(view);
  new ResizeObserver(paint).observe(canvas); setTimeout(paint, 0);
  if (video) { // copia o zoom/posição do vídeo para o desenho ficar no mesmo lugar
    canvas.style.transformOrigin = '0 0';
    const sync = () => { canvas.style.transform = video.style.transform; paint(); };
    new MutationObserver(sync).observe(video, { attributes: true, attributeFilter: ['style'] }); sync();
    video.addEventListener('loadedmetadata', paint); video.addEventListener('resize', paint);
  }
  if (interactive) {
    let cur = null, buf = [], timer = 0, pan = null, erasing = null;
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * canvas.clientWidth, (e.clientY - r.top) / r.height * canvas.clientHeight]; };
    const world = (e) => { const [sx, sy] = local(e), v = zoomable ? zoomOf(id) : { z: 1, x: 0, y: 0 }; return [(sx - v.x) / v.z, (sy - v.y) / v.z]; };
    const lim = zoomable ? [-4, 5] : [0, 1]; // na lousa dá para desenhar além da área inicial depois de afastar o zoom
    const pt = (e) => { const [wx, wy] = world(e), a = area(); return [Math.max(lim[0], Math.min(lim[1], (wx - a.x) / a.w)), Math.max(lim[0], Math.min(lim[1], (wy - a.y) / a.h))]; };
    const flush = () => { timer = 0; if (cur && buf.length) { send('ROOM_DRAW', { board: id, op: 'stroke', stroke: { id: cur.id, color: cur.color, w: cur.w, pts: buf } }); buf = []; } };
    // borracha: apaga os traços (de qualquer pessoa) que passam perto do ponteiro
    const erase = (e) => {
      const [wx, wy] = world(e), a = area(), k = Math.max(.5, a.w / 800), z = zoomable ? zoomOf(id).z : 1, hit = [];
      const l = list(id);
      for (const s of l) {
        const r = s.w * k / 2 + 10 / z, p = s.pts;
        const X = (i) => a.x + p[i][0] * a.w, Y = (i) => a.y + p[i][1] * a.h;
        let near = p.length === 1 ? Math.hypot(wx - X(0), wy - Y(0)) <= r : false;
        for (let i = 1; !near && i < p.length; i++) near = segDist(wx, wy, X(i - 1), Y(i - 1), X(i), Y(i)) <= r;
        if (near) hit.push(s.id);
      }
      if (hit.length) { const ids = new Set(hit); boards.set(id, l.filter(s => !ids.has(s.id))); paint(); send('ROOM_DRAW', { board: id, op: 'erase', ids: hit }); }
    };
    canvas.oncontextmenu = (e) => e.preventDefault();
    canvas.onpointerenter = () => { canvas.style.cursor = tool.erase ? 'cell' : 'crosshair'; };
    canvas.onpointerdown = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (zoomable && (e.button === 1 || e.button === 2)) { const v = zoomOf(id); pan = { sx: e.clientX, sy: e.clientY, x: v.x, y: v.y }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; return; } // botão do meio/direito arrasta a lousa
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      if (tool.erase) { erasing = true; erase(e); return; }
      const p = pt(e); cur = { id: S.me.id.slice(0, 8) + Date.now().toString(36), uid: S.me.id, color: tool.color, w: tool.w, pts: [p] }; list(id).push(cur); buf = [p]; paint();
      timer = setTimeout(flush, 40);
    };
    canvas.onpointermove = (e) => {
      if (pan) { const v = zoomOf(id); v.x = pan.x + e.clientX - pan.sx; v.y = pan.y + e.clientY - pan.sy; paint(); return; }
      if (erasing) return erase(e);
      if (!cur) return; const p = pt(e); cur.pts.push(p); buf.push(p); paint(); if (!timer) timer = setTimeout(flush, 40);
    };
    canvas.onpointerup = canvas.onpointercancel = () => {
      if (pan) { pan = null; canvas.style.cursor = tool.erase ? 'cell' : 'crosshair'; return; }
      if (erasing) { erasing = null; return; }
      if (!cur) return; clearTimeout(timer); flush(); cur = null;
    };
    if (zoomable) canvas.addEventListener('wheel', (e) => { e.preventDefault(); const [sx, sy] = local(e); zoomAt(id, Math.pow(1.0015, -e.deltaY), sx, sy); }, { passive: false });
    canvas.onclick = canvas.ondblclick = (e) => e.stopPropagation();
  }
  return canvas;
}
// muda o zoom mantendo o ponto (sx, sy) da tela parado
function zoomAt(id, f, sx, sy) {
  const v = zoomOf(id), nz = Math.max(ZMIN, Math.min(ZMAX, v.z * f)), k = nz / v.z;
  v.x = sx - (sx - v.x) * k; v.y = sy - (sy - v.y) * k; v.z = nz;
  if (Math.abs(v.z - 1) < .02) { v.z = 1; }
  repaint(id); document.querySelectorAll(`.bzoom[data-b="${id}"]`).forEach(b => (b.textContent = Math.round(v.z * 100) + '%'));
}
const zoomCenter = (id, f) => { const c = [...views].find(v => v.id === id && v.canvas.isConnected)?.canvas; if (c) zoomAt(id, f, c.clientWidth / 2, c.clientHeight / 2); };
export const undo = (id) => { const l = list(id), i = l.findLastIndex(s => s.uid === S.me.id); if (i >= 0) l.splice(i, 1); send('ROOM_DRAW', { board: id, op: 'undo' }); repaint(id); };
export const clearBoard = (id) => { boards.set(id, []); send('ROOM_DRAW', { board: id, op: 'clear' }); repaint(id); };

// barra de ferramentas: caneta/borracha, cores (com seletor RGB), espessura, zoom (só na lousa), desfazer, limpar
export function boardTools(id, extra) {
  const bar = h('div.btools', { onclick: (e) => e.stopPropagation(), onpointerdown: (e) => e.stopPropagation(), onwheel: (e) => e.stopPropagation() });
  const cols = COLORS.map(c => h('button.bcol', { style: { background: c }, title: c, 'data-c': c, onclick: () => { tool.color = c; tool.erase = false; sync(); } }));
  const customIn = h('input', { type: 'color', name: 'board-color', value: tool.color, oninput: (e) => { tool.color = e.target.value; tool.erase = false; sync(true); } });
  const custom = h('label.bpick', { title: 'Cor personalizada (seletor RGB)' }, icon('palette', 14), customIn); // paleta; o seletor nativo fica invisível por cima
  const pen = h('button.ibtn.btool', { title: 'Caneta', onclick: () => { tool.erase = false; sync(); } }, icon('edit', 16));
  const era = h('button.ibtn.btool', { title: 'Borracha (apaga o traço em que passar)', onclick: () => { tool.erase = true; sync(); } }, icon('eraser', 16));
  const sync = (fromPicker) => {
    cols.forEach(b => b.classList.toggle('on', !tool.erase && b.dataset.c === tool.color));
    pen.classList.toggle('on', !tool.erase); era.classList.toggle('on', tool.erase);
    const own = !COLORS.includes(tool.color); custom.classList.toggle('on', !tool.erase && own); custom.style.color = own ? tool.color : ''; if (!fromPicker) customIn.value = /^#[0-9a-f]{6}$/i.test(tool.color) ? tool.color : '#ffffff';
    document.querySelectorAll('canvas.board.live').forEach(c => { c.style.cursor = tool.erase ? 'cell' : 'crosshair'; });
  };
  const zoom = id === 'wb' ? [h('span.bsep'),
    h('button.ibtn', { title: 'Diminuir o zoom', onclick: () => zoomCenter(id, 1 / 1.25) }, icon('minus', 16)),
    h('button.bzoom', { 'data-b': id, title: 'Voltar ao zoom 100% (roda do mouse dá zoom; botão direito ou do meio arrasta)', onclick: () => { zooms.set(id, { z: 1, x: 0, y: 0 }); repaint(id); document.querySelectorAll(`.bzoom[data-b="${id}"]`).forEach(b => (b.textContent = '100%')); } }, Math.round(zoomOf(id).z * 100) + '%'),
    h('button.ibtn', { title: 'Aumentar o zoom', onclick: () => zoomCenter(id, 1.25) }, icon('plus', 16))] : [];
  bar.append(pen, era, h('span.bsep'), ...cols, custom,
    h('input.bw', { type: 'range', min: 2, max: 20, step: 1, value: tool.w, title: 'Espessura', oninput: (e) => { tool.w = +e.target.value; } }),
    ...zoom, h('span.bsep'),
    h('button.ibtn', { title: 'Desfazer meu último traço', onclick: () => undo(id) }, icon('rotate', 16)),
    h('button.ibtn', { title: 'Limpar tudo', onclick: () => clearBoard(id) }, icon('trash', 16)),
    ...[].concat(extra || []));
  sync(); return bar;
}
