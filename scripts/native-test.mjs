// Transmissão nativa (Spike B) sem Windows: ffmpeg gera H.264 a 120 fps (no lugar da captura + placa de vídeo), o
// programa de teste (spikes/native-stream, compilado para Linux) empacota em RTP e manda para o PlainTransport do
// servidor; o app (navegador) abre o teste em Configurações > Transmissão, gera o código e mede os FPS recebidos.
// Uso: node scripts/native-test.mjs   (H=720|1080, FPS=120, SECS=12; SHOTS=1 salva capturas em .testshots/native)
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3241, BASE = `http://localhost:${PORT}`, OUT = '.testshots/native';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const H = +(process.env.H || 720), W = Math.round(H * 16 / 9), FPS = +(process.env.FPS || 120), SECS = +(process.env.SECS || 12);
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
execFileSync('cargo', ['build', '--release', '--quiet'], { cwd: 'spikes/native-stream', stdio: 'inherit' });
const BIN = 'spikes/native-stream/target/release/transmitir';
fs.rmSync('.testdata13', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata13', RTC_PORT: '41000', RTC_IPS: '127.0.0.1', RTC_NATIVE_PORTS: '41001-41005' }, stdio: ['ignore', 'pipe', 'inherit'] });
let srvOut = ''; srv.stdout.on('data', d => (srvOut += d));
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().then(j => ({ status: r.status, ...j })));
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function page(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
let tx = null, ff = null;
try {
  const a = await reg('alice'), b = await reg('bruno');
  ok((await call(a.tok, 'POST', '/native-screen')).status === 400, 'fora de uma sala de voz: recusado');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Nativo' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(b.tok, 'POST', '/invites/' + inv);
  const A = await page(a.tok), B = await page(b.tok);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) {
    await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 15000 });
  }
  await A.evaluate(() => window.__lc.openSettings('stream')); await sleep(400);
  await A.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent === 'Abrir teste').click()); await sleep(300);
  await A.evaluate(() => [...document.querySelectorAll('.ntest button')].find(x => /Gerar código/.test(x.textContent)).click());
  await A.waitForSelector('.ntcode code', { timeout: 8000 });
  const code = await A.evaluate(() => document.querySelector('.ntcode code').textContent);
  ok(/^LC120 \S+ 4100[1-5] \d+ 102$/.test(code), 'código gerado com host, porta da faixa nativa, ssrc e payload', code);
  // bruno (outra pessoa na sala) é avisado do novo producer de tela
  // fonte: ffmpeg (H.264 baseline com AUD) -> programa de teste -> RTP
  ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-profile:v', 'baseline',
    '-x264-params', `aud=1:keyint=${FPS * 2}`, '-b:v', H >= 1080 ? '16M' : '8M', '-f', 'h264', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
  tx = spawn(BIN, ['--code', code, '--secs', String(SECS), '--fps', String(FPS)], { stdio: ['pipe', 'pipe', 'pipe'] });
  ff.stdout.pipe(tx.stdin); ff.stdout.on('error', () => { }); tx.stdin.on('error', () => { });
  let txOut = '', txErr = ''; tx.stdout.on('data', d => (txOut += d)); tx.stderr.on('data', d => (txErr += d));
  await A.waitForFunction(() => +document.querySelector('.ntbig b')?.textContent > 0, { timeout: 15000 }).catch(() => { });
  if (process.env.SHOTS) { await sleep(3000); await A.screenshot({ path: `${OUT}/01-medindo.png` }); }
  const seen = await B.waitForFunction((uid) => !!window.__lc.voice.peers.get(uid)?.streams?.screen, { timeout: 8000 }, a.id).then(() => true, () => false);
  ok(seen, 'outra pessoa na sala recebe a transmissão nativa como tela');
  await new Promise(r => tx.on('exit', r)); ff.kill();
  const sum = JSON.parse(txOut.trim().split('\n').filter(l => l.startsWith('{')).pop() || '{}');
  ok(sum.sentFps > FPS * 0.95, `programa enviou ~${FPS} fps`, { sentFps: sum.sentFps, mbps: sum.mbps, nacks: sum.nacks });
  await A.waitForFunction(() => !!window.__lcNativeResult, { timeout: 15000 }).catch(() => { });
  const res = await A.evaluate(() => window.__lcNativeResult || '');
  console.log(res.split('\n').map(l => '      ' + l).join('\n'));
  const rx = +(res.match(/Recebidos:\s+média ([\d,]+)/)?.[1] || '0').replace(',', '.'), dec = +(res.match(/Decodificados:\s+média ([\d,]+)/)?.[1] || '0').replace(',', '.');
  ok(rx > FPS * 0.9, `app recebeu ~${FPS} fps pelo servidor`, rx);
  ok(dec > FPS * 0.85, 'e decodificou quase todos', dec);
  ok(/Copiar resultado/.test(await A.evaluate(() => document.querySelector('.ntcode').textContent)), 'fim do teste: botão "Copiar resultado"');
  if (process.env.SHOTS) await A.screenshot({ path: `${OUT}/02-resultado.png` });
  ok((await call(a.tok, 'POST', '/native-screen/stop')).ok, 'parar é idempotente');
} catch (e) { console.log('ERRO', e); fails++; }
finally { tx?.kill(); ff?.kill(); await browser.close(); srv.kill(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
