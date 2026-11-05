// Procurar jogadores (LFG): mural de anúncios entre quem usa este LocalCord, pedidos para entrar,
// perfil de jogador por jogo e atalhos para sites externos. Nada é coletado de sites de terceiros.
// Quem vê um anúncio: quem divide algum servidor com o autor ou é amigo dele (a mesma ideia da presença).
// LFG Atlas (lfgatlas.pages.dev): o único site de LFG que abre os anúncios para outros apps (grátis, sem chave, sem
// conta). O mural mostra os anúncios de lá (filtrados para Brasil/América do Sul) e, se a pessoa marcar, o anúncio dela
// é publicado lá também, com o contato que ela escrever; sai do ar quando o anúncio encerra ou o grupo fecha.
// LFG_ATLAS_OFF=1 desliga; LFG_ATLAS_URL troca o endereço (testes).

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

// ---------- LFG Atlas ----------
const ATLAS = () => String(process.env.LFG_ATLAS_URL || 'https://lfgatlas-bot.jonsimm36.workers.dev').replace(/\/+$/, '');
const atlasOff = () => process.env.LFG_ATLAS_OFF === '1';
// nossos jogos -> slug, região do Brasil e nomes de modo/elo/função como o LFG Atlas aceita (o que não casar fica de fora)
const ATLAS_MAP = {
  valorant: { slug: 'valorant', region: 'BR', modes: { 'Competitivo': 'Competitive', 'Sem ranque': 'Unrated', 'Premier': 'Premier', 'Disputa rápida': 'Swiftplay', 'Personalizada': 'Custom / scrims' },
    ranks: { Ferro: 'Iron', Bronze: 'Bronze', Prata: 'Silver', Ouro: 'Gold', Platina: 'Platinum', Diamante: 'Diamond', Ascendente: 'Ascendant', Imortal: 'Immortal', Radiante: 'Radiant' },
    roles: { Duelista: 'Duelist', Iniciador: 'Initiator', Controlador: 'Controller', Sentinela: 'Sentinel', Flex: 'Flex' } },
  lol: { slug: 'lol', region: 'BR', modes: { 'Ranqueada Solo/Duo': 'Ranked Solo/Duo', 'Ranqueada Flex': 'Ranked Flex', 'Clash': 'Clash', 'Normal': 'Normal Draft', 'ARAM': 'ARAM', 'Arena': 'Arena (when live)' },
    ranks: { Ferro: 'Iron', Bronze: 'Bronze', Prata: 'Silver', Ouro: 'Gold', Platina: 'Platinum', Esmeralda: 'Emerald', Diamante: 'Diamond', Mestre: 'Master', 'Grão-Mestre': 'Grandmaster', Desafiante: 'Challenger' },
    roles: { Topo: 'Top', Selva: 'Jungle', Meio: 'Mid', Atirador: 'ADC', Suporte: 'Support', Preenche: 'Fill' } },
  cs2: { slug: 'cs2', region: 'South America', modes: { 'Premier': 'Premier', 'Competitivo': 'Competitive', 'Faceit': 'FACEIT', 'Wingman': 'Wingman', 'Casual': 'Casual / Deathmatch' },
    ranks: { 'Faceit 1–3': 'FACEIT 1–3', 'Faceit 9–10': 'FACEIT 8–10', 'Premier 10–15 mil': 'Premier 10–15k', 'Premier 15–20 mil': 'Premier 15–20k' },
    roles: { Entry: 'Entry', AWP: 'AWP', Suporte: 'Support', Lurker: 'Lurk', IGL: 'IGL' } },
  peak: { slug: 'peak', region: 'SA', modes: { Casual: 'Chill / first climb' }, ranks: {}, roles: {} },
  repo: { slug: 'repo', region: 'SA', modes: { Casual: 'Chill / first run' }, ranks: {}, roles: {} },
  minecraft: { slug: 'minecraft', region: 'South America', modes: { 'Sobrevivência': 'Survival', 'Criativo': 'Creative / Building', 'Minigames': 'Minigames / Bedwars', 'Modpack': 'Modded' }, ranks: {}, roles: {} },
};
const SLUG_GAME = Object.fromEntries(Object.entries(ATLAS_MAP).map(([id, m]) => [m.slug, id]));
const BR_REGION = /^(br|brazil|brasil|south america|sa|sam|latam|latin america|las|lan|americas)$/i, ANY_REGION = /^(any|global|worldwide|)$/i;
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');
const safeUrl = (u, hosts) => { try { const x = new URL(u); return x.protocol === 'https:' && hosts.test(x.hostname) ? x.href : null; } catch { return null; } };
// anúncio de lá -> só os campos que mostramos (o texto é de qualquer pessoa: vai como texto puro)
const atlasPost = (x) => ({ id: str(x.id, 64), url: safeUrl(x.url, /^lfgatlas\.pages\.dev$/), game: SLUG_GAME[x.game] || null, game_name: str(x.game_name, 40), type: str(x.type, 10),
  title: str(x.title, 80), description: str(x.description, 500), region: str(x.region, 40), platform: str(x.platform, 30), mode: str(x.mode, 60), rank: str(x.rank, 40), role: str(x.role, 40),
  need: Number.isFinite(+x.need) ? +x.need : null, language: str(x.language, 20), mic: !!x.mic, adult: !!x.adult, ready_now: !!x.ready_now, party_code: str(x.party_code, 24),
  contact: { kind: str(x.contact?.kind, 20), value: str(x.contact?.value, 80), join_url: safeUrl(x.contact?.join_url, /^(discord\.gg|(www\.)?discord\.com)$/) },
  created_at: Date.parse(x.created_at) || null, expires_at: Date.parse(x.expires_at) || null, source_name: str(x.source_name, 40) || 'LFG Atlas' });
const NOW_TTL = 2 * 3600e3;          // anúncio "agora" fica 2 h
const AFTER_START = 2 * 3600e3;      // agendado: some 2 h depois do horário
const MAX_OPEN = 3;                  // anúncios abertos por pessoa

export function mountLfg(app, d) {
  const { auth, wrap, wrapA, bad, get, all, run, newId, dispatch, userPub, clean, audienceOf, canSeeChannel, voiceCount, voiceChannelOf, callInvite, postDm } = d;
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
      accepted: reqs.filter(r => r.state === 'accepted').map(r => userPub(r.user_id)),
      atlas: p.atlas_url && open(p) && p.atlas_token ? { url: p.atlas_url } : null };
  };
  // ---------- LFG Atlas: ler, publicar e apagar ----------
  const extCache = new Map();
  const atlasFetch = async (path, opt = {}) => {
    const r = await fetch(ATLAS() + path, { ...opt, headers: { 'content-type': 'application/json', 'user-agent': 'LocalCord/1.0 (+lfg)', ...(opt.headers || {}) }, signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j?.error || `HTTP ${r.status}`), { status: r.status });
    return j;
  };
  const atlasList = async (slug) => {
    const k = slug || '*', c = extCache.get(k);
    if (c && Date.now() - c.at < 60e3) return c.v;
    const j = await atlasFetch(`/api/posts?limit=100${slug ? '&game=' + encodeURIComponent(slug) : ''}`);
    const v = (Array.isArray(j.posts) ? j.posts : []).map(atlasPost).filter(x => x.id && x.title);
    extCache.set(k, { at: Date.now(), v }); return v;
  };
  async function atlasPublish(p, contact) {
    const m = ATLAS_MAP[p.game]; if (!m || atlasOff()) return { error: 'Este jogo não está no LFG Atlas' };
    const roles = JSON.parse(p.roles || '[]').map(r => m.roles[r]).filter(Boolean);
    const hours = p.when_at ? Math.min(24, Math.max(1, (p.when_at - now()) / 3600e3 + 2)) : 2;
    const body = { consent: true, source: 'localcord', game: m.slug, type: 'lfm', title: `${p.game_name} ${p.mode} · precisa de ${p.slots}`.slice(0, 80),
      description: [p.note, p.when_at ? `Horário: ${new Date(p.when_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })} (Brasília)` : null].filter(Boolean).join(' · ').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 500) || undefined,
      region: m.region, mode: m.modes[p.mode], rank: m.ranks[p.rank_min] || m.ranks[p.rank_max], role: roles[0], need: p.slots, language: 'Portuguese', mic: !!p.mic,
      ready_now: !p.when_at, hours: p.when_at ? Math.round(hours * 10) / 10 : undefined, contact };
    try {
      const j = await atlasFetch('/api/posts', { method: 'POST', body: JSON.stringify(body) });
      const id = j.post?.id || j.id, token = j.manage?.edit_token || j.edit_token, url = safeUrl(j.post?.url || j.url, /^lfgatlas\.pages\.dev$/);
      if (!id) return { error: 'O LFG Atlas não confirmou a publicação' };
      run('UPDATE lfg_posts SET atlas_id=?, atlas_token=?, atlas_url=? WHERE id=?', id, token || null, url, p.id);
      extCache.clear(); return { url };
    } catch (e) { return { error: e.message || 'Não consegui publicar no LFG Atlas' }; }
  }
  const atlasRemove = (p) => {
    if (!p?.atlas_id || !p.atlas_token) return;
    run('UPDATE lfg_posts SET atlas_token=NULL WHERE id=?', p.id);
    atlasFetch(`/api/posts/${encodeURIComponent(p.atlas_id)}`, { method: 'DELETE', body: JSON.stringify({ edit_token: p.atlas_token }) }).then(() => extCache.clear(), () => { });
  };

  const broadcast = (p, type = 'LFG_POST') => { for (const u of audienceOf(p.author_id)) dispatch([u], type, postObj(p, u)); };

  app.get('/api/lfg/meta', auth, (req, res) => res.json({ games: GAMES, atlas: !atlasOff() ? Object.keys(ATLAS_MAP) : [] }));

  // anúncios do LFG Atlas (de fora), filtrados por jogo e, por padrão, só Brasil/América do Sul ou "qualquer região"
  app.get('/api/lfg/external', auth, wrapA(async (req, res) => {
    if (atlasOff()) return res.json({ off: true, posts: [] });
    const game = req.query.game && G.has(req.query.game) ? req.query.game : null;
    if (game && !ATLAS_MAP[game]) return res.json({ posts: [], unsupported: true });
    const mine = new Set(all('SELECT atlas_id FROM lfg_posts WHERE atlas_id IS NOT NULL').map(r => r.atlas_id));
    try {
      const list = (await atlasList(game ? ATLAS_MAP[game].slug : null)).filter(x => !mine.has(x.id) && (!x.expires_at || x.expires_at > now()));
      const near = list.filter(x => BR_REGION.test(x.region) || ANY_REGION.test(x.region) || /portug/i.test(x.language));
      res.json({ posts: req.query.all === '1' ? list : near, total: list.length, near: near.length, source: { name: 'LFG Atlas', url: game ? `https://lfgatlas.pages.dev/g/${ATLAS_MAP[game].slug}/` : 'https://lfgatlas.pages.dev/' } });
    } catch (e) { res.json({ posts: [], error: 'Não consegui buscar o LFG Atlas agora.' }); }
  }));

  // mural: anúncios abertos que eu posso ver (+ os meus encerrados nas últimas 12 h, para ver o resultado)
  app.get('/api/lfg/posts', auth, wrap((req, res) => {
    const seen = new Set(audienceOf(req.uid)), t = now();
    const rows = all('SELECT * FROM lfg_posts WHERE (closed_at IS NULL AND expires_at > ? AND slots > 0) OR (author_id=? AND created_at > ?) ORDER BY COALESCE(when_at, created_at) ASC LIMIT 200', t, req.uid, t - 12 * 3600e3);
    const game = req.query.game && G.has(req.query.game) ? req.query.game : null;
    res.json(rows.filter(p => (p.author_id === req.uid || seen.has(p.author_id)) && (!game || p.game === game)).map(p => postObj(p, req.uid)));
  }));

  app.post('/api/lfg/posts', auth, wrapA(async (req, res) => {
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
    // publicar também no LFG Atlas: só se a pessoa marcou, com o contato que ela escreveu (fica público)
    const atlasContact = b.atlas === true ? clean(b.atlas_contact, 60) : null;
    if (b.atlas === true && !ATLAS_MAP[g.id]) return bad(res, 'Este jogo não está no LFG Atlas');
    if (b.atlas === true && !atlasContact) return bad(res, 'Escreva o contato público (Riot ID, nick ou usuário do Discord)');
    if (atlasContact && /https?:\/\//i.test(atlasContact) && !/^https?:\/\/(discord\.gg|(www\.)?discord\.com\/invite)\//i.test(atlasContact)) return bad(res, 'Contato: use Riot ID, nick, usuário do Discord ou convite discord.gg');
    if (get('SELECT COUNT(*) n FROM lfg_posts WHERE author_id=? AND closed_at IS NULL AND expires_at > ? AND slots > 0', req.uid, now()).n >= MAX_OPEN) return bad(res, `No máximo ${MAX_OPEN} anúncios abertos por vez`);
    const id = newId(), t = now();
    run('INSERT INTO lfg_posts(id,author_id,game,game_name,mode,slots,rank_min,rank_max,roles,mic,when_at,note,channel_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, req.uid, g.id, gameName, mode, slots, rmin, rmax, JSON.stringify(roles), b.mic ? 1 : 0, whenAt, clean(b.note, 200), channel?.id || null, t, (whenAt || t) + (whenAt ? AFTER_START : NOW_TTL));
    let atlas = null;
    if (atlasContact) atlas = await atlasPublish(get('SELECT * FROM lfg_posts WHERE id=?', id), atlasContact);
    const p = get('SELECT * FROM lfg_posts WHERE id=?', id);
    broadcast(p);
    res.json({ ...postObj(p, req.uid), atlas_error: atlas?.error || null });
  }));

  const postFor = (req, res) => { const p = get('SELECT * FROM lfg_posts WHERE id=?', req.params.id); if (!p || !(p.author_id === req.uid || audienceOf(p.author_id).includes(req.uid))) { bad(res, 'Anúncio não encontrado', 404); return null; } return p; };

  // encerrar (só o autor)
  app.post('/api/lfg/posts/:id/close', auth, wrap((req, res) => {
    const p = postFor(req, res); if (!p) return;
    if (p.author_id !== req.uid) return bad(res, 'Só quem criou pode encerrar', 403);
    if (!p.closed_at) run('UPDATE lfg_posts SET closed_at=? WHERE id=?', now(), p.id);
    atlasRemove(p);
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
    if (n.slots <= 0) atlasRemove(n); // grupo fechou: sai do LFG Atlas
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
