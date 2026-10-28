// Moderação: castigo (timeout), banimento e registro de auditoria
import { h, avatar, stamp } from './util.js';
import { tryApi, toast, modal, nameOf, user, guild, member } from './state.js';
import { seg } from './ui.js';

const DURATIONS = { 60: '60 s', 300: '5 min', 600: '10 min', 3600: '1 hora', 86400: '1 dia', 604800: '1 semana' };
export const timedOutUntil = (gid, uid) => { const t = member(gid, uid)?.timeout_until; return t && t > Date.now() ? t : null; };

export function timeoutDialog(gid, uid) {
  let secs = 600; const reason = h('input', { maxLength: 300, placeholder: 'Opcional' });
  modal(`Castigo para ${nameOf(uid, gid)}`, 'Durante o castigo a pessoa não envia mensagens, não reage e não entra em canais de voz.',
    h('div', h('label.f', 'Duração', seg(DURATIONS, String(secs), v => (secs = +v))), h('label.f', 'Motivo', reason)),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Aplicar castigo', cls: 'red', fn: async () => {
      const r = await tryApi('PATCH', `/guilds/${gid}/members/${uid}`, { timeout_until: Date.now() + secs * 1000, reason: reason.value });
      if (r) toast(`${nameOf(uid, gid)} está de castigo por ${DURATIONS[secs]}`);
    } }]);
}
export const removeTimeout = (gid, uid) => tryApi('PATCH', `/guilds/${gid}/members/${uid}`, { timeout_until: null }).then(r => r && toast('Castigo removido'));

export function banDialog(gid, uid, after) {
  const reason = h('input', { maxLength: 300, placeholder: 'Opcional' }), del = h('input', { type: 'checkbox' });
  modal(`Banir ${nameOf(uid, gid)}`, 'A pessoa sai do servidor e não consegue voltar por convite até ser desbanida.',
    h('div', h('label.f', 'Motivo', reason), h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, del, 'Apagar as mensagens dela das últimas 24 horas')),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Banir', cls: 'red', fn: async () => {
      const r = await tryApi('PUT', `/guilds/${gid}/bans/${uid}`, { reason: reason.value, delete_messages: del.checked });
      if (r) { toast('Usuário banido'); after?.(); }
    } }]);
}

const hint = (t) => h('div.hintline', t);
export function bansPage(gid) {
  const box = h('div');
  const draw = async () => {
    const list = await tryApi('GET', `/guilds/${gid}/bans`) || [];
    box.replaceChildren(...list.map(b => h('div.frow', { style: { cursor: 'default' } }, avatar(b.user || user(b.user_id), 36, { status: false }),
      h('div.fn', h('b', b.user?.display_name || 'Usuário excluído'), h('small', `${b.reason ? 'Motivo: ' + b.reason + ' • ' : ''}${stamp(b.created_at)}`)),
      h('button.btn.grey', { onclick: async () => { await tryApi('DELETE', `/guilds/${gid}/bans/${b.user_id}`); toast('Banimento removido'); draw(); } }, 'Desbanir'))));
    if (!list.length) box.append(hint('Ninguém banido.'));
  };
  draw();
  return h('div', h('h2', 'Banimentos'), box);
}

const ACTIONS = {
  member_kick: 'expulsou', member_ban: 'baniu', member_unban: 'desbaniu', member_timeout: 'deu castigo a', member_timeout_remove: 'tirou o castigo de',
  member_roles: 'alterou os cargos de', message_delete: 'apagou uma mensagem de', role_create: 'criou o cargo', role_update: 'editou o cargo', role_delete: 'excluiu o cargo',
  channel_create: 'criou o canal', channel_update: 'editou o canal', channel_delete: 'excluiu o canal', guild_update: 'editou o servidor', guild_transfer: 'transferiu o servidor para', invite_delete: 'revogou o convite',
};
const USER_TARGET = /^(member_|message_delete|guild_transfer)/;
export function auditPage(gid) {
  const box = h('div'), more = h('button.btn.grey', { style: { marginTop: '12px' } }, 'Carregar mais');
  const names = new Map();
  const nm = (id) => (id && guild(gid)?.members.has(id) ? nameOf(id, gid) : names.get(id)?.display_name || user(id).display_name);
  const load = async (before) => {
    const r = await tryApi('GET', `/guilds/${gid}/audit${before ? '?before=' + before : ''}`); if (!r) return;
    for (const u of r.users) names.set(u.id, u);
    for (const e of r.entries) {
      const tgt = USER_TARGET.test(e.action) ? h('b', nm(e.target_id)) : null;
      let det = e.details || '';
      if (e.action === 'member_timeout' && /^\d{4}-/.test(det)) det = 'até ' + new Date(det.slice(0, 24)).toLocaleString('pt-BR') + det.slice(24);
      box.append(h('div.frow', { style: { cursor: 'default' } }, avatar(names.get(e.actor_id) || user(e.actor_id), 32, { status: false }),
        h('div.fn', h('span', h('b', nm(e.actor_id)), ' ', ACTIONS[e.action] || e.action, tgt && ' ', tgt, det && !tgt ? ' ' : '', det && !tgt ? h('b', det) : null),
          h('small', stamp(e.created_at) + (det && tgt ? ' • ' + det : '')))));
    }
    more.style.display = r.entries.length === 100 ? '' : 'none';
    more.onclick = () => load(r.entries.at(-1).id);
    if (!box.children.length) box.append(hint('Nenhuma ação registrada ainda.'));
  };
  load();
  return h('div', h('h2', 'Registro de auditoria'), hint('Ações de moderação e de administração feitas neste servidor.'), box, more);
}
