// Cortar clipe: corte do WebM sem recomprimir (início no quadro-chave, fim exato, duração, toca até o fim, corta de novo)
// e o editor na galeria (arrastar a alça, salvar cópia). Uso: node scripts/cliptrim-test.mjs  (SHOTS=1: .testshots/clips)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3245, BASE = `http://localhost:${PORT}`, OUT = '.testshots/clips';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata15', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata15', RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
try {
  const r = await call('', 'POST', '/register', { username: 'alice', password: 'senha123' }); const tok = r.token;
  const g = await call(tok, 'POST', '/guilds', { name: 'Jogatina' });
  const ctx = await browser.createBrowserContext(), P = await ctx.newPage(); await P.setViewport({ width: 1440, height: 900 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  const vch = await P.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  // ~12 s gravados pelo mesmo buffer dos clipes (quadro-chave a cada 1 s), com o tempo escrito na imagem
  console.log('  gravando 12 s…');
  await P.evaluate(async () => {
    const { createBuffer } = await import('/clipbuf.js');
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); const t0 = performance.now();
    const iv = setInterval(() => { const s = (performance.now() - t0) / 1000; x.fillStyle = `hsl(${(s * 40) % 360},60%,35%)`; x.fillRect(0, 0, 640, 360); x.fillStyle = '#fff'; x.font = 'bold 64px sans-serif'; x.fillText(s.toFixed(1) + ' s', 40, 120); }, 33);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start();
    const st = c.captureStream(30); st.addTrack(d.stream.getAudioTracks()[0]);
    const b = createBuffer(st, null, { bps: 1_500_000 });
    await new Promise(r => setTimeout(r, 12500)); clearInterval(iv);
    const blob = await b.cut(60); b.stop();
    window.__orig = new Uint8Array(await blob.arrayBuffer());
  });
  // duração e reprodução de um WebM (no navegador)
  const probe = (expr) => P.evaluate(async (expr) => {
    const bytes = eval(expr); const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
    const v = document.createElement('video'); v.muted = true; v.src = url; document.body.append(v);
    await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = () => no(new Error('não abriu')); setTimeout(() => no(new Error('timeout')), 8000); });
    const dur = v.duration; let frames = 0; const cb = () => { frames++; v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb);
    v.playbackRate = 4; await v.play(); const ended = await new Promise(r => { v.onended = () => r(true); setTimeout(() => r(false), 15000); });
    v.currentTime = dur / 2; const seek = await new Promise(r => { v.onseeked = () => r(true); setTimeout(() => r(false), 4000); });
    v.remove(); URL.revokeObjectURL(url);
    return { dur: Math.round(dur * 10) / 10, ended, frames, seek };
  }, expr);
  const o = await probe('window.__orig');
  ok(o.dur >= 11 && o.dur <= 13.5 && o.ended, 'original: ~12 s e toca até o fim', o);
  const t1 = await P.evaluate(async () => { const { trimWebm, keyframeTimes } = await import('/webm.js'); const r = trimWebm(window.__orig, 4200, 9000); window.__t1 = r.bytes; return { s: r.startMs, e: r.endMs, size: r.bytes.length, orig: window.__orig.length, keys: keyframeTimes(window.__orig).length }; });
  ok(t1.s <= 4200 && t1.s >= 3000 && t1.e === 9000, 'corte 4,2–9 s: início no quadro-chave anterior (até ~1 s antes), fim exato', t1);
  ok(t1.keys >= 10, 'clipe tem quadro-chave a cada ~1 s', t1.keys);
  ok(t1.size < t1.orig * 0.65, 'arquivo cortado é menor (sem recomprimir)', { cortado: t1.size, original: t1.orig });
  const p1 = await probe('window.__t1');
  const want = (9000 - t1.s) / 1000;
  ok(Math.abs(p1.dur - want) < 0.4 && p1.ended && p1.frames > 10 && p1.seek, 'cortado: duração certa, toca até o fim e permite pular', { ...p1, esperado: want });
  const t2 = await P.evaluate(async () => { const { trimWebm } = await import('/webm.js'); const r = trimWebm(window.__t1, 1500, 3500); window.__t2 = r.bytes; return { s: r.startMs, e: r.endMs }; });
  const p2 = await probe('window.__t2');
  ok(p2.ended && Math.abs(p2.dur - (t2.e - t2.s) / 1000) < 0.4, 'cortar de novo um clipe já cortado (arquivo da galeria) funciona', { ...t2, ...p2 });
  // ---------- galeria: Cortar (cria uma cópia) ----------
  const up = await P.evaluate(async (cid) => {
    const tk = localStorage.lc_token, blob = new Blob([window.__orig], { type: 'video/webm' });
    const u = await (await fetch('/api/upload?name=clipe.webm', { method: 'POST', headers: { authorization: 'Bearer ' + tk, 'content-type': 'video/webm' }, body: blob })).json();
    return (await (await fetch(`/api/channels/${cid}/clips`, { method: 'POST', headers: { authorization: 'Bearer ' + tk, 'content-type': 'application/json' }, body: JSON.stringify({ url: u.url, name: u.name, size: u.size, secs: 12, title: 'Jogada da noite' }) })).json());
  }, vch.id);
  await P.evaluate((gid) => window.__lc.go(gid, 'clips'), g.id); await sleep(1200);
  await P.evaluate(() => document.querySelector('#clipsview .clipcard .cbtns button[title="Mais opções"]').click()); await sleep(300);
  ok(await P.evaluate(() => [...document.querySelectorAll('.menu .item, .menu button, .menu div')].some(x => /Cortar \(cria uma cópia\)/.test(x.textContent))), 'menu do clipe tem "Cortar (cria uma cópia)…"');
  await P.evaluate(() => [...document.querySelectorAll('.menu *')].find(x => x.children.length === 0 && /Cortar \(cria uma cópia\)/.test(x.textContent))?.click());
  await P.waitForSelector('.trimmer .trtrack', { timeout: 8000 });
  await P.waitForFunction(() => /Fim/.test(document.querySelector('.trimmer .trlab')?.textContent || ''), { timeout: 8000 });
  await sleep(2500); // miniaturas
  // arrasta a alça do início até ~40% e a do fim até ~75%
  const box = await P.evaluate(() => { const r = document.querySelector('.trimmer .trtrack').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
  const dragTo = async (sel, frac) => { const hb = await P.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel); await P.mouse.move(hb.x, hb.y); await P.mouse.down(); await P.mouse.move(box.x + box.w * frac, box.y, { steps: 6 }); await P.mouse.up(); };
  await dragTo('.trimmer .trhandle.s', 0.4); await dragTo('.trimmer .trhandle.e', 0.75); await sleep(400);
  const lab = await P.evaluate(() => document.querySelector('.trimmer .trlab').textContent);
  const durShown = +(lab.match(/Duração ([\d.]+) s/)?.[1] || 0);
  ok(durShown > 3 && durShown < 6, 'arrastando as alças: trecho de ~4–5 s', lab);
  if (process.env.SHOTS) await P.screenshot({ path: `${OUT}/05-cortar.png` });
  await P.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /Salvar cópia cortada/.test(x.textContent)).click());
  let list; for (let i = 0; i < 30; i++) { await sleep(300); list = await call(tok, 'GET', `/guilds/${g.id}/clips`); if (list.clips?.length === 2) break; }
  const copy = list.clips?.find(c => c.id !== up.clip?.id);
  ok(copy && copy.title === 'Jogada da noite (cortado)' && copy.secs >= 3 && copy.secs <= 6, 'cópia cortada vira um clipe novo; o original continua', copy && { title: copy.title, secs: copy.secs });
  const p3 = copy && await P.evaluate(async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); window.__t3 = b; return b.length; }, copy.url);
  const pr3 = await probe('window.__t3');
  ok(p3 && pr3.ended && Math.abs(pr3.dur - copy.secs) < 1.2, 'o arquivo salvo toca até o fim com a duração do trecho', pr3);
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
