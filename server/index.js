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
import { all, get, run, newId, UPLOAD_DIR, DATA_DIR } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024;
const OPEN_REGISTRATION = process.env.OPEN_REGISTRATION !== '0';

const P = { ADMIN: 1, MANAGE_GUILD: 2, MANAGE_CHANNELS: 4, MANAGE_MESSAGES: 8, KICK: 16, CREATE_INVITE: 32, MANAGE_ROLES: 64 };
const COLORS = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#3ba55d', '#faa61a', '#9b59b6', '#1abc9c'];

// ---------- helpers ----------
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const conns = new Map(); // userId -> Set<ws>
const voice = new Map(); // channelId -> Map<userId, {ws, mute, deaf, video, screen}>

const pubUser = (u) => u && ({
  id: u.id, username: u.username, display_name: u.display_name || u.username, avatar: u.avatar, color: u.color,
  banner_color: u.banner_color, banner: u.banner, pronouns: u.pronouns, status_emoji: u.status_emoji,
  bio: u.bio, custom_status: u.custom_status, created_at: u.created_at,
  status: conns.has(u.id) ? (u.status === 'invisible' ? 'offline' : u.status) : 'offline',
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

function memberObj(gid, uid) {
  const m = get('SELECT * FROM members WHERE guild_id=? AND user_id=?', gid, uid);
  if (!m) return null;
  return { user_id: uid, nickname: m.nickname, joined_at: m.joined_at,
    roles: all('SELECT role_id FROM member_roles WHERE guild_id=? AND user_id=?', gid, uid).map(r => r.role_id) };
}
const vsObj = (cid, uid, s) => ({ channel_id: cid, user_id: uid, mute: s.mute, deaf: s.deaf, video: s.video, screen: s.screen });
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
    reactions: Object.entries(rx).map(([emoji, users]) => ({ emoji, users })) };
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
  if (get('SELECT 1 x FROM users WHERE username=?', username)) return bad(res, 'Esse nome de usuário já existe', 409);
  const id = newId(), salt = crypto.randomBytes(16).toString('hex');
  run('INSERT INTO users(id,username,display_name,pass_hash,salt,color,created_at) VALUES(?,?,?,?,?,?,?)',
    id, username, clean(req.body.display_name, 32) || username, hashPw(pw, salt), salt, COLORS[Math.floor(Math.random() * COLORS.length)], Date.now());
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
    status_emoji: b.status_emoji !== undefined ? clean(b.status_emoji, 16) : u.status_emoji,
  };
  if (f.avatar && !String(f.avatar).startsWith('/files/')) f.avatar = u.avatar;
  run('UPDATE users SET display_name=?,bio=?,avatar=?,color=?,banner_color=?,custom_status=?,status=?,pronouns=?,banner=?,status_emoji=? WHERE id=?',
    f.display_name, f.bio, f.avatar, f.color, f.banner_color, f.custom_status, f.status, f.pronouns, f.banner, f.status_emoji, req.uid);
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
  res.json({});
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
  if (Array.isArray(req.body.roles)) {
    if (!can(gid, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
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
  res.json({ id });
}));
app.patch('/api/roles/:id', auth, wrap((req, res) => {
  const r = get('SELECT * FROM roles WHERE id=?', req.params.id);
  if (!r || !can(r.guild_id, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
  run('UPDATE roles SET name=?,color=?,perms=? WHERE id=?', clean(req.body.name, 50) || r.name, clean(req.body.color, 9) || r.color, req.body.perms !== undefined ? Number(req.body.perms) | 0 : r.perms, r.id);
  dispatch(guildMemberIds(r.guild_id), 'ROLE_UPDATE', { guild_id: r.guild_id, role: get('SELECT * FROM roles WHERE id=?', r.id) });
  res.json({});
}));
app.delete('/api/roles/:id', auth, wrap((req, res) => {
  const r = get('SELECT * FROM roles WHERE id=?', req.params.id);
  if (!r || !can(r.guild_id, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
  run('DELETE FROM roles WHERE id=?', r.id);
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
  const parent = get('SELECT id FROM channels WHERE id=? AND guild_id=? AND type=4', req.body.parent_id, gid) ? req.body.parent_id : null;
  run('INSERT INTO channels(id,guild_id,type,name,position,parent_id,created_at) VALUES(?,?,?,?,?,?,?)', id, gid, type, name, pos, parent, Date.now());
  dispatch(guildMemberIds(gid), 'CHANNEL_CREATE', get('SELECT * FROM channels WHERE id=?', id));
  res.json({ id });
}));
app.patch('/api/channels/:id', auth, wrap((req, res) => {
  const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
  if (!ch || !ch.guild_id || !can(ch.guild_id, req.uid, P.MANAGE_CHANNELS)) return bad(res, 'Sem permissão', 403);
  run('UPDATE channels SET name=?,topic=?,position=? WHERE id=?', clean(req.body.name, 100) || ch.name, req.body.topic !== undefined ? clean(req.body.topic, 1024) : ch.topic, Number.isFinite(+req.body.position) && req.body.position !== undefined ? +req.body.position : ch.position, ch.id);
  dispatch(guildMemberIds(ch.guild_id), 'CHANNEL_UPDATE', get('SELECT * FROM channels WHERE id=?', ch.id));
  res.json({});
}));
app.delete('/api/channels/:id', auth, wrap((req, res) => {
  const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
  if (!ch || !ch.guild_id || !can(ch.guild_id, req.uid, P.MANAGE_CHANNELS)) return bad(res, 'Sem permissão', 403);
  if (voice.has(ch.id)) for (const u of [...voice.get(ch.id).keys()]) leaveVoice(u, ch.id);
  run('UPDATE channels SET parent_id=NULL WHERE parent_id=?', ch.id);
  run('DELETE FROM channels WHERE id=?', ch.id);
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
  const i = get('SELECT i.*,g.name,g.icon FROM invites i JOIN guilds g ON g.id=i.guild_id WHERE code=?', req.params.code);
  if (!i) return bad(res, 'Convite inválido ou expirado', 404);
  res.json({ code: i.code, guild: { id: i.guild_id, name: i.name, icon: i.icon }, members: guildMemberIds(i.guild_id).length });
}));
app.post('/api/invites/:code', auth, wrap((req, res) => {
  const i = get('SELECT * FROM invites WHERE code=?', req.params.code);
  if (!i) return bad(res, 'Convite inválido ou expirado', 404);
  if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', i.guild_id, req.uid)) {
    run('INSERT INTO members(guild_id,user_id,joined_at) VALUES(?,?,?)', i.guild_id, req.uid, Date.now());
    run('UPDATE invites SET uses=uses+1 WHERE code=?', i.code);
    dispatch(guildMemberIds(i.guild_id).filter(x => x !== req.uid), 'MEMBER_ADD', { guild_id: i.guild_id, member: memberObj(i.guild_id, req.uid), user: userPub(req.uid) });
    dispatch([req.uid], 'GUILD_CREATE', guildFull(i.guild_id));
    const gen = get("SELECT id FROM channels WHERE guild_id=? AND type=0 ORDER BY position LIMIT 1", i.guild_id);
    if (gen) { // mensagem de sistema de boas-vindas
      const mid = newId();
      run("INSERT INTO messages(id,channel_id,author_id,content,created_at,type) VALUES(?,?,?,?,?,1)", mid, gen.id, req.uid, 'entrou no servidor.', Date.now());
      const ch = get('SELECT * FROM channels WHERE id=?', gen.id);
      dispatch(channelAudience(ch), 'MESSAGE_CREATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', mid)), guild_id: ch.guild_id, mentions: [] });
    }
  }
  res.json({ id: i.guild_id });
}));

app.get('/api/guilds/:id/invites', auth, wrap((req, res) => {
  if (!can(req.params.id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
  res.json(all('SELECT code,creator_id,uses,created_at FROM invites WHERE guild_id=? ORDER BY created_at DESC', req.params.id));
}));
app.delete('/api/invites/:code', auth, wrap((req, res) => {
  const i = get('SELECT * FROM invites WHERE code=?', req.params.code);
  if (!i || !(i.creator_id === req.uid || can(i.guild_id, req.uid, P.MANAGE_GUILD))) return bad(res, 'Sem permissão', 403);
  run('DELETE FROM invites WHERE code=?', i.code); res.json({});
}));
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
  } else if (req.query.before) rows = all('SELECT * FROM messages WHERE channel_id=? AND id<? ORDER BY id DESC LIMIT ?', ch.id, String(req.query.before), limit);
  else rows = all('SELECT * FROM messages WHERE channel_id=? ORDER BY id DESC LIMIT ?', ch.id, limit);
  res.json(rows.reverse().map(messageObj));
}));
app.get('/api/channels/:id/pins', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  res.json(all('SELECT * FROM messages WHERE channel_id=? AND pinned=1 ORDER BY id DESC', ch.id).map(messageObj));
}));
app.get('/api/search', auth, wrap((req, res) => {
  const q = clean(req.query.q, 100); if (!q) return res.json([]);
  const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%';
  let rows;
  if (req.query.guild) {
    rows = get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', String(req.query.guild), req.uid)
      ? all("SELECT m.* FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.guild_id=? AND m.content LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 50", String(req.query.guild), like) : [];
  } else {
    rows = all("SELECT m.* FROM messages m JOIN dm_participants p ON p.channel_id=m.channel_id AND p.user_id=? WHERE m.content LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 50", req.uid, like);
  }
  res.json(rows.map(messageObj));
}));
function mentionedIds(content, ch) {
  const ids = new Set();
  for (const m of content.matchAll(/<@(\d+)>/g)) ids.add(m[1]);
  if (/@everyone|@here/.test(content)) return channelAudience(ch);
  return [...ids];
}
app.post('/api/channels/:id/messages', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  if (ch.type === 4) return bad(res, 'Canal não aceita mensagens');
  const content = String(req.body.content ?? '').slice(0, 4000);
  const atts = (Array.isArray(req.body.attachments) ? req.body.attachments : []).slice(0, 10)
    .filter(a => a && typeof a.url === 'string' && a.url.startsWith('/files/'))
    .map(a => ({ url: a.url, name: clean(a.name, 200), size: +a.size || 0, type: clean(a.type, 100) }));
  if (!content.trim() && !atts.length) return bad(res, 'Mensagem vazia');
  if (ch.type === 1) {
    const other = all('SELECT user_id FROM dm_participants WHERE channel_id=? AND user_id<>?', ch.id, req.uid)[0];
    if (other && get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=2', other.user_id, req.uid)) return bad(res, 'Você não pode enviar mensagens para este usuário', 403);
  }
  const id = newId();
  run('INSERT INTO messages(id,channel_id,author_id,content,created_at,reply_to,attachments) VALUES(?,?,?,?,?,?,?)',
    id, ch.id, req.uid, content, Date.now(), req.body.reply_to ? String(req.body.reply_to) : null, JSON.stringify(atts));
  run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', req.uid, ch.id, id);
  const msg = { ...messageObj(get('SELECT * FROM messages WHERE id=?', id)), guild_id: ch.guild_id, mentions: mentionedIds(content, ch) };
  dispatch(channelAudience(ch), 'MESSAGE_CREATE', msg);
  res.json(msg);
}));
app.patch('/api/channels/:id/messages/:mid', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
  if (!m || m.author_id !== req.uid) return bad(res, 'Sem permissão', 403);
  const content = String(req.body.content ?? '').slice(0, 4000);
  if (!content.trim()) return bad(res, 'Mensagem vazia');
  run('UPDATE messages SET content=?,edited_at=? WHERE id=?', content, Date.now(), m.id);
  dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', m.id)), guild_id: ch.guild_id });
  res.json({});
}));
app.delete('/api/channels/:id/messages/:mid', auth, wrap((req, res) => {
  const ch = channelFor(req, res); if (!ch) return;
  const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
  if (!m || (m.author_id !== req.uid && !(ch.guild_id && can(ch.guild_id, req.uid, P.MANAGE_MESSAGES)))) return bad(res, 'Sem permissão', 403);
  run('DELETE FROM messages WHERE id=?', m.id);
  dispatch(channelAudience(ch), 'MESSAGE_DELETE', { id: m.id, channel_id: ch.id, guild_id: ch.guild_id });
  res.json({});
}));
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
app.post('/api/dms', auth, wrap((req, res) => {
  const other = String(req.body.user_id);
  if (!getUser(other) || other === req.uid) return bad(res, 'Usuário inválido');
  let ch = get(`SELECT c.* FROM channels c WHERE c.type=1 AND EXISTS(SELECT 1 FROM dm_participants WHERE channel_id=c.id AND user_id=?) AND EXISTS(SELECT 1 FROM dm_participants WHERE channel_id=c.id AND user_id=?)`, req.uid, other);
  if (!ch) {
    const id = newId();
    run('INSERT INTO channels(id,type,name,created_at) VALUES(?,1,NULL,?)', id, Date.now());
    run('INSERT INTO dm_participants VALUES(?,?)', id, req.uid); run('INSERT INTO dm_participants VALUES(?,?)', id, other);
    ch = get('SELECT * FROM channels WHERE id=?', id);
  }
  const o = dmChannelObj(ch);
  dispatch([req.uid, other], 'DM_CREATE', o);
  res.json(o);
}));
function setRel(a, b, type) {
  if (type == null) run('DELETE FROM relationships WHERE user_id=? AND other_id=?', a, b);
  else run('INSERT INTO relationships VALUES(?,?,?) ON CONFLICT(user_id,other_id) DO UPDATE SET type=excluded.type', a, b, type);
  dispatch([a], 'RELATIONSHIP', { user: userPub(b), type: type ?? 0 });
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
  res.json({ ...pubUser(u), mutual_guilds: mutual });
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

app.get('/api/server-info', (req, res) => res.json({ name: 'LocalCord', registration: OPEN_REGISTRATION }));
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
  return { user: pubUser(getUser(uid)), guilds, dms, relationships: relObj(uid), unread, dm_voice: dmVoice, ice: iceServers() };
}

function leaveVoice(uid, cid) {
  const m = voice.get(cid); if (!m || !m.has(uid)) return;
  m.delete(uid); if (!m.size) voice.delete(cid);
  const ch = get('SELECT * FROM channels WHERE id=?', cid);
  if (ch) dispatch(channelAudience(ch), 'VOICE_STATE', { channel_id: null, prev_channel_id: cid, user_id: uid, guild_id: ch.guild_id });
  for (const [, s] of m) send(s.ws, 'VOICE_PEER_LEFT', { channel_id: cid, user_id: uid });
}
function currentVoice(uid) { for (const [cid, m] of voice) if (m.has(uid)) return cid; return null; }

wss.on('connection', (ws) => {
  const uid = ws.uid;
  const first = !conns.has(uid);
  if (first) conns.set(uid, new Set());
  conns.get(uid).add(ws);
  send(ws, 'READY', buildReady(uid));
  if (first) broadcastPresence(uid);
  ws.alive = true; ws.on('pong', () => (ws.alive = true));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const d = msg.d || {};
    try {
      switch (msg.t) {
        case 'TYPING': {
          const ch = get('SELECT * FROM channels WHERE id=?', String(d.channel_id));
          if (canAccessChannel(uid, ch)) dispatch(channelAudience(ch).filter(x => x !== uid), 'TYPING', { channel_id: ch.id, user_id: uid });
          break;
        }
        case 'VOICE_JOIN': {
          const ch = get('SELECT * FROM channels WHERE id=?', String(d.channel_id));
          if (!ch || (ch.type !== 2 && ch.type !== 1) || !canAccessChannel(uid, ch)) return;
          const prev = currentVoice(uid); if (prev) leaveVoice(uid, prev);
          if (!voice.has(ch.id)) voice.set(ch.id, new Map());
          const room = voice.get(ch.id);
          const peers = [...room.keys()];
          const st = { ws, mute: false, deaf: false, video: false, screen: false };
          room.set(uid, st);
          send(ws, 'VOICE_JOINED', { channel_id: ch.id, peers });
          dispatch(channelAudience(ch), 'VOICE_STATE', { ...vsObj(ch.id, uid, st), guild_id: ch.guild_id });
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
        case 'VOICE_LEAVE': { const c = currentVoice(uid); if (c) leaveVoice(uid, c); break; }
        case 'VOICE_STATE': {
          const c = currentVoice(uid); if (!c) return;
          const st = voice.get(c).get(uid);
          for (const k of ['mute', 'deaf', 'video', 'screen']) if (typeof d[k] === 'boolean') st[k] = d[k];
          const ch = get('SELECT * FROM channels WHERE id=?', c);
          dispatch(channelAudience(ch), 'VOICE_STATE', { ...vsObj(c, uid, st), guild_id: ch.guild_id });
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
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyP, '-out', certP, '-days', '3650', '-subj', '/CN=LocalCord', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
      console.log('  Certificado HTTPS autoassinado gerado em', DATA_DIR);
    } catch { console.log('  (openssl não encontrado: HTTPS desativado. Instale openssl ou forneça TLS_KEY/TLS_CERT)'); return null; }
  }
  return { key: fs.readFileSync(keyP), cert: fs.readFileSync(certP) };
}

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
