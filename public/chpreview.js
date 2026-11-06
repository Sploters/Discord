// Prévia de canal: mostra as últimas mensagens ao passar o mouse (ou Shift + mouse / clique do meio) num canal da lista,
// sem abrir o canal nem marcá-lo como lido.
import { h, icon, avatar, md, stamp, inviteText } from './util.js';
import { S, api, user, nameOf, roleColor, channelById, dmPeer, emojiUrl } from './state.js';
import { styleName, themeText } from './themes.js';
import { chName } from './chnames.js';

export const PREVIEW_TRIGGERS = [['hover', 'Passar o mouse'], ['shift', 'Shift + mouse'], ['middle', 'Clique do meio'], ['off', 'Desligada']];
const P = () => S.prefs;
const trigger = () => P().chPreview ?? 'hover';
const isImg = (f) => /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(f.name || '');

let timer, hideT, box, dim, cur, hovered;
const cancel = () => { clearTimeout(timer); timer = null; };

export function previewHooks(c) {
  return {
    'data-cid': c.id,
    onmouseenter: (e) => {
      hovered = { el: e.currentTarget, c }; clearTimeout(hideT);
      if (cur?.c.id === c.id) { cur.el = e.currentTarget; return; } // a lista foi redesenhada sob o mouse: mantém a prévia aberta
      if (trigger() === 'hover' || (trigger() === 'shift' && e.shiftKey)) schedule(e.currentTarget, c);
    },
    onmouseleave: () => { hovered = null; cancel(); hideSoon(); },
    onmousedown: (e) => {
      if (e.button === 1 && trigger() === 'middle') { e.preventDefault(); cur?.c.id === c.id ? hide() : show(e.currentTarget, c); }
      else if (e.button === 0) { cancel(); hide(); }
    },
  };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Shift' && !e.repeat && trigger() === 'shift' && hovered && !cur) show(hovered.el, hovered.c); });
document.addEventListener('keyup', (e) => { if (e.key === 'Shift' && trigger() === 'shift' && cur && !box?.matches(':hover')) hide(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur) hide(); }, true);

function schedule(el, c) { cancel(); timer = setTimeout(() => { timer = null; show(el, c); }, P().chPreviewDelay ?? 450); }
function hideSoon() { clearTimeout(hideT); hideT = setTimeout(() => { if (!box?.matches(':hover') && !hovered) hide(); }, 180); }
export function hidePreview() { cancel(); hide(); }
function hide() {
  clearTimeout(hideT); box?.remove(); dim?.remove(); box = dim = cur = null;
}

const ctxFor = (gid) => ({ userName: (id) => (S.users.has(id) ? nameOf(id, gid) : null), emojiUrl });
function msgRow(m, prev, gid) {
  if (m.type === 1) return h('div.pmsg.sys', h('span.arrow', icon('arrowr', 14)), h('b', nameOf(m.author_id, gid)), ' ' + m.content);
  const grouped = prev && prev.type !== 1 && prev.author_id === m.author_id && m.created_at - prev.created_at < 420000 && !m.reply;
  const body = h('div.pbody');
  if (m.content) body.innerHTML = md(inviteText(themeText(m.content)), ctxFor(gid));
  const files = m.attachments || [];
  const thumbs = files.filter(isImg).slice(0, 4).map(f => h('img.pthumb', { src: f.url, alt: f.name, loading: 'lazy' }));
  const others = files.filter(f => !isImg(f)).map(f => h('div.pfile', icon(f.voice ? 'mic' : 'file', 14), f.voice ? 'Mensagem de voz' : f.name));
  const col = roleColor(gid, m.author_id);
  return h('div.pmsg' + (grouped ? '.grouped' : ''),
    grouped ? h('i.pav') : h('div.pav', avatar(user(m.author_id), 28, { status: false })),
    h('div.pm',
      !grouped && h('div.phead', styleName(h('b', { style: col ? { color: col } : null }, nameOf(m.author_id, gid)), user(m.author_id).name_style), h('span.ts', stamp(m.created_at))),
      m.reply && h('div.preply', icon('reply', 14), ' ', h('b', '@' + nameOf(m.reply.author?.id, gid)), ' ', themeText(m.reply.content) || 'anexo'),
      (m.content || !files.length) && body, thumbs.length > 0 && h('div.pthumbs', thumbs), others));
}

const countText = (n) => (n ? (n === 1 ? 'Última mensagem' : `Últimas ${n} mensagens`) : 'Nenhuma mensagem ainda');
async function show(el, c) {
  if (!el?.isConnected || c.type === 4 || c.id === S.view.cid) return;
  hide();
  const n = P().chPreviewCount ?? 20, gid = c.guild_id;
  const dm = c.type === 1, peer = dm && dmPeer(c);
  const list = h('div.plist', h('div.ploading', 'Carregando…'));
  const typing = h('div.ptyping');
  box = h('div#chprev', { onmouseenter: () => clearTimeout(hideT), onmouseleave: () => { if (trigger() !== 'middle') hideSoon(); } },
    h('div.phd', dm ? h('span.hash', '@') : icon(c.type === 2 ? 'voice' : 'hash', 18), h('b', dm ? user(peer.id).display_name : chName(c)),
      h('small', 'Prévia'), h('button.ibtn', { title: 'Fechar (Esc)', onclick: hide }, icon('x', 16))),
    list, typing);
  cur = { c, el };
  // ao lado da lista de canais, alinhada à linha; altura em % da janela
  const r = el.getBoundingClientRect(), hh = Math.round(innerHeight * (P().chPreviewHeight ?? 45) / 100);
  Object.assign(box.style, { left: r.right + 10 + 'px', top: Math.max(8, Math.min(r.top - 40, innerHeight - hh - 8)) + 'px', height: hh + 'px' });
  const d = P().chPreviewDim ?? 0, main = document.getElementById('main');
  if (d > 0 && main) { const m = main.getBoundingClientRect(); dim = h('div#chprev-dim', { style: { left: m.left + 'px', top: m.top + 'px', width: m.width + 'px', height: m.height + 'px', background: `rgba(0,0,0,${d / 100})` } }); document.body.append(dim); }
  document.body.append(box);

  const me = box;
  let msgs;
  try { msgs = await api('GET', `/channels/${c.id}/messages?limit=${n}`); } catch { msgs = null; }
  if (box !== me) return; // já fechou ou trocou de canal
  if (!msgs) return list.replaceChildren(h('div.ploading', 'Não foi possível carregar.'));
  const g = cur.msgs = msgs.slice(-n);
  list.replaceChildren(h('div.pcount', countText(g.length)),
    ...g.map((m, i) => msgRow(m, g[i - 1], gid)));
  list.scrollTop = list.scrollHeight;
  list.querySelectorAll('img').forEach(i => i.addEventListener('load', () => { if (list.scrollHeight - list.scrollTop - list.clientHeight < 200) list.scrollTop = list.scrollHeight; }, { once: true }));
  paintTyping();
}

// quem está digitando no canal da prévia (atualizado pelo app a cada evento de digitação)
export function paintTyping() {
  if (!cur || !box) return;
  const el = box.querySelector('.ptyping'); if (!el) return;
  if (P().chPreviewTyping === false) return el.replaceChildren();
  const m = S.typing.get(cur.c.id), now = Date.now();
  const names = m ? [...m].filter(([u, t]) => t > now && u !== S.me?.id).map(([u]) => nameOf(u, cur.c.guild_id)) : [];
  el.replaceChildren(...(names.length ? [h('span.dots', h('i'), h('i'), h('i')), h('span', names.length > 3 ? 'Várias pessoas estão digitando…' : names.join(', ') + (names.length > 1 ? ' estão digitando…' : ' está digitando…'))] : []));
}
// mensagem nova chegou no canal da prévia: entra no fim da lista
export function previewMessage(m) {
  if (!cur?.msgs || !box || m.channel_id !== cur.c.id || cur.msgs.some(x => x.id === m.id)) return;
  const list = box.querySelector('.plist'), stick = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.append(msgRow(m, cur.msgs.at(-1), cur.c.guild_id)); cur.msgs.push(m);
  const cnt = list.querySelector('.pcount'); if (cnt) cnt.textContent = countText(cur.msgs.length);
  if (stick) list.scrollTop = list.scrollHeight;
}
export const previewOpenFor = () => cur?.c.id || null;
