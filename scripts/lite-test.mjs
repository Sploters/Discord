// Teste do modo leve: ativa, confere o que mudou, confere que a conta guarda os valores normais e desativa restaurando tudo
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3224, BASE = `http://localhost:${PORT}`, SHOTS = '.testshots';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.rmSync('.testdata-lite', { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-lite' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await page.goto(BASE); await page.waitForSelector('#auth .card');
  await page.evaluate(() => [...document.querySelectorAll('#auth a')].find(a => a.textContent.includes('Registre')).click());
  await sleep(200);
  const ins = await page.$$('#auth input'); await ins[0].type('leve'); await ins[2].type('senha123'); await ins[3].type('senha123');
  await page.click('#auth .btn'); await page.waitForSelector('#rail .rail-wrap', { timeout: 8000 }); await sleep(800);
  const P = () => page.evaluate(() => { const p = window.__lc.S.prefs; return { animations: p.animations, animMode: p.animMode, noiseMode: p.noiseMode, clipsOn: p.clipsOn, screen: p.screen, lightMode: p.lightMode }; });
  const before = await P();
  await page.evaluate(() => [...document.querySelectorAll('.me + * button, button')].find(b => b.title === 'Configurações do usuário').click());
  await page.waitForSelector('#settings .ni[data-k="lite"]'); await page.click('#settings .ni[data-k="lite"]'); await sleep(200);
  ok(await page.$('#settings .litehero'), 'página Modo leve aparece nas configurações');
  await page.screenshot({ path: `${SHOTS}/lite-off.png` });
  await page.click('#settings .litehero .switch'); await sleep(300);
  const on = await P();
  ok(on.lightMode === true && on.animations === false && on.animMode === 'never' && on.noiseMode === 'standard' && on.clipsOn === false && on.screen.res === 720 && on.screen.fps === 30, 'modo leve aplica os ajustes: ' + JSON.stringify(on));
  ok(await page.evaluate(() => !document.documentElement.classList.contains('anim')), 'animações desligadas na interface');
  await page.screenshot({ path: `${SHOTS}/lite-on.png` });
  await sleep(1800); // sincronização com a conta (1,2 s)
  const remote = await page.evaluate(() => fetch('/api/me/settings', { headers: { authorization: 'Bearer ' + localStorage.lc_token } }).then(r => r.json()));
  const rs = remote.settings || {};
  ok(rs.noiseMode === before.noiseMode && rs.animMode === before.animMode && rs.animations === before.animations && !('lightMode' in rs) && !('lightPrev' in rs), 'conta guarda os valores normais (modo leve fica só nesta máquina): ' + JSON.stringify({ noise: rs.noiseMode, anim: rs.animations, animMode: rs.animMode, screen: rs.screen }));
  // recarregar: o modo leve continua ligado depois de puxar a conta
  await page.reload(); await page.waitForSelector('#rail .rail-wrap'); await sleep(1200);
  const re = await P();
  ok(re.lightMode === true && re.noiseMode === 'standard' && re.animations === false, 'após recarregar, modo leve continua aplicado');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.title === 'Configurações do usuário').click());
  await page.waitForSelector('#settings .ni[data-k="lite"]'); await page.click('#settings .ni[data-k="lite"]'); await sleep(200);
  await page.click('#settings .litehero .switch'); await sleep(300);
  const off = await P();
  ok(off.lightMode === false && JSON.stringify({ ...off, lightMode: undefined }) === JSON.stringify({ ...before, lightMode: undefined }), 'desativar volta exatamente ao anterior: ' + JSON.stringify(off));
  ok(await page.evaluate(() => !('lightPrev' in window.__lc.S.prefs)), 'desativar apaga a memória do modo leve');

  // alteração manual durante o modo leve é preservada ao desativar
  await page.click('#settings .litehero .switch'); await sleep(200);
  await page.evaluate(() => { const p = window.__lc.S.prefs; p.noiseMode = 'gtcrn'; p.screen = { ...p.screen, res: 1440, fps: 60 }; });
  await page.click('#settings .litehero .switch'); await sleep(200);
  const man = await P();
  ok(man.noiseMode === 'gtcrn' && man.screen.res === 1440 && man.animations === before.animations && man.animMode === before.animMode && man.clipsOn === before.clipsOn, 'mudança manual fica, o resto volta: ' + JSON.stringify(man));
  await page.evaluate(() => { const p = window.__lc.S.prefs; p.noiseMode = 'rnnoise'; p.screen = { res: 1080, fps: 30, audio: true, hint: 'motion' }; });

  // mudança manual durante o modo leve sobrevive a recarregar (a conta não a desfaz)
  await page.click('#settings .litehero .switch'); await sleep(200);
  await page.evaluate(() => { window.__lc.S.prefs.noiseMode = 'gtcrn'; window.__lc.savePrefs?.(); });
  await page.evaluate(async () => { const m = await import('/state.js'); m.savePrefs(); }); await sleep(1800);
  await page.reload(); await page.waitForSelector('#rail .rail-wrap'); await sleep(1200);
  const rl = await P();
  ok(rl.lightMode === true && rl.noiseMode === 'gtcrn' && rl.animations === false, 'mudança manual sobrevive a recarregar com modo leve: ' + JSON.stringify(rl));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.title === 'Configurações do usuário').click());
  await page.waitForSelector('#settings .ni[data-k="lite"]'); await page.click('#settings .ni[data-k="lite"]'); await sleep(200);
  await page.click('#settings .litehero .switch'); await sleep(300);
  const rl2 = await P();
  ok(rl2.noiseMode === 'gtcrn' && rl2.animations === before.animations && rl2.clipsOn === before.clipsOn, 'desativar depois: manual fica, resto volta');
  await page.evaluate(async () => { const p = window.__lc.S.prefs; p.noiseMode = 'rnnoise'; (await import('/state.js')).savePrefs(); }); await sleep(1500);

  // desktop (ponte falsa): economia só fora de chamada
  const D = await browser.newPage(); await D.setViewport({ width: 1440, height: 900 });
  D.on('pageerror', e => { console.log('  PAGEERROR(desktop)', e.message); fails++; });
  await D.evaluateOnNewDocument((tok) => {
    localStorage.lc_token = tok; window.__thr = [];
    const fns = { isDesktop: true, setThrottle: (on) => window.__thr.push(on), getSettings: async () => ({ hardwareAcceleration: true }), getSources: async () => [], getUpdate: async () => null };
    window.lcDesktop = new Proxy(fns, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(true)) });
  }, await page.evaluate(() => localStorage.lc_token));
  await D.goto(BASE); await D.waitForSelector('#rail .rail-wrap'); await sleep(800);
  const thr = () => D.evaluate(() => window.__thr.at(-1));
  ok(await thr() === false, 'desktop sem modo leve: economia desligada');
  await D.evaluate(() => [...document.querySelectorAll('button')].find(b => b.title === 'Configurações do usuário').click());
  await D.waitForSelector('#settings .ni[data-k="lite"]'); await D.click('#settings .ni[data-k="lite"]'); await sleep(200);
  ok(await D.evaluate(() => { const t = document.querySelector('#settings .content').textContent; return t.includes('Aceleração de hardware') && !t.includes('[object'); }), 'desktop mostra a opção de aceleração de hardware');
  await D.click('#settings .litehero .switch'); await sleep(300);
  ok(await thr() === true, 'modo leve fora de chamada: economia ligada');
  await D.keyboard.press('Escape'); await sleep(200);
  const tokD = await D.evaluate(() => localStorage.lc_token);
  const g = await fetch(BASE + '/api/guilds', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokD }, body: JSON.stringify({ name: 'Leve' }) }).then(r => r.json());
  await sleep(600);
  const vch = await D.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2), g.id);
  await D.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(500);
  await D.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent)).click()); await sleep(2500);
  ok(await D.evaluate(() => window.__lc.voice.active) && await thr() === false, 'em chamada: economia suspensa');
  const noise = await D.evaluate(() => ({ mode: window.__lc.S.prefs.noiseMode, err: window.__lc.voice.error }));
  ok(noise.mode === 'standard' && !noise.err, 'microfone da chamada com redução leve e sem erro');
  await D.evaluate(() => window.__lc.voice.leave()); await sleep(500);
  ok(await thr() === true, 'saiu da chamada: economia volta');
  await D.reload(); await D.waitForSelector('#rail .rail-wrap'); await sleep(800);
  ok(await thr() === true, 'app aberto já com modo leve: economia liga na inicialização');
  // desligar clipes para o gravador, mas a transmissão (track original) continua viva
  const clip = await D.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d');
    const iv = setInterval(() => { x.fillStyle = '#' + Math.floor(Math.random() * 1e6).toString(16).padStart(6, '0'); x.fillRect(0, 0, 320, 180); }, 33);
    const stream = c.captureStream(30), m = await import('/clips.js');
    m.startBuffer('s:teste', stream, null); await new Promise(r => setTimeout(r, 1500));
    const rec = m.clipping('s:teste'); m.stopAllBuffers(); await new Promise(r => setTimeout(r, 300));
    const r = { rec, after: m.clipping('s:teste'), track: stream.getVideoTracks()[0].readyState }; clearInterval(iv); return r;
  });
  ok(clip.rec && !clip.after && clip.track === 'live', 'desligar clipes não encerra a transmissão: ' + JSON.stringify(clip));
  await D.close();
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `${fails} falha(s)` : 'tudo ok'); process.exit(fails ? 1 : 0);
