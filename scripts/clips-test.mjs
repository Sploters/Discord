// Galeria de clipes: rotas e permissões (API) e a galeria em 2 navegadores com vídeos de verdade (canvas gravado).
// Uso: node scripts/clips-test.mjs   (SHOTS=1 salva capturas em .testshots/clips)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3229, BASE = `http://localhost:${PORT}`, OUT = '.testshots/clips';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata10', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata10' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b, raw) => fetch(BASE + '/api' + p, { method: m, headers: { ...(raw ? { 'content-type': 'video/webm' } : { 'content-type': 'application/json' }), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: raw || (b ? JSON.stringify(b) : undefined) }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function page(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t;
    navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let n = 0; setInterval(() => { x.fillStyle = `hsl(${n++ % 360},60%,40%)`; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#fff'; x.font = 'bold 80px sans-serif'; x.fillText('AO VIVO ' + n, 60, 200); }, 33); return c.captureStream(30); };
  }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
// grava ~2 s de um canvas colorido com texto e envia como clipe pela rota da galeria
const makeClip = (P, cid, streamer, label, hue) => P.evaluate(async (cid, streamer, label, hue) => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); let n = 0;
  const iv = setInterval(() => { x.fillStyle = `hsl(${(hue + n * 3) % 360},60%,35%)`; x.fillRect(0, 0, 640, 360); x.fillStyle = '#fff'; x.font = 'bold 44px sans-serif'; x.fillText(label, 30, 80); x.font = '26px sans-serif'; x.fillText('quadro ' + n++, 30, 130); x.fillRect(30 + (n * 9) % 560, 250, 50, 50); }, 33);
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' }), parts = []; rec.ondataavailable = (e) => parts.push(e.data);
  rec.start(); await new Promise(r => setTimeout(r, 2000)); rec.stop(); await new Promise(r => (rec.onstop = r)); clearInterval(iv);
  const tok = localStorage.lc_token, blob = new Blob(parts, { type: 'video/webm' });
  const up = await (await fetch('/api/upload?name=clipe.webm', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'video/webm' }, body: blob })).json();
  const r = await fetch(`/api/channels/${cid}/clips`, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ url: up.url, name: up.name, size: up.size, secs: 30, streamer_id: streamer, has_audio: true }) });
  return { status: r.status, ...(await r.json()) };
}, cid, streamer, label, hue);
try {
  const a = await reg('alice'), b = await reg('bruno'), c = await reg('carla');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Jogatina' }); const code = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(b.tok, 'POST', '/invites/' + code);
  const A = await page(a.tok), B = await page(b.tok);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);

  // ---------- API ----------
  const fake = await call(b.tok, 'POST', '/upload?name=x.webm', null, Buffer.from('nao e video de verdade'));
  ok((await call(b.tok, 'POST', `/channels/${vch.id}/clips`, { url: '/files/../../etc/passwd', secs: 5 })).status === 400, 'endereço de vídeo inválido é recusado');
  ok((await call(b.tok, 'POST', `/channels/${vch.id}/clips`, { url: '/files/0123456789abcdef01234567.webm/x.webm', secs: 5 })).status === 400, 'arquivo que não existe é recusado');
  ok((await call(c.tok, 'POST', `/channels/${vch.id}/clips`, { url: fake.url, secs: 5 })).status === 404, 'quem não é do servidor não salva clipe lá');
  const c1 = await call(b.tok, 'POST', `/channels/${vch.id}/clips`, { url: fake.url, name: 'x.webm', size: fake.size, secs: 15, streamer_id: a.id });
  ok(c1.status === 200 && c1.clip.title === 'Clipe de alice' && c1.clip.streamer.id === a.id && c1.clip.author.id === b.id, 'clipe criado com título, quem clipou e de quem era a transmissão', c1.clip?.title);
  ok(c1.message?.attachments?.[0]?.url === fake.url && /Clipe de 15s da transmissão de alice/.test(c1.message.content), 'a mensagem com o vídeo é postada no chat da sala');
  ok((await call(c.tok, 'GET', `/guilds/${g.id}/clips`)).status === 403, 'quem não é do servidor não vê a galeria');
  const l1 = await call(a.tok, 'GET', `/guilds/${g.id}/clips`);
  ok(l1.total === 1 && l1.clips[0].id === c1.clip.id && l1.clips[0].fav === false, 'galeria lista o clipe para os membros');
  ok((await call(a.tok, 'PATCH', `/clips/${c1.clip.id}`, { title: 'Jogada' })).status === 200, 'dono do servidor (gerenciar mensagens) renomeia');
  ok((await call(b.tok, 'PATCH', `/clips/${c1.clip.id}`, { title: 'Minha jogada' })).title === 'Minha jogada', 'quem clipou renomeia');
  ok((await call(b.tok, 'PATCH', `/clips/${c1.clip.id}`, { title: '   ' })).status === 400, 'nome vazio é recusado');
  await call(b.tok, 'PUT', `/clips/${c1.clip.id}/fav`);
  ok((await call(b.tok, 'GET', `/guilds/${g.id}/clips?filter=fav`)).clips.length === 1 && (await call(a.tok, 'GET', `/guilds/${g.id}/clips?filter=fav`)).clips.length === 0, 'favorito é por pessoa');
  ok((await call(a.tok, 'GET', `/guilds/${g.id}/clips?filter=mine`)).clips.length === 1, '"Meus" inclui os clipes em que eu transmitia');
  ok((await call(a.tok, 'GET', `/guilds/${g.id}/clips?q=jogada`)).clips.length === 1 && (await call(a.tok, 'GET', `/guilds/${g.id}/clips?q=xyz`)).clips.length === 0, 'busca pelo nome');
  ok((await call(a.tok, 'GET', `/guilds/${g.id}/clips?q=bruno`)).clips.length === 1, 'busca pela pessoa');
  // apagar a mensagem no chat tira o clipe da galeria
  await call(b.tok, 'DELETE', `/channels/${vch.id}/messages/${c1.message.id}`);
  ok((await call(a.tok, 'GET', `/guilds/${g.id}/clips`)).total === 0, 'apagar a mensagem no chat tira o clipe da galeria');

  // ---------- navegador: galeria ----------
  const v1 = await makeClip(B, vch.id, a.id, 'Tela da Alice', 200), v2 = await makeClip(A, vch.id, b.id, 'Tela do Bruno', 20), v3 = await makeClip(B, vch.id, a.id, 'Clutch 1v3', 120);
  ok(v1.status === 200 && v2.status === 200 && v3.status === 200, 'três clipes de vídeo de verdade salvos');
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(400);
  ok(await A.evaluate(() => document.querySelector('#side-list > *')?.classList.contains('clipsrow')), 'entrada "Clipes" no topo da lista de canais');
  await A.evaluate(() => document.querySelector('#side-list .clipsrow').click());
  await A.waitForSelector('#clipsview .clipcard', { timeout: 5000 }).catch(() => { });
  const cards = await A.evaluate(() => [...document.querySelectorAll('#clipsview .clipcard .ctitle')].map(x => x.textContent));
  ok(JSON.stringify(cards) === JSON.stringify(['Clipe de alice', 'Clipe de bruno', 'Clipe de alice']), 'galeria mostra os clipes, mais novos primeiro', cards);
  ok(await A.evaluate(() => /3 clipes em Jogatina/.test(document.querySelector('#clipsview #topbar').textContent)), 'cabeçalho com a contagem');
  ok(await A.evaluate(() => [...document.querySelectorAll('#clipsview .cthumb video')].every(v => v.poster && !v.getAttribute('src'))), 'galeria mostra miniaturas sem baixar os vídeos');
  if (process.env.SHOTS) { await sleep(800); await A.screenshot({ path: `${OUT}/01-galeria.png` }); }
  // ao vivo: bruno salva outro clipe e ele aparece na galeria aberta da alice
  await makeClip(B, vch.id, a.id, 'Ace!', 300);
  ok(await A.waitForFunction(() => document.querySelectorAll('#clipsview .clipcard').length === 4, { timeout: 5000 }).then(() => true, () => false), 'clipe novo aparece na hora na galeria aberta');
  // player com anterior/próximo
  await A.evaluate(() => document.querySelector('#clipsview .clipcard .cthumb').click()); await sleep(1200);
  const pl = await A.evaluate(() => ({ t: document.querySelector('.clipplayer .pttl')?.textContent, playing: !document.querySelector('.clipplayer video')?.paused, prev: document.querySelector('.clipplayer .pnav.prev')?.disabled }));
  ok(pl.t === 'Clipe de alice' && pl.prev === true, 'player abre no clipe clicado (anterior desativado no primeiro)', pl);
  await A.keyboard.press('ArrowRight'); await sleep(400);
  ok(await A.evaluate(() => document.querySelector('.clipplayer .pttl')?.textContent) === 'Clipe de alice' && await A.evaluate(() => /clipado por alice/.test(document.querySelector('.clipplayer .pmeta').textContent)) === false, 'seta → vai para o próximo');
  await A.keyboard.press('ArrowRight'); await sleep(300);
  ok(/clipado por alice/.test(await A.evaluate(() => document.querySelector('.clipplayer .pmeta').textContent)), 'próximo de novo: clipe da alice (de bruno)');
  if (process.env.SHOTS) { await sleep(600); await A.screenshot({ path: `${OUT}/02-player.png` }); }
  // tela cheia: é a caixa em volta do vídeo que entra em tela cheia (a do próprio <video> deixava a imagem escura em alguns PCs)
  ok(await A.evaluate(() => document.querySelector('.clipplayer video').getAttribute('controlslist')?.includes('nofullscreen')), 'botão nativo de tela cheia do vídeo escondido');
  await A.evaluate(() => document.querySelector('.clipplayer .fsvbtn').click()); await sleep(600);
  const fs1 = await A.evaluate(() => { const e = document.fullscreenElement, v = e?.querySelector('video'); return { box: e?.classList.contains('fsvid'), w: v && Math.round(v.getBoundingClientRect().width), W: innerWidth }; });
  ok(fs1.box && fs1.w === fs1.W, 'tela cheia é da caixa e o vídeo ocupa a tela toda', fs1);
  if (process.env.SHOTS) await A.screenshot({ path: `${OUT}/02b-tela-cheia.png` });
  await A.evaluate(() => document.exitFullscreen()); await sleep(400);
  // sem rodapé (.mf), cabe na tela com folga embaixo, e o lápis renomeia ali mesmo
  const lay = await A.evaluate(() => { const m = document.querySelector('.modal.clipmodal'), r = m.getBoundingClientRect(), mb = m.querySelector('.mb'); return { mf: !!m.querySelector('.mf'), fits: r.bottom <= innerHeight - 8, scroll: mb.scrollHeight > mb.clientHeight + 1, pad: parseFloat(getComputedStyle(mb).paddingBottom) }; });
  ok(!lay.mf && lay.fits && !lay.scroll && lay.pad >= 20, 'player sem rodapé, cabe na tela sem rolar e com margem embaixo', lay);
  if (process.env.SHOTS) await A.screenshot({ path: `${OUT}/02c-player.png` });
  await A.evaluate(() => document.querySelector('.clipplayer .pedit').click()); await sleep(150);
  await A.keyboard.down('Control'); await A.keyboard.press('KeyA'); await A.keyboard.up('Control');
  await A.keyboard.type('Jogada renomeada'); await A.keyboard.press('Enter');
  await A.waitForFunction(() => document.querySelector('.clipplayer .pttl')?.textContent === 'Jogada renomeada', { timeout: 4000 }).catch(() => { });
  const rn = await A.evaluate(() => ({ t: document.querySelector('.clipplayer .pttl')?.textContent, input: !!document.querySelector('.clipplayer .pttlin'), card: [...document.querySelectorAll('#clipsview .ctitle')].some(x => x.textContent === 'Jogada renomeada') }));
  ok(rn.t === 'Jogada renomeada' && !rn.input && rn.card, 'lápis no título renomeia no próprio player (e a galeria atualiza)', rn);
  await A.evaluate(() => document.querySelector('.modal.clipmodal .inv-x').click()); await sleep(300);
  ok(!(await A.evaluate(() => !!document.querySelector('.clipplayer'))), 'X do topo fecha o player');
  // favoritar e aba Favoritos
  await A.evaluate(() => document.querySelectorAll('#clipsview .clipcard .cbtns button')[0].click()); await sleep(500);
  await A.evaluate(() => [...document.querySelectorAll('#clipsview .ctab')].find(x => x.textContent === 'Favoritos').click());
  await A.waitForFunction(() => document.querySelectorAll('#clipsview .clipcard').length === 1, { timeout: 4000 }).catch(() => { });
  ok(await A.evaluate(() => document.querySelectorAll('#clipsview .clipcard').length) === 1, 'favoritar e ver na aba Favoritos');
  await A.evaluate(() => [...document.querySelectorAll('#clipsview .ctab')].find(x => x.textContent === 'Todos').click()); await sleep(600);
  // busca
  await A.type('#clipsview .csearch', 'bruno'); await sleep(900);
  ok(await A.evaluate(() => document.querySelectorAll('#clipsview .clipcard').length) >= 1 && await A.evaluate(() => document.activeElement?.classList.contains('csearch')), 'busca filtra sem perder o foco do campo');
  await A.evaluate(() => { const s = document.querySelector('#clipsview .csearch'); s.value = ''; s.dispatchEvent(new Event('input')); }); await sleep(800);
  // renomear pelo menu (alice é dona do servidor)
  const firstId = await A.evaluate(() => document.querySelector('#clipsview .clipcard').dataset.id);
  await call(a.tok, 'PATCH', `/clips/${firstId}`, { title: 'Ace do Bruno' });
  ok(await B.evaluate(async (gid) => { window.__lc.go(gid, 'clips'); await new Promise(r => setTimeout(r, 1200)); return document.querySelector('#clipsview .clipcard .ctitle')?.textContent; }, g.id) === 'Ace do Bruno', 'novo nome aparece para todos');
  // apagar pela galeria: some para os dois, a mensagem sai do chat e o arquivo é removido
  const url = (await call(a.tok, 'GET', `/guilds/${g.id}/clips`)).clips.find(x => x.id === firstId).url;
  ok((await fetch(BASE + url)).status === 200, 'vídeo acessível antes de apagar');
  ok((await call(c.tok, 'DELETE', `/clips/${firstId}`)).status === 404, 'quem não é do servidor não apaga');
  await call(b.tok, 'DELETE', `/clips/${firstId}`);
  ok(await A.waitForFunction((id) => !document.querySelector(`#clipsview .clipcard[data-id="${id}"]`), { timeout: 4000 }, firstId).then(() => true, () => false), 'apagado some da galeria aberta de outra pessoa');
  await sleep(300); ok((await fetch(BASE + url)).status === 404, 'arquivo do vídeo removido do servidor');
  // chat da sala: a mensagem do clipe com o vídeo
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(1000);
  ok(await A.evaluate(() => document.querySelectorAll('#msgs .clipmsg, #chat .clipmsg').length) >= 2, 'clipes continuam no chat da sala (cartão leve)');
  // de ponta a ponta: alice transmite, bruno assiste e salva os últimos 5 s pelo menu de clipes
  for (const P of [A, B]) {
    await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 15000 });
  }
  await A.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(x => x.title.includes('Transmitir')).click()); await sleep(800);
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /Transmitir/.test(x.textContent)).click());
  await B.waitForFunction((u) => !!document.querySelector(`.tile.cstream[data-key="s:${u}"] .btn`), { timeout: 15000 }, a.id);
  await B.evaluate((u) => document.querySelector(`.tile.cstream[data-key="s:${u}"] .btn`).click(), a.id);
  await B.waitForFunction((u) => document.querySelector(`.tile.screen[data-sid="${u}"] video`)?.videoWidth > 0, { timeout: 15000 }, a.id);
  await sleep(7000); // o buffer de clipes junta alguns segundos
  const before = (await call(a.tok, 'GET', `/guilds/${g.id}/clips`)).total;
  await B.evaluate(() => [...document.querySelectorAll('.tctl button')].find(x => x.title === 'Clipes')?.click()); await sleep(300);
  await B.evaluate(() => [...document.querySelectorAll('.menu .it')].find(x => /últimos 5s/.test(x.textContent))?.click());
  let real = null; for (let i = 0; i < 40 && !real; i++) { await sleep(500); const l = await call(a.tok, 'GET', `/guilds/${g.id}/clips`); if (l.total > before) real = l.clips[0]; }
  ok(real && real.streamer?.id === a.id && real.author.id === b.id && real.secs === 5 && /^alice — \d\d\/\d\d \d\d:\d\d$/.test(real.title), 'botão de clipe da transmissão salva na galeria com nome distinto', real && { t: real.title, secs: real.secs });
  ok(real && (await fetch(BASE + real.url)).headers.get('content-length') > 10000, 'vídeo do clipe real foi enviado', real && (await fetch(BASE + real.url)).headers.get('content-length'));
  await B.evaluate(() => window.__lc.voice?.leave()); await A.evaluate(() => window.__lc.voice?.leave()); await sleep(500);

  // galeria vazia
  const g2 = await call(a.tok, 'POST', '/guilds', { name: 'Vazio' }); await sleep(400);
  await A.evaluate((gid) => window.__lc.go(gid, 'clips'), g2.id); await sleep(800);
  ok(await A.evaluate(() => /Nenhum clipe ainda/.test(document.querySelector('#clipsview .cempty')?.textContent || '')), 'servidor sem clipes mostra a explicação');
  if (process.env.SHOTS) await A.screenshot({ path: `${OUT}/03-vazia.png` });
} catch (err) { console.log('  ERRO', err); fails++; }
await browser.close(); srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
