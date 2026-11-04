// Auditoria de desempenho: mede abertura (com latência de VPN simulada), app parado no chat, call com 3 pessoas e
// assistindo uma transmissão. CPU do navegador (tempo de tarefas/scripts por segundo), layout/estilo, memória, nós,
// timers ativos, rede; CPU e memória do servidor. Uso: node scripts/perf-audit.mjs [rótulo]  -> .testshots/perf-<rótulo>.json
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3261, BASE = `http://localhost:${PORT}`, LABEL = process.argv[2] || 'atual', SECS = +(process.env.SECS || 15);
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata19', { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata19', RTC_PORT: '41050', RTC_IPS: '127.0.0.1', STATIC_OFF: process.env.STATIC_OFF || '' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
// CPU e memória do servidor (node + worker do mediasoup)
const procStat = () => { try { const out = execFileSync('ps', ['-o', 'pid=,ppid=,rss=,time=', '-A']).toString(); let rss = 0, cpu = 0; const kids = new Set([srv.pid]);
  for (let k = 0; k < 2; k++) for (const l of out.trim().split('\n')) { const [pid, ppid] = l.trim().split(/\s+/).map(Number); if (kids.has(ppid)) kids.add(pid); }
  for (const l of out.trim().split('\n')) { const [pid, , r, t] = l.trim().split(/\s+/); if (kids.has(+pid)) { rss += +r; const [h, m, s] = t.split(':').map(Number); cpu += (h || 0) * 3600 + (m || 0) * 60 + (s || 0); } }
  return { rssMB: Math.round(rss / 1024), cpuS: cpu }; } catch { return {}; } };
// precisão de "time" do ps é 1 s: usa /proc para o tempo de CPU em ticks
const cpuTicks = () => { let t = 0; const out = execFileSync('ps', ['-o', 'pid=,ppid=', '-A']).toString(); const kids = new Set([srv.pid]);
  for (let k = 0; k < 2; k++) for (const l of out.trim().split('\n')) { const [pid, ppid] = l.trim().split(/\s+/).map(Number); if (kids.has(ppid)) kids.add(pid); }
  for (const pid of kids) { try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); t += +f[11] + +f[12]; } catch { } } return t / 100; };

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
// contador de timers e quadros de animação na página
const probeTimers = () => {
  const live = new Map(); let raf = 0; const oSI = setInterval, oCI = clearInterval, oRAF = requestAnimationFrame;
  window.setInterval = (fn, ms, ...a) => { const id = oSI(fn, ms, ...a); live.set(id, ms); return id; };
  window.clearInterval = (id) => { live.delete(id); return oCI(id); };
  window.requestAnimationFrame = (fn) => { raf++; return oRAF(fn); };
  window.__timers = () => ({ intervals: live.size, perSec: [...live.values()].reduce((n, ms) => n + 1000 / Math.max(4, ms || 4), 0), raf });
};
async function page(tok, opts = {}) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(probeTimers);
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t;
    navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let n = 0; setInterval(() => { x.fillStyle = `hsl(${n++ % 360},60%,40%)`; x.fillRect(0, 0, 1280, 720); }, 33); return c.captureStream(30); };
  }, tok);
  const cdp = await p.createCDPSession(); await cdp.send('Performance.enable');
  return { p, cdp, ctx };
}
const metrics = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
async function window_(P, secs) {
  await P.p.evaluate(() => { window.__mut = 0; window.__mo?.disconnect(); window.__mo = new MutationObserver((l) => { window.__mut += l.length; }); window.__mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true }); window.__anims = document.getAnimations().length; });
  const a = await metrics(P.cdp), t0 = await P.p.evaluate(() => window.__timers());
  await sleep(secs * 1000);
  const b = await metrics(P.cdp), t1 = await P.p.evaluate(() => window.__timers()), mut = await P.p.evaluate(() => ({ m: window.__mut, anims: document.getAnimations().length }));
  const d = (k) => b[k] - a[k];
  return { cpuPct: +(d('TaskDuration') / secs * 100).toFixed(1), scriptPct: +(d('ScriptDuration') / secs * 100).toFixed(1), layoutsPerS: +(d('LayoutCount') / secs).toFixed(1), stylePerS: +(d('RecalcStyleCount') / secs).toFixed(1),
    heapMB: +(b.JSHeapUsedSize / 1048576).toFixed(1), nodes: b.Nodes, listeners: b.JSEventListeners, intervals: t1.intervals, intervalFiresPerS: Math.round(t1.perSec), rafPerS: Math.round((t1.raf - t0.raf) / secs), domChangesPerS: Math.round(mut.m / secs), runningAnimations: mut.anims };
}
const R = { label: LABEL, date: new Date().toISOString() };
try {
  const a = await reg('alice'), b = await reg('bruno'), c = await reg('carla');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Turma' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [b, c]) await call(u.tok, 'POST', '/invites/' + inv);
  // histórico no canal: 200 mensagens
  const ch0 = await fetch(BASE + '/api/users/@me/guilds', { headers: { authorization: 'Bearer ' + a.tok } }).then(r => r.json()).catch(() => null); void ch0;
  // ---------- 1) abertura: rede de VPN simulada (40 ms de ida e volta, 20 Mbps) ----------
  const A = await page(a.tok);
  const reqs = []; A.cdp.on('Network.loadingFinished', (e) => reqs.push(e.encodedDataLength)); await A.cdp.send('Network.enable');
  await A.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 20e6 / 8, uploadThroughput: 10e6 / 8 });
  await A.cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  let t = Date.now(); await A.p.goto(BASE); await A.p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); const cold = Date.now() - t;
  const m0 = await metrics(A.cdp);
  R.open = { coldMs: cold, requests: reqs.length, kB: Math.round(reqs.reduce((x, y) => x + y, 0) / 1024), mainThreadMs: Math.round(m0.TaskDuration * 1000), scriptMs: Math.round(m0.ScriptDuration * 1000), heapMB: +(m0.JSHeapUsedSize / 1048576).toFixed(1) };
  await A.cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await A.p.goto(BASE); await A.p.waitForSelector('#rail .rail-wrap'); // enche o cache
  reqs.length = 0; t = Date.now(); await A.p.goto(BASE); await A.p.waitForSelector('#rail .rail-wrap', { timeout: 60000 });
  R.open.warmMs = Date.now() - t; R.open.warmRequests = reqs.length; R.open.warmKB = Math.round(reqs.reduce((x, y) => x + y, 0) / 1024);
  await A.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  // ---------- 2) parado no chat (canal de texto com mensagens) ----------
  const tch = await A.p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0), g.id);
  for (let i = 0; i < 150; i++) await call([a, b, c][i % 3].tok, 'POST', `/channels/${tch.id}/messages`, { content: `mensagem ${i} com **markdown** e :smile: https://example.com/${i}` });
  await A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, tch.id); await sleep(3000);
  const s0 = cpuTicks(); R.idleChat = await window_(A, SECS); R.idleChat.serverCpuPct = +((cpuTicks() - s0) / SECS * 100).toFixed(1);
  // ---------- 3) call com 3 pessoas (microfones falsos tocando) ----------
  const B = await page(b.tok), C = await page(c.tok);
  for (const P of [B, C]) { await P.p.goto(BASE); await P.p.waitForSelector('#rail .rail-wrap'); }
  const vch = await A.p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B, C]) {
    await P.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.p.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 });
  }
  await sleep(4000);
  R.callMutations = await A.p.evaluate(async () => { const c = {}; const mo = new MutationObserver((l) => { for (const r of l) { const t = r.target.nodeType === 1 ? r.target : r.target.parentElement; const k = r.type + ':' + (t?.id ? '#' + t.id : (t?.className?.baseVal ?? t?.className ?? t?.tagName ?? '?')).toString().split(' ').slice(0, 2).join('.') + (r.attributeName ? '@' + r.attributeName : ''); c[k] = (c[k] || 0) + 1; } }); mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true }); await new Promise(r => setTimeout(r, 5000)); mo.disconnect(); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => k + ' ' + (n / 5).toFixed(1) + '/s'); });
  const s1 = cpuTicks(); R.call3 = await window_(A, SECS); R.call3.serverCpuPct = +((cpuTicks() - s1) / SECS * 100).toFixed(1);
  // vazamento: 60 s de call (falas ligando/desligando, redesenhos) — nós, ouvintes e memória não devem crescer
  if (process.env.LEAK !== '0') {
    await A.cdp.send('HeapProfiler.enable'); await A.cdp.send('HeapProfiler.collectGarbage');
    const l0 = await metrics(A.cdp); await sleep(60000); await A.cdp.send('HeapProfiler.collectGarbage'); const l1 = await metrics(A.cdp);
    R.leak60s = { nodes: [l0.Nodes, l1.Nodes], listeners: [l0.JSEventListeners, l1.JSEventListeners], heapMB: [+(l0.JSHeapUsedSize / 1048576).toFixed(2), +(l1.JSHeapUsedSize / 1048576).toFixed(2)] };
  }
  // ---------- 4) bruno transmite 720p30, alice assiste ----------
  await B.p.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  await A.p.waitForFunction((uid) => !!document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`) || !!document.querySelector(`.tile.screen[data-sid="${uid}"]`), { timeout: 15000 }, b.id).catch(() => { });
  await A.p.evaluate((uid) => document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`)?.click(), b.id);
  await sleep(5000);
  const s2 = cpuTicks(); R.watching = await window_(A, SECS); R.watching.serverCpuPct = +((cpuTicks() - s2) / SECS * 100).toFixed(1);
  R.streamer = await window_(B, 5);
  R.server = procStat();
} catch (e) { R.error = String(e); console.log('ERRO', e); }
finally {
  await browser.close(); srv.kill();
  fs.writeFileSync(`.testshots/perf-${LABEL}.json`, JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 1));
  setTimeout(() => process.exit(0), 300);
}
