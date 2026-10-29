import { h, icon, EMOJIS, setHour12 } from './util.js';

export const PERM = { ADMIN: 1, MANAGE_GUILD: 2, MANAGE_CHANNELS: 4, MANAGE_MESSAGES: 8, KICK: 16, CREATE_INVITE: 32, MANAGE_ROLES: 64, BAN: 128, MODERATE: 256 };
export const PERM_LABELS = [
  [PERM.ADMIN, 'Administrador', 'Todas as permissões; ignora qualquer restrição.'],
  [PERM.MANAGE_GUILD, 'Gerenciar servidor', 'Alterar nome e ícone do servidor.'],
  [PERM.MANAGE_CHANNELS, 'Gerenciar canais', 'Criar, editar e excluir canais.'],
  [PERM.MANAGE_MESSAGES, 'Gerenciar mensagens', 'Excluir mensagens de outros e fixar mensagens.'],
  [PERM.KICK, 'Expulsar membros', 'Remover membros do servidor.'],
  [PERM.CREATE_INVITE, 'Criar convite', 'Gerar links de convite.'],
  [PERM.MANAGE_ROLES, 'Gerenciar cargos', 'Criar cargos e atribuí-los a membros.'],
  [PERM.BAN, 'Banir membros', 'Banir e desbanir membros do servidor.'],
  [PERM.MODERATE, 'Castigar membros', 'Impedir temporariamente que alguém fale, reaja ou entre em voz.'],
];

export const S = {
  token: localStorage.getItem('lc_token'), me: null, ice: [],
  users: new Map(), guilds: new Map(), dms: new Map(), rels: new Map(),
  unread: {}, mentions: {}, voice: new Map(), // userId -> voice state
  messages: new Map(), loaded: new Map(), typing: new Map(),
  view: { kind: 'home', gid: null, cid: null, tab: 'online' },
  collapsed: new Set(JSON.parse(localStorage.getItem('lc_collapsed') || '[]')),
  lastChannel: JSON.parse(localStorage.getItem('lc_last') || '{}'),
  prefs: Object.assign({ volume: 100, echo: true, agc: true, noiseMode: 'rnnoise', gate: false, gateDb: -45, inputVolume: 100, inputMode: 'vad', pttKey: 'KeyV',
    zoom: 100, compact: false, desktopNotif: true, sounds: true, callSounds: true, inputId: '', outputId: '', videoId: '', theme: 'dark', accent: '#5865f2', reduceMotion: false,
    screen: { res: 1080, fps: 30, audio: true, hint: 'motion' },
    soundVolume: 80, fontFamily: 'default', msgGap: 17, radius: 8, hour12: false, highContrast: false, saturation: 100, underlineLinks: false, embedLinks: true, roleColors: true,
    confirmLinks: false, devMode: false, notifPreview: true, voiceBitrate: 64, camRes: 720, camFps: 30, keyMute: 'Ctrl+Shift+KeyM', keyDeafen: 'Ctrl+Shift+KeyD' },
    JSON.parse(localStorage.getItem('lc_prefs') || '{}')),
  replyTo: null, editing: null, pending: [], membersOpen: true, viewers: new Map(), watching: new Set(),
};
const DEVICE_KEYS = ['inputId', 'outputId', 'videoId']; // específicos de cada máquina: não sincronizam
let syncTimer;
export const savePrefs = () => {
  localStorage.setItem('lc_prefs', JSON.stringify(S.prefs));
  clearTimeout(syncTimer);
  if (S.token && S.synced) syncTimer = setTimeout(() => { const p = { ...S.prefs }; DEVICE_KEYS.forEach(k => delete p[k]); api('PUT', '/me/settings', { settings: p }).catch(() => { }); }, 1200);
};
export const desktop = window.lcDesktop || null; // ponte do app Electron (preload)
export function applyTheme() {
  const r = document.documentElement;
  r.dataset.theme = S.prefs.theme; r.style.fontSize = S.prefs.zoom + '%';
  const a = S.prefs.accent || '#5865f2';
  r.style.setProperty('--brand', a); r.style.setProperty('--brand-hover', `color-mix(in srgb, ${a} 80%, black)`);
  r.classList.toggle('reduce-motion', !!S.prefs.reduceMotion); r.classList.toggle('anim', S.prefs.animations !== false && !S.prefs.reduceMotion);
  r.classList.toggle('high-contrast', !!S.prefs.highContrast); r.classList.toggle('underline-links', !!S.prefs.underlineLinks);
  const fonts = { default: '"gg sans", "Noto Sans", "Segoe UI", Helvetica, Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'Consolas, "Cascadia Mono", "Courier New", monospace', rounded: '"Trebuchet MS", "Segoe UI", sans-serif', dyslexia: '"Comic Sans MS", "Comic Neue", "Segoe UI", sans-serif' };
  r.style.setProperty('--font', fonts[S.prefs.fontFamily] || fonts.default);
  r.style.setProperty('--msg-gap', (S.prefs.msgGap ?? 17) + 'px'); r.style.setProperty('--radius', (S.prefs.radius ?? 8) + 'px');
  r.style.setProperty('--sat', (S.prefs.saturation ?? 100) + '%'); setHour12(S.prefs.hour12);
}
// emojis personalizados de todos os servidores
export const allEmojis = () => [...S.guilds.values()].flatMap(g => (g.emojis || []).map(e => ({ ...e, guild: g.name, gid: g.id })));
export const emojiUrl = (id) => allEmojis().find(e => e.id === id)?.url;

export async function api(method, path, body) {
  const opt = { method, headers: { Authorization: 'Bearer ' + (S.token || '') } };
  if (body instanceof Blob) { opt.body = body; opt.headers['Content-Type'] = body.type || 'application/octet-stream'; }
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  const r = await fetch('/api' + path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || 'Erro ' + r.status); e.status = r.status; throw e; }
  return data;
}
export const tryApi = async (...a) => { try { return await api(...a); } catch (e) { toast(e.message, true); return null; } };

// ---------- consultas ----------
export const user = (id) => S.users.get(id) || { id, username: 'desconhecido', display_name: 'Usuário desconhecido', status: 'offline' };
export const guild = (id) => S.guilds.get(id);
export function channelById(id) {
  if (S.dms.has(id)) return S.dms.get(id);
  for (const g of S.guilds.values()) { const c = g.channels.find(c => c.id === id); if (c) return c; }
  return null;
}
export const member = (gid, uid) => S.guilds.get(gid)?.members.get(uid);
export function nameOf(uid, gid) { return member(gid, uid)?.nickname || user(uid).display_name || user(uid).username; }
export function roleColor(gid, uid) {
  if (S.prefs.roleColors === false) return '';
  const g = guild(gid), m = g?.members.get(uid); if (!g || !m) return '';
  const rs = g.roles.filter(r => m.roles.includes(r.id) && r.color && r.color !== '#99aab5').sort((a, b) => b.position - a.position);
  return rs[0]?.color || '';
}
export function perms(gid) {
  const g = guild(gid); if (!g) return 0;
  if (g.owner_id === S.me.id) return 0xffffff;
  let p = 0; const m = g.members.get(S.me.id);
  for (const r of g.roles) if (m?.roles.includes(r.id)) p |= r.perms;
  return p & PERM.ADMIN ? 0xffffff : p;
}
export const can = (gid, bit) => (perms(gid) & bit) !== 0;
export const dmPeer = (dm) => dm.recipients.find(r => r.id !== S.me.id) || dm.recipients[0];
export function relType(uid) { return S.rels.get(uid)?.type || 0; }
// política de notificação por servidor/canal (salva nas preferências)
export function notifPolicy(ch) {
  const c = S.prefs.notifyCfg || {}, g = ch?.guild_id ? (c[ch.guild_id] || {}) : {};
  return { level: g.level || 'all', muted: !!(g.muted || (c.channels || {})[ch?.id]), noEveryone: !!g.noEveryone };
}

// ---------- UI utilitários ----------
const layer = () => document.getElementById('layer');
export function toast(msg, err) {
  document.getElementById('toast')?.remove();
  const t = h('div#toast' + (err ? '.err' : ''), msg); document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}
export function modal(title, sub, body, buttons = [], opts = {}) {
  const close = () => bd.remove();
  const bd = h('div.backdrop', { onmousedown: (e) => { if (e.target === bd && !opts.sticky) close(); } },
    h('div.modal', opts.width ? { style: { width: opts.width } } : null,
      h('div.mh', h('h2', title), sub && h('p', sub)),
      h('div.mb', body),
      h('div.mf', buttons.map(b => h('button.btn' + (b.cls ? '.' + b.cls : ''), { onclick: async () => { if (b.fn) { const r = await b.fn(); if (r === false) return; } if (!b.keep) close(); } }, b.label)))));
  layer().append(bd); bd.querySelector('input,textarea')?.focus();
  return { close, el: bd };
}
export function confirmBox(title, text, label = 'Confirmar') {
  return new Promise(res => modal(title, text, h('div'), [{ label: 'Cancelar', cls: 'link', fn: () => res(false) }, { label, cls: 'red', fn: () => res(true) }]));
}
export function promptBox(title, label, value = '', okLabel = 'Salvar') {
  return new Promise(res => {
    const inp = h('input', { value, maxLength: 100 });
    const m = modal(title, '', h('label.f', label, inp), [{ label: 'Cancelar', cls: 'link', fn: () => res(null) }, { label: okLabel, fn: () => res(inp.value.trim()) }]);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { res(inp.value.trim()); m.close(); } });
    inp.select();
  });
}
export function closeFloating() { layer().querySelectorAll('.menu,.popout,.emoji-picker').forEach(e => e.remove()); }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu,.popout,.emoji-picker')) closeFloating(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeFloating(); document.getElementById('lightbox')?.remove(); } });
window.addEventListener('blur', closeFloating);

function place(el, x, y) {
  layer().append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
export function menu(e, items) {
  e.preventDefault(); closeFloating();
  const el = h('div.menu', items.filter(Boolean).map(i => i === '-' ? h('div.sp') : h('div.it' + (i.danger ? '.danger' : ''), { onclick: () => { closeFloating(); i.fn(); } }, i.label)));
  place(el, e.clientX, e.clientY);
}
export function popout(anchor, node, side = 'right') {
  closeFloating();
  const r = anchor.getBoundingClientRect(), el = h('div.popout', node);
  layer().append(el); const w = el.getBoundingClientRect();
  const x = side === 'left' ? r.left - w.width - 8 : r.right + 8;
  el.style.left = Math.max(8, Math.min(x, innerWidth - w.width - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(r.top, innerHeight - w.height - 8)) + 'px';
  return el;
}
export function emojiPicker(anchor, onPick, opts = {}) {
  closeFloating();
  const grid = h('div.emoji-grid'), q = h('input', { placeholder: 'Pesquisar emoji ou categoria' });
  const draw = () => {
    grid.replaceChildren(); const f = q.value.toLowerCase();
    if (!opts.noCustom) {
      const byGuild = new Map();
      for (const e of allEmojis()) if (!f || e.name.toLowerCase().includes(f)) (byGuild.get(e.guild) || byGuild.set(e.guild, []).get(e.guild)).push(e);
      for (const [g, list] of byGuild) grid.append(h('div.cap', g), ...list.map(e => h('span', { title: ':' + e.name + ':', onclick: () => { onPick(`<:${e.name}:${e.id}>`, e); closeFloating(); } }, h('img', { src: e.url, style: { width: '32px', height: '32px', objectFit: 'contain' } }))));
    }
    for (const [cat, list] of Object.entries(EMOJIS)) {
      if (f && !cat.toLowerCase().includes(f)) continue;
      grid.append(h('div.cap', cat), ...list.map(e => h('span', { onclick: () => { onPick(e); closeFloating(); } }, e)));
    }
  };
  q.oninput = draw; draw();
  const el = h('div.emoji-picker', q, grid), r = anchor.getBoundingClientRect();
  place(el, r.right - 352, r.top - 348); if (parseFloat(el.style.top) < 8) el.style.top = (r.bottom + 8) + 'px';
}
export function lightbox(src) {
  const lb = h('div#lightbox', { onclick: () => lb.remove() }, h('img', { src }));
  document.body.append(lb);
}

// ---------- som / notificação ----------
let actx;
export function beep() {
  if (!S.prefs.sounds) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 880; o.type = 'sine'; g.gain.setValueAtTime(.12, actx.currentTime); g.gain.exponentialRampToValueAtTime(.001, actx.currentTime + .25);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + .25);
  } catch { }
}
export function notify(title, body, onclick) {
  if (!S.prefs.desktopNotif || !('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(title, { body: body.slice(0, 140) });
  n.onclick = () => { window.focus(); onclick?.(); n.close(); };
}
export { h, icon };
