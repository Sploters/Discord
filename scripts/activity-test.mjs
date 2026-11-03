// Testes do feed de atividade (Fase 1, etapas 2–4 no servidor): privacidade, tempo real, READY, feed, falhas — Steam SIMULADA, sem chave real.
// Uso: node scripts/activity-test.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
const PORT = 3393, MOCK = 3394, BASE = `http://127.0.0.1:${PORT}`, DATA = '.testdata-activity', POLL = 400;
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- Steam simulada (jogos controláveis) ----------
const id = (n) => '7656119800000000' + n;
const players = {}; const setP = (n, over) => { players[id(n)] = { steamid: id(n), personaname: 'Steam' + n, avatarfull: 'https://x/' + n + '.jpg', profileurl: 'https://steamcommunity.com/id/p' + n + '/', personastate: 1, communityvisibilitystate: 3, ...over }; };
const game = (gid, name) => ({ gameid: String(gid), gameextrainfo: name });
setP(1, game(730, 'Counter-Strike 2')); setP(2, game(570, 'Dota 2')); setP(3, game(440, 'Team Fortress 2')); setP(4, game(10, 'Jogo do Dave')); setP(5, { communityvisibilitystate: 1 });
let apiMode = 'ok'; const calls = [];
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/openid/login' && req.method === 'POST') { let b = ''; req.on('data', d => b += d); req.on('end', () => { const p = new URLSearchParams(b); res.end(`ns:http://specs.openid.net/auth/2.0\nis_valid:${p.get('openid.sig') === 'OK' ? 'true' : 'false'}\n`); }); return; }
  if (u.pathname.startsWith('/ISteamUser/GetPlayerSummaries/v2')) {
    const ids = (u.searchParams.get('steamids') || '').split(','); calls.push({ t: Date.now(), ids, key: u.searchParams.get('key') });
    if (apiMode !== 'ok') { res.statusCode = +apiMode; return res.end('{}'); }
    return res.end(JSON.stringify({ response: { players: ids.map(i => players[i]).filter(Boolean) } }));
  }
  res.statusCode = 404; res.end();
}).listen(MOCK);

fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, STEAM_OPENID_URL: `http://127.0.0.1:${MOCK}/openid/login`, STEAM_API_BASE: `http://127.0.0.1:${MOCK}`, STEAM_API_KEY: 'CHAVE-DE-TESTE', ACTIVITY_POLL_MS: String(POLL) }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = async (tok, method, path, body) => { const r = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d }; };
const sfx = Math.random().toString(36).slice(2, 6), NAMES = ['alice', 'bob', 'carol', 'dave', 'erin'];
const U = {}; // nome -> { tok, id, uname, ws, ready, ev:[] }
for (const n of NAMES) { const r = await call('', 'POST', '/register', { username: n + sfx, password: 'senha12345' }); U[n] = { tok: r.data.token, uname: n + sfx, ev: [] }; }

function connect(n) {
  const u = U[n]; const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + u.tok);
  const ready = new Promise(res => ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'READY') { u.ready = m.d; u.id = m.d.user.id; res(m.d); } else if (m.t === 'ACTIVITY_UPDATE') u.ev.push({ ...m.d, at: Date.now() }); }));
  u.ws = ws; return ready;
}
const disconnect = (n) => { U[n].ws?.close(); };
for (const n of NAMES) await connect(n);
const uid = (n) => U[n].id, evOf = (viewer, owner) => U[viewer].ev.filter(e => e.user_id === uid(owner));
const befriend = async (a, b) => { await call(U[a].tok, 'POST', '/relationships', { username: U[b].uname }); await call(U[b].tok, 'PUT', '/relationships/' + uid(a), {}); };
const steamReturn = (returnTo, steamId) => { const u = new URL(returnTo); const q = { 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': `http://127.0.0.1:${MOCK}/openid/login`, 'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}`, 'openid.identity': `https://steamcommunity.com/openid/id/${steamId}`, 'openid.return_to': returnTo, 'openid.response_nonce': 'n' + Math.random(), 'openid.assoc_handle': '1', 'openid.signed': 's', 'openid.sig': 'OK' }; for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); return u; };
const link = async (n, num) => { const r = await call(U[n].tok, 'POST', '/integrations/steam/link'); const rt = new URL(r.data.url).searchParams.get('openid.return_to'); const resp = await fetch(steamReturn(rt, id(num))); return resp.status; };
const feed = async (n) => (await call(U[n].tok, 'GET', '/activity/feed')).data;
const playingOf = (f, owner) => f.friends.find(x => x.user_id === uid(owner))?.playing || [];
const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); } return false; };

try {
  // ---------- preparação ----------
  await befriend('alice', 'bob'); await befriend('alice', 'dave'); await befriend('bob', 'carol'); // carol NÃO é amiga da alice; erin não é amiga de ninguém
  for (const [n, k] of [['alice', 1], ['bob', 2], ['carol', 3], ['dave', 4], ['erin', 5]]) ok(await link(n, k) === 200, `${n} vincula a Steam ${k}`);
  ok((await call(U.dave.tok, 'PATCH', '/integrations/steam', { visibility: 'off' })).status === 200, 'dave desliga o compartilhamento da atividade (visibility=off)');
  const t0 = calls.length, tStart = Date.now();
  await waitFor(() => U.bob.ev.some(e => e.user_id === uid('alice') && e.activity), 5000);
  await sleep(1500);

  // ---------- consulta em lote ----------
  const batch = calls.slice(t0);
  ok(batch.length > 0 && batch.every(c => c.key === 'CHAVE-DE-TESTE'), 'a chave do servidor é enviada à Steam (nunca ao cliente)');
  ok(Math.max(...batch.map(c => c.ids.length)) >= 4, 'consulta em lote: um único pedido leva vários SteamIDs', Math.max(...batch.map(c => c.ids.length)));
  ok(batch.every(c => c.ids.length > 1) && batch.length <= Math.ceil((Date.now() - tStart) / POLL) + 3, 'não há consultas individuais por usuário (poucas chamadas no período)', { chamadas: batch.length });
  ok(!batch.some(c => c.ids.includes(id(4))), 'conta com atividade desligada (dave, off) nunca é consultada na Steam');
  ok(JSON.stringify([U.alice.ready, await feed('alice')]).indexOf('CHAVE-DE-TESTE') < 0, 'a chave não aparece em nenhuma resposta ao cliente');

  // ---------- tempo real: quem recebe o quê ----------
  const hasPlay = (v, o, title) => evOf(v, o).some(e => e.activity?.game?.title === title);
  ok(hasPlay('bob', 'alice', 'Counter-Strike 2'), 'bob (amigo) recebe a atividade da alice em tempo real');
  ok(hasPlay('alice', 'bob', 'Dota 2'), 'alice recebe a atividade do bob');
  ok(hasPlay('alice', 'alice', 'Counter-Strike 2'), 'alice recebe a própria atividade');
  ok(evOf('carol', 'alice').length === 0, 'carol (NÃO amiga da alice) não recebe nada da alice');
  ok(hasPlay('carol', 'bob', 'Dota 2') && evOf('alice', 'carol').length === 0, 'carol vê o bob (amigos), mas a alice não vê a carol (não são amigos)');
  ok(evOf('erin', 'alice').length + evOf('erin', 'bob').length + evOf('erin', 'carol').length === 0, 'erin (sem amigos) não recebe atividade de ninguém');
  ok(NAMES.every(v => evOf(v, 'dave').length === 0), 'dave (off) não gera evento para ninguém, nem para ele mesmo');
  const leakCheck = () => NAMES.every(v => U[v].ev.every(e => v === NAMES.find(n => uid(n) === e.user_id) || (e.user_id === uid('alice') && ['bob', 'dave'].includes(v)) || (e.user_id === uid('bob') && ['alice', 'carol'].includes(v)) || (e.user_id === uid('carol') && ['bob'].includes(v))));
  if (!leakCheck()) for (const v of NAMES) for (const e of U[v].ev) console.log('   dbg', v, 'recebeu de', NAMES.find(n => uid(n) === e.user_id), e.activity?.game?.title);
  ok(leakCheck(), 'matriz de destinatários: nenhum evento chegou a quem não é amigo ou o próprio');

  // ---------- READY respeita a mesma regra ----------
  for (const n of ['alice', 'carol', 'erin']) { disconnect(n); }
  await sleep(300);
  const rd = {}; for (const n of ['alice', 'carol', 'erin']) rd[n] = await connect(n);
  const rid = (n) => rd[n].activities.map(a => a.user_id);
  ok(rid('alice').includes(uid('alice')) && rid('alice').includes(uid('bob')) && !rid('alice').includes(uid('dave')) && !rid('alice').includes(uid('carol')), 'READY da alice: ela e o bob; sem dave (off) e sem carol (não amiga)', rid('alice').length);
  ok(rid('carol').includes(uid('bob')) && rid('carol').includes(uid('carol')) && !rid('carol').includes(uid('alice')), 'READY da carol: bob e ela, nunca a alice');
  ok(!rid('erin').includes(uid('alice')) && !rid('erin').includes(uid('bob')) && !rid('erin').includes(uid('carol')), 'READY da erin: nada de ninguém');
  ok(rd.alice.activities.every(a => typeof a.game?.title === 'string' && !('key' in a)), 'READY só leva campos públicos da atividade');

  // ---------- feed (REST) ----------
  const fa = await feed('alice'), fc = await feed('carol'), fe = await feed('erin');
  ok(playingOf(fa, 'bob')[0]?.game.title === 'Dota 2' && fa.friends.some(f => f.user_id === uid('dave')) && playingOf(fa, 'dave').length === 0, 'feed da alice: bob jogando Dota; dave é amigo mas não mostra jogo', fa.friends.map(f => f.playing.length));
  ok(!fc.friends.some(f => f.user_id === uid('alice')) && !fc.events.some(e => e.user_id === uid('alice')) && !fc.users.some(u => u.id === uid('alice')), 'feed da carol não contém a alice (nem amigo, nem evento, nem perfil)');
  ok(fe.friends.length === 1 && fe.friends[0].user_id === uid('erin') && fe.events.length === 0, 'feed da erin: só ela mesma (privada na Steam: sem jogo)');
  ok(fa.events.some(e => e.user_id === uid('bob') && e.kind === 'game_start') && !fa.events.some(e => e.user_id === uid('dave')), 'eventos recentes: bob sim, dave (off) não');
  ok((await call('', 'GET', '/activity/feed')).status === 401, 'feed exige login');
  ok(JSON.stringify(fa.users).indexOf('pass_hash') < 0 && JSON.stringify(fa.users).indexOf('salt') < 0, 'feed expõe só dados públicos de usuário');

  // ---------- visibilidade da atividade (off/friends) ----------
  const nb = U.bob.ev.length;
  ok((await call(U.alice.tok, 'PATCH', '/integrations/steam', { visibility: 'off' })).status === 200, 'alice desliga a atividade');
  ok(await waitFor(() => U.bob.ev.slice(nb).some(e => e.user_id === uid('alice') && e.activity === null)), 'bob recebe o "sumiu" da alice imediatamente');
  ok(playingOf(await feed('bob'), 'alice').length === 0, 'feed do bob não mostra mais a alice jogando');
  ok(!(await feed('bob')).events.some(e => e.user_id === uid('alice')), 'eventos da alice somem do feed do bob');
  ok((await feed('alice')).events.some(e => e.user_id === uid('alice')), 'a própria alice ainda vê o seu histórico');
  const c1 = calls.length; await sleep(1300);
  ok(!calls.slice(c1).some(c => c.ids.includes(id(1))), 'com off, a conta da alice deixa de ser consultada');
  const nb2 = U.bob.ev.length;
  await call(U.alice.tok, 'PATCH', '/integrations/steam', { visibility: 'friends' });
  ok(await waitFor(() => U.bob.ev.slice(nb2).some(e => e.user_id === uid('alice') && e.activity?.game.title === 'Counter-Strike 2')), 'reativando, a atividade volta para o bob');

  // ---------- visibilidade da conta vinculada ≠ visibilidade da atividade ----------
  await call(U.alice.tok, 'PATCH', '/integrations/steam', { link_visibility: 'off' });
  const fb = await feed('bob');
  ok(playingOf(fb, 'alice').length === 1 && (fb.friends.find(f => f.user_id === uid('alice')).linked.length === 0), 'esconder que vinculou a Steam não esconde o jogo (e o inverso é independente)');
  const fa2 = await feed('alice'); ok(fa2.friends.find(f => f.user_id === uid('alice')).linked.length === 1, 'a própria alice continua vendo a sua conta vinculada');
  await call(U.alice.tok, 'PATCH', '/integrations/steam', { link_visibility: 'friends', visibility: 'off' });
  const fb2 = await feed('bob');
  ok(playingOf(fb2, 'alice').length === 0 && fb2.friends.find(f => f.user_id === uid('alice')).linked.length === 1, 'atividade off + conta visível: o amigo vê que vinculou, mas não o que joga');
  await call(U.alice.tok, 'PATCH', '/integrations/steam', { visibility: 'friends' }); await waitFor(async () => playingOf(await feed('bob'), 'alice').length === 1);

  // ---------- jogo escondido ----------
  const nb3 = U.bob.ev.length;
  ok((await call(U.alice.tok, 'PUT', '/activity/games/steam/730', { hidden: true })).status === 200, 'alice esconde o Counter-Strike 2');
  ok(await waitFor(() => U.bob.ev.slice(nb3).some(e => e.user_id === uid('alice') && e.activity === null)), 'o jogo escondido some para o bob na hora');
  await sleep(1300);
  ok(!U.bob.ev.slice(nb3).some(e => e.user_id === uid('alice') && e.activity), 'continua escondido nas consultas seguintes (não reaparece)');
  ok(!(await feed('bob')).events.some(e => e.user_id === uid('alice') && e.game.id === '730'), 'e não aparece nos eventos recentes');
  ok((await call(U.erin.tok, 'PUT', '/activity/games/steam/730', { hidden: true })).status === 200, 'conta com perfil privado também pode gerir jogos escondidos');
  await call(U.alice.tok, 'PUT', '/activity/games/steam/730', { hidden: false });

  // ---------- troca e fim de jogo ----------
  const nb4 = U.bob.ev.length; setP(1, game(1091500, 'Cyberpunk 2077'));
  ok(await waitFor(() => U.bob.ev.slice(nb4).some(e => e.user_id === uid('alice') && e.activity?.game.title === 'Cyberpunk 2077')), 'trocou de jogo: bob vê o novo jogo');
  setP(1, {});
  ok(await waitFor(() => U.bob.ev.slice(nb4).some(e => e.user_id === uid('alice') && e.activity === null)), 'parou de jogar: bob recebe o fim');
  const evs = (await feed('bob')).events.filter(e => e.user_id === uid('alice'));
  ok(evs.some(e => e.kind === 'game_stop' && typeof e.seconds === 'number') && evs.some(e => e.kind === 'game_start'), 'eventos recentes têm início e fim (com duração da sessão)', evs.map(e => e.kind + ':' + e.game.title));
  setP(1, game(730, 'Counter-Strike 2'));
  await waitFor(async () => playingOf(await feed('bob'), 'alice').length === 1);

  // ---------- amizade desfeita / refeita ----------
  const nb5 = U.bob.ev.length;
  await call(U.alice.tok, 'DELETE', '/relationships/' + uid('bob'));
  ok(await waitFor(() => U.bob.ev.slice(nb5).some(e => e.user_id === uid('alice') && e.activity === null)), 'desfez a amizade: bob deixa de ver a alice na hora');
  ok(!(await feed('bob')).friends.some(f => f.user_id === uid('alice')), 'feed do bob não lista mais a alice');
  const nb6 = U.bob.ev.length; await befriend('alice', 'bob');
  ok(await waitFor(() => U.bob.ev.slice(nb6).some(e => e.user_id === uid('alice') && e.activity?.game.title === 'Counter-Strike 2')), 'refez a amizade: bob volta a ver o que a alice joga, sem esperar o próximo ciclo');

  // ---------- desvincular ----------
  const nb7 = U.bob.ev.length;
  ok((await call(U.alice.tok, 'DELETE', '/integrations/steam')).status === 200, 'alice desvincula a Steam');
  ok(await waitFor(() => U.bob.ev.slice(nb7).some(e => e.user_id === uid('alice') && e.activity === null)), 'desvincular encerra a atividade para os amigos imediatamente');
  const c2 = calls.length; await sleep(1300);
  ok(!calls.slice(c2).some(c => c.ids.includes(id(1))), 'o polling daquela conta é interrompido');
  const fb3 = await feed('bob'); ok(!fb3.events.some(e => e.user_id === uid('alice')) && playingOf(fb3, 'alice').length === 0 && fb3.friends.find(f => f.user_id === uid('alice')).linked.length === 0, 'dados associados removidos do feed (histórico, jogo e conta)');
  ok(!(await feed('alice')).events.some(e => e.user_id === uid('alice')), 'e do próprio feed da alice');
  disconnect('alice'); await sleep(200); const ra2 = await connect('alice'); ok(!ra2.activities.some(a => a.user_id === uid('alice')), 'READY da alice sem atividade depois de desvincular (cache limpo)');

  // ---------- falhas da Steam ----------
  apiMode = '500'; const c3 = calls.length; await sleep(3500);
  const during = calls.slice(c3); const gaps = during.slice(1).map((c, i) => c.t - during[i].t);
  ok(during.length >= 2 && during.length <= 8, 'Steam fora do ar (500): continua tentando, mas com recuo (poucas chamadas)', { chamadas: during.length, intervalosMs: gaps });
  ok(gaps.length < 2 || gaps[gaps.length - 1] >= gaps[0], 'o intervalo entre tentativas não diminui (backoff)', gaps);
  const reg = await call('', 'POST', '/register', { username: 'novo' + sfx, password: 'senha12345' });
  ok(reg.status === 200, 'durante a falha da Steam, cadastro e login funcionam');
  const nw = await new Promise(res => { const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + reg.data.token); ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'READY') { res(m.d); ws.close(); } }); });
  ok(Array.isArray(nw.activities) && nw.relationships && nw.guilds, 'READY é entregue normalmente durante a falha');
  ok((await call(U.bob.tok, 'GET', '/relationships')).status !== 500 && (await feed('bob')).friends.length >= 1, 'amizades e feed continuam respondendo');
  ok((await call(U.bob.tok, 'GET', '/integrations')).data[0].account.sync_state === 'error', 'a conta mostra o estado de sincronização com erro');
  apiMode = 'ok'; ok(await waitFor(async () => (await call(U.bob.tok, 'GET', '/integrations')).data[0].account.sync_state === 'ok', 8000), 'Steam volta: sincronização se recupera sozinha');
  apiMode = '403'; const c4 = calls.length; await sleep(2500);
  const afterKey = calls.length; await sleep(1500);
  ok(calls.length - c4 <= 2 && calls.length === afterKey, 'chave recusada (403): as consultas são suspensas (não insiste)', { chamadas: calls.length - c4 });
  ok((await call(U.bob.tok, 'GET', '/integrations')).data[0].account.sync_state === 'unavailable' && (await call(U.bob.tok, 'GET', '/me/settings')).status === 200, 'estado "indisponível" e o resto do LocalCord segue normal');
} catch (e) { console.log('ERRO', e); fails++; }
finally { for (const n of NAMES) U[n].ws?.close(); srv.kill(); mock.close(); console.log(`\n${fails ? fails + ' FALHA(S)' : 'tudo ok'}`); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
