// Atividade social (Fase 1): estado em tempo real, aba "Atividade" (cartões) e página de contas vinculadas.
// A decisão de QUEM pode ver cada atividade é do servidor; aqui só se exibe o que ele enviou.
import { canCallInvite, sendCallInvite } from './callinvite.js';
import { h, icon, avatar } from './util.js';
import { S, api, tryApi, toast, confirmBox, guild, channelById } from './state.js';
import { toggle, row, section } from './ui.js';

const ctx = {}; // injetado por app.js: openDM, profile, userMenu, go, joinVoice, watchFriend, voice(), openSettings, renderActiveNow
export const initActivity = (c) => Object.assign(ctx, c);
S.activities = new Map();      // 'uid:platform' -> { user_id, platform, game:{id,title}, since, state }
S.integrations = null;         // [{ id, name, configured, capabilities, account }]
let feed = null, feedTimer = null;

const PLATFORM = { steam: 'Steam' };
export const platformName = (p) => PLATFORM[p] || p;
export function setActivities(list) { S.activities.clear(); for (const a of list || []) S.activities.set(a.user_id + ':' + a.platform, a); }
export const activityOf = (uid) => { for (const a of S.activities.values()) if (a.user_id === uid) return a; return null; };
export function onActivityUpdate(d) {
  const k = d.user_id + ':' + d.platform;
  if (d.activity) S.activities.set(k, d.activity); else S.activities.delete(k);
  ctx.renderActiveNow?.(); scheduleFeed();
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
const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'agora' : s < 3600 ? Math.round(s / 60) + ' min atrás' : s < 86400 ? Math.round(s / 3600) + ' h atrás' : Math.round(s / 86400) + ' d atrás'; };
const secsTxt = (s) => (s == null ? '' : dur(s * 1000));
export const playingLine = (a) => `Jogando ${a.game.title}`;

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

// ---------------------------------------------------------------- cartão
function card(uid, a) {
  const u = S.users.get(uid) || { id: uid, display_name: '?', username: '?' }, me = uid === S.me.id;
  const lk = feed?.friends.find(f => f.user_id === uid)?.linked.find(l => l.platform === a.platform);
  const btns = [h('button.btn.grey.sm', { onclick: (e) => { e.stopPropagation(); ctx.profile(e.currentTarget, uid); } }, 'Perfil'), !me && h('button.btn.grey.sm', { onclick: (e) => { e.stopPropagation(); ctx.openDM(uid); } }, icon('dm', 14), 'Mensagem'),
    ...(!me ? voiceActions(uid) : []),
    me && h('button.btn.grey.sm', { title: 'Este jogo nunca aparece como atividade', onclick: async (e) => { e.stopPropagation(); if (await tryApi('PUT', `/activity/games/${a.platform}/${a.game.id}`, { hidden: true }) && 1) { toast('Jogo escondido. Você pode reexibi-lo em Contas vinculadas.'); } } }, 'Esconder jogo')];
  return h('div.act-card', { oncontextmenu: (e) => ctx.userMenu(e, uid) },
    h('div.act-top', avatar(u, 44, { ring: 'var(--bg-sec)' }), h('div.act-who', h('b', me ? 'Você' : u.display_name), h('small', `${platformName(a.platform)} · ${since(a.since)}`))),
    h('div.act-game', icon('play', 16), h('span', a.game.title)),
    lk && lk.profile_url && h('a.act-link', { href: lk.profile_url, target: '_blank', rel: 'noopener noreferrer' }, `Perfil ${platformName(a.platform)}${lk.name ? ' de ' + lk.name : ''}`),
    h('div.act-btns', btns));
}

// ---------------------------------------------------------------- aba "Atividade"
export function activityTab(pane) {
  pane.id = 'actfeed';
  const body = h('div.act-body'); pane.replaceChildren(body);
  const draw = () => {
    if (!feed) return body.replaceChildren(h('div.an-empty', 'Carregando…'));
    const playing = feed.friends.flatMap(f => f.playing.map(a => ({ uid: f.user_id, a }))).sort((x, y) => (x.uid === S.me.id ? -1 : y.uid === S.me.id ? 1 : x.a.since - y.a.since));
    const linked = S.integrations?.some(i => i.account);
    const online = feed.friends.filter(f => f.user_id !== S.me.id && !f.playing.length).map(f => S.users.get(f.user_id)).filter(u => u && u.status && u.status !== 'offline');
    const uname = (id) => (id === S.me.id ? 'Você' : (S.users.get(id)?.display_name || '?'));
    body.replaceChildren(...[
      h('div.fh', `Jogando agora — ${playing.length}`),
      playing.length ? h('div.act-grid', playing.map(({ uid, a }) => card(uid, a)))
        : h('div.empty', { style: { margin: '24px 0' } }, h('div', { style: { fontSize: '40px' } }, '🎮'), h('p', 'Ninguém está jogando agora.'),
          !linked && h('div', h('p', { style: { color: 'var(--text-muted)' } }, 'Vincule sua conta Steam para seus amigos verem o que você joga.'), h('button.btn', { onclick: () => ctx.openSettings('connections') }, 'Vincular conta'))),
      online.length > 0 && [h('div.fh', `Online — ${online.length}`), h('div.act-online', online.map(u => h('div.an-row', { onclick: () => ctx.openDM(u.id), oncontextmenu: (e) => ctx.userMenu(e, u.id) }, avatar(u, 32, { ring: 'var(--bg-sec)' }), h('div.an-who', h('b', u.display_name), h('small', u.custom_status || 'Online')), ...voiceActions(u.id).slice(0, 2))))],
      feed.events.length > 0 && [h('div.fh', 'Atividade recente'), h('div.act-events', feed.events.map(ev => h('div.act-ev', icon(ev.kind === 'game_start' ? 'play' : 'stop', 14),
        h('span', h('b', uname(ev.user_id)), ev.kind === 'game_start' ? ' começou a jogar ' : ' jogou ', h('b', ev.game.title), ev.kind === 'game_stop' && ev.seconds != null ? ` por ${secsTxt(ev.seconds)}` : ''), h('small', ago(ev.at)))))]].flat().filter(Boolean));
  };
  S.redrawFeed = draw; draw();
  loadFeed().then(draw);
  clearInterval(S.feedClock); S.feedClock = setInterval(() => { if (!document.getElementById('actfeed')) return clearInterval(S.feedClock); draw(); }, 30000);
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
  return h('div', h('h2', 'Contas vinculadas'), box);
}
