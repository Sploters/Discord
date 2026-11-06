// Transmissão de jogo como no Discord + clipes com F8 (2 navegadores, servidor real; o app desktop é simulado em
// window.lcDesktop, porque o áudio por processo só existe no Windows):
// - o seletor já escolhe o jogo detectado, inclusive MINIMIZADO (sem miniatura), e o áudio "só o jogo"
// - ao transmitir: a janela minimizada é pedida pelo id (antes caía para a tela inteira), o áudio do PC inteiro é trocado pelo
//   PCM do programa nativo (tom de 440 Hz em pedaços de tamanho torto) e o tom chega de verdade na trilha
// - clipe: áudio do jogo + microfone de quem transmite (2 fontes), também no clipe de quem assiste
// - F8 salva o clipe e mostra o aviso (na página, ou pelo app desktop quando a janela está em segundo plano)
// Uso: BROWSER=/caminho/do/chrome node scripts/gameshare-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3271, BASE = `http://localhost:${PORT}`;
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata-gs', { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-gs', RTC_PORT: '41071', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });

// app desktop simulado: lista com o jogo minimizado, áudio nativo = tom de 440 Hz
const fakeDesktop = () => {
  const T = (window.__t = { selected: null, audioStart: null, flashes: [], stopped: 0 });
  const png = (() => { const c = document.createElement('canvas'); c.width = 32; c.height = 32; const x = c.getContext('2d'); x.fillStyle = '#e44'; x.fillRect(0, 0, 32, 32); return c.toDataURL(); });
  let audioCb = null, timer = null, hotkey = null;
  window.lcDesktop = {
    isDesktop: true,
    getSources: async () => [
      { id: 'screen:0:0', name: 'Tela inteira', type: 'screen', thumbnail: png(), appIcon: null },
      { id: 'window:111:0', name: 'Navegador — YouTube', type: 'window', thumbnail: png(), appIcon: null, pid: 900, exe: 'C:\\Program Files\\Google\\Chrome\\chrome.exe', game: false },
      { id: 'window:4242:0', name: 'VALORANT', type: 'window', thumbnail: null, appIcon: png(), pid: 5150, exe: 'C:\\Riot Games\\VALORANT\\live\\ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe', game: true, minimized: true, fullscreen: true },
    ],
    selectSource: async (id, name) => { T.selected = { id, name }; return true; },
    appAudioCapable: async () => ({ ok: true }),
    onAppAudio: (f) => { audioCb = f; },
    appAudioStart: async (o) => {
      T.audioStart = o; let n = 0;
      // pedaços de 1001 bytes: cortam amostras e quadros no meio (como o stdout do programa)
      const send = () => { if (!audioCb) return; const f = new Float32Array(960 * 2); for (let i = 0; i < 960; i++) { const v = Math.sin(n++ * 440 * 2 * Math.PI / 48000) * .5; f[i * 2] = v; f[i * 2 + 1] = v; } const b = new Uint8Array(f.buffer); for (let i = 0; i < b.length; i += 1001) audioCb(b.slice(i, i + 1001)); };
      timer = setInterval(send, 20); return { ok: true };
    },
    appAudioStop: () => { clearInterval(timer); T.stopped++; },
    clipFlash: (o) => T.flashes.push(o),
    onHotkey: (cb) => { hotkey = cb; window.__hotkey = (k) => hotkey?.(k); },
    setSettings: async () => true, getSettings: async () => ({}), setBadge: () => { }, setThrottle: () => { },
  };
  // a captura do Chromium (fonte escolhida + loopback do PC inteiro): vídeo de canvas + um tom de 1500 Hz (o "PC inteiro")
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let n = 0;
    setInterval(() => { x.fillStyle = `hsl(${n++ % 360},60%,40%)`; x.fillRect(0, 0, 1280, 720); }, 33);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.frequency.value = 1500; o.connect(d); o.start();
    return new MediaStream([...c.captureStream(30).getVideoTracks(), ...d.stream.getAudioTracks()]);
  };
};
async function page(tok, desk) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  if (desk) await p.evaluateOnNewDocument(fakeDesktop);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
// frequência dominante de uma trilha de áudio (FFT do WebAudio)
const peakHz = (P, expr) => P.evaluate(async (expr) => {
  const t = eval(expr); if (!t) return null;
  const ac = new AudioContext(), an = ac.createAnalyser(); an.fftSize = 8192; ac.createMediaStreamSource(new MediaStream([t])).connect(an);
  await new Promise(r => setTimeout(r, 700));
  const f = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(f);
  let best = 0; for (let i = 1; i < f.length; i++) if (f[i] > f[best]) best = i;
  ac.close(); return { hz: Math.round(best * ac.sampleRate / an.fftSize), db: Math.round(f[best]) };
}, expr);

try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Jogatina' }); const code = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(b.tok, 'POST', '/invites/' + code);
  const A = await page(a.tok, true), B = await page(b.tok, false);
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2).id, g.id);
  ok(await A.evaluate(() => window.__lc.S.prefs.keyClip) === 'F8', 'atalho padrão do clipe é F8');
  for (const P of [A, B]) { await P.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, vc); }
  await sleep(3500);

  // ---- seletor ----
  await A.evaluate(() => document.querySelector('#stage .roundbtn[title="Transmitir tela"]').click());
  await A.waitForSelector('.source'); await sleep(600);
  const pick = await A.evaluate(() => ({ tab: document.querySelector('.modal .seg button.on')?.textContent, sel: document.querySelector('.source.sel .sn span')?.textContent,
    badge: !!document.querySelector('.source.sel .src-game'), minimized: !!document.querySelector('.source.sel .src-ph'), audio: [...document.querySelectorAll('.modal .seg button.on')].map(b => b.textContent) }));
  ok(pick.sel === 'VALORANT' && pick.badge && pick.minimized, 'jogo minimizado aparece, com selo JOGO, e já vem escolhido', pick);
  ok(pick.audio.some(t => /^Só o jogo|^Só este programa: VALORANT/.test(t)), 'áudio padrão: só o jogo', pick.audio);
  await A.screenshot({ path: '.testshots/gameshare-picker.png' });
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Transmitir').click());
  await sleep(2500);
  const st = await A.evaluate(() => ({ t: window.__t, appAudio: window.__lc.voice.appAudio && { mode: window.__lc.voice.appAudio.mode, name: window.__lc.voice.appAudio.name }, tracks: window.__lc.voice.screen?.getAudioTracks().length, err: window.__lc.voice.error }));
  ok(st.t.selected?.id === 'window:4242:0', 'transmite a janela do jogo (minimizada) pelo id, não a tela inteira', st.t.selected);
  ok(st.t.audioStart?.mode === 'include' && st.t.audioStart.pid === 5150, 'áudio pedido só do processo do jogo', st.t.audioStart);
  ok(st.tracks === 1 && st.appAudio?.mode === 'include', 'a trilha de áudio da transmissão é a do jogo (o loopback do PC inteiro saiu)', st);
  const hz = await peakHz(A, 'window.__lc.voice.screen.getAudioTracks()[0]');
  ok(hz && Math.abs(hz.hz - 440) < 15 && hz.db > -60, 'o som do jogo (440 Hz) chega na trilha, mesmo com pedaços cortados no meio', hz);
  // quem assiste recebe o áudio da transmissão (440 Hz, não os 1500 Hz do "PC inteiro")
  await B.evaluate(() => { const v = window.__lc.voice; [...v.closedStreams].forEach(u => v.openStream(u)); window.__lc.voice.onUpdate(); }); await sleep(3500);
  const bhz = await peakHz(B, `(() => { for (const p of window.__lc.voice.peers.values()) if (p.screenAudioEl?.raw) return p.screenAudioEl.raw.getAudioTracks()[0]; })()`);
  ok(bhz && Math.abs(bhz.hz - 440) < 15, 'quem assiste ouve só o jogo (440 Hz), não o resto do PC (1500 Hz)', bhz);

  // ---- clipes: jogo + microfone ----
  await A.evaluate(() => { window.__lc.S.prefs.clipsOn = true; window.__lc.voice.onUpdate(); });
  await sleep(1500);
  const infoA = await A.evaluate(async (me) => (await window.__lc.import('clips.js')).clipInfo('s:' + me), a.id);
  ok(infoA?.audioSources === 2, 'clipe da própria transmissão: áudio do jogo + o microfone de quem transmite', infoA);
  const infoB = await B.evaluate(async (uid) => (await window.__lc.import('clips.js')).clipInfo('s:' + uid), a.id);
  ok(infoB?.audioSources === 2, 'clipe de quem assiste: áudio da transmissão + a voz de quem transmite', infoB);
  const prod = await A.evaluate(() => { const v = window.__lc.voice, P = v.sfu.producers; return { sources: Object.keys(P).sort(), screenAudioIsGame: P.screenaudio?.track?.id === v.appAudio.track.id, micSeparate: !!P.mic && P.mic.track?.id !== P.screenaudio?.track?.id }; });
  ok(prod.screenAudioIsGame && prod.micSeparate, 'ao vivo: o áudio da transmissão é só o jogo; o microfone segue separado, como voz da call', prod);
  await sleep(5000);

  // F8 com a página em foco: aviso na própria página
  await A.bringToFront(); await A.keyboard.press('F8'); await sleep(400);
  const flash1 = await A.evaluate(() => ({ el: !!document.querySelector('.clipflash:not(.bad)'), text: document.querySelector('.clipflash b')?.textContent, sub: document.querySelector('.clipflash small')?.textContent }));
  ok(flash1.el && flash1.text === 'Clipe capturado', 'F8: animação "Clipe capturado" aparece para quem apertou', flash1);
  await A.screenshot({ path: '.testshots/gameshare-flash.png' });
  ok(!(await B.evaluate(() => !!document.querySelector('.clipflash'))), 'a outra pessoa não vê o aviso');
  await sleep(4000);
  const clips = await call(a.tok, 'GET', `/guilds/${g.id}/clips`);
  const list = clips.clips || clips;
  ok(Array.isArray(list) && list.length >= 1, 'clipe salvo na galeria', list?.length);
  // o clipe tem som (decodifica o áudio do arquivo)
  if (list?.[0]?.url) {
    const aud = await A.evaluate(async (url) => { const buf = await (await fetch(url)).arrayBuffer(); try { const ab = await new AudioContext().decodeAudioData(buf); let pk = 0; const d = ab.getChannelData(0); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); return { secs: +ab.duration.toFixed(1), peak: +pk.toFixed(2) }; } catch (e) { return { error: e.message }; } }, list[0].url);
    ok(aud.peak > 0.1, 'o clipe tem áudio', aud);
  }
  // app em segundo plano (jogando): o aviso vai para o app desktop, por cima do jogo
  await A.evaluate(() => { document.hasFocus = () => false; window.__hotkey('clip'); }); await sleep(400);
  const fl = await A.evaluate(() => window.__t.flashes);
  ok(fl.length === 1 && fl[0].ok && fl[0].title === 'Clipe capturado', 'em segundo plano: o app desktop mostra o aviso por cima do jogo', fl);
  // nada gravando: aviso de erro
  await B.evaluate(() => { window.__lc.S.prefs.clipsOn = false; return window.__lc.import('clips.js').then(m => m.stopAllBuffers()); });
  await B.bringToFront(); await B.keyboard.press('F8'); await sleep(300);
  ok(await B.evaluate(() => !!document.querySelector('.clipflash.bad')), 'F8 sem clipes gravando: aviso de erro');

  // parar a transmissão desliga o programa de áudio
  await A.evaluate(() => window.__lc.voice.toggleScreen()); await sleep(300);
  ok(await A.evaluate(() => window.__t.stopped >= 1 && !window.__lc.voice.appAudio), 'parar a transmissão desliga o áudio do jogo');
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
