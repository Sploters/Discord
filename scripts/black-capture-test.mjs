// Testa o aviso de captura preta: um stream 100% preto dispara o aviso; um stream com imagem o desliga. Sem tela real nem Electron.
import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
fs.rmSync('.testdata-black', { recursive: true, force: true });
const PORT = 3225, BASE = `http://localhost:${PORT}`;
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', RTC: '0', DATA_DIR: './.testdata-black' }, stdio: 'ignore' });
await sleep(1800);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const p = await b.newPage(); await p.goto(BASE);
  await p.waitForSelector('#auth .card'); await p.evaluate(() => [...document.querySelectorAll('#auth a')].find(a => a.textContent.includes('Registre')).click()); await sleep(200);
  await p.evaluate(() => { const i = document.querySelectorAll('#auth input'); i[0].value = 'tester'; i[2].value = 'senha123'; i[3].value = 'senha123'; });
  await p.click('#auth .btn'); await p.waitForSelector('#rail .rail-wrap', { timeout: 8000 });
  // streams de teste por canvas (redesenhados continuamente para o vídeo ter quadros)
  await p.evaluate(() => {
    const mk = (paint) => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d'); setInterval(() => paint(x), 50); paint(x); return c.captureStream(20); };
    window.__black = mk(x => { x.fillStyle = '#000'; x.fillRect(0, 0, 320, 180); });
    window.__dark = mk(x => { x.fillStyle = '#000'; x.fillRect(0, 0, 320, 180); x.fillStyle = '#303030'; x.fillRect(100, 60, 120, 60); }); // quase preto, mas com conteúdo
    window.__color = mk(x => { x.fillStyle = '#3a7'; x.fillRect(0, 0, 320, 180); });
    window.__events = []; window.__lc.voice.onBlackCapture = (v) => window.__events.push(v);
  });
  const st = () => p.evaluate(() => ({ black: window.__lc.voice.captureBlack, ev: window.__events.slice() }));
  await p.evaluate(() => { const v = window.__lc.voice; v.screen = window.__black; v.meterBlack(); });
  await sleep(4500); ok(!(await st()).black, 'não avisa antes de ~6 s de preto');
  await sleep(4000); let s = await st(); ok(s.black === true, 'aviso ligado após ~6 s de preto absoluto'); ok(s.ev.join() === 'true', 'callback onBlackCapture(true) chamado uma vez');
  await p.evaluate(() => { window.__lc.voice.screen = window.__color; });
  await sleep(4600); s = await st(); ok(s.black === false, 'aviso desligado quando volta a ter imagem'); ok(s.ev.join() === 'true,false', 'callback onBlackCapture(false) chamado');
  await p.evaluate(() => { const v = window.__lc.voice; v.screen = window.__dark; v.meterBlack(); });
  await sleep(9000); s = await st(); ok(s.black === false, 'cena escura com conteúdo (cinza #303030) NÃO dispara o aviso');
  await p.evaluate(() => { window.__lc.voice.screen = null; }); await sleep(2600);
  ok((await st()).black === false, 'sem transmissão, aviso desligado');
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
console.log(fails ? `\n${fails} FALHA(S)` : '\nCAPTURA PRETA OK');
await b.close(); try { execSync(`taskkill /pid ${srv.pid} /T /F`, { stdio: 'ignore' }); } catch { }
process.exit(fails ? 1 : 0);
