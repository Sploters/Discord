// Trocar o filtro de ruído várias vezes seguidas não pode deixar microfones "zumbis" ligados (cada um com a IA de ruído
// processando, o que fazia o áudio acumular atraso). Conta os microfones ainda ligados depois de cliques rápidos:
// no painel de microfone da call e no teste de microfone das configurações. Uso: node scripts/mic-rebuild-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3267, BASE = `http://localhost:${PORT}`;
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata22', { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata22', RTC_PORT: '41060', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
try {
  const r = await call('', 'POST', '/register', { username: 'alice', password: 'senha123' });
  const g = await call(r.token, 'POST', '/guilds', { name: 'Turma' });
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t;
    // conta os microfones abertos (cada montagem da cadeia de áudio abre um)
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__mics = [];
    navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); if (c?.audio) window.__mics.push(s); return s; };
    window.__liveMics = () => window.__mics.filter(s => s.getAudioTracks().some(t => t.readyState === 'live')).length;
  }, r.token);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  const vch = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
  await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
  await p.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 15000 });
  ok(await p.evaluate(() => window.__liveMics()) === 1, 'na call: 1 microfone ligado');
  // painel de microfone da call: 12 cliques rápidos alternando os filtros (RNNoise / GTCRN / Padrão)
  await p.evaluate(() => [...document.querySelectorAll('#voice-panel .ibtn')].find(x => /Testar microfone/.test(x.title)).click()); await sleep(300);
  await p.evaluate(async () => { const btns = () => [...document.querySelectorAll('.micpop .seg button')]; const labels = btns().map(b => b.textContent); for (let i = 0; i < 12; i++) { btns()[[2, 3, 1][i % 3] % labels.length].click(); await new Promise(r => setTimeout(r, 40)); } });
  await p.waitForFunction(() => !window.__lc.voice._rb, { timeout: 30000 }).catch(() => { }); await sleep(800);
  const st = await p.evaluate(() => ({ live: window.__liveMics(), opened: window.__mics.length, graph: !!window.__lc.voice.micGraph, mode: window.__lc.S.prefs.noiseMode }));
  ok(st.live === 1 && st.graph, 'depois de 12 trocas rápidas: continua 1 microfone ligado (os anteriores foram desligados)', st);
  ok(st.opened <= 13, 'no máximo uma montagem por clique (cliques sobrepostos se juntam)', st.opened);
  // clicar no filtro que já está ativo não remonta nada
  const before = await p.evaluate(() => window.__mics.length);
  await p.evaluate(async () => { const on = document.querySelector('.micpop .seg button.on'); for (let i = 0; i < 5; i++) { on.click(); await new Promise(r => setTimeout(r, 40)); } }); await sleep(800);
  ok(await p.evaluate(() => window.__mics.length) === before, 'clicar 5x no filtro já ativo não remonta o microfone');
  await p.keyboard.press('Escape');
  // teste de microfone nas configurações (fora da call ele abre outro microfone só para o teste)
  await p.evaluate(() => window.__lc.voice.leave()); await sleep(800);
  ok(await p.evaluate(() => window.__liveMics()) === 0, 'saiu da call: nenhum microfone ligado');
  await p.evaluate(() => window.__lc.openSettings('voice')); await sleep(500);
  await p.evaluate(() => [...document.querySelectorAll('#settings button')].find(b => /Testar microfone/.test(b.textContent)).click()); await sleep(1500);
  await p.evaluate(async () => { const cards = () => [...document.querySelectorAll('#settings .ncard')]; for (let i = 0; i < 12; i++) { cards()[[2, 3, 1][i % 3] % cards().length].click(); await new Promise(r => setTimeout(r, 40)); } });
  await sleep(6000);
  ok(await p.evaluate(() => window.__liveMics()) === 1, 'teste das configurações, 12 trocas rápidas: 1 microfone ligado', await p.evaluate(() => window.__liveMics()));
  await p.keyboard.press('Escape'); await sleep(800);
  ok(await p.evaluate(() => window.__liveMics()) === 0, 'fechar as configurações desliga o microfone do teste');
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
