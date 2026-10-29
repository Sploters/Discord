import { h, avatar } from './util.js';
import { lightbox } from './state.js';
import { isLightPair, styleName } from './themes.js';

export const STATUS_TXT = { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível', offline: 'Offline' };

// Cartão de perfil (usado no popout e na prévia da tela de perfil)
export function profileCard(u, { nickname, roles = [], since, extra, accent } = {}) {
  const tp = u.theme_primary, ta = u.theme_accent, themed = !!(tp && ta);
  const color = themed ? tp : accent || u.banner_color || u.color || '#5865f2'; // com tema, o banner sem imagem segue a cor principal
  const banner = h('div.banner', { style: { background: u.banner ? `center / cover url("${u.banner}")` : color }, ...(u.banner ? { title: 'Ver banner', onclick: () => lightbox(u.banner) } : {}) });
  banner.classList.toggle('zoomable', !!u.banner);
  const av = avatar(u, 80, { ring: themed ? tp : 'var(--bg-float)' });
  if (u.avatar) { av.classList.add('zoomable'); av.title = 'Ver foto de perfil'; av.onclick = (e) => { e.stopPropagation(); lightbox(u.avatar); }; }
  const emoji = u.status_emoji && /^<:/.test(u.status_emoji) ? null : u.status_emoji;
  const el = h('div.pcard' + (themed ? '.themed' + (isLightPair(tp, ta) ? '.tlight' : '.tdark') : ''),
    banner,
    h('div.pa', av),
    h('div.pb',
      h('h3', styleName(h('span', nickname || u.display_name), u.name_style), u.pronouns && h('small.pron', u.pronouns)),
      h('div.un', u.username + (u.status && u.status !== 'offline' ? ' • ' + STATUS_TXT[u.status] : '')),
      (u.custom_status || emoji) && h('p.cstat', emoji && h('span', emoji + ' '), u.custom_status),
      h('hr'),
      u.bio && [h('h4', 'Sobre mim'), h('p', { style: { whiteSpace: 'pre-wrap' } }, u.bio)],
      h('h4', 'No LocalCord desde'), h('p', new Date(+u.created_at || Date.now()).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })),
      roles.length > 0 && [h('h4', 'Cargos'), h('div.chips', roles.map(r => h('span.chip', h('i.dot', { style: { background: r.color } }), r.name)))],
      extra));
  // variáveis CSS só entram via setProperty (Object.assign no style as ignora)
  el.style.setProperty('--pc', color);
  if (themed) { el.style.setProperty('--tp', tp); el.style.setProperty('--ta', ta); }
  return el;
}
