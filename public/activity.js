// Atividade social: estado em tempo real, painel "Ativo agora" (o que os amigos fazem AGORA, em destaque, e os destaques
// marcantes da semana) e página de contas vinculadas.
// A decisão de QUEM pode ver cada atividade é do servidor; aqui só se exibe o que ele enviou.
import { canCallInvite, sendCallInvite } from './callinvite.js';
import { h, icon, avatar, clock } from './util.js';
import { chName } from './chnames.js';
import { styleName } from './themes.js';
import { S, api, tryApi, toast, confirmBox, guild, channelById, modal } from './state.js';
import { openClip } from './clipsgallery.js';
import { toggle, row, section, seg } from './ui.js';

const ctx = {}; // injetado por app.js: openDM, profile, userMenu, go, joinVoice, watchFriend, voice(), openSettings, renderActiveNow
export const initActivity = (c) => Object.assign(ctx, c);
S.activities = new Map();      // 'uid:platform' -> { user_id, platform, game:{id,title}, since, state }
S.integrations = null;         // [{ id, name, configured, capabilities, account }]
let feed = null, feedTimer = null;

const PLATFORM = { steam: 'Steam', pc: 'No PC' };
export const platformName = (p) => PLATFORM[p] || p;
export function setActivities(list) { S.activities.clear(); for (const a of list || []) S.activities.set(a.user_id + ':' + a.platform, a); }
export const activityOf = (uid) => { let pc = null; for (const a of S.activities.values()) if (a.user_id === uid) { if (a.platform !== 'pc') return a; pc = a; } return pc; };
export function onActivityUpdate(d) {
  const k = d.user_id + ':' + d.platform;
  if (d.activity) S.activities.set(k, d.activity); else S.activities.delete(k);
  ctx.renderActiveNow?.(); ctx.renderMembers?.(); scheduleFeed();
}
export function onIntegrationUpdate(d) {
  if (S.integrations) { const i = S.integrations.find(x => x.id === d.platform); if (i) i.account = d.account; }
  if (!d.account) for (const k of [...S.activities.keys()]) if (k === S.me.id + ':' + d.platform) S.activities.delete(k);
  S.refreshConnections?.(); scheduleFeed();
}
// a situação real mudou (alguém entrou/saiu de uma chamada, começou a transmitir…): redesenha os cartões para só mostrar ações possíveis
export const refreshFeedView = () => { if (document.getElementById('actfeed')) S.redrawFeed?.(); };
export function clearActivities() { S.activities.clear(); S.integrations = null; feed = null; }

const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); if (m < 1) return 'menos de 1 min'; if (m < 60) return m + ' min'; const hh = Math.floor(m / 60), mm = m % 60; return hh + 'h' + (mm ? ' ' + mm + 'min' : ''); };
const since = (t) => (Date.now() - t < 60000 ? 'começou agora' : 'há ' + dur(Date.now() - t));
export const playingLine = (a) => `Jogando ${a.game.title}`;

// ---------------------------------------------------------------- imagem do jogo
// 1) ícone do executável, mandado pelo app desktop de quem joga (/game-icons/<hash>.png)
// 2) arte oficial da Steam (Steam vinculada, ou jogo instalado pela Steam): endereço resolvido pelo servidor (/api/steam-art)
// 3) ícone genérico de controle
const steamIdOf = (a) => (a.platform === 'steam' ? a.game.id : a.game.steam) || null;
const iconUrl = (a) => (a.game.icon && /^[a-f0-9]{64}$/.test(a.game.icon) ? `/game-icons/${a.game.icon}.png` : null);
const art = new Map(); let artQ = new Set(), artTimer = null;
function steamArt(id) { // Promise<{ image, thumb } | null>, em lote (vários cartões ao mesmo tempo = 1 pedido)
  if (!/^\d+$/.test(String(id))) return Promise.resolve(null);
  if (art.has(id)) return art.get(id).p;
  let res; const p = new Promise(r => (res = r)); art.set(id, { p, res }); artQ.add(id);
  clearTimeout(artTimer); artTimer = setTimeout(async () => {
    const ids = [...artQ]; artQ = new Set();
    const r = await tryApi('GET', '/steam-art?ids=' + ids.join(',')).catch(() => null) || {};
    for (const x of ids) art.get(x)?.res(r[x]?.image ? r[x] : null);
  }, 30);
  return p;
}
// quadradinho do jogo (lista de membros, cartão, painel): ícone do programa; sem ele, o recorte da arte da Steam; senão o controle
export function gameIcon(a, size = 20) {
  const box = h('span.gicon', { style: { width: size + 'px', height: size + 'px' } });
  const set = (src, cover) => { const img = h('img', { src, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: () => box.replaceChildren(icon('gamepad', Math.round(size * .8))) }); if (cover) img.classList.add('cover'); box.replaceChildren(img); };
  const ic = iconUrl(a), sid = steamIdOf(a);
  if (ic) set(ic); else { box.append(icon('gamepad', Math.round(size * .8))); if (sid) steamArt(sid).then(x => { if (x?.thumb) set(x.thumb, true); }); }
  return box;
}
// faixa com a arte da Steam (cartões maiores); some quando não há arte
export function gameBanner(a) {
  const sid = steamIdOf(a); if (!sid) return null;
  const el = h('div.gbanner.hidden');
  steamArt(sid).then(x => { if (!x?.image) return; el.replaceChildren(h('img', { src: x.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: () => el.remove() })); el.classList.remove('hidden'); });
  return el;
}

// ---------------------------------------------------------------- popup do jogo
// capa (arte da Steam, ou o ícone do programa), tags e avaliação da Steam, quais amigos jogaram e "Ver na Steam"
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const sameGame = (x, a) => !!x && (x.id === a.game.id || norm(x.title) === norm(a.game.title) || (!!steamIdOf({ platform: x.platform || 'pc', game: x }) && steamIdOf({ platform: x.platform || 'pc', game: x }) === steamIdOf(a)));
function gamePeople(a) {
  const by = new Map(), get = (uid) => { if (!by.has(uid)) by.set(uid, { uid, now: null, secs: 0, days: 0, fresh: false }); return by.get(uid); };
  for (const x of S.activities.values()) if (sameGame({ ...x.game, platform: x.platform }, a)) get(x.user_id).now = x;
  for (const x of feed?.highlights || []) {
    if (!x.game || !sameGame({ ...x.game, platform: x.platform }, a)) continue;
    const p = get(x.user_id);
    if (x.kind === 'session' || x.kind === 'marathon') p.secs += x.seconds; else if (x.kind === 'streak') p.days = Math.max(p.days, x.days); else if (x.kind === 'new_game') p.fresh = true;
  }
  return [...by.values()].sort((x, y) => (y.now ? 1 : 0) - (x.now ? 1 : 0) || y.secs - x.secs).map(p => {
    const u = uOf(p.uid), bits = [p.now && `jogando agora · ${since(p.now.since)}`, p.secs && `${durShort(p.secs)} esta semana`, p.days >= 3 && `em ${p.days} dias`, p.fresh && 'jogo novo'].filter(Boolean);
    return h('div.gm-person', { onclick: (e) => ctx.profile(e.currentTarget, p.uid) }, avatar(u, 32, { ring: 'var(--bg-float)' }), h('div.an-who', h('b', p.uid === S.me.id ? 'Você' : u.display_name), h('small', bits.join(' · ') || 'jogou esta semana')));
  });
}
export function gameModal(a) {
  const sid = steamIdOf(a), ic = iconUrl(a);
  const hero = h('div.gm-hero', ic ? h('img.gm-icon', { src: ic, alt: '' }) : h('span.gm-icon.gm-ph', icon('gamepad', 44)));
  const meta = h('div.gm-meta'), tags = h('div.gm-tags');
  const store = sid && h('a.btn.gm-steam', { href: `https://store.steampowered.com/app/${sid}/`, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 16), 'Ver na Steam');
  const people = gamePeople(a);
  const body = h('div.gm', hero, h('div.gm-main',
    h('div.gm-head', h('h2', a.game.title), store),
    meta, tags,
    people.length ? [h('div.gm-cap', 'Amigos que jogaram'), h('div.gm-people', people)] : h('p.gm-none', 'Nenhum amigo jogou isto esta semana.')));
  const m = modal('', null, body, [], { width: 'min(560px, 94vw)' });
  const md = m.el.querySelector('.modal'); md.classList.add('gamemodal'); md.querySelector('.mf')?.remove(); md.querySelector('.mh')?.remove();
  hero.append(h('button.inv-x.gm-x', { title: 'Fechar', onclick: m.close }, icon('x', 20)));
  if (sid) steamArt(sid).then(x => {
    if (!x) return;
    if (x.image) { hero.prepend(h('img.gm-art', { src: x.image, alt: '', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() })); hero.classList.add('has-art'); }
    const rv = x.reviews; meta.replaceChildren(...[rv && h('span.gm-rev', icon('star', 14), `${rv.label} · ${rv.pct}%`), (x.free || x.price) && h('span', x.free ? 'Gratuito' : x.price)].filter(Boolean));
    tags.replaceChildren(...(x.tags || []).map(t => h('span.gm-tag', t)));
  });
  return m;
}
const openGame = (a) => (e) => { e?.stopPropagation(); gameModal(a); };

// ---------------------------------------------------------------- ações reais (só aparecem quando a situação permite)
function voiceActions(uid) {
  const v = S.voice.get(uid), ch = v && channelById(v.channel_id), voice = ctx.voice(), out = [];
  const g = ch && ch.type !== 1 ? guild(ch.guild_id) : null;
  const myCh = voice?.active ? voice.channelId : null;
  if (ch && myCh !== ch.id) out.push(h('button.btn.green.sm', { title: g ? `Entrar em ${g.name}` : 'Entrar na chamada', onclick: (e) => { e.stopPropagation(); ctx.go(g ? g.id : '@me', ch.id); ctx.joinVoice(ch.id); } }, icon('voice', 14), 'Entrar'));
  if (ch && v.screen && (myCh !== ch.id || voice.closedStreams.has(uid))) out.push(h('button.btn.sm', { title: 'Entrar e assistir à transmissão', onclick: (e) => { e.stopPropagation(); ctx.watchFriend(uid, ch); } }, icon('screen', 14), 'Assistir'));
  // convite: estou numa sala de servidor e a pessoa (amiga ou membro do servidor) está online e fora da sala.
  // Quem não é membro recebe o convite e, ao aceitar, entra no servidor e na chamada.
  const u = S.users.get(uid);
  if (u && u.status !== 'offline' && canCallInvite(uid)) out.push(h('button.btn.grey.sm', { title: 'Chamar para a sua chamada (a pessoa recebe um aviso para entrar)', onclick: async (e) => { e.stopPropagation(); await sendCallInvite(uid); } }, icon('invite', 14), 'Convidar'));
  return out;
}

// ---------------------------------------------------------------- painel "Ativo agora"
const STATUS = { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível', offline: 'Offline' };
const uOf = (id) => S.users.get(id) || { id, display_name: '?', username: '?' };
const nameEl = (u) => styleName(h('b', u.display_name), u.name_style);
const roomOf = (uid) => { const v = S.voice.get(uid), ch = v && channelById(v.channel_id); if (!ch) return null; const g = ch.type === 1 ? null : guild(ch.guild_id); return { v, ch, g }; };
const roomLine = (r) => h('div.an-room', icon('voice', 16), h('span', r.g ? `${chName(r.ch)} · ${r.g.name}` : 'Ligação privada'), r.v.screen && h('span.an-live', 'AO VIVO'), r.v.mute && icon('micoff', 14));
const goRoom = (r) => (r.g ? ctx.go(r.g.id, r.ch.id) : ctx.go('@me', r.ch.id));

// cartão de quem está jogando: arte da Steam (se houver), quem, jogo, há quanto tempo, a sala em que está e as ações possíveis
function playCard(uid, a) {
  const u = uOf(uid), r = roomOf(uid), lk = feed?.friends.find(f => f.user_id === uid)?.linked.find(l => l.platform === a.platform);
  return h('div.an-card.an-play', { onclick: (e) => ctx.profile(e.currentTarget, uid), oncontextmenu: (e) => ctx.userMenu(e, uid) },
    h('div.an-gamelink', { title: `Sobre ${a.game.title}`, onclick: openGame(a) }, gameBanner(a)),
    h('div.an-top', avatar(u, 40, { ring: 'var(--bg-sec)' }), h('div.an-who', nameEl(u), h('small', `${platformName(a.platform)} · ${since(a.since)}`)),
      h('button.ibtn.an-dm', { title: 'Mensagem', onclick: (e) => { e.stopPropagation(); ctx.openDM(uid); } }, icon('dm', 18))),
    h('div.an-game.an-gamelink', { title: `Sobre ${a.game.title}`, onclick: openGame(a) }, gameIcon(a, 22), h('span', a.game.title)),
    r && roomLine(r),
    lk && lk.profile_url && h('a.act-link', { href: lk.profile_url, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, `Perfil ${platformName(a.platform)}${lk.name ? ' de ' + lk.name : ''}`),
    h('div.act-btns', ...voiceActions(uid)));
}
// em chamada (sem jogo): a sala, quem é, ao vivo
function voiceCard(uid, r) {
  const u = uOf(uid);
  return h('div.an-card', { title: 'Ir para a sala', onclick: () => goRoom(r), oncontextmenu: (e) => ctx.userMenu(e, uid, r.g?.id) },
    h('div.an-top', avatar(u, 40, { ring: 'var(--bg-sec)' }), h('div.an-who', nameEl(u), h('small', r.g ? 'Em chamada de voz' : 'Em uma ligação privada'))),
    roomLine(r),
    h('div.act-btns', ...voiceActions(uid)));
}

// ---------------------------------------------------------------- destaques da semana
const durShort = (s) => { const m = Math.round(s / 60), hh = Math.floor(m / 60), mm = m % 60; return hh ? `${hh}h${mm ? ' ' + String(mm).padStart(2, '0') + 'min' : ''}` : `${m} min`; };
const dayHead = (t) => {
  const d = new Date(t), today = new Date(); const k = (x) => x.toDateString();
  if (k(d) === k(today)) return 'Hoje';
  if (k(d) === k(new Date(Date.now() - 864e5))) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' }).replace(/^./, c => c.toUpperCase());
};
function hlItem(x) {
  const u = uOf(x.user_id), a = x.game && { platform: x.platform, game: x.game };
  const who = h('b.hl-who', { title: 'Ver perfil', onclick: (e) => { e.stopPropagation(); ctx.profile(e.currentTarget, x.user_id); } }, x.user_id === S.me.id ? 'Você' : u.display_name);
  const game = x.game && h('b', x.game.title);
  let ic = a ? gameIcon(a, 18) : null, tag = null, text = [], open = a ? openGame(a) : (e) => ctx.profile(e.currentTarget, x.user_id), hint = a ? `Sobre ${x.game.title}` : '';
  if (x.kind === 'marathon') { tag = h('span.hl-tag.gold', icon('trophy', 12), 'Maratona'); text = [who, ' jogou ', game, ' por ', h('b', durShort(x.seconds))]; }
  else if (x.kind === 'session') text = [who, ' jogou ', game, ' por ', durShort(x.seconds)];
  else if (x.kind === 'new_game') { tag = h('span.hl-tag.new', icon('sparkle', 12), 'Jogo novo'); text = [who, ' começou a jogar ', game]; }
  else if (x.kind === 'streak') { tag = h('span.hl-tag.fire', icon('fire', 12), `${x.days} dias`); text = [who, ' jogou ', game, ` em ${x.days} dias diferentes esta semana`]; }
  else if (x.kind === 'clip') {
    const c = x.clip, st = c.streamer_id && c.streamer_id !== x.user_id ? uOf(c.streamer_id) : null;
    ic = h('span.gicon.hl-clipic', { style: { width: '18px', height: '18px' } }, icon('clip', 13)); tag = h('span.hl-tag.clip', icon('clip', 12), 'Clipe');
    text = [who, ' salvou um clipe', st ? [' da transmissão de ', h('b', st.display_name)] : '', ': ', h('i.hl-cliptitle', icon('play', 12), `“${c.title}”`)];
    open = () => openClip(c.id); hint = 'Assistir ao clipe';
  }
  return h('div.hl-item.hl-' + x.kind, { title: hint, onclick: open, oncontextmenu: (e) => ctx.userMenu(e, x.user_id) },
    h('div.hl-ic', avatar(u, 32, { status: false }), ic && h('span.hl-badge', ic)),
    h('div.hl-txt', tag, h('span', text.flat()), h('small', clock(x.at))));
}
// vários destaques iguais no mesmo dia (10 clipes da mesma pessoa, 4 partidas do mesmo jogo) viram uma linha só:
// "João salvou 10 clipes" (abre a lista) / "João jogou CS2 por 5h 10min em 4 partidas"
const hlKey = (x) => x.kind === 'clip' ? `clip|${x.user_id}` : `${x.kind === 'marathon' ? 'session' : x.kind}|${x.user_id}|${x.platform || ''}|${x.game?.id || ''}`;
function groupDay(items) {
  const out = [], by = new Map();
  for (const x of items) { const k = hlKey(x); let g = by.get(k); if (!g) { by.set(k, g = { k, list: [] }); out.push(g); } g.list.push(x); }
  return out;
}
const hlOpen = new Set(), dayOpen = new Set(); // o que a pessoa abriu continua aberto quando o painel redesenha (a cada 30 s)
const timeRange = (list) => { const a = clock(list[list.length - 1].at), b = clock(list[0].at); return a === b ? b : `${a} – ${b}`; };
function hlGroup(g, day, redraw) {
  const list = g.list, x = list[0];
  if (list.length === 1) return hlItem(x);
  const u = uOf(x.user_id), me = x.user_id === S.me.id;
  const who = h('b.hl-who', { title: 'Ver perfil', onclick: (e) => { e.stopPropagation(); ctx.profile(e.currentTarget, x.user_id); } }, me ? 'Você' : u.display_name);
  const key = day + '|' + g.k;
  if (x.kind === 'clip') {
    const open = hlOpen.has(key);
    const head = h('div.hl-item.hl-clip.hl-multi', { title: open ? 'Esconder os clipes' : 'Ver os clipes', 'aria-expanded': String(open), onclick: () => { open ? hlOpen.delete(key) : hlOpen.add(key); redraw(); }, oncontextmenu: (e) => ctx.userMenu(e, x.user_id) },
      h('div.hl-ic', avatar(u, 32, { status: false }), h('span.hl-badge', h('span.gicon.hl-clipic', { style: { width: '18px', height: '18px' } }, icon('clip', 13)))),
      h('div.hl-txt', h('span.hl-tag.clip', icon('clip', 12), 'Clipes'), h('span', who, ` salvou ${list.length} clipes`), h('small', timeRange(list))),
      h('span.hl-chev', icon('chevdown', 16)));
    if (!open) return head;
    return h('div.hl-group', head, h('div.hl-sub', ...list.map(c => h('button.hl-subitem', { title: 'Assistir ao clipe', onclick: () => openClip(c.clip.id) },
      icon('play', 12), h('span', c.clip.title || 'Clipe'), h('small', clock(c.at))))));
  }
  if (x.kind === 'session' || x.kind === 'marathon') {
    const a = { platform: x.platform, game: x.game }, secs = list.reduce((t, y) => t + (y.seconds || 0), 0), long = list.some(y => y.kind === 'marathon');
    return h('div.hl-item.hl-' + (long ? 'marathon' : 'session'), { title: `Sobre ${x.game.title}`, onclick: openGame(a), oncontextmenu: (e) => ctx.userMenu(e, x.user_id) },
      h('div.hl-ic', avatar(u, 32, { status: false }), h('span.hl-badge', gameIcon(a, 18))),
      h('div.hl-txt', long && h('span.hl-tag.gold', icon('trophy', 12), 'Maratona'), h('span', who, ' jogou ', h('b', x.game.title), ' por ', h('b', durShort(secs)), ` em ${list.length} partidas`), h('small', timeRange(list))));
  }
  return hlItem(x); // jogo novo e sequência não se repetem no mesmo dia; se vier repetido, mostra o mais recente
}
const DAY_MAX = 4; // linhas por dia antes do "Mostrar mais"
function hlDay(k, items, redraw) {
  const groups = groupDay(items), open = dayOpen.has(k), shown = open ? groups : groups.slice(0, DAY_MAX), rest = groups.length - shown.length;
  return h('div.hl-day', h('div.hl-dayh', k), ...shown.map(g => hlGroup(g, k, redraw)),
    rest > 0 && h('button.hl-more', { onclick: () => { dayOpen.add(k); redraw(); } }, icon('chevdown', 14), `Mostrar mais ${rest}`),
    open && groups.length > DAY_MAX && h('button.hl-more', { onclick: () => { dayOpen.delete(k); redraw(); } }, h('span.hl-up', icon('chevdown', 14)), 'Mostrar menos'));
}

// painel inteiro. Topo, em destaque: o que os amigos estão fazendo AGORA (jogando, em chamada, online). Embaixo: os destaques.
export function activityPanel(box) {
  box.id ||= 'active-now';
  const body = h('div#actfeed.an-body');
  box.replaceChildren(h('h3', 'Ativo agora'), body);
  const draw = () => {
    const friends = [...S.rels.values()].filter(r => r.type === 1).map(r => uOf(r.user.id));
    const byName = (x, y) => (x.u.display_name || '').localeCompare(y.u.display_name || '');
    const playing = [], inVoice = [], online = [];
    for (const u of friends) {
      const a = activityOf(u.id), r = roomOf(u.id);
      if (a) playing.push({ u, a }); else if (r) inVoice.push({ u, r }); else if (u.status && u.status !== 'offline') online.push({ u });
    }
    playing.sort((x, y) => x.a.since - y.a.since);
    const mine = activityOf(S.me.id);
    const now = [
      ...(playing.length ? [h('div.an-cap', `Jogando — ${playing.length}`), ...playing.map(({ u, a }) => playCard(u.id, a))] : []),
      ...(inVoice.length ? [h('div.an-cap', `Em chamada — ${inVoice.length}`), ...inVoice.sort(byName).map(({ u, r }) => voiceCard(u.id, r))] : []),
      ...(online.length ? [h('div.an-cap', `Online — ${online.length}`), ...online.sort(byName).map(({ u }) => h('div.an-row', { onclick: () => ctx.openDM(u.id), oncontextmenu: (e) => ctx.userMenu(e, u.id) }, avatar(u, 32, { ring: 'var(--bg-sec)' }),
        h('div.an-who', nameEl(u), h('small', u.custom_status || STATUS[u.status] || 'Online')), ...voiceActions(u.id).slice(0, 1)))] : []),
    ];
    if (!now.length) now.push(h('div.an-empty', h('b', 'Tudo quieto por aqui…'), h('p', 'Quando seus amigos jogarem, entrarem numa chamada ou ficarem online, eles aparecem aqui.'),
      !S.integrations?.some(i => i.account) && !window.lcDesktop?.detectGame && h('button.btn.sm', { onclick: () => ctx.openSettings('connections') }, 'Mostrar o que eu jogo')));
    // você também está jogando: linha discreta (dá para esconder o jogo daqui)
    if (mine) now.push(h('div.an-me', gameIcon(mine, 18), h('span', 'Você está jogando ', h('b', mine.game.title)),
      h('button.btn.link.sm', { title: 'Este jogo nunca aparece como atividade', onclick: async () => { if (await tryApi('PUT', `/activity/games/${mine.platform}/${encodeURIComponent(mine.game.id)}`, { hidden: true })) toast('Jogo escondido. Você pode reexibi-lo em Contas vinculadas.'); } }, 'Esconder jogo')));
    // destaques agrupados por dia
    const hl = feed?.highlights || [], groups = [];
    for (const x of hl) { const k = dayHead(x.at); let g = groups.find(y => y.k === k); if (!g) groups.push(g = { k, items: [] }); g.items.push(x); }
    const hist = !feed ? [h('div.an-empty.small', 'Carregando…')]
      : hl.length ? groups.map(g => hlDay(g.k, g.items, draw))
        : [h('div.an-empty.small', h('p', 'Nada marcante ainda esta semana. Partidas longas, jogos novos, sequências e clipes dos seus amigos aparecem aqui.'))];
    body.replaceChildren(h('section.an-now', ...now), h('section.an-hist', h('div.an-cap', 'Destaques da semana'), ...hist));
  };
  S.redrawFeed = draw; draw();
  loadFeed().then(() => { if (body.isConnected) draw(); });
  clearInterval(S.feedClock); S.feedClock = setInterval(() => { if (!body.isConnected) return clearInterval(S.feedClock); draw(); }, 30000);
}
async function loadFeed() {
  try {
    const [f, ints] = await Promise.all([api('GET', '/activity/feed'), S.integrations ? Promise.resolve(S.integrations) : api('GET', '/integrations')]);
    for (const u of f.users) if (!S.users.has(u.id)) S.users.set(u.id, u);
    feed = f; S.integrations = ints;
  } catch { /* Steam/servidor indisponível: mantém o que havia */ }
}
function scheduleFeed() {
  if (!document.getElementById('actfeed')) return;
  clearTimeout(feedTimer); feedTimer = setTimeout(() => loadFeed().then(() => document.getElementById('actfeed') && S.redrawFeed?.()), 400);
}

// ---------------------------------------------------------------- Configurações → Contas vinculadas
const SYNC = { pending: 'Aguardando a primeira sincronização…', ok: 'Sincronizado', private: 'Perfil da Steam privado: o jogo atual não aparece. Deixe o perfil e os "Detalhes do jogo" públicos na Steam.',
  not_found: 'A Steam não encontrou este perfil.', error: 'A Steam está indisponível no momento; tentamos de novo automaticamente.', unavailable: 'O servidor não consegue consultar a Steam (chave recusada ou ausente). Fale com o administrador.' };
export function connectionsPage(reg) {
  const box = h('div');
  const draw = async () => {
    let ints, hidden = [];
    try { [ints, hidden] = await Promise.all([api('GET', '/integrations'), api('GET', '/activity/hidden')]); S.integrations = ints; }
    catch (e) { return box.replaceChildren(h('p', { style: { color: 'var(--red)' } }, 'Não foi possível carregar: ' + e.message)); }
    box.replaceChildren(...ints.flatMap(i => {
      const a = i.account;
      const head = h('div.accrow', a?.avatar ? h('img.conn-av', { src: a.avatar, alt: '' }) : h('div.conn-av.ph', icon('play', 28)), h('div', h('div.big', i.name), h('div.mut', a ? (a.display_name || 'Conta vinculada') + ' · ' + (!i.configured ? 'Aguardando o servidor configurar a chave da ' + i.name : (SYNC[a.sync_state] || '')) : 'Não vinculada')));
      if (!a) return [section(i.name), h('div.card2', head,
        h('p.hintline', 'Usamos o login oficial da ' + i.name + ' (nunca pedimos sua senha). Seu perfil e os "Detalhes do jogo" precisam estar públicos para o jogo atual aparecer.'),
        !i.configured && h('p.hintline', { style: { color: 'var(--yellow, #faa61a)' } }, 'Este servidor ainda não tem a chave da ' + i.name + ': dá para vincular, mas o jogo atual só aparece depois que o administrador configurar.'),
        h('button.btn', { onclick: async () => { const r = await tryApi('POST', `/integrations/${i.id}/link`); if (r?.url) { window.open(r.url, '_blank', 'noopener'); toast('Conclua o login na janela que abriu e volte aqui.'); } } }, 'Vincular com a ' + i.name))];
      const patch = (body) => tryApi('PATCH', `/integrations/${i.id}`, body).then(r => { if (r) draw(); });
      return [section(i.name), h('div.card2', head,
        a.profile_url && h('a.act-link', { href: a.profile_url, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir perfil ' + i.name),
        row('Mostrar aos amigos o que estou jogando', 'Só amigos aceitos veem, em tempo real e no feed. Desligado, nada é consultado nem mostrado.', toggle(a.visibility === 'friends', (on) => patch({ visibility: on ? 'friends' : 'off' }))),
        row('Mostrar aos amigos que vinculei esta conta', 'Independente da opção acima: dá para esconder o jogo sem esconder o vínculo (e vice-versa).', toggle(a.link_visibility === 'friends', (on) => patch({ link_visibility: on ? 'friends' : 'off' }))),
        h('button.btn.red', { onclick: async () => { if (await confirmBox('Desvincular ' + i.name, 'Sua atividade deixa de ser consultada e o histórico dessa conta é apagado.', 'Desvincular')) { await tryApi('DELETE', `/integrations/${i.id}`); draw(); } } }, 'Desvincular')),
      hidden.filter(g => g.platform === i.id).length > 0 && [section('Jogos escondidos'), h('div.card2', h('p.hintline', 'Estes jogos nunca aparecem como atividade.'), ...hidden.filter(g => g.platform === i.id).map(g => row(g.title || 'Jogo ' + g.game_id, null, h('button.btn.grey', { onclick: async () => { await tryApi('PUT', `/activity/games/${g.platform}/${g.game_id}`, { hidden: false }); draw(); } }, 'Mostrar de novo'))))]].flat().filter(Boolean);
    }));
  };
  S.refreshConnections = draw; reg?.(() => { S.refreshConnections = null; });
  draw();
  return h('div', h('h2', 'Contas vinculadas'), pcActivityBlock(), box);
}
// jogo aberto no PC (app desktop detecta, como na transmissão): quem pode ver
export const PC_VIS = { servers: 'Amigos e quem está nos meus servidores', friends: 'Só amigos', off: 'Ninguém' };
function pcActivityBlock() {
  const box = h('div.card2', h('div', 'Carregando…'));
  const draw = (v) => box.replaceChildren(
    h('p.hintline', 'O app desktop (Windows) reconhece o jogo aberto no seu PC — o mesmo jeito que a transmissão acha o jogo — e mostra "Jogando …" para os outros, sem precisar vincular conta. Só o nome do jogo é enviado.'),
    row('Quem pode ver meu jogo do PC', null, seg(PC_VIS, v, async (nv) => { const r = await tryApi('PATCH', '/activity/pc', { visibility: nv }); if (r) { S.pcActivity = r.visibility; toast(nv === 'off' ? 'Seu jogo não aparece mais para ninguém.' : 'Pronto.'); } })),
    !window.lcDesktop?.detectGame && h('p.hintline', { style: { color: 'var(--text-muted)' } }, 'Neste aparelho a detecção não funciona (só no app desktop para Windows, versão 1.0.24 ou mais nova).'));
  tryApi('GET', '/activity/pc').then(r => { if (r) { S.pcActivity = r.visibility; draw(r.visibility); } });
  return [section('Jogo aberto no PC'), box];
}
