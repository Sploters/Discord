// Teste de carga do SFU (worker único do mediasoup): STREAMERS transmitindo (canvas animado, VP8 3 camadas) + VIEWERS assistindo.
// Mede /api/sfu/load a cada 5 s: ocioso -> carga. Uso: API=... UI=... STREAMERS=2 VIEWERS=6 SECS=40 node scripts/fase2-load.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const API = process.env.API || 'http://localhost:3000', UI = process.env.UI || API;
const N_S = +process.env.STREAMERS || 2, N_V = +process.env.VIEWERS || 6, SECS = +process.env.SECS || 40, RES = +process.env.RES || 1080, FPS = +process.env.FPS || 30;
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = process.env.OUT || '.testshots/fase2-load.json';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = async (tok, method, path, body) => { const r = await fetch(API + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
const sfx = Math.random().toString(36).slice(2, 6);
const W = Math.round(RES * 16 / 9);
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--ignore-certificate-errors', '--disable-features=CalculateNativeWinOcclusion'] });
const fake = ([w, h, fps]) => { navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); let n = 0; const draw = () => { n++; x.fillStyle = `hsl(${n * 3 % 360} 60% 40%)`; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; for (let i = 0; i < 30; i++) x.fillRect((n * 11 + i * 83) % (w - 100), (i * 41) % (h - 100), 90, 90); x.font = '80px monospace'; x.fillText('frame ' + n, 40, 120); }; draw(); setInterval(draw, 1000 / fps); return c.captureStream(fps); }; };
const results = { cfg: { N_S, N_V, SECS, RES, FPS }, samples: [] };
const pages = [];
async function session(name, token) {
  const ctx = await browser.createBrowserContext(), page = await ctx.newPage();
  await page.setViewport({ width: 800, height: 500 });
  await page.evaluateOnNewDocument(fake, [W, RES, FPS]);
  await page.goto(UI, { waitUntil: 'domcontentloaded' }); await page.evaluate((t) => localStorage.setItem('lc_token', t), token);
  await page.goto(UI, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#rail .rail-wrap', { timeout: 30000 });
  pages.push(page); return page;
}
const sample = async (tok, tag) => { const r = await api(tok, 'GET', '/sfu/load'); const c = r.data.current; if (c) { results.samples.push({ tag, ...c }); console.log(`  ${tag.padEnd(14)} cpu ${String(c.cpu).padStart(5)}%  rss ${c.rssMB}MB  peers ${c.peers} transports ${c.transports} producers ${c.producers} consumers ${c.consumers}`); } return c; };
try {
  const mk = async (n) => (await api('', 'POST', '/register', { username: n + sfx, password: 'senha12345' })).data.token;
  const tOwner = await mk('ld_o'); const g = (await api(tOwner, 'POST', '/guilds', { name: 'QA Carga ' + sfx })).data, inv = (await api(tOwner, 'POST', `/guilds/${g.id}/invites`)).data;
  const users = [];
  for (let i = 0; i < N_S + N_V; i++) { const t = i === 0 ? tOwner : await mk('ld_' + i); if (i) await api(t, 'POST', `/invites/${inv.code}`); users.push(t); }
  console.log(`\n== carga: ${N_S} transmissores ${W}x${RES}@${FPS} + ${N_V} espectadores ==`);
  await sample(tOwner, 'ocioso'); await sleep(5200); await sample(tOwner, 'ocioso');
  const sess = []; for (let i = 0; i < users.length; i++) sess.push(await session('u' + i, users[i]));
  await sleep(1500);
  const chans = await sess[0].evaluate((gid) => window.__lc.S.guilds.get(gid).channels, g.id), vch = chans.find(c => c.type === 2);
  for (const p of sess) { await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300); await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent))?.click()); await sleep(1200); }
  await sleep(2000); await sample(tOwner, 'só voz');
  for (let i = 0; i < N_S; i++) { await sess[i].evaluate((res, fps) => { window.__lc.voice.hwH264 = async () => false; return window.__lc.voice.toggleScreen({ res, fps, audio: false, hint: 'motion' }).then(() => true); }, RES, FPS); await sleep(800); }
  await sleep(2500);
  // espectadores abrem todas as transmissões
  for (let i = N_S; i < sess.length; i++) await sess[i].evaluate(() => { const v = window.__lc.voice; for (const uid of [...v.closedStreams]) v.openStream(uid); });
  for (let i = 0; i < N_S; i++) await sess[i].evaluate(() => { const v = window.__lc.voice; for (const uid of [...v.closedStreams]) v.openStream(uid); });
  await sleep(6000);
  const t0 = Date.now(); let k = 0;
  while ((Date.now() - t0) / 1000 < SECS) { await sample(tOwner, 'carga ' + (++k)); await sleep(5000); }
  // recepção de um espectador: confirma que de fato recebe
  const rx = await sess[N_S].evaluate(async () => { const v = window.__lc.voice, out = []; for (const [uid, p] of v.peers) { const s = await v.streamStats(uid); if (s?.w) out.push({ w: s.w, h: s.h, fps: s.fps, kbps: s.kbps, loss: s.loss, q: s.quality }); } return out; });
  results.viewerRx = rx; console.log('  espectador 1 recebendo:', JSON.stringify(rx));
  const loadS = results.samples.filter(s => s.tag.startsWith('carga')), cpus = loadS.map(s => s.cpu).filter(x => x != null);
  results.summary = { idleCpu: results.samples.filter(s => s.tag === 'ocioso').map(s => s.cpu), loadCpuAvg: +(cpus.reduce((a, b) => a + b, 0) / (cpus.length || 1)).toFixed(1), loadCpuPeak: Math.max(...cpus), rssLoad: loadS.at(-1)?.rssMB, counts: loadS.at(-1) && { peers: loadS.at(-1).peers, transports: loadS.at(-1).transports, producers: loadS.at(-1).producers, consumers: loadS.at(-1).consumers } };
  console.log('\n  RESUMO', JSON.stringify(results.summary));
  await api(tOwner, 'DELETE', `/guilds/${g.id}`);
} catch (e) { console.log('ERRO', e); results.erro = String(e.stack || e); }
finally { fs.writeFileSync(OUT, JSON.stringify(results, null, 1)); await browser.close(); process.exit(0); }
