import { h, icon, avatar, md, esc, stamp, clock, dayLabel, sameDay, bytes, onlyEmoji, isImageUrl, SHORT } from './util.js';
import { S, api, tryApi, user, guild, channelById, member, nameOf, roleColor, can, perms, PERM, dmPeer, relType, toast, modal, confirmBox, promptBox, menu, popout, emojiPicker, lightbox, closeFloating, beep, notify, notifPolicy, desktop, applyTheme, emojiUrl, allEmojis, savePrefs } from './state.js';
import { Voice, SCREEN_PRESETS } from './voice.js';
import { playSound } from './sounds.js';
import { openSoundboard, onIncoming as sbIncoming, handleKey as sbKey } from './soundboard.js';
import { openAudioPanel, openStatusPanel } from './quick.js';
import { seg, qualityPanel, qualityLabel, comboFromEvent, comboToAccel } from './ui.js';
import { openSettings } from './settings.js';
import { profileCard, STATUS_TXT } from './card.js';
import { timeoutDialog, removeTimeout, banDialog, timedOutUntil } from './mod.js';
applyTheme();

let ws, voice, retry = 0, ready = false, pendingInvite = null;
const $ = (s) => document.querySelector(s);
const gwSend = (t, d) => ws?.readyState === 1 && ws.send(JSON.stringify({ t, d }));

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
    case 'SOUNDBOARD': sbIncoming(d, voice); break;
    case 'SOUNDS_UPDATE': { const g = guild(d.guild_id); if (g) { g.sounds = d.sounds; document.dispatchEvent(new Event('sb-changed')); } break; }
    case 'EMOJIS_UPDATE': { const g = guild(d.guild_id); if (g) { g.emojis = d.emojis; renderMessages(true); } break; }
    case 'VOICE_JOINED': voice.onJoined(d); break;
    case 'VOICE_DENIED': if (voice.channelId === d.channel_id) { voice.leave(); toast(d.reason, true); } break;
    case 'VOICE_PEER_LEFT': voice.onPeerLeft(d); break;
    case 'VOICE_SIGNAL': voice.onSignal(d); break;
    case 'SFU_RES': voice.onSfuRes(d); break;
    case 'SFU_NEW_PRODUCER': voice.onSfuProducer(d); break;
    case 'SFU_CONSUMER_CLOSED': voice.onSfuConsumerClosed(d); break;
    case 'TYPING': {
      let m = S.typing.get(d.channel_id); if (!m) S.typing.set(d.channel_id, m = new Map());
      m.set(d.user_id, Date.now() + 8000); renderTyping(); setTimeout(renderTyping, 8100); break;
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

function onMessage(m) {
  const list = S.messages.get(m.channel_id);
  if (list && !list.some(x => x.id === m.id)) list.push(m);
  S.users.set(m.author.id, { ...S.users.get(m.author.id), ...m.author });
  const mine = m.author_id === S.me.id, viewing = S.view.cid === m.channel_id && document.hasFocus();
  const t = S.typing.get(m.channel_id); if (t) { t.delete(m.author_id); renderTyping(); }
  if (S.view.cid === m.channel_id && list) appendMessage(m);
  if (mine) return;
  const ch = channelById(m.channel_id), isDM = ch?.type === 1, pol = notifPolicy(ch);
  const text = m.content || '', direct = text.includes(`<@${S.me.id}>`);
  const isMention = isDM || ((m.mentions || []).includes(S.me.id) && (direct || !pol.noEveryone));
  const counts = isDM || (isMention && pol.level !== 'none') || (!pol.muted && pol.level === 'all');
  if (!viewing) {
    if (counts) { const u = S.unread[m.channel_id] ||= { count: 0 }; u.count++; }
    if (isMention && pol.level !== 'none') {
      S.mentions[m.channel_id] = (S.mentions[m.channel_id] || 0) + 1;
      playSound('mention'); notify(isDM ? m.author.display_name : `${m.author.display_name} (#${ch?.name})`, S.prefs.notifPreview === false ? 'Nova mensagem' : (text || 'Anexo'), () => go(ch.guild_id || '@me', ch.id));
    } else if (counts) playSound('message');
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
window.addEventListener('focus', () => S.view.cid && ack(S.view.cid));

// =============== Navegação ===============
function go(gid, cid) {
  const hash = `#/${gid || '@me'}${cid ? '/' + cid : ''}`;
  if (location.hash === hash) applyRoute(); else location.hash = hash;
}
window.addEventListener('hashchange', () => ready && applyRoute());
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
  renderRail(); renderSide(); renderMain();
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
    voiceRooms(g).map(({ ch, users }) => h('div.vcroom', h('div.vcname', icon('voice', 14), h('span', ch.name), callTimer(users)),
      h('div.vcusers', users.map(v => h('span.vcu', { title: nameOf(v.user_id, g.id) }, avatar(user(v.user_id), 24, { status: false }), h('span', nameOf(v.user_id, g.id))))))));
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
async function inviteModal(g) {
  const r = await tryApi('POST', `/guilds/${g.id}/invites`); if (!r) return;
  const link = `${location.origin}/invite/${r.code}`;
  const inp = h('input', { value: link, readOnly: true, onfocus: (e) => e.target.select() });
  modal(`Convidar amigos para ${g.name}`, 'Envie este link para seus amigos (precisam acessar o mesmo endereço do servidor).', h('label.f', 'Link de convite', inp),
    [{ label: 'Fechar', cls: 'link' }, { label: 'Copiar', keep: true, fn: () => { inp.select(); (navigator.clipboard?.writeText(link) || Promise.reject()).catch(() => document.execCommand('copy')); toast('Link copiado!'); } }]);
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
      h('div.cat', { style: { cursor: 'default' } }, 'Mensagens diretas'),
      ...[...S.dms.values()].sort((a, b) => (lastActivity(b) > lastActivity(a) ? 1 : -1)).map(dm => {
        const p = dmPeer(dm), un = S.mentions[dm.id];
        return h('div.ch' + (S.view.cid === dm.id ? '.active' : '') + (S.unread[dm.id] ? '.unread' : ''), { style: { height: '42px' }, onclick: () => go('@me', dm.id), oncontextmenu: (e) => userMenu(e, p.id) },
          avatar(user(p.id), 32, { ring: 'var(--bg-sec)' }), h('span.name', user(p.id).display_name), un > 0 && h('span.pill', un));
      }));
  } else {
    const g = guild(S.view.gid);
    head = h('div#side-head' + (g.banner ? '.banner' : ''), { style: g.banner ? { backgroundImage: `linear-gradient(transparent 40%, rgba(0,0,0,.65)), url("${g.banner}")` } : (g.accent ? { borderBottom: `3px solid ${g.accent}` } : null), onclick: (e) => guildMenu({ preventDefault() { }, clientX: e.clientX, clientY: e.clientY + 10 }, g) }, h('span', g.name), icon('caret'));
    const cats = g.channels.filter(c => c.type === 4), kids = (pid) => g.channels.filter(c => c.type !== 4 && (c.parent_id || null) === pid);
    const chRow = (c) => {
      const vs = c.type === 2 ? [...S.voice.values()].filter(v => v.channel_id === c.id) : [];
      return h('div', h('div.ch' + (S.view.cid === c.id ? '.active' : '') + (S.unread[c.id] && c.type === 0 ? '.unread' : ''),
        { onclick: () => { go(g.id, c.id); }, oncontextmenu: (e) => channelMenu(e, g, c) },
        chIcon(c), h('span.name', c.name), vs.length > 0 && callTimer(vs), S.mentions[c.id] > 0 && h('span.pill', S.mentions[c.id]),
        can(g.id, PERM.MANAGE_CHANNELS) && h('span.actions', { onclick: (e) => { e.stopPropagation(); channelSettings(g, c); } }, icon('gear', 16))),
        vs.length > 0 && h('div.vusers', vs.map(v => vuserRow(g, v))));
    };
    const catRow = (c) => h('div', h('div.cat' + (S.collapsed.has(c.id) ? '.collapsed' : ''), { onclick: () => { S.collapsed.has(c.id) ? S.collapsed.delete(c.id) : S.collapsed.add(c.id); localStorage.setItem('lc_collapsed', JSON.stringify([...S.collapsed])); renderSide(); }, oncontextmenu: (e) => channelMenu(e, g, c) },
      h('span', { style: { display: 'flex', alignItems: 'center' } }, icon('caret', 12), c.name),
      can(g.id, PERM.MANAGE_CHANNELS) && h('span.add', { title: 'Criar canal', onclick: (e) => { e.stopPropagation(); channelModal(g, 0, c.id); } }, icon('plus', 16))),
      !S.collapsed.has(c.id) && kids(c.id).map(chRow),
      S.collapsed.has(c.id) && kids(c.id).filter(k => k.id === S.view.cid || S.unread[k.id]).map(chRow));
    list = h('div#side-list', kids(null).map(chRow), cats.map(catRow));
  }
  side.replaceChildren(head, list, voicePanel(), userbar());
  list.scrollTop = keepScroll;
}
const lastActivity = (dm) => { const l = S.messages.get(dm.id); return l?.length ? l[l.length - 1].id : dm.id; };
function vuserRow(g, v) {
  const u = user(v.user_id);
  return h('div.vuser', { 'data-uid': v.user_id, oncontextmenu: (e) => userMenu(e, v.user_id, g.id), onclick: (e) => profile(e.currentTarget, v.user_id, g.id) },
    (() => { const a = avatar(u, 24, { status: false }); if (voice?.speaking.has(v.user_id)) a.classList.add('speaking'); a.dataset.uid = v.user_id; return a; })(),
    h('span.nm', nameOf(v.user_id, g.id)), v.screen && h('span.live', 'Ao vivo'),
    h('span.ico', v.video && icon('video', 14), v.mute && icon('micoff', 14), v.deaf && icon('headoff', 14)));
}
function channelMenu(e, g, c) {
  menu(e, [
    c.type === 2 && { label: 'Entrar no canal de voz', fn: () => { go(g.id, c.id); joinVoice(c.id); } },
    S.unread[c.id] && { label: 'Marcar como lido', fn: () => ack(c.id) },
    c.type !== 4 && { label: notifPolicy(c).muted && (S.prefs.notifyCfg?.channels || {})[c.id] ? 'Reativar canal' : 'Silenciar canal', fn: () => { const n = (S.prefs.notifyCfg ||= {}); const ch = (n.channels ||= {}); ch[c.id] ? delete ch[c.id] : (ch[c.id] = true); savePrefs(); renderSide(); } },
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
    h('div.t', h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, icon('voice', 16), 'Voz conectada', pingEl()),
      h('span.vp-btns', h('button.ibtn', { title: 'Soundboard', onclick: (e) => openSoundboard(e.currentTarget, voice, { openSettings: (k) => openSettings(k, ctxSettings()) }) }, icon('waves', 20)),
        h('button.ibtn', { title: 'Desconectar', onclick: () => voice.leave() }, icon('phoneoff', 20)))),
    h('div.sub', `${ch?.type === 1 ? 'Chamada com ' + user(dmPeer(ch).id).display_name : (ch?.name || '')}${g ? ' / ' + g.name : ''}`),
    h('div.row',
      h('button' + (voice.cam ? '.on' : ''), { title: 'Câmera', onclick: () => voiceAct(() => voice.toggleCam()) }, icon('video', 20)),
      h('button' + (voice.screen ? '.on' : ''), { title: 'Transmitir tela', onclick: startShare }, icon('screen', 20)),
      h('button', { title: 'Configurações de voz', onclick: () => openSettings('voice', ctxSettings()) }, icon('sliders', 20)),
      h('button', { title: 'Ir para a sala', onclick: () => ch && (ch.type === 1 ? go('@me', ch.id) : go(ch.guild_id, ch.id)) }, icon('expand', 20))));
}
const voiceAct = (fn) => Promise.resolve().then(fn).catch(e => toast(e.message, true));
function joinVoice(cid) {
  if (voice.channelId === cid) return;
  voice.join(cid).then(() => { if (voice.error) { toast(voice.error, true); voice.error = null; } });
}
function userbar() {
  const me = S.me, ctx = () => ({ voice, logout, go });
  return h('div#userbar',
    h('div.me', { onclick: (e) => openStatusPanel(e.currentTarget, { openSettings: (k) => openSettings(k, ctx()), openProfile: () => profile($('#userbar .me'), me.id, S.view.gid) }), oncontextmenu: (e) => statusMenu(e), title: 'Status e perfil' }, avatar(me, 32, { ring: 'var(--bg-user)' }),
      h('div.names', h('div.dn', me.display_name), h('div.un', me.custom_status || STATUS_TXT[me.status]))),
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
    ...[...S.guilds.values()].flatMap(g => g.channels.filter(c => c.type !== 4).map(c => ({ label: `${c.type === 2 ? '🔊' : '#'} ${c.name}`, hint: g.name, fn: () => go(g.id, c.id) }))),
    ...[...S.guilds.values()].map(g => ({ label: g.name, hint: 'servidor', fn: () => go(g.id) }))];
  const m = modal('Busca rápida', '', h('div', h('label.f', inp), res), [], {});
  const draw = () => { res.replaceChildren(...items.filter(i => i.label.toLowerCase().includes(inp.value.toLowerCase())).slice(0, 10).map(i => h('div.role-row', { onclick: () => { m.close(); i.fn(); } }, i.label, h('small', { style: { marginLeft: 'auto', color: 'var(--text-muted)' } }, i.hint || '')))); };
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
  const node = profileCard(u, { nickname: m?.nickname, roles, extra });
  popout(anchor, node, anchor.closest('#members') || anchor.closest('.msg') ? 'left' : 'right');
}
async function openDM(uid) {
  const dm = await tryApi('POST', '/dms', { user_id: uid }); if (!dm) return;
  S.dms.set(dm.id, dm); closeFloating(); go('@me', dm.id);
}
function userMenu(e, uid, gid) {
  if (uid === S.me.id) return menu(e, [{ label: 'Perfil', fn: () => profile(e.target, uid, gid) }, S.prefs.devMode && { label: 'Copiar ID do usuário', fn: () => navigator.clipboard?.writeText(uid) }]);
  const g = gid && gid !== '@me' ? guild(gid) : null, rt = relType(uid);
  menu(e, [
    { label: 'Perfil', fn: () => profile(e.target, uid, gid) },
    { label: 'Enviar mensagem', fn: () => openDM(uid) },
    rt === 0 && { label: 'Adicionar amigo', fn: () => tryApi('POST', '/relationships', { username: user(uid).username }).then(r => r && toast('Pedido enviado')) },
    rt === 1 && { label: 'Remover amigo', danger: true, fn: () => tryApi('DELETE', `/relationships/${uid}`) },
    rt !== 2 ? { label: 'Bloquear', danger: true, fn: () => tryApi('PUT', `/relationships/${uid}`, { type: 2 }) } : { label: 'Desbloquear', fn: () => tryApi('DELETE', `/relationships/${uid}`) },
    voice?.peers.has(uid) && '-',
    voice?.peers.has(uid) && { label: `Volume do usuário (${voice.volumes[uid] ?? 100}%)`, fn: async () => { const v = await promptBox('Volume do usuário', 'Volume (0-200)', String(voice.volumes[uid] ?? 100), 'Definir'); if (v != null) voice.setVolume(uid, Math.max(0, Math.min(200, +v || 100))); } },
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
  const inCall = dm && callActive(ch.id);
  main.replaceChildren(
    h('div#topbar',
      h('button.ibtn.menu-btn', { onclick: () => $('#app').classList.toggle('nav-open'), style: { display: innerWidth <= 640 ? 'flex' : 'none' } }, icon('more')),
      dm ? [h('span.hash', '@'), h('span', user(peer.id).display_name), h('div.status.s-' + user(peer.id).status, { style: { position: 'static', borderColor: 'transparent', width: '10px', height: '10px', minWidth: 0, minHeight: 0 } })]
        : [h('span.hash', icon(vc ? 'voice' : 'hash', 24)), h('span', ch.name), ch.topic && h('span.topic', ch.topic)],
      h('div.spacer'),
      dm && h('button.ibtn', { title: voice.channelId === ch.id ? 'Desligar' : 'Iniciar chamada de voz', onclick: () => voice.channelId === ch.id ? voice.leave() : joinVoice(ch.id) }, icon(voice.channelId === ch.id ? 'phoneoff' : 'phone')),
      h('button.ibtn', { title: 'Mensagens fixadas', onclick: showPins }, icon('pin')),
      h('button.ibtn.inbox-btn', { title: 'Caixa de entrada (menções e respostas)', onclick: showInbox }, icon('bell'), inboxBadge()),
      !dm && h('button.ibtn' + (S.membersOpen ? '.sel' : ''), { title: 'Lista de membros', onclick: () => { S.membersOpen = !S.membersOpen; renderMain(); } }, icon('users')),
      search),
    h('div#content',
      vc && h('div#stage'),
      h('div#chat' + (vc ? '.side' : ''), inCall && h('div#stage.dmstage'), h('div#msgs'), h('div#typing'), composer(ch, dm ? '@' + user(peer.id).display_name : (vc ? 'chat de ' : '#') + ch.name)),
      !dm && !vc && S.membersOpen && h('div#members')));
  stickToBottom($('#msgs'));
  renderMembers(); loadChannel(ch.id); if (vc || inCall) renderVoiceUI();
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
  return h('div.welcome', h('div.big', icon('hash', 40)), h('h1', `Bem-vindo(a) a #${ch.name}!`), h('p', 'Este é o começo do canal.'));
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
  box.append(msgEl(m, prev && sameDay(prev.created_at, m.created_at) ? prev : null));
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
    m.reply.deleted ? h('i', 'A mensagem original foi excluída') : [avatar(user(m.reply.author.id), 16, { status: false }), h('span.rn', '@' + nameOf(m.reply.author.id, gid)), h('span.rt', m.reply.content || 'Clique para ver o anexo')]));
  if (!grouped) el.append(h('div.head', h('span.author', { style: col ? { color: col } : null, onclick: (e) => profile(e.currentTarget, m.author_id, gid), oncontextmenu: (e) => { e.stopPropagation(); userMenu(e, m.author_id, gid); } }, nameOf(m.author_id, gid)), h('span.ts', stamp(m.created_at)), m.pinned && h('span.pin', icon('pin', 12))));
  if (S.editing === m.id) {
    const ta = h('textarea', { value: m.content, rows: 1, onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m, ta.value); } if (e.key === 'Escape') { S.editing = null; renderMessages(true); } } });
    el.append(h('div.edit-box', ta, h('div.edit-hint', 'esc para ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); S.editing = null; renderMessages(true); } }, 'cancelar'), ' • enter para ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); saveEdit(m, ta.value); } }, 'salvar'))));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  } else if (m.content) {
    const body = h('div.body');
    body.innerHTML = md(m.content, ctxFor(gid));
    if (onlyEmoji(m.content.replace(/<:\w+:\d+>/g, '😀'))) body.classList.add('emoji-big');
    if (m.edited_at) body.append(h('span.edited', '(editado)'));
    if (S.prefs.embedLinks !== false) for (const url of (m.content.match(/https?:\/\/\S+/g) || []).filter(isImageUrl).slice(0, 3)) body.append(h('div.attach', h('img', { src: url, loading: 'lazy', referrerPolicy: 'no-referrer', onclick: () => lightbox(url) })));
    body.querySelectorAll('.spoiler').forEach(s => (s.onclick = () => s.classList.add('shown')));
    body.querySelectorAll('.mention[data-uid]').forEach(s => (s.onclick = () => profile(s, s.dataset.uid, gid)));
    el.append(body);
  }
  appendAttachments(el, m, mine || (gid && can(gid, PERM.MANAGE_MESSAGES)));
  if (m.reactions?.length) el.append(h('div.reactions', m.reactions.map(r => h('div.react' + (r.users.includes(S.me.id) ? '.me' : ''), { title: r.users.map(u => nameOf(u, gid)).join(', '), onclick: () => react(m, r.emoji, !r.users.includes(S.me.id)) }, reactionFace(r.emoji), h('span', r.users.length)))));
  el.append(h('div.toolbar',
    h('button', { title: 'Reagir', onclick: (e) => emojiPicker(e.currentTarget, (em) => react(m, em, true)) }, icon('smile', 18)),
    h('button', { title: 'Responder', onclick: () => setReply(m) }, icon('reply', 18)),
    mine && h('button', { title: 'Editar', onclick: () => { S.editing = m.id; renderMessages(true); } }, icon('edit', 18)),
    h('button', { title: 'Mais', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); msgMenu({ preventDefault() { }, clientX: r.left, clientY: r.bottom }, m); } }, icon('more', 18))));
  return el;
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
    h('div.mtile', h('img', { src: f.url, alt: f.name, loading: 'lazy', onclick: () => lightbox(f.url) }), del(f, i)))));
  for (const { f, i } of atts.filter(a => !isImg(a.f))) { const a = attachEl(f); a.classList.add('mtile'); const d = del(f, i); if (d) a.append(d); el.append(a); }
}
function attachEl(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase(), url = f.url;
  if (isImg(f)) return h('div.attach', h('img', { src: url, alt: f.name, loading: 'lazy', onclick: () => lightbox(url) }));
  if (/^(mp4|webm)$/.test(ext)) return h('div.attach', h('video', { src: url, controls: true, preload: 'metadata' }));
  if (/^(mp3|ogg|wav|m4a)$/.test(ext)) return h('div.attach', h('audio', { src: url, controls: true, preload: 'none' }));
  return h('div.file', icon('file', 32), h('div', h('a.fn', { href: url + '?download=1', download: f.name }, f.name), h('div.fs', bytes(f.size))), h('a.ibtn', { href: url + '?download=1', download: f.name, style: { marginLeft: 'auto' } }, icon('dl')));
}
function msgMenu(e, m) {
  const ch = channelById(m.channel_id), gid = ch.guild_id, mine = m.author_id === S.me.id, mod = gid && can(gid, PERM.MANAGE_MESSAGES) || (!gid && false);
  menu(e, [
    { label: 'Adicionar reação', fn: () => emojiPicker(document.querySelector(`[data-mid="${m.id}"]`) || document.body, (em) => react(m, em, true)) },
    { label: 'Responder', fn: () => setReply(m) },
    m.content && { label: 'Copiar texto', fn: () => navigator.clipboard?.writeText(m.content) },
    mine && { label: 'Editar mensagem', fn: () => { S.editing = m.id; renderMessages(true); } },
    (mod || !gid) && { label: m.pinned ? 'Desafixar mensagem' : 'Fixar mensagem', fn: () => tryApi(m.pinned ? 'DELETE' : 'PUT', `/channels/${m.channel_id}/pins/${m.id}`) },
    S.prefs.devMode && { label: 'Copiar ID da mensagem', fn: () => navigator.clipboard?.writeText(m.id) },
    (mine || mod) && '-',
    (mine || mod) && { label: 'Apagar mensagem', danger: true, fn: async () => { if (await confirmBox('Apagar mensagem', 'Tem certeza?', 'Apagar')) tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}`); } },
  ]);
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
async function showPins() {
  const list = await tryApi('GET', `/channels/${S.view.cid}/pins`); if (!list) return;
  showResults('Mensagens fixadas', list);
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
async function showInbox() {
  closeResults();
  const box = h('div'), more = h('button.btn.grey', { style: { width: '100%', marginTop: '4px', display: 'none' } }, 'Carregar mais');
  const panel = h('div#results.inbox', h('div.rh', 'Caixa de entrada', h('button.ibtn', { style: { width: '20px', height: '20px' }, onclick: closeResults }, icon('x', 14))), box, more);
  $('#content')?.append(panel);
  const load = async (before) => {
    const list = await tryApi('GET', '/inbox' + (before ? '?before=' + before : '')); if (!list) return;
    for (const m of list) {
      const ch = channelById(m.channel_id), g = guild(m.guild_id);
      const where = g ? `#${m.channel_name} • ${g.name}` : 'Mensagem direta';
      const e = msgEl(m, null); e.querySelector('.toolbar')?.remove();
      box.append(h('div.ibx' + (m.unread ? '.unread' : ''), { onclick: () => { closeResults(); if (S.view.cid !== m.channel_id) { go(ch?.guild_id || '@me', m.channel_id); setTimeout(() => jumpTo(m.id), 600); } else jumpTo(m.id); } },
        h('div.ibh', h('b', nameOf(m.author_id, m.guild_id)), ' ' + (KIND_TXT[m.kind] || ''), h('span', where)), e));
    }
    if (!box.children.length) box.append(h('div.empty', { style: { marginTop: '20px' } }, 'Nada por aqui. Menções e respostas a você aparecem nesta caixa.'));
    more.style.display = list.length === 30 ? '' : 'none';
    more.onclick = () => load(list.at(-1).id);
  };
  load();
}
function closeResults() { $('#results')?.remove(); }
function showResults(title, list) {
  closeResults();
  const panel = h('div#results', h('div.rh', title, h('button.ibtn', { style: { width: '20px', height: '20px' }, onclick: closeResults }, icon('x', 14))),
    list.length ? list.map(m => { const e = msgEl(m, null); e.querySelector('.toolbar')?.remove(); e.onclick = () => { const ch = channelById(m.channel_id); closeResults(); if (S.view.cid !== m.channel_id) { go(ch.guild_id || '@me', m.channel_id); setTimeout(() => jumpTo(m.id), 600); } else jumpTo(m.id); }; return e; }) : h('div.empty', { style: { marginTop: '20px' } }, 'Nada encontrado.'));
  $('#content')?.append(panel);
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
    h('div#composer', h('button.ibtn', { title: 'Anexar arquivo', onclick: () => fileIn.click() }, icon('plus', 24)), fileIn, ta,
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
  const content = ta.value; const atts = S.pending.filter(p => p.state === 'ok');
  if (S.pending.some(p => p.state === 'up')) return toast('Aguarde o envio dos anexos…');
  if (!content.trim() && !atts.length) return;
  ta.value = ''; $('.ac')?.remove();
  const body = { content, reply_to: S.replyTo?.id, attachments: atts.map(({ url, name, size, type }) => ({ url, name, size, type })) };
  S.replyTo = null; S.pending = []; renderReplyBar(); renderPendingPrev();
  try { await api('POST', `/channels/${ch.id}/messages`, body); } catch (e) { toast(e.message, true); ta.value = content; }
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
    e.preventDefault?.(); const start = ta.selectionStart - m[1].length - 1, ins = u.id === 'everyone' ? '@everyone ' : `<@${u.id}> `;
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
    h('div', { style: { minWidth: 0 } }, h('div.mn', { style: { color: roleColor(g.id, u.id) || (offline ? '' : 'var(--header)') } }, m.nickname || u.display_name, g.owner_id === u.id && h('span.crown', { title: 'Dono do servidor', style: { marginLeft: '4px' } }, icon('crown', 12))), u.custom_status && h('div.cs', u.custom_status)));
  const by = (a, b) => (a.m.nickname || a.u.display_name).localeCompare(b.m.nickname || b.u.display_name);
  box.replaceChildren(
    ...order.flatMap(([k, name]) => groups.has(k) ? [h('div.mgroup', `${name} — ${groups.get(k).length}`), ...groups.get(k).sort(by).map(x => row(x))] : []),
    ...(off.length ? [h('div.mgroup', `Offline — ${off.length}`)] : []), ...off.sort(by).map(x => row(x, true)));
}

// =============== Início / amigos ===============
function renderHome(main) {
  const tab = S.view.tab, rels = [...S.rels.values()];
  const tabs = [['online', 'Online'], ['all', 'Todos'], ['pending', 'Pendentes'], ['blocked', 'Bloqueados']];
  const q = h('input.fsearch', { placeholder: 'Buscar', oninput: () => draw() });
  const pane = h('div.pane');
  const draw = () => {
    pane.replaceChildren();
    if (tab === 'add') {
      const inp = h('input', { placeholder: 'Digite o nome de usuário exato', onkeydown: (e) => e.key === 'Enter' && send() }), msg = h('div', { style: { marginTop: '8px', fontSize: '14px' } });
      const send = async () => { try { await api('POST', '/relationships', { username: inp.value }); msg.style.color = 'var(--green)'; msg.textContent = `Pedido de amizade enviado para ${inp.value}.`; inp.value = ''; } catch (e) { msg.style.color = 'var(--red)'; msg.textContent = e.message; } };
      return pane.append(h('h2', { style: { margin: '0 0 4px', color: 'var(--header)', fontSize: '16px' } }, 'Adicionar amigo'), h('p', { style: { color: 'var(--text-muted)', margin: '0 0 16px' } }, 'Você pode adicionar amigos pelo nome de usuário.'), h('div.addf', inp, h('button.btn', { onclick: send }, 'Enviar pedido')), msg);
    }
    let list = rels.filter(r => tab === 'online' ? r.type === 1 && S.users.get(r.user.id).status !== 'offline' : tab === 'all' ? r.type === 1 : tab === 'pending' ? r.type === 3 || r.type === 4 : r.type === 2);
    list = list.filter(r => r.user.username.toLowerCase().includes(q.value.toLowerCase()) || r.user.display_name.toLowerCase().includes(q.value.toLowerCase()));
    pane.append(q, h('div.fh', `${{ online: 'Online', all: 'Todos os amigos', pending: 'Pendentes', blocked: 'Bloqueados' }[tab]} — ${list.length}`));
    if (!list.length) return pane.append(h('div.empty', { style: { marginTop: '60px' } }, h('div', { style: { fontSize: '48px' } }, '🌙'), h('p', tab === 'pending' ? 'Nenhum pedido pendente.' : tab === 'blocked' ? 'Você não bloqueou ninguém.' : 'Ninguém por aqui ainda. Que tal adicionar um amigo?')));
    for (const r of list) {
      const u = S.users.get(r.user.id) || r.user;
      const btn = (ic, title, fn, cls = '') => h('button.circle' + cls, { title, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ic, 20));
      pane.append(h('div.frow', { onclick: () => openDM(u.id), oncontextmenu: (e) => userMenu(e, u.id) }, avatar(u, 36, { ring: 'var(--bg-pri)' }),
        h('div.fn', h('b', u.display_name), h('small', r.type === 3 ? 'Pedido de amizade recebido' : r.type === 4 ? 'Pedido de amizade enviado' : r.type === 2 ? 'Bloqueado' : (u.custom_status || STATUS_TXT[u.status]))),
        r.type === 1 && btn('dm', 'Mensagem', () => openDM(u.id)),
        r.type === 3 && btn('check', 'Aceitar', () => tryApi('PUT', `/relationships/${u.id}`, {}), '.ok'),
        (r.type === 3 || r.type === 4 || r.type === 2 || r.type === 1) && btn('x', r.type === 1 ? 'Remover' : r.type === 2 ? 'Desbloquear' : 'Ignorar', () => tryApi('DELETE', `/relationships/${u.id}`), '.no')));
    }
  };
  const pendingN = rels.filter(r => r.type === 3).length;
  main.replaceChildren(h('div#home',
    h('div#topbar', h('button.ibtn.menu-btn', { onclick: () => $('#app').classList.toggle('nav-open'), style: { display: innerWidth <= 640 ? 'flex' : 'none' } }, icon('more')), icon('users', 24), h('span', 'Amigos'), h('div', { style: { width: '1px', height: '24px', background: 'var(--divider)', margin: '0 8px' } }),
      h('div.tabs', tabs.map(([k, l]) => h('div.tab' + (tab === k ? '.active' : ''), { onclick: () => { S.view.tab = k; renderHome(main); } }, l, k === 'pending' && pendingN > 0 && h('span.pill', { style: { marginLeft: '6px', background: 'var(--red)', color: '#fff', borderRadius: '8px', padding: '0 5px', fontSize: '12px' } }, pendingN))),
        h('div.tab.green' + (tab === 'add' ? '.active' : ''), { onclick: () => { S.view.tab = 'add'; renderHome(main); } }, 'Adicionar amigo'))),
    pane));
  draw();
}

// =============== Voz: palco ===============
const vidCache = new Map(); // reaproveita <video> para não piscar a cada atualização
function videoFor(key, stream, muted = true) {
  let v = vidCache.get(key);
  if (!v || v.srcObject !== stream) { v = h('video', { autoplay: true, playsInline: true, muted }); v.srcObject = stream; vidCache.set(key, v); v.play?.().catch(() => { }); }
  return v;
}
function renderVoiceUI(speakOnly) {
  if (speakOnly) {
    document.querySelectorAll('.tile[data-uid],.avatar[data-uid]').forEach(e => e.classList.toggle('speaking', voice.speaking.has(e.dataset.uid)));
    document.getElementById('vp-ping') && updatePing();
    return;
  }
  renderSide();
  const stage = $('#stage'); if (!stage) return;
  const ch = channelById(S.view.cid); if (!ch || ![1, 2].includes(ch.type)) return;
  const dm = ch.type === 1, gid = ch.guild_id;
  const members = [...S.voice.values()].filter(v => v.channel_id === ch.id);
  const inRoom = voice.channelId === ch.id;
  const tiles = [], live = new Set();
  const nm = (uid) => dm ? user(uid).display_name : nameOf(uid, gid);
  for (const v of members) {
    const uid = v.user_id, mine = uid === S.me.id, p = voice.peers.get(uid);
    const cam = mine ? voice.cam : p?.streams.cam, scr = mine ? voice.screen : p?.streams.screen;
    if (scr && v.screen) {
      const key = 's:' + uid; live.add(key);
      const vid = videoFor(key, scr), info = h('span.sinfo');
      const upd = () => (info.textContent = vid.videoWidth ? `${vid.videoWidth}×${vid.videoHeight}` : '');
      vid.onresize = vid.onloadedmetadata = upd; upd();
      const vol = !mine && h('input', { type: 'range', min: 0, max: 100, value: voice.streamVolumes[uid] ?? 100, title: 'Volume da transmissão', onclick: (e) => e.stopPropagation(), oninput: (e) => voice.setStreamVolume(uid, +e.target.value) });
      tiles.push(h('div.tile.screen' + (S.focus === key ? '.focus' : ''), { 'data-key': key, onclick: () => { S.focus = S.focus === key ? null : key; renderVoiceUI(); } }, vid,
        h('div.label', icon('screen', 14), `${nm(uid)} — tela`, info), h('div.tctl', vol, h('button.ibtn', { title: 'Tela cheia', onclick: (e) => { e.stopPropagation(); vid.requestFullscreen?.(); } }, icon('expand', 18)))));
    }
    const ckey = 'c:' + uid;
    if (cam && v.video) live.add(ckey);
    tiles.push(h('div.tile' + (voice.speaking.has(uid) ? '.speaking' : ''), { 'data-uid': uid, 'data-key': ckey, oncontextmenu: (e) => userMenu(e, uid, gid), onclick: () => { if (cam && v.video) { S.focus = S.focus === ckey ? null : ckey; renderVoiceUI(); } } },
      cam && v.video ? videoFor(ckey, cam) : avatar(user(uid), dm ? 110 : 96, { status: false }),
      h('div.label', v.mute && icon('micoff', 14), v.deaf && icon('headoff', 14), nm(uid))));
  }
  for (const k of [...vidCache.keys()]) if (!live.has(k)) vidCache.delete(k);
  const hasFocus = tiles.some(t => t.dataset.key === S.focus);
  const focusTile = hasFocus ? tiles.find(t => t.dataset.key === S.focus) : tiles.find(t => t.classList.contains('screen'));
  const btn = (ic, title, on, fn, cls = '') => h('button.roundbtn' + (on ? '.off' : '') + cls, { title, onclick: fn, oncontextmenu: cls === '.mic' ? noiseMenu : null }, icon(ic, 24));
  const bar = h('div.bar', inRoom ? [
    btn(voice.muted ? 'micoff' : 'mic', voice.muted ? 'Ativar microfone (clique direito: redução de ruído)' : 'Silenciar (clique direito: redução de ruído)', voice.muted, () => voiceToggle('mute'), '.mic'),
    btn(voice.deafened ? 'headoff' : 'headset', 'Ensurdecer', voice.deafened, () => voiceToggle('deaf')),
    btn('video', 'Câmera', !!voice.cam, () => voiceAct(() => voice.toggleCam())),
    btn('screen', voice.screen ? 'Parar transmissão' : 'Transmitir tela', !!voice.screen, startShare),
    btn('waves', 'Soundboard', false, (e) => openSoundboard(e.currentTarget, voice, { openSettings: (k) => openSettings(k, ctxSettings()) })),
    btn('sliders', 'Configurações de voz', false, () => openSettings('voice', ctxSettings())),
    btn('phoneoff', 'Desconectar', false, () => voice.leave(), '.red'),
  ] : h('button.btn.green', { style: { minWidth: '220px', minHeight: '46px', fontSize: '16px' }, onclick: () => joinVoice(ch.id) }, dm ? 'Atender / entrar na chamada' : 'Entrar na sala de voz'));
  const rest = focusTile ? tiles.filter(t => t !== focusTile) : tiles;
  stage.replaceChildren(...[
    tiles.length ? (focusTile ? [h('div.spot', focusTile), h('div.strip', rest)] : h('div.grid', tiles)) : h('div.grid', h('div.empty', { style: { color: '#fff' } }, h('h2', dm ? 'Chamada' : ch.name), h('p', dm ? 'Ninguém está na chamada.' : 'Ninguém está nesta sala de voz ainda.'))),
    voice.error && inRoom && h('div.verr', voice.error),
    bar].flat().filter(Boolean));
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
      h('img', { src: s.thumbnail }), h('div.sn', s.appIcon ? h('img.si', { src: s.appIcon }) : null, h('span', s.name)))) : [h('div.empty', { style: { gridColumn: '1/-1', margin: '24px' } }, 'Nada encontrado.')]));
  };
  const refresh = async () => { try { list = await desktop.getSources(); loaded = true; if (src && !list.some(s => s.id === src.id)) src = null; if (!src) src = list.find(s => s.type === tab) || list[0] || null; drawSources(); } catch { } };
  const body = h('div', desktop && [h('label.f', 'O que compartilhar'), tabs, grid], qualityPanel(o),
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
  const settings = h('div.qinfo'), updInfo = () => { const st = voice.screen?.getVideoTracks()[0]?.getSettings?.() || {}; settings.textContent = `Saindo agora: ${st.width || '?'}×${st.height || '?'} a ${Math.round(st.frameRate || 0) || '?'} fps — ${qualityLabel(o)}`; };
  updInfo(); const iv = setInterval(() => { if (!document.body.contains(settings)) return clearInterval(iv); updInfo(); }, 1000);
  const body = h('div', settings, qualityPanel(o, async (n) => { await voice.changeScreenQuality(n); S.prefs.screen = { ...S.prefs.screen, res: n.res, fps: n.fps, hint: n.hint }; savePrefs(); setTimeout(updInfo, 400); }),
    h('div', { style: { fontSize: '14px', color: 'var(--text-muted)' } }, `${[...S.voice.values()].filter(v => v.channel_id === voice.channelId).length - 1} pessoa(s) na sala podem assistir.`));
  modal('Transmissão ao vivo', 'Mudanças valem imediatamente.', body, [
    { label: 'Parar transmissão', cls: 'red', fn: () => voice.toggleScreen() },
    desktop && { label: 'Trocar o que compartilho', cls: 'grey', fn: async () => { const keep = { ...voice.screenOpts }; await voice.toggleScreen(); setTimeout(startShare, 150); void keep; } },
    { label: 'Fechar', cls: 'link' }].filter(Boolean), { width: '560px' });
}

// latência até o servidor (SFU) ou pior par (malha): Wi-Fi colorido + ms
let lastPing = null;
const pingEl = () => { const el = h('span#vp-ping.ping', icon('wifi', 14), h('span')); paintPing(el); return el; };
function paintPing(el) {
  const p = lastPing;
  el.className = 'ping ' + (p == null ? '' : p < 80 ? 'good' : p < 200 ? 'mid' : 'bad');
  el.lastChild.textContent = p == null ? '' : `${p} ms`;
  el.title = p == null ? 'Medindo a conexão…' : `Latência até o servidor: ${p} ms`;
}
function updatePing() {
  if (!voice.active) { lastPing = null; return; }
  voice.ping().then(p => { lastPing = p; const el = document.getElementById('vp-ping'); if (el) paintPing(el); });
}
setInterval(() => voice?.active && updatePing(), 2000);

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
