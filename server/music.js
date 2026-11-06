// Bot de música: entra na sala de voz como um participante, toca links/buscas (YouTube, SoundCloud, Spotify...) em fila.
// Áudio: yt-dlp (extração, sem anúncios) -> ffmpeg (Opus/RTP) -> PlainTransport do mediasoup -> aparece como microfone do bot.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import https from 'node:https';

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const COOKIES = process.env.YTDLP_COOKIES || '';
const IDLE_MS = Math.max(1, Number(process.env.MUSIC_IDLE_MIN || 5)) * 60_000;
const ALONE_MS = 20_000; // sem humanos na sala
const MAX_QUEUE = 200, MAX_PLAYLIST = 100;
const ALLOW_ANY = process.env.MUSIC_ALLOW_ANY === '1';
const HOSTS = ['youtube.com', 'youtu.be', 'music.youtube.com', 'soundcloud.com', 'spotify.com', 'bandcamp.com', 'twitch.tv', 'vimeo.com', 'dailymotion.com', 'mixcloud.com', 'deezer.com', 'audiomack.com'];
const BOT_PREFIX = 'bot_music_';

const sessions = new Map(); // guildId -> sessão
let env = null, available = null;

export const initMusic = (e) => { env = e; };
export const isMusicBot = (uid) => !!env.get('SELECT 1 x FROM users WHERE id=? AND username LIKE ?', uid, BOT_PREFIX + '%');

// ---------- binários ----------
function probeBins() {
  return new Promise((resolve) => {
    const check = (bin, arg) => new Promise(r => { try { const p = spawn(bin, [arg], { stdio: 'ignore' }); p.on('error', () => r(false)); p.on('exit', c => r(c === 0)); } catch { r(false); } });
    Promise.all([check(YTDLP, '--version'), check(FFMPEG, '-version')]).then(([y, f]) => resolve(y && f));
  });
}
export async function musicAvailable() { if (available === null) available = await probeBins(); return available; }

// ---------- resolução de links / buscas ----------
const hostOk = (u) => {
  if (ALLOW_ANY) return true;
  const h = u.hostname.toLowerCase();
  return HOSTS.some(d => h === d || h.endsWith('.' + d));
};
const ytdlpArgs = (extra) => ['--ignore-config', '--no-warnings', '--js-runtimes', 'node', ...(COOKIES ? ['--cookies', COOKIES] : []), ...extra];

function runJson(args, timeout = 45_000) {
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, ytdlpArgs(args), { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('A busca demorou demais')); }, timeout);
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
    p.on('error', () => { clearTimeout(t); reject(new Error('yt-dlp não está instalado no servidor')); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(/Sign in|bot|cookies/i.test(err) ? 'O YouTube pediu login (veja YTDLP_COOKIES no README)' : (err.split('\n').filter(Boolean).pop() || 'Não foi possível abrir esse link').replace(/^ERROR:\s*/, '').slice(0, 160)));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('Resposta inválida do yt-dlp')); }
    });
  });
}
const trackFrom = (e, fallbackUrl) => ({
  title: String(e.track || e.title || 'Sem título').slice(0, 140),
  artist: String(e.artist || e.uploader || e.channel || '').slice(0, 80),
  duration: Math.round(+e.duration || 0),
  thumb: e.thumbnail || e.thumbnails?.[e.thumbnails.length - 1]?.url || null,
  url: e.webpage_url || e.url || fallbackUrl,
});

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'accept-language': 'en' }, timeout: 10_000 }, (res) => {
      if (res.statusCode >= 300) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let b = ''; res.setEncoding('utf8'); res.on('data', d => (b += d)); res.on('end', () => resolve(b));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}
// Spotify não entrega áudio: lê os nomes das faixas (página de embed) e procura no YouTube na hora de tocar
async function spotifyTracks(u) {
  const m = u.pathname.match(/\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/);
  if (!m) throw new Error('Link do Spotify não reconhecido');
  const html = await fetchText(`https://open.spotify.com/embed/${m[1]}/${m[2]}`);
  const j = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!j) throw new Error('Não consegui ler esse link do Spotify');
  const ent = JSON.parse(j)?.props?.pageProps?.state?.data?.entity;
  if (!ent) throw new Error('Não consegui ler esse link do Spotify');
  const list = Array.isArray(ent.trackList) && ent.trackList.length ? ent.trackList.map(t => ({ title: t.title, artist: t.subtitle || '', duration: Math.round((+t.duration || 0) / 1000) }))
    : [{ title: ent.name || ent.title, artist: (ent.artists || []).map(a => a.name).join(', ') || ent.subtitle || '', duration: Math.round((+ent.duration || 0) / 1000) }];
  return list.filter(t => t.title).slice(0, MAX_PLAYLIST).map(t => ({
    title: String(t.title).slice(0, 140), artist: String(t.artist).replace(/ /g, ' ').slice(0, 80), duration: t.duration || 0, thumb: ent.coverArt?.sources?.[0]?.url || null,
    search: `ytsearch1:${t.artist ? t.artist + ' - ' : ''}${t.title}`.slice(0, 200), url: null,
  }));
}

// Devolve uma lista de faixas { title, artist, duration, thumb, url | search }
export async function resolveQuery(q) {
  q = String(q || '').trim().slice(0, 500);
  if (!q) throw new Error('Digite um link ou o nome da música');
  let u = null;
  if (/^https?:\/\//i.test(q)) { try { u = new URL(q); } catch { throw new Error('Link inválido'); } }
  if (!u) { // busca por texto
    const j = await runJson(['-J', '--no-playlist', '--default-search', 'ytsearch1', '--', `ytsearch1:${q}`]);
    const e = j.entries?.[0]; if (!e) throw new Error('Nada encontrado');
    return [trackFrom(e)];
  }
  if (!hostOk(u)) throw new Error('Site não permitido (YouTube, SoundCloud, Spotify, Bandcamp, Twitch, Vimeo...)');
  if (/(^|\.)spotify\.com$/.test(u.hostname)) return spotifyTracks(u);
  const j = await runJson(['-J', '--flat-playlist', '--playlist-end', String(MAX_PLAYLIST), '--', u.href]);
  if (j.entries) {
    const list = j.entries.filter(Boolean).map(e => trackFrom(e)).filter(t => t.url);
    if (!list.length) throw new Error('Playlist vazia');
    return list;
  }
  return [trackFrom(j, u.href)];
}

// ---------- sessão ----------
const isHuman = (uid) => !isMusicBot(uid);
const humansIn = (cid) => [...(env.voice.get(cid)?.keys() || [])].filter(isHuman);
const view = (s) => ({
  channel_id: s.channelId, guild_id: s.guildId, bot_id: s.botId, active: true, paused: s.paused,
  elapsed: s.current ? Math.round((s.paused ? s.pausedAt : Date.now()) - s.startedAt) : 0,
  current: s.current && pub(s.current), queue: s.queue.map(pub),
});
const pub = (t) => ({ id: t.id, title: t.title, artist: t.artist, duration: t.duration, thumb: t.thumb, by: t.by, url: t.url });

function push(s, extra = {}) {
  const payload = { ...view(s), ...extra };
  for (const [uid, st] of env.voice.get(s.channelId) || []) if (isHuman(uid)) env.send(st.ws, 'MUSIC_STATE', payload);
}
export function onVoiceJoin(cid, ws) { // alguém entrou numa sala onde o bot está
  const s = [...sessions.values()].find(x => x.channelId === cid);
  if (s) { env.send(ws, 'MUSIC_STATE', view(s)); clearTimeout(s.aloneTimer); }
  else env.send(ws, 'MUSIC_STATE', { channel_id: cid, active: false });
}
export function onVoiceLeave(cid) { // alguém saiu: se só sobrou o bot, ele sai também
  const s = [...sessions.values()].find(x => x.channelId === cid);
  if (s && !env.voice.get(cid)?.has(s.botId)) { clearTimeout(s.idleTimer); clearTimeout(s.aloneTimer); killProc(s); sessions.delete(s.guildId); return; } // bot removido da sala (canal apagado etc.)
  if (!s || humansIn(cid).length) return;
  clearTimeout(s.aloneTimer); s.aloneTimer = setTimeout(() => { if (!humansIn(s.channelId).length) endSession(s, 'Todos saíram da sala'); }, ALONE_MS);
}

function botUserFor(gid) {
  const uname = BOT_PREFIX + gid;
  let u = env.get('SELECT id FROM users WHERE username=?', uname);
  if (!u) {
    const id = env.newId(), salt = crypto.randomBytes(16).toString('hex');
    env.run('INSERT INTO users(id,username,display_name,pass_hash,salt,color,avatar,bio,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      id, uname, 'Música', crypto.randomBytes(32).toString('hex'), salt, '#a855f7', null, 'Bot de música do servidor', Date.now());
    u = { id };
  }
  return u.id;
}

async function startSession(guildId, channelId) {
  const botId = botUserFor(guildId);
  if (!env.get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', guildId, botId)) {
    env.run('INSERT INTO members(guild_id,user_id,joined_at) VALUES(?,?,?)', guildId, botId, Date.now());
    env.dispatch(env.guildMemberIds(guildId).filter(x => x !== botId), 'MEMBER_ADD', { guild_id: guildId, member: env.memberObj(guildId, botId), user: env.userPub(botId) });
  }
  const s = { guildId, channelId, botId, queue: [], current: null, paused: false, startedAt: 0, pausedAt: 0, proc: null, rtp: null, idleTimer: null, aloneTimer: null, gen: 0 };
  sessions.set(guildId, s);
  await env.joinBot(channelId, botId); // entra na sala (voice map + SFU)
  armIdle(s);
  return s;
}
function armIdle(s) { clearTimeout(s.idleTimer); if (!s.current || s.paused) s.idleTimer = setTimeout(() => endSession(s, 'Ficou inativo'), IDLE_MS); }

function killProc(s) {
  s.gen++; // invalida callbacks da faixa anterior
  for (const p of s.proc || []) { try { p.kill('SIGKILL'); } catch { } }
  s.proc = null; s.rtp?.close(); s.rtp = null;
}
export function endSession(s, reason) {
  if (!s || sessions.get(s.guildId) !== s) return;
  clearTimeout(s.idleTimer); clearTimeout(s.aloneTimer);
  killProc(s); sessions.delete(s.guildId);
  for (const [uid, st] of env.voice.get(s.channelId) || []) if (isHuman(uid)) env.send(st.ws, 'MUSIC_STATE', { channel_id: s.channelId, active: false, notice: reason });
  env.leaveBot(s.channelId, s.botId);
  env.run('DELETE FROM members WHERE guild_id=? AND user_id=?', s.guildId, s.botId);
  env.dispatch(env.guildMemberIds(s.guildId), 'MEMBER_REMOVE', { guild_id: s.guildId, user_id: s.botId });
}
export const stopAll = () => { for (const s of [...sessions.values()]) endSession(s, 'Servidor reiniciando'); };

// toca a próxima faixa da fila
async function playNext(s) {
  killProc(s);
  clearTimeout(s.idleTimer);
  s.current = s.queue.shift() || null; s.paused = false;
  if (!s.current) { push(s); return armIdle(s); }
  return startTrack(s, 0);
}
// inicia (ou retoma, com offset em ms) a faixa atual
async function startTrack(s, offsetMs) {
  killProc(s);
  const gen = s.gen, t = s.current;
  s.paused = false; s.startedAt = Date.now() - offsetMs;
  try {
    const rtp = await env.attachRtp(s.channelId, s.botId);
    if (gen !== s.gen) return rtp.close();
    s.rtp = rtp;
    const src = t.url || t.search;
    const dl = spawn(YTDLP, ytdlpArgs(['-f', 'bestaudio/best', '--no-playlist', '-o', '-', '--quiet', '--', src]), { stdio: ['ignore', 'pipe', 'pipe'] });
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...(offsetMs ? ['-ss', (offsetMs / 1000).toFixed(1)] : []), '-re', '-i', 'pipe:0', '-vn', '-map', '0:a:0', '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '128k', '-application', 'audio',
      '-f', 'rtp', '-payload_type', String(rtp.payloadType), '-ssrc', String(rtp.ssrc), `rtp://127.0.0.1:${rtp.port}?pkt_size=1200`], { stdio: ['pipe', 'ignore', 'pipe'] });
    s.proc = [dl, ff];
    let dlErr = '', started = false;
    dl.stderr.on('data', d => (dlErr += d)); ff.stderr.on('data', () => { });
    dl.stdout.pipe(ff.stdin); ff.stdin.on('error', () => { }); dl.stdout.on('error', () => { });
    dl.on('error', () => fail('yt-dlp não está instalado no servidor')); ff.on('error', () => fail('ffmpeg não está instalado no servidor'));
    dl.stdout.once('data', () => { if (gen === s.gen && !started) { started = true; push(s); } });
    const fail = (msg) => { if (gen !== s.gen) return; push(s, { notice: `Não consegui tocar "${t.title}": ${msg}` }); playNext(s); };
    dl.on('close', (code) => { if (gen === s.gen && code !== 0 && !started) fail(/Sign in|bot|cookies/i.test(dlErr) ? 'o YouTube pediu login (YTDLP_COOKIES)' : (dlErr.split('\n').filter(Boolean).pop() || 'falha ao baixar').replace(/^ERROR:\s*/, '').slice(0, 120)); });
    ff.on('close', () => { if (gen !== s.gen) return; started ? playNext(s) : fail('formato de áudio não suportado'); }); // terminou a faixa
    push(s);
  } catch (e) { if (gen === s.gen) { push(s, { notice: 'Falha ao tocar: ' + e.message }); playNext(s); } }
}

// ---------- comandos vindos do gateway ----------
export async function handle(uid, cid, d) {
  const ch = env.get('SELECT * FROM channels WHERE id=?', cid);
  if (!ch || ch.type !== 2 || !ch.guild_id) throw new Error('O bot de música só funciona em salas de voz de servidores');
  let s = sessions.get(ch.guild_id);
  const op = String(d.op);
  if (op === 'play') {
    if (!(await musicAvailable())) throw new Error('O servidor não tem yt-dlp/ffmpeg instalados (use a imagem Docker atualizada)');
    if (!env.sfuEnabled()) throw new Error('O bot de música precisa do SFU de voz ativo');
    if (s && s.channelId !== cid) {
      if (s.current || s.queue.length) throw new Error('O bot já está tocando em outra sala deste servidor');
      endSession(s, 'Movido'); s = null;
    }
    const tracks = await resolveQuery(d.query);
    s = sessions.get(ch.guild_id) || await startSession(ch.guild_id, cid);
    const room = Math.max(0, MAX_QUEUE - s.queue.length - (s.current ? 1 : 0));
    const add = tracks.slice(0, room).map(t => ({ ...t, id: crypto.randomBytes(5).toString('hex'), by: uid }));
    if (!add.length) throw new Error('A fila está cheia');
    s.queue.push(...add);
    if (!s.current) await playNext(s); else push(s);
    return { added: add.length, title: add[0].title };
  }
  if (!s || s.channelId !== cid) throw new Error('O bot não está nesta sala');
  switch (op) {
    case 'skip': await playNext(s); break;
    case 'pause': if (s.current && !s.paused) { s.pausedAt = Date.now(); killProc(s); s.paused = true; armIdle(s); push(s); } break; // pausar = parar o fluxo e retomar do mesmo ponto
    case 'resume': if (s.current && s.paused) { clearTimeout(s.idleTimer); await startTrack(s, s.pausedAt - s.startedAt); } break;
    case 'remove': { const i = s.queue.findIndex(t => t.id === String(d.id)); if (i >= 0) { s.queue.splice(i, 1); push(s); } break; }
    case 'clear': s.queue = []; push(s); break;
    case 'stop': s.queue = []; await playNext(s); break;
    case 'shuffle': for (let i = s.queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]]; } push(s); break;
    case 'disconnect': endSession(s, 'Removido da chamada'); break;
    default: throw new Error('comando desconhecido');
  }
  return {};
}
