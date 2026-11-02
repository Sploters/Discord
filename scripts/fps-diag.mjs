// Diagnóstico de FPS da transmissão de tela (Passo 0). NÃO altera o produto: só mede.
// Cada estágio do pipeline é medido por uma fonte independente:
//   fonte      → rAF da página de animação (scripts/fps-diag-anim.html), verdade do que a tela realmente muda
//   captura    → MediaStreamTrackProcessor na trilha do getDisplayMedia (quadros que saem do capturador)
//   entrega    → stats "media-source" do remetente (quadros entregues ao pipeline do codificador)
//   codificação→ outbound-rtp.framesEncoded / framesSent (por camada simulcast), tempo de codificação, limitação
//   servidor   → mediasoup: bitrate/pacotes do produtor e dos consumidores (via observer, sem mexer no server/)
//   recepção   → inbound-rtp.framesReceived / framesDecoded / framesDropped no espectador
//   render     → <video> do espectador: getVideoPlaybackQuality + requestVideoFrameCallback
// Uso: node scripts/fps-diag.mjs [cap] [pipe] [loop]   (sem argumentos roda tudo)  — saída em .testshots/fps-diag.json
import puppeteer from 'puppeteer-core';
import { spawn, execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { animToFront } from './fps-diag-front.mjs';
const require = createRequire(import.meta.url);
const electronPath = require('../desktop/node_modules/electron');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 3224, BASE = `http://localhost:${PORT}`, DIAG = 'http://127.0.0.1:3299/';
const WARM = +process.env.WARM || 8, MEAS = +process.env.MEAS || 15; // segundos
const groups = process.argv.slice(2).length ? process.argv.slice(2) : ['cap', 'pipe', 'loop'];
const OUT = process.env.OUT || '.testshots/fps-diag.json';
const EXTRA = (process.env.ELECTRON_ARGS || '').split(' ').filter(Boolean); // só para experimentos de diagnóstico (ex.: --enable-features=...)
fs.rmSync('.testdata-diag', { recursive: true, force: true }); fs.rmSync('.testdata-diag-e', { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });

// ---------- código que roda dentro das páginas ----------
const SENDER_JS = `(() => {
const D = window.__diag = { cfg: { layers: 3, codec: 'h264' }, cap: null };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
D.pick = async (kind) => {
  const s = await lcDesktop.getSources();
  const it = kind === 'window' ? s.find(x => x.type === 'window' && /FPSDIAG-ANIM/.test(x.name)) : s.find(x => x.type === 'screen');
  if (!it) return { error: 'fonte não encontrada', all: s.map(x => x.name) };
  await lcDesktop.selectSource(it.id); return { id: it.id, name: it.name };
};
D.capStart = (track, clone) => {
  const t = clone ? track.clone() : track, ts = [], ids = [], c = D.cap = { ts, ids, t, stop: false };
  const rd = new MediaStreamTrackProcessor({ track: t }).readable.getReader();
  (async () => { for (;;) { let r; try { r = await rd.read(); } catch { break; } if (r.done || c.stop) break; ts.push(performance.now()); ids.push(await D.frameId(r.value)); r.value.close(); } })();
};
D.capIds = () => D.cap.ids;
D.capErr = () => D.frameErr || null;
D.frameId = async (f) => { try { const rect = { x: 0, y: 4, width: 256, height: 2 }, buf = new Uint8Array(f.allocationSize({ rect })), lay = await f.copyTo(buf, { rect }), bgra = /BGR|RGB/.test(f.format || ''); let id = 0; for (let b = 0; b < 32; b++) { const x = b * 8 + 4, v = bgra ? buf[lay[0].offset + x * 4 + 1] : buf[lay[0].offset + x]; if (v > 128) id += 2 ** b; } return id; } catch (e) { D.frameErr = String(e) + ' fmt=' + f.format; return -1; } };
D.capStop = () => { const c = D.cap; c.stop = true; try { c.t.stop(); } catch { } return c.ts; };
D.captureOnly = async (video, secs) => {
  const s = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
  const tr = s.getVideoTracks()[0], st = tr.getSettings(); D.capStart(tr, false);
  const t0 = performance.now(); await sleep(secs * 1000); const t1 = performance.now();
  const ts = D.capStop(); const ids = D.cap.ids; tr.stop(); return { settings: st, ts, ids, t0, t1, err: D.frameErr || null };
};
const parse = (rep) => {
  const o = { t: performance.now(), out: [], media: null, cp: null }, codecs = {};
  rep.forEach(r => { if (r.type === 'codec') codecs[r.id] = r.mimeType + (r.sdpFmtpLine ? ' ' + r.sdpFmtpLine : ''); });
  rep.forEach(r => {
    if (r.type === 'outbound-rtp' && r.kind === 'video') o.out.push({ rid: r.rid || '0', framesEncoded: r.framesEncoded, framesSent: r.framesSent, bytesSent: r.bytesSent, packetsSent: r.packetsSent, retrans: r.retransmittedPacketsSent, totalEncodeTime: r.totalEncodeTime, nack: r.nackCount, pli: r.pliCount, keyFrames: r.keyFramesEncoded, w: r.frameWidth, h: r.frameHeight, fps: r.framesPerSecond, enc: r.encoderImplementation, limit: r.qualityLimitationReason, qld: r.qualityLimitationDurations, target: r.targetBitrate, active: r.active, codec: codecs[r.codecId], scal: r.scalabilityMode });
    else if (r.type === 'media-source' && r.kind === 'video') o.media = { frames: r.frames, fps: r.framesPerSecond, w: r.width, h: r.height };
    else if (r.type === 'candidate-pair' && r.nominated) o.cp = { avail: r.availableOutgoingBitrate, rtt: r.currentRoundTripTime };
  });
  return o;
};
D.sender = async () => { const p = window.__lc.voice.sfu?.producers.screen; return p ? parse(await p.getStats()) : null; };
D.patch = () => { // só para o teste: variar camadas e codec sem mexer em public/voice.js
  const v = window.__lc.voice; if (v.__patched) return true; v.__patched = true;
  const orig = v.sfuEncodings.bind(v);
  v.sfuEncodings = (s, t) => { const e = orig(s, t); if (s === 'screen' && e && D.cfg.layers === 1) { const { rid, scaleResolutionDownBy, ...rest } = e[e.length - 1]; return [rest]; } return e; };
  v.hwH264 = async () => D.cfg.codec === 'h264';
  v.checkHwEncoder = async () => { };
  return true;
};
// loopback local (sem servidor) para comparar codificadores: H264/VP8/VP9/AV1, uma camada
D.loopStart = async (video, mime, mbps, source) => {
  let s;
  if (source === 'canvas') { // fonte sintética (sem captura de tela): mede o teto do codificador
    const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d', { alpha: false }); let n = 0, on = true;
    const draw = () => { if (!on) return; n++; const off = (n * 14) % 160; for (let i = -1; i < 13; i++) { x.fillStyle = 'hsl(' + ((i * 37 + n * 3) % 360) + ' 70% ' + (i % 2 ? 35 : 55) + '%)'; x.fillRect(i * 160 + off, 0, 160, 1080); } requestAnimationFrame(draw); };
    requestAnimationFrame(draw); s = c.captureStream(); s.__stopDraw = () => { on = false; };
  } else s = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
  const tr = s.getVideoTracks()[0]; tr.contentHint = 'motion';
  const pc1 = new RTCPeerConnection(), pc2 = new RTCPeerConnection();
  pc1.onicecandidate = e => e.candidate && pc2.addIceCandidate(e.candidate); pc2.onicecandidate = e => e.candidate && pc1.addIceCandidate(e.candidate);
  const tx = pc1.addTransceiver(tr, { direction: 'sendonly', streams: [s], sendEncodings: [{ maxBitrate: mbps * 1e6 }] });
  const caps = RTCRtpSender.getCapabilities('video').codecs;
  const pref = caps.filter(c => c.mimeType.toLowerCase() === mime.toLowerCase());
  if (!pref.length) { s.getTracks().forEach(t => t.stop()); pc1.close(); pc2.close(); return { unsupported: true }; }
  tx.setCodecPreferences(pref);
  await pc1.setLocalDescription(await pc1.createOffer()); await pc2.setRemoteDescription(pc1.localDescription);
  await pc2.setLocalDescription(await pc2.createAnswer()); await pc1.setRemoteDescription(pc2.localDescription);
  D.lb = { pc1, pc2, tx, s, tr };
  return { ok: true, settings: tr.getSettings() };
};
D.loopSnap = async () => {
  const o = parse(await D.lb.tx.sender.getStats()); o.in = null;
  (await D.lb.pc2.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') o.in = { framesReceived: r.framesReceived, framesDecoded: r.framesDecoded, framesDropped: r.framesDropped, totalDecodeTime: r.totalDecodeTime, dec: r.decoderImplementation, w: r.frameWidth, h: r.frameHeight }; });
  return o;
};
D.loopStop = () => { const l = D.lb; if (!l) return; l.s.__stopDraw?.(); l.s.getTracks().forEach(t => t.stop()); l.pc1.close(); l.pc2.close(); D.lb = null; };
return true; })()`;

const RECV_JS = `(() => {
const R = window.__rd = { ids: new WeakMap(), cnt: new WeakMap(), n: 0 };
R.snap = async () => {
  document.querySelector('.tile.cstream button')?.click();
  const v = window.__lc.voice, o = { t: performance.now(), inb: null, vid: null };
  const e = [...(v.sfu?.consumers.values() || [])].find(x => x.source === 'screen');
  if (e) (await e.c.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') o.inb = { framesReceived: r.framesReceived, framesDecoded: r.framesDecoded, framesDropped: r.framesDropped, fps: r.framesPerSecond, totalDecodeTime: r.totalDecodeTime, packetsLost: r.packetsLost, packetsReceived: r.packetsReceived, bytesReceived: r.bytesReceived, jitter: r.jitter, freezeCount: r.freezeCount, freezeDur: r.totalFreezesDuration, w: r.frameWidth, h: r.frameHeight, dec: r.decoderImplementation, nack: r.nackCount, pli: r.pliCount, jbDelay: r.jitterBufferDelay, jbEmitted: r.jitterBufferEmittedCount }; });
  const vid = document.querySelector('.tile.screen video');
  if (vid) {
    if (!R.ids.has(vid)) { R.ids.set(vid, ++R.n); const c = { n: 0, presented: 0 }; R.cnt.set(vid, c); const loop = (_n, m) => { c.n++; c.presented = m.presentedFrames; vid.requestVideoFrameCallback(loop); }; vid.requestVideoFrameCallback(loop); }
    const q = vid.getVideoPlaybackQuality(), c = R.cnt.get(vid);
    o.vid = { id: R.ids.get(vid), total: q.totalVideoFrames, dropped: q.droppedVideoFrames, rvfc: c.n, presented: c.presented, w: vid.videoWidth, h: vid.videoHeight, paused: vid.paused };
  }
  return o;
};
return true; })()`;

// ---------- infraestrutura ----------
const kill = (p) => { try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' }); } catch { } };
const procs = [], browsers = [];
const srv = spawn('node', ['scripts/fps-diag-server.mjs'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-diag' }, stdio: ['ignore', fs.openSync('.testshots/diag-server.log', 'w'), fs.openSync('.testshots/diag-server.log', 'a')] }); procs.push(srv);
await sleep(2500);
const electron = spawn(electronPath, ['desktop', '--remote-debugging-port=9334', '--user-data-dir=' + process.cwd() + '/.testdata-diag-e', ...EXTRA], { stdio: 'ignore', env: { ...process.env, LC_TEST_SERVER: BASE } }); procs.push(electron);
const register = async (page, name) => {
  await page.waitForSelector('#auth .card'); await page.evaluate(() => [...document.querySelectorAll('#auth a')].find(a => a.textContent.includes('Registre')).click()); await sleep(200);
  await page.evaluate((n) => { const i = document.querySelectorAll('#auth input'); i[0].value = n; i[2].value = 'senha123'; i[3].value = 'senha123'; }, name);
  await page.click('#auth .btn'); await page.waitForSelector('#rail .rail-wrap', { timeout: 8000 });
};
const median = (a) => { const s = [...a].filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = [...a].filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);
// taxa média e série por segundo de um contador cumulativo
function rate(snaps, get) {
  const pts = snaps.map(s => [get(s), s && s.t]).filter(p => p[0] != null && p[1] != null);
  if (pts.length < 2) return { mean: null, series: [] };
  const series = []; for (let i = 1; i < pts.length; i++) { const dt = (pts[i][1] - pts[i - 1][1]) / 1000; if (dt > 0 && pts[i][0] >= pts[i - 1][0]) series.push((pts[i][0] - pts[i - 1][0]) / dt); }
  const first = pts[0], last = pts[pts.length - 1];
  return { mean: r1((last[0] - first[0]) / ((last[1] - first[1]) / 1000)), series };
}
const delta = (snaps, get) => { const v = snaps.map(get).filter(x => x != null); return v.length > 1 ? v[v.length - 1] - v[0] : null; };
const stat = (r) => ({ mean: r.mean, med: r1(median(r.series)), p5: r1(pct(r.series, .05)), min: r1(Math.min(...r.series)) });
const fetchServer = async () => { try { return await (await fetch(DIAG)).json(); } catch { return null; } };

try {
  // receptor (Edge com janela, para renderizar de verdade) primeiro; animação em tela cheia por último (fica por cima)
  const recv = await puppeteer.launch({ executablePath: EDGE, headless: false, defaultViewport: null, args: ['--window-size=1280,720', '--window-position=0,0', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--user-data-dir=' + process.cwd() + '/.testdata-diag-r'] }); browsers.push(recv);
  const B = await recv.newPage(); await B.goto(BASE); await register(B, 'bob');
  let eb; for (let i = 0; i < 40 && !eb; i++) { await sleep(500); try { eb = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9334', defaultViewport: null }); } catch { } }
  let E; for (let i = 0; i < 40; i++) { E = (await eb.pages()).find(p => p.url().startsWith(BASE)); if (E) break; await sleep(400); }
  await register(E, 'alice');
  const cdp = await E.createCDPSession();
  const ev = async (expression) => { const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const api = (t, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
  const tok = await E.evaluate(() => localStorage.lc_token);
  const g = await api(tok, 'POST', '/guilds', { name: 'Diag' }); const inv = await api(tok, 'POST', `/guilds/${g.id}/invites`);
  await B.evaluate(async (c) => { await fetch('/api/invites/' + c, { method: 'POST', headers: { authorization: 'Bearer ' + localStorage.lc_token } }); }, inv.code); await sleep(800);
  const vch = (await E.evaluate((id) => window.__lc.S.guilds.get(id).channels, g.id)).find(c => c.type === 2);
  for (const p of [E, B]) await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id);
  await sleep(600);
  for (const p of [E, B]) { await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent)).click()); await sleep(1500); }
  for (let i = 0; i < 30 && !(await E.evaluate(() => window.__lc.voice.sfu?.ready)); i++) await sleep(500);
  const sfuOk = await E.evaluate(() => !!window.__lc.voice.sfu?.ready); console.log('SFU pronto no remetente:', sfuOk, JSON.stringify(await E.evaluate(() => ({ ch: window.__lc.voice.channelId, sfu: !!window.__lc.voice.sfu, err: window.__lc.voice.error }))));
  await ev(SENDER_JS); await ev('__diag.patch()'); await B.evaluate(RECV_JS);
  const aliceId = await E.evaluate(() => window.__lc.S.me.id);

  const animBrowser = await puppeteer.launch({ executablePath: EDGE, headless: false, defaultViewport: null, ignoreDefaultArgs: ['--enable-automation'], args: ['--kiosk', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--user-data-dir=' + process.cwd() + '/.testdata-diag-a', pathToFileURL(path.resolve('scripts/fps-diag-anim.html')).href] }); browsers.push(animBrowser);
  await sleep(2500);
  const A = (await animBrowser.pages()).find(p => p.url().includes('fps-diag-anim')); await A.bringToFront(); animToFront(); await sleep(800);
  const animSnap = () => A.evaluate(() => ({ n: window.__anim.n, t: performance.now() }));
  if (process.env.DEBUG_FRONT) for (let i = 0; i < 6; i++) { const v = await A.evaluate(() => document.visibilityState); console.log('  [front]', v, execFileSync('powershell', ['-NoProfile', '-File', '.testshots/fg.ps1'], { encoding: 'utf8' }).trim()); await sleep(700); }
  const a0 = await animSnap(); await sleep(2000); const a1 = await animSnap();
  const srcFps = r1((a1.n - a0.n) / ((a1.t - a0.t) / 1000)); console.log(`Fonte (rAF da animação, 2 s): ${srcFps} fps; monitor reportado 143 Hz`);
  const env = { srcFps, electron: process.versions && require('../desktop/node_modules/electron/package.json').version, date: new Date().toISOString(), warm: WARM, meas: MEAS };
  const results = { env, cap: [], pipe: [], loop: [] };
  const save = () => fs.writeFileSync(OUT, JSON.stringify(results, null, 1));

  const sigma = (ts, t0, t1, ids) => { // estatística dos quadros capturados dentro da janela [t0,t1]; com ids, mede o CONTEÚDO (únicos/duplicados/saltos)
    const sel = ts.map((t, i) => i).filter(i => ts[i] >= t0 && ts[i] <= t1), w = sel.map(i => ts[i]), iv = []; for (let i = 1; i < w.length; i++) iv.push(w[i] - w[i - 1]);
    const out = { fps: r1(w.length / ((t1 - t0) / 1000)), ivMed: r1(median(iv)), ivP95: r1(pct(iv, .95)), ivMax: r1(Math.max(...iv)) };
    if (ids) {
      const v = sel.map(i => ids[i]), dur = (t1 - t0) / 1000; let uniq = 0, dup = 0, bad = 0, prev = null;
      for (const x of v) { if (x < 1) { bad++; continue; } if (x === prev) dup++; else uniq++; prev = x; }
      const good = v.filter(x => x > 0); out.uniq = r1(uniq / dur); out.dup = dup; out.badFrames = bad;
      out.srcSpan = good.length > 1 ? r1((good[good.length - 1] - good[0]) / dur) : 0; // quadros da fonte que passaram pela janela
      out.valid = good.length > v.length * 0.9 && out.srcSpan > 100; // a animação (144 fps) estava mesmo na tela?
    }
    return out;
  };

  // ===== grupo 1: SÓ captura (sem WebRTC) =====
  if (groups.includes('cap')) {
    console.log('\n== CAPTURA APENAS (getDisplayMedia, sem codificação) ==');
    const cases = [];
    for (const target of ['screen', 'window']) for (const fps of [30, 60, 120, 240, 'livre']) cases.push({ target, fps });
    for (const c of cases) for (let attempt = 1; attempt <= 3; attempt++) {
      animToFront(); await sleep(700);
      const pick = await ev(`__diag.pick('${c.target}')`); if (pick.error) { console.log('  pulou', c.target, pick.error, pick.all); continue; }
      const video = c.fps === 'livre' ? true : { frameRate: { ideal: c.fps, max: c.fps }, cursor: 'always' };
      if (process.env.CAP_ONLY && !process.env.CAP_ONLY.split(',').includes(c.target + c.fps)) continue;
      const vis0 = await A.evaluate(() => document.visibilityState);
      const a = await animSnap();
      const watch = setInterval(async () => { try { const v = await A.evaluate(() => document.visibilityState); if (v !== 'visible') console.log('   anim ficou', v); } catch { } }, 1000);
      const r = await ev(`__diag.captureOnly(${JSON.stringify(video)}, 10)`);
      clearInterval(watch);
      const b = await animSnap();
      const s = sigma(r.ts, r.t0 + 1500, r.t1, r.ids); // descarta 1,5 s de aquecimento
      if (r.err) console.log('   erro ao ler o quadro:', r.err);
      const row = { ...c, name: pick.name, declared: r.settings.frameRate, w: r.settings.width, h: r.settings.height, src: r1((b.n - a.n) / ((b.t - a.t) / 1000)), ...s };
      row.attempt = attempt; if (!row.valid && attempt < 3) { console.log('  conteúdo inválido (animação não estava visível); repetindo', JSON.stringify({ c, src: row.src, srcSpan: row.srcSpan })); await sleep(1500); continue; }
      results.cap.push(row); save(); console.log(' ', JSON.stringify(row));
      await sleep(800); break;
    }
  }

  // ===== grupo 2: pipeline completo pelo SFU =====
  const runPipe = async (cfg) => {
    animToFront(); await sleep(700);
    await ev(`__diag.cfg = ${JSON.stringify({ layers: cfg.layers, codec: cfg.codec })}; true`);
    const pick = await ev(`__diag.pick('${cfg.target}')`); if (pick.error) { console.log('  pulou', cfg.name, pick.error, pick.all); return; }
    await ev(`window.__lc.voice.toggleScreen({ res: ${JSON.stringify(cfg.res)}, fps: ${cfg.fps}, audio: false, hint: 'motion' }).then(() => true)`);
    for (let i = 0; i < 30 && !(await ev('!!window.__lc.voice.sfu?.producers.screen')); i++) await sleep(300);
    const trk = await ev(`(() => { const t = window.__lc.voice.screen.getVideoTracks()[0]; __diag.capStart(t, true); return t.getSettings(); })()`);
    await sleep(WARM * 1000);
    const S = [], Rv = [], Sv = [], An = [];
    for (let i = 0; i <= MEAS; i++) {
      const [s, r, sv, an] = await Promise.all([ev('__diag.sender()'), B.evaluate(() => window.__rd.snap()), fetchServer(), animSnap()]);
      S.push(s); Rv.push(r); Sv.push(sv); An.push(an); await sleep(1000);
    }
    const ts = await ev('__diag.capStop()'); const ids = await ev('__diag.capIds()'); await ev(`window.__lc.voice.stopLocal('screen'); true`);
    const sv0 = S.filter(Boolean); const t0 = sv0[0]?.t, t1 = sv0[sv0.length - 1]?.t;
    const row = { ...cfg, source: pick.name, track: { declared: trk.frameRate, w: trk.width, h: trk.height } };
    row.src = stat(rate(An, s => s?.n)); // fonte
    row.capture = t0 ? sigma(ts, t0, t1, ids) : null;
    row.deliver = stat(rate(sv0, s => s.media?.frames)); row.deliverFpsField = r1(median(sv0.map(s => s.media?.fps)));
    row.layers_out = {};
    const rids = [...new Set(sv0.flatMap(s => s.out.map(o => o.rid)))];
    for (const rid of rids) {
      const pick2 = (s) => s.out.find(o => o.rid === rid), last = pick2(sv0[sv0.length - 1]) || {};
      const enc = delta(sv0, s => pick2(s)?.framesEncoded), tt = delta(sv0, s => pick2(s)?.totalEncodeTime);
      const qd = (k) => { const a = pick2(sv0[0])?.qld?.[k], b = last.qld?.[k]; return a != null && b != null ? r1(b - a) : null; };
      row.layers_out[rid] = { res: `${last.w}x${last.h}`, encoded: stat(rate(sv0, s => pick2(s)?.framesEncoded)), sent: stat(rate(sv0, s => pick2(s)?.framesSent)), fpsField: r1(median(sv0.map(s => pick2(s)?.fps))), mbps: r1((rate(sv0, s => pick2(s)?.bytesSent).mean || 0) * 8 / 1e6), encMs: enc ? r1(tt / enc * 1000) : null, limit: last.limit, limitSecs: { cpu: qd('cpu'), bandwidth: qd('bandwidth') }, encoder: last.enc, codec: last.codec, scal: last.scal, nack: delta(sv0, s => pick2(s)?.nack), pli: delta(sv0, s => pick2(s)?.pli), keyFrames: delta(sv0, s => pick2(s)?.keyFrames), target: r1((last.target || 0) / 1e6) };
    }
    row.availMbps = r1((median(sv0.map(s => s.cp?.avail)) || 0) / 1e6); row.rtt = r1((median(sv0.map(s => s.cp?.rtt)) || 0) * 1000);
    // servidor
    const prod = Sv.filter(Boolean).map(s => s.producers.find(p => p.source === 'screen')).filter(Boolean), cons = Sv.filter(Boolean).map(s => s.consumers.find(c => c.source === 'screen')).filter(Boolean);
    const sumPk = (list) => list.length > 1 ? list[list.length - 1].stats.reduce((n, x) => n + (x.packetCount || 0), 0) - list[0].stats.reduce((n, x) => n + (x.packetCount || 0), 0) : null;
    row.server = { prodMbps: r1(median(prod.map(p => p.stats.reduce((n, x) => n + (x.bitrate || 0), 0))) / 1e6), prodPkts: sumPk(prod), prodLost: prod.length ? prod[prod.length - 1].stats.reduce((n, x) => n + (x.packetsLost || 0), 0) : null, consMbps: r1(median(cons.map(c => c.stats.reduce((n, x) => n + (x.bitrate || 0), 0))) / 1e6), consPkts: sumPk(cons), layers: cons[cons.length - 1]?.layers || null, prodScore: prod[prod.length - 1]?.stats.map(x => x.score) };
    // espectador
    const rv = Rv.filter(r => r?.inb); const vids = Rv.filter(r => r?.vid), sameVid = vids.filter(r => r.vid.id === vids[vids.length - 1]?.vid.id);
    const dec = delta(rv, r => r.inb.framesDecoded), dt = delta(rv, r => r.inb.totalDecodeTime);
    row.recv = { received: stat(rate(rv, r => r.inb.framesReceived)), decoded: stat(rate(rv, r => r.inb.framesDecoded)), dropped: delta(rv, r => r.inb.framesDropped), fpsField: r1(median(rv.map(r => r.inb.fps))), decMs: dec ? r1(dt / dec * 1000) : null, lost: delta(rv, r => r.inb.packetsLost), freezes: delta(rv, r => r.inb.freezeCount), res: rv.length ? `${rv[rv.length - 1].inb.w}x${rv[rv.length - 1].inb.h}` : null, decoder: rv.length ? rv[rv.length - 1].inb.dec : null, jbMs: (() => { const e = delta(rv, r => r.inb.jbEmitted), d = delta(rv, r => r.inb.jbDelay); return e ? r1(d / e * 1000) : null; })() };
    row.render = { presented: stat(rate(sameVid, r => r.vid.presented)), rvfc: stat(rate(sameVid, r => r.vid.rvfc)), quality: stat(rate(sameVid, r => r.vid.total)), droppedByVideo: delta(sameVid, r => r.vid.dropped), res: vids.length ? `${vids[vids.length - 1].vid.w}x${vids[vids.length - 1].vid.h}` : null };
    row.valid = !!row.capture?.valid;
    if (!row.valid && (cfg.attempt || 1) < 3) { console.log('  conteúdo inválido, repetindo:', cfg.name, JSON.stringify(row.capture)); await sleep(1500); return runPipe({ ...cfg, attempt: (cfg.attempt || 1) + 1 }); }
    results.pipe.push(row); save();
    const L = rids.map(id => `${id}:${row.layers_out[id].res} enc ${row.layers_out[id].encoded.mean} ${row.layers_out[id].mbps}Mb ${row.layers_out[id].encMs}ms ${row.layers_out[id].limit}`).join(' | ');
    console.log(` ${cfg.name}\n    fonte ${row.src.mean} | captura ${row.capture?.fps} | entrega ${row.deliver.mean} | ${L}\n    servidor in ${row.server.prodMbps}Mb out ${row.server.consMbps}Mb | recep ${row.recv.received.mean} dec ${row.recv.decoded.mean} (${row.recv.res}) | render ${row.render.presented.mean}/${row.render.rvfc.mean}`);
    await sleep(2500);
  };
  if (groups.includes('pipe')) {
    console.log('\n== PIPELINE COMPLETO (captura → codificador → SFU → espectador → render) ==');
    const P = (name, target, res, fps, layers, codec) => ({ name, target, res, fps, layers, codec });
    const list = [
      P('A1 tela 1080 fps30 3L h264', 'screen', 1080, 30, 3, 'h264'),
      P('A2 tela 1080 fps60 3L h264', 'screen', 1080, 60, 3, 'h264'),
      P('A3 tela 1080 fps120 3L h264 (BASELINE do problema)', 'screen', 1080, 120, 3, 'h264'),
      P('B1 tela 1080 fps120 1L h264', 'screen', 1080, 120, 1, 'h264'),
      P('B2 tela 1080 fps120 3L vp8', 'screen', 1080, 120, 3, 'vp8'),
      P('B3 tela 1080 fps120 1L vp8', 'screen', 1080, 120, 1, 'vp8'),
      P('B4 tela 1080 fps60 1L h264', 'screen', 1080, 60, 1, 'h264'),
      P('B5 tela 1080 fps60 3L vp8', 'screen', 1080, 60, 3, 'vp8'),
      P('B6 tela 1080 fps60 1L vp8', 'screen', 1080, 60, 1, 'vp8'),
      P('C1 tela 720 fps60 3L h264', 'screen', 720, 60, 3, 'h264'),
      P('C2 tela 720 fps120 3L h264', 'screen', 720, 120, 3, 'h264'),
      P('C3 tela source fps120 3L h264', 'screen', 'source', 120, 3, 'h264'),
      P('D1 janela source fps60 3L h264', 'window', 'source', 60, 3, 'h264'),
      P('D2 janela source fps120 3L h264', 'window', 'source', 120, 3, 'h264'),
      P('D3 janela source fps120 1L h264', 'window', 'source', 120, 1, 'h264'),
      P('D4 janela source fps120 3L vp8', 'window', 'source', 120, 3, 'vp8'),
      P('A3b tela 1080 fps120 3L h264 (repetição)', 'screen', 1080, 120, 3, 'h264'),
    ];
    for (const cfg of list) { try { await runPipe(cfg); } catch (e) { console.log('  ERRO', cfg.name, e.message); try { await ev(`window.__lc.voice.stopLocal('screen'); true`); } catch { } await sleep(2000); } }
  }

  // ===== validação da métrica do app (voice.captureFps) contra a contagem independente do track =====
  if (groups.includes('meter')) {
    console.log('\n== MÉTRICA DO APP (voice.captureFps) x CONTAGEM INDEPENDENTE ==');
    await ev(`__diag.pick('screen')`);
    for (const fps of [30, 60, 120]) {
      await ev(`__diag.cfg = { layers: 3, codec: 'h264' }; window.__lc.voice.toggleScreen({ res: 1080, fps: ${fps}, audio: false, hint: 'motion' }).then(() => true)`);
      for (let i = 0; i < 30 && !(await ev('!!window.__lc.voice.sfu?.producers.screen')); i++) await sleep(300);
      await ev(`__diag.capStart(window.__lc.voice.screen.getVideoTracks()[0], true); true`);
      await sleep(WARM * 1000);
      const t0 = await ev('performance.now()'); const vals = [];
      for (let i = 0; i < 10; i++) { vals.push(await ev('window.__lc.voice.captureFps')); await sleep(1000); }
      const t1 = await ev('performance.now()'); const ts = await ev('__diag.capStop()');
      const direct = sigma(ts, t0, t1).fps, shown = median(vals);
      const text = await ev(`(() => { window.__lc.voice.onUpdate?.(); return window.__lc.voice.captureFps })()`);
      await ev(`window.__lc.voice.stopLocal('screen'); true`);
      const stopped = await ev('window.__lc.voice.captureFps');
      const row = { requested: fps, appMetric: shown, direct, diff: r1(Math.abs(shown - direct)), series: vals, afterStop: stopped };
      results.pipe.push({ name: 'meter', ...row }); save(); console.log(' ', JSON.stringify(row));
      await sleep(2000);
    }
  }

  // ===== grupo 3: só o codificador (loopback local, sem SFU), codecs diferentes =====
  if (groups.includes('loop') || groups.includes('canvas')) {
    const SRC = groups.includes('canvas') ? 'canvas' : 'screen';
    console.log('\n== CODIFICADOR ISOLADO (loopback WebRTC local, 1 camada, ' + SRC + ' 1080) ==');
    const caps = await ev(`[...new Set(RTCRtpSender.getCapabilities('video').codecs.map(c => c.mimeType))]`); console.log('  codecs de envio disponíveis:', caps.join(', '));
    await ev(`__diag.pick('screen')`);
    for (const fps of [60, 120]) for (const mime of ['video/H264', 'video/VP8', 'video/VP9', 'video/AV1']) {
      const mbps = fps >= 120 ? 12 : 8;
      const video = { frameRate: { ideal: fps, max: fps }, height: { ideal: 1080, max: 1080 }, width: { ideal: 1920 }, cursor: 'always' };
      const st = await ev(`__diag.loopStart(${JSON.stringify(video)}, '${mime}', ${mbps}, '${SRC}')`);
      if (st.unsupported) { console.log('  ', mime, fps, 'não suportado'); results.loop.push({ src: SRC, mime, fps, unsupported: true }); continue; }
      await ev(`(() => { __diag.capStart(__diag.lb.tr, true); return 1 })()`);
      await sleep(WARM * 1000 - 2000);
      const S = []; for (let i = 0; i <= MEAS; i++) { S.push(await ev('__diag.loopSnap()')); await sleep(1000); }
      const ts = await ev('__diag.capStop()'); await ev('__diag.loopStop(); true');
      const o0 = S.map(s => ({ t: s.t, o: s.out[0] })), last = S[S.length - 1].out[0] || {};
      const enc = delta(o0, s => s.o?.framesEncoded), tt = delta(o0, s => s.o?.totalEncodeTime);
      const qd = (k) => { const a = S[0].out[0]?.qld?.[k], b = last.qld?.[k]; return a != null && b != null ? r1(b - a) : null; };
      const row = { src: SRC, mime, fps, mbpsCap: mbps, capture: sigma(ts, S[0].t, S[S.length - 1].t), deliver: stat(rate(S, s => s.media?.frames)), encoded: stat(rate(S, s => s.out[0]?.framesEncoded)), sent: stat(rate(S, s => s.out[0]?.framesSent)), mbps: r1((rate(S, s => s.out[0]?.bytesSent).mean || 0) * 8 / 1e6), encMs: enc ? r1(tt / enc * 1000) : null, encoder: last.enc, limit: last.limit, limitSecs: { cpu: qd('cpu'), bandwidth: qd('bandwidth') }, res: `${last.w}x${last.h}`, decoded: stat(rate(S, s => s.in?.framesDecoded)), decoder: S[S.length - 1].in?.dec };
      results.loop.push(row); save();
      console.log(`  ${mime} @${fps}: captura ${row.capture.fps} | entrega ${row.deliver.mean} | codif ${row.encoded.mean} (${row.encMs} ms, ${row.encoder}, ${row.res}) ${row.mbps} Mb | limite ${row.limit} cpu ${row.limitSecs.cpu}s bw ${row.limitSecs.bandwidth}s | decod ${row.decoded.mean} (${row.decoder})`);
      await sleep(1500);
    }
  }
  save(); console.log('\nResultados em', OUT);
} catch (e) { console.log('FALHA DO DIAGNÓSTICO:', e.stack || e.message); }
finally { for (const b of browsers) { try { await b.close(); } catch { } } for (const p of procs) kill(p); await sleep(500); process.exit(0); }
