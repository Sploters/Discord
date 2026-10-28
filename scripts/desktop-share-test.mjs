// Electron (alice) transmite a tela REAL escolhida no seletor; Edge (bob) assiste. Muda qualidade ao vivo.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const electronPath = require('../desktop/node_modules/electron');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
fs.rmSync('.testdata3', { recursive: true, force: true }); fs.rmSync('.testdata2', { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
const PORT = 3222, BASE = `http://localhost:${PORT}`;
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata2' }, stdio: 'ignore' });
await sleep(1500);
const app = spawn(electronPath, ['desktop', '--remote-debugging-port=9333', '--user-data-dir=' + process.cwd() + '/.testdata3'], { stdio: 'ignore', env: { ...process.env, LC_TEST_SERVER: BASE } });
let edge, eb;
const register = async (page, name) => {
  await page.waitForSelector('#auth .card'); await page.evaluate(() => [...document.querySelectorAll('#auth a')].find(a => a.textContent.includes('Registre')).click()); await sleep(200);
  await page.evaluate((n) => { const i = document.querySelectorAll('#auth input'); i[0].value = n; i[2].value = 'senha123'; i[3].value = 'senha123'; }, name);
  await page.click('#auth .btn'); await page.waitForSelector('#rail .rail-wrap', { timeout: 8000 });
};
try {
  for (let i = 0; i < 40 && !eb; i++) { await sleep(500); try { eb = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null }); } catch { } }
  let E; for (let i = 0; i < 30; i++) { E = (await eb.pages()).find(p => p.url().startsWith(BASE)); if (E) break; await sleep(400); }
  ok(!!E, 'Electron carregou o servidor'); await E.bringToFront(); await register(E, 'alice');
  edge = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const B = await edge.newPage(); await B.setViewport({ width: 1300, height: 800 }); await B.goto(BASE); await register(B, 'bob');
  const tok = await E.evaluate(() => localStorage.lc_token);
  const api = (t, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
  const g = await api(tok, 'POST', '/guilds', { name: 'Teste' }); const inv = await api(tok, 'POST', `/guilds/${g.id}/invites`);
  await B.evaluate(async (c) => { await fetch('/api/invites/' + c, { method: 'POST', headers: { authorization: 'Bearer ' + localStorage.lc_token } }); }, inv.code); await sleep(800);
  const vch = (await E.evaluate((id) => window.__lc.S.guilds.get(id).channels, g.id)).find(c => c.type === 2);
  for (const p of [E, B]) await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id);
  await sleep(600);
  for (const p of [E, B]) { await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent)).click()); await sleep(1500); }
  for (let i = 0; i < 30 && !(await E.evaluate(() => [...window.__lc.voice.peers.values()].some(p => p.pc.connectionState === 'connected'))); i++) await sleep(500);
  ok(await E.evaluate(() => [...window.__lc.voice.peers.values()].some(p => p.pc.connectionState === 'connected')), 'chamada conectada (Electron ↔ Edge)');

  // --- abre o seletor de transmissão ---
  await E.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(b => b.title.includes('Transmitir')).click()); const t0 = Date.now(); for (let i = 0; i < 60 && !(await E.evaluate(() => document.querySelectorAll('.modal .source').length)); i++) await sleep(500); console.log('  info seletor pronto em', Date.now() - t0, 'ms');
  const modal = await E.evaluate(() => ({ sources: document.querySelectorAll('.modal .source').length, presets: document.querySelectorAll('.modal .preset').length, tabs: [...document.querySelectorAll('.modal .seg button')].map(b => b.textContent).slice(0, 2) }));
  ok(modal.sources > 0, `seletor lista telas/janelas (${modal.sources})`);
  ok(modal.presets >= 5, `predefinições de qualidade (${modal.presets})`);
  await E.screenshot({ path: '.testshots/20-electron-share-modal.png' });
  // escolhe "Telas" → primeira tela; preset 720p/30
  await E.evaluate(() => [...document.querySelectorAll('.modal .seg button')].find(b => /Telas/.test(b.textContent))?.click()); await sleep(300);
  await E.evaluate(() => document.querySelector('.modal .source')?.click()); await sleep(200);
  await E.evaluate(() => [...document.querySelectorAll('.modal .preset')].find(b => /720p/.test(b.textContent)).click()); await sleep(200);
  await E.screenshot({ path: '.testshots/21-electron-share-choose.png' });
  await E.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(b => /^Transmitir$/.test(b.textContent)).click());
  await sleep(5000);
  const st = await E.evaluate(() => { const t = window.__lc.voice.screen?.getVideoTracks()[0]; return t ? { ...t.getSettings(), label: t.label } : null; });
  ok(!!st, 'transmissão iniciada no Electron (captura real) ' + JSON.stringify(st));
  ok(st && st.height <= 800, `resolução respeita 720p (saindo ${st?.width}x${st?.height})`);
  await sleep(3000);
  const rx = await B.evaluate(() => { const v = document.querySelector('.tile.screen video'); return v ? { w: v.videoWidth, h: v.videoHeight } : null; });
  ok(rx && rx.w > 0, `bob está assistindo a tela real (${rx?.w}x${rx?.h})`);
  const fps = await B.evaluate(async () => { const p = window.__lc.voice.peers.values().next().value; for (const r of (await p.pc.getStats()).values()) if (r.type === 'inbound-rtp' && r.kind === 'video') return r.framesPerSecond || 0; return 0; });
  console.log('  info fps recebido pelo bob:', fps);
  await B.screenshot({ path: '.testshots/22-bob-watching.png' });

  // --- muda qualidade durante a transmissão ---
  await E.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(b => b.title.includes('Parar') || b.title.includes('Transmitir')).click()); await sleep(800);
  ok(await E.evaluate(() => !!document.querySelector('.modal h2')?.textContent.includes('ao vivo')), 'painel "Transmissão ao vivo" abriu');
  await E.screenshot({ path: '.testshots/23-electron-live-panel.png' });
  await E.evaluate(() => [...document.querySelectorAll('.modal .preset')].find(b => /1080p • 60/.test(b.textContent)).click()); await sleep(2500);
  const st2 = await E.evaluate(() => window.__lc.voice.screenOpts);
  ok(st2.res === 1080 && st2.fps === 60, 'qualidade alterada ao vivo para 1080p/60');
  const br = await E.evaluate(() => window.__lc.voice.peers.values().next().value.senders.screenvideo?.getParameters().encodings[0].maxBitrate);
  ok(br >= 7e6, `bitrate subiu para ${br}`);
  await E.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(b => /Parar transmissão/.test(b.textContent)).click()); await sleep(1500);
  ok(await E.evaluate(() => !window.__lc.voice.screen), 'transmissão encerrada');
  ok(await B.evaluate(() => !document.querySelector('.tile.screen')), 'bob deixou de ver a tela');
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
console.log(fails ? `\n${fails} FALHA(S)` : '\nSHARE OK');
try { await eb?.disconnect(); await edge?.close(); } catch { }
app.kill(); srv.kill(); await sleep(500); process.exit(fails ? 1 : 0);
