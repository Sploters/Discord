// Atividade social (Fase 1): agendador, cache, backoff e eventos. Agnóstico de plataforma: só fala com os adaptadores de server/integrations.
//
// PRIVACIDADE — uma única regra decide quem vê a atividade de alguém (usada no tempo real, no READY e no feed, para não divergirem):
//   canSee(viewer, owner) = viewer === owner  OU  (linked_accounts.visibility === 'friends' E os dois são amigos aceitos).
// 'visibility' é a visibilidade da ATIVIDADE; 'link_visibility' é a visibilidade do fato de ter a conta vinculada (são independentes).
// Com visibility = 'off' nada é consultado nem guardado para aquela conta.
import { PollError } from './integrations/errors.js';

const MIN_SECS = 30, MAX_BACKOFF_MS = 15 * 60 * 1000, KEEP_DAYS = 30, KEEP_PER_USER = 200, STALE_X = 3;

export function createActivityService({ all, get, run, newId, dispatch, isOnline, getAdapter, listAdapters, now = () => Date.now(), log = () => { } }) {
  const intervalMs = () => +process.env.ACTIVITY_POLL_MS || Math.max(MIN_SECS, +process.env.STEAM_POLL_SECS || 60) * 1000; // ACTIVITY_POLL_MS: só para testes
  const current = new Map();   // `${uid}:${platform}` -> { uid, platform, game:{id,title}, since, state, at }  (só o que está PUBLICADO)
  const cache = new Map();     // `${platform}:${external_id}` -> { snap, at }  (último snapshot, evita reconsultar)
  const health = new Map();    // platform -> { failures, nextAt, disabled, lastError, lastOk }
  let timer = null, running = false, lastTickAt = 0, stopped = false;

  // ---- regras de privacidade ----
  const friendsOf = (uid) => all(`SELECT r1.other_id id FROM relationships r1 JOIN relationships r2 ON r2.user_id=r1.other_id AND r2.other_id=r1.user_id
    WHERE r1.user_id=? AND r1.type=1 AND r2.type=1`, uid).map(r => r.id);
  const areFriends = (a, b) => !!get('SELECT 1 x FROM relationships r1 JOIN relationships r2 ON r2.user_id=r1.other_id AND r2.other_id=r1.user_id WHERE r1.user_id=? AND r1.other_id=? AND r1.type=1 AND r2.type=1', a, b);
  const acct = (uid, platform) => get('SELECT * FROM linked_accounts WHERE user_id=? AND platform=?', uid, platform);
  const canSee = (viewer, owner, platform) => {
    if (viewer === owner) return true;
    const a = acct(owner, platform);
    return !!a && a.visibility === 'friends' && areFriends(viewer, owner);
  };
  // quem recebe os eventos de `owner`: ele mesmo + amigos aceitos, se a atividade está compartilhada
  const audience = (owner, platform) => {
    const a = acct(owner, platform);
    return a && a.visibility === 'friends' ? [owner, ...friendsOf(owner)] : [owner];
  };
  const pub = (e) => e && ({ user_id: e.uid, platform: e.platform, game: e.game, since: e.since, state: e.state });

  const publish = (uid, platform, entry /* ou null */) => { // SEMPRE filtra os destinatários antes de enviar
    dispatch(audience(uid, platform), 'ACTIVITY_UPDATE', { user_id: uid, platform, activity: pub(entry) });
  };
  const record = (uid, platform, kind, game, data) => {
    run('INSERT INTO activities(id,user_id,platform,kind,game_id,title,data,created_at) VALUES(?,?,?,?,?,?,?,?)', newId(), uid, platform, kind, game.id, game.title, data ? JSON.stringify(data) : null, now());
    run('DELETE FROM activities WHERE user_id=? AND created_at<?', uid, now() - KEEP_DAYS * 864e5);
    run('DELETE FROM activities WHERE user_id=? AND id NOT IN (SELECT id FROM activities WHERE user_id=? ORDER BY created_at DESC LIMIT ?)', uid, uid, KEEP_PER_USER);
  };
  const hiddenGame = (uid, platform, gameId) => !!get('SELECT 1 x FROM game_prefs WHERE user_id=? AND platform=? AND game_id=? AND hidden=1', uid, platform, gameId);

  // encerra o que está publicado (jogo parou, conta desvinculada, privacidade desligada…)
  const clear = (uid, platform, { notify = true, why = 'stop', audienceOverride = null } = {}) => {
    const k = uid + ':' + platform, cur = current.get(k); if (!cur) return;
    current.delete(k);
    if (why === 'stop') record(uid, platform, 'game_stop', cur.game, { seconds: Math.max(0, Math.round((now() - cur.since) / 1000)) });
    if (notify) dispatch(audienceOverride || audience(uid, platform), 'ACTIVITY_UPDATE', { user_id: uid, platform, activity: null });
  };

  // aplica um snapshot de uma conta: publica/atualiza/encerra
  function apply(a, snap) {
    const k = a.user_id + ':' + a.platform, prev = current.get(k);
    run('UPDATE linked_accounts SET display_name=?, avatar=?, profile_url=?, last_sync=?, sync_state=? WHERE user_id=? AND platform=?',
      snap.name ?? a.display_name, snap.avatar ?? a.avatar, snap.profileUrl ?? a.profile_url, now(), snap.visibility === 'private' ? 'private' : 'ok', a.user_id, a.platform);
    const game = snap.game && !hiddenGame(a.user_id, a.platform, snap.game.id) ? snap.game : null;
    if (!game) return clear(a.user_id, a.platform);
    if (prev && prev.game.id === game.id) { prev.at = now(); prev.state = snap.state; if (prev.game.title !== game.title) prev.game = game; return; }
    if (prev) clear(a.user_id, a.platform); // trocou de jogo: fecha o anterior
    const entry = { uid: a.user_id, platform: a.platform, game, since: now(), state: snap.state, at: now() };
    current.set(k, entry); record(a.user_id, a.platform, 'game_start', game, null);
    publish(a.user_id, a.platform, entry);
  }

  // vale consultar esta conta? (sem ninguém para ver, não gasta chamada)
  const worthPolling = (a) => a.visibility !== 'off' && (isOnline(a.user_id) || friendsOf(a.user_id).some(isOnline));

  async function pollPlatform(ad) {
    const h = health.get(ad.id) || { failures: 0, nextAt: 0, disabled: null, lastError: null, lastOk: null }; health.set(ad.id, h);
    if (h.disabled || now() < h.nextAt) return;
    const accounts = all('SELECT * FROM linked_accounts WHERE platform=?', ad.id).filter(worthPolling);
    if (!accounts.length) return;
    try {
      const snaps = await ad.poll([...new Set(accounts.map(a => a.external_id))]); // UMA consulta em lote para todos
      h.failures = 0; h.lastError = null; h.lastOk = now();
      for (const a of accounts) {
        const cur = acct(a.user_id, a.platform); if (!cur || cur.external_id !== a.external_id || cur.visibility === 'off') continue; // mudou durante a consulta
        const snap = snaps.get(a.external_id);
        cache.set(a.platform + ':' + a.external_id, { snap: snap || null, at: now() });
        if (!snap) { run("UPDATE linked_accounts SET sync_state='not_found', last_sync=? WHERE user_id=? AND platform=?", now(), a.user_id, a.platform); clear(a.user_id, a.platform); continue; }
        apply(cur, snap);
      }
    } catch (e) {
      h.lastError = e.message || String(e); h.failures++;
      const st = e instanceof PollError ? e.status : 0;
      if (st === 401 || st === 403) { h.disabled = 'credencial inválida ou ausente'; log(`[atividade] ${ad.id}: ${h.disabled} — consultas suspensas`); }
      else h.nextAt = now() + Math.min(intervalMs() * 2 ** h.failures, MAX_BACKOFF_MS);
      for (const a of accounts) run("UPDATE linked_accounts SET sync_state=? WHERE user_id=? AND platform=?", h.disabled ? 'unavailable' : 'error', a.user_id, a.platform);
      // dados ficam como estavam; entradas velhas deixam de ser exibidas pelo critério de staleness
    }
  }

  async function tick() {
    if (running || stopped) return; running = true; lastTickAt = now();
    try {
      for (const ad of listAdapters()) { if (!ad.configured()) continue; await pollPlatform(ad).catch(e => log('[atividade] erro: ' + e.message)); }
      const stale = now() - STALE_X * intervalMs();
      for (const [k, e] of current) if (e.at < stale && !isOnline(e.uid) && !friendsOf(e.uid).some(isOnline)) current.delete(k); // ninguém vendo e dado velho
    } finally { running = false; }
  }
  const schedule = () => { if (stopped) return; timer = setTimeout(async () => { await tick(); schedule(); }, intervalMs()); timer.unref?.(); };

  // ---- consultas (estado inicial e feed): mesma regra canSee ----
  const fresh = (e) => now() - e.at <= STALE_X * intervalMs(); // dado velho (Steam fora do ar, ninguém consultando) não é mostrado
  function readyFor(viewer) {
    try {
      const out = [];
      for (const e of current.values()) if (fresh(e) && canSee(viewer, e.uid, e.platform)) out.push(pub(e));
      return out;
    } catch (e) { log('[atividade] readyFor: ' + e.message); return []; }
  }
  function feedFor(viewer, { limit = 40 } = {}) {
    const ids = [viewer, ...friendsOf(viewer)], now0 = now();
    const friends = ids.map(uid => {
      const accounts = all('SELECT * FROM linked_accounts WHERE user_id=?', uid);
      const playing = [...current.values()].filter(e => e.uid === uid && fresh(e) && canSee(viewer, uid, e.platform)).map(pub);
      const links = uid === viewer ? accounts : accounts.filter(a => a.link_visibility !== 'off');   // o fato de ter a conta vinculada tem regra própria
      return { user_id: uid, playing, linked: links.map(a => ({ platform: a.platform, name: a.display_name, profile_url: a.profile_url })) };
    });
    const events = all(`SELECT a.* FROM activities a JOIN linked_accounts la ON la.user_id=a.user_id AND la.platform=a.platform
      WHERE a.user_id IN (${ids.map(() => '?').join(',')}) AND (la.visibility='friends' OR a.user_id=?) AND a.created_at>? ORDER BY a.created_at DESC LIMIT ?`, ...ids, viewer, now0 - 7 * 864e5, limit * 3)
      .filter(ev => canSee(viewer, ev.user_id, ev.platform) && !hiddenGame(ev.user_id, ev.platform, ev.game_id)).slice(0, limit)
      .map(ev => ({ id: ev.id, user_id: ev.user_id, platform: ev.platform, kind: ev.kind, game: { id: ev.game_id, title: ev.title }, seconds: ev.data ? JSON.parse(ev.data).seconds : null, at: ev.created_at }));
    return { friends, events };
  }

  // ---- ganchos chamados pelas rotas ----
  const poke = () => { if (!stopped && !running && now() - lastTickAt > 10000) setTimeout(() => tick().catch(() => { }), 200).unref?.(); };
  return {
    start() { stopped = false; setTimeout(() => tick().catch(() => { }), 3000).unref?.(); schedule(); },
    stop() { stopped = true; clearTimeout(timer); },
    tick, poke, readyFor, feedFor, canSee, audience,
    onLinked() { poke(); },
    // desvinculou: encerra a publicação (avisando o público ANTES de apagar a conta) e limpa o cache da conta
    onUnlinking(uid, platform, externalId) {
      clear(uid, platform, { why: 'unlink' });
      cache.delete(platform + ':' + externalId);
    },
    // chamado ANTES de gravar a nova visibilidade (para ainda conhecer o público atual): desligar some para todos agora; ligar consulta logo
    onVisibility(uid, platform, visibility) {
      if (visibility === 'off') clear(uid, platform, { why: 'off' });
      else setTimeout(poke, 50).unref?.();
    },
    onGameHidden(uid, platform, gameId) { const cur = current.get(uid + ':' + platform); if (cur?.game.id === gameId) clear(uid, platform, { why: 'hidden' }); },
    // amizade criada/desfeita: cada lado passa a ver (ou deixa de ver) o que o outro está jogando, na hora
    onFriendsChanged(a, b) {
      for (const [x, y] of [[a, b], [b, a]]) for (const e of current.values()) if (e.uid === x) dispatch([y], 'ACTIVITY_UPDATE', { user_id: x, platform: e.platform, activity: canSee(y, x, e.platform) ? pub(e) : null });
    },
    status: () => ({ interval_secs: intervalMs() / 1000, platforms: Object.fromEntries([...health].map(([k, v]) => [k, { failures: v.failures, disabled: v.disabled, last_error: v.lastError, last_ok: v.lastOk, next_in_ms: Math.max(0, v.nextAt - now()) }])), published: current.size, cached: cache.size }),
    _state: { current, cache, health },
  };
}
