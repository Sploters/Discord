import { h, icon } from './util.js';
import { S } from './state.js';

// Lousa compartilhada e desenhos sobre as transmissões: traços em coordenadas de 0 a 1, enviados pela sala de voz
const boards = new Map(); // id ('wb' ou 's:<uid>') -> [{ id, uid, color, w, pts }]
const views = new Set(); // canvases abertos: { id, canvas, paint }
let send = () => { };
export const initBoard = (fn) => { send = fn; };
export const tool = { color: '#ff4d4d', w: 4 };
const COLORS = ['#ff4d4d', '#ffd43b', '#51cf66', '#4dabf7', '#ffffff', '#111111'];
const list = (id) => { let l = boards.get(id); if (!l) boards.set(id, l = []); return l; };
const repaint = (id) => { for (const v of views) { if (!v.canvas.isConnected) views.delete(v); else if (!id || v.id === id) v.paint(); } };

export function boardState(map) { boards.clear(); for (const [id, l] of Object.entries(map || {})) boards.set(id, l); repaint(); }
export function onDraw(d) {
  const l = list(d.board);
  if (d.op === 'clear') boards.set(d.board, []);
  else if (d.op === 'undo') { const i = l.findLastIndex(s => s.uid === d.user_id); if (i >= 0) l.splice(i, 1); }
  else if (d.op === 'stroke' && d.stroke) {
    let s = l.find(x => x.id === d.stroke.id && x.uid === d.user_id);
    if (!s) l.push(s = { id: d.stroke.id, uid: d.user_id, color: d.stroke.color, w: d.stroke.w, pts: [] });
    s.pts.push(...d.stroke.pts);
  }
  repaint(d.board);
}
export const hasStrokes = (id) => (boards.get(id)?.length || 0) > 0;

// canvas de um quadro. video: se for sobre uma transmissão, acompanha a área real do vídeo e o zoom dele
export function boardCanvas(id, { interactive = false, video = null } = {}) {
  const canvas = h('canvas.board' + (video ? '.over' : '.wb') + (interactive ? '.live' : ''));
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
    const g = canvas.getContext('2d'), a = area(); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
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
    let cur = null, buf = [], timer = 0;
    const pt = (e) => { const r = canvas.getBoundingClientRect(), a = area(), x = ((e.clientX - r.left) / r.width * canvas.clientWidth - a.x) / a.w, y = ((e.clientY - r.top) / r.height * canvas.clientHeight - a.y) / a.h; return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]; };
    const flush = () => { timer = 0; if (cur && buf.length) { send('ROOM_DRAW', { board: id, op: 'stroke', stroke: { id: cur.id, color: cur.color, w: cur.w, pts: buf } }); buf = []; } };
    canvas.onpointerdown = (e) => {
      if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); canvas.setPointerCapture(e.pointerId);
      const p = pt(e); cur = { id: S.me.id.slice(0, 8) + Date.now().toString(36), uid: S.me.id, color: tool.color, w: tool.w, pts: [p] }; list(id).push(cur); buf = [p]; paint();
      timer = setTimeout(flush, 40);
    };
    canvas.onpointermove = (e) => { if (!cur) return; const p = pt(e); cur.pts.push(p); buf.push(p); paint(); if (!timer) timer = setTimeout(flush, 40); };
    canvas.onpointerup = canvas.onpointercancel = () => { if (!cur) return; clearTimeout(timer); flush(); cur = null; };
    canvas.onclick = canvas.ondblclick = (e) => e.stopPropagation();
  }
  return canvas;
}
export const undo = (id) => { const l = list(id), i = l.findLastIndex(s => s.uid === S.me.id); if (i >= 0) l.splice(i, 1); send('ROOM_DRAW', { board: id, op: 'undo' }); repaint(id); };
export const clearBoard = (id) => { boards.set(id, []); send('ROOM_DRAW', { board: id, op: 'clear' }); repaint(id); };

// barra de ferramentas: cores, espessura, desfazer, limpar
export function boardTools(id, extra) {
  const bar = h('div.btools', { onclick: (e) => e.stopPropagation(), onpointerdown: (e) => e.stopPropagation() });
  const draw = () => bar.replaceChildren(
    ...COLORS.map(c => h('button.bcol' + (tool.color === c ? '.on' : ''), { style: { background: c }, title: 'Cor', onclick: () => { tool.color = c; draw(); } })),
    h('input.bw', { type: 'range', min: 2, max: 20, step: 1, value: tool.w, title: 'Espessura', oninput: (e) => { tool.w = +e.target.value; } }),
    h('button.ibtn', { title: 'Desfazer meu último traço', onclick: () => undo(id) }, icon('rotate', 16)),
    h('button.ibtn', { title: 'Limpar tudo', onclick: () => clearBoard(id) }, icon('trash', 16)),
    ...[].concat(extra || []));
  draw(); return bar;
}
