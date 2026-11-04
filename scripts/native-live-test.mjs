// Transmissão a 120 FPS pelo botão normal (app desktop simulado): o vídeo vai pelo programa nativo (native/lc-stream,
// compilado para Linux, com ffmpeg no lugar da captura + placa), o áudio e a prévia pelo Chromium. Quem assiste usa o palco de sempre.
// Também: troca 120 -> 60 -> 120 ao vivo, queda do programa (volta ao modo normal sem derrubar a transmissão), parar.
// Uso: node scripts/native-live-test.mjs   (SHOTS=1 salva capturas em .testshots/native)
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3243, BASE = `http://localhost:${PORT}`, OUT = '.testshots/native';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
execFileSync('cargo', ['build', '--release', '--quiet'], { cwd: 'native/lc-stream', stdio: 'inherit' });
const BIN = 'native/lc-stream/target/release/lc-stream';
fs.rmSync('.testdata14', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata14', RTC_PORT: '41010', RTC_IPS: '127.0.0.1', RTC_NATIVE_PORTS: '41011-41015' }, stdio: process.env.DEBUG_NATIVE ? ['ignore', 'inherit', 'inherit'] : 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const helpers = []; // programas nativos iniciados pelo "app desktop"
async function page(tok, desk) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  if (desk) {
    // ponte do processo principal: liga o programa de verdade (versão Linux) com a configuração que o app passou
    await p.exposeFunction('__natStart', (o) => new Promise((resolve) => {
      const h = { cfg: o, proc: spawn(BIN, ['--stdin'], { stdio: ['pipe', 'pipe', 'ignore'] }), events: [] }; helpers.push(h);
      let buf = '', done = false;
      h.proc.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); let ev; try { ev = JSON.parse(l); } catch { continue; } h.events.push(ev);
        if (!done && (ev.t === 'started' || ev.t === 'error')) { done = true; resolve(ev.t === 'started' ? { ok: true, ...ev } : { ok: false, error: ev.error }); }
        p.evaluate((ev) => window.__natCb?.(ev), ev).catch(() => { }); } });
      h.proc.on('exit', (code) => { if (!done) { done = true; resolve({ ok: false, error: 'saiu ' + code }); } if (!h.stopped) p.evaluate((code) => window.__natCb?.({ t: 'exit', code }), code).catch(() => { }); });
      h.proc.stdin.write(JSON.stringify({ ...o, sourceId: undefined, window: 1234 }) + '\n');
    }));
    await p.exposeFunction('__natStop', () => { for (const h of helpers) if (!h.stopped) { h.stopped = true; try { h.proc.stdin.write('stop\n'); h.proc.stdin.end(); } catch { } } });
  }
  await p.evaluateOnNewDocument((tok, desk) => {
    localStorage.lc_token = tok;
    navigator.mediaDevices.getDisplayMedia = async (c) => {
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const x = cv.getContext('2d'); let n = 0; setInterval(() => { x.fillStyle = `hsl(${n++ % 360},60%,40%)`; x.fillRect(0, 0, 1280, 720); }, 33);
      const s = cv.captureStream(30); window.__dmc = c;
      if (c?.audio) { const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); s.addTrack(d.stream.getAudioTracks()[0]); }
      return s;
    };
    if (desk) {
      const fns = { isDesktop: true, getSettings: async () => ({}), getUpdate: async () => null, setThrottle: () => { },
        getSources: async () => [{ id: 'window:1234:0', name: 'Jogo', type: 'window', thumbnail: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }, { id: 'screen:1:0', name: 'Tela 1', type: 'screen', thumbnail: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }],
        selectSource: async (id) => { window.__picked = id; return true; },
        nativeCapable: async () => ({ ok: true, encoders: ['teste'] }),
        nativeStart: (o) => window.__natStart(o), nativeStop: () => window.__natStop(), onNativeEvent: (cb) => { window.__natCb = cb; } };
      window.lcDesktop = new Proxy(fns, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(true)) });
    }
  }, tok, desk);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
// fps decodificado da transmissão de tela no espectador, medido em 4 s
const viewerFps = (B, uid) => B.evaluate(async (uid) => {
  const v = window.__lc.voice, find = () => [...v.sfu.consumers.values()].filter(x => x.uid === uid && x.source === 'screen' && !x.c.closed).at(-1);
  const rd = async (e) => { let s; (await e.c.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') s = r; }); return s; };
  let e, a; for (let i = 0; i < 40 && !(e = find(), a = e && await rd(e)); i++) await new Promise(r => setTimeout(r, 250)); // a transmissão pode ter acabado de recomeçar
  if (!a) return -1;
  await new Promise(r => setTimeout(r, 4000)); const b = await rd(e);
  return Math.round((b.framesDecoded - a.framesDecoded) / 4);
}, uid);
const serverNative = async (tok) => (await call(tok, 'POST', '/native-screen/stop')).ok; // só para limpar
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Jogo' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(b.tok, 'POST', '/invites/' + inv);
  const A = await page(a.tok, true), B = await page(b.tok, false);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) {
    await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 15000 });
  }
  await A.waitForFunction(() => window.__lc.S.nativeOk === true, { timeout: 5000 }).catch(() => { });
  // seletor de transmissão: janela + 720p + 120 fps
  await A.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(x => x.title.includes('Transmitir')).click()); await sleep(800);
  await A.evaluate(() => { const seg = (label) => [...document.querySelectorAll('.modal .seg button')].find(x => x.textContent.trim() === label)?.click(); seg('Janelas / aplicativos'); });
  await sleep(300); await A.evaluate(() => document.querySelector('.modal .source')?.click());
  await A.evaluate(() => { for (const l of ['720p', '120 fps']) [...document.querySelectorAll('.modal .seg button')].find(x => x.textContent.trim() === l)?.click(); });
  await sleep(200);
  ok(/capturada e comprimida pelo próprio app/.test(await A.evaluate(() => document.querySelector('.modal .qinfo.ok')?.textContent || '')), 'acima de 60 FPS o seletor explica o modo nativo');
  if (process.env.SHOTS) await A.screenshot({ path: `${OUT}/10-seletor-120.png` });
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /^Transmitir$/.test(x.textContent.trim())).click());
  await A.waitForFunction(() => window.__lc.voice.native && !window.__lc.voice.native.pending && window.__lc.voice.sfu.producers.screenaudio, { timeout: 15000 }).catch(() => { });
  const st = await A.evaluate(() => ({ native: !!window.__lc.voice.native, picked: window.__picked, prod: Object.keys(window.__lc.voice.sfu.producers), dm: window.__dmc?.video?.frameRate }));
  ok(st.native && st.picked === 'window:1234:0', 'modo nativo ligado com a janela escolhida', st);
  ok(!st.prod.includes('screen') && st.prod.includes('screenaudio'), 'vídeo NÃO vai pelo Chromium; o áudio do sistema vai', st.prod);
  const cfg = helpers[0]?.cfg || {};
  ok(cfg.fps === 120 && cfg.height === 720 && cfg.key?.length === 40 && cfg.serverKey?.length === 40 && cfg.host === 'localhost' && cfg.port >= 41011, 'o programa recebeu fps, altura, chaves SRTP e o endereço do servidor', { fps: cfg.fps, height: cfg.height, port: cfg.port, host: cfg.host, kbps: cfg.kbps });
  const prev = await A.evaluate(() => window.__lc.voice.screen.getVideoTracks()[0].getConstraints());
  ok(prev.frameRate?.max === 10, 'captura do Chromium fica só como prévia leve (10 fps)', prev.frameRate);
  // espectador: palco normal
  await B.waitForFunction((uid) => !!document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`) || !!document.querySelector(`.tile.screen[data-sid="${uid}"]`), { timeout: 15000 }, a.id);
  await B.evaluate((uid) => document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`)?.click(), a.id);
  // o servidor começa pela camada leve e sobe para a cheia quando a banda do espectador permite (alguns segundos)
  await B.waitForFunction((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"] video`)?.videoWidth >= 1280, { timeout: 20000 }, a.id).catch(() => { });
  const vw = await B.evaluate((uid) => { const v = document.querySelector(`.tile.screen[data-sid="${uid}"] video`); return [v?.videoWidth, v?.videoHeight]; }, a.id);
  ok(vw[0] === 1280 && vw[1] === 720, 'quem assiste vê a transmissão nativa no palco e sobe para a camada cheia (1280x720)', vw);
  const f1 = await viewerFps(B, a.id);
  ok(f1 > 100, 'e recebe/decodifica ~120 fps', f1);
  ok(await B.evaluate((uid) => !!window.__lc.voice.peers.get(uid)?.screenAudioEl, a.id), 'o áudio do sistema chega junto (pelo WebRTC)');
  // versão leve (internet fraca): o servidor tem as duas camadas; o espectador pede a leve e depois volta à cheia
  const cfg0 = helpers[0].cfg;
  ok(cfg0.layers?.length === 2 && cfg0.layers[0].height === 360 && cfg0.layers[0].fps === 60 && cfg0.layers[1].height === 720 && cfg0.layers[1].fps === 120 && cfg0.layers[0].ssrc !== cfg0.layers[1].ssrc, 'programa recebe 2 camadas: 360p60 (leve) e 720p120 (cheia)', cfg0.layers);
  const layer = (sp) => B.evaluate(async (uid, sp) => { const v = window.__lc.voice, e = [...v.sfu.consumers.values()].find(x => x.uid === uid && x.source === 'screen'); await v.sfuReq('layers', { consumer_id: e.c.id, spatial: sp }); }, a.id, sp);
  const recv = () => B.evaluate(async (uid) => {
    const v = window.__lc.voice, e = [...v.sfu.consumers.values()].find(x => x.uid === uid && x.source === 'screen');
    const rd = async () => { let s; (await e.c.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') s = r; }); return s; };
    const a = await rd(); await new Promise(r => setTimeout(r, 3000)); const b = await rd();
    return { h: b.frameHeight, fps: Math.round((b.framesDecoded - a.framesDecoded) / 3) };
  }, a.id);
  await layer(0); await sleep(2500);
  const lo = await recv();
  ok(lo.h === 360 && lo.fps >= 50 && lo.fps <= 70, 'espectador na camada leve: 360p a ~60 fps', lo);
  await layer(2); await sleep(2500);
  const hi = await recv();
  ok(hi.h === 720 && hi.fps > 100, 'de volta à camada cheia: 720p a ~120 fps', hi);
  const lst = await A.evaluate(() => window.__lc.voice.native?.stats?.layers);
  ok(Array.isArray(lst) && lst[0] >= 50 && lst[0] <= 70 && lst[1] > 100, 'programa informa os fps de cada camada', lst);
  await sleep(1200);
  const ss = await A.evaluate(() => window.__lc.voice.screenStats());
  ok(ss?.[0]?.fps > 100 && /nativo/.test(ss[0].enc), 'painel de quem transmite mostra os fps do programa nativo', ss?.[0]);
  ok(await A.evaluate(() => window.__lc.voice.captureFps) > 100, 'medidor de FPS de captura usa o programa nativo');
  if (process.env.SHOTS) { await A.evaluate(() => window.__lc.voice.screen && [...document.querySelectorAll('.roundbtn')].find(x => /ransmi/.test(x.title))?.click()); await sleep(2500); await A.screenshot({ path: `${OUT}/11-ao-vivo-120.png` }); await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Fechar')?.click()); await sleep(300); await B.screenshot({ path: `${OUT}/12-espectador-120.png` }); }
  // ao vivo: 120 -> 60 (volta ao Chromium) -> 120 (nativo de novo)
  await A.evaluate(() => window.__lc.voice.changeScreenQuality({ fps: 60 })); await sleep(2500);
  const s60 = await A.evaluate(() => ({ native: !!window.__lc.voice.native, prod: Object.keys(window.__lc.voice.sfu.producers) }));
  ok(!s60.native && s60.prod.includes('screen') && helpers[0].stopped, 'mudar para 60 fps: programa parado e vídeo volta ao Chromium', s60);
  await B.waitForFunction((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"] video`)?.videoWidth > 0, { timeout: 15000 }, a.id).catch(() => { });
  const f60 = await viewerFps(B, a.id);
  ok(f60 > 15, 'espectador continua recebendo (agora pelo Chromium)', f60);
  await A.evaluate(() => window.__lc.voice.changeScreenQuality({ fps: 120 }));
  await A.waitForFunction(() => window.__lc.voice.native && !window.__lc.voice.native.pending, { timeout: 15000 }).catch(() => { });
  await sleep(1500);
  const s120 = await A.evaluate(() => ({ native: !!window.__lc.voice.native, prod: Object.keys(window.__lc.voice.sfu.producers) }));
  ok(s120.native && !s120.prod.includes('screen') && helpers.length === 2, 'voltar para 120 fps: programa nativo de novo', s120);
  // nova sessão: o servidor recomeça pela camada leve e sobe quando a banda permite
  await B.waitForFunction((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"] video`)?.videoHeight >= 720, { timeout: 20000 }, a.id).catch(() => { });
  const f3 = await viewerFps(B, a.id);
  ok(f3 > 100, 'espectador volta a receber ~120 fps (camada cheia)', f3);
  // o programa cai (ex.: placa de vídeo ocupada): segue transmitindo pelo modo normal
  helpers[1].proc.kill('SIGKILL'); await sleep(2500);
  const sf = await A.evaluate(() => ({ native: !!window.__lc.voice.native, prod: Object.keys(window.__lc.voice.sfu.producers), screen: !!window.__lc.voice.screen, toast: document.getElementById('toast')?.textContent || '' }));
  ok(!sf.native && sf.screen && sf.prod.includes('screen') && /120 FPS indisponível/.test(sf.toast), 'programa caiu: transmissão continua pelo modo normal, com aviso', sf);
  // parar tudo
  await A.evaluate(() => window.__lc.voice.changeScreenQuality({ fps: 120 }));
  await A.waitForFunction(() => window.__lc.voice.native && !window.__lc.voice.native.pending, { timeout: 15000 }).catch(() => { });
  await A.evaluate(() => window.__lc.voice.toggleScreen()); await sleep(1500);
  ok(helpers.every(h => h.stopped || h.proc.exitCode !== null), 'parar a transmissão para o programa nativo');
  const gone = await B.waitForFunction((uid) => !window.__lc.voice.peers.get(uid)?.streams?.screen, { timeout: 8000 }, a.id).then(() => true, () => false);
  ok(gone, 'espectador deixa de ver a transmissão', gone || await B.evaluate((uid) => [...window.__lc.voice.sfu.consumers.values()].filter(x => x.uid === uid).map(x => x.source + ':' + x.c.producerId), a.id));
  void serverNative;
} catch (e) { console.log('ERRO', e); fails++; }
finally { for (const h of helpers) try { h.proc.kill(); } catch { } await browser.close(); srv.kill(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
