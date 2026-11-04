// Novidades: aparece uma vez para quem já usava o app (vale em todos os aparelhos), não aparece para conta nova,
// "Experimentar" leva ao recurso, fica em Configurações -> Novidades e no menu do perfil.
// Uso: node scripts/news-test.mjs  (SHOTS=1 salva capturas em .testshots/news)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3269, BASE = `http://localhost:${PORT}`, OUT = '.testshots/news';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata23', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata23', RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
async function page(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p;
}
const newsOpen = (p) => p.waitForFunction(() => /Novidades/.test(document.querySelector('.modal .mh h2')?.textContent || ''), { timeout: 5000 }).then(() => true, () => false);
try {
  // quem já usava (tem preferências na conta, sem ter visto as novidades)
  const a = await call('', 'POST', '/register', { username: 'alice', password: 'senha123' });
  await call(a.token, 'PUT', '/me/settings', { settings: { theme: 'dark', noiseMode: 'standard' } });
  const A = await page(a.token);
  ok(await newsOpen(A), 'quem já usava vê a janela de Novidades ao abrir');
  const info = await A.evaluate(() => ({ items: document.querySelectorAll('.modal .newsitem').length, tries: document.querySelectorAll('.modal .newsitem .btn').length, first: document.querySelector('.modal .newsitem b')?.textContent }));
  ok(info.items >= 8 && info.tries >= 5 && info.first === 'Efeitos de voz', 'lista as novidades com botões "Experimentar"', info);
  if (process.env.SHOTS) { await sleep(900); await A.screenshot({ path: `${OUT}/01-janela.png` }); }
  await A.evaluate(() => [...document.querySelectorAll('.modal .newsitem')].find(x => /Procurar jogadores/.test(x.textContent)).querySelector('.btn').click()); await sleep(800);
  ok(await A.evaluate(() => window.__lc.S.view.kind === 'lfg' && !document.querySelector('.modal')), '"Experimentar" fecha a janela e leva ao recurso (Procurar jogadores)');
  await sleep(2000); // gravar na conta
  ok((await call(a.token, 'GET', '/me/settings')).settings?.newsSeen, 'visto fica gravado na conta');
  const A2 = await page(a.token); // outro aparelho
  ok(!(await newsOpen(A2)), 'não aparece de novo (nem em outro aparelho)');
  // conta nova: sem a janela
  const b = await call('', 'POST', '/register', { username: 'bruno', password: 'senha123' });
  const B = await page(b.token);
  ok(!(await newsOpen(B)), 'conta nova não recebe a lista do que mudou');
  // Configurações -> Novidades e menu do perfil
  await B.evaluate(() => window.__lc.openSettings('news')); await sleep(400);
  ok(await B.evaluate(() => document.querySelectorAll('#settings .newsitem').length) >= 8 && await B.evaluate(() => [...document.querySelectorAll('#settings .ni')].some(n => n.textContent === 'Novidades')), 'Configurações → Novidades mostra o histórico');
  if (process.env.SHOTS) await B.screenshot({ path: `${OUT}/02-configuracoes.png` });
  await B.keyboard.press('Escape'); await sleep(300);
  await B.evaluate(() => document.querySelector('#userbar .me')?.click()); await sleep(400);
  const hasItem = await B.evaluate(() => [...document.querySelectorAll('.meitem')].some(i => /Novidades/.test(i.textContent)));
  ok(hasItem, 'menu do perfil tem "Novidades"');
  if (hasItem) { await B.evaluate(() => [...document.querySelectorAll('.meitem')].find(i => /Novidades/.test(i.textContent)).click()); ok(await newsOpen(B), 'e abre a janela'); }
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
