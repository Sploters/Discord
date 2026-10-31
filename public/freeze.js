import { S } from './state.js';

// Avatares e banners animados (gif/webp/apng): com "só quando falar" ficam num quadro parado e animam enquanto a pessoa fala na voz
const ANIM = /\.(gif|webp|apng)(\?|#|$)|^data:image\/(gif|webp|apng)/i;
const SEL = '.avatar, .upbanner, .mebanner, [class*="banner"]';
const stills = new Map(); // src -> Promise<dataURL>
const still = (src) => {
  if (!stills.has(src)) stills.set(src, new Promise((res) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { try { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); res(c.toDataURL('image/png')); } catch { res(null); } };
    im.onerror = () => res(null); im.src = src;
  }));
  return stills.get(src);
};
const frozen = () => S.prefs?.animMode === 'speak';
function apply(img) {
  if (!img.closest?.(SEL)) return;
  const src = img.dataset.orig || img.getAttribute('src') || '';
  if (!ANIM.test(src)) return;
  if (!frozen() || img.closest('.speaking')) { if (img.dataset.orig && img.getAttribute('src') !== img.dataset.orig) img.src = img.dataset.orig; return; }
  img.dataset.orig = src;
  still(src).then((u) => { if (u && frozen() && img.dataset.orig === src && !img.closest('.speaking')) img.src = u; });
}
const scan = (root) => { if (root.tagName === 'IMG') apply(root); root.querySelectorAll?.('img').forEach(apply); };
export const refreshFreeze = () => scan(document.body);
new MutationObserver((ms) => {
  if (!frozen() && !document.querySelector('img[data-orig]')) return;
  for (const m of ms) {
    if (m.type === 'childList') m.addedNodes.forEach(n => n.nodeType === 1 && scan(n));
    else if (m.target.nodeType === 1 && (m.oldValue || '').includes('speaking') !== m.target.classList.contains('speaking')) scan(m.target);
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
