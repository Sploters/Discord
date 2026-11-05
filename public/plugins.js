// Recursos inspirados em plugins do Discord: abas de canais e favoritos, esconder lista de canais, menção rápida.
import { h, icon } from './util.js';
import { chName } from './chnames.js';

const KEY = 'lc_tabs', HIDE_KEY = 'lc_hide_side';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const store = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

let D, st = { tabs: [], active: null, favs: [] }, uid = 0;
const same = (a, b) => a.gid === b.gid && (a.cid || null) === (b.cid || null);
const save = () => store(st);

function label(t) {
  if (t.gid === '@me' && !t.cid) return 'Amigos';
  if (t.cid === 'clips') return '🎬 Clipes'; // galeria de clipes do servidor
  if (t.cid === 'lfg') return '🎮 Procurar jogadores';
  if (t.cid === 'discover') return '🧭 Descobrir';
  const ch = D.channelById(t.cid);
  if (!ch) return 'Canal removido';
  if (ch.type === 1) return '@' + D.user(D.dmPeer(ch).id).display_name;
  return (ch.type === 2 ? '🔊 ' : '# ') + chName(ch);
}
const title = (t) => { const ch = D.channelById(t.cid), g = t.cid === 'clips' ? D.guild(t.gid) : ch?.guild_id && D.guild(ch.guild_id); return label(t) + (g ? ' — ' + g.name : ''); };
const here = () => ({ gid: D.S.view.gid || '@me', cid: D.S.view.cid || null });
const alive = (t) => !t.cid || t.cid === 'lfg' || t.cid === 'discover' || (t.cid === 'clips' ? !!D.guild(t.gid) : !!D.channelById(t.cid));

function open(t) { D.go(t.gid, t.cid); }
function addTab(t, activate = true) {
  const tab = { id: ++uid, ...t };
  st.tabs.push(tab); if (activate) st.active = tab.id; save(); return tab;
}
function closeTab(id) {
  const i = st.tabs.findIndex(t => t.id === id); if (i < 0 || st.tabs.length < 2) return;
  const wasActive = st.active === id; st.tabs.splice(i, 1);
  if (wasActive) { const n = st.tabs[Math.min(i, st.tabs.length - 1)]; st.active = n.id; save(); open(n); } else save();
  draw();
}
function toggleFav(t) {
  const i = st.favs.findIndex(f => same(f, t));
  if (i >= 0) st.favs.splice(i, 1); else st.favs.push({ gid: t.gid, cid: t.cid });
  save(); draw();
}
function tabMenu(e, tab) {
  e.preventDefault();
  D.menu(e, [
    { label: 'Duplicar aba', fn: () => { addTab({ gid: tab.gid, cid: tab.cid }); draw(); } },
    { label: st.favs.some(f => same(f, tab)) ? 'Remover dos favoritos' : 'Adicionar aos favoritos', fn: () => toggleFav(tab) },
    '-',
    st.tabs.length > 1 && { label: 'Fechar aba', fn: () => closeTab(tab.id) },
    st.tabs.length > 1 && { label: 'Fechar as outras abas', fn: () => { st.tabs = [tab]; st.active = tab.id; save(); draw(); open(tab); } },
  ]);
}

function build() {
  const cur = here();
  const badge = (t) => { const n = t.cid && D.S.mentions[t.cid]; return n > 0 ? h('span.ct-pill', n) : (t.cid && D.S.unread[t.cid] ? h('i.ct-dot') : null); };
  const tabEls = st.tabs.map(t => h('div.ct-tab' + (t.id === st.active ? '.active' : ''), {
    title: title(t), onclick: () => { st.active = t.id; save(); open(t); draw(); },
    onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }, oncontextmenu: (e) => tabMenu(e, t),
  }, h('span.ct-name', label(t)), badge(t), st.tabs.length > 1 && h('button.ct-x', { title: 'Fechar aba', onclick: (e) => { e.stopPropagation(); closeTab(t.id); } }, icon('x', 12))));
  const favEls = st.favs.filter(alive).map(f => h('div.ct-fav', {
    title: title(f), onclick: () => { const a = st.tabs.find(t => t.id === st.active); if (a) { a.gid = f.gid; a.cid = f.cid; save(); } open(f); },
    onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); addTab({ gid: f.gid, cid: f.cid }); open(f); draw(); } },
    oncontextmenu: (e) => { e.preventDefault(); D.menu(e, [{ label: 'Abrir em nova aba', fn: () => { addTab({ gid: f.gid, cid: f.cid }); open(f); } }, { label: 'Remover dos favoritos', fn: () => toggleFav(f) }]); },
  }, label(f)));
  const isFav = st.favs.some(f => same(f, cur));
  return h('div#chtabs',
    h('div.ct-list', tabEls, h('button.ct-add', { title: 'Nova aba (duplica a atual)', onclick: () => { addTab({ ...cur }); draw(); } }, icon('plus', 14))),
    h('button.ct-star' + (isFav ? '.on' : ''), { title: isFav ? 'Remover dos favoritos' : 'Favoritar este canal', onclick: () => toggleFav(cur) }, icon('star', 15)),
    favEls.length > 0 && h('div.ct-favs', h('span.ct-sep'), favEls),
    // caixa de entrada no canto superior direito
    h('button.ibtn.inbox-btn.ct-inbox', { title: 'Caixa de entrada (menções e respostas)', onclick: (e) => D.showInbox(e) }, icon('inbox', 18), D.inboxBadge()));
}

function draw() {
  const main = document.getElementById('main'); if (!main) return;
  const bar = build();
  const old = document.getElementById('chtabs');
  if (old) old.replaceWith(bar); else main.prepend(bar);
}

// a aba ativa acompanha a navegação; se a rota já existe em outra aba, não duplica
function follow() {
  const cur = here();
  st.tabs = st.tabs.filter(alive);
  if (!st.tabs.length) { addTab(cur); return; }
  let a = st.tabs.find(t => t.id === st.active);
  if (!a) { a = st.tabs[0]; st.active = a.id; }
  if (!same(a, cur)) { a.gid = cur.gid; a.cid = cur.cid; }
  save();
}

// ---------- esconder a lista de canais ----------
const hidden = () => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } };
function applyHidden(v) {
  document.getElementById('app')?.classList.toggle('hide-side', v);
  try { localStorage.setItem(HIDE_KEY, v ? '1' : '0'); } catch { /* sem armazenamento */ }
  document.querySelectorAll('#hide-side').forEach(b => b.classList.toggle('sel', v));
}
function hideButton() {
  const top = document.getElementById('topbar'); if (!top || top.querySelector('#hide-side')) return;
  const b = h('button.ibtn#hide-side' + (hidden() ? '.sel' : ''), { title: 'Mostrar/ocultar lista de canais (Ctrl+B)', onclick: () => applyHidden(!hidden()) }, icon('sidebar', 22));
  const mb = top.querySelector('.menu-btn');
  mb ? mb.after(b) : top.prepend(b);
}

// ---------- menção rápida ----------
// o campo mostra @Nome; na hora de enviar vira <@id>
export function addMention(ta, name, id) { (ta._men ||= new Map()).set('@' + name, id); }
export function resolveMentions(ta, text) {
  const m = ta._men; if (!m?.size) return text;
  for (const [tag, id] of [...m].sort((a, b) => b[0].length - a[0].length)) {
    const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp('(^|\\s)' + esc + '(?=$|[\\s.,!?;:)])', 'g'), (_, p) => `${p}<@${id}>`);
  }
  return text;
}
export function mentionUser(uidStr) {
  const ta = document.querySelector('#composer textarea'); if (!ta) return false;
  const name = D.user(uidStr).display_name; addMention(ta, name, uidStr);
  const tag = `@${name} `, a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
  const pre = ta.value.slice(0, a), needSpace = pre && !/\s$/.test(pre);
  ta.value = pre + (needSpace ? ' ' : '') + tag + ta.value.slice(b);
  const pos = pre.length + (needSpace ? 1 : 0) + tag.length;
  ta.focus(); ta.setSelectionRange(pos, pos); ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

export function initPlugins(deps) {
  D = deps;
  const saved = load(); st = { tabs: [], active: null, favs: Array.isArray(saved.favs) ? saved.favs : [] };
  for (const t of saved.tabs || []) { st.tabs.push({ id: ++uid, gid: t.gid, cid: t.cid }); if (t.id === saved.active) st.active = uid; }
  const main = document.getElementById('main'); if (!main) return;
  let busy = false;
  const sync = () => {
    if (busy) return; busy = true;
    try { follow(); if (document.getElementById('chtabs') !== main.firstElementChild) { document.getElementById('chtabs')?.remove(); main.prepend(build()); } else draw(); hideButton(); }
    finally { busy = false; }
  };
  new MutationObserver(() => { if (document.getElementById('chtabs') !== main.firstElementChild || !document.getElementById('hide-side')) sync(); }).observe(main, { childList: true });
  window.addEventListener('hashchange', () => setTimeout(sync, 0));
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key.toLowerCase() === 'b' && !e.shiftKey) { e.preventDefault(); applyHidden(!hidden()); }
    else if (e.key.toLowerCase() === 'w' && st.tabs.length > 1) { e.preventDefault(); closeTab(st.active); }
    else if (e.key === 'Tab' && st.tabs.length > 1) {
      e.preventDefault(); const i = st.tabs.findIndex(t => t.id === st.active), n = st.tabs[(i + (e.shiftKey ? -1 : 1) + st.tabs.length) % st.tabs.length];
      st.active = n.id; save(); open(n); draw();
    }
  });
  applyHidden(hidden());
  sync();
}
