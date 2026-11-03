// Capturas do chat (DM larga e estreita): "digitando…", mensagens em sequência e o campo de texto crescido.
// Uso: BROWSER=... OUT=pasta node scripts/chat-shots.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3291, BASE = `http://localhost:${PORT}`, OUT = process.env.OUT || '.testshots/chat';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata-chat', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-chat' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox'] });
async function page(tok, w, hh) { const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: w, height: hh, deviceScaleFactor: 2 }); p.on('pageerror', e => console.log('PAGEERROR', e.message)); await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok); await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p; }
try {
  const a = await reg('sploters'), b = await reg('amigo');
  await call(a.tok, 'POST', '/relationships', { username: 'amigo' }); await call(b.tok, 'PUT', `/relationships/${a.id}`, {});
  const dm = await call(a.tok, 'POST', '/dms', { user_id: b.id });
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Turma' }); const code = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code; await call(b.tok, 'POST', '/invites/' + code);
  const gg = await call(a.tok, 'GET', `/guilds/${g.id}`); const tc = (gg.channels || []).find(c => c.type === 0) ;
  const cid = dm.id;
  const msgs = [[b,'opa, bora jogar hoje?'],[a,'bora'],[a,'que horas?'],[b,'umas 21h'],[b,'chama o resto da galera'],[b,'vou abrir a sala de voz já já'],[a,'fechou'],[a,'sim senhor'],[a,'não tá ficando nem verde, olha isso aqui que texto comprido pra ver como quebra a linha quando a mensagem é maior que a largura da tela do chat']];
  for (const [u, t] of msgs) { await call(u.tok, 'POST', `/channels/${cid}/messages`, { content: t }); await sleep(30); }
  const pb = await page(b.tok, 1100, 700);
  for (const [name, w, hh] of [['dm-largo', 1280, 720], ['dm-estreito', 700, 500]]) {
    const p = await page(a.tok, w, hh);
    await p.evaluate((c) => window.__lc.go('@me', c), cid); await sleep(800);
    await pb.evaluate((c) => window.__lc.go('@me', c), cid); await sleep(500);
    await pb.focus('#composer textarea'); await pb.keyboard.type('digitando'); await sleep(1200);
    await p.screenshot({ path: `${OUT}/${name}.png` }); console.log(name);
    // texto comprido no campo: a última mensagem tem que continuar visível
    await p.focus('#composer textarea'); for (let i = 0; i < 4; i++) { await p.keyboard.type('linha ' + i); await p.keyboard.down('Shift'); await p.keyboard.press('Enter'); await p.keyboard.up('Shift'); }
    await sleep(400);
    const gap = await p.evaluate(() => { const b = document.getElementById('msgs'); return b.scrollHeight - b.scrollTop - b.clientHeight; });
    console.log('  distância do fim com o campo crescido:', gap);
    await p.screenshot({ path: `${OUT}/${name}-campo-grande.png` });
    await pb.evaluate(() => { const t = document.querySelector('#composer textarea'); t.value = ''; });
  }
} catch (e) { console.log('ERRO', e); }
finally { await browser.close(); srv.kill(); setTimeout(() => process.exit(0), 300); }
