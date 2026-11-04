// Clipes no chat: os antigos (só mensagem no chat da sala) entram na galeria ao iniciar o servidor; o chat mostra um
// cartão leve com miniatura e NÃO baixa os vídeos ao abrir; o vídeo baixa só no play; a galeria mostra miniaturas e só
// baixa o vídeo ao passar o mouse. Mede quanto o navegador baixa ao abrir o chat da sala.
// Uso: node scripts/clips-chat-test.mjs   (SHOTS=1 salva capturas em .testshots/clips)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3275, BASE = `http://localhost:${PORT}`, DATA = './.testdata26', OUT = '.testshots/clips';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
let srv;
const start = async () => { srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0' }, stdio: ['ignore', 'pipe', 'inherit'] }); let out = ''; srv.stdout.on('data', d => (out += d)); for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } } return () => out; };
const call = (tok, m, p, b, raw) => fetch(BASE + '/api' + p, { method: m, headers: { ...(raw ? { 'content-type': 'video/webm' } : { 'content-type': 'application/json' }), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: raw || (b ? JSON.stringify(b) : undefined) }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
let browser; const R = {};
try {
  await start();
  const a = await call('', 'POST', '/register', { username: 'alice', password: 'senha123' });
  const g = await call(a.token, 'POST', '/guilds', { name: 'Turma' });
  browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  let P = await browser.newPage(); await P.setViewport({ width: 1440, height: 900 }); await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, a.token);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  const vch = await P.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  // 12 clipes "antigos" gravados pelo próprio app (mesmo formato dos clipes reais: sem índice interno), postados como o
  // app fazia antes da galeria: mensagem no chat da sala com o vídeo anexado
  console.log('  gravando um clipe de 12 s com o gravador do app…');
  const bytes = Buffer.from(await P.evaluate(async () => {
    const { createBuffer } = await window.__lc.import('clipbuf.js');
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); const t0 = performance.now();
    const iv = setInterval(() => { const s = (performance.now() - t0) / 1000; x.fillStyle = `hsl(${(s * 40) % 360},60%,35%)`; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#fff'; x.font = 'bold 90px sans-serif'; x.fillText(s.toFixed(1) + ' s', 60, 200); for (let k = 0; k < 40; k++) { x.fillStyle = `hsl(${k * 9},70%,50%)`; x.fillRect((k * 97 + s * 300) % 1280, (k * 53) % 720, 60, 60); } }, 33);
    const b = createBuffer(c.captureStream(30), null, {}); await new Promise(r => setTimeout(r, 12500)); clearInterval(iv);
    const blob = await b.cut(60); b.stop(); return [...new Uint8Array(await blob.arrayBuffer())];
  }));
  R.clipKB = Math.round(bytes.length / 1024);
  for (let i = 0; i < 12; i++) {
    const up = await call(a.token, 'POST', '/upload?name=' + encodeURIComponent(`clipe-15s-2000${i}.webm`), null, bytes);
    for (let k = 0; k < 20; k++) { const r = await call(a.token, 'POST', `/channels/${vch.id}/messages`, { content: '🎬 Clipe de 15s da transmissão de alice', attachments: [{ url: up.url, name: up.name, size: up.size, type: 'video/webm' }] }); if (r.status !== 429) break; await sleep(1000); } // limite anti-spam
  }
  const up2 = await call(a.token, 'POST', '/upload?name=video.webm', null, bytes);
  for (let k = 0; k < 20; k++) { const r = await call(a.token, 'POST', `/channels/${vch.id}/messages`, { content: 'olha esse vídeo', attachments: [{ url: up2.url, name: 'video.webm', size: up2.size, type: 'video/webm' }] }); if (r.status !== 429) break; await sleep(1000); }
  ok((await call(a.token, 'GET', `/guilds/${g.id}/clips`)).total === 0, 'antes: clipes antigos não estão na galeria');
  // reinicia o servidor: migração
  await P.close(); srv.kill(); await sleep(800); const log = await start();
  const l = await call(a.token, 'GET', `/guilds/${g.id}/clips`);
  ok(l.total === 12 && l.clips.every(c => c.streamer?.id && c.secs === 15 && c.title === 'Clipe de alice'), 'ao iniciar, os 12 clipes antigos entram na galeria (com quem transmitiu e duração)', { total: l.total, ex: l.clips[0] && { title: l.clips[0].title, secs: l.clips[0].secs, streamer: l.clips[0].streamer?.username } });
  ok(/12 clipe\(s\) antigo/.test(log()), 'servidor avisa a migração no log');
  srv.kill(); await sleep(800); await start();
  ok((await call(a.token, 'GET', `/guilds/${g.id}/clips`)).total === 12, 'reiniciar de novo não duplica');
  // abrir o chat da sala: conta o que o navegador baixa
  P = await browser.newPage(); await P.setViewport({ width: 1440, height: 900 }); await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, a.token);
  const got = []; const cdp = await P.createCDPSession(); await cdp.send('Network.enable');
  const urls = new Map(); cdp.on('Network.requestWillBeSent', e => urls.set(e.requestId, e.request.url)); cdp.on('Network.loadingFinished', e => got.push({ url: urls.get(e.requestId) || '', bytes: e.encodedDataLength }));
  cdp.on('Network.dataReceived', e => got.push({ url: urls.get(e.requestId) || '', bytes: e.encodedDataLength, partial: true }));
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  got.length = 0;
  await cdp.send('Performance.enable'); const pm = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const m0 = await pm();
  await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(8000);
  const m1 = await pm(); R.openChatMainThreadMs = Math.round((m1.TaskDuration - m0.TaskDuration) * 1000); R.openChatRequests = got.filter(x => !x.partial).length;
  R.videoElements = await P.evaluate(() => document.querySelectorAll('#msgs video').length); R.heapMB = +(m1.JSHeapUsedSize / 1048576).toFixed(1);
  const vids = got.filter(x => /\/files\/.*\.webm/.test(x.url)), th = got.filter(x => /\/thumbs\//.test(x.url) && !x.partial);
  const kb = (l) => Math.round(l.reduce((n, x) => n + (x.bytes || 0), 0) / 1024);
  R.openChatVideoKB = kb(vids); R.openChatThumbKB = kb(th);
  ok(vids.length === 0, 'abrir o chat da sala não baixa nenhum vídeo', { videoKB: kb(vids) });
  const cards = await P.evaluate(() => ({ n: document.querySelectorAll('#msgs .clipmsg').length, players: document.querySelectorAll('#msgs .clipmsg video').length, text: [...document.querySelectorAll('#msgs .msg .body')].some(b => /Clipe de 15s da transmissão/.test(b.textContent)), thumbs: [...document.querySelectorAll('#msgs .clipmsg img')].filter(i => i.complete && i.naturalWidth > 0).length, other: document.querySelector('#msgs .attach video')?.getAttribute('preload'), poster: !!document.querySelector('#msgs .attach video')?.poster }));
  ok(cards.n === 12 && cards.players === 0 && !cards.text, 'o chat mostra 12 cartões leves (sem player e sem o texto antigo)', cards);
  ok(cards.thumbs >= 6, 'miniaturas geradas pelo servidor aparecem', { carregadas: cards.thumbs, kB: kb(th) });
  ok(cards.other === 'none' && cards.poster, 'vídeo comum no chat: só baixa no play e tem miniatura', cards);
  if (process.env.SHOTS) await P.screenshot({ path: `${OUT}/06-chat-cartoes.png` });
  got.length = 0;
  await P.evaluate(() => [...document.querySelectorAll('#msgs .clipmsg .cmthumb')].at(-1).click()); await sleep(2500);
  ok(await P.evaluate(() => { const v = document.querySelector('#msgs .clipmsg video'); return !!v && !v.paused && v.currentTime > 0; }), 'clicar na miniatura toca o clipe ali mesmo');
  ok(got.some(x => /\/files\/.*\.webm/.test(x.url)), 'só agora o vídeo baixa');
  // galeria: miniaturas, sem baixar vídeo
  got.length = 0;
  await P.evaluate((gid) => window.__lc.go(gid, 'clips'), g.id); await sleep(3000);
  const gal = await P.evaluate(() => ({ cards: document.querySelectorAll('#clipsview .clipcard').length, posters: [...document.querySelectorAll('#clipsview .clipcard video')].filter(v => v.poster).length, src: [...document.querySelectorAll('#clipsview .clipcard video')].filter(v => v.getAttribute('src')).length }));
  ok(gal.cards === 12 && gal.posters === 12 && gal.src === 0 && !got.some(x => /\/files\/.*\.webm/.test(x.url)), 'galeria: 12 miniaturas e nenhum vídeo baixado até passar o mouse', gal);
  if (process.env.SHOTS) await P.screenshot({ path: `${OUT}/07-galeria-miniaturas.png` });
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser?.close(); srv?.kill(); fs.mkdirSync('.testshots', { recursive: true }); fs.writeFileSync('.testshots/clips-chat.json', JSON.stringify(R)); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
