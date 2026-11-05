// Versões do app desktop na call e relatório de problema: selinho e aviso de quem está desatualizado, versão mínima
// barrando a entrada na call, relatório com diagnóstico enviado por DM ao administrador. Uso: node scripts/appver-test.mjs
// (a versão mais nova vem do GitHub pelo servidor; sem internet, o teste do selinho usa a versão do próprio app)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', OUT = '.testshots/appver';
const PORT = 3299, BASE = `http://localhost:${PORT}`, DATA = './.testdata29';
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', NODE_USE_ENV_PROXY: '1', NODE_EXTRA_CA_CERTS: '/root/.ccr/ca-bundle.crt', NO_PROXY: 'localhost,127.0.0.1' }, stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
try {
  const a = await call('', 'POST', '/register', { username: 'alice', password: 'senha123' }); await sleep(20);
  const b = await call('', 'POST', '/register', { username: 'bruno', password: 'senha123' });
  const g = await call(a.token, 'POST', '/guilds', { name: 'T' }); const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`); await call(b.token, 'POST', '/invites/' + inv.code);
  const page = async (tok, desk) => { const c = await browser.createBrowserContext(), P = await c.newPage(); await P.setViewport({ width: 1300, height: 800 }); P.on('pageerror', e => console.log('  PAGEERROR', e.message));
    await P.evaluateOnNewDocument((t, desk) => { localStorage.lc_token = t; window.__toasts = []; new MutationObserver(() => { const e = document.getElementById('toast'); if (e && window.__toasts.at(-1) !== e.textContent) window.__toasts.push(e.textContent); }).observe(document, { childList: true, subtree: true }); if (desk) { const fns = { getSettings: async () => ({ version: desk }), getUpdate: async () => null, installUpdate: async () => false, getDiagnostics: async () => ({ app: desk, gpus: [{ nome: 'GPU de teste', ativa: true }], log: 'linha de log' }) }; window.lcDesktop = new Proxy(fns, { get: (o, k) => (k in o ? o[k] : k === 'isDesktop' ? true : () => Promise.resolve({})) }); } }, tok, desk);
    await P.goto(BASE); await P.waitForSelector('#rail'); return P; };
  const A = await page(a.token, null), B = await page(b.token, '1.0.10'); await sleep(500); a.user = await A.evaluate(() => window.__lc.S.me); b.user = await B.evaluate(() => window.__lc.S.me);
  const latest = (await (await fetch(BASE + '/api/desktop/update')).json()).version; console.log('  versão mais nova (servidor):', latest);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(400); await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click()); await P.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 15000 }); }
  await sleep(1500);
  const seen = await A.evaluate((u) => ({ app: window.__lc.S.voice.get(u)?.app, badge: document.querySelector(`.vuser[data-uid="${u}"] .appold`)?.textContent, tile: !!document.querySelector(`.tile.utile[data-uid="${u}"] .appold`), toast: window.__toasts.find(t => /versão antiga/.test(t)) }), b.user.id);
  ok(seen.app === '1.0.10' && seen.badge === '1.0.10' && seen.tile, 'alice vê o selinho de versão antiga do bruno (lista e quadro)', seen);
  ok(!!seen.toast, 'alice recebe o aviso de que o bruno está numa versão antiga', seen.toast);
  const mine = await B.evaluate((u) => !!document.querySelector(`.vuser[data-uid="${u}"] .appold`), a.user.id);
  ok(!mine, 'quem está no navegador (alice) não ganha selinho');
  await A.screenshot({ path: OUT + '/sala.png' });
  // versão mínima
  fs.writeFileSync(DATA + '/desktop-min-version.txt', '1.0.20');
  await B.evaluate(() => window.__lc.voice.leave()); await sleep(500);
  await B.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click()); await sleep(1500);
  const denied = await B.evaluate(() => ({ inCall: !!window.__lc.voice?.channelId, modal: document.querySelector('.modal h2')?.textContent, txt: document.querySelector('.modal .mh p')?.textContent }));
  ok(!denied.inCall && /Atualize o app/.test(denied.modal || ''), 'abaixo da versão mínima: não entra e vê "Atualize o app para entrar na call"', denied);
  await B.screenshot({ path: OUT + '/min.png' });
  await B.evaluate(() => document.querySelector('.modal .btn.link')?.click());
  // relatório
  await B.evaluate(async () => { const { openReport } = await window.__lc.import('diag.js'); openReport('A tela da alice não aparece'); }); await sleep(1500);
  const pre = await B.evaluate(() => document.querySelector('.rpdata')?.textContent || '');
  ok(/GPU de teste/.test(pre) && /linha de log/.test(pre) && /"call"/.test(pre), 'relatório junta placa, log do app e estado da call', pre.length);
  await B.screenshot({ path: OUT + '/report.png' });
  await B.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /Enviar relatório/.test(x.textContent)).click()); await sleep(1500);
  const dm = await A.evaluate(() => [...window.__lc.S.dms.values()][0]);
  const msgs = dm ? await call(a.token, 'GET', `/channels/${dm.id}/messages`) : [];
  const m = Array.isArray(msgs) ? msgs.find(x => /Relatório de problema/.test(x.content)) : null;
  ok(!!m && m.attachments?.[0]?.name?.endsWith('.json'), 'alice (administradora) recebe o relatório por DM com o arquivo', m && { content: m.content.slice(0, 60), file: m.attachments[0].name });
  const file = m && await (await fetch(BASE + m.attachments[0].url)).json();
  ok(file?.descricao === 'A tela da alice não aparece' && file?.desktop?.app === '1.0.10' && !JSON.stringify(file).includes(b.token), 'arquivo tem a descrição e o diagnóstico, sem o token', file && Object.keys(file));
  ok(fs.readdirSync(DATA + '/reports').length === 1, 'cópia guardada em <dados>/reports');
} catch (e) { console.log('ERRO', e.message); fails++; }
finally { await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
