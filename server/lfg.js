// Procurar jogadores (LFG): mural de anúncios entre quem usa esta Resenha, pedidos para entrar,
// perfil de jogador por jogo e atalhos para sites externos. Nada é coletado de sites de terceiros.
// Quem vê um anúncio: quem divide algum servidor com o autor ou é amigo dele (a mesma ideia da presença).

const R = (...xs) => xs;
// catálogo: modos, elos (do menor para o maior) e funções de cada jogo; "outro" aceita nome livre
export const GAMES = [
  { id: 'valorant', name: 'Valorant', color: '#ff4655', idLabel: 'Riot ID', idHint: 'Nome#TAG',
    modes: R('Competitivo', 'Sem ranque', 'Premier', 'Disputa rápida', 'Personalizada'),
    ranks: R('Ferro', 'Bronze', 'Prata', 'Ouro', 'Platina', 'Diamante', 'Ascendente', 'Imortal', 'Radiante'),
    roles: R('Duelista', 'Iniciador', 'Controlador', 'Sentinela', 'Flex'),
    links: [{ name: 'DUO.OP.GG', url: 'https://duo.op.gg/pt/valorant/' }, { name: 'Spikr', url: 'https://spikr.com.br/' }] },
  { id: 'lol', name: 'League of Legends', color: '#c89b3c', idLabel: 'Riot ID', idHint: 'Nome#TAG',
    modes: R('Ranqueada Solo/Duo', 'Ranqueada Flex', 'Clash', 'Normal', 'ARAM', 'Arena'),
    ranks: R('Ferro', 'Bronze', 'Prata', 'Ouro', 'Platina', 'Esmeralda', 'Diamante', 'Mestre', 'Grão-Mestre', 'Desafiante'),
    roles: R('Topo', 'Selva', 'Meio', 'Atirador', 'Suporte', 'Preenche'),
    links: [{ name: 'DUO.OP.GG', url: 'https://duo.op.gg/pt/lol/' }] },
  { id: 'cs2', name: 'Counter-Strike 2', color: '#de9b35', idLabel: 'Nick (Steam/Faceit)', idHint: 'seu nick',
    modes: R('Premier', 'Competitivo', 'Faceit', 'Wingman', 'Casual'),
    ranks: R('Faceit 1–3', 'Faceit 4–6', 'Faceit 7–8', 'Faceit 9–10', 'Premier até 10 mil', 'Premier 10–15 mil', 'Premier 15–20 mil', 'Premier 20 mil+'),
    roles: R('Entry', 'AWP', 'Suporte', 'Lurker', 'IGL'),
    links: [{ name: 'DUO.OP.GG (Steam)', url: 'https://duo.op.gg/pt/steam/' }] },
  { id: 'peak', name: 'PEAK', color: '#7cb342', modes: R('Casual'), ranks: [], roles: [], links: [] },
  { id: 'repo', name: 'R.E.P.O.', color: '#8e6cd1', modes: R('Casual'), ranks: [], roles: [], links: [] },
  { id: 'minecraft', name: 'Minecraft', color: '#5d9c3a', modes: R('Sobrevivência', 'Criativo', 'Minigames', 'Modpack'), ranks: [], roles: [], links: [] },
  { id: 'other', name: 'Outro jogo', color: '#5865f2', modes: R('Casual', 'Ranqueada'), ranks: [], roles: [], links: [] },
];
const G = new Map(GAMES.map(g => [g.id, g]));
const NOW_TTL = 2 * 3600e3;          // anúncio "agora" fica 2 h
const AFTER_START = 2 * 3600e3;      // agendado: some 2 h depois do horário
const MAX_OPEN = 3;                  // anúncios abertos por pessoa

export function mountLfg(app, d) {
  const { auth, wrap, bad, get, all, run, newId, dispatch, userPub, clean, audienceOf, canSeeChannel, voiceCount, voiceChannelOf, callInvite, postDm } = d;
  const now = () => Date.now();
  const open = (p) => !p.closed_at && p.expires_at > now() && p.slots > 0;
  const profileOf = (uid, game) => { const r = get('SELECT * FROM lfg_profiles WHERE user_id=? AND game=?', uid, game); return r ? { game, ign: r.ign, rank: r.rank, roles: JSON.parse(r.roles || '[]') } : null; };
  const postObj = (p, viewer) => {
    const reqs = all('SELECT user_id, state, created_at FROM lfg_requests WHERE post_id=? ORDER BY created_at', p.id);
    const ch = p.channel_id && get('SELECT id, name, guild_id FROM channels WHERE id=?', p.channel_id);
    return { id: p.id, game: p.game, game_name: p.game_name, mode: p.mode, slots: p.slots, rank_min: p.rank_min, rank_max: p.rank_max, roles: JSON.parse(p.roles || '[]'), mic: !!p.mic,
      when_at: p.when_at, note: p.note, created_at: p.created_at, expires_at: p.expires_at, closed: !open(p), closed_reason: p.closed_at ? (p.slots <= 0 ? 'full' : 'closed') : (p.slots <= 0 ? 'full' : p.expires_at <= now() ? 'expired' : null),
      author: userPub(p.author_id), author_profile: profileOf(p.author_id, p.game),
      channel: ch ? { id: ch.id, name: ch.name, guild_id: ch.guild_id, in_call: voiceCount(ch.id) } : null,
      // o autor vê todos os pedidos; os outros só o próprio
      requests: reqs.filter(r => viewer === p.author_id || r.user_id === viewer).map(r => ({ user: userPub(r.user_id), state: r.state, profile: profileOf(r.user_id, p.game) })),
      accepted: reqs.filter(r => r.state === 'accepted').map(r => userPub(r.user_id)) };
  };
  const broadcast = (p, type = 'LFG_POST') => { for (const u of audienceOf(p.author_id)) dispatch([u], type, postObj(p, u)); };

  app.get('/api/lfg/meta', auth, (req, res) => res.json({ games: GAMES }));

  // mural: anúncios abertos que eu posso ver (+ os meus encerrados nas últimas 12 h, para ver o resultado)
  app.get('/api/lfg/posts', auth, wrap((req, res) => {
    const seen = new Set(audienceOf(req.uid)), t = now();
    const rows = all('SELECT * FROM lfg_posts WHERE (closed_at IS NULL AND expires_at > ? AND slots > 0) OR (author_id=? AND created_at > ?) ORDER BY COALESCE(when_at, created_at) ASC LIMIT 200', t, req.uid, t - 12 * 3600e3);
    const game = req.query.game && G.has(req.query.game) ? req.query.game : null;
    res.json(rows.filter(p => (p.author_id === req.uid || seen.has(p.author_id)) && (!game || p.game === game)).map(p => postObj(p, req.uid)));
  }));

  app.post('/api/lfg/posts', auth, wrap((req, res) => {
    const b = req.body || {}, g = G.get(String(b.game || ''));
    if (!g) return bad(res, 'Escolha o jogo');
    const gameName = g.id === 'other' ? clean(b.game_name, 40) : g.name;
    if (!gameName) return bad(res, 'Escreva o nome do jogo');
    const mode = clean(b.mode, 40); if (!g.modes.includes(mode) && !(g.id === 'other' && mode)) return bad(res, 'Escolha o modo');
    const slots = Math.round(+b.slots); if (!(slots >= 1 && slots <= 9)) return bad(res, 'Vagas: de 1 a 9');
    const rank = (v) => (v == null || v === '' ? null : g.ranks.includes(String(v)) ? String(v) : undefined);
    const rmin = rank(b.rank_min), rmax = rank(b.rank_max);
    if (rmin === undefined || rmax === undefined) return bad(res, 'Elo inválido');
    if (rmin && rmax && g.ranks.indexOf(rmin) > g.ranks.indexOf(rmax)) return bad(res, 'O elo mínimo é maior que o máximo');
    const roles = [...new Set((Array.isArray(b.roles) ? b.roles : []).map(String))].filter(r => g.roles.includes(r));
    const whenAt = b.when_at ? Math.round(+b.when_at) : null;
    if (whenAt && (whenAt < now() - 60e3 || whenAt > now() + 7 * 86400e3)) return bad(res, 'Horário inválido (até 7 dias)');
    let channel = null;
    if (b.channel_id) { channel = get('SELECT * FROM channels WHERE id=?', String(b.channel_id)); if (!channel || channel.type !== 2 || !canSeeChannel(req.uid, channel)) return bad(res, 'Sala de voz inválida'); }
    if (get('SELECT COUNT(*) n FROM lfg_posts WHERE author_id=? AND closed_at IS NULL AND expires_at > ? AND slots > 0', req.uid, now()).n >= MAX_OPEN) return bad(res, `No máximo ${MAX_OPEN} anúncios abertos por vez`);
    const id = newId(), t = now();
    run('INSERT INTO lfg_posts(id,author_id,game,game_name,mode,slots,rank_min,rank_max,roles,mic,when_at,note,channel_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, req.uid, g.id, gameName, mode, slots, rmin, rmax, JSON.stringify(roles), b.mic ? 1 : 0, whenAt, clean(b.note, 200), channel?.id || null, t, (whenAt || t) + (whenAt ? AFTER_START : NOW_TTL));
    const p = get('SELECT * FROM lfg_posts WHERE id=?', id);
    broadcast(p);
    res.json(postObj(p, req.uid));
  }));

  const postFor = (req, res) => { const p = get('SELECT * FROM lfg_posts WHERE id=?', req.params.id); if (!p || !(p.author_id === req.uid || audienceOf(p.author_id).includes(req.uid))) { bad(res, 'Anúncio não encontrado', 404); return null; } return p; };

  // encerrar (só o autor)
  app.post('/api/lfg/posts/:id/close', auth, wrap((req, res) => {
    const p = postFor(req, res); if (!p) return;
    if (p.author_id !== req.uid) return bad(res, 'Só quem criou pode encerrar', 403);
    if (!p.closed_at) run('UPDATE lfg_posts SET closed_at=? WHERE id=?', now(), p.id);
    const n = get('SELECT * FROM lfg_posts WHERE id=?', p.id); broadcast(n); res.json(postObj(n, req.uid));
  }));

  // "Quero entrar" (ou cancelar o pedido)
  app.post('/api/lfg/posts/:id/request', auth, wrap((req, res) => {
    const p = postFor(req, res); if (!p) return;
    if (p.author_id === req.uid) return bad(res, 'O anúncio é seu');
    if (!open(p)) return bad(res, 'Este anúncio já fechou', 409);
    const cur = get('SELECT * FROM lfg_requests WHERE post_id=? AND user_id=?', p.id, req.uid);
    if (req.body?.cancel) { if (cur?.state === 'pending') run('DELETE FROM lfg_requests WHERE post_id=? AND user_id=?', p.id, req.uid); }
    else if (!cur) {
      run('INSERT INTO lfg_requests(post_id,user_id,state,created_at) VALUES(?,?,?,?)', p.id, req.uid, 'pending', now());
      dispatch([p.author_id], 'LFG_REQUEST', { post_id: p.id, game_name: p.game_name, mode: p.mode, user: userPub(req.uid), profile: profileOf(req.uid, p.game) });
    }
    broadcast(p); res.json(postObj(p, req.uid));
  }));

  // o autor aceita ou recusa: aceitar ocupa uma vaga, avisa a pessoa e a chama para a sala (convite para a chamada)
  app.post('/api/lfg/posts/:id/answer', auth, wrap((req, res) => {
    const p = postFor(req, res); if (!p) return;
    if (p.author_id !== req.uid) return bad(res, 'Só quem criou responde', 403);
    const uid = String(req.body?.user_id || ''), accept = req.body?.accept === true;
    const r = get('SELECT * FROM lfg_requests WHERE post_id=? AND user_id=?', p.id, uid);
    if (!r || r.state !== 'pending') return bad(res, 'Pedido não encontrado');
    if (accept && !open(p)) return bad(res, 'O anúncio já está completo ou fechado', 409);
    run('UPDATE lfg_requests SET state=? WHERE post_id=? AND user_id=?', accept ? 'accepted' : 'declined', p.id, uid);
    let invited = false;
    if (accept) {
      run('UPDATE lfg_posts SET slots=slots-1 WHERE id=?', p.id);
      // estou numa sala de voz de servidor: convite para a chamada (aceitar já coloca no servidor e na sala)
      if (voiceChannelOf(req.uid)) invited = !callInvite(req.uid, uid).error;
      if (!invited) postDm(req.uid, uid, `🎮 Topei você no meu grupo de ${p.game_name} (${p.mode})! Bora jogar.`);
    }
    const n = get('SELECT * FROM lfg_posts WHERE id=?', p.id);
    dispatch([uid], 'LFG_ANSWER', { post_id: p.id, accept, invited, game_name: p.game_name, mode: p.mode, author: userPub(p.author_id) });
    broadcast(n); res.json(postObj(n, req.uid));
  }));

  // perfil de jogador (por jogo): nick/Riot ID, elo e funções que costuma jogar
  app.get('/api/lfg/profile/:uid', auth, wrap((req, res) => {
    const uid = req.params.uid === '@me' ? req.uid : req.params.uid;
    if (uid !== req.uid && !audienceOf(uid).includes(req.uid)) return bad(res, 'Perfil não encontrado', 404);
    res.json(all('SELECT game FROM lfg_profiles WHERE user_id=?', uid).map(r => profileOf(uid, r.game)));
  }));
  app.put('/api/lfg/profile/:game', auth, wrap((req, res) => {
    const g = G.get(req.params.game); if (!g) return bad(res, 'Jogo inválido');
    const ign = clean(req.body?.ign, 60), rank = req.body?.rank ? String(req.body.rank) : null;
    if (rank && !g.ranks.includes(rank)) return bad(res, 'Elo inválido');
    const roles = [...new Set((Array.isArray(req.body?.roles) ? req.body.roles : []).map(String))].filter(r => g.roles.includes(r));
    if (!ign && !rank && !roles.length) run('DELETE FROM lfg_profiles WHERE user_id=? AND game=?', req.uid, g.id);
    else run('INSERT INTO lfg_profiles(user_id,game,ign,rank,roles,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,game) DO UPDATE SET ign=excluded.ign, rank=excluded.rank, roles=excluded.roles, updated_at=excluded.updated_at', req.uid, g.id, ign, rank, JSON.stringify(roles), now());
    res.json(profileOf(req.uid, g.id));
  }));
}
