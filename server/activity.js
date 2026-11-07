// Atividade social (Fase 1): agendador, cache, backoff e eventos. Agnóstico de plataforma: só fala com os adaptadores de server/integrations.
//
// PRIVACIDADE — uma única regra decide quem vê a atividade de alguém (usada no tempo real, no READY e no feed, para não divergirem):
//   canSee(viewer, owner) = viewer === owner  OU  (linked_accounts.visibility === 'friends' E os dois são amigos aceitos).
// 'visibility' é a visibilidade da ATIVIDADE; 'link_visibility' é a visibilidade do fato de ter a conta vinculada (são independentes).
// Com visibility = 'off' nada é consultado nem guardado para aquela conta.
//
// Plataforma 'pc' (sem conta vinculada): o app desktop detecta o jogo aberto no PC (a mesma detecção da transmissão: pasta de
// loja/jogos, executável conhecido ou janela em tela cheia) e informa. Regra própria, em users.pc_activity:
//   'servers' (padrão, como o Discord) = amigos aceitos + quem divide um servidor com a pessoa; 'friends' = só amigos; 'off' = nada.
import { PollError } from './integrations/errors.js';
import { isLauncher } from './launchers.js';

const LOCAL_STALE_MS = 90000; // o app desktop informa o jogo a cada ~20 s
const MIN_SECS = 30, MAX_BACKOFF_MS = 15 * 60 * 1000, KEEP_DAYS = 30, KEEP_PER_USER = 200, STALE_X = 3;

export function createActivityService({ all, get, run, newId, dispatch, isOnline, getAdapter, listAdapters, notifyAccount = () => { }, now = () => Date.now(), log = () => { } }) {
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
  const pcVis = (uid) => get('SELECT pc_activity v FROM users WHERE id=?', uid)?.v || 'servers';
  const shareGuild = (a, b) => !!get('SELECT 1 x FROM members m1 JOIN members m2 ON m2.guild_id=m1.guild_id WHERE m1.user_id=? AND m2.user_id=?', a, b);
  const guildPeers = (uid) => all('SELECT DISTINCT m2.user_id id FROM members m1 JOIN members m2 ON m2.guild_id=m1.guild_id WHERE m1.user_id=? AND m2.user_id<>?', uid, uid).map(r => r.id);
  const canSee = (viewer, owner, platform) => {
    if (viewer === owner) return true;
    if (platform === 'pc') { const v = pcVis(owner); return v !== 'off' && (areFriends(viewer, owner) || (v === 'servers' && shareGuild(viewer, owner))); }
    const a = acct(owner, platform);
    return !!a && a.visibility === 'friends' && areFriends(viewer, owner);
  };
  // quem recebe os eventos de `owner`: ele mesmo + amigos aceitos, se a atividade está compartilhada
  const audience = (owner, platform) => {
    if (platform === 'pc') { const v = pcVis(owner); return v === 'off' ? [owner] : [...new Set([owner, ...friendsOf(owner), ...(v === 'servers' ? guildPeers(owner) : [])])]; }
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
  // imagem do jogo guardada junto com o evento (o histórico mostra o ícone/arte mesmo depois que a pessoa parou de jogar)
  const artOf = (game, platform) => { const o = {}; if (game.icon) o.icon = game.icon; const st = platform === 'steam' ? game.id : game.steam; if (st) o.steam = String(st); return Object.keys(o).length ? o : null; };
  const hiddenGame = (uid, platform, gameId) => !!get('SELECT 1 x FROM game_prefs WHERE user_id=? AND platform=? AND game_id=? AND hidden=1', uid, platform, gameId);

  // encerra o que está publicado (jogo parou, conta desvinculada, privacidade desligada…)
  const clear = (uid, platform, { notify = true, why = 'stop', audienceOverride = null } = {}) => {
    const k = uid + ':' + platform, cur = current.get(k); if (!cur) return;
    current.delete(k);
    if (why === 'stop') record(uid, platform, 'game_stop', cur.game, { seconds: Math.max(0, Math.round((now() - cur.since) / 1000)), ...artOf(cur.game, platform) });
    if (notify) dispatch(audienceOverride || audience(uid, platform), 'ACTIVITY_UPDATE', { user_id: uid, platform, activity: null });
  };

  // aplica um snapshot de uma conta: publica/atualiza/encerra
  function apply(a, snap) {
    const k = a.user_id + ':' + a.platform, prev = current.get(k);
    run('UPDATE linked_accounts SET display_name=?, avatar=?, profile_url=?, last_sync=?, sync_state=? WHERE user_id=? AND platform=?',
      snap.name ?? a.display_name, snap.avatar ?? a.avatar, snap.profileUrl ?? a.profile_url, now(), snap.visibility === 'private' ? 'private' : 'ok', a.user_id, a.platform);
    const newState = snap.visibility === 'private' ? 'private' : 'ok';
    if (a.sync_state !== newState || (snap.name && a.display_name !== snap.name) || (snap.avatar && a.avatar !== snap.avatar)) notifyAccount(a.user_id, a.platform); // a página Contas vinculadas atualiza sozinha
    const game = snap.game && !hiddenGame(a.user_id, a.platform, snap.game.id) ? snap.game : null;
    if (!game) return clear(a.user_id, a.platform);
    if (prev && prev.game.id === game.id) { prev.at = now(); prev.state = snap.state; if (prev.game.title !== game.title) prev.game = game; return; }
    if (prev) clear(a.user_id, a.platform); // trocou de jogo: fecha o anterior
    const entry = { uid: a.user_id, platform: a.platform, game, since: now(), state: snap.state, at: now() };
    current.set(k, entry); record(a.user_id, a.platform, 'game_start', game, artOf(game, a.platform));
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
      for (const a of accounts) { const st = h.disabled ? 'unavailable' : 'error'; run('UPDATE linked_accounts SET sync_state=? WHERE user_id=? AND platform=?', st, a.user_id, a.platform); if (a.sync_state !== st) notifyAccount(a.user_id, a.platform); }
      // dados ficam como estavam; entradas velhas deixam de ser exibidas pelo critério de staleness
    }
  }

  async function tick() {
    if (running || stopped) return; running = true; lastTickAt = now();
    try {
      for (const ad of listAdapters()) { if (!ad.configured()) continue; await pollPlatform(ad).catch(e => log('[atividade] erro: ' + e.message)); }
      const stale = now() - STALE_X * intervalMs();
      for (const [k, e] of current) if (e.at < stale && !isOnline(e.uid) && !friendsOf(e.uid).some(isOnline)) current.delete(k); // ninguém vendo e dado velho
      for (const e of [...current.values()]) if (e.platform === 'pc' && now() - e.at > LOCAL_STALE_MS) clear(e.uid, 'pc'); // o app parou de informar (fechou, travou)
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
    const events = all(`SELECT a.* FROM activities a LEFT JOIN linked_accounts la ON la.user_id=a.user_id AND la.platform=a.platform
      WHERE a.user_id IN (${ids.map(() => '?').join(',')}) AND (la.visibility='friends' OR a.user_id=? OR a.platform='pc') AND a.created_at>? ORDER BY a.created_at DESC LIMIT ?`, ...ids, viewer, now0 - 7 * 864e5, limit * 3)
      .filter(ev => canSee(viewer, ev.user_id, ev.platform) && !hiddenGame(ev.user_id, ev.platform, ev.game_id) && !isLauncher({ id: ev.game_id, title: ev.title })).slice(0, limit)
      .map(ev => ({ id: ev.id, user_id: ev.user_id, platform: ev.platform, kind: ev.kind, game: { id: ev.game_id, title: ev.title }, seconds: ev.data ? JSON.parse(ev.data).seconds : null, at: ev.created_at }));
    return { friends, events };
  }

  // ---- destaques: o que os amigos fizeram de marcante (não cada "começou a jogar") ----
  //   session  = jogou por 30 min ou mais        marathon = 3 h ou mais
  //   new_game = primeiro registro daquele jogo (só para quem já tem histórico há mais de 3 dias: conta nova não vira "tudo novo")
  //   streak   = o mesmo jogo em 3 dias diferentes ou mais na semana (um item por pessoa e jogo)
  //   clip     = clipe salvo num servidor em que você também está
  // Mesma regra de privacidade de tudo (canSee + jogos escondidos).
  const TZ = process.env.TZ || 'America/Sao_Paulo';
  const dayKey = (t) => { try { return new Date(t).toLocaleDateString('en-CA', { timeZone: TZ }); } catch { return new Date(t).toISOString().slice(0, 10); } };
  function highlightsFor(viewer, { days = 7, limit = 40 } = {}) {
    const fr = friendsOf(viewer); if (!fr.length) return [];
    const since = now() - days * 864e5, ph = fr.map(() => '?').join(',');
    const seeMemo = new Map(), see = (uid, platform) => { const k = uid + ':' + platform; if (!seeMemo.has(k)) seeMemo.set(k, canSee(viewer, uid, platform)); return seeMemo.get(k); };
    const rows = all(`SELECT * FROM activities WHERE user_id IN (${ph}) AND created_at>? ORDER BY created_at DESC`, ...fr, since)
      .filter(ev => see(ev.user_id, ev.platform) && !hiddenGame(ev.user_id, ev.platform, ev.game_id) && !isLauncher({ id: ev.game_id, title: ev.title })); // launchers registrados antes
    const data = (ev) => { try { return ev.data ? JSON.parse(ev.data) : {}; } catch { return {}; } };
    const game = (ev, d) => ({ id: ev.game_id, title: ev.title, ...(d.icon ? { icon: d.icon } : {}), ...(d.steam ? { steam: d.steam } : {}) });
    const out = [];
    for (const ev of rows) {
      const d = data(ev);
      if (ev.kind === 'game_stop' && d.seconds >= 1800) out.push({ id: ev.id, kind: d.seconds >= 10800 ? 'marathon' : 'session', user_id: ev.user_id, platform: ev.platform, game: game(ev, d), seconds: d.seconds, at: ev.created_at });
      if (ev.kind === 'game_start') {
        const first = get('SELECT MIN(created_at) t FROM activities WHERE user_id=?', ev.user_id)?.t;
        const before = get('SELECT 1 x FROM activities WHERE user_id=? AND game_id=? AND created_at<? LIMIT 1', ev.user_id, ev.game_id, ev.created_at);
        if (first && first < ev.created_at - 3 * 864e5 && !before) out.push({ id: ev.id, kind: 'new_game', user_id: ev.user_id, platform: ev.platform, game: game(ev, d), at: ev.created_at });
      }
    }
    const streaks = new Map(); // pessoa+jogo -> { dias, último evento }
    for (const ev of rows) {
      const k = ev.user_id + ':' + ev.game_id, s = streaks.get(k) || { days: new Set(), last: ev };
      s.days.add(dayKey(ev.created_at)); if (ev.created_at > s.last.created_at) s.last = ev; streaks.set(k, s);
    }
    for (const s of streaks.values()) if (s.days.size >= 3) { const ev = s.last; out.push({ id: 'st' + ev.id, kind: 'streak', user_id: ev.user_id, platform: ev.platform, game: game(ev, data(ev)), days: s.days.size, at: ev.created_at }); }
    for (const c of all(`SELECT c.* FROM clips c WHERE c.author_id IN (${ph}) AND c.created_at>? AND c.guild_id IN (SELECT guild_id FROM members WHERE user_id=?) ORDER BY c.created_at DESC LIMIT 20`, ...fr, since, viewer))
      out.push({ id: 'cl' + c.id, kind: 'clip', user_id: c.author_id, clip: { id: c.id, title: c.title, guild_id: c.guild_id, channel_id: c.channel_id, streamer_id: c.streamer_id, secs: c.secs }, at: c.created_at });
    return out.sort((a, b) => b.at - a.at).slice(0, limit);
  }

  // ---- ganchos chamados pelas rotas ----
  const poke = () => { if (!stopped && !running && now() - lastTickAt > 10000) setTimeout(() => tick().catch(() => { }), 200).unref?.(); };
  return {
    start() { stopped = false; setTimeout(() => tick().catch(() => { }), 3000).unref?.(); schedule(); },
    stop() { stopped = true; clearTimeout(timer); },
    tick, poke, readyFor, feedFor, highlightsFor, canSee, audience,
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
    // jogo aberto no PC, informado pelo app desktop (game = { id, title } | null). Mesmo fluxo da Steam: publica, troca, encerra.
    reportLocal(uid, game) {
      const k = uid + ':pc', prev = current.get(k);
      if (!game || isLauncher(game) || pcVis(uid) === 'off' || hiddenGame(uid, 'pc', game.id)) return clear(uid, 'pc'); // launcher (Riot Client, Steam…) não é jogo
      game = { id: game.id, title: game.title, ...(game.icon ? { icon: game.icon } : {}), ...(game.steam ? { steam: game.steam } : {}) };
      if (prev && prev.game.id === game.id) {
        prev.at = now();
        if ((game.icon && prev.game.icon !== game.icon) || (game.steam && prev.game.steam !== game.steam)) { prev.game = { ...prev.game, ...game }; publish(uid, 'pc', prev); } // a imagem chegou depois
        return;
      }
      if (prev) clear(uid, 'pc');
      const entry = { uid, platform: 'pc', game, since: now(), state: null, at: now() };
      current.set(k, entry); record(uid, 'pc', 'game_start', game, artOf(game, 'pc'));
      publish(uid, 'pc', entry);
    },
    clearLocal(uid) { clear(uid, 'pc'); }, // fechou o app (última conexão caiu)
    // mudou quem pode ver o jogo do PC: quem deixou de poder ver recebe "parou"; quem passou a poder, recebe o jogo atual
    onPcVisibility(uid, before, after) {
      const e = current.get(uid + ':pc'); if (!e) return;
      if (after === 'off') return clear(uid, 'pc', { why: 'off', audienceOverride: [...new Set([uid, ...friendsOf(uid), ...guildPeers(uid)])] });
      const all0 = new Set([...friendsOf(uid), ...guildPeers(uid)]);
      for (const v of all0) dispatch([v], 'ACTIVITY_UPDATE', { user_id: uid, platform: 'pc', activity: canSee(v, uid, 'pc') ? pub(e) : null });
      void before;
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
