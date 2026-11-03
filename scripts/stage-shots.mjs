// Capturas para revisão visual: palco com 2 transmissões, menu de layout, layouts, palco estreito,
// pedido de controle remoto (com e sem anti-cheat detectado) e a página do app desktop.
// Uso: OUT=.testshots/antes node scripts/stage-shots.mjs   (BROWSER=caminho do Chrome/Edge)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3228, BASE = `http://localhost:${PORT}`, OUT = process.env.OUT || '.testshots/stage';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata9', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata9' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const shot = async (p, name) => { await sleep(500); await p.screenshot({ path: `${OUT}/${name}.png` }); console.log('  ', name); };
async function page(tok, { desk = null, label = 'TELA' } = {}) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => console.log('  PAGEERROR', e.message));
  await p.evaluateOnNewDocument((tok, desk, label) => {
    localStorage.lc_token = tok;
    navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1600; c.height = 900; const x = c.getContext('2d'); let n = 0;
      setInterval(() => { const g = x.createLinearGradient(0, 0, 1600, 900); g.addColorStop(0, `hsl(${(n * 2) % 360},55%,35%)`); g.addColorStop(1, `hsl(${(n * 2 + 120) % 360},55%,25%)`); x.fillStyle = g; x.fillRect(0, 0, 1600, 900); x.fillStyle = '#fff'; x.font = 'bold 90px sans-serif'; x.fillText(label, 80, 160); x.font = '40px sans-serif'; x.fillText('quadro ' + n++, 80, 240); }, 33);
      return c.captureStream(30); };
    if (desk) {
      const fns = { isDesktop: true, getUpdate: async () => null, setThrottle: () => { }, getSources: async () => [{ id: 'screen:1:0', name: 'Tela 1', type: 'screen', thumbnail: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }],
        getSettings: async () => ({ autoStart: false, startMinimized: false, closeToTray: true, globalHotkeys: true, server: location.origin, version: '1.0.15', gpuCompat: 'auto', gpuCompatActive: true, gpuName: 'Intel(R) HD Graphics 4000', hardwareAcceleration: true }),
        remoteCapable: async () => ({ ok: true, antiCheats: window.__ac || [] }), remoteStart: async () => ({ ok: true }), remoteInput: () => { }, remoteStop: () => { }, onRemoteEvent: () => { } };
      window.lcDesktop = new Proxy(fns, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(true)) });
    }
  }, tok, desk, label);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const share = async (P) => { await P.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(x => x.title.includes('Transmitir')).click()); await sleep(800); await P.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /Transmitir/.test(x.textContent)).click()); await sleep(1500); };
try {
  const a = await reg('ana'), b = await reg('bruno'), c = await reg('carla');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Jogatina' }); const code = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(b.tok, 'POST', '/invites/' + code); await call(c.tok, 'POST', '/invites/' + code);
  const A = await page(a.tok, { desk: true, label: 'Tela da Ana' }), B = await page(b.tok, { label: 'Tela do Bruno' }), C = await page(c.tok, { label: 'Tela da Carla' });
  const vch = await B.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B, C]) {
    await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 15000 });
  }
  await share(A); await share(C);
  for (const uid of [a.id, c.id]) { await B.waitForFunction((u) => !!document.querySelector(`.tile.cstream[data-key="s:${u}"] .btn`), { timeout: 15000 }, uid); await B.evaluate((u) => document.querySelector(`.tile.cstream[data-key="s:${u}"] .btn`).click(), uid); await sleep(600); }
  await sleep(1500);
  await shot(B, '01-palco');
  await B.click('#vc-layout').catch(() => B.evaluate(() => document.querySelector('#stage .layoutbtn')?.click())); await shot(B, '02-menu-layout');
  await B.keyboard.press('Escape'); await B.mouse.click(700, 5); await sleep(300);
  await B.evaluate(() => { window.__lc.S.prefs.stageLayout = 'sidebar'; }); await B.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await shot(B, '03-layout-principal');
  await B.evaluate(() => { window.__lc.S.prefs.stageLayout = 'auto'; }); await B.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id);
  await B.setViewport({ width: 1000, height: 700 }); await sleep(800); await shot(B, '04-palco-estreito');
  await B.setViewport({ width: 1440, height: 900 }); await sleep(500);
  // controle remoto: bruno pede o controle da tela da ana (com o Vanguard "rodando" no PC dela)
  await A.evaluate(() => { window.__ac = ['Riot Vanguard (Valorant, League of Legends)']; });
  await B.evaluate((u) => document.querySelector(`.tile.screen[data-sid="${u}"]`)?.click(), a.id); await sleep(600);
  await B.evaluate(() => [...document.querySelectorAll('.tctl button, #stage button')].find(x => /Pedir controle/.test(x.title))?.click()); await sleep(600);
  await shot(B, '05-pedir-controle-intro');
  await B.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Pedir controle')?.click());
  await A.waitForFunction(() => /quer controlar/.test(document.querySelector('.modal')?.textContent || ''), { timeout: 5000 }).catch(() => { });
  await A.evaluate(() => { const d = document.querySelector('.modal details'); if (d) d.open = true; });
  await shot(A, '06-consentimento-anticheat');
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Recusar')?.click()); await sleep(400);
  await A.evaluate(() => window.__lc.openSettings('app')); await shot(A, '07-config-app-desktop');
} catch (err) { console.log('  ERRO', err); }
await browser.close(); srv.kill(); process.exit(0);
