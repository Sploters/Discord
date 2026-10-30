import { h, icon, avatar, md, esc, stamp, clock, dayLabel, sameDay, bytes, onlyEmoji, isImageUrl, SHORT, inviteCodes, stripInvites, inviteText, parsePos, framePos, initials } from './util.js';
import { S, api, tryApi, user, guild, channelById, member, nameOf, roleColor, can, perms, PERM, dmPeer, relType, toast, modal, confirmBox, promptBox, menu, popout, emojiPicker, lightbox, closeFloating, beep, notify, notifPolicy, channelMuted, desktop, applyTheme, emojiUrl, allEmojis, savePrefs } from './state.js';
import { Voice, SCREEN_PRESETS, VOICE_BITRATES } from './voice.js';
import { playSound } from './sounds.js';
import { initMusic, onState as musicOnState, onRes as musicOnRes, openMusic } from './music.js';
import { openSoundboard, onIncoming as sbIncoming, handleKey as sbKey } from './soundboard.js';
import { openAudioPanel, openStatusPanel, openMicPanel, volumeControl } from './quick.js';
import { previewHooks, hidePreview, paintTyping as previewTyping, previewMessage } from './chpreview.js';
import { chName } from './chnames.js';
import { seg, qualityPanel, qualityLabel, comboFromEvent, comboToAccel } from './ui.js';
import { openSettings, openFullProfile } from './settings.js';
import { saveCustomTheme } from './themeeditor.js';
import { isLightPair, THEME_CODE_RE, decodeTheme, gradientCss, styleName, stripThemeCodes, themeText, encodeTheme, GRADIENT_THEMES, themeDef } from './themes.js';
import { profileCard, STATUS_TXT } from './card.js';
import { timeoutDialog, removeTimeout, banDialog, timedOutUntil } from './mod.js';
import { recordVoiceMessage, voiceEl } from './voicemsg.js';
import { initPlugins, mentionUser, addMention, resolveMentions } from './plugins.js';
import { toggleTranslation, isTranslated, translationBlock, translateOutgoing, draftMenu } from './translate.js';
applyTheme();

let ws, voice, retry = 0, ready = false, pendingInvite = null;
const $ = (s) => document.querySelector(s);
const gwSend = (t, d) => ws?.readyState === 1 && ws.send(JSON.stringify({ t, d }));
initMusic(gwSend);

// =============== Autenticação ===============
function showAuth(mode = 'login') {
  $('#app').classList.add('hidden');
  const a = $('#auth'); a.classList.remove('hidden'); a.replaceChildren();
  const err = h('div.err'), u = h('input', { autocomplete: 'username', maxLength: 32 }), p = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
  const dn = h('input', { maxLength: 32 }), p2 = h('input', { type: 'password' });
  const submit = async () => {
    err.textContent = '';
    if (mode === 'register' && p.value !== p2.value) return (err.textContent = 'As senhas não coincidem');
    try {
      const r = await api('POST', mode === 'login' ? '/login' : '/register', { username: u.value, password: p.value, display_name: dn.value });
      S.token = r.token; localStorage.setItem('lc_token', r.token); a.classList.add('hidden'); connect();
    } catch (e) { err.textContent = e.message; }
  };
  a.append(h('div.card', { onkeydown: (e) => e.key === 'Enter' && submit() },
    h('h1', mode === 'login' ? 'Boas-vindas de volta!' : 'Criar uma conta'),
    h('p.sub', mode === 'login' ? 'Estamos muito animados em te ver novamente!' : 'Junte-se ao servidor dos seus amigos.'),
    pendingInvite && h('p.sub', { style: { color: '#fff' } }, '🎟️ Você foi convidado! Entre para aceitar o convite.'),
    h('label.f', 'Nome de usuário', u),
    mode === 'register' && h('label.f', 'Nome de exibição (opcional)', dn),
    h('label.f', 'Senha', p), mode === 'register' && h('label.f', 'Confirmar senha', p2), err,
    h('button.btn.block', { onclick: submit }, mode === 'login' ? 'Entrar' : 'Continuar'),
    h('p', { style: { fontSize: '14px', color: 'var(--text-muted)', marginBottom: 0 } },
      mode === 'login' ? 'Precisa de uma conta? ' : 'Já tem uma conta? ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); showAuth(mode === 'login' ? 'register' : 'login'); } }, mode === 'login' ? 'Registre-se' : 'Entrar'))));
  u.focus();
}
function logout() {
  api('POST', '/logout').catch(() => { });
  localStorage.removeItem('lc_token'); S.token = null; voice?.leave(); ws?.close(); location.hash = ''; location.reload();
}

// =============== Gateway ===============
function connect() {
  clearTimeout(connect.t);
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/gateway?token=${S.token}`);
  ws.onmessage = (e) => { const { t, d } = JSON.parse(e.data); try { onEvent(t, d); } catch (err) { console.error(t, err); } };
  ws.onopen = () => { retry = 0; $('#reconnect')?.remove(); };
  ws.onclose = async () => {
    if (!S.token) return;
    try { await api('GET', '/users/0'); } catch (e) { if (e.status === 401) { localStorage.removeItem('lc_token'); S.token = null; return showAuth(); } }
    if (ready && !$('#reconnect')) document.body.append(h('div#reconnect', { style: { position: 'fixed', top: 0, left: 0, right: 0, background: '#f0b232', color: '#000', textAlign: 'center', padding: '4px', zIndex: 300, fontWeight: 600 } }, 'Conexão perdida. Reconectando…'));
    connect.t = setTimeout(connect, Math.min(1000 * 2 ** retry++, 8000));
  };
}

function ingestGuild(g) {
  const old = S.guilds.get(g.id);
  g.members = new Map(g.members.map(m => [m.user_id, m]));
  g.channels.sort((a, b) => a.position - b.position);
  for (const u of g.users) S.users.set(u.id, u);
  // limpa estados de voz antigos desta guilda
  for (const [uid, v] of S.voice) if (old?.channels.some(c => c.id === v.channel_id)) S.voice.delete(uid);
  for (const v of g.voice_states || []) S.voice.set(v.user_id, v);
  delete g.users; delete g.voice_states;
  S.guilds.set(g.id, g);
}

function onEvent(t, d) {
  switch (t) {
    case 'READY': {
      S.me = d.user; S.users.set(d.user.id, d.user); S.ice = d.ice; S.unread = d.unread; S.mentions = {};
      S.guilds.clear(); S.dms.clear(); S.rels.clear(); S.voice.clear();
      d.guilds.forEach(ingestGuild);
      for (const v of d.dm_voice || []) S.voice.set(v.user_id, v);
      for (const dm of d.dms) { S.dms.set(dm.id, dm); dm.recipients.forEach(u => S.users.set(u.id, u)); }
      for (const r of d.relationships) { S.rels.set(r.user.id, r); S.users.set(r.user.id, r.user); }
      if (!voice) voice = new Voice({ send: gwSend, ice: S.ice, myId: S.me.id, prefs: S.prefs, onUpdate: (speakOnly) => renderVoiceUI(speakOnly) });
      voice.onAutoAdjust = (msg) => toast(msg);
      voice.ice = S.ice;
      if (!ready) buildShell(); ready = true;
      $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
      applyTheme(); setupDesktop();
      if (!S.synced) api('GET', '/me/settings').then(r => { // sincroniza preferências entre dispositivos
        const keep = { inputId: S.prefs.inputId, outputId: S.prefs.outputId, videoId: S.prefs.videoId };
        Object.assign(S.prefs, r.settings || {}, keep); S.friendPolicy = r.friend_policy; S.synced = true;
        localStorage.setItem('lc_prefs', JSON.stringify(S.prefs)); applyTheme(); if (!Object.keys(r.settings || {}).length) savePrefs(); renderSide();
      }).catch(() => { S.synced = true; });
      if (pendingInvite) { const c = pendingInvite; pendingInvite = null; history.replaceState({}, '', '/'); joinInvite(c); }
      applyRoute(true);
      if (S.prefs.desktopNotif && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      break;
    }
    case 'USER_DELETE': { S.rels.delete(d.id); renderMembers(); renderSide(); if (S.view.kind === 'home') renderMain(); break; }
    case 'USER_UPDATE': {
      S.users.set(d.id, d); if (d.id === S.me.id) S.me = d;
      for (const dm of S.dms.values()) dm.recipients = dm.recipients.map(r => r.id === d.id ? d : r);
      for (const r of S.rels.values()) if (r.user.id === d.id) r.user = d;
      renderSide(); renderMembers(); refreshAuthors(d.id); if (S.view.kind === 'home') renderMain();
      break;
    }
    case 'GUILD_CREATE': ingestGuild(d); renderRail(); if (!S.view.gid || S.view.gid === 'new') go(d.id); else { renderSide(); } break;
    case 'GUILD_UPDATE': Object.assign(S.guilds.get(d.id) || {}, d); renderRail(); renderSide(); break;
    case 'GUILD_DELETE': {
      const g = S.guilds.get(d.id);
      if (g) for (const [uid, v] of S.voice) if (g.channels.some(c => c.id === v.channel_id)) { S.voice.delete(uid); if (uid === S.me.id) voice.leave(); }
      S.guilds.delete(d.id); renderRail();
      if (S.view.gid === d.id) { if (d.kicked) toast('Você foi removido do servidor.', true); go('@me'); }
      break;
    }
    case 'CHANNEL_CREATE': { const g = guild(d.guild_id); if (g) { g.channels.push(d); g.channels.sort((a, b) => a.position - b.position); renderSide(); } break; }
    case 'CHANNEL_UPDATE': { const g = guild(d.guild_id); if (g) { const i = g.channels.findIndex(c => c.id === d.id); if (i >= 0) g.channels[i] = d; renderSide(); if (S.view.cid === d.id) renderMain(); } break; }
    case 'CHANNEL_DELETE': {
      const g = guild(d.guild_id); if (!g) break;
      g.channels = g.channels.filter(c => c.id !== d.id); S.messages.delete(d.id);
      if (S.view.cid === d.id) go(d.guild_id); else renderSide();
      break;
    }
    case 'DM_CREATE': { S.dms.set(d.id, d); d.recipients.forEach(u => S.users.set(u.id, u)); renderSide(); renderRail(); break; }
    case 'MEMBER_ADD': { const g = guild(d.guild_id); if (g) { g.members.set(d.member.user_id, d.member); S.users.set(d.user.id, d.user); renderMembers(); } break; }
    case 'MEMBER_REMOVE': { const g = guild(d.guild_id); if (g) { g.members.delete(d.user_id); renderMembers(); } break; }
    case 'MEMBER_UPDATE': { const g = guild(d.guild_id); if (g) { g.members.set(d.user_id, { user_id: d.user_id, nickname: d.nickname, roles: d.roles, joined_at: d.joined_at, timeout_until: d.timeout_until }); renderMembers(); renderSide(); refreshAuthors(d.user_id); } break; }
    case 'ROLE_UPDATE': { const g = guild(d.guild_id); if (g) { const i = g.roles.findIndex(r => r.id === d.role.id); if (i >= 0) g.roles[i] = d.role; else g.roles.push(d.role); g.roles.sort((a, b) => b.position - a.position); renderMembers(); } break; }
    case 'ROLE_DELETE': { const g = guild(d.guild_id); if (g) { g.roles = g.roles.filter(r => r.id !== d.id); for (const m of g.members.values()) m.roles = m.roles.filter(r => r !== d.id); renderMembers(); } break; }
    case 'RELATIONSHIP': {
      S.users.set(d.user.id, d.user);
      if (!d.type) S.rels.delete(d.user.id); else S.rels.set(d.user.id, d);
      if (d.type === 3) { toast(`${d.user.display_name} enviou um pedido de amizade`); playSound('friend'); }
      renderRail(); if (S.view.kind === 'home') { renderMain(); renderSide(); }
      break;
    }
    case 'VOICE_STATE': {
      const prevVs = S.voice.get(d.user_id), before = prevVs?.channel_id, mineCh = voice.channelId;
      if (d.channel_id) S.voice.set(d.user_id, d); else S.voice.delete(d.user_id);
      if (S.view.kind === 'home') setTimeout(renderActiveNow);
      if (d.user_id === S.me.id && !d.channel_id) musicOnState({ active: false });
      if (d.user_id === S.me.id && !d.channel_id && voice.active && voice.channelId === d.prev_channel_id) voice.leave();
      if (d.user_id !== S.me.id) {
        const prevState = prevVs, dmCh = S.dms.get(d.channel_id || d.prev_channel_id);
        if (mineCh && d.channel_id === mineCh && before !== mineCh) playSound('join');
        else if (mineCh && !d.channel_id && d.prev_channel_id === mineCh) playSound('leave');
        else if (mineCh && d.channel_id === mineCh && before === mineCh) { // mudou algo dentro da minha sala
          if (d.screen && !prevState?.screen) playSound('streamStart');
          else if (!d.screen && prevState?.screen) playSound('streamStop');
          if (d.video && !prevState?.video) playSound('camOn');
          else if (!d.video && prevState?.video) playSound('camOff');
        } else if (dmCh && d.channel_id && !before && !mineCh) incomingCall(dmCh, d.user_id);
      }
      if (!d.channel_id && S.dms.has(d.prev_channel_id)) document.getElementById('call-banner')?.remove();
      renderSide(); renderRail(); renderVoiceUI(); if (S.view.cid && [1, 2].includes(channelById(S.view.cid)?.type)) renderCallBar();
      break;
    }
    case 'STREAM_VIEWERS': if (d.viewers.length) S.viewers.set(d.streamer_id, d.viewers); else S.viewers.delete(d.streamer_id); renderVoiceUI(); break;
    case 'SOUNDBOARD': sbIncoming(d, voice); break;
    case 'MUSIC_STATE': if (d.channel_id === voice.channelId) musicOnState(d); break;
    case 'MUSIC_RES': musicOnRes(d); break;
    case 'SOUNDS_UPDATE': { const g = guild(d.guild_id); if (g) { g.sounds = d.sounds; document.dispatchEvent(new Event('sb-changed')); } break; }
    case 'EMOJIS_UPDATE': { const g = guild(d.guild_id); if (g) { g.emojis = d.emojis; renderMessages(true); } break; }
    case 'VOICE_JOINED': voice.onJoined(d); break;
    case 'VOICE_DENIED': if (voice.channelId === d.channel_id) { voice.leave(); toast(d.reason, true); } break;
    case 'VOICE_PEER_LEFT': voice.onPeerLeft(d); break;
    case 'VOICE_SIGNAL': voice.onSignal(d); break;
    case 'SFU_RES': voice.onSfuRes(d); break;
    case 'PONG': wsPings.get(d.n)?.(); break;
    case 'SFU_NEW_PRODUCER': voice.onSfuProducer(d); break;
    case 'SFU_CONSUMER_CLOSED': voice.onSfuConsumerClosed(d); break;
    case 'TYPING': {
      let m = S.typing.get(d.channel_id); if (!m) S.typing.set(d.channel_id, m = new Map());
      m.set(d.user_id, Date.now() + 8000); renderTyping(); previewTyping(); setTimeout(() => { renderTyping(); previewTyping(); }, 8100); break;
    }
    case 'MESSAGE_CREATE': onMessage(d); break;
    case 'MESSAGE_UPDATE': {
      const list = S.messages.get(d.channel_id); const i = list?.findIndex(m => m.id === d.id);
      if (i >= 0) { list[i] = d; if (S.view.cid === d.channel_id) { const el = $(`[data-mid="${d.id}"]`); if (el) { const prev = list[i - 1]; el.replaceWith(msgEl(d, prev)); } } }
      break;
    }
    case 'MESSAGE_DELETE': {
      const list = S.messages.get(d.channel_id); if (!list) break;
      const i = list.findIndex(m => m.id === d.id); if (i >= 0) list.splice(i, 1);
      if (S.view.cid === d.channel_id) renderMessages(true);
      break;
    }
  }
}

const detached = new Set(); // canais em que estou vendo o início do histórico (sem as mensagens recentes)
function onMessage(m) {
  const list = S.messages.get(m.channel_id), gap = detached.has(m.channel_id);
  if (list && !gap && !list.some(x => x.id === m.id)) list.push(m);
  S.users.set(m.author.id, { ...S.users.get(m.author.id), ...m.author });
  const mine = m.author_id === S.me.id, viewing = S.view.cid === m.channel_id && document.hasFocus() && !vcChatHidden(channelById(m.channel_id));
  const t = S.typing.get(m.channel_id); if (t) { t.delete(m.author_id); renderTyping(); previewTyping(); }
  previewMessage(m);
  if (S.view.cid === m.channel_id && m.author_id !== S.me.id) $('#vc-chat-btn:not(.sel)')?.classList.add('unread'); // chat da sala fechado
  if (S.view.cid === m.channel_id && list && !gap) appendMessage(m);
  if (mine) return;
  const ch = channelById(m.channel_id), isDM = ch?.type === 1, pol = notifPolicy(ch);
  const text = m.content || '', direct = text.includes(`<@${S.me.id}>`);
  const isMention = isDM ? !pol.muted && pol.level !== 'none' : ((m.mentions || []).includes(S.me.id) && (direct || !pol.noEveryone)); // DM silenciada ainda conta como não lida, mas sem som nem aviso
  const counts = isDM || (isMention && pol.level !== 'none') || (!pol.muted && pol.level === 'all');
  if (!viewing) {
    if (counts) { const u = S.unread[m.channel_id] ||= { count: 0 }; u.count++; }
    if (isMention && pol.level !== 'none') {
      S.mentions[m.channel_id] = (S.mentions[m.channel_id] || 0) + 1;
      playSound('mention'); notify(isDM ? m.author.display_name : `${m.author.display_name} (#${ch?.name})`, S.prefs.notifPreview === false ? 'Nova mensagem' : (inviteText(themeText(text)) || 'Anexo'), () => go(ch.guild_id || '@me', ch.id));
    } else if (counts && !isDM) playSound('message');
    renderRail(); renderSide(); updateTitle();
  } else ack(m.channel_id);
}
function updateTitle() {
  const n = Object.values(S.mentions).reduce((a, b) => a + b, 0);
  document.title = (n ? `(${n}) ` : '') + 'LocalCord';
  desktop?.setBadge?.(n);
  const btn = document.querySelector('.inbox-btn'); if (btn) { btn.querySelector('.ibadge')?.remove(); const b = inboxBadge(); if (b) btn.append(b); }
}
function ack(cid) {
  if (!S.unread[cid] && !S.mentions[cid]) return;
  delete S.unread[cid]; delete S.mentions[cid]; api('POST', `/channels/${cid}/ack`).catch(() => { });
  renderRail(); renderSide(); updateTitle();
}
window.addEventListener('focus', () => S.view.cid && !vcChatHidden(channelById(S.view.cid)) && ack(S.view.cid));

// =============== Navegação ===============
function go(gid, cid) {
  const hash = `#/${gid || '@me'}${cid ? '/' + cid : ''}`;
  if (location.hash === hash) applyRoute(); else location.hash = hash;
}
// nomes de canais mudaram nas configurações: redesenha onde eles aparecem
const chNameKey = () => ['chCaps', 'chDashes', 'chNoEmoji', 'chNamesVoice', 'chNameWords'].map(k => S.prefs[k]).join('|');
let lastChNames = chNameKey();
document.addEventListener('settings-closed', () => { if (!ready || chNameKey() === lastChNames) return; lastChNames = chNameKey(); renderSide(); if (S.view.cid) renderMain(); });
window.addEventListener('hashchange', () => { hidePreview(); if (ready) applyRoute(); });
function applyRoute(first) {
  let [, gid, cid] = location.hash.match(/^#\/([^/]+)(?:\/(.+))?$/) || [];
  gid ||= '@me';
  if (gid === '@me') {
    S.view = { kind: 'home', gid: '@me', cid: cid && S.dms.has(cid) ? cid : null, tab: S.view.tab || 'online' };
    if (S.view.cid) S.view.kind = 'dm';
  } else {
    const g = guild(gid);
    if (!g) { location.hash = '#/@me'; return; }
    const chans = g.channels.filter(c => c.type !== 4);
    let ch = chans.find(c => c.id === cid) || chans.find(c => c.id === S.lastChannel[gid]) || chans.find(c => c.type === 0) || chans[0];
    S.view = { kind: 'guild', gid, cid: ch?.id || null };
    if (ch) { S.lastChannel[gid] = ch.id; localStorage.setItem('lc_last', JSON.stringify(S.lastChannel)); }
  }
  S.replyTo = null; S.editing = null; S.pending = []; closeFloating();
  $('#app').classList.remove('nav-open');
  syncWatching(null); renderRail(); renderSide(); renderMain();
  for (const sel of ['#msgs', '#stage', '#members', '#side .list']) { const e = $(sel); if (e) { e.classList.remove('sw'); void e.offsetWidth; e.classList.add('sw'); } }
}

// =============== Shell ===============
function buildShell() {
  document.addEventListener('click', (e) => { // confirmar antes de abrir links externos (opcional)
    const a = e.target.closest?.('.msg .body a[href]'); if (!a || !S.prefs.confirmLinks) return;
    e.preventDefault(); confirmBox('Abrir link externo?', a.href, 'Abrir').then(ok => ok && window.open(a.href, '_blank', 'noopener'));
  });
  $('#app').replaceChildren(h('div#rail'), h('div#side'), h('div#main'));
  $('#app').addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files') && $('#composer')) { e.preventDefault(); if (!$('#dropzone')) $('#chat').append(h('div#dropzone', 'Solte para anexar')); } });
  $('#app').addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('#dropzone')?.remove(); });
  initPlugins({ S, go, channelById, guild, user, dmPeer, menu, showInbox: (e) => showInbox(e), inboxBadge: () => inboxBadge() });
  $('#app').addEventListener('drop', (e) => { $('#dropzone')?.remove(); if (e.dataTransfer?.files?.length && $('#composer')) { e.preventDefault(); [...e.dataTransfer.files].forEach(addFile); } });
}

// ---------- trilho de servidores ----------
function guildUnread(g) { return g.channels.some(c => S.unread[c.id]); }
function guildMentions(g) { return g.channels.reduce((n, c) => n + (S.mentions[c.id] || 0), 0); }
function renderRail() {
  const rail = $('#rail'); if (!rail) return;
  document.getElementById('vcard')?.remove();
  const dmMentions = [...S.dms.keys()].reduce((n, id) => n + (S.mentions[id] || 0), 0);
  const pending = [...S.rels.values()].filter(r => r.type === 3).length;
  const wrap = (cls, tip, el, extra) => h('div.rail-wrap' + cls, { 'data-tip': tip }, el, extra);
  const badge = (n) => n > 0 ? h('div.badge', n > 99 ? '99+' : n) : null;
  rail.replaceChildren(
    wrap(S.view.gid === '@me' ? '.active' : '', 'Mensagens diretas', h('div.rail-item', { onclick: () => go('@me'), style: { fontSize: '0' } }, icon('dm', 28)), badge(dmMentions + pending)),
    h('div.sep'),
    ...[...S.guilds.values()].map(g => {
      const rooms = voiceRooms(g);
      const w = wrap((S.view.gid === g.id ? '.active' : '') + (guildUnread(g) && S.view.gid !== g.id ? '.unread' : ''), rooms.length ? null : g.name,
        h('div.rail-item', { onclick: () => go(g.id), oncontextmenu: (e) => guildMenu(e, g) }, g.icon ? h('img', { src: g.icon, alt: '' }) : g.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3)),
        badge(guildMentions(g)) || (rooms.length ? h('div.vbadge', { title: '' }, icon('voice', 12)) : null));
      if (rooms.length) { w.onmouseenter = () => voiceCard(w, g); w.onmouseleave = () => document.getElementById('vcard')?.remove(); }
      return w;
    }),
    wrap('', 'Adicionar um servidor', h('div.rail-item.add', { onclick: addServerModal, style: { fontSize: '0' } }, icon('plus', 24))));
}
// salas de voz ocupadas de um servidor: [{ ch, users: [voiceState] }]
const voiceRooms = (g) => g.channels.filter(c => c.type === 2).map(ch => ({ ch, users: [...S.voice.values()].filter(v => v.channel_id === ch.id) })).filter(r => r.users.length);
// cartão ao passar o mouse no servidor: quem está em qual sala
function voiceCard(anchor, g) {
  document.getElementById('vcard')?.remove();
  const r = anchor.getBoundingClientRect();
  const card = h('div#vcard', { style: { top: Math.max(8, r.top) + 'px' } }, h('div.vct', g.name),
    voiceRooms(g).map(({ ch, users }) => h('div.vcroom', h('div.vcname', icon('voice', 14), h('span', chName(ch)), callTimer(users)),
      h('div.vcusers', users.map(v => h('span.vcu', { title: nameOf(v.user_id, g.id), oncontextmenu: (e) => userMenu(e, v.user_id, g.id) }, avatar(user(v.user_id), 24, { status: false }), h('span', nameOf(v.user_id, g.id))))))));
  document.body.append(card);
}
// cronômetro da chamada: conta desde que a sala deixou de estar vazia
const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0'); return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`; };
const callTimer = (users) => { const t = users.find(v => v.started_at)?.started_at; return t ? h('span.vtimer', { 'data-start': t }, fmtDur(Date.now() - t)) : null; };
setInterval(() => document.querySelectorAll('.vtimer[data-start]').forEach(e => { e.textContent = fmtDur(Date.now() - +e.dataset.start); }), 1000);

function addServerModal() {
  const name = h('input', { value: `Servidor de ${S.me.display_name}`, maxLength: 100 }), code = h('input', { placeholder: 'https://… ou código do convite' });
  const m = modal('Crie seu servidor', 'Seu servidor é onde você e seus amigos conversam.', h('div',
    h('label.f', 'Nome do servidor', name),
    h('div', { style: { textAlign: 'center', color: 'var(--text-muted)', margin: '8px 0' } }, '— ou entre em um servidor —'),
    h('label.f', 'Link ou código de convite', code)),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Entrar com convite', cls: 'grey', fn: async () => { if (!code.value.trim()) { toast('Cole um convite', true); return false; } await joinInvite(code.value.trim().split('/').pop()); } }, { label: 'Criar', fn: async () => { const r = await tryApi('POST', '/guilds', { name: name.value }); if (!r) return false; setTimeout(() => go(r.id), 100); } }]);
}
async function joinInvite(code) {
  try {
    const info = await api('GET', `/invites/${encodeURIComponent(code)}`);
    const r = await api('POST', `/invites/${encodeURIComponent(code)}`);
    toast(`Você entrou em ${info.guild.name}!`); setTimeout(() => go(r.id), 150);
  } catch (e) { toast(e.message, true); return false; }
}

function guildMenu(e, g) {
  const owner = g.owner_id === S.me.id;
  menu(e, [
    { label: 'Convidar pessoas', fn: () => inviteModal(g) },
    { label: 'Marcar tudo como lido', fn: () => g.channels.forEach(c => ack(c.id)) },
    { label: 'Configurações de notificação…', fn: () => notifModal(g) },
    { label: 'Alterar apelido neste servidor', fn: async () => { const n = await promptBox('Apelido neste servidor', 'Apelido', member(g.id, S.me.id)?.nickname || ''); if (n != null) tryApi('PATCH', `/guilds/${g.id}/members/me`, { nickname: n }); } },
    '-',
    can(g.id, PERM.MANAGE_GUILD | PERM.MANAGE_ROLES | PERM.ADMIN) && { label: 'Configurações do servidor', fn: () => openSettings('server', { gid: g.id, voice, logout, go }) },
    can(g.id, PERM.MANAGE_CHANNELS) && { label: 'Criar canal', fn: () => channelModal(g, 0) },
    can(g.id, PERM.MANAGE_CHANNELS) && { label: 'Criar categoria', fn: () => channelModal(g, 4) },
    '-',
    S.prefs.devMode && { label: 'Copiar ID do servidor', fn: () => navigator.clipboard?.writeText(g.id) },
    owner ? { label: 'Excluir servidor', danger: true, fn: async () => { if (await confirmBox(`Excluir ${g.name}`, 'Essa ação é permanente e apaga todas as mensagens.', 'Excluir servidor')) tryApi('DELETE', `/guilds/${g.id}`); } }
      : { label: 'Sair do servidor', danger: true, fn: async () => { if (await confirmBox(`Sair de ${g.name}`, 'Você precisará de um novo convite para voltar.', 'Sair do servidor')) tryApi('DELETE', `/guilds/${g.id}/members/me`); } },
  ]);
}
// convidar para o servidor: amigos com botão "Convidar" (vai por DM) e o link para copiar embaixo
async function inviteModal(g) {
  const r = await tryApi('POST', `/guilds/${g.id}/invites`); if (!r) return;
  const link = `${location.origin}/invite/${r.code}`;
  const land = g.channels.filter(c => c.type === 0).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
  const friends = [...S.rels.values()].filter(x => x.type === 1).map(x => S.users.get(x.user.id) || x.user).filter(u => !g.members?.has(u.id))
    .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
  const sent = new Set(), list = h('div.inv-list'), q = h('input', { placeholder: 'Buscar amigos', oninput: () => draw() });
  let open = true;
  const sec = h('div.inv-sec', { onclick: () => { open = !open; sec.classList.toggle('closed', !open); list.classList.toggle('hidden', !open); } }, h('span', 'Convidar para o servidor'), icon('chevdown', 18));
  const send = async (u, btn) => {
    btn.disabled = true; btn.textContent = 'Enviando…';
    const dm = await ensureDM(u.id);
    if (dm && await tryApi('POST', `/channels/${dm.id}/messages`, { content: link })) { sent.add(u.id); btn.textContent = 'Enviado'; btn.classList.add('done'); }
    else { btn.disabled = false; btn.textContent = 'Convidar'; }
  };
  const draw = () => {
    const f = q.value.trim().toLowerCase();
    const rows = friends.filter(u => !f || (u.display_name || '').toLowerCase().includes(f) || (u.username || '').toLowerCase().includes(f));
    list.replaceChildren(...(rows.length ? rows.map(u => {
      const btn = h('button.inv-btn' + (sent.has(u.id) ? '.done' : ''), { disabled: sent.has(u.id), onclick: () => send(u, btn) }, sent.has(u.id) ? 'Enviado' : 'Convidar');
      return h('div.inv-row', avatar(u, 32, { status: false }), h('div.inv-who', h('b', u.display_name), h('small', u.username)), btn);
    }) : [h('div.inv-empty', friends.length ? 'Nenhum amigo encontrado.' : 'Todos os seus amigos já estão aqui (ou você ainda não tem amigos).')]));
  };
  const inp = h('input', { value: link, readOnly: true, onfocus: (e) => e.target.select() });
  const copy = h('button.btn', { onclick: () => { inp.select(); (navigator.clipboard?.writeText(link) || Promise.reject()).catch(() => document.execCommand('copy')); copy.textContent = 'Copiado'; copy.classList.add('green'); setTimeout(() => { copy.textContent = 'Copiar'; copy.classList.remove('green'); }, 1500); } }, 'Copiar');
  const dlg = modal(`Convidar amigos para ${g.name}`, null,
    h('div.inv',
      land && h('p.inv-land', 'Os convidados vão cair em ', h('span', icon('hash', 14), chName(land))),
      h('label.inv-search', icon('search', 16), q),
      h('div.inv-scroll', sec, list),
      h('div.inv-foot', h('label', 'Ou envie um link de convite para um amigo'), h('div.inv-copy', inp, copy), h('small', 'Este link de convite não expira.'))), []);
  dlg.el.querySelector('.modal')?.classList.add('invmodal');
  dlg.el.querySelector('.mh')?.append(h('button.inv-x', { title: 'Fechar', onclick: dlg.close }, icon('x', 20)));
  draw(); q.focus();
}
function channelModal(g, type, parent) {
  const name = h('input', { placeholder: type === 2 ? 'Sala de voz' : type === 4 ? 'Nova categoria' : 'novo-canal', maxLength: 100 });
  let t = type;
  const typeSel = type === 4 ? null : h('select', { onchange: (e) => (t = +e.target.value) }, h('option', { value: 0 }, 'Texto'), h('option', { value: 2, selected: type === 2 }, 'Voz'));
  modal(type === 4 ? 'Criar categoria' : 'Criar canal', '', h('div', typeSel && h('label.f', 'Tipo de canal', typeSel), h('label.f', 'Nome', name)),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Criar', fn: async () => { const r = await tryApi('POST', `/guilds/${g.id}/channels`, { name: name.value, type: t, parent_id: parent }); if (!r) return false; if (t !== 4) setTimeout(() => go(g.id, r.id), 100); } }]);
}

// ---------- barra lateral ----------
const chIcon = (c) => icon(c.type === 2 ? 'voice' : 'hash', 20);
function renderSide() {
  const side = $('#side'); if (!side) return;
  const keepScroll = $('#side-list')?.scrollTop || 0;
  let head, list;
  if (S.view.gid === '@me' || !guild(S.view.gid)) {
    head = h('div#side-head', { style: { cursor: 'default' } }, h('input', { placeholder: 'Encontre ou comece uma conversa', style: { width: '100%', background: 'var(--bg-tert)', border: 0, borderRadius: '4px', padding: '4px 6px', fontSize: '13px', outline: 'none' }, onfocus: (e) => { e.target.blur(); quickSwitch(); } }));
    const pending = [...S.rels.values()].filter(r => r.type === 3).length;
    list = h('div#side-list',
      h('div.ch' + (S.view.kind === 'home' ? '.active' : ''), { onclick: () => go('@me') }, icon('users'), h('span.name', 'Amigos'), pending > 0 && h('span.pill', pending)),
      ...(() => {
        const pins = pinnedDMs(), all = [...S.dms.values()].sort((a, b) => (lastActivity(b) > lastActivity(a) ? 1 : -1));
        const pinned = pins.map(id => all.find(d => dmPeer(d)?.id === id)).filter(Boolean), rest = all.filter(d => !pinned.includes(d));
        const dmRow = (dm, pin) => {
          const p = dmPeer(dm), un = S.mentions[dm.id];
          return h('div.ch' + (S.view.cid === dm.id ? '.active' : '') + (S.unread[dm.id] ? '.unread' : ''), { style: { height: '42px' }, onclick: () => go('@me', dm.id), oncontextmenu: (e) => userMenu(e, p.id), ...previewHooks(dm) },
            avatar(user(p.id), 32, { ring: 'var(--bg-sec)' }), styleName(h('span.name', user(p.id).display_name), user(p.id).name_style), un > 0 && h('span.pill', un), pin && h('span.dmpin', { title: 'Fixada' }, icon('pin', 18)));
        };
        return [pinned.length > 0 && h('div.cat', { style: { cursor: 'default' } }, 'Fixadas'), ...pinned.map(d => dmRow(d, true)),
          h('div.cat', { style: { cursor: 'default' } }, 'Mensagens diretas'), ...rest.map(d => dmRow(d, false))];
      })());
  } else {
    const g = guild(S.view.gid);
    head = h('div#side-head' + (g.banner ? '.banner' : ''), { style: g.banner ? { backgroundImage: `linear-gradient(transparent 40%, rgba(0,0,0,.65)), url("${g.banner}")` } : (g.accent ? { borderBottom: `3px solid ${g.accent}` } : null), }, // nome + seta abrem o menu do servidor; o botão ao lado convida
      h('div.gd', { title: 'Ações do servidor', onclick: () => { const r = head.getBoundingClientRect(); guildMenu({ preventDefault() { }, clientX: r.left + 8, clientY: r.bottom + 4 }, g); } }, h('span', g.name), icon('chevdown', 16)),
      h('button.gd-inv', { title: 'Convidar para o servidor', onclick: () => inviteModal(g) }, icon('invite', 20)));
    const cats = g.channels.filter(c => c.type === 4), kids = (pid) => g.channels.filter(c => c.type !== 4 && (c.parent_id || null) === pid);
    const chRow = (c) => {
      const vs = c.type === 2 ? [...S.voice.values()].filter(v => v.channel_id === c.id) : [];
      return h('div', h('div.ch' + (S.view.cid === c.id ? '.active' : '') + (S.unread[c.id] && c.type === 0 ? '.unread' : ''),
        { onclick: () => { go(g.id, c.id); }, oncontextmenu: (e) => channelMenu(e, g, c), ...previewHooks(c) },
        chIcon(c), h('span.name', chName(c)), vs.length > 0 && callTimer(vs), S.mentions[c.id] > 0 && h('span.pill', S.mentions[c.id]),
        can(g.id, PERM.MANAGE_CHANNELS) && h('span.actions', { onclick: (e) => { e.stopPropagation(); channelSettings(g, c); } }, icon('gear', 16))),
        vs.length > 0 && h('div.vusers', vs.map(v => vuserRow(g, v))));
    };
    const catRow = (c) => h('div', h('div.cat' + (S.collapsed.has(c.id) ? '.collapsed' : ''), { onclick: () => { S.collapsed.has(c.id) ? S.collapsed.delete(c.id) : S.collapsed.add(c.id); localStorage.setItem('lc_collapsed', JSON.stringify([...S.collapsed])); renderSide(); }, oncontextmenu: (e) => channelMenu(e, g, c) },
      h('span', { style: { display: 'flex', alignItems: 'center' } }, icon('caret', 12), chName(c)),
      can(g.id, PERM.MANAGE_CHANNELS) && h('span.add', { title: 'Criar canal', onclick: (e) => { e.stopPropagation(); channelModal(g, 0, c.id); } }, icon('plus', 16))),
      !S.collapsed.has(c.id) && kids(c.id).map(chRow),
      S.collapsed.has(c.id) && kids(c.id).filter(k => k.id === S.view.cid || S.unread[k.id]).map(chRow));
    list = h('div#side-list', kids(null).map(chRow), cats.map(catRow));
  }
  const area = h('div#user-area', voicePanel(), userbar());
  side.replaceChildren(head, list, area);
  $('#app').style.setProperty('--ua-h', area.offsetHeight + 'px'); // rail e lista reservam espaço pro painel flutuante
  list.scrollTop = keepScroll;
}
const lastActivity = (dm) => { const l = S.messages.get(dm.id); return l?.length ? l[l.length - 1].id : dm.id; };
function vuserRow(g, v) {
  const u = user(v.user_id);
  return h('div.vuser', { 'data-uid': v.user_id, oncontextmenu: (e) => userMenu(e, v.user_id, g.id), onclick: (e) => profile(e.currentTarget, v.user_id, g.id) },
    (() => { const a = avatar(u, 24, { status: false }); if (voice?.speaking.has(v.user_id)) a.classList.add('speaking'); if (voice?.sbActive.has(v.user_id)) a.classList.add('sbplay'); a.dataset.uid = v.user_id; return a; })(),
    h('span.nm', nameOf(v.user_id, g.id)), v.screen && h('span.live', 'Ao vivo'),
    h('span.ico', v.video && icon('video', 14), v.mute && icon('micoff', 14), v.deaf && icon('headoff', 14)));
}
function channelMenu(e, g, c) {
  menu(e, [
    c.type === 2 && { label: 'Entrar no canal de voz', fn: () => { go(g.id, c.id); joinVoice(c.id); } },
    S.unread[c.id] && { label: 'Marcar como lido', fn: () => ack(c.id) },
    c.type !== 4 && { label: channelMuted(c.id) ? 'Reativar canal' : 'Silenciar canal', fn: () => { const n = (S.prefs.notifyCfg ||= {}); const ch = (n.channels ||= {}); channelMuted(c.id) ? delete ch[c.id] : (ch[c.id] = true); savePrefs(); renderSide(); } },
    can(g.id, PERM.MANAGE_CHANNELS) && { label: 'Editar canal', fn: () => channelSettings(g, c) },
    can(g.id, PERM.CREATE_INVITE) || true ? { label: 'Convidar pessoas', fn: () => inviteModal(g) } : null,
    S.prefs.devMode && { label: 'Copiar ID do canal', fn: () => navigator.clipboard?.writeText(c.id) },
    can(g.id, PERM.MANAGE_CHANNELS) && '-',
    can(g.id, PERM.MANAGE_CHANNELS) && { label: 'Excluir canal', danger: true, fn: async () => { if (await confirmBox(`Excluir ${c.name}`, 'Isto não pode ser desfeito.', 'Excluir')) tryApi('DELETE', `/channels/${c.id}`); } },
  ]);
}
function notifModal(g) {
  const cfg = ((S.prefs.notifyCfg ||= {})[g.id] ||= { level: 'all', muted: false, noEveryone: false });
  const body = h('div', h('label.f', 'Notificações do servidor', seg({ all: 'Todas as mensagens', mentions: 'Apenas @menções', none: 'Nada' }, cfg.level, v => { cfg.level = v; savePrefs(); renderSide(); })),
    h('label.f', 'Silenciar servidor', seg({ 0: 'Não', 1: 'Sim' }, cfg.muted ? 1 : 0, v => { cfg.muted = !!v; savePrefs(); renderSide(); })),
    h('label.f', 'Suprimir @everyone e @here', seg({ 0: 'Não', 1: 'Sim' }, cfg.noEveryone ? 1 : 0, v => { cfg.noEveryone = !!v; savePrefs(); })));
  modal('Notificações — ' + g.name, 'Afeta contadores, sons e avisos deste servidor.', body, [{ label: 'Concluir' }]);
}
function channelSettings(g, c) {
  const name = h('input', { value: c.name, maxLength: 100 }), topic = h('input', { value: c.topic || '', maxLength: 1024 });
  modal('Configurações do canal', c.name, h('div', h('label.f', 'Nome do canal', name), c.type === 0 && h('label.f', 'Tópico', topic)),
    [{ label: 'Excluir', cls: 'red', fn: async () => { if (await confirmBox('Excluir canal', `Excluir ${c.name}?`, 'Excluir')) await tryApi('DELETE', `/channels/${c.id}`); } }, { label: 'Cancelar', cls: 'link' }, { label: 'Salvar', fn: () => tryApi('PATCH', `/channels/${c.id}`, { name: name.value, topic: topic.value }) }]);
}

function voicePanel() {
  if (!voice?.active) return h('div.hidden');
  const ch = channelById(voice.channelId), g = guild(ch?.guild_id);
  return h('div#voice-panel',
    h('div.t', h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, pingEl(), 'Voz conectada', voice.joinedAt && h('span.vtimer.vp-time', { 'data-start': voice.joinedAt, title: 'Tempo na chamada' }, fmtDur(Date.now() - voice.joinedAt)), abrEl()),
      h('span.vp-btns', h('button.ibtn', { title: 'Testar microfone, ruído e eco', onclick: (e) => openMicPanel(e.currentTarget, voice, { openSettings: (k) => openSettings(k, ctxSettings()) }) }, icon('waves', 20)),
        h('button.ibtn', { title: 'Desconectar', onclick: () => voice.leave() }, icon('phoneoff', 20)))),
    h('div.sub', { title: 'Ir para a sala', onclick: () => ch && (ch.type === 1 ? go('@me', ch.id) : go(ch.guild_id, ch.id)) }, `${ch?.type === 1 ? 'Chamada com ' + user(dmPeer(ch).id).display_name : (ch?.name || '')}${g ? ' / ' + g.name : ''}`),
    h('div.row',
      h('button' + (voice.cam ? '.on' : ''), { title: 'Câmera', onclick: () => voiceAct(() => voice.toggleCam()) }, icon('video', 20)),
      h('button' + (voice.screen ? '.on' : ''), { title: 'Transmitir tela', onclick: startShare }, icon('screen', 20)),
      h('button', { title: 'Soundboard', onclick: (e) => openSoundboard(e.currentTarget, voice, { openSettings: (k) => openSettings(k, ctxSettings()) }) }, icon('voice', 20)),
      h('button', { title: 'Música (bot) — indisponível', disabled: true, style: { opacity: .4, cursor: 'not-allowed' } }, icon('music', 20))));
}
const voiceAct = (fn) => Promise.resolve().then(fn).catch(e => toast(e.message, true));
function joinVoice(cid) {
  if (voice.channelId === cid) return;
  voice.join(cid).then(() => { if (voice.error) { toast(voice.error, true); voice.error = null; } });
}
function userbar() {
  const me = S.me, ctx = () => ({ voice, logout, go });
  return h('div#userbar',
    h('div.me', { onclick: (e) => openStatusPanel(e.currentTarget, { openSettings: (k) => openSettings(k, ctx()), openFullProfile, logout }), oncontextmenu: (e) => statusMenu(e), title: 'Status e perfil' }, avatar(me, 38, { ring: 'var(--bg-user)' }),
      h('div.names', styleName(h('div.dn', me.display_name), me.name_style), h('div.un', me.custom_status || STATUS_TXT[me.status]))),
    h('div.ubtn', h('button.ibtn' + (voice?.muted ? '.on' : ''), { title: voice?.muted ? 'Ativar microfone' : 'Silenciar', onclick: () => voiceToggle('mute') }, icon(voice?.muted ? 'micoff' : 'mic')),
      h('button.ibtn.caret', { title: 'Dispositivo de entrada, ruído e eco', onclick: (e) => openAudioPanel(e.currentTarget, voice, 'in', { openSettings: (k) => openSettings(k, ctx()) }) }, icon('caret', 14))),
    h('div.ubtn', h('button.ibtn' + (voice?.deafened ? '.on' : ''), { title: voice?.deafened ? 'Ativar áudio' : 'Ensurdecer', onclick: () => voiceToggle('deaf') }, icon(voice?.deafened ? 'headoff' : 'headset')),
      h('button.ibtn.caret', { title: 'Dispositivo de saída e volumes', onclick: (e) => openAudioPanel(e.currentTarget, voice, 'out', { openSettings: (k) => openSettings(k, ctx()) }) }, icon('caret', 14))),
    h('button.ibtn', { title: 'Configurações do usuário', onclick: () => openSettings('account', ctx()) }, icon('gear')));
}
function voiceToggle(k) { k === 'mute' ? voice.toggleMute() : voice.toggleDeaf(); }
function statusMenu(e) {
  const set = (status) => tryApi('PATCH', '/me', { status });
  menu(e, ['online', 'idle', 'dnd', 'invisible'].map(s => ({ label: STATUS_TXT[s], fn: () => set(s) })));
}

// ---------- quick switcher ----------
function quickSwitch() {
  const inp = h('input', { placeholder: 'Para onde você quer ir?', style: { width: '100%' } }), res = h('div');
  const items = [...[...S.dms.values()].map(d => ({ label: '@' + user(dmPeer(d).id).display_name, fn: () => go('@me', d.id) })),
    ...[...S.guilds.values()].flatMap(g => g.channels.filter(c => c.type !== 4).map(c => ({ label: `${c.type === 2 ? '🔊' : '#'} ${chName(c)}`, alt: c.name, hint: g.name, fn: () => go(g.id, c.id) }))),
    ...[...S.guilds.values()].map(g => ({ label: g.name, hint: 'servidor', fn: () => go(g.id) }))];
  const m = modal('Busca rápida', '', h('div', h('label.f', inp), res), [], {});
  const draw = () => { res.replaceChildren(...items.filter(i => (i.label + ' ' + (i.alt || '')).toLowerCase().includes(inp.value.toLowerCase())).slice(0, 10).map(i => h('div.role-row', { onclick: () => { m.close(); i.fn(); } }, i.label, h('small', { style: { marginLeft: 'auto', color: 'var(--text-muted)' } }, i.hint || '')))); };
  inp.oninput = draw; draw();
  inp.onkeydown = (e) => { if (e.key === 'Enter') res.firstChild?.click(); };
}
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && ready) { e.preventDefault(); quickSwitch(); } });

// =============== Perfil / menus de usuário ===============
async function profile(anchor, uid, gid) {
  const full = await tryApi('GET', `/users/${uid}`); if (!full) return;
  S.users.set(uid, { ...S.users.get(uid), ...full });
  const u = full, m = gid && gid !== '@me' ? member(gid, uid) : null, g = m && guild(gid);
  const rt = relType(uid), isMe = uid === S.me.id;
  const roles = g && m ? g.roles.filter(r => m.roles.includes(r.id)) : [];
  const actions = isMe ? h('button.btn.block', { onclick: () => { closeFloating(); openSettings('profile', { voice, logout, go }); } }, 'Editar perfil')
    : h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
      h('button.btn', { style: { flex: 1 }, onclick: () => openDM(uid) }, 'Mensagem'),
      rt === 0 && h('button.btn.grey', { onclick: async () => { await tryApi('POST', '/relationships', { username: u.username }); closeFloating(); toast('Pedido de amizade enviado'); } }, 'Adicionar amigo'),
      rt === 3 && h('button.btn.green', { onclick: async () => { await tryApi('PUT', `/relationships/${uid}`, {}); closeFloating(); } }, 'Aceitar'));
  const extra = [u.mutual_guilds?.length > 0 && !isMe && [h('h4', 'Servidores em comum'), h('p', u.mutual_guilds.map(x => x.name).join(', '))], actions];
  const node = profileCard(u, { nickname: m?.nickname, roles, extra, onImage: () => { closeFloating(); isMe ? openFullProfile() : openUserProfile(uid, gid); } }); // clicar na foto/banner abre o perfil completo (o próprio abre o editor)
  popout(anchor, node, anchor.closest('#members') || anchor.closest('.msg') ? 'left' : 'right');
}
// perfil completo de outra pessoa (clicar na foto/banner do cartão): banner e dados à esquerda, atividade e itens em comum à direita
async function openUserProfile(uid, gid) {
  const u = await tryApi('GET', `/users/${uid}`); if (!u) return;
  S.users.set(uid, { ...S.users.get(uid), ...u });
  const m = gid && gid !== '@me' ? member(gid, uid) : null, g = m && guild(gid);
  const roles = g && m ? g.roles.filter(r => m.roles.includes(r.id)) : [];
  const tp = u.theme_primary, ta = u.theme_accent, themed = !!(tp && ta), color = themed ? tp : u.banner_color || u.color || '#5865f2';
  const rt = relType(uid), notes = (S.prefs.notes ||= {});
  const date = (t) => new Date(+t || Date.now()).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
  const sec = (title, ...body) => h('section.upsec', h('h4', title), ...body);
  const bd = h('div.backdrop.upbd', { onmousedown: (e) => { if (e.target === bd) close(); } });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { bd.remove(); removeEventListener('keydown', onKey); };
  const banner = h('div.upbanner', { style: { background: color } });
  if (u.banner) banner.append(framePos(h('img', { src: u.banner, alt: '', draggable: false }), u.banner_pos));
  const av = avatar(u, 120, { ring: themed ? 'var(--ring)' : 'var(--bg-float)' });
  if (u.avatar) { av.classList.add('zoomable'); av.title = 'Ver foto de perfil'; av.onclick = () => lightbox(u.avatar); }
  const sent = () => h('button.btn.grey', { disabled: true }, 'Pedido enviado');
  const friendBtn = rt === 1 ? h('button.btn.grey.upico', { title: 'Amigos', onclick: (e) => menu(e, [{ label: 'Remover amizade', danger: true, fn: async () => { if (await confirmBox('Remover amizade', `Remover ${u.display_name} dos seus amigos?`, 'Remover')) { await tryApi('DELETE', `/relationships/${uid}`); close(); } } }]) }, icon('check', 18))
    : rt === 3 ? h('button.btn.green', { onclick: async () => { await tryApi('PUT', `/relationships/${uid}`, {}); close(); } }, 'Aceitar amizade')
    : rt === 4 ? sent()
    : rt === 0 && h('button.btn.grey', { onclick: async (e) => { const b = e.currentTarget; if (await tryApi('POST', '/relationships', { username: u.username })) { toast('Pedido de amizade enviado'); b.replaceWith(sent()); } } }, 'Adicionar amigo');
  // nota pessoal: fica só neste navegador, junto das preferências
  const note = h('textarea.upnote', { placeholder: 'Clique para adicionar uma nota', maxLength: 256, rows: 1 });
  note.value = notes[uid] || '';
  const grow = () => { note.style.height = '0'; note.style.height = note.scrollHeight + 'px'; };
  note.oninput = grow;
  note.onchange = () => { const v = note.value.trim(); if (v) notes[uid] = v; else delete notes[uid]; savePrefs(); };
  const emoji = u.status_emoji && /^<:/.test(u.status_emoji) ? null : u.status_emoji;
  const left = h('main.upleft',
    h('div.uphead', banner, h('div.upav', av)),
    h('div.upbody',
      h('h2', styleName(h('span', m?.nickname || u.display_name), u.name_style)),
      h('div.un', u.username + (u.pronouns ? ' • ' + u.pronouns : '') + (u.status && u.status !== 'offline' ? ' • ' + STATUS_TXT[u.status] : '')),
      (u.custom_status || emoji) && h('p.cstat', emoji && h('span', emoji + ' '), u.custom_status),
      h('div.upbtns',
        h('button.btn', { onclick: () => { close(); openDM(uid); } }, icon('dm', 16), 'Mensagem'),
        friendBtn,
        h('button.btn.grey.upico', { title: 'Mais', onclick: (e) => userMenu(e, uid, gid) }, icon('more', 18))),
      u.bio && sec('Sobre mim', h('p', { style: { whiteSpace: 'pre-wrap' } }, u.bio)),
      sec('No LocalCord desde', h('p', date(u.created_at))),
      m?.joined_at && sec(`Membro de ${g.name} desde`, h('p', date(m.joined_at))),
      roles.length > 0 && sec('Cargos', h('div.chips', roles.map(r => h('span.chip', h('i.dot', { style: { background: r.color } }), r.name)))),
      sec('Nota (só você vê)', note)));
  // abas: atividade (sala de voz atual) e o que vocês têm em comum
  const vs = S.voice.get(uid), vch = vs && channelById(vs.channel_id), vg = vch && [...S.guilds.values()].find(x => x.channels.some(c => c.id === vch.id));
  const friends = u.mutual_friends || [], guilds = u.mutual_guilds || [];
  const empty = (t) => h('div.upempty', t);
  const row = (img, name, sub, fn) => h('div.uprow' + (fn ? '.click' : ''), { onclick: fn }, img, h('div', h('b', name), sub && h('small', sub)));
  const tabs = [
    ['Atividade', () => vch ? [h('h4', 'Agora'), row(h('div.upgi', icon('voice', 22)), vg ? chName(vch) : 'Chamada', vg ? `Em uma sala de voz em ${vg.name}` : 'Em uma chamada', vg && (() => { close(); go(vg.id, vch.id); }))] : [empty(`${u.display_name} não está fazendo nada no momento.`)]],
    [`${friends.length} ${friends.length === 1 ? 'amigo' : 'amigos'} em comum`, () => friends.length ? friends.map(f => row(avatar(f, 40, { ring: 'var(--bg-float)' }), f.display_name, f.username, () => { close(); openUserProfile(f.id); })) : [empty('Nenhum amigo em comum.')]],
    [`${guilds.length} ${guilds.length === 1 ? 'servidor' : 'servidores'} em comum`, () => guilds.length ? guilds.map(x => row(x.icon ? h('img.upgi', { src: x.icon, alt: '' }) : h('div.upgi', initials(x.name)), x.name, '', () => { close(); go(x.id); })) : [empty('Nenhum servidor em comum.')]]];
  const panel = h('div.uppanel'), bar = h('div.uptabs');
  const show = (i) => { [...bar.children].forEach((b, j) => b.classList.toggle('on', i === j)); panel.replaceChildren(...tabs[i][1]()); };
  bar.append(...tabs.map(([t], i) => h('button', { onclick: () => show(i) }, t)));
  const card = h('div.upmodal' + (themed ? '.pcard.themed' + (isLightPair(tp, ta) ? '.tlight' : '.tdark') : ''),
    h('button.upclose', { title: 'Fechar', onclick: close }, icon('x', 16)),
    left, h('div.upright', bar, panel));
  card.style.setProperty('--pc', color);
  if (themed) { card.style.setProperty('--tp', tp); card.style.setProperty('--ta', ta); }
  bd.append(card); (document.getElementById('layer') || document.body).append(bd);
  addEventListener('keydown', onKey);
  show(0); requestAnimationFrame(grow);
}
// ---------- ações do menu do usuário ----------
const pinnedDMs = () => (S.prefs.pinnedDMs ||= []);
const isPinnedDM = (uid) => pinnedDMs().includes(uid);
const dmWith = (uid) => [...S.dms.values()].find(d => dmPeer(d)?.id === uid);
async function ensureDM(uid) {
  const dm = dmWith(uid) || await tryApi('POST', '/dms', { user_id: uid }); if (!dm) return null;
  S.dms.set(dm.id, dm); return dm;
}
// fixar: a conversa fica no topo das mensagens diretas
async function togglePinDM(uid) {
  const list = pinnedDMs(), i = list.indexOf(uid);
  if (i >= 0) list.splice(i, 1); else { if (!await ensureDM(uid)) return; list.push(uid); }
  savePrefs(); renderSide(); toast(i >= 0 ? 'Conversa desafixada' : `Conversa com ${user(uid).display_name} fixada no topo`);
}
// ligação: abre a DM e já entra na chamada dela
async function callUser(uid) {
  const dm = await ensureDM(uid); if (!dm) return;
  closeFloating(); go('@me', dm.id); if (voice?.channelId !== dm.id) joinVoice(dm.id);
}
// convite: escolhe um servidor seu e o link vai por mensagem direta
async function sendServerInvite(g, uid) {
  const r = await tryApi('POST', `/guilds/${g.id}/invites`); if (!r) return;
  const dm = await ensureDM(uid); if (!dm) return;
  if (await tryApi('POST', `/channels/${dm.id}/messages`, { content: `${location.origin}/invite/${r.code}` })) toast(`Convite para ${g.name} enviado a ${user(uid).display_name}`);
}
function inviteToServer(uid) {
  const gs = [...S.guilds.values()];
  if (!gs.length) return toast('Você ainda não está em nenhum servidor', true);
  const send = (g) => { dlg.close(); return sendServerInvite(g, uid); };
  const row = (g) => {
    const inside = g.members?.has(uid);
    return h('button.gpick' + (inside ? '.in' : ''), { disabled: inside, title: inside ? 'Já está neste servidor' : `Convidar para ${g.name}`, onclick: () => send(g) },
      g.icon ? h('img', { src: g.icon, alt: '' }) : h('span.gi', initialsOf(g.name)), h('b', g.name), h('small', inside ? 'Já é membro' : 'Convidar'));
  };
  const dlg = modal(`Convidar ${user(uid).display_name}`, 'Escolha o servidor. O convite vai por mensagem direta.', h('div.gplist', gs.map(row)), [{ label: 'Cancelar', cls: 'link' }]);
}
const initialsOf = (s) => (s || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
// mute: silencia a voz da pessoa só para você (nas chamadas)
const isLocalMuted = (uid) => !!S.prefs.mutedUsers?.[uid];
function toggleLocalMute(uid) {
  const m = (S.prefs.mutedUsers ||= {});
  if (m[uid]) delete m[uid]; else m[uid] = true;
  savePrefs(); voice?.applyVolume(uid); renderVoiceUI();
  toast(m[uid] ? `${user(uid).display_name} silenciado para você` : `${user(uid).display_name} não está mais silenciado`);
}

async function openDM(uid) {
  const dm = await tryApi('POST', '/dms', { user_id: uid }); if (!dm) return;
  S.dms.set(dm.id, dm); closeFloating(); go('@me', dm.id);
}
// quem está em voz numa sala que dá para entrar (e que não é a minha)
// menus da pessoa durante uma chamada (como no Discord)
function callUserMenu(e, uid, gid) {
  const g = gid && gid !== '@me' ? guild(gid) : null;
  if (uid === S.me.id) {
    const others = g ? g.channels.filter(c => c.type === 2 && c.id !== voice.channelId) : [];
    return menu(e, [
      { label: 'Perfil', fn: () => profile(e.target, uid, gid) },
      '-',
      { label: 'Mute', checked: voice.muted, fn: () => voiceToggle('mute') },
      { label: 'Deafen', checked: voice.deafened, fn: () => voiceToggle('deaf') },
      g && { label: 'Editar perfil do servidor', fn: async () => { const n = await promptBox('Apelido neste servidor', 'Apelido', member(g.id, S.me.id)?.nickname || ''); if (n != null) tryApi('PATCH', `/guilds/${g.id}/members/me`, { nickname: n }); } },
      others.length > 0 && '-',
      others.length > 0 && { label: 'Mover para', sub: others.map(c => ({ label: chName(c), fn: () => joinVoice(c.id) })) },
      S.prefs.devMode && '-', S.prefs.devMode && { label: 'Copiar ID do usuário', fn: () => navigator.clipboard?.writeText(uid) },
    ]);
  }
  const rt = relType(uid), p = S.prefs, flag = (k) => !!p[k]?.[uid], flip = (k) => { const m = (p[k] ||= {}); if (m[uid]) delete m[uid]; else m[uid] = true; savePrefs(); voice?.applyVolume(uid); renderVoiceUI(); };
  const invites = [...S.guilds.values()].filter(x => !x.members?.has(uid));
  menu(e, [
    { label: 'Perfil', fn: () => profile(e.target, uid, gid) },
    { label: 'Mensagem', fn: async () => { const dm = await ensureDM(uid); if (dm) go('@me', dm.id); } },
    { label: 'Iniciar Ligação', fn: () => callUser(uid) },
    '-',
    voice.peers.has(uid) && { node: volumeControl(voice, uid, 'mic', 'Volume do usuário') },
    voice.peers.get(uid)?.screenAudioEl && { node: volumeControl(voice, uid, 'screen', 'Áudio da transmissão') },
    '-',
    { label: 'Mute', checked: isLocalMuted(uid), fn: () => toggleLocalMute(uid) },
    { label: 'Silenciar Soundboard', checked: flag('sbMutedUsers'), fn: () => flip('sbMutedUsers') },
    { label: 'Desativar Vídeo', checked: flag('hiddenVideo'), fn: () => flip('hiddenVideo') },
    { label: 'Convidar para Servidor', sub: invites.length ? invites.map(x => ({ label: x.name, fn: () => sendServerInvite(x, uid) })) : [{ label: 'Já está em todos os seus servidores', fn: () => { } }] },
    rt === 1 ? { label: 'Remover Amizade', danger: true, fn: async () => { if (await confirmBox('Remover amizade', `Remover ${user(uid).display_name} dos seus amigos?`, 'Remover')) tryApi('DELETE', `/relationships/${uid}`); } }
      : rt === 3 ? { label: 'Aceitar Amizade', fn: () => tryApi('PUT', `/relationships/${uid}`, {}) }
      : rt === 4 ? { label: 'Cancelar Pedido de Amizade', fn: () => tryApi('DELETE', `/relationships/${uid}`) }
      : rt === 0 && { label: 'Adicionar Amizade', fn: () => tryApi('POST', '/relationships', { username: user(uid).username }).then(r => r && toast('Pedido enviado')) },
    rt !== 2 ? { label: 'Bloquear', danger: true, fn: () => tryApi('PUT', `/relationships/${uid}`, { type: 2 }) } : { label: 'Desbloquear', fn: () => tryApi('DELETE', `/relationships/${uid}`) },
    // moderação continua disponível para quem tem permissão
    g && g.owner_id !== uid && (can(gid, PERM.MODERATE) || can(gid, PERM.BAN) || can(gid, PERM.KICK)) && '-',
    g && can(gid, PERM.MODERATE) && g.owner_id !== uid && (timedOutUntil(gid, uid) ? { label: 'Remover castigo', fn: () => removeTimeout(gid, uid) } : { label: 'Castigo…', danger: true, fn: () => timeoutDialog(gid, uid) }),
    g && can(gid, PERM.BAN) && g.owner_id !== uid && { label: 'Banir…', danger: true, fn: () => banDialog(gid, uid) },
    g && can(gid, PERM.KICK) && g.owner_id !== uid && { label: 'Expulsar', danger: true, fn: async () => { if (await confirmBox('Expulsar membro', `Expulsar ${user(uid).display_name}?`, 'Expulsar')) tryApi('DELETE', `/guilds/${gid}/members/${uid}`); } },
    S.prefs.devMode && { label: 'Copiar ID do usuário', fn: () => navigator.clipboard?.writeText(uid) },
  ]);
}
function userMenu(e, uid, gid) {
  if (voice?.channelId) return callUserMenu(e, uid, gid);
  if (uid === S.me.id) return menu(e, [{ label: 'Perfil', fn: () => profile(e.target, uid, gid) }, S.prefs.devMode && { label: 'Copiar ID do usuário', fn: () => navigator.clipboard?.writeText(uid) }]);
  const g = gid && gid !== '@me' ? guild(gid) : null, rt = relType(uid), muted = isLocalMuted(uid);
  menu(e, [
    { label: isPinnedDM(uid) ? 'Desafixar' : 'Fixar', fn: () => togglePinDM(uid) },
    { label: 'Perfil', fn: () => profile(e.target, uid, gid) },
    { label: 'Iniciar Ligação', fn: () => callUser(uid) },
    { label: 'Convidar para Servidor', fn: () => inviteToServer(uid) },
    rt === 1 ? { label: 'Remover Amizade', danger: true, fn: async () => { if (await confirmBox('Remover amizade', `Remover ${user(uid).display_name} dos seus amigos?`, 'Remover')) tryApi('DELETE', `/relationships/${uid}`); } }
      : rt === 3 ? { label: 'Aceitar Amizade', fn: () => tryApi('PUT', `/relationships/${uid}`, {}) }
      : rt === 4 ? { label: 'Cancelar Pedido de Amizade', fn: () => tryApi('DELETE', `/relationships/${uid}`) }
      : rt === 0 && { label: 'Adicionar Amizade', fn: () => tryApi('POST', '/relationships', { username: user(uid).username }).then(r => r && toast('Pedido enviado')) },
    rt !== 2 ? { label: 'Bloquear', danger: true, fn: () => tryApi('PUT', `/relationships/${uid}`, { type: 2 }) } : { label: 'Desbloquear', fn: () => tryApi('DELETE', `/relationships/${uid}`) },
    { label: muted ? 'Desmutar' : 'Mute', fn: () => toggleLocalMute(uid) },
    voice?.peers.has(uid) && '-',
    voice?.peers.has(uid) && { node: volumeControl(voice, uid, 'mic', 'Volume do usuário') },
    voice?.peers.get(uid)?.screenAudioEl && { node: volumeControl(voice, uid, 'screen', 'Áudio da transmissão') },
    g && '-',
    g && can(gid, PERM.MANAGE_ROLES) && { label: 'Apelido…', fn: async () => { const n = await promptBox('Alterar apelido', 'Apelido', member(gid, uid)?.nickname || ''); if (n != null) tryApi('PATCH', `/guilds/${gid}/members/${uid}`, { nickname: n }); } },
    g && can(gid, PERM.MODERATE) && g.owner_id !== uid && (timedOutUntil(gid, uid) ? { label: 'Remover castigo', fn: () => removeTimeout(gid, uid) } : { label: 'Castigo…', danger: true, fn: () => timeoutDialog(gid, uid) }),
    g && can(gid, PERM.BAN) && g.owner_id !== uid && { label: 'Banir…', danger: true, fn: () => banDialog(gid, uid) },
    g && can(gid, PERM.KICK) && g.owner_id !== uid && { label: 'Expulsar', danger: true, fn: async () => { if (await confirmBox('Expulsar membro', `Expulsar ${user(uid).display_name}?`, 'Expulsar')) tryApi('DELETE', `/guilds/${gid}/members/${uid}`); } },
    '-', S.prefs.devMode && { label: 'Copiar ID do usuário', fn: () => navigator.clipboard?.writeText(uid) },
  ]);
}

// =============== Área principal ===============
const callActive = (cid) => voice?.channelId === cid || [...S.voice.values()].some(v => v.channel_id === cid);
function renderCallBar() { // mostra/oculta o palco de chamada nas DMs
  const ch = channelById(S.view.cid); if (!ch) return;
  if (ch.type === 1 && callActive(ch.id) !== !!$('#stage')) renderMain(); else renderVoiceUI();
}
function renderMain() {
  const main = $('#main'); if (!main) return;
  const v = S.view;
  if (v.kind === 'home') return renderHome(main);
  const ch = channelById(v.cid);
  if (!ch) return main.replaceChildren(h('div.empty', { style: { margin: 'auto' } }, h('h2', 'Sem canais'), h('p', 'Este servidor ainda não tem canais.')));
  const dm = ch.type === 1, vc = ch.type === 2, peer = dm && dmPeer(ch);
  const search = h('input.search', { placeholder: 'Buscar', title: 'Filtros: de:nome  tem:imagem|arquivo|link|video  em:canal', onkeydown: (e) => { if (e.key === 'Enter') doSearch(search.value); if (e.key === 'Escape') { search.value = ''; closeResults(); } } });
  const inCall = dm && callActive(ch.id), chatOpen = !vcChatHidden(ch);
  const top = h('div#topbar',
      h('button.ibtn.menu-btn', { onclick: () => $('#app').classList.toggle('nav-open'), style: { display: innerWidth <= 640 ? 'flex' : 'none' } }, icon('more')),
      dm ? [h('span.hash', '@'), h('span', user(peer.id).display_name), h('div.status.s-' + user(peer.id).status, { style: { position: 'static', borderColor: 'transparent', width: '10px', height: '10px', minWidth: 0, minHeight: 0 } })]
        : [h('span.hash', icon(vc ? 'voice' : 'hash', 24)), h('span', { title: ch.name }, chName(ch)), ch.topic && h('span.topic', ch.topic)],
      h('div.spacer'),
      // sala de voz: só o botão que mostra o chat; aberto, ele vira o X no topo do próprio chat
      vc ? !chatOpen && h('button#vc-chat-btn.ibtn' + (S.unread[ch.id] ? '.unread' : ''), { title: 'Mostrar chat', onclick: () => toggleVcChat(ch) }, icon('dm')) : [
        dm && h('button.ibtn', { title: voice.channelId === ch.id ? 'Desligar' : 'Iniciar chamada de voz', onclick: () => voice.channelId === ch.id ? voice.leave() : joinVoice(ch.id) }, icon(voice.channelId === ch.id ? 'phoneoff' : 'phone')),
        h('button.ibtn', { title: 'Ir para a primeira mensagem', onclick: jumpToTop }, icon('totop')),
        h('button.ibtn.notif-btn', { title: 'Notificações', onclick: (e) => notifMenu(e, ch) }, icon('bell')),
        h('button.ibtn.pins-btn', { title: 'Mensagens fixadas', onclick: showPins }, icon('pin')),
        !dm && h('button.ibtn' + (S.membersOpen ? '.sel' : ''), { title: 'Lista de membros', onclick: () => { S.membersOpen = !S.membersOpen; renderMain(); } }, icon('users')),
        search]);
  // sala de voz: a barra do topo fica junto com o palco (mesmo fundo) e o chat ocupa a altura toda ao lado, como no Discord
  main.replaceChildren(...[!vc && top,
    h('div#content',
      vc && h('div#vcall', top, h('div#stage')),
      chatOpen && h('div#chat' + (vc ? '.side' : ''),
        vc && h('div.vchead', h('span.vcico', icon('dm', 20)), h('span.vctitle', { title: ch.name }, chName(ch)), h('button.ibtn', { title: 'Fechar chat', onclick: () => toggleVcChat(ch) }, icon('x'))),
        inCall && h('div#stage.dmstage'), h('div#msgs'), h('div#typing'), composer(ch, dm ? '@' + user(peer.id).display_name : (vc ? 'chat de ' : '#') + chName(ch))),
      !dm && !vc && S.membersOpen && h('div#members'))].filter(Boolean));
  if (chatOpen) { stickToBottom($('#msgs')); loadChannel(ch.id); }
  renderMembers(); if (vc || inCall) renderVoiceUI();
}
// chat da sala de voz: aberto/fechado fica salvo; ao abrir marca como lido
const vcChatHidden = (ch) => ch?.type === 2 && S.prefs.vcChat === false;
function toggleVcChat(ch) {
  S.prefs.vcChat = S.prefs.vcChat === false; savePrefs(); renderMain();
}
// imagens/vídeos carregam depois da rolagem: se estava no fim, continua no fim
// (só rolagens da pessoa contam: o scroll anchoring do navegador também dispara 'scroll')
function stickToBottom(box) {
  let userAt = 0;
  box.stick = true;
  for (const ev of ['wheel', 'touchmove', 'keydown', 'pointerdown']) box.addEventListener(ev, () => (userAt = Date.now()), { passive: true });
  box.addEventListener('scroll', () => { if (Date.now() - userAt < 1500) box.stick = box.scrollHeight - box.scrollTop - box.clientHeight < 120; });
  const fix = () => { if (box.stick) box.scrollTop = box.scrollHeight; };
  box.addEventListener('load', fix, true); box.addEventListener('loadedmetadata', fix, true);
}

// ---------- mensagens ----------
async function loadChannel(cid) {
  const box = $('#msgs');
  if (detached.delete(cid)) { S.messages.delete(cid); S.loaded.delete(cid); }
  if (!S.messages.has(cid)) {
    box.replaceChildren(h('div.empty', 'Carregando…'));
    const list = await tryApi('GET', `/channels/${cid}/messages?limit=50`); if (!list) return;
    list.forEach(m => S.users.set(m.author.id, { ...S.users.get(m.author.id), ...m.author }));
    S.messages.set(cid, list); S.loaded.set(cid, list.length < 50);
  }
  if (S.view.cid !== cid) return;
  renderMessages(false); ack(cid); renderTyping();
  const msgs = $('#msgs');
  msgs.onscroll = async () => {
    if (detached.has(cid) && !msgs.dataset.loading && msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80) {
      msgs.dataset.loading = 1; const cur = S.messages.get(cid), newer = await tryApi('GET', `/channels/${cid}/messages?limit=50&after=${cur[cur.length - 1]?.id}`); delete msgs.dataset.loading;
      if (newer?.length) { newer.forEach(x => S.users.set(x.author.id, { ...S.users.get(x.author.id), ...x.author })); cur.push(...newer); renderMessages(true); }
      if (newer && newer.length < 50) { detached.delete(cid); $('#detached-bar')?.remove(); }
      return;
    }
    if (msgs.scrollTop > 40 || S.loaded.get(cid) || msgs.dataset.loading) return;
    msgs.dataset.loading = 1;
    const list = S.messages.get(cid), older = await tryApi('GET', `/channels/${cid}/messages?limit=50&before=${list[0]?.id}`);
    delete msgs.dataset.loading; if (!older) return;
    if (older.length < 50) S.loaded.set(cid, true);
    list.unshift(...older); const prevH = msgs.scrollHeight; renderMessages(false); msgs.scrollTop = msgs.scrollHeight - prevH;
  };
}
function welcomeBlock(ch) {
  if (ch.type === 1) { const p = user(dmPeer(ch).id); return h('div.welcome', avatar(p, 80, { status: false }), h('h1', p.display_name), h('p', `Este é o início do seu histórico de mensagens diretas com ${p.display_name}.`)); }
  return h('div.welcome', h('div.big', icon('hash', 40)), h('h1', `Bem-vindo(a) a #${chName(ch)}!`), h('p', 'Este é o começo do canal.'));
}
function renderMessages(keepPos) {
  const box = $('#msgs'); if (!box) return;
  const ch = channelById(S.view.cid), list = S.messages.get(ch.id) || [];
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120, old = box.scrollTop;
  box.replaceChildren(...[h('div.grow'), S.loaded.get(ch.id) && welcomeBlock(ch)].filter(Boolean));
  let prev = null;
  for (const m of list) {
    if (!prev || !sameDay(prev.created_at, m.created_at)) box.append(h('div.daysep', h('span', dayLabel(m.created_at))));
    box.append(msgEl(m, prev && sameDay(prev.created_at, m.created_at) ? prev : null)); prev = m;
  }
  if (S.pending.length) renderPending();
  box.stick = !(keepPos && !near);
  box.scrollTop = box.stick ? box.scrollHeight : old;
}
function appendMessage(m) {
  const box = $('#msgs'), list = S.messages.get(m.channel_id); if (!box) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160 || m.author_id === S.me.id;
  const prev = list[list.length - 2];
  if (!prev || !sameDay(prev.created_at, m.created_at)) box.append(h('div.daysep', h('span', dayLabel(m.created_at))));
  const mel = msgEl(m, prev && sameDay(prev.created_at, m.created_at) ? prev : null); mel.classList.add('fresh'); setTimeout(() => mel.classList.remove('fresh'), 700);
  box.append(mel);
  if (near) { box.stick = true; box.scrollTop = box.scrollHeight; }
}
function refreshAuthors(uid) { if ($('#msgs') && S.view.cid && S.messages.get(S.view.cid)?.some(m => m.author_id === uid)) renderMessages(true); }

const ctxFor = (gid) => ({ userName: (id) => (S.users.has(id) ? nameOf(id, gid) : null), emojiUrl });
function msgEl(m, prev) {
  const ch = channelById(m.channel_id), gid = ch?.guild_id, mine = m.author_id === S.me.id;
  const grouped = prev && prev.author_id === m.author_id && m.created_at - prev.created_at < 420000 && !m.reply && !S.prefs.compact === true;
  const a = user(m.author_id), col = roleColor(gid, m.author_id);
  const mentioned = m.mentions?.includes(S.me.id) || (m.content || '').includes(`<@${S.me.id}>`);
  if (m.type === 1) return h('div.msg.system', { 'data-mid': m.id }, h('span.arrow', '→'), h('span', h('b', { style: { color: col || 'var(--header)' } }, nameOf(m.author_id, gid)), ' ' + m.content), h('span.ts', stamp(m.created_at)),
    h('button.btn.grey.wave', { onclick: () => tryApi('POST', `/channels/${m.channel_id}/messages`, { content: `👋 Bem-vindo(a), <@${m.author_id}>!` }) }, '👋 Dar boas-vindas'));
  const el = h('div.msg' + (grouped ? '' : '.first') + (mentioned ? '.mentioned' : '') + (S.editing === m.id ? '.editing' : ''), { 'data-mid': m.id, oncontextmenu: (e) => msgMenu(e, m) });
  if (!grouped) el.append(h('div.av', { onclick: (e) => profile(e.currentTarget, m.author_id, gid) }, avatar(a, 40, { status: false })));
  else el.append(h('div.time-s', clock(m.created_at)));
  if (m.reply) el.append(h('div.reply-ref', { onclick: () => jumpTo(m.reply.id) },
    m.reply.deleted ? h('i', 'A mensagem original foi excluída') : [avatar(user(m.reply.author.id), 16, { status: false }), h('span.rn', '@' + nameOf(m.reply.author.id, gid)), h('span.rt', inviteText(themeText(m.reply.content)) || 'Clique para ver o anexo')]));
  if (!grouped) el.append(h('div.head', styleName(h('span.author', { style: col ? { color: col } : null, onclick: (e) => profile(e.currentTarget, m.author_id, gid), oncontextmenu: (e) => { e.stopPropagation(); userMenu(e, m.author_id, gid); } }, nameOf(m.author_id, gid)), a.name_style), h('span.ts', stamp(m.created_at)), m.pinned && h('span.pin', icon('pin', 12))));
  if (S.editing === m.id) {
    const ta = h('textarea', { value: m.content, rows: 1, onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m, ta.value); } if (e.key === 'Escape') { S.editing = null; renderMessages(true); } } });
    el.append(h('div.edit-box', ta, h('div.edit-hint', 'esc para ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); S.editing = null; renderMessages(true); } }, 'cancelar'), ' • enter para ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); saveEdit(m, ta.value); } }, 'salvar'))));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  } else if (m.content) {
    const body = h('div.body'), shared = THEME_CODE_RE.test(m.content) && decodeTheme(m.content), invites = inviteCodes(m.content);
    let shown = shared ? stripThemeCodes(m.content) : m.content; // o código do tema não aparece, só o bloco
    if (invites.length) shown = stripInvites(shown); // o link do convite também vira só o cartão
    if (shown) body.innerHTML = md(shown, ctxFor(gid));
    if (shown && onlyEmoji(shown.replace(/<:\w+:\d+>/g, '😀'))) body.classList.add('emoji-big');
    if (m.edited_at) body.append(h('span.edited', '(editado)'));
    if (shared) body.append(themeCard(shared));
    for (const code of invites) body.append(inviteCard(code));
    if (S.prefs.embedLinks !== false) for (const url of (shown.match(/https?:\/\/\S+/g) || []).filter(isImageUrl).slice(0, 3)) body.append(h('div.attach', h('img', { src: url, loading: 'lazy', referrerPolicy: 'no-referrer', onclick: () => lightbox(url) })));
    body.querySelectorAll('.spoiler').forEach(s => (s.onclick = () => s.classList.add('shown')));
    body.querySelectorAll('.mention[data-uid]').forEach(s => { s.onclick = () => profile(s, s.dataset.uid, gid); const u = S.users.get(s.dataset.uid); if (u) s.prepend(mentionAvatar(u)); });
    el.append(body);
    const tr = translationBlock(m, (t) => { const d = h('div.body'); d.innerHTML = md(t, ctxFor(gid)); return d; });
    if (tr) el.append(tr);
  }
  appendAttachments(el, m, mine || (gid && can(gid, PERM.MANAGE_MESSAGES)));
  if (m.reactions?.length) el.append(h('div.reactions', m.reactions.map(r => h('div.react' + (r.users.includes(S.me.id) ? '.me' : ''), { title: r.users.map(u => nameOf(u, gid)).join(', '), onclick: () => react(m, r.emoji, !r.users.includes(S.me.id)) }, reactionFace(r.emoji), h('span', r.users.length)))));
  el.append(h('div.toolbar',
    h('button', { title: 'Reagir', onclick: (e) => emojiPicker(e.currentTarget, (em) => react(m, em, true)) }, icon('smile', 18)),
    h('button', { title: 'Responder', onclick: () => setReply(m) }, icon('reply', 18)),
    mine && h('button', { title: 'Editar', onclick: () => { S.editing = m.id; renderMessages(true); } }, icon('edit', 18)),
    (mine || (gid && can(gid, PERM.MANAGE_MESSAGES))) && h('button.tdel', { title: 'Excluir (Shift: sem confirmar)', onclick: (e) => deleteMenu(e, m) }, icon('trash', 18)),
    h('button', { title: 'Mais', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); msgMenu({ preventDefault() { }, clientX: r.left, clientY: r.bottom }, m); } }, icon('more', 18))));
  return el;
}
// lixeira da barra da mensagem: apaga a mensagem; com áudio/arquivo junto de outro conteúdo, pergunta o que remover
const removeAtt = (m, i) => tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}/attachments/${i}`);
const deleteMsg = async (m, quick) => { if (quick || await confirmBox('Apagar mensagem', 'Tem certeza?', 'Apagar')) tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}`); };
function deleteMenu(e, m) {
  const files = (m.attachments || []).map((f, i) => ({ f, i })).filter(a => !isImg(a.f));
  const alone = !m.content && (m.attachments || []).length <= 1; // só um áudio/arquivo: apagar a mensagem é o mesmo que remover o anexo
  if (!files.length || alone) return deleteMsg(m, e.shiftKey);
  const r = e.currentTarget.getBoundingClientRect(), what = (f) => (f.voice ? 'a mensagem de voz' : `"${f.name}"`);
  menu({ preventDefault() { }, clientX: r.left, clientY: r.bottom + 4 }, [
    ...files.map(({ f, i }) => ({ label: 'Remover ' + what(f), danger: true, fn: async () => { if (e.shiftKey || await confirmBox('Remover anexo', `Remover ${what(f)} desta mensagem?`, 'Remover')) removeAtt(m, i); } })),
    '-', { label: 'Apagar mensagem inteira', danger: true, fn: () => deleteMsg(m, e.shiftKey) },
  ]);
}

// cartão de convite de servidor no chat (no lugar do link)
const inviteInfo = new Map();
const fetchInvite = (code) => { if (!inviteInfo.has(code)) inviteInfo.set(code, api('GET', `/invites/${encodeURIComponent(code)}`).catch(() => null)); return inviteInfo.get(code); };
function inviteCard(code) {
  const card = h('div.invcard.loading', h('div.ivh', 'Convite para um servidor'), h('div.ivbody', h('div.ivicon'), h('div.ivinfo', h('b', 'Carregando…'))));
  fetchInvite(code).then(info => {
    if (!info) {
      card.className = 'invcard bad';
      return card.replaceChildren(h('div.ivh', 'Convite para um servidor'), h('div.ivbody', h('div.ivicon', '✕'), h('div.ivinfo', h('b', 'Convite inválido'), h('small', 'Pode ter expirado ou sido apagado.'))));
    }
    const g = info.guild, inside = () => S.guilds.has(g.id);
    const btn = h('button.btn');
    const paint = () => { btn.textContent = inside() ? 'Ir para o servidor' : 'Entrar'; btn.className = 'btn ' + (inside() ? 'grey' : 'green'); };
    btn.onclick = async () => {
      if (inside()) return go(g.id);
      btn.disabled = true; btn.textContent = 'Entrando…';
      if (await joinInvite(code) === false) { btn.disabled = false; paint(); return; }
      inviteInfo.delete(code); document.querySelectorAll(`.invcard[data-code="${code}"]`).forEach(c => c.replaceWith(inviteCard(code)));
    };
    paint();
    const top = h('div.ivbanner'), ic = g.icon ? h('img.ivicon', { src: g.icon, alt: '' }) : h('div.ivicon', initialsOf(g.name));
    if (g.banner) top.style.backgroundImage = `url("${g.banner.replace(/"/g, '%22')}")`;
    else top.style.background = `linear-gradient(120deg, ${g.accent || '#5865f2'}, color-mix(in srgb, ${g.accent || '#5865f2'} 40%, #000))`;
    card.className = 'invcard'; card.dataset.code = code;
    card.replaceChildren(top, h('div.ivh', inside() ? 'Você já está neste servidor' : 'Você foi convidado para entrar em um servidor'),
      h('div.ivbody', ic, h('div.ivinfo', h('b', { title: g.name }, g.name),
        h('div.ivstats', h('span', h('i.on'), `${info.online} online`), h('span', h('i'), `${info.members} ${info.members === 1 ? 'membro' : 'membros'}`))), btn));
  });
  return card;
}

// bloco de tema compartilhado no chat
function themeCard(t) {
  const inUse = () => { const cur = themeDef(S.prefs.theme, S.prefs.customThemes || []); return !!cur && cur.base === t.base && cur.colors.join() === t.colors.join() && (cur.angle ?? 180) === t.angle; };
  const btn = h('button.btn', { onclick: () => { saveCustomTheme(t); toast(`Tema "${t.name}" aplicado e salvo em Aparência`); document.querySelectorAll('.themeshare').forEach(c => c.dispatchEvent(new Event('repaint'))); } });
  const paint = () => { const on = inUse(); btn.textContent = on ? 'Em uso' : 'Usar tema'; btn.disabled = on; btn.classList.toggle('grey', on); };
  const card = h('div.themeshare', { onrepaint: paint }, h('i.sw', { style: { background: gradientCss(t) } }),
    h('div', h('b', t.name), h('small', `Tema ${t.base === 'light' ? 'claro' : 'escuro'} em gradiente`), h('div.tsdots', t.colors.map(c => h('i', { style: { background: c } })))), btn);
  paint(); return card;
}
// "+" do campo de mensagem: enviar arquivo ou compartilhar um tema (vai só o bloco do tema)
function shareThemePicker(ch) {
  const mine = S.prefs.customThemes || [], presets = Object.values(GRADIENT_THEMES);
  const cur = themeDef(S.prefs.theme, mine);
  const send = (t) => {
    dlg.close();
    tryApi('POST', `/channels/${ch.id}/messages`, { content: encodeTheme({ ...t, angle: t.angle ?? 180, intensity: t.intensity ?? 50 }), reply_to: S.replyTo?.id });
    S.replyTo = null; renderReplyBar();
  };
  const tile = (t) => h('button.tpick' + (t === cur ? '.cur' : ''), { title: `Enviar "${t.name}"`, onclick: () => send(t) }, h('i', { style: { background: gradientCss(t) } }), h('span', t.name), t === cur && h('small', 'em uso'));
  const body = h('div.tpicker',
    h('h5', 'Seus temas'), mine.length ? h('div.tpgrid', mine.map(tile)) : h('p.tpempty', 'Você ainda não criou temas. Crie em Configurações → Aparência → Criar tema.'),
    h('h5', 'Temas prontos'), h('div.tpgrid', presets.map(tile)));
  const dlg = modal('Compartilhar tema', 'Quem receber vê o bloco do tema e pode usá-lo com um clique.', body, [{ label: 'Cancelar', cls: 'link' }], { width: '540px' });
}
function plusMenu(e, ch, fileIn) {
  const r = e.currentTarget.getBoundingClientRect();
  menu({ preventDefault() { }, clientX: r.left, clientY: r.top - 84 }, [
    { label: 'Enviar arquivo', fn: () => fileIn.click() },
    { label: 'Compartilhar tema', fn: () => shareThemePicker(ch) },
  ]);
}

function reactionFace(e) {
  const m = e.match(/^<:(\w+):(\d+)>$/);
  if (m) { const u = emojiUrl(m[2]); return u ? h('img.cemoji', { src: u, alt: ':' + m[1] + ':', style: { height: '16px' } }) : h('span', ':' + m[1] + ':'); }
  return h('span', e);
}
const isImg = (f) => /^(png|jpe?g|gif|webp|avif|bmp)$/.test((f.name.split('.').pop() || '').toLowerCase());
// imagens da mesma mensagem viram uma grade; cada anexo tem uma lixeira ao passar o mouse
function appendAttachments(el, m, canDel) {
  const atts = (m.attachments || []).map((f, i) => ({ f, i }));
  const del = (f, i) => canDel && h('button.adel', { title: 'Remover anexo (Shift: sem confirmar)', onclick: async (e) => {
    e.stopPropagation();
    if (e.shiftKey || await confirmBox('Remover anexo', `Remover "${f.name}" desta mensagem?`, 'Remover')) tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}/attachments/${i}`);
  } }, icon('trash', 16));
  const imgs = atts.filter(a => isImg(a.f));
  if (imgs.length) el.append(h('div.mgrid.n' + Math.min(imgs.length, 5), imgs.map(({ f, i }) =>
    h('div.mtile', h('img', { src: f.url, alt: f.name, title: f.size ? `${f.name} • ${bytes(f.size)}` : f.name, 'data-size': f.size || '', loading: 'lazy', onclick: () => lightbox(f.url) }), del(f, i)))));
  for (const { f } of atts.filter(a => !isImg(a.f))) { const a = attachEl(f); a.classList.add('mtile'); el.append(a); } // áudio/arquivo: excluir fica na barra da mensagem
}
function attachEl(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase(), url = f.url;
  if (f.voice) return voiceEl(f);
  if (isImg(f)) return h('div.attach', h('img', { src: url, alt: f.name, 'data-size': f.size || '', loading: 'lazy', onclick: () => lightbox(url) }));
  if (/^(mp4|webm)$/.test(ext)) return h('div.attach', h('video', { src: url, controls: true, preload: 'metadata' }));
  if (/^(mp3|ogg|wav|m4a)$/.test(ext)) return h('div.attach', h('audio', { src: url, controls: true, preload: 'none' }));
  return h('div.file', icon('file', 32), h('div', h('a.fn', { href: url + '?download=1', download: f.name }, f.name), h('div.fs', bytes(f.size))), h('a.ibtn', { href: url + '?download=1', download: f.name, style: { marginLeft: 'auto' } }, icon('dl')));
}
function msgMenu(e, m) {
  const ch = channelById(m.channel_id), gid = ch.guild_id, mine = m.author_id === S.me.id, mod = gid && can(gid, PERM.MANAGE_MESSAGES) || (!gid && false);
  menu(e, [
    { label: 'Adicionar reação', fn: () => emojiPicker(document.querySelector(`[data-mid="${m.id}"]`) || document.body, (em) => react(m, em, true)) },
    { label: 'Responder', fn: () => setReply(m) },
    !mine && { label: 'Mencionar', fn: () => mentionUser(m.author_id) },
    m.content && { label: 'Copiar texto', fn: () => navigator.clipboard?.writeText(m.content) },
    m.content && { label: isTranslated(m) ? 'Mostrar original' : 'Traduzir', fn: () => toggleTranslation(m, refreshMsg) },
    mine && { label: 'Editar mensagem', fn: () => { S.editing = m.id; renderMessages(true); } },
    (mod || !gid) && { label: m.pinned ? 'Desafixar mensagem' : 'Fixar mensagem', fn: () => tryApi(m.pinned ? 'DELETE' : 'PUT', `/channels/${m.channel_id}/pins/${m.id}`) },
    S.prefs.devMode && { label: 'Copiar ID da mensagem', fn: () => navigator.clipboard?.writeText(m.id) },
    (mine || mod) && '-',
    (mine || mod) && { label: 'Apagar mensagem', danger: true, fn: async () => { if (await confirmBox('Apagar mensagem', 'Tem certeza?', 'Apagar')) tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}`); } },
  ]);
}
// redesenha uma única mensagem (por ex. depois de traduzir)
function refreshMsg(m) {
  const list = S.messages.get(m.channel_id), i = list?.findIndex(x => x.id === m.id), el = document.querySelector(`[data-mid="${m.id}"]`);
  if (i >= 0 && el) el.replaceWith(msgEl(m, list[i - 1] && sameDay(list[i - 1].created_at, m.created_at) ? list[i - 1] : null));
}
const react = (m, emoji, add) => tryApi(add ? 'PUT' : 'DELETE', `/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`);
async function saveEdit(m, text) {
  if (!text.trim()) return;
  S.editing = null; if (text !== m.content) await tryApi('PATCH', `/channels/${m.channel_id}/messages/${m.id}`, { content: text });
  renderMessages(true);
}
function setReply(m) { S.replyTo = m; renderReplyBar(); $('#composer textarea')?.focus(); }
async function jumpTo(mid) {
  let el = document.querySelector(`[data-mid="${mid}"]`);
  if (!el) {
    const list = await tryApi('GET', `/channels/${S.view.cid}/messages?around=${mid}`); if (!list) return;
    S.messages.set(S.view.cid, list); S.loaded.set(S.view.cid, false); renderMessages(false); el = document.querySelector(`[data-mid="${mid}"]`);
  }
  if (el) { $('#msgs').stick = false; el.scrollIntoView({ block: 'center' }); el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 2000); }
}
async function jumpToTop() {
  const cid = S.view.cid; if (!cid) return;
  const list = await tryApi('GET', `/channels/${cid}/messages?oldest=1&limit=50`); if (!list || S.view.cid !== cid) return;
  list.forEach(m => S.users.set(m.author.id, { ...S.users.get(m.author.id), ...m.author }));
  S.messages.set(cid, list); S.loaded.set(cid, true); $('#detached-bar')?.remove();
  renderMessages(false); const box = $('#msgs'); box.stick = false; box.scrollTop = 0;
  if (list.length >= 50) {
    detached.add(cid);
    $('#chat')?.append(h('div#detached-bar', h('span', 'Você está vendo o início do canal'), h('button.btn', { onclick: () => { $('#detached-bar')?.remove(); loadChannel(cid); } }, 'Ir para o presente')));
  }
}
function mentionAvatar(u) {
  return u.avatar ? h('img.mav', { src: u.avatar, alt: '', loading: 'lazy' }) : h('span.mav.mini', { style: { background: u.color || '#5865f2' } }, (u.display_name || u.username || '?')[0].toUpperCase());
}
// o mesmo botão abre e fecha o painel da direita (fixadas / caixa de entrada)
const resultsOpen = (kind) => $('#results')?.dataset.kind === kind;
function markResultBtns() { const k = $('#results')?.dataset.kind; $('.pins-btn')?.classList.toggle('sel', k === 'pins'); $('.inbox-btn')?.classList.toggle('sel', k === 'inbox'); }
// prende o popup pela borda direita do botão, logo abaixo dele (medir a largura falha durante a animação de entrada, que encolhe o popup)
const anchorRight = (pop, btn, gap) => { const r = btn.getBoundingClientRect(); pop.style.left = 'auto'; pop.style.right = Math.max(8, innerWidth - r.right) + 'px'; pop.style.top = (r.bottom + gap) + 'px'; };
// popups dos botões do topo (fixadas, notificações): clicar de novo no mesmo botão fecha
let topWasOpen = false;
window.addEventListener('mousedown', (e) => { topWasOpen = (!!$('.pinspop') && !!e.target.closest?.('.pins-btn')) || (!!$('.notifmenu') && !!e.target.closest?.('.notif-btn')) || (!!$('.inboxpop') && !!e.target.closest?.('.inbox-btn')); }, true);
// menu de notificações do canal: silenciar por um tempo e nível de aviso (padrão do servidor, tudo, só @menções, nada)
function notifMenu(e, ch) {
  const btn = e.currentTarget;
  if (topWasOpen) { topWasOpen = false; return closeFloating(); }
  const cfg = (S.prefs.notifyCfg ||= {}), lv = (cfg.chLevel ||= {}), mutes = (cfg.channels ||= {});
  const g = ch.guild_id ? cfg[ch.guild_id] : null, LV = { all: 'Todas as mensagens', mentions: 'Apenas @menções', none: 'Nada' };
  const done = () => { savePrefs(); renderSide(); };
  const setLv = (k) => { k ? (lv[ch.id] = k) : delete lv[ch.id]; done(); };
  const muteFor = (min) => { mutes[ch.id] = min ? Date.now() + min * 60e3 : true; done(); toast('Canal silenciado'); };
  const until = mutes[ch.id], muted = channelMuted(ch.id);
  const r = btn.getBoundingClientRect();
  menu({ preventDefault() {}, clientX: r.right - 240, clientY: r.bottom + 8 }, [
    muted ? { label: 'Reativar canal', hint: until === true ? 'Silenciado até você reativar' : 'Silenciado até ' + clock(until), fn: () => { delete mutes[ch.id]; done(); } }
      : { label: 'Silenciar canal', sub: [[15, 'Por 15 minutos'], [60, 'Por 1 hora'], [180, 'Por 3 horas'], [480, 'Por 8 horas'], [1440, 'Por 24 horas'], [0, 'Até eu reativar']].map(([m, l]) => ({ label: l, fn: () => muteFor(m) })) },
    '-',
    { label: ch.guild_id ? 'Usar padrão do servidor' : 'Usar padrão', hint: LV[g?.level || 'all'], radio: !lv[ch.id], fn: () => setLv(null) },
    { label: LV.all, radio: lv[ch.id] === 'all', fn: () => setLv('all') },
    { label: h('span', 'Apenas ', h('b', '@menções')), radio: lv[ch.id] === 'mentions', fn: () => setLv('mentions') },
    { label: LV.none, radio: lv[ch.id] === 'none', fn: () => setLv('none') },
  ]);
  const el = [...document.querySelectorAll('#layer .menu')].pop(); el?.classList.add('notifmenu');
}
// popup "Mensagens fixadas" abaixo do botão
async function showPins(e) {
  const btn = e.currentTarget;
  if (topWasOpen) { topWasOpen = false; return closeFloating(); }
  const list = await tryApi('GET', `/channels/${S.view.cid}/pins`); if (!list) return;
  const jump = (m) => { const ch = channelById(m.channel_id); closeFloating(); if (S.view.cid !== m.channel_id) { go(ch.guild_id || '@me', m.channel_id); setTimeout(() => jumpTo(m.id), 600); } else jumpTo(m.id); };
  const body = list.length ? h('div.pp-list', list.map(m => { const el = msgEl(m, null); el.querySelector('.toolbar')?.remove(); el.onclick = () => jump(m); return el; }))
    : h('div.pp-empty', h('div.pp-art', icon('pin', 40)), h('p', 'Este canal ainda não tem nenhuma mensagem fixada... por enquanto.'));
  const pop = popout(btn, h('div.pp', h('div.pp-head', icon('pin', 22), h('b', 'Mensagens fixadas')), body,
    h('div.pp-foot', h('b', 'Dica:'), h('span', S.view.kind === 'guild' ? 'Quem tem a permissão "Gerenciar mensagens" pode fixar uma mensagem pelo menu de contexto dela.' : 'Clique com o botão direito numa mensagem e escolha "Fixar mensagem".'))));
  pop.classList.add('pinspop'); anchorRight(pop, btn, 8);
}
async function doSearch(q) {
  if (!q.trim()) return closeResults();
  const gid = S.view.kind === 'guild' ? S.view.gid : '';
  const list = await tryApi('GET', `/search?q=${encodeURIComponent(q)}${gid ? '&guild=' + gid : ''}`); if (!list) return;
  showResults(`${list.length} resultado(s)`, list);
  if (!list.length) $('#results')?.append(h('div.hintline', { style: { padding: '8px' } }, 'Dica: use de:nome, tem:imagem, tem:arquivo, tem:link ou em:canal para filtrar.'));
}
// ---------- caixa de entrada: menções, respostas e @everyone ----------
const inboxCount = () => Object.values(S.mentions).reduce((n, v) => n + (v || 0), 0);
const inboxBadge = () => { const n = inboxCount(); return n ? h('span.ibadge', n > 99 ? '99+' : n) : null; };
const KIND_TXT = { mention: 'mencionou você', reply: 'respondeu você', everyone: 'mencionou @everyone' };
// popup "Caixa de entrada" no canto superior direito: não lidas por canal e menções/respostas
let inboxTab = 'unread';
const unreadCh = () => Object.entries(S.unread).map(([cid, u]) => ({ ch: channelById(cid), u })).filter(x => x.ch).sort((a, b) => (b.u.last_id > a.u.last_id ? 1 : -1));
const jumpMsg = (m) => { const ch = channelById(m.channel_id); closeFloating(); if (S.view.cid !== m.channel_id) { go(ch?.guild_id || '@me', m.channel_id); setTimeout(() => jumpTo(m.id), 600); } else jumpTo(m.id); };
// mensagens com separador de dia e o botão "Ir" ao passar o mouse
const ibMsgs = (list, head) => { let prev = null; return list.flatMap(m => { const out = []; if (!prev || !sameDay(prev.created_at, m.created_at)) out.push(h('div.ib-day', h('span', dayLabel(m.created_at)))); prev = m; const e = msgEl(m, null); e.querySelector('.toolbar')?.remove(); out.push(h('div.ib-msg', head?.(m), e, h('button.ib-jump', { onclick: (ev) => { ev.stopPropagation(); jumpMsg(m); } }, 'Ir'))); return out; }); };
async function showInbox(e) {
  const btn = e?.currentTarget || $('.inbox-btn');
  if (topWasOpen) { topWasOpen = false; return closeFloating(); }
  const body = h('div.ib-body'), tabs = h('div.ib-tabs');
  const pending = [...S.rels.values()].filter(r => r.type === 3).length;
  const drawTabs = () => tabs.replaceChildren(...[['unread', 'Não lidas'], ['mentions', 'Menções']].map(([k, l]) => h('button' + (inboxTab === k ? '.on' : ''), { onclick: () => { inboxTab = k; drawTabs(); draw(); } }, l)));
  const empty = (t, p) => h('div.ib-empty', h('div.ib-art', icon('inbox', 36)), h('b', t), h('p', p));
  const chBox = ({ ch, u }) => {
    const g = ch.guild_id ? guild(ch.guild_id) : null, dm = ch.type === 1, peer = dm && dmPeer(ch), cat = ch.parent_id && channelById(ch.parent_id);
    const list = h('div.ib-list', h('div.ib-loading', 'Carregando…'));
    const box = h('div.ib-box');
    const open = () => { closeFloating(); go(g ? g.id : '@me', ch.id); };
    box.append(h('div.ib-head',
      g ? (g.icon ? h('img.ib-gi', { src: g.icon, alt: '' }) : h('span.ib-gi', initialsOf(g.name))) : avatar(user(peer.id), 32, { status: false }),
      h('div.ib-name', { onclick: open }, h('b', !dm && icon('hash', 14), dm ? user(peer.id).display_name : chName(ch)), h('small', g ? g.name + (cat ? ' › ' + cat.name : '') : 'Mensagem direta')),
      h('button.ib-btn', { title: 'Marcar como lido', onclick: () => { ack(ch.id); box.remove(); if (!body.querySelector('.ib-box')) draw(); } }, icon('check', 16)),
      h('button.ib-btn.ib-fold', { title: 'Recolher', onclick: () => box.classList.toggle('folded') }, icon('caret', 16))), list);
    tryApi('GET', `/channels/${ch.id}/messages?limit=${Math.min(Math.max(u.count || 1, 1), 10)}`).then(msgs => {
      if (!msgs) return list.replaceChildren();
      list.replaceChildren(...ibMsgs(msgs), h('button.ib-all', { onclick: open }, 'Ver todas as não lidas ›'));
    });
    return box;
  };
  const draw = () => {
    if (inboxTab === 'unread') {
      const chs = unreadCh().slice(0, 20);
      body.replaceChildren(...(chs.length ? chs.map(chBox) : [empty('Tudo em dia!', 'Você não tem mensagens não lidas.')]));
      return;
    }
    body.replaceChildren(h('div.ib-loading', 'Carregando…'));
    const more = h('button.ib-all', 'Carregar mais'), wrap = h('div.ib-list');
    const load = async (before) => {
      const list = await tryApi('GET', '/inbox' + (before ? '?before=' + before : '')); if (!list) return;
      if (!before) body.replaceChildren(wrap);
      more.remove();
      wrap.append(...ibMsgs(list, (m) => { const g = guild(m.guild_id); return h('div.ib-why' + (m.unread ? '.new' : ''), h('b', nameOf(m.author_id, m.guild_id)), ' ' + (KIND_TXT[m.kind] || ''), h('span', g ? ` • #${m.channel_name} • ${g.name}` : ' • Mensagem direta')); }));
      if (!wrap.children.length) body.replaceChildren(empty('Nada por aqui', 'Menções e respostas a você aparecem nesta aba.'));
      else if (list.length === 30) { more.onclick = () => load(list.at(-1).id); wrap.append(more); }
    };
    load();
  };
  const pop = popout(btn, h('div.ib',
    h('div.ib-top', icon('inbox', 22), h('b', 'Caixa de entrada'),
      h('button.ib-btn', { title: 'Marcar tudo como lido', onclick: () => { [...Object.keys(S.unread), ...Object.keys(S.mentions)].forEach(ack); draw(); } }, icon('check', 16)),
      h('button.ib-btn', { title: `Ver pedidos de amizade (${pending})`, onclick: () => { closeFloating(); S.view.tab = 'all'; go('@me'); } }, icon('users', 16), pending > 0 && h('span.ibadge', pending))),
    tabs, body));
  pop.classList.add('inboxpop'); anchorRight(pop, btn, 6);
  drawTabs(); draw();
}
function closeResults() { $('#results')?.remove(); markResultBtns(); }
function showResults(title, list, kind = 'search') {
  closeResults();
  const panel = h('div#results', { 'data-kind': kind }, h('div.rh', title, h('button.ibtn', { style: { width: '20px', height: '20px' }, onclick: closeResults }, icon('x', 14))),
    list.length ? list.map(m => { const e = msgEl(m, null); e.querySelector('.toolbar')?.remove(); e.onclick = () => { const ch = channelById(m.channel_id); closeResults(); if (S.view.cid !== m.channel_id) { go(ch.guild_id || '@me', m.channel_id); setTimeout(() => jumpTo(m.id), 600); } else jumpTo(m.id); }; return e; }) : h('div.empty', { style: { marginTop: '20px' } }, 'Nada encontrado.'));
  $('#content')?.append(panel); markResultBtns();
}

// ---------- compositor ----------
function composer(ch, label) {
  const ta = h('textarea', { placeholder: `Conversar em ${label}`, rows: 1, maxLength: 4000 });
  const grow = () => { ta.style.height = '0'; ta.style.height = Math.min(ta.scrollHeight, 400) + 'px'; };
  let lastTyping = 0;
  const fileIn = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: () => { [...fileIn.files].forEach(addFile); fileIn.value = ''; } });
  ta.addEventListener('input', () => { grow(); if (Date.now() - lastTyping > 3000 && ta.value) { lastTyping = Date.now(); gwSend('TYPING', { channel_id: ch.id }); } autocomplete(ta); });
  ta.addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); fs.forEach(addFile); } });
  ta.addEventListener('keydown', (e) => {
    const ac = $('.ac');
    if (ac && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) {
      e.preventDefault(); const items = [...ac.querySelectorAll('.it')], i = items.findIndex(x => x.classList.contains('sel'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { items[i]?.classList.remove('sel'); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].classList.add('sel'); }
      else items[i]?.dispatchEvent(new MouseEvent('mousedown'));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(ta, ch); setTimeout(grow); }
    else if (e.key === 'Escape') { if (ac) ac.remove(); else if (S.replyTo) { S.replyTo = null; renderReplyBar(); } }
    else if (e.key === 'ArrowUp' && !ta.value) { const mine = [...(S.messages.get(ch.id) || [])].reverse().find(m => m.author_id === S.me.id); if (mine) { S.editing = mine.id; renderMessages(true); } }
  });
  const wrap = h('div#composer-wrap', h('div#reply-bar.hidden'), h('div#attach-prev.hidden'),
    h('div#composer', h('button.ibtn', { title: 'Enviar arquivo ou compartilhar tema', onclick: (e) => plusMenu(e, ch, fileIn) }, icon('plus', 24)), fileIn, ta,
      h('button.ibtn', { title: 'Traduzir o que você escreveu (ou use $en, $es… no início)', onclick: (e) => draftMenu(e, ta) }, icon('translate', 22)),
      h('button.ibtn', { title: 'Gravar mensagem de voz', onclick: (e) => recordVoiceMessage(ch, e.currentTarget.closest('#composer'), { onSent: () => { S.replyTo = null; renderReplyBar(); } }) }, icon('mic', 22)),
      h('button.ibtn', { title: 'Emoji', onclick: (e) => emojiPicker(e.currentTarget, (em) => { ta.setRangeText(em, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); }) }, icon('smile', 24))));
  setTimeout(() => { renderReplyBar(); renderPendingPrev(); ta.focus(); }, 0);
  return wrap;
}
function renderReplyBar() {
  const bar = $('#reply-bar'); if (!bar) return;
  if (!S.replyTo) return bar.classList.add('hidden');
  bar.classList.remove('hidden'); bar.replaceChildren(h('span', 'Respondendo a ', h('b', nameOf(S.replyTo.author_id, channelById(S.replyTo.channel_id)?.guild_id))), h('button.ibtn', { style: { width: '20px', height: '20px' }, onclick: () => { S.replyTo = null; renderReplyBar(); } }, icon('x', 14)));
}
async function addFile(file) {
  const item = { name: file.name, size: file.size, file, state: 'up' }; S.pending.push(item); renderPendingPrev();
  try {
    const r = await api('POST', `/upload?name=${encodeURIComponent(file.name)}`, file);
    Object.assign(item, r, { state: 'ok', preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
  } catch (e) { toast(`Falha ao enviar ${file.name}: ${e.message}`, true); S.pending = S.pending.filter(p => p !== item); }
  renderPendingPrev();
}
function renderPendingPrev() {
  const box = $('#attach-prev'); if (!box) return;
  box.classList.toggle('hidden', !S.pending.length);
  box.replaceChildren(...S.pending.map(p => h('div.prev-item', p.preview ? h('img', { src: p.preview }) : icon('file', 40), h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name), p.state === 'up' && h('div', 'Enviando…'),
    h('button.x', { onclick: () => { S.pending = S.pending.filter(x => x !== p); renderPendingPrev(); } }, icon('x', 14)))));
}
const renderPending = () => { };
async function sendMsg(ta, ch) {
  let content = ta.value; const atts = S.pending.filter(p => p.state === 'ok');
  if (S.pending.some(p => p.state === 'up')) return toast('Aguarde o envio dos anexos…');
  if (!content.trim() && !atts.length) return;
  const typed = content; content = resolveMentions(ta, content);
  if (/^\$[a-z]{2,3}(-[A-Z]{2})?\s/.test(content)) {
    try { const t = await translateOutgoing(content); if (t) content = t; } catch (e) { return toast('Não foi possível traduzir: ' + e.message, true); }
  }
  ta.value = ''; $('.ac')?.remove();
  const body = { content, reply_to: S.replyTo?.id, attachments: atts.map(({ url, name, size, type }) => ({ url, name, size, type })) };
  S.replyTo = null; S.pending = []; renderReplyBar(); renderPendingPrev();
  try { await api('POST', `/channels/${ch.id}/messages`, body); } catch (e) { toast(e.message, true); ta.value = typed; }
}
function autocomplete(ta) {
  $('.ac')?.remove();
  const before = ta.value.slice(0, ta.selectionStart), m = before.match(/(?:^|\s)@([\p{L}\p{N}_.-]*)$/u);
  const em = before.match(/(?:^|\s):([a-z0-9_]{2,})$/i);
  if (em) {
    const q = em[1].toLowerCase();
    const list = [...allEmojis().filter(e => e.name.toLowerCase().includes(q)).map(e => ({ label: e.name, node: h('img', { src: e.url, style: { width: '24px', height: '24px', objectFit: 'contain' } }), ins: `<:${e.name}:${e.id}> ` })),
      ...Object.entries(SHORT).filter(([k]) => k.startsWith(q)).map(([k, v]) => ({ label: k, node: h('span', { style: { fontSize: '22px' } }, v), ins: v + ' ' }))].slice(0, 10);
    if (!list.length) return;
    const box = h('div.ac', list.map((x, i) => h('div.it' + (i ? '' : '.sel'), { onmousedown: (e) => { e.preventDefault?.(); ta.setRangeText(x.ins, ta.selectionStart - em[1].length - 1, ta.selectionStart, 'end'); box.remove(); ta.focus(); } }, x.node, h('b', ':' + x.label + ':'))));
    return $('#chat').append(box);
  }
  if (!m) return;
  const ch = channelById(S.view.cid), q = m[1].toLowerCase();
  const pool = ch.guild_id ? [...guild(ch.guild_id).members.keys()] : ch.recipients.map(r => r.id);
  const found = pool.map(id => user(id)).filter(u => u.username.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q)).slice(0, 8);
  const extra = 'everyone'.startsWith(q) && ch.guild_id ? [{ id: 'everyone', display_name: '@everyone', username: 'Notifica todos' }] : [];
  const all = [...extra, ...found]; if (!all.length) return;
  const box = h('div.ac', all.map((u, i) => h('div.it' + (i ? '' : '.sel'), { onmousedown: (e) => {
    e.preventDefault?.(); const start = ta.selectionStart - m[1].length - 1, ins = u.id === 'everyone' ? '@everyone ' : `@${u.display_name} `; if (u.id !== 'everyone') addMention(ta, u.display_name, u.id);
    ta.setRangeText(ins, start, ta.selectionStart, 'end'); box.remove(); ta.focus();
  } }, u.id !== 'everyone' && avatar(u, 24, { status: false }), h('b', u.display_name), h('small', u.username))));
  $('#chat').append(box);
}
function renderTyping() {
  const el = $('#typing'); if (!el) return;
  const m = S.typing.get(S.view.cid), now = Date.now();
  const names = m ? [...m].filter(([, t]) => t > now).map(([u]) => nameOf(u, S.view.gid)) : [];
  el.replaceChildren(...(names.length ? [h('span.dots', h('i'), h('i'), h('i')), h('span', names.length > 3 ? 'Várias pessoas estão digitando…' : names.join(', ') + (names.length > 1 ? ' estão digitando…' : ' está digitando…'))] : []));
}

// ---------- lista de membros ----------
function renderMembers() {
  const box = $('#members'); if (!box || S.view.kind !== 'guild') return;
  const g = guild(S.view.gid); if (!g) return;
  const ms = [...g.members.values()].map(m => ({ m, u: user(m.user_id) }));
  const off = ms.filter(x => x.u.status === 'offline'), on = ms.filter(x => x.u.status !== 'offline');
  const topRole = (m) => g.roles.filter(r => m.roles.includes(r.id)).sort((a, b) => b.position - a.position)[0];
  const groups = new Map();
  for (const x of on) { const r = topRole(x.m); const k = r ? r.id : 'online'; (groups.get(k) || groups.set(k, []).get(k)).push(x); }
  const order = [...g.roles.filter(r => groups.has(r.id)).map(r => [r.id, r.name]), ['online', 'Online']];
  const row = ({ m, u }, offline) => h('div.mem' + (offline ? '.off' : ''), { onclick: (e) => profile(e.currentTarget, u.id, g.id), oncontextmenu: (e) => userMenu(e, u.id, g.id) },
    avatar(u, 32, { ring: 'var(--bg-sec)' }),
    h('div', { style: { minWidth: 0 } }, h('div.mn', { style: { color: roleColor(g.id, u.id) || (offline ? '' : 'var(--header)') } }, styleName(h('span.mnn', m.nickname || u.display_name), u.name_style), g.owner_id === u.id && h('span.crown', { title: 'Dono do servidor', style: { marginLeft: '4px' } }, icon('crown', 12))), u.custom_status && h('div.cs', u.custom_status)));
  const by = (a, b) => (a.m.nickname || a.u.display_name).localeCompare(b.m.nickname || b.u.display_name);
  box.replaceChildren(
    ...order.flatMap(([k, name]) => groups.has(k) ? [h('div.mgroup', `${name} — ${groups.get(k).length}`), ...groups.get(k).sort(by).map(x => row(x))] : []),
    ...(off.length ? [h('div.mgroup', `Offline — ${off.length}`)] : []), ...off.sort(by).map(x => row(x, true)));
}

// =============== Início / amigos ===============
// painel "Ativo agora": amigos online, com servidor e sala de voz quando estão numa chamada
function renderActiveNow() {
  const box = document.getElementById('active-now'); if (!box) return;
  // quem está em chamada aparece mesmo invisível/offline; a lista "Online" continua só com quem está online
  const friends = [...S.rels.values()].filter(r => r.type === 1).map(r => S.users.get(r.user.id) || r.user);
  const inVoice = [], other = [];
  for (const u of friends) { const v = S.voice.get(u.id), ch = v && channelById(v.channel_id); if (ch) inVoice.push({ u, v, ch }); else if (u.status && u.status !== 'offline') other.push({ u }); }
  const byName = (a, b) => (a.u.display_name || '').localeCompare(b.u.display_name || '');
  const voiceCard = ({ u, v, ch }) => {
    const g = ch.type === 1 ? null : guild(ch.guild_id);
    return h('div.an-card', { title: 'Ir para a sala', onclick: () => (g ? go(g.id, ch.id) : go('@me', ch.id)), oncontextmenu: (e) => userMenu(e, u.id, g?.id) },
      h('div.an-top', avatar(u, 40, { ring: 'var(--bg-sec)' }), h('div.an-who', styleName(h('b', u.display_name), u.name_style), h('small', g ? g.name : 'Em uma ligação privada'))),
      h('div.an-room', icon('voice', 16), h('span', g ? chName(ch) : 'Ligação'), v.screen && h('span.an-live', 'AO VIVO'), v.mute && icon('micoff', 14)));
  };
  const rows = ({ u }) => h('div.an-row', { onclick: () => openDM(u.id), oncontextmenu: (e) => userMenu(e, u.id) }, avatar(u, 32, { ring: 'var(--bg-sec)' }),
    h('div.an-who', styleName(h('b', u.display_name), u.name_style), h('small', u.custom_status || STATUS_TXT[u.status])));
  box.replaceChildren(h('h3', 'Ativo agora'),
    ...(inVoice.length ? [h('div.an-cap', 'Em chamada de voz'), ...inVoice.sort(byName).map(voiceCard)] : []),
    ...(other.length ? [h('div.an-cap', 'Online'), ...other.sort(byName).map(rows)] : []),
    ...(!inVoice.length && !other.length ? [h('div.an-empty', h('b', 'Tudo quieto por aqui…'), h('p', 'Quando seus amigos ficarem online ou entrarem numa sala de voz, eles aparecem aqui.'))] : []));
}
function renderHome(main) {
  if (S.view.tab === 'blocked' || S.view.tab === 'pending') S.view.tab = 'online'; // bloqueados ficam em Privacidade e segurança; pedidos pendentes aparecem em "Todos"
  const tab = S.view.tab, rels = [...S.rels.values()];
  const tabs = [['online', 'Online'], ['all', 'Todos']];
  const q = h('input.fsearch', { placeholder: 'Buscar', oninput: () => draw() });
  const ORD = { online: 0, idle: 1, dnd: 2, invisible: 3, offline: 4 };
  const pane = h('div.pane');
  const draw = () => {
    pane.replaceChildren();
    if (tab === 'add') {
      const inp = h('input', { placeholder: 'Digite o nome de usuário exato', onkeydown: (e) => e.key === 'Enter' && send() }), msg = h('div', { style: { marginTop: '8px', fontSize: '14px' } });
      const send = async () => { try { await api('POST', '/relationships', { username: inp.value }); msg.style.color = 'var(--green)'; msg.textContent = `Pedido de amizade enviado para ${inp.value}.`; inp.value = ''; } catch (e) { msg.style.color = 'var(--red)'; msg.textContent = e.message; } };
      return pane.append(h('h2', { style: { margin: '0 0 4px', color: 'var(--header)', fontSize: '16px' } }, 'Adicionar amigo'), h('p', { style: { color: 'var(--text-muted)', margin: '0 0 16px' } }, 'Você pode adicionar amigos pelo nome de usuário.'), h('div.addf', inp, h('button.btn', { onclick: send }, 'Enviar pedido')), msg);
    }
    let list = rels.filter(r => tab === 'online' ? r.type === 1 && S.users.get(r.user.id).status !== 'offline' : tab === 'all' ? r.type === 1 || r.type === 3 || r.type === 4 : tab === 'pending' ? r.type === 3 || r.type === 4 : r.type === 2);
    list = list.filter(r => r.user.username.toLowerCase().includes(q.value.toLowerCase()) || r.user.display_name.toLowerCase().includes(q.value.toLowerCase()));
    const nm = (r) => (r.user.display_name || r.user.username).toLowerCase();
    const PEND = (r) => r.type === 3 ? 0 : r.type === 4 ? 1 : 2; // pedidos recebidos/enviados no topo de "Todos"
    list.sort((a, b) => (PEND(a) - PEND(b)) || (ORD[S.users.get(a.user.id)?.status || 'offline'] - ORD[S.users.get(b.user.id)?.status || 'offline']) || nm(a).localeCompare(nm(b)));
    pane.append(h('div.fctl', q), h('div.fh', `${{ online: 'Online', all: 'Todos os amigos', pending: 'Pendentes', blocked: 'Bloqueados' }[tab]} — ${list.length}`));
    if (!list.length) return pane.append(h('div.empty', { style: { marginTop: '60px' } }, h('div', { style: { fontSize: '48px' } }, '🌙'), h('p', tab === 'pending' ? 'Nenhum pedido pendente.' : tab === 'blocked' ? 'Você não bloqueou ninguém.' : 'Ninguém por aqui ainda. Que tal adicionar um amigo?')));
    for (const r of list) {
      const u = S.users.get(r.user.id) || r.user;
      const btn = (ic, title, fn, cls = '') => h('button.circle' + cls, { title, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ic, 20));
      pane.append(h('div.frow', { onclick: () => openDM(u.id), oncontextmenu: (e) => userMenu(e, u.id) }, avatar(u, 36, { ring: 'var(--bg-pri)' }),
        h('div.fn', styleName(h('b', u.display_name), u.name_style), h('small', r.type === 3 ? 'Pedido de amizade recebido' : r.type === 4 ? 'Pedido de amizade enviado' : r.type === 2 ? 'Bloqueado' : (u.custom_status || STATUS_TXT[u.status]))),
        r.type === 1 && btn('dm', 'Mensagem', () => openDM(u.id)),
        r.type === 3 && btn('check', 'Aceitar', () => tryApi('PUT', `/relationships/${u.id}`, {}), '.ok'),
        (r.type === 3 || r.type === 4 || r.type === 2 || r.type === 1) && btn('x', r.type === 1 ? 'Remover' : r.type === 2 ? 'Desbloquear' : 'Ignorar', () => tryApi('DELETE', `/relationships/${u.id}`), '.no')));
    }
  };
  main.replaceChildren(h('div#home',
    h('div#topbar', h('button.ibtn.menu-btn', { onclick: () => $('#app').classList.toggle('nav-open'), style: { display: innerWidth <= 640 ? 'flex' : 'none' } }, icon('more')), icon('users', 24), h('span', 'Amigos'), h('div', { style: { width: '1px', height: '24px', background: 'var(--divider)', margin: '0 8px' } }),
      h('div.tabs', tabs.map(([k, l]) => h('div.tab' + (tab === k ? '.active' : ''), { onclick: () => { S.view.tab = k; renderHome(main); } }, l)),
        h('div.tab.green' + (tab === 'add' ? '.active' : ''), { onclick: () => { S.view.tab = 'add'; renderHome(main); } }, icon('plus', 18), 'Adicionar amigo'))),
    h('div#homebody', pane, h('aside#active-now'))));
  draw(); renderActiveNow();
}

// =============== Voz: palco ===============
const vidCache = new Map(); // reaproveita <video> para não piscar a cada atualização
function videoFor(key, stream, muted = true) {
  let v = vidCache.get(key);
  if (!v || v.srcObject !== stream) { v = h('video', { autoplay: true, playsInline: true, muted }); v.srcObject = stream; vidCache.set(key, v); v.play?.().catch(() => { }); }
  else if (v.paused) v.play?.().catch(() => { }); // o navegador pausa <video> removido da tela; ao voltar à sala ele ficava congelado
  return v;
}
// avisa o servidor de quais transmissões estou assistindo (tela visível agora)
function syncWatching(want) {
  const cur = S.watching, next = new Set(want || []);
  for (const id of next) if (!cur.has(id)) gwSend('STREAM_WATCH', { target: id, watching: true });
  for (const id of cur) if (!next.has(id)) gwSend('STREAM_WATCH', { target: id, watching: false });
  S.watching = next;
}
// selo "N assistindo" com os avatares dos espectadores; clique abre a lista
function viewersBadge(streamer) {
  const ids = (S.viewers.get(streamer) || []).filter(id => id !== S.me.id || streamer !== S.me.id), n = ids.length;
  if (!n) return null;
  const nm = (id) => nameOf(id, channelById(S.view.cid)?.guild_id);
  return h('button.viewers', { title: ids.map(nm).join(', '), onclick: (e) => {
    e.stopPropagation();
    popout(e.currentTarget, h('div.vwlist', h('h4', `Assistindo (${n})`), ids.map(id => h('div.vwrow', { onclick: (ev) => profile(ev.currentTarget, id, channelById(S.view.cid)?.guild_id) }, avatar(user(id), 28, { status: false }), h('span', nm(id))))), 'right');
  } }, icon('eye', 14), h('div.vstack', ids.slice(0, 4).map(id => avatar(user(id), 18, { status: false }))), h('span', n > 4 ? `+${n - 4}` : String(n)));
}
// ---------- quadros da chamada ----------
// fundo com as cores do perfil: tema (degradê) > banner > cor do banner > cor predominante do avatar
const avTint = new Map();
function avatarTint(u) {
  if (!u.avatar) return null;
  if (avTint.has(u.avatar)) return avTint.get(u.avatar);
  avTint.set(u.avatar, null);
  const img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) { // pesa as cores vivas: média de cinza não diz nada
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), k = (d[i + 3] / 255) * (0.15 + (mx - mn) / 255);
        r += d[i] * k; g += d[i + 1] * k; b += d[i + 2] * k; w += k;
      }
      if (!w) return;
      const hex = '#' + [r, g, b].map(v => Math.round(v / w).toString(16).padStart(2, '0')).join('');
      avTint.set(u.avatar, hex);
      document.querySelectorAll(`.utile[data-uid="${u.id}"]`).forEach(t => paintTile(t, u));
    } catch { /* imagem de outro domínio sem CORS: fica o fundo padrão */ }
  };
  img.src = u.avatar;
  return null;
}
function paintTile(t, u) {
  const tp = u.theme_primary, ta = u.theme_accent;
  let bg = null, kind = '';
  if (tp && ta) { bg = `linear-gradient(160deg, ${tp}, ${ta})`; kind = 'theme'; t.style.setProperty('--ring', ta); }
  else if (u.banner) { { const bp = parsePos(u.banner_pos); bg = `${bp.x}% ${bp.y}% / cover url("${u.banner.replace(/"/g, '%22')}")`; } kind = 'banner'; }
  else { const c = u.banner_color || avatarTint(u); if (c) { bg = `linear-gradient(160deg, ${c}, color-mix(in srgb, ${c} 45%, #000))`; kind = 'color'; } }
  t.dataset.bg = kind;
  if (bg) t.style.setProperty('--tbg', bg); else t.style.removeProperty('--tbg');
  return t;
}
// grade que cabe no palco: testa de 1 a n colunas e fica com o maior quadro 16:9 que cabe sem rolar
function fitStage() {
  const grid = document.querySelector('#stage .grid.fit'); if (!grid) return;
  const n = grid.querySelectorAll(':scope > .tile').length; if (!n) return;
  const gap = 12, W = grid.clientWidth - 32, H = grid.clientHeight - 32;
  if (W <= 0 || H <= 0) return;
  let best = 0;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c), w = Math.min((W - gap * (c - 1)) / c, ((H - gap * (r - 1)) / r) * 16 / 9);
    if (w > best) best = w;
  }
  lastTw = Math.max(120, Math.floor(Math.min(best, 1280))) + 'px';
  grid.style.setProperty('--tw', lastTw);
}
let lastTw = null; // tamanho calculado na última vez: a grade redesenhada já nasce com ele (sem piscar)
const stageObs = new ResizeObserver(() => fitStage());
let observedStage = null;
function watchStage() {
  const st = document.getElementById('stage');
  if (st !== observedStage) { if (observedStage) stageObs.unobserve(observedStage); if (st) stageObs.observe(st); observedStage = st; }
  fitStage();
}

function renderVoiceUI(speakOnly) {
  if (speakOnly) {
    document.querySelectorAll('.tile[data-uid],.avatar[data-uid]').forEach(e => e.classList.toggle('speaking', voice.speaking.has(e.dataset.uid)));
    document.querySelectorAll('.tile[data-uid],.avatar[data-uid]').forEach(e => e.classList.toggle('sbplay', voice.sbActive.has(e.dataset.uid)));
    document.getElementById('vp-ping') && updatePing();
    return;
  }
  renderSide();
  const stage = $('#stage'); if (!stage) return syncWatching(null);
  const ch = channelById(S.view.cid); if (!ch || ![1, 2].includes(ch.type)) return syncWatching(null);
  const dm = ch.type === 1, gid = ch.guild_id;
  const members = [...S.voice.values()].filter(v => v.channel_id === ch.id);
  const inRoom = voice.channelId === ch.id;
  const tiles = [], live = new Set();
  const nm = (uid) => dm ? user(uid).display_name : nameOf(uid, gid);
  for (const v of members) {
    const uid = v.user_id, mine = uid === S.me.id, p = voice.peers.get(uid);
    const cam = mine ? voice.cam : (S.prefs.hiddenVideo?.[uid] ? null : p?.streams.cam), scr = mine ? voice.screen : p?.streams.screen;
    if (scr && v.screen) {
      const key = 's:' + uid; live.add(key);
      const vid = videoFor(key, scr), info = h('span.sinfo');
      const upd = () => (info.textContent = vid.videoWidth ? `${vid.videoWidth}×${vid.videoHeight}` : '');
      vid.onresize = vid.onloadedmetadata = upd; upd();
      const vol = !mine && h('input', { type: 'range', min: 0, max: 200, value: voice.streamVolumes[uid] ?? 100, title: 'Volume da transmissão', onclick: (e) => e.stopPropagation(), oninput: (e) => { voice.setStreamVolume(uid, +e.target.value); savePrefs(); } });
      tiles.push(h('div.tile.screen' + (S.focus === key ? '.focus' : ''), { 'data-key': key, 'data-sid': uid, onclick: () => { S.focus = S.focus === key ? null : key; renderVoiceUI(); }, oncontextmenu: (e) => !mine && menu(e, [{ node: volumeControl(voice, uid, 'screen', 'Volume da transmissão de ' + nm(uid)) }]) }, vid,
        h('div.label', icon('screen', 14), `${nm(uid)} — tela`, info), viewersBadge(uid), h('div.tctl', vol, h('button.ibtn', { title: 'Tela cheia', onclick: (e) => { e.stopPropagation(); vid.requestFullscreen?.(); } }, icon('expand', 18)))));
    }
    const ckey = 'c:' + uid;
    if (cam && v.video) live.add(ckey);
    const t = h('div.tile.utile' + (voice.speaking.has(uid) ? '.speaking' : '') + (voice.sbActive.has(uid) ? '.sbplay' : ''), { 'data-uid': uid, 'data-key': ckey, oncontextmenu: (e) => userMenu(e, uid, gid), onclick: () => { if (cam && v.video) { S.focus = S.focus === ckey ? null : ckey; renderVoiceUI(); } } },
      cam && v.video ? videoFor(ckey, cam) : avatar(user(uid), 96, { status: false }),
      h('div.label', v.mute && icon('micoff', 14), v.deaf && icon('headoff', 14), isLocalMuted(uid) && h('span.lmute', { title: 'Silenciado por você' }, icon('headoff', 14)), styleName(h('span', nm(uid)), user(uid).name_style)));
    tiles.push(paintTile(t, user(uid)));
  }
  for (const k of [...vidCache.keys()]) if (!live.has(k)) vidCache.delete(k);
  syncWatching(inRoom ? members.filter(v => v.screen && v.user_id !== S.me.id && voice.peers.get(v.user_id)?.streams.screen).map(v => v.user_id) : null);
  const hasFocus = tiles.some(t => t.dataset.key === S.focus);
  const focusTile = hasFocus ? tiles.find(t => t.dataset.key === S.focus) : tiles.find(t => t.classList.contains('screen'));
  const btn = (ic, title, on, fn, cls = '') => h('button.roundbtn' + (on ? '.off' : '') + cls, { title, onclick: fn, oncontextmenu: cls === '.mic' ? noiseMenu : null }, icon(ic, 24));
  const bar = h('div.bar', inRoom ? [
    btn(voice.muted ? 'micoff' : 'mic', voice.muted ? 'Ativar microfone (clique direito: redução de ruído)' : 'Silenciar (clique direito: redução de ruído)', voice.muted, () => voiceToggle('mute'), '.mic'),
    btn(voice.deafened ? 'headoff' : 'headset', 'Ensurdecer', voice.deafened, () => voiceToggle('deaf')),
    btn('video', 'Câmera', !!voice.cam, () => voiceAct(() => voice.toggleCam())),
    btn('screen', voice.screen ? 'Parar transmissão' : 'Transmitir tela', !!voice.screen, startShare),
    btn('voice', 'Soundboard', false, (e) => openSoundboard(e.currentTarget, voice, { openSettings: (k) => openSettings(k, ctxSettings()) })),
    !dm && h('button.roundbtn', { title: 'Música (bot) — indisponível', disabled: true, style: { opacity: .4, cursor: 'not-allowed' } }, icon('music', 24)),
    btn('phoneoff', 'Desconectar', false, () => voice.leave(), '.red'),
  ] : h('button.btn.green', { style: { minWidth: '220px', minHeight: '46px', fontSize: '16px' }, onclick: () => joinVoice(ch.id) }, dm ? 'Atender / entrar na chamada' : 'Entrar na sala de voz'));
  const rest = focusTile ? tiles.filter(t => t !== focusTile) : tiles;
  const empty = !tiles.length; // sala vazia: o botão de entrar fica junto do texto, no meio (como no Discord)
  stage.replaceChildren(...[
    !empty ? (focusTile ? [h('div.spot', focusTile), h('div.strip', rest)] : (() => { const gr = h('div.grid.fit', tiles); if (lastTw) gr.style.setProperty('--tw', lastTw); return gr; })()) : h('div.grid', h('div.empty', { style: { color: '#fff' } }, h('h2', dm ? 'Chamada' : chName(ch)), h('p', dm ? 'Ninguém está na chamada.' : 'Ninguém está nesta sala de voz ainda.'), !inRoom && bar)),
    voice.error && inRoom && h('div.verr', voice.error),
    !(empty && !inRoom) && bar].flat().filter(Boolean));
  watchStage();
}
const ctxSettings = () => ({ voice, logout, go });
function noiseMenu(e) {
  const cur = S.prefs.noiseMode;
  menu(e, [['off', 'Nenhuma'], ['standard', 'Padrão (navegador)'], ['rnnoise', 'Alta — RNNoise (IA)'], ['gtcrn', 'Máxima — GTCRN (IA)']].map(([k, l]) => ({ label: (cur === k ? '✓ ' : '   ') + 'Ruído: ' + l, fn: async () => { S.prefs.noiseMode = k; savePrefs(); await voice.rebuildMic(); toast('Redução de ruído: ' + l); } })));
}
async function startShare() {
  if (voice.screen) return liveShareModal();
  if (!voice.active) return toast('Entre em uma sala de voz primeiro.', true);
  const o = { res: 1080, fps: 30, hint: 'motion', audio: true, ...S.prefs.screen };
  let src = null, list = [], tab = 'screen', timer, loaded = false;
  const tabs = h('div.seg'), grid = h('div.sources');
  const drawSources = () => {
    tabs.replaceChildren(...[['screen', 'Telas'], ['window', 'Janelas / aplicativos']].map(([k, l]) => h('button' + (tab === k ? '.on' : ''), { onclick: () => { tab = k; drawSources(); } }, l)));
    const items = list.filter(s => s.type === tab);
    if (!loaded) return grid.replaceChildren(h('div.empty', { style: { gridColumn: '1/-1', margin: '28px' } }, 'Carregando telas e janelas…'));
    grid.replaceChildren(...(items.length ? items.map(s => h('div.source' + (src?.id === s.id ? '.sel' : ''), { onclick: () => { src = s; drawSources(); } },
      h('img', { src: s.thumbnail }), h('div.sn', s.appIcon ? h('img.si', { src: s.appIcon }) : null, h('span', s.name + (s.gone ? ' (minimizado)' : ''))))) : [h('div.empty', { style: { gridColumn: '1/-1', margin: '24px' } }, 'Nada encontrado.')]));
  };
  const refresh = async () => { try { const fresh = await desktop.getSources(); loaded = true; const ids = new Set(fresh.map(s => s.id)); list = [...fresh, ...list.filter(s => !ids.has(s.id) && s.type === 'window').map(s => ({ ...s, gone: true }))]; /* jogo em tela cheia some da lista ao dar alt+tab: mantém o que já foi visto */ if (!src) src = list.find(s => s.type === tab) || list[0] || null; drawSources(); } catch { } };
  const body = h('div', desktop && [h('label.f', 'O que compartilhar'), tabs, grid, h('div.qinfo', 'Jogo em tela cheia? Ele aparece em "Janelas" mesmo que suma ao dar alt+tab: selecione, clique em Transmitir e volte para o jogo. Se não funcionar, use a aba "Telas" (tela inteira).')], qualityPanel(o),
    h('label.f', 'Áudio', seg({ 1: 'Compartilhar áudio do sistema', 0: 'Sem áudio' }, o.audio ? 1 : 0, v => (o.audio = !!v))),
    !desktop && h('div.qinfo', 'Ao clicar em Transmitir, o navegador abrirá o seletor de tela/janela/aba. Para escolher dentro do app, use o aplicativo desktop.'));
  if (desktop) { drawSources(); refresh(); timer = setInterval(() => { if (!document.body.contains(body)) return clearInterval(timer); refresh(); }, 3000); }
  modal('Transmitir tela', 'Escolha o que mostrar, a resolução e os quadros por segundo.', body, [{ label: 'Cancelar', cls: 'link', fn: () => clearInterval(timer) }, { label: 'Transmitir', cls: 'green', fn: async () => {
    if (desktop) { if (!src) { toast('Selecione uma tela ou janela', true); return false; } await desktop.selectSource(src.id); }
    clearInterval(timer); S.prefs.screen = { res: o.res, fps: o.fps, hint: o.hint, audio: o.audio }; savePrefs(); voiceAct(() => voice.toggleScreen(o));
  } }], { width: desktop ? '780px' : '560px' });
}

// durante a transmissão: mudar qualidade ao vivo, trocar fonte, parar
function liveShareModal() {
  const o = { ...voice.screenOpts };
  const settings = h('div.qinfo'), net = h('div.qinfo'), updInfo = () => { const st = voice.screen?.getVideoTracks()[0]?.getSettings?.() || {}; settings.textContent = `Capturando: ${st.width || '?'}×${st.height || '?'} a ${Math.round(st.frameRate || 0) || '?'} fps — ${qualityLabel(o)}`; voice.screenStats().then(L => { if (!L?.length) return; const t = L[0], why = { cpu: 'limitado pelo processador', bandwidth: 'limitado pela sua internet (upload)', none: 'sem limitação', other: 'limitado' }[t.limit] || t.limit; net.textContent = `Enviando: ${t.w}×${t.h} a ${t.fps} fps, ${(t.kbps / 1000).toFixed(1)} Mbps — ${why}${/hw|h264|video toolbox|nvenc|media/i.test(t.enc) ? ' (placa de vídeo)' : t.enc ? ' (' + t.enc + ')' : ''}`; }); };
  updInfo(); const iv = setInterval(() => { if (!document.body.contains(settings)) return clearInterval(iv); updInfo(); }, 1000);
  const body = h('div', settings, net, qualityPanel(o, async (n) => { await voice.changeScreenQuality(n); S.prefs.screen = { ...S.prefs.screen, res: n.res, fps: n.fps, hint: n.hint }; savePrefs(); setTimeout(updInfo, 400); }),
    h('div', { style: { fontSize: '14px', color: 'var(--text-muted)' } }, `${[...S.voice.values()].filter(v => v.channel_id === voice.channelId).length - 1} pessoa(s) na sala podem assistir.`));
  modal('Transmissão ao vivo', 'Mudanças valem imediatamente.', body, [
    { label: 'Parar transmissão', cls: 'red', fn: () => voice.toggleScreen() },
    desktop && { label: 'Trocar o que compartilho', cls: 'grey', fn: async () => { const keep = { ...voice.screenOpts }; await voice.toggleScreen(); setTimeout(startShare, 150); void keep; } },
    { label: 'Fechar', cls: 'link' }].filter(Boolean), { width: '560px' });
}

// latência até o servidor (SFU) ou pior par (malha): Wi-Fi colorido; passar o mouse = ms; clicar = gráfico do último minuto
const pingHist = []; // [{ t, ms }] dos últimos 60 s
const lastPing = () => pingHist.at(-1)?.ms ?? null;
const pingLevel = (p) => (p == null ? '' : p < 80 ? 'good' : p < 200 ? 'mid' : 'bad');
const pingEl = () => { const el = h('button#vp-ping.ping', { onclick: (e) => openPingChart(e.currentTarget) }, icon('wifi', 16)); paintPing(el); return el; };
function paintPing(el) {
  const p = lastPing();
  el.className = 'ping ' + pingLevel(p);
  el.title = p == null ? 'Medindo a conexão…' : `Ping: ${p} ms (clique para ver o gráfico)`;
}
// ida e volta pelo gateway: funciona mesmo sem transporte de mídia conectado (sem microfone, sozinho ouvindo)
const wsPings = new Map(); let wsPingN = 0;
function wsPing() {
  return new Promise((resolve) => {
    const n = ++wsPingN, t0 = performance.now();
    const done = (v) => { wsPings.delete(n); resolve(v); };
    wsPings.set(n, () => done(Math.round(performance.now() - t0)));
    if (ws?.readyState !== 1) return done(null);
    gwSend('PING', { n });
    setTimeout(() => wsPings.has(n) && done(null), 5000);
  });
}
function updatePing() {
  if (!voice.active) { pingHist.length = 0; return; }
  const cid = voice.channelId;
  Promise.resolve().then(() => voice.ping()).catch(() => null).then(p => p ?? wsPing()).then(p => {
    if (voice.channelId !== cid) return;
    const now = Date.now();
    if (p != null) pingHist.push({ t: now, ms: p });
    while (pingHist.length && now - pingHist[0].t > 60000) pingHist.shift();
    const el = document.getElementById('vp-ping'); if (el) paintPing(el);
    document.dispatchEvent(new Event('ping-sample'));
  });
}
setInterval(() => (voice?.active ? updatePing() : (pingHist.length = 0)), 1000);
// qualidade da voz: selo no painel (nível atual) e ajuste automático a cada 3 s
const isAutoAbr = () => S.prefs.voiceBitrate === 'auto' || S.prefs.voiceBitrate == null;
const abrEl = () => { const el = h('button#vp-abr.abr', { onclick: (e) => openAbrPicker(e.currentTarget) }); paintAbr(el); return el; };
function paintAbr(el) {
  const k = voice.micKbps(), auto = isAutoAbr();
  el.textContent = (auto ? 'Auto · ' : '') + k + 'k';
  el.title = `Qualidade da voz: ${k} kbps${auto ? ' (automático)' : ''}${voice.sentKbps != null ? ` — enviando ~${voice.sentKbps} kbps agora` : ''}. Clique para mudar.`;
}
function openAbrPicker(anchor) {
  const body = h('div.qpop', h('h4', 'Qualidade da voz'), seg(VOICE_BITRATES, isAutoAbr() ? 'auto' : S.prefs.voiceBitrate, (v) => { S.prefs.voiceBitrate = v; savePrefs(); voice.retuneAudio(); paintAbr(anchor); }),
    h('div.hintline', 'Automático começa em 128 kbps e sobe ou desce conforme a rede. Mais kbps = voz mais fiel, usando mais banda.'));
  const el = popout(anchor, body, 'up'); el.classList.add('quick', 'abrpop');
}
setInterval(() => {
  if (!voice?.active) return;
  voice.adaptAudio().catch(() => { }).then(() => { const el = document.getElementById('vp-abr'); if (el) paintAbr(el); });
}, 3000);
function openPingChart(anchor) {
  const W = 300, H = 120, L = 34, R = 8, T = 10, B = 20;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pchart'); svg.setAttribute('role', 'img');
  const avgEl = h('b'), lastEl = h('b'), rangeEl = h('b'), tip = h('div.ptip.hidden');
  const body = h('div.qpop.pingpop', h('h4', 'Ping até o servidor — último minuto'), h('div.pwrap', svg, tip),
    h('div.pstats', h('div', h('small', 'Último'), lastEl), h('div', h('small', 'Média'), avgEl), h('div', h('small', 'Mín – máx'), rangeEl)));
  const ns = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  let pts = [];
  const draw = () => {
    const now = Date.now(), data = pingHist.filter(s => now - s.t <= 60000);
    const vals = data.map(s => s.ms), max = Math.max(50, ...vals), top = Math.ceil(max * 1.2 / 20) * 20;
    const x = (t) => L + (W - L - R) * (1 - (now - t) / 60000), y = (ms) => T + (H - T - B) * (1 - ms / top);
    svg.replaceChildren();
    for (const v of [0, top / 2, top]) { // grade discreta + rótulos
      svg.append(ns('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'pgrid' }));
      const tx = ns('text', { x: L - 6, y: y(v) + 4, class: 'paxis', 'text-anchor': 'end' }); tx.textContent = Math.round(v); svg.append(tx);
    }
    for (const [t, lbl] of [[now - 60000, '-60s'], [now - 30000, '-30s'], [now, 'agora']]) { const tx = ns('text', { x: x(t), y: H - 4, class: 'paxis', 'text-anchor': t === now ? 'end' : t === now - 60000 ? 'start' : 'middle' }); tx.textContent = lbl; svg.append(tx); }
    pts = data.map(s => ({ ...s, x: x(s.t), y: y(s.ms) }));
    if (pts.length > 1) svg.append(ns('polyline', { points: pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), class: 'pline' }));
    if (pts.length) { const p = pts.at(-1); svg.append(ns('circle', { cx: p.x, cy: p.y, r: 4, class: 'pdot' })); }
    if (!pts.length) { const tx = ns('text', { x: (L + W - R) / 2, y: H / 2, class: 'paxis', 'text-anchor': 'middle' }); tx.textContent = 'Medindo…'; svg.append(tx); }
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    lastEl.textContent = vals.length ? `${vals.at(-1)} ms` : '—'; avgEl.textContent = avg != null ? `${avg} ms` : '—';
    rangeEl.textContent = vals.length ? `${Math.min(...vals)} – ${Math.max(...vals)} ms` : '—';
    svg.setAttribute('aria-label', `Ping no último minuto: média ${avg ?? '—'} ms, último ${vals.at(-1) ?? '—'} ms`);
  };
  // dica ao passar o mouse: amostra mais próxima
  svg.addEventListener('mousemove', (e) => {
    if (!pts.length) return;
    const r = svg.getBoundingClientRect(), mx = (e.clientX - r.left) * (W / r.width);
    const p = pts.reduce((a, b) => (Math.abs(b.x - mx) < Math.abs(a.x - mx) ? b : a));
    svg.querySelector('.pcross')?.remove(); svg.querySelector('.phov')?.remove();
    svg.append(ns('line', { x1: p.x, x2: p.x, y1: T, y2: H - B, class: 'pcross' }), ns('circle', { cx: p.x, cy: p.y, r: 4, class: 'pdot phov' }));
    tip.textContent = `${p.ms} ms · há ${Math.round((Date.now() - p.t) / 1000)} s`; tip.classList.remove('hidden');
    tip.style.left = Math.min(r.width - 110, Math.max(0, p.x * r.width / W - 50)) + 'px';
  });
  svg.addEventListener('mouseleave', () => { tip.classList.add('hidden'); svg.querySelector('.pcross')?.remove(); svg.querySelector('.phov')?.remove(); });
  draw();
  const onSample = () => { if (!document.body.contains(body)) return document.removeEventListener('ping-sample', onSample); if (tip.classList.contains('hidden')) draw(); };
  document.addEventListener('ping-sample', onSample);
  const el = popout(anchor, body, 'up'); el.classList.add('quick');
  const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
  el.style.top = Math.max(8, r.top - b.height - 10) + 'px'; el.style.left = Math.max(8, r.left) + 'px';
}

function incomingCall(dm, uid) {
  const u = user(uid); document.getElementById('call-banner')?.remove();
  let n = 0; const t = setInterval(() => { if (!document.getElementById('call-banner') || ++n > 6) return clearInterval(t); playSound('ring'); }, 2600);
  const el = h('div#call-banner', avatar(u, 48, { status: false }), h('div', { style: { flex: 1 } }, h('b', u.display_name), h('div', { style: { fontSize: '13px', color: 'var(--text-muted)' } }, 'está te ligando…')),
    h('button.btn.green', { onclick: () => { el.remove(); go('@me', dm.id); joinVoice(dm.id); } }, 'Atender'), h('button.btn.red', { onclick: () => el.remove() }, 'Recusar'));
  document.body.append(el); playSound('ring');
  notify(`${u.display_name} está te ligando`, 'Chamada de voz', () => { go('@me', dm.id); });
  setTimeout(() => el.remove(), 30000);
}

// ---------- atalhos / desktop ----------
function setupDesktop() {
  if (setupDesktop.done) return; setupDesktop.done = true;
  const typing = (t) => /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || t?.isContentEditable;
  addEventListener('keydown', (e) => {
    if (S.prefs.inputMode === 'ptt' && e.code === S.prefs.pttKey && !e.repeat && (!typing(e.target) || !/^(Key|Digit|Space|Numpad)/.test(e.code))) voice?.setPtt(true);
    if (!(typing(e.target) && !e.ctrlKey && !e.altKey) && sbKey(e, voice)) return;
    const c = comboFromEvent(e);
    if (c && c === (S.prefs.keyMute || 'Ctrl+Shift+KeyM')) { e.preventDefault(); voiceToggle('mute'); }
    if (c && c === (S.prefs.keyDeafen || 'Ctrl+Shift+KeyD')) { e.preventDefault(); voiceToggle('deaf'); }
  });
  addEventListener('keyup', (e) => { if (e.code === S.prefs.pttKey) voice?.setPtt(false); });
  addEventListener('blur', () => voice?.setPtt(false));
  desktop?.setSettings?.({ hotkeyMute: comboToAccel(S.prefs.keyMute || 'Ctrl+Shift+KeyM'), hotkeyDeafen: comboToAccel(S.prefs.keyDeafen || 'Ctrl+Shift+KeyD') });
  desktop?.onHotkey?.((k) => { if (k === 'mute') voiceToggle('mute'); if (k === 'deafen') voiceToggle('deaf'); });
}

// gancho de depuração/testes automatizados
window.__lc = { S, get voice() { return voice; }, go, openSettings: (k) => openSettings(k, { voice, logout, go, gid: S.view.gid }) };

// =============== Boot ===============
(async function boot() {
  const m = location.pathname.match(/^\/invite\/([\w-]+)/);
  if (m) pendingInvite = m[1];
  if (S.token) connect(); else showAuth(pendingInvite ? 'register' : 'login');
})();
