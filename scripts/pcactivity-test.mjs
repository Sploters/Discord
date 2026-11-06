// Atividade pelo jogo aberto no PC (app desktop simulado em window.lcDesktop.detectGame): quem vê, quando some, feed e cartão.
// Pessoas: alice (jogando), bruno (mesmo servidor, não é amigo), dani (amiga, sem servidor em comum), carla (nenhum vínculo).
// Uso: BROWSER=/caminho/do/chrome node scripts/pcactivity-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3273, BASE = `http://localhost:${PORT}`;
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata-pca', { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-pca', RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id, name }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
async function page(u, desk) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', u.name, e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, u.tok);
  if (desk) await p.evaluateOnNewDocument(() => {
    window.__game = { id: 'valorant-win64-shipping', title: 'VALORANT' };
    window.lcDesktop = { isDesktop: true, detectGame: async () => window.__game, setSettings: async () => true, getSettings: async () => ({}), onHotkey: () => { }, setBadge: () => { }, setThrottle: () => { } };
  });
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const seen = (P, uid) => P.evaluate((uid) => { for (const a of window.__lc.S.activities.values()) if (a.user_id === uid) return a.platform + ':' + a.game.title; return null; }, uid);
// força uma rodada de detecção agora (em vez de esperar os 20 s)
const detect = (P) => P.evaluate(() => new Promise(r => setTimeout(r, 3200)));

try {
  const [alice, bruno, dani, carla] = [await reg('alice'), await reg('bruno'), await reg('dani'), await reg('carla')];
  const g = await call(alice.tok, 'POST', '/guilds', { name: 'Turma' }); const code = (await call(alice.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(bruno.tok, 'POST', '/invites/' + code);
  await call(alice.tok, 'POST', '/relationships', { username: 'dani' }); await call(dani.tok, 'PUT', '/relationships/' + alice.id, {});
  const [B, D, C] = [await page(bruno), await page(dani), await page(carla)];
  const A = await page(alice, true);
  await detect(A); await sleep(500);
  ok((await seen(B, alice.id)) === 'pc:VALORANT', 'quem divide servidor vê "Jogando VALORANT" (padrão, como no Discord)', await seen(B, alice.id));
  ok((await seen(D, alice.id)) === 'pc:VALORANT', 'amiga vê', await seen(D, alice.id));
  ok((await seen(C, alice.id)) === null, 'quem não é amigo nem divide servidor NÃO vê', await seen(C, alice.id));
  ok((await seen(A, alice.id)) === 'pc:VALORANT', 'a própria pessoa vê');

  // lista de membros e cartão de perfil de quem vê
  await B.evaluate((gid) => window.__lc.go(gid), g.id); await sleep(800);
  const mem = await B.evaluate(() => [...document.querySelectorAll('#members .cs.playing')].map(e => e.textContent));
  ok(mem.includes('Jogando VALORANT'), 'lista de membros mostra "Jogando VALORANT"', mem);
  await B.evaluate((uid) => [...document.querySelectorAll('#members .mem')].find(m => m.textContent.includes('alice'))?.click(), alice.id); await sleep(500);
  const card = await B.evaluate(() => document.querySelector('.pcard .pplay')?.innerText);
  ok(/VALORANT/.test(card || '') && /No PC/.test(card || ''), 'cartão de perfil mostra o jogo', card);
  await B.screenshot({ path: '.testshots/pcactivity-card.png' });
  // feed da amiga
  const feed = await call(dani.tok, 'GET', '/activity/feed');
  const fa = feed.friends.find(f => f.user_id === alice.id);
  ok(fa?.playing?.[0]?.game?.title === 'VALORANT' && feed.events.some(e => e.user_id === alice.id && e.kind === 'game_start' && e.platform === 'pc'), 'feed da amiga: jogando agora + "começou a jogar"', { playing: fa?.playing, ev: feed.events.length });

  // privacidade: só amigos
  await call(alice.tok, 'PATCH', '/activity/pc', { visibility: 'friends' }); await sleep(400);
  ok((await seen(B, alice.id)) === null && (await seen(D, alice.id)) === 'pc:VALORANT', '"Só amigos": quem só divide servidor deixa de ver na hora; a amiga continua', [await seen(B, alice.id), await seen(D, alice.id)]);
  // ninguém
  await call(alice.tok, 'PATCH', '/activity/pc', { visibility: 'off' }); await sleep(400);
  ok((await seen(D, alice.id)) === null && (await seen(A, alice.id)) === null, '"Ninguém": some para todos (e o app para de informar)');
  await A.evaluate(() => { window.__lc.S.pcActivity = 'off'; }); await sleep(3500);
  ok((await seen(D, alice.id)) === null, 'desligado continua desligado');
  // volta para o padrão: reaparece na próxima detecção
  await call(alice.tok, 'PATCH', '/activity/pc', { visibility: 'servers' }); await A.evaluate(() => { window.__lc.S.pcActivity = 'servers'; });
  await A.evaluate(() => new Promise(r => setTimeout(r, 20500))); await sleep(500);
  ok((await seen(B, alice.id)) === 'pc:VALORANT', 'religado: volta a aparecer na próxima detecção', await seen(B, alice.id));

  // fechou o jogo
  await A.evaluate(() => { window.__game = null; }); await A.evaluate(() => new Promise(r => setTimeout(r, 20500))); await sleep(500);
  ok((await seen(B, alice.id)) === null, 'fechou o jogo: "Jogando" some');
  const ev = (await call(dani.tok, 'GET', '/activity/feed')).events.filter(e => e.user_id === alice.id).map(e => e.kind);
  ok(ev.includes('game_stop'), 'feed registra que parou de jogar', ev);

  // abriu de novo e fechou o app: some na hora
  await A.evaluate(() => { window.__game = { id: 'cs2', title: 'Counter-Strike 2' }; }); await A.evaluate(() => new Promise(r => setTimeout(r, 20500))); await sleep(500);
  ok((await seen(B, alice.id)) === 'pc:Counter-Strike 2', 'trocou de jogo', await seen(B, alice.id));
  // esconder o jogo
  await call(alice.tok, 'PUT', '/activity/games/pc/cs2', { hidden: true }); await sleep(300);
  ok((await seen(B, alice.id)) === null, 'jogo escondido some e não volta');
  await call(alice.tok, 'PUT', '/activity/games/pc/cs2', { hidden: false });
  await A.evaluate(() => new Promise(r => setTimeout(r, 20500))); await sleep(500);
  ok((await seen(B, alice.id)) === 'pc:Counter-Strike 2', 'reexibido: volta');
  await A.close(); await sleep(800);
  ok((await seen(B, alice.id)) === null, 'fechou o app: "Jogando" some na hora');

  // entrada maliciosa direto no gateway
  const evil = await page(carla, false);
  const r = await evil.evaluate(() => new Promise((res) => { const ws = new WebSocket(location.origin.replace('http', 'ws') + '/gateway?token=' + localStorage.lc_token); ws.onopen = () => { ws.send(JSON.stringify({ t: 'ACTIVITY_LOCAL', d: { game: { id: '<img src=x onerror=alert(1)>'.repeat(5), title: 'x'.repeat(500) } } })); setTimeout(() => res(true), 500); }; ws.onerror = () => res(false); }));
  const own = await call(carla.tok, 'GET', '/activity/feed');
  const t = own.friends.find(f => f.user_id === carla.id)?.playing?.[0]?.game;
  ok(r && (!t || (t.title.length <= 80 && !/[<>]/.test(t.id))), 'gateway limpa id e título (sem HTML, título até 80)', t);
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
