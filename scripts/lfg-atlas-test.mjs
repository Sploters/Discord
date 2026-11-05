// Procurar jogadores + LFG Atlas, com um LFG Atlas FALSO local (anúncios fictícios): "Em outros sites" filtrado para
// Brasil/América do Sul, "Todas as regiões", publicar também lá (campos traduzidos, contato público) e tirar de lá ao
// encerrar ou quando o grupo fecha.
// Uso: node scripts/lfg-atlas-test.mjs   (prints em .testshots/lfg-atlas)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import http from 'node:http';
const PORT = 3237, MOCK = 4591, BASE = `http://localhost:${PORT}`, M = `http://localhost:${MOCK}`, OUT = '.testshots/lfg-atlas', DATA = './.testdata37';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const ext = [
  { id: 'x1', url: 'https://lfgatlas.pages.dev/p/?id=x1&g=valorant', game: 'valorant', game_name: 'Valorant', type: 'lfm', title: 'Duo pra subir de Ouro hoje à noite', description: 'Jogo de Controlador, call tranquila.', region: 'BR', mode: 'Competitive', rank: 'Gold', role: 'Controller', need: 1, language: 'Portuguese', mic: true, ready_now: true, contact: { kind: 'discord_user', value: 'jogador_ficticio', join_url: null }, created_at: iso(-10 * 60e3), expires_at: iso(3600e3) },
  { id: 'x2', url: 'https://lfgatlas.pages.dev/p/?id=x2&g=valorant', game: 'valorant', game_name: 'Valorant', type: 'lfm', title: 'Need 2 for Premier NA', region: 'NA', mode: 'Premier', need: 2, contact: { kind: 'discord_invite', value: 'discord.gg/fake', join_url: 'https://discord.gg/fake' }, created_at: iso(-5 * 60e3), expires_at: iso(3600e3) },
  { id: 'x3', url: 'https://lfgatlas.pages.dev/p/?id=x3&g=minecraft', game: 'minecraft', game_name: 'Minecraft', type: 'server', title: 'Servidor survival tranquilo', region: 'Any', contact: { kind: 'ingame', value: 'mc.exemplo.invalid', join_url: 'javascript:alert(1)' }, created_at: iso(-60 * 60e3), expires_at: iso(86400e3) },
];
const got = { posts: [], deletes: [] };
const mock = http.createServer((q, r) => {
  let body = ''; q.on('data', d => body += d); q.on('end', () => {
    const u = new URL(q.url, M); r.setHeader('content-type', 'application/json');
    if (q.method === 'GET' && u.pathname === '/api/posts') { const g = u.searchParams.get('game'); return r.end(JSON.stringify({ posts: [...ext, ...got.posts.map(p => p.out)].filter(p => !g || p.game === g) })); }
    if (q.method === 'POST' && u.pathname === '/api/posts') { const b = JSON.parse(body), id = 'lc' + (got.posts.length + 1);
      const out = { id, url: `https://lfgatlas.pages.dev/p/?id=${id}`, game: b.game, game_name: 'Valorant', title: b.title, region: b.region, contact: { kind: 'ingame', value: b.contact }, created_at: iso(0), expires_at: iso(3600e3) };
      got.posts.push({ body: b, out }); r.statusCode = 201; return r.end(JSON.stringify({ post: out, manage: { edit_token: 'tok-' + id } })); }
    if (q.method === 'DELETE') { got.deletes.push({ id: u.pathname.split('/').pop(), body: JSON.parse(body || '{}') }); return r.end('{"ok":true}'); }
    r.statusCode = 404; r.end('{}');
  });
}).listen(MOCK);
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', LFG_ATLAS_URL: M }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const a = await call('', 'POST', '/register', { username: 'alice', password: 'senha123' }), b = await call('', 'POST', '/register', { username: 'bruno', password: 'senha123' });
  await call(a.token, 'POST', '/relationships', { username: 'bruno' }); const bid = (await call(b.token, 'PATCH', '/me', {})).id, aid = (await call(a.token, 'PATCH', '/me', {})).id; await call(b.token, 'PUT', `/relationships/${aid}`, {});
  // ---------- API ----------
  const near = await call(a.token, 'GET', '/lfg/external');
  ok(near.posts.map(p => p.id).join() === 'x1,x3', 'padrão: só Brasil/América do Sul e "qualquer região" (sem o NA)', near.posts.map(p => p.id));
  ok(near.posts.find(p => p.id === 'x3').contact.join_url === null, 'link de contato que não é do Discord é descartado');
  const all = await call(a.token, 'GET', '/lfg/external?all=1');
  ok(all.posts.length === 3, '"Todas as regiões" mostra tudo', all.posts.map(p => p.id));
  const val = await call(a.token, 'GET', '/lfg/external?game=valorant');
  ok(val.posts.map(p => p.id).join() === 'x1', 'filtro por jogo', val.posts.map(p => p.id));
  ok((await call(a.token, 'POST', '/lfg/posts', { game: 'valorant', mode: 'Competitivo', slots: 2, atlas: true })).status === 400, 'publicar no LFG Atlas sem contato é recusado');
  ok((await call(a.token, 'POST', '/lfg/posts', { game: 'other', game_name: 'Jogo X', mode: 'Casual', slots: 2, atlas: true, atlas_contact: 'alice' })).status === 400, '"Outro jogo" não vai para o LFG Atlas');
  const p1 = await call(a.token, 'POST', '/lfg/posts', { game: 'valorant', mode: 'Competitivo', slots: 2, rank_min: 'Ouro', rank_max: 'Platina', roles: ['Controlador'], mic: true, note: 'call tranquila https://site.invalid', atlas: true, atlas_contact: 'Alice#BR1' });
  const sent = got.posts[0]?.body || {};
  ok(p1.status === 200 && p1.atlas?.url && !p1.atlas_error, 'anúncio publicado aqui e no LFG Atlas', { atlas: p1.atlas, err: p1.atlas_error });
  ok(sent.consent === true && sent.source === 'localcord' && sent.game === 'valorant' && sent.type === 'lfm' && sent.mode === 'Competitive' && sent.rank === 'Gold' && sent.role === 'Controller' && sent.region === 'BR' && sent.need === 2 && sent.language === 'Portuguese' && sent.contact === 'Alice#BR1', 'enviado com os campos traduzidos e o contato que a pessoa escreveu', sent);
  ok(!/https?:/.test(sent.description || ''), 'links tirados da descrição (regra do site)', sent.description);
  ok(!(await call(a.token, 'GET', '/lfg/external?all=1')).posts.some(p => p.id === 'lc1'), 'o próprio anúncio não aparece repetido em "Em outros sites"');
  const p2 = await call(a.token, 'POST', '/lfg/posts', { game: 'valorant', mode: 'Premier', slots: 1, atlas: true, atlas_contact: 'Alice#BR1' });
  await call(b.token, 'POST', `/lfg/posts/${p2.id}/request`, {}); await call(a.token, 'POST', `/lfg/posts/${p2.id}/answer`, { user_id: bid, accept: true }); await sleep(300);
  ok(got.deletes.some(d => d.id === 'lc2' && d.body.edit_token === 'tok-lc2'), 'grupo fechou: sai do LFG Atlas', got.deletes);
  // ---------- tela ----------
  const P = await (await browser.createBrowserContext()).newPage(); await P.setViewport({ width: 1366, height: 900 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, a.token);
  await P.goto(BASE + '/#/@me/lfg'); await P.waitForSelector('.lfgexthead'); await sleep(800);
  const ui = await P.evaluate(() => ({ ext: [...document.querySelectorAll('.lfgcard.ext')].map(c => c.innerText.replace(/\n+/g, ' | ')), atlasLink: !!document.querySelector('.lfgcard.mine .lfgatlas'), hrefs: [...document.querySelectorAll('.lfgcard.ext a')].map(a => a.href) }));
  ok(ui.ext.length === 2 && /Duo pra subir/.test(ui.ext[0]) && /jogador_ficticio/.test(ui.ext[0]) && /Copiar contato/.test(ui.ext[0]), '"Em outros sites" com os anúncios do Brasil, contato e botão de copiar', ui.ext);
  ok(ui.atlasLink, 'meu anúncio mostra "No LFG Atlas"');
  ok(ui.hrefs.every(h => h.startsWith('https://')), 'só links https', ui.hrefs);
  await P.evaluate(() => document.querySelector('.lfgexthead').scrollIntoView()); await sleep(300);
  await P.screenshot({ path: OUT + '/mural.png' });
  await P.evaluate(() => [...document.querySelectorAll('.lfgexthead .lchip')].find(b => /Todas/.test(b.textContent)).click()); await sleep(800);
  ok(await P.evaluate(() => document.querySelectorAll('.lfgcard.ext').length === 3 && [...document.querySelectorAll('.lfgcard.ext a.btn')].some(a => /Entrar no Discord/.test(a.textContent))), '"Todas as regiões" mostra o NA, com "Entrar no Discord"');
  await P.evaluate(() => [...document.querySelectorAll('.lfgexthead .lchip')].find(b => /Brasil/.test(b.textContent)).click());
  await P.evaluate(() => [...document.querySelectorAll('#lfgview .btn')].find(b => /Criar anúncio/.test(b.textContent)).click()); await P.waitForSelector('.lfgatlasbox');
  await P.evaluate(() => document.querySelector('.lfgatlasbox .toggle, .lfgatlasbox [role=switch], .lfgatlasbox input[type=checkbox]')?.click()); await sleep(300);
  ok(await P.evaluate(() => !!document.querySelector('input[name="lfg-atlas-contact"]')), 'criar anúncio: opção "Publicar também no LFG Atlas" pede o contato público');
  await P.evaluate(() => document.querySelector('.lfgatlasbox').scrollIntoView({ block: 'end' })); await sleep(200);
  await P.screenshot({ path: OUT + '/criar.png' });
  // encerrar o primeiro: sai de lá
  await call(a.token, 'POST', `/lfg/posts/${p1.id}/close`); await sleep(300);
  ok(got.deletes.some(d => d.id === 'lc1' && d.body.edit_token === 'tok-lc1'), 'encerrar: sai do LFG Atlas', got.deletes);
} catch (e) { console.log('ERRO', e.message); fails++; }
finally { await browser.close(); srv.kill(); mock.close(); fs.rmSync(DATA, { recursive: true, force: true }); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
