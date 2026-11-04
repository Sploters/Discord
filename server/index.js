import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { db, all, get, run, newId, UPLOAD_DIR, DATA_DIR } from './db.js';
import { startSfu, sfuEnabled, sfuJoin, sfuLeave, sfuRequest, sfuAttachRtp, sfuAttachNative, sfuLoad } from './sfu.js';
import { getAdapter, listAdapters } from './integrations/index.js';
import { createActivityService } from './activity.js';
import { createCallInvites } from './callinvites.js';
import { createRemote } from './remote.js';
import { mountStatic } from './static.js';
import { mountGifs } from './gifs.js';
import { mountLfg } from './lfg.js';
import { translate, translateEnabled, engineName } from './translate.js';
import { initMusic, handle as musicHandle, onVoiceJoin as musicOnJoin, onVoiceLeave as musicOnLeave, stopAll as musicStopAll } from './music.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 100) * 1024 * 1024;
const OPEN_REGISTRATION = process.env.OPEN_REGISTRATION !== '0';
// avatares padrão (public/avatars): um é sorteado para cada conta nova
const DEFAULT_AVATARS = (() => { try { return fs.readdirSync(path.join(__dirname, '..', 'public', 'avatars')).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(f => '/avatars/' + f); } catch { return []; } })();
// quem usava um avatar padrão que foi removido ganha outro sorteado
if (DEFAULT_AVATARS.length) for (const u of all("SELECT id, avatar FROM users WHERE avatar LIKE '/avatars/%'"))
  if (!DEFAULT_AVATARS.includes(u.avatar)) run('UPDATE users SET avatar=? WHERE id=?', DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)], u.id);

const P = { ADMIN: 1, MANAGE_GUILD: 2, MANAGE_CHANNELS: 4, MANAGE_MESSAGES: 8, KICK: 16, CREATE_INVITE: 32, MANAGE_ROLES: 64, BAN: 128, MODERATE: 256 };
const COLORS = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#3ba55d', '#faa61a', '#9b59b6', '#1abc9c'];

// ---------- helpers ----------
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const conns = new Map(); // userId -> Set<ws>
// atividades compartilhadas da sala: lousa, editor de código e desenhos sobre as transmissões
const acts = new Map(); // channelId -> { wb: bool, code: {text, lang}|null, boards: { [board]: [{id, uid, color, w, pts}] } }
const actOf = (c) => { let a = acts.get(c); if (!a) acts.set(c, a = { wb: false, code: null, boards: {}, spot: null, spotBy: null }); return a; };
const roomSend = (c, type, d, except) => { for (const [id, st] of voice.get(c) || []) if (id !== except) send(st.ws, type, d); };
const actState = (c) => { const a = actOf(c); return { channel_id: c, wb: a.wb, code: a.code, boards: a.boards, spot: a.spot, spot_by: a.spotBy }; };
const BOARD_OK = (b) => b === 'wb' || /^s:[w-]{1,40}$/.test(b);
const voice = new Map(); // channelId -> Map<userId, {ws, mute, deaf, video, screen}>

const NAME_FONTS = ['default', 'serif', 'mono', 'rounded', 'script', 'display', 'comic', 'type'];
const NAME_EFFECTS = ['solid', 'gradient', 'neon', 'toon', 'pop', 'shimmer', 'rainbow'];
// estilo do nome vindo do cliente: só valores conhecidos e cores hex
const cleanNameStyle = (v) => {
  if (!v || typeof v !== 'object') return null;
  const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : d);
  const s = { font: NAME_FONTS.includes(v.font) ? v.font : 'default', effect: NAME_EFFECTS.includes(v.effect) ? v.effect : 'solid', c1: hex(v.c1, '#ffffff'), c2: hex(v.c2, hex(v.c1, '#ffffff')) };
  return s.font === 'default' && s.effect === 'solid' && !hex(v.c1) ? null : s;
};
const parseNameStyle = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
const cleanPos = (v) => (/^\d{1,3}(\.\d{1,2})?,\d{1,3}(\.\d{1,2})?,[1-3](\.\d{1,2})?$/.test(String(v)) ? String(v) : null);
const pubUser = (u) => u && ({
  id: u.id, username: u.username, display_name: u.display_name || u.username, avatar: u.avatar, color: u.color,
  banner_color: u.banner_color, banner: u.banner, avatar_pos: u.avatar_pos, banner_pos: u.banner_pos, pronouns: u.pronouns, status_emoji: u.status_emoji, theme_primary: u.theme_primary, theme_accent: u.theme_accent, name_style: parseNameStyle(u.name_style),
  bio: u.bio, custom_status: u.custom_status, created_at: u.created_at,
  status: (conns.has(u.id) || u.username?.startsWith('bot_music_')) ? (u.status === 'invisible' ? 'offline' : u.status) : 'offline',
});
const getUser = (id) => get('SELECT * FROM users WHERE id=?', id);
const userPub = (id) => pubUser(getUser(id));

function send(ws, type, d) { if (ws.readyState === 1) ws.send(JSON.stringify({ t: type, d })); }
function dispatch(userIds, type, d) {
  for (const id of new Set(userIds)) for (const ws of conns.get(id) || []) send(ws, type, d);
}
const guildMemberIds = (gid) => all('SELECT user_id FROM members WHERE guild_id=?', gid).map(r => r.user_id);
const channelAudience = (ch) => ch.guild_id ? guildMemberIds(ch.guild_id)
  : all('SELECT user_id FROM dm_participants WHERE channel_id=?', ch.id).map(r => r.user_id);

function memberPerms(gid, uid) {
  const g = get('SELECT owner_id FROM guilds WHERE id=?', gid);
  if (!g) return 0;
  if (g.owner_id === uid) return 0xffffff;
  if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid)) return 0;
  let p = 0;
  for (const r of all('SELECT r.perms FROM member_roles mr JOIN roles r ON r.id=mr.role_id WHERE mr.guild_id=? AND mr.user_id=?', gid, uid)) p |= r.perms;
  return (p & P.ADMIN) ? 0xffffff : p;
}
const can = (gid, uid, bit) => (memberPerms(gid, uid) & bit) !== 0;
// castigo: não fala, não reage, não entra em voz
const timedOut = (gid, uid) => !!gid && (get('SELECT timeout_until t FROM members WHERE guild_id=? AND user_id=?', gid, uid)?.t || 0) > Date.now();
function audit(gid, actor, action, target = null, details = '') {
  run('INSERT INTO audit_log(id,guild_id,actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?,?,?)', newId(), gid, actor, action, target, String(details).slice(0, 500), Date.now());
}
// limite de mensagens: rajada de 5, recarrega 1 a cada 0,8 s
const buckets = new Map();
function rateOk(uid) {
  const now = Date.now(), b = buckets.get(uid) || { n: 5, t: now };
  b.n = Math.min(5, b.n + (now - b.t) / 800); b.t = now;
  if (b.n < 1) { buckets.set(uid, b); return false; }
  b.n -= 1; buckets.set(uid, b); return true;
}
setInterval(() => { const old = Date.now() - 60000; for (const [k, b] of buckets) if (b.t < old) buckets.delete(k); }, 60000).unref();

function memberObj(gid, uid) {
  const m = get('SELECT * FROM members WHERE guild_id=? AND user_id=?', gid, uid);
  if (!m) return null;
  return { user_id: uid, nickname: m.nickname, joined_at: m.joined_at, timeout_until: m.timeout_until > Date.now() ? m.timeout_until : null,
    roles: all('SELECT role_id FROM member_roles WHERE guild_id=? AND user_id=?', gid, uid).map(r => r.role_id) };
}
const roomStart = new Map(); // channelId -> quando a sala deixou de estar vazia (cronômetro da chamada)
const VOICE_FX = new Set(['robo', 'grossa', 'esquilo', 'monstro', 'alien', 'radio', 'megafone', 'eco', 'estadio']);
const vsObj = (cid, uid, s) => ({ channel_id: cid, user_id: uid, mute: s.mute, deaf: s.deaf, video: s.video, screen: s.screen, fx: s.fx || null, started_at: roomStart.get(cid) });
function voiceStatesFor(gid) {
  const out = [];
  for (const [cid, m] of voice) {
    const ch = get('SELECT guild_id FROM channels WHERE id=?', cid);
    if (ch && ch.guild_id === gid) for (const [uid, s] of m) out.push(vsObj(cid, uid, s));
  }
  return out;
}
function guildFull(gid) {
  const g = get('SELECT * FROM guilds WHERE id=?', gid);
  if (!g) return null;
  const members = guildMemberIds(gid);
  return { ...g,
    roles: all('SELECT * FROM roles WHERE guild_id=? ORDER BY position DESC', gid),
    channels: all('SELECT * FROM channels WHERE guild_id=? ORDER BY position, created_at', gid),
    members: members.map(u => memberObj(gid, u)),
    emojis: all('SELECT id,name,url FROM emojis WHERE guild_id=?', gid),
    sounds: all('SELECT id,name,emoji,url,volume FROM sounds WHERE guild_id=? ORDER BY created_at', gid),
    users: members.map(userPub),
    voice_states: voiceStatesFor(gid) };
}

function messageObj(m) {
  const rx = {};
  for (const r of all('SELECT emoji,user_id FROM reactions WHERE message_id=?', m.id)) (rx[r.emoji] ||= []).push(r.user_id);
  const reply = m.reply_to ? get('SELECT id,content,author_id FROM messages WHERE id=?', m.reply_to) : null;
  return { id: m.id, channel_id: m.channel_id, author_id: m.author_id, author: userPub(m.author_id),
    content: m.content, type: m.type || 0, created_at: m.created_at, edited_at: m.edited_at, pinned: !!m.pinned,
    attachments: JSON.parse(m.attachments || '[]'),
    reply: reply ? { id: reply.id, content: (reply.content || '').slice(0, 120), author: userPub(reply.author_id) } : (m.reply_to ? { id: m.reply_to, deleted: true } : null),
    reactions: Object.entries(rx).map(([emoji, users]) => ({ emoji, users })),
    ...((m.content || '').startsWith('📊') ? { poll: pollObj(get('SELECT * FROM polls WHERE message_id=?', m.id)) } : {}) };
}
// enquete: opções com quem votou em cada uma; encerrada pelo autor/moderador ou pelo prazo
function pollObj(p) {
  if (!p) return undefined;
  const votes = all('SELECT user_id, option_id FROM poll_votes WHERE poll_id=? ORDER BY voted_at', p.id);
  const opts = JSON.parse(p.options).map(o => ({ ...o, voters: votes.filter(v => v.option_id === o.id).map(v => v.user_id) }));
  return { id: p.id, question: p.question, multi: !!p.multi, ends_at: p.ends_at, author_id: p.author_id,
    closed: !!p.closed_at || (p.ends_at && p.ends_at <= Date.now()), closed_at: p.closed_at || (p.ends_at && p.ends_at <= Date.now() ? p.ends_at : null),
    voters: new Set(votes.map(v => v.user_id)).size, options: opts };
}
function canAccessChannel(uid, ch) {
  if (!ch) return false;
  if (ch.guild_id) return !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', ch.guild_id, uid);
  return !!get('SELECT 1 x FROM dm_participants WHERE channel_id=? AND user_id=?', ch.id, uid);
}
const dmChannelObj = (ch) => ({ ...ch, recipients: all('SELECT user_id FROM dm_participants WHERE channel_id=?', ch.id).map(r => userPub(r.user_id)) });
const relObj = (uid) => all('SELECT * FROM relationships WHERE user_id=?', uid).map(r => ({ user: userPub(r.other_id), type: r.type }));

function sharedAudience(uid) {
  const ids = new Set([uid]);
  for (const r of all('SELECT m2.user_id FROM members m1 JOIN members m2 ON m1.guild_id=m2.guild_id WHERE m1.user_id=?', uid)) ids.add(r.user_id);
  for (const r of all('SELECT other_id FROM relationships WHERE user_id=?', uid)) ids.add(r.other_id);
  for (const r of all('SELECT p2.user_id FROM dm_participants p1 JOIN dm_participants p2 ON p1.channel_id=p2.channel_id WHERE p1.user_id=?', uid)) ids.add(r.user_id);
  return [...ids];
}
const broadcastPresence = (uid) => dispatch(sharedAudience(uid), 'USER_UPDATE', userPub(uid));

function createGuild(owner, name) {
  const gid = newId(), now = Date.now();
  run('INSERT INTO guilds(id,name,owner_id,created_at) VALUES(?,?,?,?)', gid, name, owner, now);
  run('INSERT INTO members(guild_id,user_id,joined_at) VALUES(?,?,?)', gid, owner, now);
  const cat1 = newId(), cat2 = newId();
  run('INSERT INTO channels(id,guild_id,type,name,position,created_at) VALUES(?,?,4,?,0,?)', cat1, gid, 'Canais de texto', now);
  run('INSERT INTO channels(id,guild_id,type,name,position,created_at) VALUES(?,?,4,?,10,?)', cat2, gid, 'Canais de voz', now);
  run('INSERT INTO channels(id,guild_id,type,name,position,parent_id,created_at) VALUES(?,?,0,?,1,?,?)', newId(), gid, 'geral', cat1, now);
  run('INSERT INTO channels(id,guild_id,type,name,position,parent_id,created_at) VALUES(?,?,2,?,11,?,?)', newId(), gid, 'Geral', cat2, now);
  return gid;
}

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const s = token && get('SELECT user_id FROM sessions WHERE token=?', token);
  if (!s) return res.status(401).json({ error: 'Não autenticado' });
  req.uid = s.user_id; req.token = token; next();
};
const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: 'Erro interno' }); } };
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const clean = (s, max) => String(s ?? '').trim().slice(0, max);

app.post('/api/register', wrap((req, res) => {
  if (!OPEN_REGISTRATION) return bad(res, 'Registro desativado', 403);
  const username = clean(req.body.username, 32), pw = String(req.body.password || '');
  if (!/^[\p{L}\p{N}_.-]{2,32}$/u.test(username)) return bad(res, 'Nome de usuário inválido (2-32 caracteres: letras, números, _ . -)');
  if (pw.length < 4) return bad(res, 'Senha muito curta (mínimo 4)');
  if (get('SELECT 1 x FROM users WHERE username=?', username) || /^bot_music_/i.test(username)) return bad(res, 'Esse nome de usuário já existe', 409);
  const id = newId(), salt = crypto.randomBytes(16).toString('hex');
  run('INSERT INTO users(id,username,display_name,pass_hash,salt,color,avatar,created_at) VALUES(?,?,?,?,?,?,?,?)',
    id, username, clean(req.body.display_name, 32) || username, hashPw(pw, salt), salt, COLORS[Math.floor(Math.random() * COLORS.length)],
    DEFAULT_AVATARS.length ? DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)] : null, Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token,user_id,created_at,agent) VALUES(?,?,?,?)', token, id, Date.now(), clean(req.headers['user-agent'], 200));
  res.json({ token });
}));
app.post('/api/login', wrap((req, res) => {
  const u = get('SELECT * FROM users WHERE username=?', clean(req.body.username, 32));
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(req.body.password || ''), u.salt)), Buffer.from(u.pass_hash));
  if (!ok) return bad(res, 'Usuário ou senha inválidos', 401);
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token,user_id,created_at,agent) VALUES(?,?,?,?)', token, u.id, Date.now(), clean(req.headers['user-agent'], 200));
  res.json({ token });
}));
app.post('/api/logout', auth, wrap((req, res) => { run('DELETE FROM sessions WHERE token=?', req.token); res.json({}); }));

app.patch('/api/me', auth, wrap((req, res) => {
  const b = req.body, u = getUser(req.uid);
  const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
  const f = {
    display_name: b.display_name !== undefined ? clean(b.display_name, 32) || u.username : u.display_name,
    bio: b.bio !== undefined ? clean(b.bio, 300) : u.bio,
    avatar: b.avatar !== undefined ? (b.avatar || null) : u.avatar,
    color: b.color !== undefined ? clean(b.color, 9) : u.color,
    banner_color: b.banner_color !== undefined ? clean(b.banner_color, 9) : u.banner_color,
    custom_status: b.custom_status !== undefined ? clean(b.custom_status, 100) : u.custom_status,
    status: ['online', 'idle', 'dnd', 'invisible'].includes(b.status) ? b.status : u.status,
    pronouns: b.pronouns !== undefined ? clean(b.pronouns, 40) : u.pronouns,
    banner: b.banner !== undefined ? (String(b.banner).startsWith('/files/') ? b.banner : null) : u.banner,
    avatar_pos: b.avatar_pos !== undefined ? cleanPos(b.avatar_pos) : u.avatar_pos,
    banner_pos: b.banner_pos !== undefined ? cleanPos(b.banner_pos) : u.banner_pos,
    status_emoji: b.status_emoji !== undefined ? clean(b.status_emoji, 16) : u.status_emoji,
    theme_primary: b.theme_primary !== undefined ? hex(b.theme_primary) : u.theme_primary,
    theme_accent: b.theme_accent !== undefined ? hex(b.theme_accent) : u.theme_accent,
    name_style: b.name_style !== undefined ? JSON.stringify(cleanNameStyle(b.name_style)) : u.name_style,
  };
  if (!f.theme_primary || !f.theme_accent) f.theme_primary = f.theme_accent = null; // tema só com as duas cores
  if (f.avatar && !String(f.avatar).startsWith('/files/') && !DEFAULT_AVATARS.includes(f.avatar)) f.avatar = u.avatar;
  run('UPDATE users SET display_name=?,bio=?,avatar=?,color=?,banner_color=?,custom_status=?,status=?,pronouns=?,banner=?,avatar_pos=?,banner_pos=?,status_emoji=?,theme_primary=?,theme_accent=?,name_style=? WHERE id=?',
    f.display_name, f.bio, f.avatar, f.color, f.banner_color, f.custom_status, f.status, f.pronouns, f.banner, f.avatar_pos, f.banner_pos, f.status_emoji, f.theme_primary, f.theme_accent, f.name_style, req.uid);
  broadcastPresence(req.uid);
  res.json(userPub(req.uid));
}));
app.post('/api/me/password', auth, wrap((req, res) => {
  const u = getUser(req.uid);
  if (hashPw(String(req.body.old || ''), u.salt) !== u.pass_hash) return bad(res, 'Senha atual incorreta', 403);
  if (String(req.body.new || '').length < 4) return bad(res, 'Senha nova muito curta');
  const salt = crypto.randomBytes(16).toString('hex');
  run('UPDATE users SET pass_hash=?,salt=? WHERE id=?', hashPw(req.body.new, salt), salt, req.uid);
  res.json({});
}));

// Conta: nome de usuário, configurações sincronizadas, sessões, exclusão
const sid = (token) => crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
app.post('/api/me/username', auth, wrap((req, res) => {
  const u = getUser(req.uid), name = clean(req.body.username, 32);
  if (hashPw(String(req.body.password || ''), u.salt) !== u.pass_hash) return bad(res, 'Senha incorreta', 403);
  if (!/^[\p{L}\p{N}_.-]{2,32}$/u.test(name)) return bad(res, 'Nome de usuário inválido (2-32 caracteres: letras, números, _ . -)');
  const other = get('SELECT id FROM users WHERE username=?', name);
  if (other && other.id !== u.id) return bad(res, 'Esse nome de usuário já existe', 409);
  run('UPDATE users SET username=? WHERE id=?', name, u.id);
  broadcastPresence(u.id); res.json(userPub(u.id));
}));
app.get('/api/me/settings', auth, wrap((req, res) => {
  const u = getUser(req.uid);
  res.json({ settings: u.settings ? JSON.parse(u.settings) : {}, friend_policy: u.friend_policy || 'all' });
}));
app.put('/api/me/settings', auth, wrap((req, res) => {
  if (req.body.settings !== undefined) {
    const s = JSON.stringify(req.body.settings || {}); if (s.length > 100000) return bad(res, 'Configurações muito grandes');
    run('UPDATE users SET settings=? WHERE id=?', s, req.uid);
  }
  if (['all', 'none'].includes(req.body.friend_policy)) run('UPDATE users SET friend_policy=? WHERE id=?', req.body.friend_policy, req.uid);
  res.json({});
}));
app.get('/api/sessions', auth, wrap((req, res) => {
  res.json(all('SELECT token,created_at,agent FROM sessions WHERE user_id=? ORDER BY created_at DESC', req.uid).map(s => ({ id: sid(s.token), created_at: s.created_at, agent: s.agent || '', current: s.token === req.token })));
}));
app.delete('/api/sessions/:id', auth, wrap((req, res) => {
  const s = all('SELECT token FROM sessions WHERE user_id=?', req.uid).find(x => sid(x.token) === req.params.id);
  if (!s) return bad(res, 'Sessão não encontrada', 404);
  run('DELETE FROM sessions WHERE token=?', s.token);
  for (const ws of conns.get(req.uid) || []) if (ws.token === s.token) ws.close(4001, 'sessão encerrada');
  res.json({});
}));
app.delete('/api/sessions', auth, wrap((req, res) => { // encerra todas as outras
  run('DELETE FROM sessions WHERE user_id=? AND token<>?', req.uid, req.token);
  for (const ws of conns.get(req.uid) || []) if (ws.token !== req.token) ws.close(4001, 'sessão encerrada');
  res.json({});
}));
app.post('/api/me/delete', auth, wrap((req, res) => {
  const u = getUser(req.uid);
  if (hashPw(String(req.body.password || ''), u.salt) !== u.pass_hash) return bad(res, 'Senha incorreta', 403);
  for (const g of all('SELECT id FROM guilds WHERE owner_id=?', u.id)) {
    const ids = guildMemberIds(g.id); run('DELETE FROM guilds WHERE id=?', g.id); dispatch(ids, 'GUILD_DELETE', { id: g.id });
  }
  for (const [cid, m] of voice) if (m.has(u.id)) leaveVoice(u.id, cid);
  const audience = sharedAudience(u.id);
  for (const gid of all('SELECT guild_id FROM members WHERE user_id=?', u.id).map(r => r.guild_id)) removeMember(gid, u.id, false);
  run('DELETE FROM messages WHERE author_id=?', u.id);
  for (const d of all('SELECT channel_id FROM dm_participants WHERE user_id=?', u.id)) run('DELETE FROM channels WHERE id=?', d.channel_id);
  run('DELETE FROM relationships WHERE user_id=? OR other_id=?', u.id, u.id);
  for (const ws of conns.get(u.id) || []) ws.close(4001, 'conta excluída');
  run('DELETE FROM users WHERE id=?', u.id);
  dispatch(audience.filter(x => x !== u.id), 'USER_DELETE', { id: u.id });
  res.json({});
}));

// Guilds
app.post('/api/guilds', auth, wrap((req, res) => {
  const name = clean(req.body.name, 100); if (!name) return bad(res, 'Nome obrigatório');
  const gid = createGuild(req.uid, name);
  dispatch([req.uid], 'GUILD_CREATE', guildFull(gid));
  res.json({ id: gid });
}));
app.patch('/api/guilds/:id', auth, wrap((req, res) => {
  const g = get('SELECT * FROM guilds WHERE id=?', req.params.id);
  if (!g || !can(g.id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
  if (req.body.owner_id !== undefined) { // transferir propriedade (só o dono atual)
    if (g.owner_id !== req.uid) return bad(res, 'Apenas o dono pode transferir o servidor', 403);
    if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', g.id, String(req.body.owner_id))) return bad(res, 'Membro inválido');
    run('UPDATE guilds SET owner_id=? WHERE id=?', String(req.body.owner_id), g.id);
  }
  const b = req.body, file = (v, old) => v === undefined ? old : (typeof v === 'string' && v.startsWith('/files/') ? v : null);
  run('UPDATE guilds SET name=?,icon=?,banner=?,description=?,accent=? WHERE id=?', clean(b.name, 100) || g.name, file(b.icon, g.icon), file(b.banner, g.banner),
    b.description !== undefined ? clean(b.description, 300) : g.description, b.accent !== undefined ? clean(b.accent, 9) : g.accent, g.id);
  const n = get('SELECT * FROM guilds WHERE id=?', g.id);
  audit(g.id, req.uid, req.body.owner_id !== undefined ? 'guild_transfer' : 'guild_update', req.body.owner_id !== undefined ? String(req.body.owner_id) : null, n.name);
  dispatch(guildMemberIds(g.id), 'GUILD_UPDATE', { id: n.id, name: n.name, icon: n.icon, banner: n.banner, description: n.description, accent: n.accent, owner_id: n.owner_id });
  res.json({});
}));
app.delete('/api/guilds/:id', auth, wrap((req, res) => {
  const g = get('SELECT * FROM guilds WHERE id=?', req.params.id);
  if (!g || g.owner_id !== req.uid) return bad(res, 'Apenas o dono pode excluir', 403);
  const ids = guildMemberIds(g.id);
  for (const [cid, m] of voice) for (const u of [...m.keys()]) if (get('SELECT 1 x FROM channels WHERE id=? AND guild_id=?', cid, g.id)) leaveVoice(u, cid);
  run('DELETE FROM guilds WHERE id=?', g.id);
  dispatch(ids, 'GUILD_DELETE', { id: g.id });
  res.json({});
}));
function removeMember(gid, uid, kicked) {
  for (const [cid, m] of voice) if (m.has(uid) && get('SELECT 1 x FROM channels WHERE id=? AND guild_id=?', cid, gid)) leaveVoice(uid, cid);
  const ids = guildMemberIds(gid);
  run('DELETE FROM member_roles WHERE guild_id=? AND user_id=?', gid, uid);
  run('DELETE FROM members WHERE guild_id=? AND user_id=?', gid, uid);
  dispatch(ids, 'MEMBER_REMOVE', { guild_id: gid, user_id: uid });
  dispatch([uid], 'GUILD_DELETE', { id: gid, kicked });
}
app.delete('/api/guilds/:id/members/:uid', auth, wrap((req, res) => {
  const gid = req.params.id, target = req.params.uid === 'me' ? req.uid : req.params.uid;
  const g = get('SELECT * FROM guilds WHERE id=?', gid);
  if (!g) return bad(res, 'Servidor não encontrado', 404);
  if (target === g.owner_id) return bad(res, 'O dono não pode sair/ser expulso; exclua o servidor', 400);
  if (target !== req.uid && !can(gid, req.uid, P.KICK)) return bad(res, 'Sem permissão', 403);
  removeMember(gid, target, target !== req.uid);
  if (target !== req.uid) audit(gid, req.uid, 'member_kick', target, clean(req.query.reason, 300));
  res.json({});
}));
// Banimentos
app.get('/api/guilds/:id/bans', auth, wrap((req, res) => {
  if (!can(req.params.id, req.uid, P.BAN)) return bad(res, 'Sem permissão', 403);
  res.json(all('SELECT user_id,reason,by_id,created_at FROM bans WHERE guild_id=? ORDER BY created_at DESC', req.params.id).map(b => ({ ...b, user: userPub(b.user_id) })));
}));
app.put('/api/guilds/:id/bans/:uid', auth, wrap((req, res) => {
  const gid = req.params.id, target = req.params.uid, g = get('SELECT * FROM guilds WHERE id=?', gid);
  if (!g || !can(gid, req.uid, P.BAN)) return bad(res, 'Sem permissão', 403);
  if (target === g.owner_id || target === req.uid || !getUser(target)) return bad(res, 'Não é possível banir este usuário');
  const reason = clean(req.body.reason, 300);
  run('INSERT INTO bans(guild_id,user_id,reason,by_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET reason=excluded.reason', gid, target, reason, req.uid, Date.now());
  if (get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, target)) removeMember(gid, target, true);
  if (req.body.delete_messages) { // apaga as mensagens das últimas 24 h
    for (const m of all('SELECT m.id,m.channel_id FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.guild_id=? AND m.author_id=? AND m.created_at>?', gid, target, Date.now() - 86400000)) {
      run('DELETE FROM messages WHERE id=?', m.id);
      dispatch(guildMemberIds(gid), 'MESSAGE_DELETE', { id: m.id, channel_id: m.channel_id, guild_id: gid });
    }
  }
  audit(gid, req.uid, 'member_ban', target, reason);
  res.json({});
}));
app.delete('/api/guilds/:id/bans/:uid', auth, wrap((req, res) => {
  if (!can(req.params.id, req.uid, P.BAN)) return bad(res, 'Sem permissão', 403);
  run('DELETE FROM bans WHERE guild_id=? AND user_id=?', req.params.id, req.params.uid);
  audit(req.params.id, req.uid, 'member_unban', req.params.uid);
  res.json({});
}));
app.get('/api/guilds/:id/audit', auth, wrap((req, res) => {
  if (!can(req.params.id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
  const rows = req.query.before ? all('SELECT * FROM audit_log WHERE guild_id=? AND id<? ORDER BY id DESC LIMIT 100', req.params.id, String(req.query.before))
    : all('SELECT * FROM audit_log WHERE guild_id=? ORDER BY id DESC LIMIT 100', req.params.id);
  const ids = new Set(rows.flatMap(r => [r.actor_id, r.target_id]).filter(Boolean));
  res.json({ entries: rows, users: [...ids].map(userPub).filter(Boolean) });
}));
app.patch('/api/guilds/:id/members/:uid', auth, wrap((req, res) => {
  const gid = req.params.id, target = req.params.uid === 'me' ? req.uid : req.params.uid;
  const own = target === req.uid;
  if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, req.uid)) return bad(res, 'Sem permissão', 403);
  if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, target)) return bad(res, 'Membro não encontrado', 404);
  if (req.body.nickname !== undefined) {
    if (!own && !can(gid, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
    run('UPDATE members SET nickname=? WHERE guild_id=? AND user_id=?', clean(req.body.nickname, 32) || null, gid, target);
  }
  if (req.body.timeout_until !== undefined) { // castigo (null = remover)
    const g = get('SELECT owner_id FROM guilds WHERE id=?', gid);
    if (!can(gid, req.uid, P.MODERATE) || own || target === g.owner_id) return bad(res, 'Sem permissão', 403);
    const until = req.body.timeout_until ? Math.min(+req.body.timeout_until, Date.now() + 28 * 86400000) : null;
    if (until !== null && !(until > Date.now())) return bad(res, 'Duração inválida');
    run('UPDATE members SET timeout_until=? WHERE guild_id=? AND user_id=?', until, gid, target);
    if (until) { const c = currentVoice(target); if (c && get('SELECT 1 x FROM channels WHERE id=? AND guild_id=?', c, gid)) leaveVoice(target, c); }
    audit(gid, req.uid, until ? 'member_timeout' : 'member_timeout_remove', target, until ? new Date(until).toISOString() + (req.body.reason ? ' — ' + clean(req.body.reason, 300) : '') : '');
  }
  if (Array.isArray(req.body.roles)) {
    if (!can(gid, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
    audit(gid, req.uid, 'member_roles', target, req.body.roles.map(r => get('SELECT name FROM roles WHERE id=? AND guild_id=?', r, gid)?.name).filter(Boolean).join(', ') || '(nenhum)');
    run('DELETE FROM member_roles WHERE guild_id=? AND user_id=?', gid, target);
    for (const r of req.body.roles) if (get('SELECT 1 x FROM roles WHERE id=? AND guild_id=?', r, gid)) run('INSERT OR IGNORE INTO member_roles VALUES(?,?,?)', gid, target, r);
  }
  dispatch(guildMemberIds(gid), 'MEMBER_UPDATE', { guild_id: gid, ...memberObj(gid, target) });
  res.json({});
}));
// Roles
app.post('/api/guilds/:id/roles', auth, wrap((req, res) => {
  if (!can(req.params.id, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
  const id = newId();
  run('INSERT INTO roles(id,guild_id,name,color,perms,position) VALUES(?,?,?,?,?,?)', id, req.params.id, clean(req.body.name, 50) || 'novo cargo', clean(req.body.color, 9) || '#99aab5', Number(req.body.perms) | 0, Date.now() % 100000);
  dispatch(guildMemberIds(req.params.id), 'ROLE_UPDATE', { guild_id: req.params.id, role: get('SELECT * FROM roles WHERE id=?', id) });
  audit(req.params.id, req.uid, 'role_create', id, clean(req.body.name, 50) || 'novo cargo');
  res.json({ id });
}));
app.patch('/api/roles/:id', auth, wrap((req, res) => {
  const r = get('SELECT * FROM roles WHERE id=?', req.params.id);
  if (!r || !can(r.guild_id, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
  run('UPDATE roles SET name=?,color=?,perms=? WHERE id=?', clean(req.body.name, 50) || r.name, clean(req.body.color, 9) || r.color, req.body.perms !== undefined ? Number(req.body.perms) | 0 : r.perms, r.id);
  dispatch(guildMemberIds(r.guild_id), 'ROLE_UPDATE', { guild_id: r.guild_id, role: get('SELECT * FROM roles WHERE id=?', r.id) });
  audit(r.guild_id, req.uid, 'role_update', r.id, get('SELECT name FROM roles WHERE id=?', r.id).name);
  res.json({});
}));
app.delete('/api/roles/:id', auth, wrap((req, res) => {
  const r = get('SELECT * FROM roles WHERE id=?', req.params.id);
  if (!r || !can(r.guild_id, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
  run('DELETE FROM roles WHERE id=?', r.id);
  audit(r.guild_id, req.uid, 'role_delete', r.id, r.name);
  dispatch(guildMemberIds(r.guild_id), 'ROLE_DELETE', { guild_id: r.guild_id, id: r.id });
  res.json({});
}));
// Channels
app.post('/api/guilds/:id/channels', auth, wrap((req, res) => {
  const gid = req.params.id;
  if (!can(gid, req.uid, P.MANAGE_CHANNELS)) return bad(res, 'Sem permissão', 403);
  const type = [0, 2, 4].includes(+req.body.type) ? +req.body.type : 0;
  let name = clean(req.body.name, 100);
  if (type === 0) name = name.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-');
  name = name || 'novo-canal';
  const id = newId(), pos = (get('SELECT MAX(position) m FROM channels WHERE guild_id=?', gid).m ?? 0) + 1;
  const parent = get('SELECT id FROM channels WHERE id=? AND guild_id=? AND type=4', String(req.body.parent_id ?? ''), gid) ? String(req.body.parent_id) : null;
  run('INSERT INTO channels(id,guild_id,type,name,position,parent_id,created_at) VALUES(?,?,?,?,?,?,?)', id, gid, type, name, pos, parent, Date.now());
  dispatch(guildMemberIds(gid), 'CHANNEL_CREATE', get('SELECT * FROM channels WHERE id=?', id));
  audit(gid, req.uid, 'channel_create', id, name);
  res.json({ id });
}));
app.patch('/api/channels/:id', auth, wrap((req, res) => {
  const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
  if (!ch || !ch.guild_id || !can(ch.guild_id, req.uid, P.MANAGE_CHANNELS)) return bad(res, 'Sem permissão', 403);
  run('UPDATE channels SET name=?,topic=?,position=? WHERE id=?', clean(req.body.name, 100) || ch.name, req.body.topic !== undefined ? clean(req.body.topic, 1024) : ch.topic, Number.isFinite(+req.body.position) && req.body.position !== undefined ? +req.body.position : ch.position, ch.id);
  dispatch(guildMemberIds(ch.guild_id), 'CHANNEL_UPDATE', get('SELECT * FROM channels WHERE id=?', ch.id));
  if (req.body.name !== undefined || req.body.topic !== undefined) audit(ch.guild_id, req.uid, 'channel_update', ch.id, get('SELECT name FROM channels WHERE id=?', ch.id).name);
  res.json({});
}));
app.delete('/api/channels/:id', auth, wrap((req, res) => {
  const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
  if (!ch || !ch.guild_id || !can(ch.guild_id, req.uid, P.MANAGE_CHANNELS)) return bad(res, 'Sem permissão', 403);
  if (voice.has(ch.id)) for (const u of [...voice.get(ch.id).keys()]) leaveVoice(u, ch.id);
  run('UPDATE channels SET parent_id=NULL WHERE parent_id=?', ch.id);
  run('DELETE FROM channels WHERE id=?', ch.id);
  audit(ch.guild_id, req.uid, 'channel_delete', ch.id, ch.name);
  dispatch(guildMemberIds(ch.guild_id), 'CHANNEL_DELETE', { id: ch.id, guild_id: ch.guild_id });
  res.json({});
}));
// Invites
app.post('/api/guilds/:id/invites', auth, wrap((req, res) => {
  if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', req.params.id, req.uid)) return bad(res, 'Sem permissão', 403);
  const code = crypto.randomBytes(5).toString('base64url');
  run('INSERT INTO invites(code,guild_id,creator_id,created_at) VALUES(?,?,?,?)', code, req.params.id, req.uid, Date.now());
  res.json({ code });
}));
app.get('/api/invites/:code', wrap((req, res) => {
  const i = get('SELECT i.*,g.name,g.icon,g.banner,g.accent FROM invites i JOIN guilds g ON g.id=i.guild_id WHERE code=?', req.params.code);
  if (!i) return bad(res, 'Convite inválido ou expirado', 404);
  // online: conectados que não estão invisíveis (o cartão de convite mostra os dois números)
  const ms = all('SELECT u.id,u.status FROM members m JOIN users u ON u.id=m.user_id WHERE m.guild_id=?', i.guild_id);
  const online = ms.filter(u => conns.has(u.id) && u.status !== 'invisible').length;
  res.json({ code: i.code, guild: { id: i.guild_id, name: i.name, icon: i.icon, banner: i.banner, accent: i.accent }, members: ms.length, online });
}));
app.post('/api/invites/:code', auth, wrap((req, res) => {
  const i = get('SELECT * FROM invites WHERE code=?', req.params.code);
  if (!i) return bad(res, 'Convite inválido ou expirado', 404);
  if (get('SELECT 1 x FROM bans WHERE guild_id=? AND user_id=?', i.guild_id, req.uid)) return bad(res, 'Você foi banido deste servidor', 403);
  if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', i.guild_id, req.uid)) {
    joinGuild(i.guild_id, req.uid);
    run('UPDATE invites SET uses=uses+1 WHERE code=?', i.code);
  }
  res.json({ id: i.guild_id });
}));
// entra no servidor: membro novo, avisa os membros, manda o servidor para quem entrou e a mensagem de boas-vindas
function joinGuild(gid, uid) {
  run('INSERT INTO members(guild_id,user_id,joined_at) VALUES(?,?,?)', gid, uid, Date.now());
  dispatch(guildMemberIds(gid).filter(x => x !== uid), 'MEMBER_ADD', { guild_id: gid, member: memberObj(gid, uid), user: userPub(uid) });
  dispatch([uid], 'GUILD_CREATE', guildFull(gid));
  const gen = get("SELECT id FROM channels WHERE guild_id=? AND type=0 ORDER BY position LIMIT 1", gid);
  if (gen) { // mensagem de sistema de boas-vindas
    const mid = newId();
    run("INSERT INTO messages(id,channel_id,author_id,content,created_at,type) VALUES(?,?,?,?,?,1)", mid, gen.id, uid, 'entrou no servidor.', Date.now());
    const ch = get('SELECT * FROM channels WHERE id=?', gen.id);
    dispatch(channelAudience(ch), 'MESSAGE_CREATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', mid)), guild_id: ch.guild_id, mentions: [] });
  }
}

app.get('/api/guilds/:id/invites', auth, wrap((req, res) => {
  if (!can(req.params.id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
  res.json(all('SELECT code,creator_id,uses,created_at FROM invites WHERE guild_id=? ORDER BY created_at DESC', req.params.id));
}));
app.delete('/api/invites/:code', auth, wrap((req, res) => {
  const i = get('SELECT * FROM invites WHERE code=?', req.params.code);
  if (!i || !(i.creator_id === req.uid || can(i.guild_id, req.uid, P.MANAGE_GUILD))) return bad(res, 'Sem permissão', 403);
  run('DELETE FROM invites WHERE code=?', i.code);
  audit(i.guild_id, req.uid, 'invite_delete', null, i.code);
  res.json({});
}));
// Convites para a chamada (server/callinvites.js)
const callInv = createCallInvites({
  get,
  voiceChannelOf: (uid) => { for (const [cid, m] of voice) if (m.has(uid)) return cid; return null; },
  roomSize: (cid) => voice.get(cid)?.size || 0,
  isFriend: (a, b) => !!get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=1', a, b),
  isMember: (gid, uid) => !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid),
  isBanned: (gid, uid) => !!get('SELECT 1 x FROM bans WHERE guild_id=? AND user_id=?', gid, uid),
  isBlocked: (a, b) => !!get('SELECT 1 x FROM relationships WHERE ((user_id=? AND other_id=?) OR (user_id=? AND other_id=?)) AND type=2', a, b, b, a),
  joinGuild: (gid, uid) => joinGuild(gid, uid), userPub, dispatch, postDm: (a, b, c) => postDm(a, b, c),
});
const callInvRate = new Map(); // uid -> instantes dos últimos convites (no máx. 10 por minuto)
const callOut = (res, r) => (r.error ? bad(res, r.error, r.status) : res.json(r));
app.post('/api/call-invites', auth, wrap((req, res) => {
  const t = Date.now(), recent = (callInvRate.get(req.uid) || []).filter(x => t - x < 60e3);
  if (recent.length >= 10) return bad(res, 'Muitos convites em pouco tempo; espere um pouco', 429);
  const r = callInv.create(req.uid, String(req.body.user_id || ''));
  if (!r.error && !r.repeated) callInvRate.set(req.uid, [...recent, t]);
  callOut(res, r);
}));
app.get('/api/call-invites/:id', auth, wrap((req, res) => callOut(res, callInv.read(req.params.id, req.uid))));
app.post('/api/call-invites/:id/:action(accept|decline|cancel)', auth, wrap((req, res) => callOut(res, callInv.respond(req.params.id, req.uid, req.params.action))));

// Emojis personalizados
app.post('/api/guilds/:id/emojis', auth, wrap((req, res) => {
  const gid = req.params.id;
  if (!can(gid, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
  const name = clean(req.body.name, 32).replace(/[^\w]/g, '_'), url = String(req.body.url || '');
  if (name.length < 2 || !url.startsWith('/files/')) return bad(res, 'Nome (mín. 2 letras) e imagem obrigatórios');
  if (get('SELECT COUNT(*) n FROM emojis WHERE guild_id=?', gid).n >= 100) return bad(res, 'Limite de 100 emojis');
  const id = newId();
  run('INSERT INTO emojis VALUES(?,?,?,?,?,?)', id, gid, name, url, req.uid, Date.now());
  dispatch(guildMemberIds(gid), 'EMOJIS_UPDATE', { guild_id: gid, emojis: all('SELECT id,name,url FROM emojis WHERE guild_id=?', gid) });
  res.json({ id });
}));
app.delete('/api/emojis/:id', auth, wrap((req, res) => {
  const e = get('SELECT * FROM emojis WHERE id=?', req.params.id);
  if (!e || !can(e.guild_id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
  run('DELETE FROM emojis WHERE id=?', e.id);
  dispatch(guildMemberIds(e.guild_id), 'EMOJIS_UPDATE', { guild_id: e.guild_id, emojis: all('SELECT id,name,url FROM emojis WHERE guild_id=?', e.guild_id) });
  res.json({});
}));

// Soundboard do servidor
const soundsOf = (gid) => all('SELECT id,name,emoji,url,volume FROM sounds WHERE guild_id=? ORDER BY created_at', gid);
app.post('/api/guilds/:id/sounds', auth, wrap((req, res) => {
  const gid = req.params.id;
  if (!can(gid, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
  const name = clean(req.body.name, 32), url = String(req.body.url || ''), vol = Math.max(1, Math.min(200, +req.body.volume || 100));
  if (!name || !url.startsWith('/files/')) return bad(res, 'Nome e arquivo de áudio obrigatórios');
  if (get('SELECT COUNT(*) n FROM sounds WHERE guild_id=?', gid).n >= 48) return bad(res, 'Limite de 48 sons por servidor');
  const id = newId();
  run('INSERT INTO sounds VALUES(?,?,?,?,?,?,?,?)', id, gid, name, clean(req.body.emoji, 16), url, vol, req.uid, Date.now());
  dispatch(guildMemberIds(gid), 'SOUNDS_UPDATE', { guild_id: gid, sounds: soundsOf(gid) });
  res.json({ id });
}));
app.patch('/api/sounds/:id', auth, wrap((req, res) => {
  const o = get('SELECT * FROM sounds WHERE id=?', req.params.id);
  if (!o || !can(o.guild_id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
  run('UPDATE sounds SET name=?,emoji=?,volume=? WHERE id=?', clean(req.body.name, 32) || o.name, req.body.emoji !== undefined ? clean(req.body.emoji, 16) : o.emoji, req.body.volume !== undefined ? Math.max(1, Math.min(200, +req.body.volume || 100)) : o.volume, o.id);
  dispatch(guildMemberIds(o.guild_id), 'SOUNDS_UPDATE', { guild_id: o.guild_id, sounds: soundsOf(o.guild_id) });
  res.json({});
}));
app.delete('/api/sounds/:id', auth, wrap((req, res) => {
  const o = get('SELECT * FROM sounds WHERE id=?', req.params.id);
  if (!o || !can(o.guild_id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
  run('DELETE FROM sounds WHERE id=?', o.id);
  dispatch(guildMemberIds(o.guild_id), 'SOUNDS_UPDATE', { guild_id: o.guild_id, sounds: soundsOf(o.guild_id) });
  res.json({});
}));

// Messages
const channelFor = (req, res) => {
  const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
  if (!canAccessChannel(req.uid, ch)) { bad(res, 'Canal não encontrado', 404); return null; }
  return ch;
};
app.get('/api/channels/:id/messages', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  const limit = Math.min(+req.query.limit || 50, 100);
  let rows;
  if (req.query.around) {
    const a = all('SELECT * FROM messages WHERE channel_id=? AND id<=? ORDER BY id DESC LIMIT 25', ch.id, String(req.query.around));
    const b = all('SELECT * FROM messages WHERE channel_id=? AND id>? ORDER BY id ASC LIMIT 25', ch.id, String(req.query.around));
    rows = [...a, ...b].sort((x, y) => (x.id < y.id ? 1 : -1));
  } else if (req.query.oldest) rows = all('SELECT * FROM messages WHERE channel_id=? ORDER BY id ASC LIMIT ?', ch.id, limit).reverse();
  else if (req.query.after) rows = all('SELECT * FROM messages WHERE channel_id=? AND id>? ORDER BY id ASC LIMIT ?', ch.id, String(req.query.after), limit).reverse();
  else if (req.query.before) rows = all('SELECT * FROM messages WHERE channel_id=? AND id<? ORDER BY id DESC LIMIT ?', ch.id, String(req.query.before), limit);
  else rows = all('SELECT * FROM messages WHERE channel_id=? ORDER BY id DESC LIMIT ?', ch.id, limit);
  res.json(rows.reverse().map(messageObj));
}));
app.get('/api/channels/:id/pins', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  res.json(all('SELECT * FROM messages WHERE channel_id=? AND pinned=1 ORDER BY id DESC', ch.id).map(messageObj));
}));
// Busca: texto livre no índice FTS (sem acento, por prefixo) + filtros de:nome tem:imagem|arquivo|link|video em:canal
const HAS = {
  imagem: "m.attachments GLOB '*.[pP][nN][gG]\"*' OR m.attachments GLOB '*.[jJ][pP]*' OR m.attachments GLOB '*.[gG][iI][fF]\"*' OR m.attachments GLOB '*.[wW][eE][bB][pP]\"*'",
  video: "m.attachments GLOB '*.[mM][pP]4\"*' OR m.attachments GLOB '*.[wW][eE][bB][mM]\"*'",
  arquivo: "m.attachments <> '[]'", link: "m.content LIKE '%http%'",
};
HAS.image = HAS.imagem; HAS.file = HAS.arquivo; HAS.anexo = HAS.arquivo;
function parseSearch(q) {
  const out = { terms: [], from: [], has: [], in: [] };
  for (const t of q.match(/(?:[^\s"]+|"[^"]*")+/g) || []) {
    const m = t.match(/^(de|from|tem|has|em|in):(.+)$/i), v = m?.[2].replace(/^[@#"]+|"$/g, '');
    if (m && v) out[{ de: 'from', from: 'from', tem: 'has', has: 'has', em: 'in', in: 'in' }[m[1].toLowerCase()]].push(v.toLowerCase());
    else out.terms.push(t.replace(/"/g, ''));
  }
  return out;
}
app.get('/api/search', auth, wrap((req, res) => {
  const q = clean(req.query.q, 200); if (!q) return res.json([]);
  const p = parseSearch(q), where = ['m.type = 0'], args = [];
  const gid = req.query.guild ? String(req.query.guild) : null;
  if (gid) {
    if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, req.uid)) return res.json([]);
    where.push('c.guild_id = ?'); args.push(gid);
  } else { where.push('m.channel_id IN (SELECT channel_id FROM dm_participants WHERE user_id=?)'); args.push(req.uid); }
  const fts = p.terms.map(t => t.replace(/[^\p{L}\p{N}_.-]+/gu, ' ').trim()).filter(Boolean).flatMap(t => t.split(/\s+/)).map(t => `"${t}"*`).join(' ');
  if (fts) { where.push('m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)'); args.push(fts); }
  else if (p.terms.length) return res.json([]); // só pontuação
  for (const name of p.from) {
    where.push('m.author_id IN (SELECT id FROM users WHERE lower(username)=? OR lower(display_name)=?' + (gid ? ' UNION SELECT user_id FROM members WHERE guild_id=? AND lower(nickname)=?' : '') + ')');
    args.push(name, name); if (gid) args.push(gid, name);
  }
  for (const k of p.has) { if (!HAS[k]) return res.json([]); where.push('(' + HAS[k] + ')'); }
  for (const name of p.in) { where.push('lower(c.name) = ?'); args.push(name); }
  if (!fts && !p.from.length && !p.has.length && !p.in.length) return res.json([]);
  const rows = all(`SELECT m.* FROM messages m JOIN channels c ON c.id=m.channel_id WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT 50`, ...args);
  res.json(rows.map(messageObj));
}));
// Caixa de entrada: menções, respostas e @everyone dirigidos a mim, de todos os servidores e DMs
app.get('/api/inbox', auth, wrap((req, res) => {
  const before = req.query.before ? String(req.query.before) : '99999999999999999999';
  const rows = all(`SELECT m.*, mm.kind, c.guild_id, c.name channel_name FROM mentions mm JOIN messages m ON m.id=mm.message_id JOIN channels c ON c.id=m.channel_id
    WHERE mm.user_id=? AND m.id<? AND (c.guild_id IN (SELECT guild_id FROM members WHERE user_id=?) OR c.id IN (SELECT channel_id FROM dm_participants WHERE user_id=?))
    ORDER BY m.id DESC LIMIT 30`, req.uid, before, req.uid, req.uid);
  res.json(rows.map(r => {
    const rs = get('SELECT last_id FROM read_states WHERE user_id=? AND channel_id=?', req.uid, r.channel_id);
    return { ...messageObj(r), guild_id: r.guild_id, channel_name: r.channel_name, kind: r.kind, unread: !rs || rs.last_id < r.id };
  }));
}));
function saveMentions(m, ch, content) { // grava quem deve ver esta mensagem na caixa de entrada
  run("DELETE FROM mentions WHERE message_id=? AND kind<>'reply'", m.id);
  const everyone = /@everyone|@here/.test(content) && ch.guild_id;
  const ids = everyone ? channelAudience(ch) : [...content.matchAll(/<@(\d+)>/g)].map(x => x[1]);
  for (const id of new Set(ids)) if (id !== m.author_id) run('INSERT OR IGNORE INTO mentions VALUES(?,?,?)', m.id, id, everyone ? 'everyone' : 'mention');
}
function mentionedIds(content, ch) {
  const ids = new Set();
  for (const m of content.matchAll(/<@(\d+)>/g)) ids.add(m[1]);
  if (/@everyone|@here/.test(content)) return channelAudience(ch);
  return [...ids];
}
app.post('/api/channels/:id/messages', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  if (ch.type === 4) return bad(res, 'Canal não aceita mensagens');
  if (timedOut(ch.guild_id, req.uid)) return bad(res, 'Você está de castigo neste servidor', 403);
  if (!rateOk(req.uid)) return bad(res, 'Você está enviando mensagens rápido demais', 429);
  const content = String(req.body.content ?? '').slice(0, 4000);
  const atts = (Array.isArray(req.body.attachments) ? req.body.attachments : []).slice(0, 10)
    .filter(a => a && typeof a.url === 'string' && a.url.startsWith('/files/'))
    .map(a => {
      const o = { url: a.url, name: clean(a.name, 200), size: +a.size || 0, type: clean(a.type, 100) };
      if (a.voice === true) { // mensagem de voz: forma de onda (base64, até 256 barras) e duração
        o.voice = true; o.duration = Math.max(0, Math.min(3600, +a.duration || 0));
        o.waveform = /^[A-Za-z0-9+/=]{0,400}$/.test(a.waveform || '') ? a.waveform : '';
      }
      return o;
    });
  if (!content.trim() && !atts.length) return bad(res, 'Mensagem vazia');
  if (ch.type === 1) {
    const other = all('SELECT user_id FROM dm_participants WHERE channel_id=? AND user_id<>?', ch.id, req.uid)[0];
    if (other && get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=2', other.user_id, req.uid)) return bad(res, 'Você não pode enviar mensagens para este usuário', 403);
  }
  const id = newId();
  run('INSERT INTO messages(id,channel_id,author_id,content,created_at,reply_to,attachments) VALUES(?,?,?,?,?,?,?)',
    id, ch.id, req.uid, content, Date.now(), req.body.reply_to ? String(req.body.reply_to) : null, JSON.stringify(atts));
  run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', req.uid, ch.id, id);
  const row = get('SELECT * FROM messages WHERE id=?', id);
  saveMentions(row, ch, content);
  const rep = row.reply_to && get('SELECT author_id FROM messages WHERE id=? AND channel_id=?', row.reply_to, ch.id);
  if (rep && rep.author_id !== req.uid) run('INSERT OR REPLACE INTO mentions VALUES(?,?,?)', id, rep.author_id, 'reply');
  const msg = { ...messageObj(row), guild_id: ch.guild_id, mentions: mentionedIds(content, ch) };
  dispatch(channelAudience(ch), 'MESSAGE_CREATE', msg);
  res.json(msg);
}));
app.patch('/api/channels/:id/messages/:mid', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
  if (!m || m.author_id !== req.uid) return bad(res, 'Sem permissão', 403);
  const content = String(req.body.content ?? '').slice(0, 4000);
  if (!content.trim()) return bad(res, 'Mensagem vazia');
  if (get('SELECT 1 x FROM polls WHERE message_id=?', m.id)) return bad(res, 'Enquetes não podem ser editadas');
  run('UPDATE messages SET content=?,edited_at=? WHERE id=?', content, Date.now(), m.id);
  saveMentions(m, ch, content);
  dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', m.id)), guild_id: ch.guild_id });
  res.json({});
}));
app.delete('/api/channels/:id/messages/:mid', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
  if (!m || (m.author_id !== req.uid && !(ch.guild_id && can(ch.guild_id, req.uid, P.MANAGE_MESSAGES)))) return bad(res, 'Sem permissão', 403);
  run('DELETE FROM messages WHERE id=?', m.id);
  dropClipsOfMessage(m.id);
  if (m.author_id !== req.uid) audit(ch.guild_id, req.uid, 'message_delete', m.author_id, `#${ch.name}: ${(m.content || '').slice(0, 200)}`);
  dispatch(channelAudience(ch), 'MESSAGE_DELETE', { id: m.id, channel_id: ch.id, guild_id: ch.guild_id });
  res.json({});
}));
// remove um anexo da mensagem (a mensagem some se ficar sem texto e sem anexos)
app.delete('/api/channels/:id/messages/:mid/attachments/:idx', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
  if (!m || (m.author_id !== req.uid && !(ch.guild_id && can(ch.guild_id, req.uid, P.MANAGE_MESSAGES)))) return bad(res, 'Sem permissão', 403);
  const atts = JSON.parse(m.attachments || '[]'), i = +req.params.idx;
  if (!Number.isInteger(i) || !atts[i]) return bad(res, 'Anexo não encontrado', 404);
  const [gone] = atts.splice(i, 1);
  for (const c of all('SELECT * FROM clips WHERE message_id=? AND url=?', m.id, String(gone.url))) { run('DELETE FROM clips WHERE id=?', c.id); dispatch(channelAudience(ch), 'CLIP_DELETE', { id: c.id, guild_id: c.guild_id }); }
  if (m.author_id !== req.uid) audit(ch.guild_id, req.uid, 'message_delete', m.author_id, `#${ch.name}: anexo ${gone.name}`);
  if (!atts.length && !(m.content || '').trim()) {
    run('DELETE FROM messages WHERE id=?', m.id);
    dispatch(channelAudience(ch), 'MESSAGE_DELETE', { id: m.id, channel_id: ch.id, guild_id: ch.guild_id });
  } else {
    run('UPDATE messages SET attachments=? WHERE id=?', JSON.stringify(atts), m.id);
    dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', m.id)), guild_id: ch.guild_id });
  }
  unlinkIfUnused(gone.url);
  res.json({});
}));
// ---------- Procurar jogadores (server/lfg.js) ----------
// quem vê os anúncios de alguém: quem divide algum servidor com a pessoa ou é amigo dela, menos bloqueios (nos dois sentidos)
function lfgAudience(uid) {
  const ids = new Set([uid]);
  for (const r of all('SELECT m2.user_id FROM members m1 JOIN members m2 ON m1.guild_id=m2.guild_id WHERE m1.user_id=?', uid)) ids.add(r.user_id);
  for (const r of all('SELECT other_id FROM relationships WHERE user_id=? AND type=1', uid)) ids.add(r.other_id);
  for (const r of all('SELECT other_id id FROM relationships WHERE user_id=? AND type=2 UNION SELECT user_id id FROM relationships WHERE other_id=? AND type=2', uid, uid)) ids.delete(r.id);
  return [...ids];
}
mountGifs(app, { auth, wrap, bad, all, run, get, canSeeChannel: canAccessChannel, dataDir: DATA_DIR, clean });
mountLfg(app, {
  auth, wrap, bad, get, all, run, newId, dispatch, userPub, clean,
  audienceOf: lfgAudience, canSeeChannel: canAccessChannel,
  voiceCount: (cid) => voice.get(cid)?.size || 0, voiceChannelOf: (uid) => currentVoice(uid),
  callInvite: (from, to) => callInv.create(from, to), postDm: (a, b, c) => postDm(a, b, c),
});
// ---------- Enquetes ----------
const POLL_DURATIONS = new Set([0, 1, 4, 8, 24, 72, 168]); // horas (0 = sem prazo)
const pollTimers = new Map();
const pollUpdate = (p) => { const m = get('SELECT * FROM messages WHERE id=?', p.message_id), ch = m && get('SELECT * FROM channels WHERE id=?', m.channel_id); if (ch) dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(m), guild_id: ch.guild_id }); };
// avisa todo mundo na hora em que o prazo acaba (o cartão passa a mostrar o resultado)
function schedulePollEnd(p) {
  clearTimeout(pollTimers.get(p.id));
  if (!p.ends_at || p.closed_at) return;
  const ms = p.ends_at - Date.now(); if (ms > 7 * 86400e3 + 60e3) return;
  pollTimers.set(p.id, setTimeout(() => { pollTimers.delete(p.id); const cur = get('SELECT * FROM polls WHERE id=?', p.id); if (cur && !cur.closed_at) pollUpdate(cur); }, Math.max(0, ms) + 250));
}
for (const p of all('SELECT * FROM polls WHERE ends_at IS NOT NULL AND closed_at IS NULL AND ends_at > ?', Date.now())) schedulePollEnd(p);
app.post('/api/channels/:id/polls', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  if (ch.type === 1) { const other = all('SELECT user_id FROM dm_participants WHERE channel_id=? AND user_id<>?', ch.id, req.uid)[0]; if (other && get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=2', other.user_id, req.uid)) return bad(res, 'Você não pode enviar mensagens para este usuário', 403); }
  const question = clean(req.body.question, 300);
  const texts = (Array.isArray(req.body.options) ? req.body.options : []).map(o => clean(o, 80)).filter(Boolean);
  if (!question) return bad(res, 'Escreva a pergunta');
  if (texts.length < 2) return bad(res, 'A enquete precisa de pelo menos 2 opções');
  if (texts.length > 10) return bad(res, 'No máximo 10 opções');
  if (new Set(texts.map(t => t.toLowerCase())).size !== texts.length) return bad(res, 'Há opções repetidas');
  const hours = Number(req.body.duration_h || 0); if (!POLL_DURATIONS.has(hours) && !(process.env.POLL_TEST_FAST === '1' && hours > 0 && hours < 0.01)) return bad(res, 'Prazo inválido'); // POLL_TEST_FAST: prazo de segundos, só nos testes
  const now = Date.now(), mid = newId(), pid = newId();
  run('INSERT INTO messages(id,channel_id,author_id,content,created_at) VALUES(?,?,?,?,?)', mid, ch.id, req.uid, '📊 ' + question, now);
  run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', req.uid, ch.id, mid);
  run('INSERT INTO polls(id,message_id,channel_id,author_id,question,options,multi,ends_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    pid, mid, ch.id, req.uid, question, JSON.stringify(texts.map((text, i) => ({ id: String(i + 1), text }))), req.body.multi ? 1 : 0, hours ? now + hours * 3600e3 : null, now);
  schedulePollEnd(get('SELECT * FROM polls WHERE id=?', pid));
  const msg = { ...messageObj(get('SELECT * FROM messages WHERE id=?', mid)), guild_id: ch.guild_id, mentions: [] };
  dispatch(channelAudience(ch), 'MESSAGE_CREATE', msg);
  res.json(msg);
}));
const pollFor = (req, res) => {
  const p = get('SELECT * FROM polls WHERE id=?', req.params.id), ch = p && get('SELECT * FROM channels WHERE id=?', p.channel_id);
  if (!p || !canAccessChannel(req.uid, ch)) { bad(res, 'Enquete não encontrada', 404); return null; }
  return { p, ch };
};
// votar: substitui os votos da pessoa (lista vazia = tirar o voto)
app.put('/api/polls/:id/vote', auth, wrap((req, res) => {
  const f = pollFor(req, res); if (!f) return;
  const { p } = f;
  if (p.closed_at || (p.ends_at && p.ends_at <= Date.now())) return bad(res, 'A enquete já foi encerrada', 409);
  const valid = new Set(JSON.parse(p.options).map(o => o.id));
  const pick = [...new Set((Array.isArray(req.body.options) ? req.body.options : []).map(String))];
  if (pick.some(o => !valid.has(o))) return bad(res, 'Opção inválida');
  if (!p.multi && pick.length > 1) return bad(res, 'Esta enquete aceita só uma resposta');
  run('DELETE FROM poll_votes WHERE poll_id=? AND user_id=?', p.id, req.uid);
  const now = Date.now(); for (const o of pick) run('INSERT INTO poll_votes VALUES(?,?,?,?)', p.id, req.uid, o, now);
  pollUpdate(p);
  res.json(pollObj(get('SELECT * FROM polls WHERE id=?', p.id)));
}));
app.post('/api/polls/:id/close', auth, wrap((req, res) => {
  const f = pollFor(req, res); if (!f) return;
  const { p, ch } = f;
  if (p.author_id !== req.uid && !(ch.guild_id && can(ch.guild_id, req.uid, P.MANAGE_MESSAGES))) return bad(res, 'Só quem criou (ou um moderador) pode encerrar', 403);
  if (!p.closed_at && !(p.ends_at && p.ends_at <= Date.now())) { run('UPDATE polls SET closed_at=? WHERE id=?', Date.now(), p.id); clearTimeout(pollTimers.get(p.id)); }
  const n = get('SELECT * FROM polls WHERE id=?', p.id); pollUpdate(n);
  res.json(pollObj(n));
}));
// ---------- Galeria de clipes ----------
const CLIP_URL = /^\/files\/[a-f0-9]{24}\.(webm|mp4)\/[^/]{1,300}$/; // devolvido pelo /api/upload
const clipObj = (c, uid) => ({ id: c.id, guild_id: c.guild_id, channel_id: c.channel_id, message_id: c.message_id, title: c.title, url: c.url, size: c.size, secs: c.secs, has_audio: !!c.has_audio, created_at: c.created_at,
  author: userPub(c.author_id), streamer: c.streamer_id ? userPub(c.streamer_id) : null, fav: !!get('SELECT 1 x FROM clip_favs WHERE user_id=? AND clip_id=?', uid, c.id) });
const canEditClip = (c, uid) => c.author_id === uid || (c.guild_id && can(c.guild_id, uid, P.MANAGE_MESSAGES));
const clipAudience = (c) => { const ch = get('SELECT * FROM channels WHERE id=?', c.channel_id); return ch ? channelAudience(ch) : []; };
// a mensagem do clipe sumiu (apagada no chat, ou o vídeo foi removido dela): o clipe sai da galeria
function dropClipsOfMessage(mid) {
  for (const c of all('SELECT * FROM clips WHERE message_id=?', mid)) { const to = clipAudience(c); run('DELETE FROM clips WHERE id=?', c.id); dispatch(to, 'CLIP_DELETE', { id: c.id, guild_id: c.guild_id }); }
}
// salvar um clipe: posta a mensagem com o vídeo no chat da sala e registra na galeria
app.post('/api/channels/:id/clips', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  const url = String(req.body.url || ''), secs = Math.max(1, Math.min(600, Math.round(+req.body.secs || 0)));
  if (!CLIP_URL.test(url) || !fs.existsSync(path.join(UPLOAD_DIR, url.split('/')[2]))) return bad(res, 'Vídeo do clipe inválido');
  const streamer = req.body.streamer_id && getUser(String(req.body.streamer_id)) ? String(req.body.streamer_id) : null;
  const who = streamer ? (ch.guild_id ? (get('SELECT nickname FROM members WHERE guild_id=? AND user_id=?', ch.guild_id, streamer)?.nickname || getUser(streamer).display_name) : getUser(streamer).display_name) : 'alguém';
  const title = clean(req.body.title, 100) || `Clipe de ${who}`, size = Math.max(0, +req.body.size || 0), audio = req.body.has_audio !== false;
  const mid = newId(), now = Date.now(), name = clean(req.body.name, 200) || 'clipe.webm';
  run('INSERT INTO messages(id,channel_id,author_id,content,created_at,attachments) VALUES(?,?,?,?,?,?)', mid, ch.id, req.uid, `🎬 Clipe de ${secs}s da transmissão de ${who}`, now, JSON.stringify([{ url, name, size, type: url.endsWith('.mp4') ? 'video/mp4' : 'video/webm' }]));
  run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', req.uid, ch.id, mid);
  const cid = newId();
  run('INSERT INTO clips(id,guild_id,channel_id,message_id,author_id,streamer_id,title,url,size,secs,has_audio,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', cid, ch.guild_id, ch.id, mid, req.uid, streamer, title, url, size, secs, audio ? 1 : 0, now);
  const to = channelAudience(ch), msg = { ...messageObj(get('SELECT * FROM messages WHERE id=?', mid)), guild_id: ch.guild_id, mentions: [] };
  dispatch(to, 'MESSAGE_CREATE', msg);
  const c = get('SELECT * FROM clips WHERE id=?', cid);
  for (const u of to) dispatch([u], 'CLIP_CREATE', clipObj(c, u));
  res.json({ clip: clipObj(c, req.uid), message: msg });
}));
// lista da galeria do servidor: todos | meus | favoritos, busca no título/nome, mais novos primeiro, 30 por página
app.get('/api/guilds/:id/clips', auth, wrap((req, res) => {
  const gid = req.params.id;
  if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, req.uid)) return bad(res, 'Sem permissão', 403);
  const where = ['c.guild_id=?'], args = [gid];
  if (req.query.filter === 'mine') { where.push('(c.author_id=? OR c.streamer_id=?)'); args.push(req.uid, req.uid); }
  if (req.query.filter === 'fav') { where.push('EXISTS(SELECT 1 FROM clip_favs f WHERE f.clip_id=c.id AND f.user_id=?)'); args.push(req.uid); }
  const q = clean(req.query.q, 60);
  if (q) { const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%'; where.push("(c.title LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM users u WHERE u.id IN (c.author_id, c.streamer_id) AND (u.display_name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')))"); args.push(like, like, like); }
  if (req.query.before) { where.push('c.id < ?'); args.push(String(req.query.before)); }
  const list = all(`SELECT c.* FROM clips c WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT 30`, ...args);
  res.json({ clips: list.map(c => clipObj(c, req.uid)), total: get('SELECT COUNT(*) n FROM clips WHERE guild_id=?', gid).n });
}));
const clipFor = (req, res) => { const c = get('SELECT * FROM clips WHERE id=?', req.params.id); if (!c || !canAccessChannel(req.uid, get('SELECT * FROM channels WHERE id=?', c.channel_id))) { bad(res, 'Clipe não encontrado', 404); return null; } return c; };
app.patch('/api/clips/:id', auth, wrap((req, res) => {
  const c = clipFor(req, res); if (!c) return;
  if (!canEditClip(c, req.uid)) return bad(res, 'Sem permissão', 403);
  const title = clean(req.body.title, 100); if (!title) return bad(res, 'Dê um nome ao clipe');
  run('UPDATE clips SET title=? WHERE id=?', title, c.id);
  const n = get('SELECT * FROM clips WHERE id=?', c.id);
  for (const u of clipAudience(n)) dispatch([u], 'CLIP_UPDATE', clipObj(n, u));
  res.json(clipObj(n, req.uid));
}));
app.put('/api/clips/:id/fav', auth, wrap((req, res) => { const c = clipFor(req, res); if (!c) return; run('INSERT OR IGNORE INTO clip_favs VALUES(?,?)', req.uid, c.id); res.json(clipObj(c, req.uid)); }));
app.delete('/api/clips/:id/fav', auth, wrap((req, res) => { const c = clipFor(req, res); if (!c) return; run('DELETE FROM clip_favs WHERE user_id=? AND clip_id=?', req.uid, c.id); res.json(clipObj(c, req.uid)); }));
// apagar o clipe: some da galeria, a mensagem sai do chat e o arquivo é removido se nada mais usa
app.delete('/api/clips/:id', auth, wrap((req, res) => {
  const c = clipFor(req, res); if (!c) return;
  if (!canEditClip(c, req.uid)) return bad(res, 'Sem permissão', 403);
  const ch = get('SELECT * FROM channels WHERE id=?', c.channel_id), to = channelAudience(ch);
  run('DELETE FROM clips WHERE id=?', c.id);
  if (c.message_id && get('SELECT 1 x FROM messages WHERE id=?', c.message_id)) { run('DELETE FROM messages WHERE id=?', c.message_id); dispatch(to, 'MESSAGE_DELETE', { id: c.message_id, channel_id: ch.id, guild_id: ch.guild_id }); }
  if (c.author_id !== req.uid) audit(c.guild_id, req.uid, 'message_delete', c.author_id, `clipe "${c.title}"`);
  dispatch(to, 'CLIP_DELETE', { id: c.id, guild_id: c.guild_id });
  unlinkIfUnused(c.url);
  res.json({});
}));
// apaga o arquivo do disco se nada mais usa (mensagens, perfis, emojis, sons, servidores, clipes)
function unlinkIfUnused(url) {
  const fname = path.basename(String(url).split('/')[2] || '');
  const like = '%' + fname.replace(/[%_\\]/g, '\\$&') + '%', used = (sql) => get(sql + " LIKE ? ESCAPE '\\'", like);
  if (fname && !used('SELECT 1 x FROM messages WHERE attachments') && !used('SELECT 1 x FROM users WHERE avatar') && !used('SELECT 1 x FROM users WHERE banner') && !used('SELECT 1 x FROM users WHERE settings')
    && !used('SELECT 1 x FROM emojis WHERE url') && !used('SELECT 1 x FROM sounds WHERE url') && !used('SELECT 1 x FROM guilds WHERE icon') && !used('SELECT 1 x FROM guilds WHERE banner') && !used('SELECT 1 x FROM clips WHERE url')) fs.unlink(path.join(UPLOAD_DIR, fname), () => { });
}
function setPin(req, res, v) {
  const ch = channelFor(req, res); if (!ch) return;
  if (ch.guild_id && !can(ch.guild_id, req.uid, P.MANAGE_MESSAGES)) return bad(res, 'Sem permissão', 403);
  const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
  if (!m) return bad(res, 'Mensagem não encontrada', 404);
  run('UPDATE messages SET pinned=? WHERE id=?', v, m.id);
  dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', m.id)), guild_id: ch.guild_id });
  res.json({});
}
app.put('/api/channels/:id/pins/:mid', auth, wrap((req, res) => setPin(req, res, 1)));
app.delete('/api/channels/:id/pins/:mid', auth, wrap((req, res) => setPin(req, res, 0)));
function reaction(req, res, add) {
  const ch = channelFor(req, res); if (!ch) return;
  const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
  if (!m) return bad(res, 'Mensagem não encontrada', 404);
  const emoji = clean(req.params.emoji, 64);
  if (add && timedOut(ch.guild_id, req.uid)) return bad(res, 'Você está de castigo neste servidor', 403);
  if (add) run('INSERT OR IGNORE INTO reactions VALUES(?,?,?)', m.id, req.uid, emoji);
  else run('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, req.uid, emoji);
  dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', m.id)), guild_id: ch.guild_id });
  res.json({});
}
app.put('/api/channels/:id/messages/:mid/reactions/:emoji', auth, wrap((req, res) => reaction(req, res, true)));
app.delete('/api/channels/:id/messages/:mid/reactions/:emoji', auth, wrap((req, res) => reaction(req, res, false)));
app.post('/api/channels/:id/ack', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  const last = get('SELECT MAX(id) m FROM messages WHERE channel_id=?', ch.id).m;
  if (last) run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', req.uid, ch.id, last);
  res.json({});
}));

// DMs & relationships
// DM entre duas pessoas (cria se não existir) e avisa as duas
function ensureDm(a, b) {
  let ch = get(`SELECT c.* FROM channels c WHERE c.type=1 AND EXISTS(SELECT 1 FROM dm_participants WHERE channel_id=c.id AND user_id=?) AND EXISTS(SELECT 1 FROM dm_participants WHERE channel_id=c.id AND user_id=?)`, a, b);
  if (!ch) {
    const id = newId();
    run('INSERT INTO channels(id,type,name,created_at) VALUES(?,1,NULL,?)', id, Date.now());
    run('INSERT INTO dm_participants VALUES(?,?)', id, a); run('INSERT INTO dm_participants VALUES(?,?)', id, b);
    ch = get('SELECT * FROM channels WHERE id=?', id);
  }
  const o = dmChannelObj(ch);
  dispatch([a, b], 'DM_CREATE', o);
  return o;
}
// mensagem simples numa DM, em nome de quem envia (usada pelo convite para a chamada)
function postDm(from, to, content) {
  const dm = ensureDm(from, to), ch = get('SELECT * FROM channels WHERE id=?', dm.id), id = newId();
  run('INSERT INTO messages(id,channel_id,author_id,content,created_at) VALUES(?,?,?,?,?)', id, ch.id, from, content, Date.now());
  run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', from, ch.id, id);
  dispatch(channelAudience(ch), 'MESSAGE_CREATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', id)), guild_id: null, mentions: [] });
}
app.post('/api/dms', auth, wrap((req, res) => {
  const other = String(req.body.user_id);
  if (!getUser(other) || other === req.uid) return bad(res, 'Usuário inválido');
  res.json(ensureDm(req.uid, other));
}));
function setRel(a, b, type) {
  if (type == null) run('DELETE FROM relationships WHERE user_id=? AND other_id=?', a, b);
  else run('INSERT INTO relationships VALUES(?,?,?) ON CONFLICT(user_id,other_id) DO UPDATE SET type=excluded.type', a, b, type);
  dispatch([a], 'RELATIONSHIP', { user: userPub(b), type: type ?? 0 });
  activity.onFriendsChanged(a, b);
}
app.post('/api/relationships', auth, wrap((req, res) => {
  const t = get('SELECT * FROM users WHERE username=?', clean(req.body.username, 32));
  if (!t) return bad(res, 'Usuário não encontrado', 404);
  if (t.id === req.uid) return bad(res, 'Você não pode adicionar a si mesmo');
  if (t.friend_policy === 'none' && !get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=4', t.id, req.uid)) return bad(res, 'Este usuário não está aceitando pedidos de amizade', 403);
  const ex = get('SELECT type FROM relationships WHERE user_id=? AND other_id=?', req.uid, t.id);
  if (ex && ex.type === 1) return bad(res, 'Vocês já são amigos');
  if (get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=2', t.id, req.uid)) return bad(res, 'Não foi possível enviar o pedido', 403);
  const incoming = ex && ex.type === 3;
  setRel(req.uid, t.id, incoming ? 1 : 4); setRel(t.id, req.uid, incoming ? 1 : 3);
  res.json({});
}));
app.put('/api/relationships/:id', auth, wrap((req, res) => { // aceitar / bloquear
  const o = req.params.id;
  if (!getUser(o) || o === req.uid) return bad(res, 'Usuário não encontrado', 404);
  if (req.body.type === 2) { setRel(req.uid, o, 2); setRel(o, req.uid, null); }
  else if (get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=3', req.uid, o)) { setRel(req.uid, o, 1); setRel(o, req.uid, 1); }
  else return bad(res, 'Sem pedido pendente');
  res.json({});
}));
app.delete('/api/relationships/:id', auth, wrap((req, res) => {
  const o = req.params.id, mine = get('SELECT type FROM relationships WHERE user_id=? AND other_id=?', req.uid, o);
  setRel(req.uid, o, null);
  if (!mine || mine.type !== 2) setRel(o, req.uid, null);
  res.json({});
}));
app.get('/api/users/:id', auth, wrap((req, res) => {
  const u = getUser(req.params.id); if (!u) return bad(res, 'Não encontrado', 404);
  const mutual = all('SELECT g.id,g.name,g.icon FROM members a JOIN members b ON a.guild_id=b.guild_id JOIN guilds g ON g.id=a.guild_id WHERE a.user_id=? AND b.user_id=?', req.uid, u.id);
  const friends = u.id === req.uid ? [] : all('SELECT a.other_id id FROM relationships a JOIN relationships b ON b.other_id=a.other_id WHERE a.user_id=? AND b.user_id=? AND a.type=1 AND b.type=1', req.uid, u.id).map(r => getUser(r.id)).filter(Boolean).map(pubUser);
  res.json({ ...pubUser(u), mutual_guilds: mutual, mutual_friends: friends });
}));

// Tradução
const trRate = new Map();
app.get('/api/translate/info', auth, (req, res) => res.json({ enabled: translateEnabled, engine: engineName }));
app.post('/api/translate', auth, wrap(async (req, res) => {
  if (!translateEnabled) return bad(res, 'Tradução desativada neste servidor', 403);
  const now = Date.now(), hits = (trRate.get(req.uid) || []).filter(t => now - t < 60000);
  if (hits.length >= 40) return bad(res, 'Muitas traduções seguidas, aguarde um pouco', 429);
  hits.push(now); trRate.set(req.uid, hits);
  try { res.json(await translate(req.body.text, String(req.body.to || ''), req.body.from ? String(req.body.from) : '')); }
  catch (e) { bad(res, e.message, 502); }
}));

// Uploads (corpo bruto)
app.post('/api/upload', auth, (req, res) => {
  const name = clean(req.query.name, 200).replace(/[\\/\0]/g, '_') || 'arquivo';
  const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
  const fname = crypto.randomBytes(12).toString('hex') + ext;
  const fp = path.join(UPLOAD_DIR, fname);
  const out = fs.createWriteStream(fp);
  let size = 0, aborted = false;
  req.on('data', c => {
    size += c.length;
    if (size > MAX_UPLOAD && !aborted) {
      aborted = true; req.unpipe(out); out.destroy(); fs.unlink(fp, () => { });
      bad(res, 'Arquivo muito grande', 413);
    }
  });
  req.pipe(out);
  out.on('finish', () => { if (!aborted) res.json({ url: `/files/${fname}/${encodeURIComponent(name)}`, name, size, type: clean(req.headers['content-type'], 100) }); });
  out.on('error', () => { if (!res.headersSent) bad(res, 'Falha no upload', 500); });
});
const SAFE_INLINE = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm|mp4)|text\/plain|application\/pdf)$/;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.pdf': 'application/pdf', '.txt': 'text/plain' };
app.get('/files/:f/:name?', (req, res) => {
  const f = path.basename(req.params.f), p = path.join(UPLOAD_DIR, f);
  if (!fs.existsSync(p)) return res.sendStatus(404);
  const mime = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.type(mime);
  if (!SAFE_INLINE.test(mime) || req.query.download) res.attachment(req.params.name || f);
  res.sendFile(f, { root: UPLOAD_DIR, dotfiles: 'allow' });
});

// ---- transmissão nativa (teste de 120 FPS): gera um código com IP, porta UDP e ssrc; o programa de captura no PC
// manda o H.264 para lá. O app de quem gerou assiste a própria transmissão pelo servidor e mede os FPS. ----
const natives = new Map(); // uid -> sessão
function endNative(uid, why) {
  const n = natives.get(uid); if (process.env.DEBUG_NATIVE) console.log('endNative', uid, why, n?.producer.id); if (!n) return;
  natives.delete(uid); clearInterval(n.timer); n.close();
  dispatch([uid], 'NATIVE_SCREEN_END', { producer_id: n.producer.id, reason: why });
}
// live: transmissão de verdade (o programa repete o último quadro com a tela parada, então 6 s sem pacotes = parou)
// test: o pacote de teste (código colado à mão): até 10 min para começar e no máximo 30 min
async function startNative(uid, cid, live, layers = 1) {
  endNative(uid, 'replaced');
  const n = await sfuAttachNative(cid, uid, layers);
  n.host = process.env.RTC_ANNOUNCED_IP ? process.env.RTC_ANNOUNCED_IP.split(',')[0].trim() : (n.ip && n.ip !== '0.0.0.0' ? n.ip : null);
  n.started = 0; n.last = 0; n.bytes = 0; n.t0 = Date.now();
  n.timer = setInterval(async () => {
    if (n.producer.closed) return endNative(uid, 'closed');
    const st = await n.producer.getStats().catch(() => []), b = st.reduce((x, e) => x + (e.byteCount || 0), 0), now = Date.now();
    if (b > n.bytes) { n.bytes = b; n.last = now; if (!n.started) n.started = now; }
    if (!n.started && now - n.t0 > (live ? 60_000 : 10 * 60_000)) endNative(uid, 'timeout');
    else if (n.started && now - n.last > 6000) endNative(uid, 'stopped');
    else if (!live && now - n.t0 > 30 * 60_000) endNative(uid, 'limit');
  }, 2000);
  natives.set(uid, n); if (process.env.DEBUG_NATIVE) console.log('startNative', uid, n.producer.id);
  n.producer.observer.on('close', () => { if (natives.get(uid) === n) endNative(uid, 'closed'); });
  return n;
}
const nativeOut = (n, host) => ({ producer_id: n.producer.id, host: n.host || host, port: n.port, ssrc: n.ssrc, ssrcs: n.ssrcs, pt: n.payloadType, key: n.key, serverKey: n.serverKey });
app.post('/api/native-screen', auth, (req, res) => (async () => {
  const cid = currentVoice(req.uid);
  if (!cid) return bad(res, 'Entre numa sala de voz primeiro');
  if (!sfuEnabled()) return bad(res, 'O servidor de voz (SFU) está desligado');
  const o = nativeOut(await startNative(req.uid, cid, false), req.hostname);
  res.json({ ...o, code: `LC120 ${o.host} ${o.port} ${o.ssrc} ${o.pt} ${o.key} ${o.serverKey}` });
})().catch(e => { console.error('native-screen', e); if (!res.headersSent) bad(res, 'Não consegui preparar a transmissão: ' + e.message, 500); }));
app.post('/api/native-screen/stop', auth, (req, res) => { endNative(req.uid, 'stopped'); res.json({ ok: true }); });

app.get('/api/sfu/load', auth, (req, res) => { // só donos de servidor: carga do worker do mediasoup
  if (!get('SELECT 1 AS x FROM guilds WHERE owner_id=?', req.uid)) return bad(res, 'Sem permissão', 403);
  sfuLoad().then(d => res.json(d), e => bad(res, e.message, 500));
});
// ---- integrações com plataformas de jogos (Fase 1): vincular/desvincular/privacidade. A API da plataforma fica isolada em server/integrations/* ----
const activity = createActivityService({ all, get, run, newId, dispatch, isOnline: (u) => conns.has(u), getAdapter, listAdapters, notifyAccount: (u, p) => dispatch([u], 'INTEGRATION_UPDATE', { platform: p, account: accountPub(accountOf(u, p)) }), log: console.log });
const linkStates = new Map(); // state -> { uid, platform, returnTo, exp } (uso único, 10 min)
const publicBase = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const accountPub = (a) => !a ? null : ({ platform: a.platform, external_id: a.external_id, display_name: a.display_name, avatar: a.avatar, profile_url: a.profile_url, visibility: a.visibility, link_visibility: a.link_visibility, linked_at: a.linked_at, last_sync: a.last_sync, sync_state: a.sync_state });
const accountOf = (uid, platform) => get('SELECT * FROM linked_accounts WHERE user_id=? AND platform=?', uid, platform);
app.get('/api/integrations', auth, wrap((req, res) => {
  res.json(listAdapters().map(ad => ({ id: ad.id, name: ad.name, capabilities: ad.capabilities, configured: ad.configured(), account: accountPub(accountOf(req.uid, ad.id)) })));
}));
app.post('/api/integrations/:platform/link', auth, wrap((req, res) => {
  const ad = getAdapter(req.params.platform); if (!ad) return bad(res, 'Plataforma desconhecida', 404);
  const now = Date.now(); for (const [k, v] of linkStates) if (v.exp < now || (v.uid === req.uid && v.platform === ad.id)) linkStates.delete(k); // só um pedido pendente por conta
  const state = crypto.randomBytes(24).toString('hex'), base = publicBase(req);
  const returnTo = `${base}/api/integrations/${ad.id}/callback?state=${state}`;
  linkStates.set(state, { uid: req.uid, platform: ad.id, returnTo, exp: now + 10 * 60 * 1000 });
  res.json({ url: ad.startLink({ returnTo, realm: base }) });
}));
app.get('/api/integrations/:platform/callback', (req, res) => { // aberto: quem chama é o navegador voltando da plataforma; o 'state' liga ao usuário
  const page = (ok, msg) => res.status(ok ? 200 : 400).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LocalCord</title><body style="font-family:system-ui;background:#1e1f22;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0"><div style="text-align:center;max-width:420px;padding:24px"><h2>${ok ? '✅' : '⚠️'} ${String(msg).replace(/[<>&]/g, '')}</h2><p style="opacity:.7">${ok ? 'Pode fechar esta janela e voltar ao LocalCord.' : 'Feche esta janela e tente vincular de novo pelo LocalCord.'}</p></div></body>`);
  const ad = getAdapter(req.params.platform), state = String(req.query.state || ''), st = linkStates.get(state);
  if (!ad || !st || st.platform !== ad.id) return page(false, 'Pedido expirado ou inválido');
  linkStates.delete(state); // uso único
  if (st.exp < Date.now()) return page(false, 'Pedido expirado');
  ad.finishLink(req.query, { returnTo: st.returnTo }).then(({ external_id }) => {
    const other = get('SELECT user_id FROM linked_accounts WHERE platform=? AND external_id=?', ad.id, external_id);
    if (other && other.user_id !== st.uid) return page(false, 'Esta conta já está vinculada a outro usuário');
    run('DELETE FROM linked_accounts WHERE user_id=? AND platform=?', st.uid, ad.id);
    run('INSERT INTO linked_accounts(user_id,platform,external_id,visibility,linked_at,sync_state) VALUES(?,?,?,?,?,?)', st.uid, ad.id, external_id, 'friends', Date.now(), 'pending');
    dispatch([st.uid], 'INTEGRATION_UPDATE', { platform: ad.id, account: accountPub(accountOf(st.uid, ad.id)) });
    activity.onLinked();
    page(true, 'Conta ' + ad.name + ' vinculada!');
  }).catch(e => page(false, e.message || 'Falha ao vincular'));
});
app.patch('/api/integrations/:platform', auth, wrap((req, res) => {
  const a = accountOf(req.uid, req.params.platform); if (!a) return bad(res, 'Conta não vinculada', 404);
  const { visibility, link_visibility } = req.body || {};
  if (visibility !== undefined && !['friends', 'off'].includes(visibility)) return bad(res, 'Visibilidade inválida');
  if (link_visibility !== undefined && !['friends', 'off'].includes(link_visibility)) return bad(res, 'Visibilidade inválida');
  if (visibility === undefined && link_visibility === undefined) return bad(res, 'Nada para alterar');
  if (visibility !== undefined && visibility !== a.visibility) { activity.onVisibility(req.uid, a.platform, visibility); run('UPDATE linked_accounts SET visibility=? WHERE user_id=? AND platform=?', visibility, req.uid, a.platform); }
  if (link_visibility !== undefined) run('UPDATE linked_accounts SET link_visibility=? WHERE user_id=? AND platform=?', link_visibility, req.uid, a.platform);
  dispatch([req.uid], 'INTEGRATION_UPDATE', { platform: a.platform, account: accountPub(accountOf(req.uid, a.platform)) });
  res.json(accountPub(accountOf(req.uid, a.platform)));
}));
app.delete('/api/integrations/:platform', auth, wrap((req, res) => {
  const p = req.params.platform; if (!getAdapter(p)) return bad(res, 'Plataforma desconhecida', 404);
  const cur = accountOf(req.uid, p); if (cur) activity.onUnlinking(req.uid, p, cur.external_id);
  run('DELETE FROM linked_accounts WHERE user_id=? AND platform=?', req.uid, p);
  run('DELETE FROM activities WHERE user_id=? AND platform=?', req.uid, p); run('DELETE FROM game_prefs WHERE user_id=? AND platform=?', req.uid, p);
  dispatch([req.uid], 'INTEGRATION_UPDATE', { platform: p, account: null });
  res.json({});
}));
app.get('/api/activity/feed', auth, wrap((req, res) => { // amigos (e você), o que estão jogando e eventos recentes — tudo filtrado por activity.canSee
  const f = activity.feedFor(req.uid), ids = f.friends.map(x => x.user_id);
  res.json({ ...f, users: ids.map(id => userPub(id)) });
}));
app.put('/api/activity/games/:platform/:gameId', auth, wrap((req, res) => { // esconder/mostrar um jogo (nunca vira atividade)
  const platform = req.params.platform, gid = clean(req.params.gameId, 40);
  if (!getAdapter(platform) || !accountOf(req.uid, platform)) return bad(res, 'Conta não vinculada', 404);
  const hidden = req.body?.hidden ? 1 : 0;
  run('INSERT INTO game_prefs(user_id,platform,game_id,hidden) VALUES(?,?,?,?) ON CONFLICT(user_id,platform,game_id) DO UPDATE SET hidden=excluded.hidden', req.uid, platform, gid, hidden);
  if (hidden) activity.onGameHidden(req.uid, platform, gid);
  res.json({ hidden: !!hidden });
}));
app.get('/api/activity/hidden', auth, wrap((req, res) => res.json(all('SELECT gp.platform, gp.game_id, (SELECT a.title FROM activities a WHERE a.user_id=gp.user_id AND a.platform=gp.platform AND a.game_id=gp.game_id ORDER BY a.created_at DESC LIMIT 1) title FROM game_prefs gp WHERE gp.user_id=? AND gp.hidden=1', req.uid))));
app.get('/api/server-info', (req, res) => res.json({ name: 'LocalCord', registration: OPEN_REGISTRATION, default_avatars: DEFAULT_AVATARS }));
if (process.env.STATIC_OFF !== '1') mountStatic(app, path.join(__dirname, '..', 'public')); // comprimido, versionado e com modulepreload (server/static.js)
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.get(/^\/(?!api|files|gateway).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// ---------- Gateway (WebSocket) ----------
const server = http.createServer(app);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
const onUpgrade = (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/gateway') return socket.destroy();
  const s = get('SELECT user_id FROM sessions WHERE token=?', url.searchParams.get('token') || '');
  if (!s) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => { ws.uid = s.user_id; ws.token = url.searchParams.get('token'); wss.emit('connection', ws); });
};
server.on('upgrade', onUpgrade);

const iceServers = () => {
  const s = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) s.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  return s;
};
function buildReady(uid) {
  const guilds = all('SELECT guild_id FROM members WHERE user_id=?', uid).map(r => guildFull(r.guild_id));
  const dms = all('SELECT c.* FROM channels c JOIN dm_participants p ON p.channel_id=c.id WHERE p.user_id=? AND c.type=1', uid).map(dmChannelObj);
  const chIds = [...guilds.flatMap(g => g.channels.filter(c => c.type === 0 || c.type === 2).map(c => c.id)), ...dms.map(d => d.id)];
  const dmVoice = [];
  for (const d of dms) for (const [uid, s] of voice.get(d.id) || []) dmVoice.push(vsObj(d.id, uid, s));
  const unread = {};
  for (const id of chIds) {
    const rs = get('SELECT last_id FROM read_states WHERE user_id=? AND channel_id=?', uid, id);
    const n = get('SELECT COUNT(*) n, MAX(id) l FROM messages WHERE channel_id=? AND id>? AND author_id<>?', id, rs?.last_id || '0', uid);
    if (n.n) unread[id] = { count: n.n, last_id: n.l };
  }
  return { user: pubUser(getUser(uid)), guilds, dms, relationships: relObj(uid), activities: activity.readyFor(uid), unread, dm_voice: dmVoice, ice: iceServers() };
}

// espectadores de transmissões: "canal:transmissor" -> Set de quem está assistindo
const watchers = new Map();
function pushViewers(cid, streamer) {
  const set = watchers.get(cid + ':' + streamer), m = voice.get(cid); if (!m) return;
  const d = { channel_id: cid, streamer_id: streamer, viewers: set ? [...set] : [] };
  for (const [, s] of m) send(s.ws, 'STREAM_VIEWERS', d);
}
function dropWatching(uid, cid) { // tira uid das transmissões que assistia e encerra a dele
  for (const [k, set] of [...watchers]) {
    if (!k.startsWith(cid + ':')) continue;
    const streamer = k.slice(cid.length + 1);
    if (streamer === uid) { watchers.delete(k); pushViewers(cid, streamer); }
    else if (set.delete(uid)) { if (!set.size) watchers.delete(k); pushViewers(cid, streamer); }
  }
}
function leaveVoice(uid, cid) {
  const m = voice.get(cid); if (!m || !m.has(uid)) return;
  remote.onLeave(uid); // controle remoto acaba antes de qualquer outra coisa
  m.delete(uid); dropWatching(uid, cid); if (!m.size) { voice.delete(cid); roomStart.delete(cid); acts.delete(cid); }
  else { const a = acts.get(cid); if (a?.spot && (a.spot.slice(2) === uid)) { a.spot = a.spotBy = null; roomSend(cid, 'ROOM_STATE', actState(cid)); } } // quem estava em destaque saiu
  sfuLeave(cid, uid);
  const ch = get('SELECT * FROM channels WHERE id=?', cid);
  if (ch) dispatch(channelAudience(ch), 'VOICE_STATE', { channel_id: null, prev_channel_id: cid, user_id: uid, guild_id: ch.guild_id });
  for (const [, s] of m) send(s.ws, 'VOICE_PEER_LEFT', { channel_id: cid, user_id: uid });
  musicOnLeave(cid);
}
// Bot de música: participante sem conexão WebSocket (ws "morto" faz send() ser ignorado)
async function joinBot(cid, botId) {
  if (!voice.has(cid)) { voice.set(cid, new Map()); roomStart.set(cid, Date.now()); }
  const st = { ws: { readyState: 0 }, mute: false, deaf: false, video: false, screen: false };
  voice.get(cid).set(botId, st);
  const ch = get('SELECT * FROM channels WHERE id=?', cid);
  dispatch(channelAudience(ch), 'VOICE_STATE', { ...vsObj(cid, botId, st), guild_id: ch.guild_id });
  await sfuJoin(cid, botId, () => { });
}
initMusic({ get, run, newId, voice, send, dispatch, guildMemberIds, memberObj, userPub, joinBot, leaveBot: (cid, botId) => leaveVoice(botId, cid), attachRtp: sfuAttachRtp, sfuEnabled });
// Controle remoto (server/remote.js). Pedido, resposta e comandos só valem da conexão que está na chamada.
const remote = createRemote({
  newId,
  voiceOf: (uid) => { const c = currentVoice(uid); return c ? { cid: c, screen: !!voice.get(c).get(uid).screen } : null; },
  sendUser: (uid, type, d) => { const c = currentVoice(uid), st = c && voice.get(c).get(uid); if (st?.ws?.readyState === 1) send(st.ws, type, d); else dispatch([uid], type, d); },
});
function currentVoice(uid) { for (const [cid, m] of voice) if (m.has(uid)) return cid; return null; }

wss.on('connection', (ws) => {
  const uid = ws.uid;
  const first = !conns.has(uid);
  if (first) conns.set(uid, new Set());
  conns.get(uid).add(ws);
  send(ws, 'READY', buildReady(uid));
  if (first) { broadcastPresence(uid); activity.poke(); }
  ws.alive = true; ws.on('pong', () => (ws.alive = true));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const d = msg.d || {};
    try {
      switch (msg.t) {
        case 'PING': send(ws, 'PONG', { n: d.n }); break; // medida de latência do cliente
        case 'TYPING': {
          const ch = get('SELECT * FROM channels WHERE id=?', String(d.channel_id));
          if (canAccessChannel(uid, ch)) dispatch(channelAudience(ch).filter(x => x !== uid), 'TYPING', { channel_id: ch.id, user_id: uid });
          break;
        }
        case 'VOICE_JOIN': {
          const ch = get('SELECT * FROM channels WHERE id=?', String(d.channel_id));
          if (!ch || (ch.type !== 2 && ch.type !== 1) || !canAccessChannel(uid, ch)) return;
          if (timedOut(ch.guild_id, uid)) return send(ws, 'VOICE_DENIED', { channel_id: ch.id, reason: 'Você está de castigo neste servidor' });
          const prev = currentVoice(uid); if (prev) leaveVoice(uid, prev);
          if (!voice.has(ch.id)) { voice.set(ch.id, new Map()); roomStart.set(ch.id, Date.now()); }
          const room = voice.get(ch.id);
          const peers = [...room.keys()];
          const st = { ws, mute: false, deaf: false, video: false, screen: false };
          room.set(uid, st);
          if (!sfuEnabled()) send(ws, 'VOICE_JOINED', { channel_id: ch.id, peers });
          dispatch(channelAudience(ch), 'VOICE_STATE', { ...vsObj(ch.id, uid, st), guild_id: ch.guild_id });
          musicOnJoin(ch.id, ws);
          if (acts.has(ch.id)) send(ws, 'ROOM_STATE', actState(ch.id));
          for (const k of watchers.keys()) if (k.startsWith(ch.id + ':')) pushViewers(ch.id, k.slice(ch.id.length + 1));
          if (!sfuEnabled()) break;
          sfuJoin(ch.id, uid, (t, x) => send(ws, t, { ...x, channel_id: ch.id })).then(sfu => {
            if (voice.get(ch.id)?.get(uid) !== st) return sfuLeave(ch.id, uid); // saiu enquanto entrava
            send(ws, 'VOICE_JOINED', { channel_id: ch.id, peers, sfu });
          }).catch(e => console.error('sfu join', e));
          break;
        }
        case 'SFU': { // sinalização do SFU: requisição/resposta
          const c = currentVoice(uid), rid = d.rid;
          if (!c || voice.get(c).get(uid).ws !== ws) return send(ws, 'SFU_RES', { rid, error: 'fora da sala' });
          if (d.op === 'native_start') { // transmissão a 120 fps pelo programa nativo do app desktop (só o vídeo; áudio segue pelo WebRTC)
            startNative(uid, c, true, Math.max(1, Math.min(3, d.layers | 0 || 1))).then(n => send(ws, 'SFU_RES', { rid, data: nativeOut(n, null) }), e => send(ws, 'SFU_RES', { rid, error: e.message }));
            break;
          }
          if (d.op === 'native_stop') { if (!d.producer_id || natives.get(uid)?.producer.id === String(d.producer_id)) endNative(uid, 'stopped'); send(ws, 'SFU_RES', { rid, data: {} }); break; }
          sfuRequest(c, uid, String(d.op), d).then(data => send(ws, 'SFU_RES', { rid, data }), e => send(ws, 'SFU_RES', { rid, error: e.message }));
          break;
        }
        case 'MUSIC': { // bot de música: tocar, pular, pausar, remover da fila, tirar da chamada
          const c = currentVoice(uid); if (!c) return;
          musicHandle(uid, c, d).then(data => send(ws, 'MUSIC_RES', { rid: d.rid, data }), e => send(ws, 'MUSIC_RES', { rid: d.rid, error: e.message }));
          break;
        }
        case 'SOUNDBOARD': { // toca um som para todos na sala de voz
          const c = currentVoice(uid); if (!c) return;
          const url = String(d.url || ''); if (!url.startsWith('/files/')) return;
          if (Date.now() - (ws.lastSb || 0) < 1200) return; ws.lastSb = Date.now();
          const msg = { user_id: uid, channel_id: c, url, volume: Math.max(1, Math.min(200, +d.volume || 100)), name: clean(d.name, 32), emoji: clean(d.emoji, 16) };
          for (const [, st] of voice.get(c)) send(st.ws, 'SOUNDBOARD', msg);
          break;
        }
        case 'STREAM_WATCH': { // quem assiste à transmissão de quem
          const c = currentVoice(uid); if (!c) return;
          const target = String(d.target || ''), room = voice.get(c);
          if (target === uid || !room.get(target)?.screen) return;
          const k = c + ':' + target, set = watchers.get(k) || new Set();
          if (d.watching) set.add(uid); else set.delete(uid);
          if (set.size) watchers.set(k, set); else watchers.delete(k);
          pushViewers(c, target);
          break;
        }
        case 'ROOM_ACT': { // abre/fecha a lousa ou o editor de código para a sala toda
          const c = currentVoice(uid); if (!c) return;
          const a = actOf(c), on = !!d.on;
          if (d.act === 'wb') { a.wb = on; if (!on) delete a.boards.wb; }
          else if (d.act === 'code') a.code = on ? (a.code || { text: '', lang: 'javascript' }) : null;
          else return;
          roomSend(c, 'ROOM_STATE', actState(c));
          break;
        }
        case 'ROOM_SPOTLIGHT': { // destaca uma transmissão/câmera para a sala toda (quem quiser acompanha); d.key = 's:<uid>' | 'c:<uid>' | null
          const c = currentVoice(uid); if (!c) return;
          const a = actOf(c), key = d.key == null ? null : String(d.key);
          if (key !== null) { const m = /^([sc]):(.+)$/.exec(key), st = m && voice.get(c).get(m[2]); if (!st || (m[1] === 's' ? !st.screen : !st.video)) return; }
          if (ws.lastSpot && Date.now() - ws.lastSpot < 500) return; ws.lastSpot = Date.now();
          a.spot = key; a.spotBy = key ? uid : null;
          roomSend(c, 'ROOM_STATE', actState(c));
          break;
        }
        case 'ROOM_DRAW': { // traços da lousa / anotações sobre uma transmissão
          const c = currentVoice(uid); if (!c) return;
          const board = String(d.board || ''); if (!BOARD_OK(board)) return;
          const a = actOf(c); if (board === 'wb' && !a.wb) return;
          const list = a.boards[board] || (a.boards[board] = []); let out = null, ids;
          if (d.op === 'clear') { a.boards[board] = []; }
          else if (d.op === 'erase' && Array.isArray(d.ids)) { const gone = new Set(d.ids.slice(0, 200).map(x => String(x).slice(0, 40))); ids = [...gone]; a.boards[board] = list.filter(s => !gone.has(s.id)); }
          else if (d.op === 'undo') { const i = list.findLastIndex(s => s.uid === uid); if (i >= 0) list.splice(i, 1); }
          else if (d.op === 'stroke' && d.stroke && Array.isArray(d.stroke.pts)) {
            const id = String(d.stroke.id || '').slice(0, 40), pts = d.stroke.pts.slice(0, 200).filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])).map(p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]);
            let s = list.find(x => x.id === id && x.uid === uid);
            if (!s) { s = { id, uid, color: /^#[0-9a-f]{6}$/i.test(d.stroke.color) ? d.stroke.color : '#ffffff', w: Math.max(1, Math.min(40, +d.stroke.w || 4)), pts: [] }; list.push(s); if (list.length > 400) list.shift(); }
            if (s.pts.length < 4000) s.pts.push(...pts);
            out = { id, color: s.color, w: s.w, pts };
          } else return;
          roomSend(c, 'ROOM_DRAW', { channel_id: c, board, op: d.op, stroke: out, ids, user_id: uid }, uid);
          break;
        }
        case 'ROOM_CODE': {
          const c = currentVoice(uid); if (!c) return;
          const a = actOf(c); if (!a.code) return;
          a.code = { text: String(d.text ?? '').slice(0, 200000), lang: String(d.lang || 'javascript').slice(0, 20) };
          roomSend(c, 'ROOM_CODE', { channel_id: c, ...a.code, user_id: uid }, uid);
          break;
        }
        case 'VOICE_LEAVE': { const c = currentVoice(uid); if (c) leaveVoice(uid, c); break; }
        case 'VOICE_STATE': {
          const c = currentVoice(uid); if (!c) return;
          const st = voice.get(c).get(uid);
          for (const k of ['mute', 'deaf', 'video', 'screen']) if (typeof d[k] === 'boolean') st[k] = d[k];
          // efeito de voz: só nomes conhecidos e no máximo 1 troca a cada 0,5 s (quem ouve aplica; ver public/voicefx.js)
          if (d.fx !== undefined && Date.now() - (st.fxAt || 0) > 500) { const fx = VOICE_FX.has(d.fx) ? d.fx : null; if (fx !== (st.fx || null)) { st.fx = fx; st.fxAt = Date.now(); } }
          if (!st.screen && acts.get(c)?.boards['s:' + uid]) { delete acts.get(c).boards['s:' + uid]; roomSend(c, 'ROOM_DRAW', { channel_id: c, board: 's:' + uid, op: 'clear', user_id: uid }); }
          { const a = acts.get(c); if (a?.spot && (!st.screen && a.spot === 's:' + uid || !st.video && a.spot === 'c:' + uid)) { a.spot = a.spotBy = null; roomSend(c, 'ROOM_STATE', actState(c)); } }
          if (!st.screen && watchers.has(c + ':' + uid)) { watchers.delete(c + ':' + uid); pushViewers(c, uid); }
          if (!st.screen) remote.onScreenOff(uid); // parou de transmitir: controle remoto acaba
          const ch = get('SELECT * FROM channels WHERE id=?', c);
          dispatch(channelAudience(ch), 'VOICE_STATE', { ...vsObj(c, uid, st), guild_id: ch.guild_id });
          break;
        }
        case 'REMOTE_REQUEST': case 'REMOTE_ANSWER': case 'REMOTE_INPUT': case 'REMOTE_STOP': {
          const c = currentVoice(uid);
          if (msg.t !== 'REMOTE_STOP' && (!c || voice.get(c).get(uid).ws !== ws)) { if (msg.t !== 'REMOTE_INPUT') send(ws, 'REMOTE_ERROR', { error: 'Entre na sala de voz neste aparelho' }); break; }
          const r = msg.t === 'REMOTE_REQUEST' ? remote.request(uid, String(d.to || ''))
            : msg.t === 'REMOTE_ANSWER' ? remote.answer(uid, d.id, { accept: d.accept === true, mouse: d.mouse === true, keyboard: d.keyboard === true, capable: d.capable !== false })
            : msg.t === 'REMOTE_INPUT' ? remote.input(uid, d.id, d.ev)
            : remote.stop(uid, d.id, d.reason === 'panic' ? 'panic' : 'stopped');
          if (r.error) send(ws, 'REMOTE_ERROR', { error: r.error });
          break;
        }
        case 'VOICE_SIGNAL': { // retransmite SDP/ICE apenas entre membros da mesma sala
          const c = currentVoice(uid); if (!c) return;
          const target = voice.get(c).get(String(d.to));
          if (target) send(target.ws, 'VOICE_SIGNAL', { from: uid, data: d.data });
          break;
        }
      }
    } catch (e) { console.error('ws', e); }
  });
  ws.on('close', () => {
    const set = conns.get(uid); set?.delete(ws);
    const c = currentVoice(uid);
    if (c && voice.get(c).get(uid).ws === ws) leaveVoice(uid, c);
    if (set && !set.size) { conns.delete(uid); broadcastPresence(uid); }
  });
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 30000);

// HTTPS com certificado autoassinado (necessário para microfone/câmera/tela fora de localhost)
function loadTls() {
  const keyP = process.env.TLS_KEY || path.join(DATA_DIR, 'key.pem'), certP = process.env.TLS_CERT || path.join(DATA_DIR, 'cert.pem');
  if (!fs.existsSync(keyP) || !fs.existsSync(certP)) {
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4').map(i => `IP:${i.address}`);
    const san = ['DNS:localhost', `DNS:${os.hostname()}`, ...ips, ...(process.env.TLS_SAN ? process.env.TLS_SAN.split(',') : [])].join(',');
    // No Windows o openssl costuma não estar no PATH; tenta também o que acompanha o Git
    const gitDirs = ['C:\\Program Files\\Git', 'C:\\Program Files (x86)\\Git'];
    const bins = ['openssl', ...(process.platform === 'win32' ? gitDirs.flatMap(d => [`${d}\\usr\\bin\\openssl.exe`, `${d}\\mingw64\\bin\\openssl.exe`]) : [])];
    let done = false;
    for (const bin of bins) {
      if (bin !== 'openssl' && !fs.existsSync(bin)) continue;
      try {
        execFileSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyP, '-out', certP, '-days', '3650', '-subj', '/CN=LocalCord', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
        console.log('  Certificado HTTPS autoassinado gerado em', DATA_DIR);
        done = true; break;
      } catch { /* tenta o próximo */ }
    }
    if (!done) { console.log('  (openssl não encontrado: HTTPS desativado. Instale openssl ou forneça TLS_KEY/TLS_CERT)'); return null; }
  }
  return { key: fs.readFileSync(keyP), cert: fs.readFileSync(certP) };
}

await startSfu();
activity.start();
server.listen(PORT, HOST, () => {
  console.log(`\n  LocalCord rodando`);
  const tls = process.env.HTTPS === '0' ? null : loadTls();
  const addrs = Object.entries(os.networkInterfaces()).flatMap(([n, l]) => (l || []).filter(i => i.family === 'IPv4' && !i.internal).map(i => [n, i.address]));
  for (const [n, a] of addrs) console.log(`   http://${a}:${PORT}   (${n})`);
  if (tls) {
    const hs = https.createServer(tls, app);
    hs.on('upgrade', onUpgrade);
    hs.listen(HTTPS_PORT, HOST, () => {
      console.log('   --- HTTPS (use este para voz/vídeo/tela; aceite o aviso do certificado) ---');
      for (const [n, a] of addrs) console.log(`   https://${a}:${HTTPS_PORT}   (${n})`);
      console.log('');
    });
    hs.on('error', (e) => console.error('HTTPS erro:', e.message));
  }
});

// Encerramento: o mediasoup registra os próprios ouvintes de SIGTERM/SIGINT (só fecha o worker), o que desliga
// a saída padrão do Node; sem isto o processo continuaria de pé e o `docker stop` esperaria 10 s até matar à força.
let stopping = false;
function shutdown(sig) {
  if (stopping) return; stopping = true;
  console.log(`  ${sig} recebido: encerrando`);
  setTimeout(() => process.exit(0), 3000).unref(); // não espera conexões presas
  try { musicStopAll(); } catch { }
  try { activity.stop(); } catch { }
  for (const c of wss.clients) try { c.close(1001, 'Servidor reiniciando'); } catch { }
  server.close();
  try { db.close(); } catch { }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
