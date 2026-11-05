// App instalável (PWA): manifesto, service worker, Chrome considerando instalável e abertura sem internet.
// Uso: node scripts/pwa-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 3301, BASE = `http://localhost:${PORT}`, DATA = './.testdata31';
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0' }, stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const mf = await fetch(BASE + '/manifest.webmanifest'); ok(mf.headers.get('content-type')?.startsWith('application/manifest+json'), 'manifesto com o tipo certo', mf.headers.get('content-type'));
  const sw = await fetch(BASE + '/sw.js'); ok(sw.ok && /no-cache/.test(sw.headers.get('cache-control')), 'sw.js servido sem cache longo', sw.headers.get('cache-control'));
  const r = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'senha123' }) }).then(r => r.json());
  const P = await browser.newPage(); await P.setViewport({ width: 412, height: 860, isMobile: true, hasTouch: true });
  P.on('pageerror', e => console.log('  PAGEERROR', e.message));
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, r.token);
  await P.goto(BASE); await P.waitForSelector('#rail', { timeout: 15000 });
  const reg = await P.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, active: !!r.active }; });
  ok(reg.active && reg.scope.endsWith('/'), 'service worker registrado e ativo', reg);
  const cdp = await P.createCDPSession();
  const inst = await cdp.send('Page.getInstallabilityErrors');
  ok(!inst.installabilityErrors.length, 'Chrome considera o app instalável', inst.installabilityErrors.map(e => e.errorId));
  const man = await cdp.send('Page.getAppManifest');
  ok(!man.errors.length, 'manifesto sem erros', man.errors);
  // recarrega para o service worker controlar a página e guardar os arquivos
  await P.reload(); await P.waitForSelector('#rail', { timeout: 15000 }); await sleep(800);
  ok(await P.evaluate(() => !!navigator.serviceWorker.controller), 'página controlada pelo service worker');
  await P.setOfflineMode(true);
  const t0 = Date.now(); await P.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
  const off = await P.evaluate(() => ({ title: document.title, scripts: !!document.querySelector('script[src*="app.js"]'), app: !!window.__lc })).catch(e => ({ err: e.message }));
  await sleep(1500);
  const shell = await P.evaluate(() => !!window.__lc && !!document.querySelector('#app, #auth')).catch(() => false);
  ok(off.title === 'Resenha' && shell, 'sem internet, o app ainda abre (da cópia guardada)', { ...off, ms: Date.now() - t0 });
  await P.setOfflineMode(false);
} catch (e) { console.log('ERRO', e.message); fails++; }
finally { await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
