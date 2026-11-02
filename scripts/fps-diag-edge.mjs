// Controle: mede a captura de tela (getDisplayMedia) no Edge estável, sem Electron e sem WebRTC,
// com a mesma animação em tela cheia. Compara o capturador do Chromium do Edge com o do Electron.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const b = await puppeteer.launch({ executablePath: EDGE, headless: false, defaultViewport: null, args: ['--kiosk', '--auto-select-desktop-capture-source=Entire screen', '--use-fake-ui-for-media-stream', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--user-data-dir=' + process.cwd() + '/.testdata-diag-edge', pathToFileURL(path.resolve('scripts/fps-diag-anim.html')).href] });
try {
  await sleep(2500);
  const p = (await b.pages()).find(x => x.url().includes('fps-diag-anim')); await p.bringToFront();
  console.log('Edge', await b.version());
  const cdp = await p.createCDPSession();
  const ev = async (expression) => { const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  for (const fps of [30, 60, 120, 240]) {
    const r = await ev(`(async () => {
      const a0 = window.__anim.n, ta = performance.now();
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: ${fps}, max: ${fps} } }, audio: false });
      const tr = s.getVideoTracks()[0], st = tr.getSettings(), ts = [];
      const rd = new MediaStreamTrackProcessor({ track: tr }).readable.getReader(); let go = true;
      (async () => { while (go) { const x = await rd.read(); if (x.done) break; ts.push(performance.now()); x.value.close(); } })();
      const t0 = performance.now() + 1500; await new Promise(r => setTimeout(r, 11500)); const t1 = performance.now(); go = false; tr.stop();
      const w = ts.filter(t => t >= t0 && t <= t1), iv = []; for (let i = 1; i < w.length; i++) iv.push(w[i] - w[i - 1]); iv.sort((a, b) => a - b);
      return { surface: st.displaySurface, w: st.width, h: st.height, fps: +(w.length / ((t1 - t0) / 1000)).toFixed(1), ivMed: +iv[Math.floor(iv.length / 2)].toFixed(1), ivP95: +iv[Math.floor(iv.length * .95)].toFixed(1), src: +((window.__anim.n - a0) / ((performance.now() - ta) / 1000)).toFixed(1) };
    })()`).catch(e => ({ erro: e.message }));
    console.log(' ', 'pedido', fps, JSON.stringify(r)); await sleep(800);
  }
} finally { await b.close(); }
process.exit(0);
