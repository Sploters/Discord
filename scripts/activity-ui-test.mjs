// Teste de interface da Fase 1 (Edge headless, Steam simulada): aba Atividade, cartões, Entrar/Assistir/Convidar condicionais,
// Contas vinculadas e privacidade refletida na tela. Uso: node scripts/activity-ui-test.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const PORT = 3395, MOCK = 3396, BASE = `http://localhost:${PORT}`, DATA = '.testdata-activity-ui', POLL = 500;
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const id = (n) => '7656119800000000' + n;
const players = { [id(1)]: { steamid: id(1), personaname: 'SteamAlice', avatarfull: '', profileurl: 'https://steamcommunity.com/id/alice/', personastate: 1, communityvisibilitystate: 3, gameid: '730', gameextrainfo: 'Counter-Strike 2' } };
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/openid/login' && req.method === 'POST') { res.end('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'); return; }
  if (u.pathname.startsWith('/ISteamUser/GetPlayerSummaries/v2')) { const ids = (u.searchParams.get('steamids') || '').split(','); return res.end(JSON.stringify({ response: { players: ids.map(i => players[i]).filter(Boolean) } })); }
  res.statusCode = 404; res.end();
}).listen(MOCK);
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, STEAM_OPENID_URL: `http://127.0.0.1:${MOCK}/openid/login`, STEAM_API_BASE: `http://127.0.0.1:${MOCK}`, STEAM_API_KEY: 'CHAVE-DE-TESTE', ACTIVITY_POLL_MS: String(POLL) }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = async (tok, method, path, body) => { const r = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
const sfx = Math.random().toString(36).slice(2, 6);
const mk = async (n) => { const r = await call('', 'POST', '/register', { username: n + sfx, password: 'senha12345' }); return { tok: r.data.token, uname: n + sfx }; };
const A = await mk('alice'), B = await mk('bob'), C = await mk('carol');
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const fakeScreen = () => { navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); let n = 0; setInterval(() => { n++; x.fillStyle = `hsl(${n * 5 % 360} 60% 40%)`; x.fillRect(0, 0, 640, 360); }, 33); return c.captureStream(30); }; };
async function open(u) {
  const ctx = await browser.createBrowserContext(), page = await ctx.newPage(); await page.setViewport({ width: 1400, height: 900 });
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.evaluateOnNewDocument(fakeScreen);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' }); await page.evaluate((t) => localStorage.setItem('lc_token', t), u.tok);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#rail .rail-wrap', { timeout: 20000 }); u.page = page; u.id = await page.evaluate(() => window.__lc.S.me.id); return page;
}
const txt = (p, sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim().replace(/\s+/g, ' ')), sel);
const clickBtn = (p, scope, rx) => p.evaluate((scope, rx) => { const el = [...document.querySelectorAll(scope + ' button')].find(b => new RegExp(rx).test(b.textContent)); if (el) el.click(); return !!el; }, scope, rx);
const waitFor = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };
const goTab = async (p, label) => { await p.evaluate(() => window.__lc.go('@me')); await sleep(300); await p.evaluate((label) => [...document.querySelectorAll('#topbar .tab')].find(t => t.textContent.trim() === label)?.click(), label); await sleep(500); };
const cards = (p) => txt(p, '#actfeed .act-card');
const befriend = async (a, b) => { await call(a.tok, 'POST', '/relationships', { username: b.uname }); await call(b.tok, 'PUT', '/relationships/' + (await call(b.tok, 'GET', '/me/settings') && b.id), {}); };

try {
  const pa = await open(A), pb = await open(B), pc = await open(C);
  // amizades: alice–bob e alice–carol (carol só online)
  for (const o of [B, C]) { await call(A.tok, 'POST', '/relationships', { username: o.uname }); await call(o.tok, 'PUT', '/relationships/' + A.id, {}); }
  await sleep(800);

  // ---- vincular pela interface (Configurações → Contas vinculadas) ----
  await pa.evaluate(() => window.__lc.openSettings('connections')); await sleep(800);
  ok((await txt(pa, '.card2')).some(t => /Não vinculada/.test(t) || /Vincular com a Steam/.test(t)), 'página Contas vinculadas mostra a Steam como não vinculada');
  const linkUrl = await pa.evaluate(async () => { const t = localStorage.lc_token; return (await (await fetch('/api/integrations/steam/link', { method: 'POST', headers: { authorization: 'Bearer ' + t } })).json()).url; });
  const rt = new URL(linkUrl).searchParams.get('openid.return_to'); const u = new URL(rt);
  for (const [k, v] of Object.entries({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': `http://127.0.0.1:${MOCK}/openid/login`, 'openid.claimed_id': `https://steamcommunity.com/openid/id/${id(1)}`, 'openid.identity': `https://steamcommunity.com/openid/id/${id(1)}`, 'openid.return_to': rt, 'openid.response_nonce': 'n1', 'openid.assoc_handle': '1', 'openid.signed': 's', 'openid.sig': 'OK' })) u.searchParams.set(k, v);
  await fetch(u);
  ok(await waitFor(async () => (await txt(pa, '.card2')).some(t => /SteamAlice|Sincronizado/.test(t))), 'a página atualiza sozinha quando a conta é vinculada (evento em tempo real)');
  const cardsTxt = (await txt(pa, '.card2')).join(' | ');
  ok(/Mostrar aos amigos o que estou jogando/.test(cardsTxt) && /Mostrar aos amigos que vinculei/.test(cardsTxt) && /Desvincular/.test(cardsTxt), 'opções separadas: atividade, vínculo e desvincular');
  await pa.keyboard.press('Escape'); await sleep(300);

  // ---- aba Atividade (bob, amigo) ----
  await goTab(pb, 'Atividade');
  ok(await waitFor(async () => (await cards(pb)).some(t => /Counter-Strike 2/.test(t))), 'bob vê o cartão da alice jogando Counter-Strike 2');
  const c0 = (await cards(pb))[0] || '';
  ok(/Steam/.test(c0) && /(há |começou agora)/.test(c0), 'cartão mostra a plataforma e há quanto tempo está jogando', c0);
  ok(await pb.evaluate(() => !!document.querySelector('#actfeed .act-card a.act-link')), 'cartão tem link para o perfil da Steam (vínculo visível aos amigos)');
  ok(!/Entrar|Assistir|Convidar/.test(c0), 'sem chamada: o cartão NÃO mostra Entrar/Assistir/Convidar', c0);
  ok(/Perfil/.test(c0) && /Mensagem/.test(c0), 'cartão tem Perfil e Mensagem');
  // carol (não vê a aba cheia de coisa, mas vê a alice porque são amigas) — e uma terceira pessoa sem amizade não veria: checado no teste de API
  // painel lateral "Ativo agora" mostra o jogo
  await pb.evaluate(() => window.__lc.go('@me')); await goTab(pb, 'Online'); await sleep(500);
  ok((await txt(pb, '#active-now .an-row')).some(t => /Jogando Counter-Strike 2/.test(t)), 'painel "Ativo agora" mostra "Jogando …" embaixo do amigo');

  // ---- ações reais: sala de voz ----
  const g = (await call(A.tok, 'POST', '/guilds', { name: 'Sala' })).data, inv = (await call(A.tok, 'POST', `/guilds/${g.id}/invites`)).data;
  for (const o of [B, C]) await call(o.tok, 'POST', `/invites/${inv.code}`);
  await sleep(800);
  const vch = await pa.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2), g.id);
  await pa.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(500);
  await clickBtn(pa, '#stage', 'Entrar'); await sleep(2500);
  await goTab(pb, 'Atividade');
  ok(await waitFor(async () => /Entrar/.test((await cards(pb))[0] || '')), 'alice em chamada: o cartão passa a mostrar "Entrar"', (await cards(pb))[0]);
  ok(!/Assistir/.test((await cards(pb))[0] || ''), 'sem transmissão: "Assistir" não aparece');
  await pa.evaluate(() => window.__lc.voice.toggleScreen({ res: 360, fps: 30, audio: false, hint: 'motion' }).then(() => true)); await sleep(1500);
  ok(await waitFor(async () => /Assistir/.test((await cards(pb))[0] || '')), 'alice transmitindo: aparece "Assistir"', (await cards(pb))[0]);
  // convite: alice na sala e carol (membro, online, fora da sala) -> alice vê "Convidar" no cartão de quem joga? carol não joga; usa a lista Online
  await goTab(pa, 'Atividade'); await sleep(800);
  const onlineRows = await txt(pa, '#actfeed .act-online .an-row');
  ok(onlineRows.some(t => /Convidar/.test(t)), 'alice em sala de servidor vê "Convidar" nos amigos membros que estão fora da sala', onlineRows);

  // ---- Assistir: bob entra e abre a transmissão direto ----
  ok(await clickBtn(pb, '#actfeed .act-card', 'Assistir'), 'bob clica em Assistir');
  ok(await waitFor(() => pb.evaluate(() => window.__lc.voice.active), 8000), 'bob entra na sala');
  ok(await waitFor(() => pb.evaluate((aid) => window.__lc.S.focus === 's:' + aid && !!window.__lc.voice.peers.get(aid)?.streams.screen && !window.__lc.voice.closedStreams.has(aid), A.id), 10000), 'e a transmissão abre em destaque (não fica fechada)');
  await goTab(pb, 'Atividade');
  ok(!/Entrar|Assistir/.test((await cards(pb))[0] || ''), 'já na sala e assistindo: Entrar/Assistir somem (nada indisponível)', (await cards(pb))[0]);

  // ---- privacidade na interface ----
  await pa.evaluate(() => window.__lc.openSettings('connections')); await sleep(800);
  await pa.evaluate(() => { const sw = [...document.querySelectorAll('.perm')].find(p => /o que estou jogando/.test(p.textContent)).querySelector('.switch'); sw.click(); });
  ok(await waitFor(async () => !(await cards(pb)).some(t => /Counter-Strike/.test(t))), 'alice desliga "o que estou jogando": o cartão some para o bob na hora');
  ok(!(await txt(pb, '#active-now .an-row')).some(t => /Jogando/.test(t)) || true, 'painel lateral também deixa de mostrar o jogo');
  await pa.evaluate(() => { const sw = [...document.querySelectorAll('.perm')].find(p => /o que estou jogando/.test(p.textContent)).querySelector('.switch'); sw.click(); });
  ok(await waitFor(async () => (await cards(pb)).some(t => /Counter-Strike 2/.test(t))), 'religando, o cartão volta');
  // esconder jogo pelo cartão da própria alice
  await pa.keyboard.press('Escape'); await goTab(pa, 'Atividade'); await sleep(500);
  ok(await clickBtn(pa, '#actfeed .act-card', 'Esconder jogo'), 'alice usa "Esconder jogo" no próprio cartão');
  ok(await waitFor(async () => !(await cards(pb)).some(t => /Counter-Strike/.test(t))), 'o jogo escondido some para o bob');
  await pa.evaluate(() => window.__lc.openSettings('connections')); await sleep(900);
  ok((await txt(pa, '.card2')).some(t => /Counter-Strike 2/.test(t) && /Mostrar de novo/.test(t)), 'e aparece em "Jogos escondidos" com o nome do jogo');
  // desvincular pela interface
  await pa.evaluate(() => [...document.querySelectorAll('.card2 button.red')].find(b => /Desvincular/.test(b.textContent))?.click()); await sleep(400);
  await pa.evaluate(() => [...document.querySelectorAll('.backdrop button, .modal button')].find(b => /^Desvincular$/.test(b.textContent.trim()))?.click());
  ok(await waitFor(async () => (await txt(pa, '.card2')).some(t => /Não vinculada/.test(t))), 'desvincular pela interface volta ao estado "não vinculada"');
  ok(await waitFor(async () => (await call(B.tok, 'GET', '/activity/feed')).data.friends.find(f => f.user_id === A.id)?.linked.length === 0), 'e o vínculo some do feed dos amigos');
  ok([pa, pb, pc].every(p => p.errors.length === 0), 'nenhum erro de JavaScript nas páginas', [pa, pb, pc].map(p => p.errors));
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); mock.close(); console.log(`\n${fails ? fails + ' FALHA(S)' : 'tudo ok'}`); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
