// Painel "Ativo agora" (lado direito dos Amigos): o que os amigos fazem AGORA no topo e os destaques da semana embaixo.
// O histórico é gravado direto no banco (dias anteriores) com o servidor parado; depois o servidor sobe e o painel é conferido.
// Uso: BROWSER=/caminho/do/chrome node scripts/activepanel-test.mjs   (SHOTS=1 salva capturas em .testshots/)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const PORT = 3281, BASE = `http://localhost:${PORT}`, DATA = './.testdata-panel';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
let srv;
const start = async () => { srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', TZ: 'America/Sao_Paulo' }, stdio: 'ignore' }); for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); return; } catch { await sleep(200); } } };
const stop = () => new Promise(r => { srv.once('exit', r); srv.kill(); });
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id, n }; };

await start();
const U = {}; for (const n of ['eu', 'ana', 'beto', 'caio', 'zeca']) U[n] = await reg(n);
for (const n of ['ana', 'beto', 'caio']) { await call(U.eu.tok, 'POST', '/relationships', { username: n }); await call(U[n].tok, 'PUT', '/relationships/' + U.eu.id, {}); }
const g = await call(U.eu.tok, 'POST', '/guilds', { name: 'Turma' }); const code = (await call(U.eu.tok, 'POST', `/guilds/${g.id}/invites`)).code;
for (const n of ['ana', 'beto', 'caio', 'zeca']) await call(U[n].tok, 'POST', '/invites/' + code);
await call(U.caio.tok, 'PATCH', '/activity/pc', { visibility: 'off' }); // caio esconde o que joga
await stop();

// ---- histórico (dias anteriores) ----
const db = new DatabaseSync(DATA + '/resenha.db'), D = 864e5, H = 3600e3, now = Date.now();
const day = (n, hour = 21) => { const d = new Date(now - n * D); d.setHours(hour, 0, 0, 0); return Math.min(d.getTime(), now - 60e3); };
let nid = 1; const ins = (uid, kind, game, title, at, data, platform = 'pc') => db.prepare('INSERT INTO activities(id,user_id,platform,kind,game_id,title,data,created_at) VALUES(?,?,?,?,?,?,?,?)').run('t' + nid++, uid, platform, kind, game, title, data ? JSON.stringify(data) : null, at);
const session = (uid, game, title, at, secs, platform, extra = null) => { ins(uid, 'game_start', game, title, at - secs * 1000, extra, platform); ins(uid, 'game_stop', game, title, at, { seconds: secs, ...extra }, platform); };
session(U.ana.id, 'peak', 'PEAK', now - 20 * D, 3600);                       // histórico antigo (fora da semana)
session(U.ana.id, 'hades', 'Hades', day(2, 23), 4 * 3600 + 20 * 60);          // jogo novo + maratona
for (const n of [1, 3, 4, 6]) session(U.beto.id, 'cs2', 'Counter-Strike 2', day(n, 22), 45 * 60, 'pc', { steam: '730' }); // sequência + partidas (jogo da Steam)
session(U.beto.id, 'peak', 'PEAK', day(1, 15), 10 * 60);                       // curtinha: não é destaque
session(U.caio.id, 'eldenring', 'ELDEN RING', day(1, 20), 5 * 3600);            // caio escondeu: não aparece
session(U.zeca.id, 'dota2', 'Dota 2', day(1, 20), 6 * 3600);                    // não é amigo: não aparece
const ch = db.prepare('SELECT id FROM channels WHERE guild_id=? AND type=0').get(g.id);
db.prepare('INSERT INTO clips(id,guild_id,channel_id,message_id,author_id,streamer_id,title,url,size,secs,has_audio,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
  .run('clip1', g.id, ch.id, null, U.ana.id, U.beto.id, 'Ace no último round', '/files/aaaaaaaaaaaaaaaaaaaaaaaa.webm/x.webm', 1000, 30, 1, day(0, Math.max(0, new Date().getHours() - 1)));
db.close();
await start();

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
async function page(u, game, w = 1440) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: w, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', u.n, e.message); fails++; });
  await p.evaluateOnNewDocument((t, game) => { localStorage.lc_token = t; if (game) window.lcDesktop = { isDesktop: true, detectGame: async () => game, setSettings: async () => true, getSettings: async () => ({}), onHotkey: () => { }, setBadge: () => { }, setThrottle: () => { } }; }, u.tok, game);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p;
}
try {
  const ana = await page(U.ana, { id: 'valorant-win64-shipping', title: 'VALORANT' });
  await sleep(3800);
  const me = await page(U.eu); await me.evaluate(() => window.__lc.go('@me')); await sleep(2500);
  const tabs = await me.evaluate(() => [...document.querySelectorAll('#home #topbar .tab')].map(t => t.textContent.trim()));
  ok(!tabs.includes('Atividade'), 'a aba "Atividade" saiu', tabs);
  const P = await me.evaluate(() => {
    const b = document.querySelector('#active-now');
    return { title: b?.querySelector('h3')?.textContent, caps: [...b.querySelectorAll('.an-cap')].map(e => e.textContent), play: [...b.querySelectorAll('.an-now .an-card.an-play')].map(e => e.innerText.replace(/\s+/g, ' ')),
      days: [...b.querySelectorAll('.hl-dayh')].map(e => e.textContent), items: [...b.querySelectorAll('.hl-item')].map(e => ({ k: e.className.replace('hl-item hl-', ''), t: e.querySelector('.hl-txt > span:not(.hl-tag)').textContent })) };
  });
  ok(P.title === 'Ativo agora', 'título em português: "Ativo agora"', P.title);
  ok(P.caps[0] === 'Jogando — 1' && /ana/.test(P.play[0] || '') && /VALORANT/.test(P.play[0] || ''), 'no topo, em destaque: quem está jogando agora', P.play);
  ok(P.caps.includes('Destaques da semana'), 'seção "Destaques da semana" embaixo', P.caps);
  const has = (k, re) => P.items.some(i => i.k === k && re.test(i.t));
  ok(has('marathon', /ana jogou Hades por 4h 20min/), 'maratona (3 h ou mais)', P.items);
  ok(has('new_game', /ana começou a jogar Hades/), 'jogo novo (primeira vez)');
  ok(has('streak', /beto jogou Counter-Strike 2 em 4 dias diferentes/), 'sequência (mesmo jogo em vários dias)');
  ok(P.items.filter(i => i.k === 'session' && /beto jogou Counter-Strike 2 por 45 min/.test(i.t)).length === 4, 'partidas de 30 min ou mais');
  ok(has('clip', /ana salvou um clipe da transmissão de beto: “Ace no último round”/), 'clipe salvo (com de quem era a transmissão)');
  ok(!P.items.some(i => /PEAK por 10 min/.test(i.t)), 'partida curtinha (10 min) não vira destaque');
  ok(!P.items.some(i => /caio|zeca/.test(i.t)), 'quem escondeu o jogo (caio) e quem não é amigo (zeca) não aparecem');
  ok(!P.items.some(i => /PEAK por 1h/.test(i.t)), 'nada de fora da semana');
  ok(P.days.length >= 3 && P.days[0] === 'Hoje' && P.days.includes('Ontem'), 'agrupado por dia (Hoje, Ontem, …)', P.days);
  if (process.env.SHOTS) await me.screenshot({ path: '.testshots/activepanel-wide.png' });
  // ana parou de jogar: sai do topo na hora
  await ana.close(); await sleep(1200);
  ok(await me.evaluate(() => !document.querySelector('#active-now .an-play')), 'parou de jogar: some do "agora" na hora');
  // clicar no destaque do clipe (o cartão todo) abre o player em popup, sem sair do painel
  await me.evaluate(() => document.querySelector('#active-now .hl-item.hl-clip').click()); await sleep(900);
  const clipPop = await me.evaluate(() => { const m = document.querySelector('.modal.clipmodal'); return m && { title: m.querySelector('.pttl')?.textContent, src: m.querySelector('video')?.getAttribute('src'), btns: [...m.querySelectorAll('.pbtns .btn')].map(b => b.textContent.trim()), view: window.__lc.S.view.kind }; });
  ok(clipPop?.title === 'Ace no último round' && /aaaaaaaa/.test(clipPop.src || '') && clipPop.view !== 'clips', 'clicar no clipe abre o player em popup (continua no painel)', clipPop);
  ok(clipPop?.btns.includes('Ver na galeria') && clipPop.btns.includes('Baixar'), 'popup do clipe: Ver na galeria e Baixar', clipPop?.btns);
  await me.evaluate(() => document.querySelector('.modal.clipmodal .inv-x').click()); await sleep(300);
  // clicar num destaque de jogo abre o popup do jogo (Steam: botão para a loja; amigos que jogaram)
  await me.evaluate(() => document.querySelector('#active-now .hl-item.hl-streak').click()); await sleep(900);
  const gp = await me.evaluate(() => { const m = document.querySelector('.modal.gamemodal'); return m && { title: m.querySelector('h2')?.textContent, steam: m.querySelector('a.gm-steam')?.getAttribute('href'), people: [...m.querySelectorAll('.gm-person')].map(p => p.innerText.replace(/\s+/g, ' ')) }; });
  ok(gp?.title === 'Counter-Strike 2' && gp.steam === 'https://store.steampowered.com/app/730/', 'jogo da Steam: popup com o nome e "Ver na Steam" (loja do jogo)', gp);
  ok(gp?.people.some(t => /beto/.test(t) && /3h esta semana/.test(t) && /em 4 dias/.test(t)), 'popup do jogo: quais amigos jogaram e quanto na semana', gp?.people);
  if (process.env.SHOTS) await me.screenshot({ path: '.testshots/activepanel-gamepop.png' });
  await me.evaluate(() => document.querySelector('.modal.gamemodal .gm-x').click()); await sleep(300);
  await me.evaluate(() => document.querySelector('#active-now .hl-item.hl-marathon').click()); await sleep(700);
  const gp2 = await me.evaluate(() => { const m = document.querySelector('.modal.gamemodal'); return m && { title: m.querySelector('h2')?.textContent, steam: !!m.querySelector('a.gm-steam'), ph: !!m.querySelector('.gm-ph') }; });
  ok(gp2?.title === 'Hades' && !gp2.steam && gp2.ph, 'jogo fora da Steam: popup sem botão da loja, com o ícone', gp2);
  await me.evaluate(() => document.querySelector('.modal.gamemodal .gm-x').click()); await sleep(300);
  // o nome da pessoa no destaque abre o perfil (não o popup do jogo)
  await me.evaluate(() => document.querySelector('#active-now .hl-item.hl-marathon .hl-who').click()); await sleep(600);
  ok(await me.evaluate(() => !!document.querySelector('.pcard') && !document.querySelector('.modal.gamemodal')), 'clicar no nome abre o perfil');
  await me.keyboard.press('Escape'); await sleep(300);
  // janela estreita: o painel vira gaveta
  const narrow = await page(U.eu, null, 980); await narrow.evaluate(() => window.__lc.go('@me')); await sleep(1500);
  const before = await narrow.evaluate(() => { const r = document.querySelector('#active-now').getBoundingClientRect(); return { left: Math.round(r.left), vis: getComputedStyle(document.querySelector('.an-toggle')).display }; });
  await narrow.evaluate(() => document.querySelector('.an-toggle').click()); await sleep(500);
  const after = await narrow.evaluate(() => Math.round(document.querySelector('#active-now').getBoundingClientRect().right));
  ok(before.vis !== 'none' && before.left >= 980 && after <= 981, 'janela estreita: botão abre a gaveta "Ativo agora"', { before, after });
  if (process.env.SHOTS) await narrow.screenshot({ path: '.testshots/activepanel-narrow.png' });
  await narrow.evaluate(() => document.querySelector('.an-scrim').click()); await sleep(400);
  ok(await narrow.evaluate(() => !document.querySelector('#home').classList.contains('an-open')), 'clicar fora fecha a gaveta');
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); await stop();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
