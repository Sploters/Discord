// DOM helper: h('div.cls#id', {onclick, style:{}}, ...children)
export function h(tag, props, ...kids) {
  const m = tag.match(/^([a-z0-9]*)((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  for (const p of (m[2].match(/[.#][\w-]+/g) || [])) p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1));
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } } // variáveis CSS (--x) só entram por setProperty
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c.nodeType ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}

const I = {
  gamepad: 'M7.5 7h9A5.5 5.5 0 0 1 22 12.5v2.8a2.7 2.7 0 0 1-4.9 1.6l-1.5-2H8.4l-1.5 2A2.7 2.7 0 0 1 2 15.3v-2.8A5.5 5.5 0 0 1 7.5 7Zm-.5 3v1.5H5.5v1.5H7v1.5h1.5V13H10v-1.5H8.5V10H7Zm9.5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  layout: 'M3 5a2 2 0 0 1 2-2h6v10H3V5Zm10-2h6a2 2 0 0 1 2 2v4h-8V3Zm0 8h8v8a2 2 0 0 1-2 2h-6V11ZM3 15h8v6H5a2 2 0 0 1-2-2v-4Z',
  pointer: 'M5.5 2.8a.6.6 0 0 1 .9-.5l13 7.7a.6.6 0 0 1-.1 1.1l-5.5 1.6 3.1 5.6a.6.6 0 0 1-.2.8l-2 1.1a.6.6 0 0 1-.8-.2l-3.1-5.6-4.2 3.9a.6.6 0 0 1-1-.4Z',
  leaf: 'M20.5 3.5C11 3.5 5 7.5 5 14c0 1.6.4 3 1.1 4.1L3.3 21l1.4 1.4 2.8-2.8c1.2.8 2.7 1.2 4.3 1.2 6.6 0 9.9-6 9.9-16.3a1 1 0 0 0-1.2-1Z',
  eraser: 'M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4 4 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0ZM4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-4.95-4.95Z',
  hash: 'M9.45 3h2.05l-2.45 18H7zM15.45 3h2.05l-2.45 18H13zM4.5 8h16v2h-16zM3.5 14h16v2h-16z', // centralizado no quadro 24×24 (o antigo ficava no canto de cima, desalinhado do texto)
  voice: 'M12 3a1 1 0 0 0-1-1h-.06a1 1 0 0 0-.74.32L5.92 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.92l4.28 4.68a1 1 0 0 0 .74.32H11a1 1 0 0 0 1-1V3ZM15.1 20.75c-.58.14-1.1-.33-1.1-.92v-.03c0-.5.37-.92.85-1.05a7 7 0 0 0 0-13.5A1.11 1.11 0 0 1 14 4.2v-.03c0-.6.52-1.06 1.1-.92a9 9 0 0 1 0 17.5Z M15.16 16.51c-.57.28-1.16-.2-1.16-.83v-.14c0-.43.28-.8.63-1.02a3 3 0 0 0 0-5.04c-.35-.23-.63-.6-.63-1.02v-.14c0-.63.59-1.1 1.16-.83a5 5 0 0 1 0 9.02Z',
  mic: 'M14.99 11A2.99 2.99 0 0 1 12 14a3 3 0 0 1-3-3V5a3 3 0 0 1 6 0v6ZM12 16a5 5 0 0 0 5-5h2a7 7 0 0 1-6 6.92V21h-2v-3.08A7 7 0 0 1 5 11h2a5 5 0 0 0 5 5Z',
  micoff: 'M6.7 11H5a7 7 0 0 0 6 6.92V21h2v-3.08c.9-.13 1.74-.45 2.47-.92l-1.45-1.45A5 5 0 0 1 6.7 11ZM15 11.17V5a3 3 0 0 0-5.92-.68L15 10.24v.93ZM3.7 2.3 2.3 3.7l18 18 1.4-1.4-2.5-2.5A6.97 6.97 0 0 0 19 11h-2a5 5 0 0 1-.62 2.38L15.1 12.1',
  headset: 'M12 2a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H5v-1a7 7 0 0 1 14 0v1h-2a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9Z',
  headoff: 'M12 2a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H5v-1a7 7 0 0 1 14 0v1h-2a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9ZM3.7 2.3 2.3 3.7l18 18 1.4-1.4Z',
  gear: 'M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.05.24.26.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z',
  plus: 'M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6V5Z',
  minus: 'M5 11h14v2H5z',
  shrink: 'M9 3v6H3V7h4V3Zm6 0h2v4h4v2h-6ZM3 15h6v6H7v-4H3Zm12 0h6v2h-4v4h-2Z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2zM11 20h2v3h-2zM1 11h3v2H1zM20 11h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zM16.3 17.7l1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z',
  moon: 'M21 14.5A9 9 0 0 1 9.5 3a9 9 0 1 0 11.5 11.5z',
  // conta-gotas: bulbo, anel vazado e tubo com a parte vazia recortada (desenhado em pé e girado 45°)
  pipette: { t: 'rotate(45 12 12) translate(12 12) scale(1.24) translate(-12 -12)', parts: [
    'M9 4.4a3 3 0 0 1 3-3 3 3 0 0 1 3 3v4H9Z',
    'M8.8 9.1h6.4a1.8 1.8 0 0 1 1.8 1.8v0a1.8 1.8 0 0 1-1.8 1.8H8.8A1.8 1.8 0 0 1 7 10.9v0a1.8 1.8 0 0 1 1.8-1.8Zm.6 1.2a.6.6 0 0 0 0 1.2h5.2a.6.6 0 0 0 0-1.2Z',
    'M9.3 13.4h5.4v4.9c0 1.3-.9 2.1-1.8 2.3V22a.9.9 0 0 1-1.8 0v-1.4c-.9-.2-1.8-1-1.8-2.3Zm1.2 1v2.4l3-2.4Z',
  ] },
  // paleta de pintor com quatro tintas vazadas
  palette: { parts: ['M12 2.4c-5.4 0-9.6 4.3-9.6 9.6 0 5.2 4 9.6 8.7 9.6 1.6 0 2.6-1 2.6-2.4 0-.9-.5-1.5-.5-2.4 0-1.8 1.6-3.2 3.4-3.2h1.7c2.3 0 3.7-1.6 3.7-3.7 0-4.2-4.4-7.5-10-7.5Z' +
    'M5.4 9.6a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0ZM8.6 6.4a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0ZM13.6 6.9a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0ZM5.2 14.6a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0Z'] },
  sparkle: 'M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z',
  x: 'M18.4 4L12 10.4 5.6 4 4 5.6l6.4 6.4L4 18.4 5.6 20l6.4-6.4 6.4 6.4 1.6-1.6-6.4-6.4L20 5.6z',
  caret: 'M7 10l5 5 5-5z',
  reply: 'M10 8.26V4.46a.5.5 0 0 0-.82-.38L2.2 9.8a.5.5 0 0 0 0 .77l6.98 5.72a.5.5 0 0 0 .82-.38v-3.86c6 0 9.39 1.73 11.5 5.67.15.27.5-.1.5-.25C22 11.62 17.5 8.26 10 8.26Z',
  edit: 'm16.3 3.3 4.4 4.4-12 12-5.1.7.7-5.1ZM18 1.6l4.4 4.4-1.7 1.7-4.4-4.4Z',
  trash: 'M5 7h14l-1.2 13a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8ZM9 3h6l1 1h4v2H4V4h4Z',
  code: 'M8.7 16.3 4.4 12l4.3-4.3-1.4-1.4L1.6 12l5.7 5.7 1.4-1.4Zm6.6 0 4.3-4.3-4.3-4.3 1.4-1.4 5.7 5.7-5.7 5.7-1.4-1.4Z',
  smile: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-4 7.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm6 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM12 18a6 6 0 0 1-5.2-3h10.4A6 6 0 0 1 12 18Z',
  sidebar: 'M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v12h4V6Zm6 0v12h10V6Z',
  // soundboard (desenho enviado pelo usuário): corneta preenchida + raios em traço
  soundboard: { fill: 'M11.31,12.69C12.67,14.05 13.51,15.52 13.84,16.74C14.19,18.01 13.89,18.56 13.73,18.73C13.56,18.89 13.01,19.19 11.74,18.84C10.52,18.51 9.05,17.67 7.69,16.31C6.33,14.95 5.49,13.48 5.16,12.26C4.81,10.99 5.11,10.44 5.27,10.27C5.44,10.11 5.99,9.81 7.26,10.16C8.48,10.49 9.95,11.33 11.31,12.69ZM12.72,11.28C9.61,8.16 5.64,7.08 3.86,8.86C3.31,9.4 3.04,10.14 3,11.01C3,11.01 3,11 3,11C3,11 1.84,19.92 1.84,19.92C1.67,21.22 2.78,22.33 4.08,22.16C4.08,22.16 13,21 13,21C13,21 12.99,21 12.99,21C13.86,20.96 14.6,20.69 15.14,20.14C16.92,18.36 15.84,14.39 12.72,11.28Z', stroke: 'M9 6L8 3M13 6L14 2M16 8L20 4M18 11L22 10M18 15L21 16' },
  sparkle: 'M11 2l1.9 5.6L18.5 9.5l-5.6 1.9L11 17l-1.9-5.6L3.5 9.5l5.6-1.9ZM18.5 14l.95 2.55L22 17.5l-2.55.95L18.5 21l-.95-2.55L15 17.5l2.55-.95Z',
  star: 'M12 2l3 6.3 6.9.9-5 4.8 1.3 6.9-6.2-3.3-6.2 3.3 1.3-6.9-5-4.8 6.9-.9Z',
  mask: 'M3 5c3 1.2 6 1.2 9 0 3 1.2 6 1.2 9 0v6c0 5-4 9-9 9s-9-4-9-9Zm5 4.5a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Zm8 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2ZM8.5 15.5h7c-.8 1.6-2.1 2.4-3.5 2.4s-2.7-.8-3.5-2.4Z',
  clock: 'M12 2a10 10 0 1 1 0 20 10 10 0 1 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 1 0 0-16Zm-1 3h2v4.6l3.2 3.2-1.4 1.4L11 12.4Z',
  totop: 'M4 3h16v2.5H4Zm8 4.5 7 7-1.8 1.8-3.9-3.9V21h-2.6v-8.6l-3.9 3.9L5 14.5Z',
  pin: 'M20.13 9.53 18.72 10.94 17.3 10.94 13.77 14.47 13.77 18.72 12.35 20.13 8.82 16.6 5.28 20.13 3.87 20.13 3.87 18.72 7.4 15.18 3.87 11.65 5.28 10.23 9.53 10.23 13.06 6.7 13.06 5.28 14.47 3.87Z', // alfinete inclinado (o antigo, girado 45°)
  upload: 'M11 15V5.8l-3.3 3.3L6.3 7.7 12 2l5.7 5.7-1.4 1.4L13 5.8V15Zm-6 2h14v4H5Z',
  clip: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v2h2V6H5Zm0 4v2h2v-2H5Zm0 4v2h2v-2H5ZM17 6v2h2V6h-2Zm0 4v2h2v-2h-2Zm0 4v2h2v-2h-2ZM9 6v12h6V6H9Z',
  file: 'M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5Z',
  video: 'M4 5h10a2 2 0 0 1 2 2v2.6l4.3-2.7a.5.5 0 0 1 .7.4v9.4a.5.5 0 0 1-.7.4L16 14.4V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  screen: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v9h16V6Z',
  phoneoff: 'M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1A15.07 15.07 0 0 0 12 9Z',
  users: 'M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM2 20a8 8 0 0 1 16 0v1H2Zm16.5-8.5a3 3 0 1 0 0-6 4 4 0 0 1 0 6Zm1.2 1.7c2.6.7 4.3 3 4.3 5.8v1h-3v-1c0-2.1-.5-4-1.3-5.8Z',
  inbox: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v8h4a3 3 0 0 0 6 0h4V5Z', // bandeja de entrada
  chevdown: 'M6.3 8.3 12 14l5.7-5.7 1.4 1.4-7.1 7.1-7.1-7.1Z',
  invite: 'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0v1H2Zm17-12h2v3h3v2h-3v3h-2v-3h-3v-2h3Z', // pessoa com +
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
  vol: 'M3 9.5v5c0 .6.4 1 1 1h3l4.3 3.6c.7.6 1.7.1 1.7-.8V5.7c0-.9-1-1.4-1.7-.8L7 8.5H4c-.6 0-1 .4-1 1Zm12.6-2.1a1 1 0 0 0-1.3 1.5 4.6 4.6 0 0 1 0 6.2 1 1 0 1 0 1.3 1.5 6.6 6.6 0 0 0 0-9.2Zm2.6-2.9a1 1 0 0 0-1.4 1.4 8.6 8.6 0 0 1 0 12.2 1 1 0 0 0 1.4 1.4 10.6 10.6 0 0 0 0-15Z',
  vollow: 'M3 9.5v5c0 .6.4 1 1 1h3l4.3 3.6c.7.6 1.7.1 1.7-.8V5.7c0-.9-1-1.4-1.7-.8L7 8.5H4c-.6 0-1 .4-1 1Zm12.6-2.1a1 1 0 0 0-1.3 1.5 4.6 4.6 0 0 1 0 6.2 1 1 0 1 0 1.3 1.5 6.6 6.6 0 0 0 0-9.2Z',
  volmute: 'M3 9.5v5c0 .6.4 1 1 1h3l4.3 3.6c.7.6 1.7.1 1.7-.8V5.7c0-.9-1-1.4-1.7-.8L7 8.5H4c-.6 0-1 .4-1 1Zm13.3-.2a1 1 0 0 0-1.4 1.4l1.3 1.3-1.3 1.3a1 1 0 1 0 1.4 1.4l1.3-1.3 1.3 1.3a1 1 0 0 0 1.4-1.4L18 12l1.3-1.3a1 1 0 0 0-1.4-1.4l-1.3 1.3Z',
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
  const def = I[name] || '', path = (d) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return p; };
  if (typeof def === 'string') { path(def); return s; }
  // ícone sólido com recortes vazados: { parts: [d...], t? } (evenodd; t = transform do grupo, ex.: desenhado reto e girado)
  if (def.parts) {
    const g = def.t ? s.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'g')) : s; if (def.t) g.setAttribute('transform', def.t);
    for (const d of def.parts) { const p = path(d); p.setAttribute('fill-rule', 'evenodd'); g.append(p); }
    return s;
  }
  // ícone com partes em traço: { fill, stroke } (o traço usa a cor do texto, largura 2, pontas redondas)
  if (def.fill) path(def.fill);
  if (def.stroke) { const p = path(def.stroke); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); }
  return s;
};

export const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const initials = (s) => (s || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();

// enquadramento "x,y,zoom" (x/y em %, zoom 1–3) aplicado a um <img> com object-fit: cover
export const parsePos = (s) => { const m = String(s || '').split(',').map(Number); return m.length === 3 && m.every(Number.isFinite) ? { x: m[0], y: m[1], z: m[2] } : { x: 50, y: 50, z: 1 }; };
export function framePos(img, s, round = false) {
  const p = parsePos(s); img.style.objectFit = 'cover'; img.style.objectPosition = p.x + '% ' + p.y + '%';
  img.style.transformOrigin = p.x + '% ' + p.y + '%'; img.style.transform = p.z > 1 ? 'scale(' + p.z + ')' : '';
  // o zoom (scale) aumenta a imagem além da caixa; recorta de volta ao tamanho original (o .avatar não esconde o que vaza, por causa do status)
  const k = 1 - 1 / p.z, f = (n) => +n.toFixed(2) + '%';
  img.style.clipPath = p.z <= 1 ? '' : round ? `circle(${f(50 / p.z)} at ${f(p.x + (50 - p.x) / p.z)} ${f(p.y + (50 - p.y) / p.z)})`
    : `inset(${f(p.y * k)} ${f((100 - p.x) * k)} ${f((100 - p.y) * k)} ${f(p.x * k)})`;
  return img;
}
export function avatar(u, size = 40, opts = {}) {
  const el = h('div.avatar', { style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * .42) + 'px', background: u?.color || '#5865f2' } });
  if (u?.avatar) el.append(framePos(h('img', { src: u.avatar, alt: '', loading: 'lazy' }), u.avatar_pos, true)); else el.append((u?.display_name || u?.username || '?')[0].toUpperCase());
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
// convite para a chamada (/call/ID, criado pelo servidor): vira cartão com Entrar/Recusar
const CALL_G = /(?:📞\s*)?(?:https?:\/\/[^\s/]+|(?<![\w./]))\/call\/([A-Za-z0-9_-]{8,32})\b/gu;
export const callCodes = (s) => [...new Set([...String(s || '').matchAll(CALL_G)].map(m => m[1]))].slice(0, 3);
export const inviteCodes = (s) => [...new Set([...String(s || '').matchAll(INVITE_G)].map(m => m[1]))].slice(0, 3);
export const stripInvites = (s) => String(s || '').replace(INVITE_G, '').replace(CALL_G, '').replace(/[ \t]+$/gm, '').trim();
export const inviteText = (s) => String(s || '').replace(INVITE_G, '📨 Convite de servidor').replace(CALL_G, '📞 Convite para a chamada');
export const isImageUrl = (u) => /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif)(\?\S*)?$/i.test(u);
export const onlyEmoji = (s) => /^(\s*(\p{Extended_Pictographic}|\p{Emoji_Presentation})(️|‍|\p{Emoji_Modifier})*\s*){1,27}$/u.test(s.trim()) && s.trim().length > 0;

export const EMOJIS = {
  'Rostos': '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 ☠️ 👽 👾 🤖'.split(' '),
  'Gestos': '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 🤏 💪 🙏 🤝 👏 🙌 👐 🤲 ✍️ 💅 🤳'.split(' '),
  'Corações': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟'.split(' '),
  'Objetos': '🎉 🎊 🎈 🎁 🏆 🥇 ⚽ 🏀 🎮 🎲 🎯 🎵 🎶 🎤 🎧 📷 💻 📱 💡 🔥 ⭐ 🌟 ✨ ⚡ 💥 💯 ✅ ❌ ❓ ❗ ⚠️ 🚀 🍕 🍔 🍟 🍺 ☕ 🍰 🍎 🐶 🐱 🦊 🐸 🐵 🌈 ☀️ 🌙'.split(' '),
};

// append/prepend/replaceChildren nativos escrevem "false"/"null" na tela quando recebem `cond && elemento`; aqui esses valores são ignorados
for (const fn of ['append', 'prepend', 'replaceChildren']) for (const P of [Element.prototype, DocumentFragment.prototype]) {
  const orig = P[fn]; if (!orig) continue;
  P[fn] = function (...a) { return orig.apply(this, a.filter(x => x != null && x !== false)); };
}

// Vídeo com controles nativos, mas a tela cheia é da caixa em volta e não do <video>.
// A tela cheia do próprio <video> leva o Chromium/Windows a mandar o vídeo direto para a placa
// (sobreposição de hardware, realce de vídeo do driver); em alguns PCs isso deixa a imagem escura e
// com cores estouradas. Assim o vídeo continua sendo desenhado pela página, igual fora da tela cheia.
// Player próprio: controles flutuando sobre o vídeo, que somem sozinhos (com o cursor) enquanto toca; em tela cheia o
// vídeo ocupa a tela inteira. Progresso com trecho carregado e bolha de tempo no hover, volume lembrado entre vídeos,
// velocidade e atalhos (espaço/K, ← →, J/L, ↑ ↓, M, F, 0–9).
const vfmt = (s) => { s = isFinite(s) ? Math.max(0, Math.floor(s)) : 0; const hh = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0'); return hh ? `${hh}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
const vPref = { get: (k, d) => { try { const x = localStorage.getItem('lc_v_' + k); return x == null ? d : JSON.parse(x); } catch { return d; } }, set: (k, x) => { try { localStorage.setItem('lc_v_' + k, JSON.stringify(x)); } catch { } } };
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
export function fsVideo(attrs = {}, cls = '') {
  const v = h('video', { playsInline: true, disablePictureInPicture: true, ...attrs });
  v.setAttribute('controlslist', 'nofullscreen noremoteplayback');
  v.volume = vPref.get('vol', 1); v.muted = !!attrs.muted || vPref.get('muted', false);
  const box = h('div.fsvid' + cls, { tabIndex: 0 }, v);
  const isFs = () => document.fullscreenElement === box;
  const toggleFs = () => { if (isFs()) document.exitFullscreen?.().catch(() => { }); else box.requestFullscreen?.().catch(() => { }); };
  const playPause = () => (v.paused || v.ended ? v.play().catch(() => { }) : v.pause());
  const btn = (cl, title, fn, ico) => h('button.vc-btn' + cl, { type: 'button', title, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ico, 20));

  // ---- barra de progresso ----
  const buf = h('div.vc-buf'), prog = h('div.vc-prog', h('i.vc-knob')), hov = h('div.vc-hov'), bubble = h('div.vc-bubble');
  const track = h('div.vc-track', h('div.vc-rail', buf, hov, prog), bubble);
  const frac = (e) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  let scrub = false, wasPlaying = false;
  const seekTo = (f) => { if (isFinite(v.duration)) { v.currentTime = f * v.duration; paintTime(); } };
  track.addEventListener('pointermove', (e) => { const f = frac(e); hov.style.width = f * 100 + '%'; bubble.style.left = f * 100 + '%'; bubble.textContent = vfmt(f * v.duration); if (scrub) seekTo(f); });
  track.addEventListener('pointerleave', () => { if (!scrub) hov.style.width = '0'; });
  track.addEventListener('pointerdown', (e) => { e.stopPropagation(); scrub = true; wasPlaying = !v.paused; v.pause(); track.setPointerCapture(e.pointerId); box.classList.add('scrub'); seekTo(frac(e)); });
  const endScrub = () => { if (!scrub) return; scrub = false; box.classList.remove('scrub'); hov.style.width = '0'; if (wasPlaying) v.play().catch(() => { }); };
  track.addEventListener('pointerup', endScrub); track.addEventListener('pointercancel', endScrub);

  // ---- botões ----
  const play = btn('.vc-play', 'Tocar / pausar (espaço)', playPause, 'play');
  const time = h('div.vc-time', h('span', '0:00'), h('i', '/'), h('span', '0:00'));
  const volIco = () => (v.muted || !v.volume ? 'volmute' : v.volume < 0.5 ? 'vollow' : 'vol');
  const mute = btn('.vc-mute', 'Som (M)', () => { v.muted = !v.muted; if (!v.muted && !v.volume) v.volume = 0.5; }, volIco());
  const volFill = h('div.vc-vfill'), volRail = h('div.vc-vrail', volFill, h('i.vc-vknob'));
  const volSlot = h('div.vc-vslot', volRail);
  const setVolAt = (e) => { const r = volRail.getBoundingClientRect(); const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); v.volume = x; v.muted = x === 0; };
  volRail.addEventListener('pointerdown', (e) => { e.stopPropagation(); volRail.setPointerCapture(e.pointerId); setVolAt(e); const mv = (ev) => setVolAt(ev); volRail.addEventListener('pointermove', mv); volRail.addEventListener('pointerup', () => volRail.removeEventListener('pointermove', mv), { once: true }); });
  const volume = h('div.vc-vol', mute, volSlot);
  const speed = h('button.vc-btn.vc-speed', { type: 'button', title: 'Velocidade', onclick: (e) => { e.stopPropagation(); const i = SPEEDS.indexOf(v.playbackRate); v.playbackRate = SPEEDS[(i + 1) % SPEEDS.length]; } }, '1×');
  const fs = btn('.fsvbtn', 'Tela cheia (F)', toggleFs, 'expand');
  const bar = h('div.vc-bar', { onclick: (e) => e.stopPropagation(), ondblclick: (e) => e.stopPropagation() }, track, h('div.vc-row', play, time, h('div.vc-sp'), speed, volume, fs));
  const flash = h('div.vc-flash'), big = h('div.vc-big', icon('play', 34));
  box.append(flash, big, bar);

  // ---- pintura ----
  const paintTime = () => {
    const d = v.duration, t = v.currentTime, p = isFinite(d) && d ? (t / d) * 100 : 0;
    prog.style.width = p + '%'; time.children[0].textContent = vfmt(t); time.children[2].textContent = vfmt(d);
    let b = 0; for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= t + 0.5) b = Math.max(b, v.buffered.end(i));
    buf.style.width = (isFinite(d) && d ? Math.min(100, (b / d) * 100) : 0) + '%';
  };
  const paintPlay = () => { const on = !v.paused && !v.ended; play.replaceChildren(icon(on ? 'pause' : 'play', 20)); box.classList.toggle('playing', on); box.classList.toggle('ended', v.ended); if (!on) wake(); };
  const paintVol = () => { mute.replaceChildren(icon(volIco(), 20)); volFill.style.width = (v.muted ? 0 : v.volume) * 100 + '%'; vPref.set('vol', v.volume); if (!attrs.muted) vPref.set('muted', v.muted); };
  for (const ev of ['timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'seeked']) v.addEventListener(ev, paintTime);
  for (const ev of ['play', 'pause', 'ended']) v.addEventListener(ev, paintPlay);
  v.addEventListener('volumechange', paintVol);
  v.addEventListener('ratechange', () => (speed.textContent = String(v.playbackRate).replace('.', ',') + '×'));
  v.addEventListener('waiting', () => box.classList.add('loading')); for (const ev of ['playing', 'canplay', 'pause']) v.addEventListener(ev, () => box.classList.remove('loading'));
  paintVol();

  // ---- some sozinho: 2,5 s parado com o vídeo tocando (cursor some junto) ----
  let idle = 0;
  const wake = () => { box.classList.add('awake'); clearTimeout(idle); idle = setTimeout(() => { if (!v.paused && !scrub && !box.matches(':has(.vc-bar:hover)')) box.classList.remove('awake'); }, 2500); };
  box.addEventListener('pointermove', wake); box.addEventListener('pointerdown', wake);
  box.addEventListener('pointerleave', () => { if (!v.paused) box.classList.remove('awake'); });
  const pulse = (ico) => { flash.replaceChildren(icon(ico, 30)); flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go'); };

  // ---- clique / duplo clique / teclado ----
  let clickT = 0;
  v.addEventListener('click', () => { clearTimeout(clickT); clickT = setTimeout(() => { pulse(v.paused ? 'play' : 'pause'); playPause(); }, 180); });
  big.addEventListener('click', (e) => { e.stopPropagation(); playPause(); });
  v.addEventListener('dblclick', (e) => { e.preventDefault(); clearTimeout(clickT); toggleFs(); });
  box.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase(), d = v.duration || 0; let ok = true;
    if (k === ' ' || k === 'k') { pulse(v.paused ? 'play' : 'pause'); playPause(); }
    else if (k === 'arrowleft' || k === 'j') v.currentTime = Math.max(0, v.currentTime - (k === 'j' ? 10 : 5));
    else if (k === 'arrowright' || k === 'l') v.currentTime = Math.min(d, v.currentTime + (k === 'l' ? 10 : 5));
    else if (k === 'arrowup') { v.muted = false; v.volume = Math.min(1, v.volume + 0.1); }
    else if (k === 'arrowdown') v.volume = Math.max(0, v.volume - 0.1);
    else if (k === 'm') v.muted = !v.muted;
    else if (k === 'f') toggleFs();
    else if (/^[0-9]$/.test(k) && d) v.currentTime = (+k / 10) * d;
    else ok = false;
    if (ok) { e.preventDefault(); e.stopPropagation(); wake(); }
  });
  const onFs = () => { box.classList.toggle('isfs', isFs()); fs.replaceChildren(icon(isFs() ? 'shrink' : 'expand', 20)); fs.title = isFs() ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'; if (isFs()) box.focus(); };
  document.addEventListener('fullscreenchange', onFs); queueMicrotask(() => whenGone(box, () => { document.removeEventListener('fullscreenchange', onFs); clearTimeout(idle); }));
  wake(); paintPlay();
  box.video = v;
  return box;
}

// roda fn quando el sair da página (popups, painéis, páginas de configuração): solta ouvintes globais na hora,
// em vez de esperar o próximo evento (o que segurava a tela inteira na memória). Um observador só, desligado quando vazio.
const gone = new Map(); let goneObs = null;
export function whenGone(el, fn) {
  gone.set(el, { fn, seen: el.isConnected }); // só conta como "saiu" depois de ter entrado na página
  if (!goneObs) {
    goneObs = new MutationObserver(() => {
      for (const [e, g] of gone) { if (e.isConnected) g.seen = true; else if (g.seen) { gone.delete(e); try { g.fn(); } catch { } } }
      if (!gone.size) { goneObs.disconnect(); goneObs = null; }
    });
    goneObs.observe(document.body, { childList: true, subtree: true });
  }
}

// miniatura de um vídeo enviado (/files/<id>.webm/...): imagem pequena gerada pelo servidor (server/thumbs.js)
export const thumbUrl = (url) => { const m = /^\/files\/([a-f0-9]{24}\.(?:webm|mp4))\//.exec(String(url || '')); return m ? `/thumbs/${m[1]}` : null; };
