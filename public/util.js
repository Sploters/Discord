// DOM helper: h('div.cls#id', {onclick, style:{}}, ...children)
export function h(tag, props, ...kids) {
  const m = tag.match(/^([a-z0-9]*)((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  for (const p of (m[2].match(/[.#][\w-]+/g) || [])) p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1));
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c.nodeType ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}

const I = {
  hash: 'M5.88 4.12 6.4 2H8.5l-.52 2.12h5.5L14 2h2.1l-.52 2.12H18v2h-2.92l-.5 2H18v2h-3.9l-.5 2.12H16.5v2H13l-.52 2.12h-2.1l.52-2.12H5.88l-.52 2.12H3.25L3.77 14H1v-2h3.3l.5-2H2V8h3.3l.58-2.12zM8.4 10.12l-.5 2h5.5l.5-2z',
  voice: 'M12 3a1 1 0 0 0-1-1h-.06a1 1 0 0 0-.74.32L5.92 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.92l4.28 4.68a1 1 0 0 0 .74.32H11a1 1 0 0 0 1-1V3ZM15.1 20.75c-.58.14-1.1-.33-1.1-.92v-.03c0-.5.37-.92.85-1.05a7 7 0 0 0 0-13.5A1.11 1.11 0 0 1 14 4.2v-.03c0-.6.52-1.06 1.1-.92a9 9 0 0 1 0 17.5Z M15.16 16.51c-.57.28-1.16-.2-1.16-.83v-.14c0-.43.28-.8.63-1.02a3 3 0 0 0 0-5.04c-.35-.23-.63-.6-.63-1.02v-.14c0-.63.59-1.1 1.16-.83a5 5 0 0 1 0 9.02Z',
  mic: 'M14.99 11A2.99 2.99 0 0 1 12 14a3 3 0 0 1-3-3V5a3 3 0 0 1 6 0v6ZM12 16a5 5 0 0 0 5-5h2a7 7 0 0 1-6 6.92V21h-2v-3.08A7 7 0 0 1 5 11h2a5 5 0 0 0 5 5Z',
  micoff: 'M6.7 11H5a7 7 0 0 0 6 6.92V21h2v-3.08c.9-.13 1.74-.45 2.47-.92l-1.45-1.45A5 5 0 0 1 6.7 11ZM15 11.17V5a3 3 0 0 0-5.92-.68L15 10.24v.93ZM3.7 2.3 2.3 3.7l18 18 1.4-1.4-2.5-2.5A6.97 6.97 0 0 0 19 11h-2a5 5 0 0 1-.62 2.38L15.1 12.1',
  headset: 'M12 2a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H5v-1a7 7 0 0 1 14 0v1h-2a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9Z',
  headoff: 'M12 2a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H5v-1a7 7 0 0 1 14 0v1h-2a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9ZM3.7 2.3 2.3 3.7l18 18 1.4-1.4Z',
  gear: 'M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.05.24.26.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z',
  plus: 'M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6V5Z',
  minus: 'M5 11h14v2H5z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2zM11 20h2v3h-2zM1 11h3v2H1zM20 11h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zM16.3 17.7l1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z',
  moon: 'M21 14.5A9 9 0 0 1 9.5 3a9 9 0 1 0 11.5 11.5z',
  pipette: 'M19.4 2.6a2.1 2.1 0 0 0-3 0l-2.6 2.6-1.4-1.4-1.4 1.4 1.4 1.4-8 8V19h4.4l8-8 1.4 1.4 1.4-1.4-1.4-1.4 2.6-2.6a2.1 2.1 0 0 0 0-3zM7.6 17H6v-1.6l7.4-7.4 1.6 1.6z',
  sparkle: 'M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z',
  x: 'M18.4 4L12 10.4 5.6 4 4 5.6l6.4 6.4L4 18.4 5.6 20l6.4-6.4 6.4 6.4 1.6-1.6-6.4-6.4L20 5.6z',
  caret: 'M7 10l5 5 5-5z',
  reply: 'M10 8.26V4.46a.5.5 0 0 0-.82-.38L2.2 9.8a.5.5 0 0 0 0 .77l6.98 5.72a.5.5 0 0 0 .82-.38v-3.86c6 0 9.39 1.73 11.5 5.67.15.27.5-.1.5-.25C22 11.62 17.5 8.26 10 8.26Z',
  edit: 'm16.3 3.3 4.4 4.4-12 12-5.1.7.7-5.1ZM18 1.6l4.4 4.4-1.7 1.7-4.4-4.4Z',
  trash: 'M5 7h14l-1.2 13a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8ZM9 3h6l1 1h4v2H4V4h4Z',
  smile: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-4 7.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm6 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM12 18a6 6 0 0 1-5.2-3h10.4A6 6 0 0 1 12 18Z',
  sidebar: 'M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v12h4V6Zm6 0v12h10V6Z',
  star: 'M12 2l3 6.3 6.9.9-5 4.8 1.3 6.9-6.2-3.3-6.2 3.3 1.3-6.9-5-4.8 6.9-.9Z',
  totop: 'M4 3h16v2.5H4Zm8 4.5 7 7-1.8 1.8-3.9-3.9V21h-2.6v-8.6l-3.9 3.9L5 14.5Z',
  pin: 'M16 3v2l-1 1v5l3 3v2h-5v5l-1 1-1-1v-5H6v-2l3-3V6L8 5V3Z',
  upload: 'M11 15V5.8l-3.3 3.3L6.3 7.7 12 2l5.7 5.7-1.4 1.4L13 5.8V15Zm-6 2h14v4H5Z',
  file: 'M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5Z',
  video: 'M4 5h10a2 2 0 0 1 2 2v2.6l4.3-2.7a.5.5 0 0 1 .7.4v9.4a.5.5 0 0 1-.7.4L16 14.4V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  screen: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v9h16V6Z',
  phoneoff: 'M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1A15.07 15.07 0 0 0 12 9Z',
  users: 'M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM2 20a8 8 0 0 1 16 0v1H2Zm16.5-8.5a3 3 0 1 0 0-6 4 4 0 0 1 0 6Zm1.2 1.7c2.6.7 4.3 3 4.3 5.8v1h-3v-1c0-2.1-.5-4-1.3-5.8Z',
  bell: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Zm6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 1 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1Z',
  check: 'm9 16.2-3.5-3.5L4 14.1 9 19 20 8l-1.4-1.4Z',
  dl: 'M5 20h14v-2H5v2ZM19 9h-4V3H9v6H5l7 7 7-7Z',
  dm: 'M5 4h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7l-5 4v-4H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm3 5.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z',
  more: 'M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  search: 'M21.7 20.3 16.6 15.2a8 8 0 1 0-1.4 1.4l5.1 5.1ZM4 10a6 6 0 1 1 12 0 6 6 0 0 1-12 0Z',
  crown: 'M2 7l5 4 5-7 5 7 5-4-2 12H4Z',
  phone: 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1Z',
  expand: 'M4 4h6v2H6v4H4Zm10 0h6v6h-2V6h-4ZM4 14h2v4h4v2H4Zm14 0h2v6h-6v-2h4Z',
  sliders: 'M4 6h9v2H4Zm11 0h5v2h-5ZM13 4h2v6h-2ZM4 16h3v2H4Zm5 0h11v2H9ZM7 14h2v6H7Z',
  image: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm2 12h12l-3.5-5-3 4-2-2.5ZM8 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  music: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3Z',
  waves: 'M3 10.5a1 1 0 0 1 2 0v3a1 1 0 0 1-2 0ZM7 7.5a1 1 0 0 1 2 0v9a1 1 0 0 1-2 0ZM11 4a1 1 0 0 1 2 0v16a1 1 0 0 1-2 0ZM15 7.5a1 1 0 0 1 2 0v9a1 1 0 0 1-2 0ZM19 10.5a1 1 0 0 1 2 0v3a1 1 0 0 1-2 0Z',
  wifi: 'M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3a4.24 4.24 0 0 0-6 0zm-4-4l2 2a7.07 7.07 0 0 1 10 0l2-2C15.14 9.14 8.87 9.14 5 13z',
  music: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z',
  play: 'M8 5v14l11-7Z',
  pause: 'M6 5h4v14H6Zm8 0h4v14h-4Z',
  stop: 'M6 6h12v12H6Z',
  send: 'M3 20.5v-6.2l9-2.3-9-2.3V3.5L22 12Z',
  eye: 'M12 5C7 5 2.7 8.1 1 12.5 2.7 16.9 7 20 12 20s9.3-3.100 11-7.500C21.300 8.100 17 5 12 5Zm0 12.500a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  translate: 'M12.870 15.070l-2.540-2.510.030-.030A17.520 17.520 0 0 0 14.070 6H17V4h-7V2H8v2H1v2h11.170C11.500 7.920 10.440 9.750 9 11.350 8.070 10.320 7.300 9.190 6.690 8h-2c.730 1.630 1.730 3.170 2.980 4.560l-5.090 5.020L4 19l5-5 3.110 3.110.76-2.040ZM18.500 10h-2L12 22h2l1.120-3h4.750L21 22h2l-4.500-12Zm-2.620 7 1.620-4.330L19.120 17h-3.240Z',
  rotate: 'M12 4V1l4 4-4 4V6a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8Z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11Z',
  external: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2ZM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3Z',
  chevl: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12Z',
  chevr: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6Z',
  link: 'M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12ZM8 13h8v-2H8Zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10Z',
};
export const icon = (name, size) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'icon');
  if (size) { s.style.width = s.style.height = size + 'px'; }
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', I[name] || ''); s.append(p); return s;
};

export const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const initials = (s) => (s || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();

// enquadramento "x,y,zoom" (x/y em %, zoom 1–3) aplicado a um <img> com object-fit: cover
export const parsePos = (s) => { const m = String(s || '').split(',').map(Number); return m.length === 3 && m.every(Number.isFinite) ? { x: m[0], y: m[1], z: m[2] } : { x: 50, y: 50, z: 1 }; };
export function framePos(img, s) {
  const p = parsePos(s); img.style.objectFit = 'cover'; img.style.objectPosition = p.x + '% ' + p.y + '%';
  img.style.transformOrigin = p.x + '% ' + p.y + '%'; img.style.transform = p.z > 1 ? 'scale(' + p.z + ')' : '';
  return img;
}
export function avatar(u, size = 40, opts = {}) {
  const el = h('div.avatar', { style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * .42) + 'px', background: u?.color || '#5865f2' } });
  if (u?.avatar) el.append(framePos(h('img', { src: u.avatar, alt: '', loading: 'lazy' }), u.avatar_pos)); else el.append((u?.display_name || u?.username || '?')[0].toUpperCase());
  if (opts.status !== false && u) el.append(h('div.status.s-' + (u.status || 'offline'), { style: { borderColor: opts.ring || '' } }));
  return el;
}

// ---- tempo ----
const pad = (n) => String(n).padStart(2, '0');
let H12 = false; export const setHour12 = (v) => { H12 = !!v; };
export const clock = (t) => { const d = new Date(+t); if (H12) return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`; return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function stamp(t) {
  const d = new Date(+t), n = new Date(), y = new Date(Date.now() - 864e5);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, n)) return `Hoje às ${clock(t)}`;
  if (same(d, y)) return `Ontem às ${clock(t)}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${clock(t)}`;
}
export const dayLabel = (t) => new Date(+t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
export const sameDay = (a, b) => new Date(+a).toDateString() === new Date(+b).toDateString();
export const bytes = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B';

// ---- markdown estilo Discord (sempre escapa primeiro) ----
export function md(src, ctx = {}) {
  const store = [];
  const keep = (html) => `\u0000${store.push(html) - 1}\u0000`;
  let s = String(src);
  s = s.replace(/```(?:[\w+-]*\n)?([\s\S]*?)```/g, (_, c) => keep(`<pre class="md-pre">${esc(c.replace(/\n$/, ''))}</pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, c) => keep(`<span class="md-code">${esc(c)}</span>`));
  s = esc(s);
  s = s.replace(/&lt;@(\d+)&gt;/g, (_, id) => { const n = ctx.userName?.(id); return n ? `<span class="mention" data-uid="${id}">@${esc(n)}</span>` : '<span class="mention">@desconhecido</span>'; });
  s = s.replace(/&lt;:(\w+):(\d+)&gt;/g, (_, name, id) => { const u = ctx.emojiUrl?.(id); return u ? `<img class="cemoji" src="${esc(u)}" alt=":${name}:" title=":${name}:">` : `:${name}:`; });
  s = s.replace(/:([a-z0-9_+-]+):/g, (m, n) => SHORT[n] || m);
  s = s.replace(/(^|\s)(@everyone|@here)\b/g, '$1<span class="mention">$2</span>');
  s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<b><i>$1</i></b>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+)__/g, '<u>$1</u>').replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>').replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler">$1</span>');
  s = s.replace(/^(#{1,3}) (.+)$/gm, (_, h, t) => `<span class="md h${h.length}" style="display:block;font-weight:700;font-size:${[1.5, 1.25, 1.1][h.length - 1]}em;margin:6px 0 2px">${t}</span>`);
  s = s.replace(/^&gt; (.*)$/gm, '<span class="md-quote">$1</span>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => store[+i]);
  s = s.replace(/<\/span>\n/g, m => m.length > 8 ? '</span>' : m).replace(/<\/pre>\n/g, '</pre>');
  return s;
}
export const SHORT = { smile: '😄', grin: '😁', joy: '😂', rofl: '🤣', wink: '😉', heart_eyes: '😍', kiss: '😘', thinking: '🤔', sunglasses: '😎', cry: '😢', sob: '😭', angry: '😠', rage: '😡', scream: '😱', sleepy: '😴', skull: '💀', ghost: '👻', poop: '💩', clown: '🤡', robot: '🤖', thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', ok_hand: '👌', wave: '👋', clap: '👏', pray: '🙏', muscle: '💪', fire: '🔥', star: '⭐', sparkles: '✨', zap: '⚡', boom: '💥', '100': '💯', heart: '❤️', broken_heart: '💔', tada: '🎉', gift: '🎁', trophy: '🏆', rocket: '🚀', eyes: '👀', check: '✅', x: '❌', warning: '⚠️', question: '❓', pizza: '🍕', beer: '🍺', coffee: '☕', cake: '🎂', dog: '🐶', cat: '🐱', sun: '☀️', moon: '🌙', rainbow: '🌈', lol: '😆', ok: '👌', shrug: '🤷', facepalm: '🤦' };
// links de convite (/invite/CODIGO, com ou sem endereço) viram cartão no chat
const INVITE_G = /(?:https?:\/\/[^\s/]+|(?<![\w./]))\/invite\/([A-Za-z0-9_-]{4,32})\b/g;
export const inviteCodes = (s) => [...new Set([...String(s || '').matchAll(INVITE_G)].map(m => m[1]))].slice(0, 3);
export const stripInvites = (s) => String(s || '').replace(INVITE_G, '').replace(/[ \t]+$/gm, '').trim();
export const inviteText = (s) => String(s || '').replace(INVITE_G, '📨 Convite de servidor');
export const isImageUrl = (u) => /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif)(\?\S*)?$/i.test(u);
export const onlyEmoji = (s) => /^(\s*(\p{Extended_Pictographic}|\p{Emoji_Presentation})(️|‍|\p{Emoji_Modifier})*\s*){1,27}$/u.test(s.trim()) && s.trim().length > 0;

export const EMOJIS = {
  'Rostos': '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 ☠️ 👽 👾 🤖'.split(' '),
  'Gestos': '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 🤏 💪 🙏 🤝 👏 🙌 👐 🤲 ✍️ 💅 🤳'.split(' '),
  'Corações': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟'.split(' '),
  'Objetos': '🎉 🎊 🎈 🎁 🏆 🥇 ⚽ 🏀 🎮 🎲 🎯 🎵 🎶 🎤 🎧 📷 💻 📱 💡 🔥 ⭐ 🌟 ✨ ⚡ 💥 💯 ✅ ❌ ❓ ❗ ⚠️ 🚀 🍕 🍔 🍟 🍺 ☕ 🍰 🍎 🐶 🐱 🦊 🐸 🐵 🌈 ☀️ 🌙'.split(' '),
};
