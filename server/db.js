import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'localcord.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
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
addCol('users', 'theme_primary', 'TEXT'); // tema do perfil: gradiente principal → destaque
addCol('users', 'theme_accent', 'TEXT');
addCol('users', 'avatar_pos', 'TEXT'); // enquadramento da imagem: "x,y,zoom" (x/y em %, zoom 1–3)
addCol('users', 'banner_pos', 'TEXT');
addCol('users', 'name_style', 'TEXT'); // estilo do nome: JSON { font, effect, c1, c2 }
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

// busca: índice FTS5 sobre o texto e os anexos (nomes), sem acentos; mantido por gatilhos.
// (usa o rowid de messages: não rode VACUUM sem depois fazer INSERT INTO messages_fts(messages_fts) VALUES('rebuild'))
const hadFts = !!get("SELECT 1 x FROM sqlite_master WHERE name='messages_fts'");
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, attachments, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, content, attachments) VALUES (new.rowid, new.content, new.attachments); END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, content, attachments) VALUES ('delete', old.rowid, old.content, old.attachments); END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content, attachments ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, attachments) VALUES ('delete', old.rowid, old.content, old.attachments);
  INSERT INTO messages_fts(rowid, content, attachments) VALUES (new.rowid, new.content, new.attachments); END;`);
if (!hadFts) db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");

// caixa de entrada: quem foi mencionado/respondido em cada mensagem
const hadMentions = !!get("SELECT 1 x FROM sqlite_master WHERE name='mentions'");
db.exec(`CREATE TABLE IF NOT EXISTS mentions(message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(message_id, user_id));
CREATE INDEX IF NOT EXISTS idx_mentions_user ON mentions(user_id, message_id);`);
if (!hadMentions) { // preenche com o histórico (menções diretas e respostas)
  const ins = db.prepare('INSERT OR IGNORE INTO mentions VALUES(?,?,?)');
  for (const m of all("SELECT id, author_id, content, reply_to FROM messages WHERE content LIKE '%<@%' OR reply_to IS NOT NULL")) {
    for (const x of (m.content || '').matchAll(/<@(\d+)>/g)) if (x[1] !== m.author_id) ins.run(m.id, x[1], 'mention');
    const r = m.reply_to && get('SELECT author_id FROM messages WHERE id=?', m.reply_to);
    if (r && r.author_id !== m.author_id) ins.run(m.id, r.author_id, 'reply');
  }
}
// migrações que só podem rodar uma vez ficam marcadas em meta
db.exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)');
const once = (k, fn) => { if (!get('SELECT 1 x FROM meta WHERE k=?', k)) { fn(); run('INSERT INTO meta VALUES(?,?)', k, String(Date.now())); } };
// avatares padrão renomeados para ficar na ordem certa (mapeado pelo conteúdo dos arquivos)
once('avatars-rename-1', () => db.exec(`UPDATE users SET avatar = CASE avatar
  WHEN '/avatars/6.png' THEN '/avatars/1.png' WHEN '/avatars/9.png' THEN '/avatars/4.png'
  WHEN '/avatars/4.png' THEN '/avatars/9.png' WHEN '/avatars/10.png' THEN '/avatars/6.png'
  WHEN '/avatars/1.webp' THEN '/avatars/10.webp' ELSE avatar END
  WHERE avatar IN ('/avatars/6.png','/avatars/9.png','/avatars/4.png','/avatars/10.png','/avatars/1.webp')`));
db.exec(`CREATE TABLE IF NOT EXISTS sounds(id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, name TEXT NOT NULL, emoji TEXT, url TEXT NOT NULL, volume INTEGER DEFAULT 100, creator_id TEXT, created_at INTEGER);`);
// ---- Fase 1: contas vinculadas e atividade (sem tokens: a Steam usa OpenID, que não gera segredo por usuário) ----
db.exec(`CREATE TABLE IF NOT EXISTS linked_accounts(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, external_id TEXT NOT NULL,
  display_name TEXT, avatar TEXT, profile_url TEXT, visibility TEXT NOT NULL DEFAULT 'friends',
  linked_at INTEGER, last_sync INTEGER, sync_state TEXT,
  PRIMARY KEY(user_id, platform), UNIQUE(platform, external_id));
CREATE TABLE IF NOT EXISTS activities(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL,
  kind TEXT NOT NULL, game_id TEXT, title TEXT, data TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS activities_user ON activities(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS game_prefs(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, game_id TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, platform, game_id));`);
// visibilidade do FATO de ter a conta vinculada (independente de 'visibility', que controla só a atividade/jogo atual)
addCol('linked_accounts', 'link_visibility', "TEXT NOT NULL DEFAULT 'friends'");

// Galeria de clipes: cada clipe é um vídeo enviado + a mensagem que o mostra no chat da sala
db.exec(`CREATE TABLE IF NOT EXISTS clips(
  id TEXT PRIMARY KEY, guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id TEXT, author_id TEXT NOT NULL, streamer_id TEXT, title TEXT NOT NULL, url TEXT NOT NULL, size INTEGER DEFAULT 0,
  secs INTEGER DEFAULT 0, has_audio INTEGER DEFAULT 1, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_clips_guild ON clips(guild_id, id);
CREATE INDEX IF NOT EXISTS idx_clips_message ON clips(message_id);
CREATE TABLE IF NOT EXISTS clip_favs(user_id TEXT NOT NULL, clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE, PRIMARY KEY(user_id, clip_id));`);

// Enquetes: uma mensagem do chat com pergunta, opções e votos (visíveis: cada opção mostra quem votou)
db.exec(`CREATE TABLE IF NOT EXISTS polls(
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE, channel_id TEXT NOT NULL,
  author_id TEXT NOT NULL, question TEXT NOT NULL, options TEXT NOT NULL, multi INTEGER DEFAULT 0, ends_at INTEGER, closed_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS poll_votes(poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE, user_id TEXT NOT NULL, option_id TEXT NOT NULL, voted_at INTEGER, PRIMARY KEY(poll_id, user_id, option_id));`);
