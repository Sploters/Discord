// GIFs: seletor no campo de mensagem (busca, Em alta, Favoritos, Do grupo) e o GIF dentro da mensagem.
// O GIF vai como o próprio link na mensagem; o servidor só busca a lista (KLIPY ou GIPHY) e guarda os favoritos.
import { h, icon } from './util.js';
import { S, api, toast, closeFloating } from './state.js';
import { liteOn } from './lite.js';

let meta = null, favs = null; // favs: Map url -> gif
const loadMeta = async () => (meta ||= await api('GET', '/gifs/meta').catch(() => ({ provider: null })));
const loadFavs = async () => { if (!favs) { const r = await api('GET', '/gifs/favs').catch(() => ({ gifs: [] })); favs = new Map(r.gifs.map(g => [g.url, g])); } return favs; };
export const isFav = (url) => !!favs?.has(url);
export async function toggleFav(g) {
  await loadFavs();
  if (favs.has(g.url)) { favs.delete(g.url); await api('DELETE', '/gifs/favs', { url: g.url }).catch(e => toast(e.message, true)); toast('Tirado dos favoritos'); return false; }
  try { await api('PUT', '/gifs/favs', { url: g.url, preview: g.preview || g.url, w: g.w || 0, h: g.h || 0, title: g.title || '' }); favs.set(g.url, g); toast('GIF favoritado'); return true; }
  catch (e) { toast(e.message, true); return null; }
}

// mensagem que é só um link de GIF/WebP animado: mostra só a imagem (sem o texto do link)
export const GIF_ONLY = /^https?:\/\/[^\s"'<>]+\.(gif|webp)(\?[^\s"'<>]*)?$/i;
export const isGifMessage = (content) => GIF_ONLY.test((content || '').trim());

// quadro parado de um GIF (para o modo leve / animações desligadas): precisa de CORS; sem ele, anima normalmente
const stills = new Map();
function still(src) {
  if (!stills.has(src)) stills.set(src, new Promise((res) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { try { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); res(c.toDataURL('image/jpeg', 0.8)); } catch { res(null); } };
    im.onerror = () => res(null); im.src = src;
  }));
  return stills.get(src);
}
const calm = () => liteOn() || S.prefs.animMode === 'never';

// o GIF dentro da mensagem: estrela para favoritar; no modo leve fica parado e anima com o mouse em cima
export function gifEl(url, onOpen) {
  const img = h('img', { src: url, loading: 'lazy', referrerPolicy: 'no-referrer', alt: 'GIF', onclick: () => onOpen?.(url) });
  const star = h('button.gstar', { title: 'Favoritar GIF', onclick: async (e) => { e.stopPropagation(); const r = await toggleFav({ url, preview: url, w: img.naturalWidth, h: img.naturalHeight }); if (r != null) paintStar(); } }, icon('star', 16));
  const paintStar = () => { star.classList.toggle('on', isFav(url)); star.title = isFav(url) ? 'Tirar dos favoritos' : 'Favoritar GIF'; };
  loadFavs().then(paintStar);
  const box = h('div.attach.gifmsg', img, star, h('span.gtag', 'GIF'));
  if (calm()) {
    still(url).then(s => { if (s && calm()) { img.src = s; box.classList.add('paused'); } });
    box.addEventListener('mouseenter', () => { img.src = url; box.classList.remove('paused'); });
    box.addEventListener('mouseleave', () => { const s = stills.get(url); s?.then(x => { if (x && calm()) { img.src = x; box.classList.add('paused'); } }); });
  }
  return box;
}

// ---------- seletor ----------
export async function gifPicker(anchor, onPick) {
  closeFloating();
  await loadMeta(); await loadFavs();
  const hasProv = !!meta.provider;
  let tab = hasProv ? 'trend' : 'favs', q = '', page = 1, more = false, busy = false, seq = 0, items = [];
  const input = h('input', { placeholder: hasProv ? 'Pesquisar GIFs' : 'Pesquisar nos favoritos e do grupo', oninput: () => { clearTimeout(input._t); input._t = setTimeout(() => { q = input.value.trim(); load(true); }, 350); } });
  const tabs = h('div.gtabs'), grid = h('div.ggrid'), foot = h('div.gfoot');
  const cols = [h('div.gcol'), h('div.gcol')];
  grid.append(...cols);
  const drawTabs = () => tabs.replaceChildren(...[hasProv && ['trend', 'Em alta'], ['favs', 'Favoritos'], ['group', 'Do grupo']].filter(Boolean).map(([k, l]) =>
    h('button' + (tab === k && !q ? '.on' : ''), { onclick: () => { tab = k; input.value = q = ''; load(true); } }, l)));
  const card = (g) => {
    const star = h('button.gstar' + (isFav(g.url) ? '.on' : ''), { title: isFav(g.url) ? 'Tirar dos favoritos' : 'Favoritar', onclick: async (e) => { e.stopPropagation(); const r = await toggleFav(g); if (r != null) { star.classList.toggle('on', r); if (tab === 'favs' && !q && !r) el.remove(); } } }, icon('star', 14));
    const el = h('div.gcard', { title: g.title || '', onclick: () => { onPick(g.url, g); closeFloating(); } },
      h('img', { src: g.preview || g.url, loading: 'lazy', referrerPolicy: 'no-referrer', style: g.w && g.h ? { aspectRatio: `${g.w} / ${g.h}` } : null, onerror: () => el.remove() }), star);
    return el;
  };
  const add = (list) => { for (const g of list) { const c = cols[0].offsetHeight <= cols[1].offsetHeight ? cols[0] : cols[1]; c.append(card(g)); } };
  const empty = (t) => { cols.forEach(c => c.replaceChildren()); grid.dataset.empty = t; };
  async function load(reset) {
    if (reset) { page = 1; items = []; cols.forEach(c => c.replaceChildren()); grid.scrollTop = 0; delete grid.dataset.empty; }
    drawTabs();
    const my = ++seq; busy = true;
    try {
      let list = [];
      if (q && hasProv) { const r = await api('GET', `/gifs/search?q=${encodeURIComponent(q)}&page=${page}`); list = r.gifs; more = r.more; }
      else if (tab === 'trend' && hasProv && !q) { const r = await api('GET', `/gifs/trending?page=${page}`); list = r.gifs; more = r.more; }
      else {
        const src = tab === 'group' ? (await api('GET', '/gifs/group')).gifs : [...favs.values()];
        const f = q.toLowerCase(); list = q ? src.filter(g => (g.title || '').toLowerCase().includes(f) || g.url.toLowerCase().includes(f)) : src; more = false;
      }
      if (my !== seq) return;
      items.push(...list); add(list);
      if (!items.length) empty(q ? 'Nada encontrado' : tab === 'favs' ? h('span', 'Nenhum favorito ainda. Clique na ', icon('star', 14), ' de um GIF para guardar aqui.') : tab === 'group' ? 'Ninguém mandou GIF por aqui ainda.' : 'Nada por aqui');
    } catch (e) { if (my === seq) empty(e.message); }
    finally { if (my === seq) busy = false; }
  }
  grid.addEventListener('scroll', () => { if (more && !busy && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 300) { page++; load(false); } });
  foot.replaceChildren(hasProv ? h('span', 'GIFs por ', h('b', meta.label)) : h('span', 'Busca de GIFs desligada no servidor (falta a chave do serviço de GIFs).'));
  const el = h('div.emoji-picker.gifpicker', input, tabs, grid, foot);
  document.getElementById('layer').append(el);
  const r = anchor.getBoundingClientRect(), w = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(r.right - w.width, innerWidth - w.width - 8)) + 'px';
  el.style.top = Math.max(8, r.top - w.height - 8) + 'px';
  input.focus();
  load(true);
}
