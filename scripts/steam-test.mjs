// Testes da integração Steam SEM chave e SEM internet: servidor Resenha real + Steam simulada (OpenID e Web API).
// Uso: node scripts/steam-test.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3391, MOCK = 3392, BASE = `http://127.0.0.1:${PORT}`, DATA = '.testdata-steam';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- Steam simulada ----
const STEAM_ID = '76561198000000001', STEAM_ID2 = '76561198000000002';
const nonces = new Set(); let apiCalls = []; let apiMode = 'ok'; // ok | 429 | 500 | 403
const players = { [STEAM_ID]: { steamid: STEAM_ID, personaname: 'SteamAlice', avatarfull: 'https://x/a.jpg', profileurl: 'https://steamcommunity.com/id/alice/', personastate: 1, communityvisibilitystate: 3, gameid: '730', gameextrainfo: 'Counter-Strike 2' },
  [STEAM_ID2]: { steamid: STEAM_ID2, personaname: 'SteamBob', personastate: 1, communityvisibilitystate: 1 } };
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/openid/login' && req.method === 'POST') {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const p = new URLSearchParams(b), nonce = p.get('openid.response_nonce'), good = p.get('openid.mode') === 'check_authentication' && nonce && !nonces.has(nonce) && p.get('openid.sig') === 'ASSINATURA-VALIDA';
      if (good) nonces.add(nonce); res.end(`ns:http://specs.openid.net/auth/2.0\nis_valid:${good ? 'true' : 'false'}\n`);
    }); return;
  }
  if (u.pathname.startsWith('/ISteamUser/GetPlayerSummaries/v2')) {
    apiCalls.push({ key: u.searchParams.get('key'), ids: u.searchParams.get('steamids') });
    if (apiMode !== 'ok') { res.statusCode = +apiMode; return res.end('{}'); }
    const ids = (u.searchParams.get('steamids') || '').split(',');
    return res.end(JSON.stringify({ response: { players: ids.map(i => players[i]).filter(Boolean) } }));
  }
  res.statusCode = 404; res.end();
}).listen(MOCK);

fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, STEAM_OPENID_URL: `http://127.0.0.1:${MOCK}/openid/login`, STEAM_API_BASE: `http://127.0.0.1:${MOCK}`, STEAM_API_KEY: '', STEAM_POLL_SECS: '30' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = async (tok, method, path, body) => { const r = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d }; };
const sfx = Math.random().toString(36).slice(2, 6);
const reg = async (n) => (await call('', 'POST', '/register', { username: n + sfx, password: 'senha12345' })).data.token;

// resposta que a Steam devolveria ao navegador (return_to = o que o servidor pediu)
const steamReturn = (returnTo, over = {}) => {
  const q = new URLSearchParams({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': `http://127.0.0.1:${MOCK}/openid/login`,
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM_ID}`, 'openid.identity': `https://steamcommunity.com/openid/id/${STEAM_ID}`, 'openid.return_to': returnTo,
    'openid.response_nonce': 'n' + Math.random().toString(36).slice(2), 'openid.assoc_handle': '1234', 'openid.signed': 'signed', 'openid.sig': 'ASSINATURA-VALIDA' });
  for (const [k, v] of Object.entries(over)) v === null ? q.delete(k) : q.set(k, v);
  const u = new URL(returnTo); for (const [k, v] of q) u.searchParams.set(k, v); return u;
};
const startLink = async (tok) => { const r = await call(tok, 'POST', '/integrations/steam/link'); const u = new URL(r.data.url); return { r, u, returnTo: u.searchParams.get('openid.return_to') }; };
const cb = async (u) => { const r = await fetch(u, { redirect: 'manual' }); return { status: r.status, html: await r.text() }; };

try {
  const ta = await reg('alice'), tb = await reg('bob');
  // ---- acesso ----
  ok((await call('', 'GET', '/integrations')).status === 401, 'listar integrações exige login');
  ok((await call(ta, 'POST', '/integrations/riot/link')).status === 404, 'plataforma desconhecida (Riot não existe nesta etapa) → 404');
  const list = (await call(ta, 'GET', '/integrations')).data;
  ok(list.length === 1 && list[0].id === 'steam' && list[0].configured === false && list[0].account === null, 'lista mostra só a Steam, sem chave (configured=false) e sem conta', list);
  ok(JSON.stringify(list).indexOf('STEAM_API_KEY') < 0, 'a resposta não vaza a chave');

  // ---- fluxo feliz ----
  const L = await startLink(ta);
  ok(L.u.origin === `http://127.0.0.1:${MOCK}` && L.u.searchParams.get('openid.mode') === 'checkid_setup' && /\/api\/integrations\/steam\/callback\?state=[0-9a-f]{48}$/.test(L.returnTo) && L.u.searchParams.get('openid.realm') === BASE, 'URL do OpenID aponta para a Steam, com return_to/realm do servidor', L.returnTo);
  const good = await cb(steamReturn(L.returnTo));
  ok(good.status === 200 && /vinculada/.test(good.html), 'retorno válido vincula a conta');
  const acc = (await call(ta, 'GET', '/integrations')).data[0].account;
  ok(acc?.external_id === STEAM_ID && acc.visibility === 'friends' && acc.sync_state === 'pending', 'conta aparece vinculada, visibilidade padrão = amigos', acc);
  ok(!JSON.stringify(acc).includes('token'), 'sem token armazenado/exposto');

  // ---- ataques / erros ----
  const replay = await cb(steamReturn(L.returnTo)); ok(replay.status === 400, 'reutilizar o mesmo state é recusado (uso único)');
  const L2 = await startLink(ta);
  ok((await cb(steamReturn(L2.returnTo, { 'openid.return_to': L2.returnTo + '&x=1' }))).status === 400, 'return_to adulterado é recusado');
  const L3 = await startLink(ta);
  ok((await cb(steamReturn(L3.returnTo, { 'openid.op_endpoint': 'https://evil.example/openid' }))).status === 400, 'provedor OpenID diferente é recusado');
  const L4 = await startLink(ta);
  ok((await cb(steamReturn(L4.returnTo, { 'openid.claimed_id': 'https://steamcommunity.com/openid/id/123', 'openid.identity': 'https://steamcommunity.com/openid/id/123' }))).status === 400, 'SteamID malformado é recusado');
  const L5 = await startLink(ta);
  ok((await cb(steamReturn(L5.returnTo, { 'openid.claimed_id': `https://evil.example/openid/id/${STEAM_ID}`, 'openid.identity': `https://evil.example/openid/id/${STEAM_ID}` }))).status === 400, 'claimed_id de outro domínio é recusado');
  const L6 = await startLink(ta);
  ok((await cb(steamReturn(L6.returnTo, { 'openid.sig': 'FORJADA' }))).status === 400, 'assinatura que a Steam não confirma (is_valid:false) é recusada');
  const L7 = await startLink(ta);
  ok((await cb(steamReturn(L7.returnTo, { 'openid.mode': 'cancel' }))).status === 400, 'login cancelado na Steam não vincula');
  const nostate = await cb(new URL(`${BASE}/api/integrations/steam/callback`)); ok(nostate.status === 400, 'callback sem state é recusado');
  ok((await call(ta, 'GET', '/integrations')).data[0].account.external_id === STEAM_ID, 'conta original continua intacta depois das tentativas inválidas');
  // outro usuário tentando a mesma conta Steam
  const LB = await startLink(tb); const dup = await cb(steamReturn(LB.returnTo));
  ok(dup.status === 400 && /outro usuário/.test(dup.html) && (await call(tb, 'GET', '/integrations')).data[0].account === null, 'a mesma conta Steam não pode ser vinculada a dois usuários');
  // state de um usuário não serve para outro (o state liga ao usuário que pediu)
  const LA2 = await startLink(ta); const stolen = await cb(steamReturn(LA2.returnTo)); // ainda é da alice: re-vincula a mesma conta (ok), nunca a do bob
  ok((await call(tb, 'GET', '/integrations')).data[0].account === null, 'o state sempre vincula ao usuário que iniciou o pedido');

  // ---- privacidade ----
  ok((await call(ta, 'PATCH', '/integrations/steam', { visibility: 'todos' })).status === 400, 'visibilidade inválida é recusada');
  const off = await call(ta, 'PATCH', '/integrations/steam', { visibility: 'off' }); ok(off.status === 200 && off.data.visibility === 'off', 'usuário pode desligar o compartilhamento');
  ok((await call(tb, 'PATCH', '/integrations/steam', { visibility: 'off' })).status === 404, 'sem conta vinculada não há o que alterar');

  // ---- desvincular ----
  ok((await call(ta, 'DELETE', '/integrations/steam')).status === 200 && (await call(ta, 'GET', '/integrations')).data[0].account === null, 'desvincular remove a conta');
  const again = await startLink(tb); const nowOk = await cb(steamReturn(again.returnTo)); ok(nowOk.status === 200, 'depois de desvinculada, a conta Steam pode ser vinculada por outro usuário');
  ok(apiCalls.length === 0, 'nenhuma chamada à Web API sem chave configurada', apiCalls.length);
} catch (e) { console.log('ERRO', e); fails++; }
finally { srv.kill(); mock.close(); console.log(`\n${fails ? fails + ' FALHA(S)' : 'tudo ok'}`); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
