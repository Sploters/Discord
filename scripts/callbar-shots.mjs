// Capturas dos controles da sala: tela larga (centro só com sala/transmissão) e estreita (pessoais voltam ao centro).
// Uso: node scripts/callbar-shots.mjs  (saída em .testshots/callbar)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3251, BASE = `http://localhost:${PORT}`, OUT = '.testshots/callbar';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
fs.rmSync('.testdata18', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata18', RTC_PORT: '41040', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
try {
  const r = await call('', 'POST', '/register', { username: 'alice', password: 'senha123' });
  const g = await call(r.token, 'POST', '/guilds', { name: 'Turma' });
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, r.token);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  const vch = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
  await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
  await p.waitForFunction(() => window.__lc.voice?.active, { timeout: 15000 }); await sleep(1500);
  const vis = () => p.evaluate(() => [...document.querySelectorAll('#stage .bar .roundbtn')].filter(b => getComputedStyle(b).display !== 'none').map(b => b.title.split(' (')[0]));
  const wide = await vis();
  ok(wide.join('|') === 'Transmitir tela|Lousa compartilhada|Editor de código compartilhado|Desconectar', 'tela larga: centro só com sala/transmissão', wide);
  await p.screenshot({ path: `${OUT}/01-larga.png` });
  await p.setViewport({ width: 600, height: 900, deviceScaleFactor: 2 }); await sleep(800);
  const narrow = await vis();
  ok(narrow.length >= 9 && narrow.some(t => /Silenciar|Ativar microfone/.test(t)), 'tela estreita: microfone e os outros voltam ao centro', narrow);
  await p.screenshot({ path: `${OUT}/02-estreita.png` });
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
