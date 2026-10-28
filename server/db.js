import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'localcord.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL, display_name TEXT,
  pass_hash TEXT NOT NULL, salt TEXT NOT NULL, avatar TEXT, banner_color TEXT, color TEXT,
  bio TEXT DEFAULT '', status TEXT DEFAULT 'online', custom_status TEXT DEFAULT '', created_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER);
CREATE TABLE IF NOT EXISTS guilds(id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, owner_id TEXT NOT NULL, created_at INTEGER);
CREATE TABLE IF NOT EXISTS roles(id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, name TEXT, color TEXT, perms INTEGER DEFAULT 0, position INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS members(guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, nickname TEXT, joined_at INTEGER, PRIMARY KEY(guild_id,user_id));
CREATE TABLE IF NOT EXISTS member_roles(guild_id TEXT, user_id TEXT, role_id TEXT REFERENCES roles(id) ON DELETE CASCADE, PRIMARY KEY(guild_id,user_id,role_id));
CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY, guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE, type INTEGER NOT NULL, name TEXT, topic TEXT DEFAULT '', position INTEGER DEFAULT 0, parent_id TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS dm_participants(channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(channel_id,user_id));
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, author_id TEXT NOT NULL, content TEXT, created_at INTEGER, edited_at INTEGER, reply_to TEXT, attachments TEXT DEFAULT '[]', pinned INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_msg_channel ON messages(channel_id, id);
CREATE TABLE IF NOT EXISTS reactions(message_id TEXT REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT, emoji TEXT, PRIMARY KEY(message_id,user_id,emoji));
CREATE TABLE IF NOT EXISTS invites(code TEXT PRIMARY KEY, guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE, creator_id TEXT, uses INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS relationships(user_id TEXT, other_id TEXT, type INTEGER, PRIMARY KEY(user_id,other_id));
CREATE TABLE IF NOT EXISTS read_states(user_id TEXT, channel_id TEXT, last_id TEXT, PRIMARY KEY(user_id,channel_id));
`);

let seq = 0, lastMs = 0;
// IDs ordenáveis por tempo (estilo snowflake), como string
export function newId() {
  const ms = Date.now();
  if (ms === lastMs) seq++; else { seq = 0; lastMs = ms; }
  return (BigInt(ms) * 1000n + BigInt(seq % 1000)).toString();
}
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

// ---- migrações incrementais (bancos já existentes continuam funcionando) ----
const addCol = (t, c, d) => { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`); } catch { /* já existe */ } };
addCol('users', 'pronouns', "TEXT DEFAULT ''");
addCol('users', 'banner', 'TEXT');
addCol('users', 'status_emoji', "TEXT DEFAULT ''");
addCol('guilds', 'banner', 'TEXT');
addCol('guilds', 'description', "TEXT DEFAULT ''");
addCol('guilds', 'accent', 'TEXT');
addCol('messages', 'type', 'INTEGER DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS emojis(id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, name TEXT NOT NULL, url TEXT NOT NULL, creator_id TEXT, created_at INTEGER);`);
addCol('users', 'friend_policy', "TEXT DEFAULT 'all'");
addCol('users', 'settings', 'TEXT');
addCol('sessions', 'agent', 'TEXT');
addCol('sessions', 'last_seen', 'INTEGER');
// moderação: banimentos, castigo (timeout) e registro de auditoria
db.exec(`CREATE TABLE IF NOT EXISTS bans(guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, user_id TEXT NOT NULL, reason TEXT DEFAULT '', by_id TEXT, created_at INTEGER, PRIMARY KEY(guild_id,user_id));
CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, actor_id TEXT, action TEXT NOT NULL, target_id TEXT, details TEXT DEFAULT '', created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_audit_guild ON audit_log(guild_id, id);`);
addCol('members', 'timeout_until', 'INTEGER');
db.exec(`CREATE TABLE IF NOT EXISTS sounds(id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, name TEXT NOT NULL, emoji TEXT, url TEXT NOT NULL, volume INTEGER DEFAULT 100, creator_id TEXT, created_at INTEGER);`);
