// Capturas de tela das telas novas (Fase 1 e 2) com dados de teste (Steam simulada). Saída: .testshots/visual/*.png
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const PORT = 3398, MOCK = 3399, BASE = `http://localhost:${PORT}`, DATA = '.testdata-visual', OUT = '.testshots/visual';
const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const id = (n) => '7656119800000000' + n;
const games = [['730', 'Counter-Strike 2'], ['570', 'Dota 2'], ['1091500', 'Cyberpunk 2077'], ['1245620', 'ELDEN RING']];
const players = {}; games.forEach(([g, t], i) => { players[id(i + 1)] = { steamid: id(i + 1), personaname: 'Jogador' + (i + 1), avatarfull: '', profileurl: 'https://steamcommunity.com/id/p' + (i + 1), personastate: 1, communityvisibilitystate: 3, gameid: g, gameextrainfo: t }; });
const mock = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); if (u.pathname === '/openid/login') return res.end('is_valid:true\n'); if (u.pathname.includes('GetPlayerSummaries')) { const ids = u.searchParams.get('steamids').split(','); return res.end(JSON.stringify({ response: { players: ids.map(i => players[i]).filter(Boolean) } })); } res.statusCode = 404; res.end(); }).listen(MOCK);
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, STEAM_OPENID_URL: `http://127.0.0.1:${MOCK}/openid/login`, STEAM_API_BASE: `http://127.0.0.1:${MOCK}`, STEAM_API_KEY: 'x', ACTIVITY_POLL_MS: '500' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = async (t, m, p, b) => { const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, d: await r.json().catch(() => ({})) }; };
const sfx = Math.random().toString(36).slice(2, 5);
const names = ['voce', 'ana', 'bruno', 'carla', 'diego'], U = [];
for (const n of names) { const r = await call('', 'POST', '/register', { username: n + sfx, password: 'senha12345' }); U.push({ n, tok: r.d.token, uname: n + sfx }); }
const me = U[0];
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const fakeScreen = () => { navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let n = 0; setInterval(() => { n++; const g = x.createLinearGradient(0, 0, 1280, 720); g.addColorStop(0, `hsl(${n % 360} 60% 30%)`); g.addColorStop(1, `hsl(${(n + 80) % 360} 60% 45%)`); x.fillStyle = g; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#fff'; x.font = '64px sans-serif'; x.fillText('Transmissão de teste', 340, 380); }, 33); return c.captureStream(30); }; };
async function open(u, w = 1440, h = 860) { const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: w, height: h }); await p.evaluateOnNewDocument(fakeScreen); await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.evaluate(t => localStorage.setItem('lc_token', t), u.tok); await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#rail .rail-wrap'); u.page = p; u.id = await p.evaluate(() => window.__lc.S.me.id); return p; }
const shot = async (p, name) => { await sleep(500); await p.screenshot({ path: `${OUT}/${name}.png` }); console.log('  ', name); };
const link = async (u, num) => { const r = await call(u.tok, 'POST', '/integrations/steam/link'); const rt = new URL(r.d.url).searchParams.get('openid.return_to'), x = new URL(rt); for (const [k, v] of Object.entries({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': `http://127.0.0.1:${MOCK}/openid/login`, 'openid.claimed_id': 'https://steamcommunity.com/openid/id/' + id(num), 'openid.identity': 'https://steamcommunity.com/openid/id/' + id(num), 'openid.return_to': rt, 'openid.response_nonce': 'n' + num, 'openid.assoc_handle': '1', 'openid.signed': 's', 'openid.sig': 'OK' })) x.searchParams.set(k, v); await fetch(x); };
try {
  for (const u of U) await open(u);
  for (const o of U.slice(1)) { await call(me.tok, 'POST', '/relationships', { username: o.uname }); await call(o.tok, 'PUT', '/relationships/' + me.id, {}); }
  for (let i = 1; i <= 4; i++) await link(U[i], i);
  await sleep(2500);
  const p = me.page;
  await p.evaluate(() => window.__lc.go('@me')); await sleep(300);
  await p.evaluate(() => [...document.querySelectorAll('#topbar .tab')].find(t => t.textContent.trim() === 'Atividade')?.click()); await sleep(1200);
  await shot(p, '01-atividade');
  await p.evaluate(() => window.__lc.openSettings('connections')); await shot(p, '02-contas-nao-vinculada');
  // "voce" também joga (Steam id 5 simulada)
  players[id(5)] = { steamid: id(5), personaname: 'VoceNaSteam', avatarfull: '', profileurl: 'https://steamcommunity.com/id/voce', personastate: 1, communityvisibilitystate: 3, gameid: '1245620', gameextrainfo: 'ELDEN RING' };
  await link(me, 5); await sleep(2000); await shot(p, '03-contas-vinculada');
  await p.keyboard.press('Escape'); await sleep(300);
  await p.evaluate(() => window.__lc.go('@me')); await sleep(300);
  await p.evaluate(() => [...document.querySelectorAll('#topbar .tab')].find(t => t.textContent.trim() === 'Atividade')?.click()); await sleep(1200);
  await shot(p, '01b-atividade-com-voce');
  const g = (await call(me.tok, 'POST', '/guilds', { name: 'Turma' })).d, inv = (await call(me.tok, 'POST', `/guilds/${g.id}/invites`)).d;
  for (const o of U.slice(1, 3)) await call(o.tok, 'POST', `/invites/${inv.code}`);
  await sleep(800);
  const vch = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2), g.id);
  for (const u of [U[1], me]) { await u.page.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(400); await u.page.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent))?.click()); await sleep(1500); }
  await shot(U[1].page, '04-sala-sem-transmissao');
  await U[1].page.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }).then(() => true)); await sleep(2500);
  await p.evaluate((a) => { window.__lc.voice.openStream(a); }, U[1].id); await sleep(1500);
  await shot(p, '05-sala-grade');
  const setLayout = async (label) => { await p.evaluate(() => [...document.querySelectorAll('button')].find(b => /^Layout do palco/.test(b.title))?.click()); await sleep(250); if (label === '__menu') return; await p.evaluate((l) => [...document.querySelectorAll('.menu .it')].find(i => new RegExp('^\\W*' + l).test(i.textContent))?.click(), label); await sleep(900); };
  await setLayout('__menu'); await shot(p, '06-menu-layout'); await p.keyboard.press('Escape'); await p.mouse.click(5, 5);
  for (const [l, f] of [['Destaque', '07-layout-destaque'], ['Principal', '08-layout-principal'], ['Lado a lado', '09-layout-lado'], ['Cinema', '10-layout-cinema']]) { await setLayout(l); await shot(p, f); }
  await setLayout('Autom');
  await p.evaluate(() => [...document.querySelectorAll('button')].find(b => /^Qualidade desta/.test(b.title))?.click()); await sleep(3500); await shot(p, '11-painel-qualidade');
  const pm = await open(U[2], 390, 800); await pm.evaluate(() => [...document.querySelectorAll('#topbar .tab')].find(t => t.textContent.trim() === 'Atividade')?.click()); await sleep(1000); await shot(pm, '12-mobile-atividade');
} catch (e) { console.log('ERRO', e); }
finally { await browser.close(); srv.kill(); mock.close(); setTimeout(() => process.exit(0), 300); }
