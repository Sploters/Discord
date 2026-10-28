// Testa o app Electron: tela de conexão → servidor → ponte lcDesktop (fontes de tela, configurações)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const electronPath = require('../desktop/node_modules/electron');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
fs.rmSync('.testdata3', { recursive: true, force: true }); fs.rmSync('.testdata2', { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: 3222, HTTPS: '0', DATA_DIR: './.testdata2' }, stdio: 'ignore' });
await sleep(1500);
const app = spawn(electronPath, ['desktop', '--remote-debugging-port=9333', '--user-data-dir=' + process.cwd() + '/.testdata3'], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 40 && !browser; i++) { await sleep(500); try { browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null }); } catch { } }
  ok(!!browser, 'Electron iniciou');
  let page; for (let i = 0; i < 20; i++) { page = (await browser.pages()).find(p => p.url().includes('connect.html')); if (page) break; await sleep(300); }
  ok(!!page, 'tela de conexão apareceu (sem servidor configurado)');
  await page.screenshot({ path: '.testshots/10-desktop-connect.png' });
  await page.bringToFront(); await page.$eval('#addr', e => { e.value = 'localhost:3222'; }); await page.click('#go');
  let app2; for (let i = 0; i < 30; i++) { await sleep(400); app2 = (await browser.pages()).find(p => p.url().startsWith('http://localhost:3222')); if (app2) break; }
  ok(!!app2, 'conectou ao servidor e carregou o cliente');
  await app2.waitForSelector('#auth .card', { timeout: 8000 });
  ok(await app2.evaluate(() => !!window.lcDesktop?.isDesktop), 'ponte lcDesktop disponível no cliente');
  const src = await app2.evaluate(() => window.lcDesktop.getSources());
  ok(Array.isArray(src) && src.length > 0 && src[0].thumbnail.startsWith('data:image'), `fontes de captura listadas (${src.length}: ${src.slice(0, 3).map(s => s.name).join(' | ')})`);
  const st = await app2.evaluate(() => window.lcDesktop.getSettings());
  ok(st.closeToTray === true && st.server === 'http://localhost:3222', 'configurações persistidas');
  // registra um usuário e confere a página "Aplicativo" nas configurações
  await app2.evaluate(() => [...document.querySelectorAll('#auth a')].find(a => a.textContent.includes('Registre')).click());
  await sleep(200); const ins = await app2.$$('#auth input'); await app2.bringToFront(); await app2.evaluate(() => { const i = document.querySelectorAll('#auth input'); i[0].value = 'desk'; i[2].value = 'senha123'; i[3].value = 'senha123'; }); await app2.click('#auth .btn');
  await app2.waitForSelector('#rail .rail-wrap', { timeout: 8000 });
  await app2.evaluate(() => window.__lc.openSettings('app')); await sleep(800);
  await app2.screenshot({ path: '.testshots/11-desktop-app-settings.png' });
  ok(await app2.evaluate(() => !!document.querySelector('#settings .switch')), 'página "Aplicativo" renderizada');
  const crt = await app2.evaluate(async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); return 'ok'; } catch (e) { return e.name; } });
  console.log('  info getUserMedia no Electron:', crt);
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
console.log(fails ? `\n${fails} FALHA(S)` : '\nDESKTOP OK');
try { await browser?.disconnect(); } catch { }
app.kill(); srv.kill(); await sleep(500); process.exit(fails ? 1 : 0);
