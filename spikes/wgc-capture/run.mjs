// Executa o Spike A contra a animação de 144 fps em tela cheia (scripts/fps-diag-anim.html).
// Uso: node spikes/wgc-capture/run.mjs [secs]   (executável: spikes/wgc-capture/target/release/wgc-capture-spike.exe)
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { animToFront } from '../../scripts/fps-diag-front.mjs';
import { pathToFileURL } from 'node:url';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const EXE = path.resolve('spikes/wgc-capture/target/release/wgc-capture-spike.exe');
const secs = process.argv[2] || '20';
const matrix = (process.env.MATRIX ? JSON.parse(process.env.MATRIX) : [
  [], ['--min-interval-ms', '0'], ['--min-interval-ms', '1'], ['--min-interval-ms', '4'], ['--min-interval-ms', '8'],
  ['--min-interval-ms', '0', '--cursor', '0'], ['--min-interval-ms', '0', '--border', '0'],
]);
const b = await puppeteer.launch({ executablePath: EDGE, headless: false, defaultViewport: null, ignoreDefaultArgs: ['--enable-automation'], args: [...(process.env.ANIM_MODE === 'app' ? ['--app=' + pathToFileURL(path.resolve('scripts/fps-diag-anim.html')).href, '--start-maximized'] : ['--kiosk']), '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--user-data-dir=' + process.cwd() + '/.testdata-diag-a', pathToFileURL(path.resolve('scripts/fps-diag-anim.html')).href] });
const out = [];
try {
  await sleep(2500);
  const A = (await b.pages()).find(p => p.url().includes('fps-diag-anim')); await A.bringToFront(); animToFront(); await sleep(800);
  const src = async () => { const a = await A.evaluate(() => ({ n: window.__anim.n, t: performance.now() })); await sleep(2000); const c = await A.evaluate(() => ({ n: window.__anim.n, t: performance.now() })); return Math.round((c.n - a.n) / ((c.t - a.t) / 1000) * 10) / 10; };
  console.log('fonte (rAF da animação):', await src(), 'fps');
  for (const args of matrix) {
    const s0 = await A.evaluate(() => ({ n: window.__anim.n, t: performance.now() }));
    const line = execFileSync(EXE, ['--secs', secs, ...args], { encoding: 'utf8' }).trim();
    const s1 = await A.evaluate(() => ({ n: window.__anim.n, t: performance.now() }));
    const ls = line.split(String.fromCharCode(10)).map(x => x.trim()).filter(Boolean); const r = Object.assign({}, ...ls.map(l => JSON.parse(l))); r.args = args.join(' '); r.sourceFps = Math.round((s1.n - s0.n) / ((s1.t - s0.t) / 1000) * 10) / 10;
    out.push(r);
    if (process.env.SERIES) console.log('  série:', JSON.stringify(r.series));
    console.log(`${(r.args || '(padrão)').padEnd(34)} média ${r.meanFps} fps | por segundo min ${r.perSecMin} p5 ${r.perSecP5} med ${r.perSecMedian} max ${r.perSecMax} | intervalo med ${r.ivMedMs} p95 ${r.ivP95Ms} max ${r.ivMaxMs} ms | fonte ${r.sourceFps} | únicos ${r.uniqueFps} dup ${r.duplicateFrames} fonte-span ${r.sourceFramesSpanFps} | minUpdate: ${r.minUpdateInterval} borda: ${r.border}`);
    await sleep(1500);
  }
  fs.mkdirSync('.testshots', { recursive: true }); fs.writeFileSync(process.env.OUT || '.testshots/spike-a.json', JSON.stringify(out, null, 1));
} finally { await b.close(); }
process.exit(0);
