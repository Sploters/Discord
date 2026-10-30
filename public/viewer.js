// Visualizador de imagens: galeria com as imagens carregadas do canal, lente de zoom, girar, tamanho real, copiar e salvar.
import { h, icon, bytes } from './util.js';
import { S, savePrefs, toast, menu, closeFloating } from './state.js';

const GALLERY = '#msgs .mtile img, #msgs .attach img';
const abs = (src) => { try { return new URL(src, location.href).href; } catch { return src; } };
const sameOrigin = (src) => { try { return new URL(src, location.href).origin === location.origin; } catch { return false; } };
const fileName = (src) => { try { return decodeURIComponent(new URL(src, location.href).pathname.split('/').pop()) || 'imagem'; } catch { return 'imagem'; } };
const item = (img) => ({ src: img.getAttribute('src'), name: img.alt || fileName(img.src), size: +img.dataset.size || 0 });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- ações ----------
export async function copyImage(src) {
  try {
    const blob = await (await fetch(src)).blob();
    let png = blob;
    if (blob.type !== 'image/png') { // a área de transferência só aceita PNG
      const bmp = await createImageBitmap(blob), c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
      png = await new Promise(r => c.toBlob(r, 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast('Imagem copiada');
  } catch { toast('Não foi possível copiar esta imagem', true); }
}
export async function saveImage(src, name = fileName(src)) {
  try {
    const url = URL.createObjectURL(await (await fetch(src)).blob());
    h('a', { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch { window.open(abs(src), '_blank', 'noopener'); } // imagem externa sem CORS: abre para salvar pelo navegador
}
const copyLink = (src) => navigator.clipboard?.writeText(abs(src)).then(() => toast('Link copiado'), () => { });
export function imageMenu(e, src, name) {
  menu(e, [
    !document.getElementById('lightbox') && { label: 'Ver imagem', fn: () => openViewer(src) },
    { label: 'Copiar imagem', fn: () => copyImage(src) },
    { label: 'Salvar imagem', fn: () => saveImage(src, name) },
    '-',
    { label: 'Copiar link', fn: () => copyLink(src) },
    { label: 'Abrir no navegador', fn: () => window.open(abs(src), '_blank', 'noopener') },
  ]);
}
// clique direito em imagens do chat: menu de imagem em vez do menu da mensagem
document.addEventListener('contextmenu', (e) => {
  const img = e.target.closest?.(GALLERY);
  if (!img) return;
  e.stopPropagation(); imageMenu(e, img.getAttribute('src'), img.alt || fileName(img.src));
}, true);

// tamanho do arquivo quando o anexo não informa (só no mesmo servidor; externo costuma bloquear)
const sizes = new Map();
async function fileSize(it) {
  if (it.size) return it.size;
  if (!sameOrigin(it.src)) return 0;
  if (!sizes.has(it.src)) sizes.set(it.src, fetch(it.src, { method: 'HEAD' }).then(r => +r.headers.get('content-length') || 0).catch(() => 0));
  return sizes.get(it.src);
}

// ---------- visualizador ----------
export function openViewer(src, { list, name, onClose } = {}) {
  document.getElementById('lightbox')?.remove(); closeFloating();
  list ||= [...document.querySelectorAll(GALLERY)].map(item);
  let i = list.findIndex(x => x.src === src);
  if (i < 0) { list = [{ src, name: name || fileName(src), size: 0 }]; i = 0; }
  let rot = 0, real = false, lensOn = false, last = null;
  const P = S.prefs, lensSize = () => P.lensSize ?? 220, lensZoom = () => P.lensZoom ?? 3;

  const img = h('img', { draggable: false, alt: '' }), lens = h('div.vlens');
  const stage = h('div.vimg', img, lens);
  const info = h('div.vinfo'), hint = h('div.vhint');
  const btn = (ic, title, fn, cls = '') => h('button.ibtn' + cls, { title, onclick: (e) => { e.stopPropagation(); fn(e); } }, icon(ic, 20));
  const realBtn = btn('expand', 'Tamanho real / ajustar à tela (F)', () => { real = !real; layout(); });
  const prev = list.length > 1 && h('button.vnav.prev', { title: 'Anterior (←)', onclick: (e) => { e.stopPropagation(); go(-1); } }, icon('chevl', 32));
  const next = list.length > 1 && h('button.vnav.next', { title: 'Próxima (→)', onclick: (e) => { e.stopPropagation(); go(1); } }, icon('chevr', 32));
  const lb = h('div#lightbox.viewer', { onclick: (e) => { if (e.target === lb || e.target === wrap) close(); } },
    h('div.vbar', { onclick: (e) => e.stopPropagation() }, info, h('div.vtools',
      btn('rotate', 'Girar (R)', () => { rot = (rot + 90) % 360; layout(); }), realBtn,
      btn('copy', 'Copiar imagem', () => copyImage(list[i].src)), btn('link', 'Copiar link', () => copyLink(list[i].src)),
      btn('external', 'Abrir no navegador', () => window.open(abs(list[i].src), '_blank', 'noopener')),
      btn('dl', 'Salvar imagem', () => saveImage(list[i].src, list[i].name)), btn('x', 'Fechar (Esc)', () => close()))),
    prev, next, hint);
  const wrap = h('div.vwrap', stage);
  lb.insertBefore(wrap, prev || hint);

  function layout() {
    const side = rot % 180 !== 0;
    lb.classList.toggle('real', real); realBtn.classList.toggle('sel', real);
    // girado de lado: os limites de largura e altura se invertem
    img.style.maxWidth = real ? 'none' : side ? 'calc(100vh - 140px)' : '90vw';
    img.style.maxHeight = real ? 'none' : side ? '90vw' : 'calc(100vh - 140px)';
    stage.style.transform = rot ? `rotate(${rot}deg)` : '';
    // a área do giro precisa ocupar o tamanho visual para centralizar e rolar direito
    requestAnimationFrame(() => { const w = img.clientWidth, hh = img.clientHeight; wrap.style.width = (side ? hh : w) + 'px'; wrap.style.height = (side ? w : hh) + 'px'; });
  }
  async function show() {
    const it = list[i];
    setLens(false);
    img.src = it.src; lens.style.backgroundImage = `url("${it.src.replace(/"/g, '%22')}")`;
    const dims = h('span.vdim'), size = h('span.vsize');
    info.replaceChildren(h('b', { title: it.name }, it.name), dims, size, list.length > 1 && h('span.vcount', `${i + 1} de ${list.length}`));
    const fill = () => { if (list[i] === it && img.naturalWidth) { dims.textContent = `${img.naturalWidth} × ${img.naturalHeight}`; layout(); } };
    img.onerror = () => { if (list[i] === it) dims.textContent = 'não foi possível carregar a imagem'; };
    img.complete && img.naturalWidth ? fill() : (img.onload = fill);
    const n = await fileSize(it); if (n && list[i] === it) size.textContent = bytes(n);
  }
  const go = (d) => { if (list.length < 2) return; i = (i + d + list.length) % list.length; rot = 0; show(); };

  // ---------- lente ----------
  hint.textContent = P.lensClick ? 'Clique na imagem para a lente • roda: zoom • Shift + roda: tamanho' : 'Segure o botão na imagem para a lente • roda: zoom • Shift + roda: tamanho';
  function setLens(on) { lensOn = on; stage.classList.toggle('lensing', on); if (on && last) moveLens(last); }
  function moveLens(e) {
    last = { clientX: e.clientX, clientY: e.clientY };
    if (!lensOn) return;
    // ponto do clique no sistema da imagem sem giro (o centro do retângulo não muda com a rotação)
    const r = stage.getBoundingClientRect(), w = img.clientWidth, hh = img.clientHeight, a = rot * Math.PI / 180;
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const x = Math.cos(a) * dx + Math.sin(a) * dy + w / 2, y = -Math.sin(a) * dx + Math.cos(a) * dy + hh / 2;
    const s = lensSize(), z = lensZoom();
    Object.assign(lens.style, { width: s + 'px', height: s + 'px', left: x - s / 2 + 'px', top: y - s / 2 + 'px',
      backgroundSize: `${w * z}px ${hh * z}px`, backgroundPosition: `${s / 2 - x * z}px ${s / 2 - y * z}px` });
    lens.classList.toggle('pixel', !!P.lensPixel);
  }
  let saveT;
  const tune = (dz, ds) => {
    if (dz) P.lensZoom = +clamp(lensZoom() * dz, 1.5, 12).toFixed(2);
    if (ds) P.lensSize = clamp(lensSize() + ds, 100, 500);
    if (last) moveLens(last);
    clearTimeout(saveT); saveT = setTimeout(savePrefs, 600);
  };
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); last = e;
    if (P.lensClick) return setLens(!lensOn);
    stage.setPointerCapture(e.pointerId); setLens(true);
  });
  stage.addEventListener('pointermove', moveLens);
  stage.addEventListener('pointerup', () => { if (!P.lensClick) setLens(false); });
  stage.addEventListener('click', (e) => e.stopPropagation());
  stage.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); setLens(false); imageMenu(e, list[i].src, list[i].name); });
  lb.addEventListener('wheel', (e) => {
    if (!lensOn) return; // sem lente, a roda rola a imagem em tamanho real
    e.preventDefault();
    if (e.shiftKey) tune(0, e.deltaY < 0 ? 20 : -20); else tune(e.deltaY < 0 ? 1.15 : 1 / 1.15, 0);
  }, { passive: false });

  const keys = (e) => {
    if (!lb.isConnected) return document.removeEventListener('keydown', keys, true);
    if (document.querySelector('.menu')) return;
    const k = e.key;
    if (k === 'Escape') close();
    else if (k === 'ArrowLeft') go(-1);
    else if (k === 'ArrowRight') go(1);
    else if (k.toLowerCase() === 'r' && !e.ctrlKey) { rot = (rot + 90) % 360; layout(); }
    else if (k.toLowerCase() === 'f' && !e.ctrlKey) { real = !real; layout(); }
    else if (k === '+' || k === '=') tune(1.15, 0);
    else if (k === '-') tune(1 / 1.15, 0);
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  function close() { lb.remove(); document.removeEventListener('keydown', keys, true); onClose?.(); }
  document.addEventListener('keydown', keys, true);
  document.body.append(lb);
  show();
  return lb;
}
