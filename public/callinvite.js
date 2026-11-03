// Convite para a chamada: quem está numa sala de voz chama um amigo/membro para lá.
// Quem recebe vê um aviso com toque (Entrar/Recusar) e um cartão na DM; quem convidou fica sabendo da resposta.
import { h, icon, avatar } from './util.js';
import { S, api, tryApi, toast, notify, user } from './state.js';
import { playSound } from './sounds.js';

let ctx = {};
export const initCallInvite = (c) => { ctx = c; };

const TXT = { accepted: 'aceitou', declined: 'recusou', expired: 'expirou', canceled: 'cancelado' };
const cache = new Map(); // id -> promessa do estado (o cartão e o aviso usam o mesmo)
const fetchInv = (id) => { if (!cache.has(id)) cache.set(id, api('GET', `/call-invites/${encodeURIComponent(id)}`).catch(() => null)); return cache.get(id); };

// posso convidar esta pessoa para a minha sala? (o servidor confere de novo)
export function canCallInvite(uid) {
  const voice = ctx.voice?.(); if (!voice?.channelId || uid === S.me.id) return false;
  const ch = ctx.channelById(voice.channelId); if (!ch || ch.type !== 2 || !ch.guild_id) return false;
  if (S.voice.get(uid)?.channel_id === ch.id) return false;
  const friend = S.rels.get(uid)?.type === 1, member = ctx.guild(ch.guild_id)?.members?.has(uid);
  return !!(friend || member);
}
export async function sendCallInvite(uid) {
  const r = await tryApi('POST', '/call-invites', { user_id: uid }); if (!r) return false;
  cache.set(r.invite.id, Promise.resolve(r.invite));
  toast(r.repeated ? `Convite já enviado a ${user(uid).display_name}` : `Convite para a chamada enviado a ${user(uid).display_name}`);
  return true;
}

async function accept(id) {
  try {
    const r = await api('POST', `/call-invites/${encodeURIComponent(id)}/accept`);
    document.getElementById('call-banner')?.remove();
    // virou membro agora: o servidor chega pelo GUILD_CREATE; espera um pouco para o canal existir no cliente
    for (let i = 0; i < 20 && !ctx.channelById(r.channel_id); i++) await new Promise(res => setTimeout(res, 100));
    ctx.go(r.guild_id, r.channel_id); ctx.joinVoice(r.channel_id);
    return true;
  } catch (e) { toast(e.message, true); return false; }
}
async function decline(id) {
  document.getElementById('call-banner')?.remove();
  await tryApi('POST', `/call-invites/${encodeURIComponent(id)}/decline`);
}

// cartão na DM (no lugar do link)
export function callCard(id) {
  const card = h('div.callcard.loading', h('div.cch', icon('voice', 16), h('span', 'Convite para a chamada')), h('div.ccbody', h('b', 'Carregando…')));
  card.dataset.id = id;
  fetchInv(id).then(inv => paintCard(card, inv));
  return card;
}
function paintCard(card, inv) {
  card.className = 'callcard';
  if (!inv) return card.replaceChildren(h('div.cch', icon('voice', 16), h('span', 'Convite para a chamada')), h('div.ccbody', h('b', 'Convite indisponível'), h('small', 'Expirou ou o servidor foi reiniciado.')));
  const mine = inv.from.id === S.me.id, st = inv.state, live = st === 'pending';
  const where = h('div.ccwhere', h('b', inv.channel.name), h('small', inv.guild.name + (inv.in_call ? ` · ${inv.in_call} na chamada` : ' · sala vazia')));
  const status = live ? (mine ? 'Aguardando resposta…' : `${inv.from.display_name} chamou você`) : mine ? `${user(inv.to).display_name} ${TXT[st] || st}` : st === 'accepted' ? 'Você aceitou' : st === 'declined' ? 'Você recusou' : `Convite ${TXT[st] || st}`;
  const btns = [];
  if (live && !mine) {
    btns.push(h('button.btn.green', { onclick: async (e) => { e.currentTarget.disabled = true; if (!await accept(inv.id)) e.currentTarget.disabled = false; } }, inv.member ? 'Entrar' : 'Entrar no servidor e na chamada'));
    btns.push(h('button.btn.grey', { onclick: () => decline(inv.id) }, 'Recusar'));
  } else if (live && mine) btns.push(h('button.btn.grey', { onclick: () => tryApi('POST', `/call-invites/${encodeURIComponent(inv.id)}/cancel`) }, 'Cancelar convite'));
  card.classList.toggle('done', !live); card.dataset.state = st;
  card.replaceChildren(h('div.cch', icon('voice', 16), h('span', 'Convite para a chamada')),
    h('div.ccbody', h('span.ccicon', icon('voice', 22)), where, btns.length ? h('div.ccbtns', btns) : null),
    h('div.ccstate', status));
}
const repaintCards = (inv) => document.querySelectorAll(`.callcard[data-id="${inv.id}"]`).forEach(c => paintCard(c, inv));

// recebi um convite: aviso com toque (o mesmo lugar do "está te ligando" das DMs)
export function onCallInvite(inv) {
  cache.set(inv.id, Promise.resolve(inv)); repaintCards(inv);
  if (S.me.status === 'dnd') return; // não perturbe: fica só o cartão na DM
  const u = inv.from; document.getElementById('call-banner')?.remove();
  let n = 0; const t = setInterval(() => { if (!document.getElementById('call-banner') || ++n > 5) return clearInterval(t); playSound('ring'); }, 2600);
  const el = h('div#call-banner.callinv', { 'data-id': inv.id }, avatar(S.users.get(u.id) || u, 48, { status: false }),
    h('div', { style: { flex: 1, minWidth: 0 } }, h('b', u.display_name), h('div.cbsub', 'chamou você para a sala'), h('div.cbsub.cbwhere', `${inv.channel.name} · ${inv.guild.name}`)),
    h('button.btn.green', { onclick: () => accept(inv.id) }, 'Entrar'), h('button.btn.red', { onclick: () => decline(inv.id) }, 'Recusar'));
  document.body.append(el); playSound('ring');
  notify(`${u.display_name} chamou você para a chamada`, `${inv.channel.name} · ${inv.guild.name}`, () => accept(inv.id));
  setTimeout(() => { if (document.getElementById('call-banner') === el) el.remove(); }, Math.max(5000, Math.min(60000, inv.expires_at - Date.now())));
}
export function onCallInviteUpdate(inv) {
  cache.set(inv.id, Promise.resolve(inv)); repaintCards(inv);
  const b = document.getElementById('call-banner'); if (b?.dataset.id === inv.id && inv.state !== 'pending') b.remove();
  if (inv.from.id === S.me.id && (inv.state === 'accepted' || inv.state === 'declined')) toast(`${user(inv.to).display_name} ${TXT[inv.state]} o convite para a chamada`);
}
