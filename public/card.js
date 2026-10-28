import { h, avatar } from './util.js';

export const STATUS_TXT = { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível', offline: 'Offline' };

// Cartão de perfil (usado no popout e na prévia da tela de perfil)
export function profileCard(u, { nickname, roles = [], since, extra, accent } = {}) {
  const color = accent || u.banner_color || u.color || '#5865f2';
  const banner = h('div.banner', { style: { background: u.banner ? `center / cover url("${u.banner}")` : color } });
  const emoji = u.status_emoji && /^<:/.test(u.status_emoji) ? null : u.status_emoji;
  return h('div.pcard', { style: { '--pc': color } },
    banner,
    h('div.pa', avatar(u, 80, { ring: 'var(--bg-float)' })),
    h('div.pb',
      h('h3', nickname || u.display_name, u.pronouns && h('small.pron', u.pronouns)),
      h('div.un', u.username + (u.status && u.status !== 'offline' ? ' • ' + STATUS_TXT[u.status] : '')),
      (u.custom_status || emoji) && h('p.cstat', emoji && h('span', emoji + ' '), u.custom_status),
      h('hr'),
      u.bio && [h('h4', 'Sobre mim'), h('p', { style: { whiteSpace: 'pre-wrap' } }, u.bio)],
      h('h4', 'No LocalCord desde'), h('p', new Date(+u.created_at || Date.now()).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })),
      roles.length > 0 && [h('h4', 'Cargos'), h('div.chips', roles.map(r => h('span.chip', h('i.dot', { style: { background: r.color } }), r.name)))],
      extra));
}
