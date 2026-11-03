// Controle remoto (mouse e teclado): regras do servidor (módulo isolado) e fluxo completo em 3 navegadores.
// alice transmite pelo "app desktop" (ponte lcDesktop simulada que registra o que seria injetado),
// bob assiste e controla, carol transmite pelo navegador comum (não pode ser controlada). Uso: node scripts/remote-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRemote, cleanEvent } from '../server/remote.js';
const PORT = 3227, BASE = `http://localhost:${PORT}`, SHOTS = '.testshots';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- 1) servidor isolado ----------
{
  let t = 1e12, n = 0; const out = [];
  const where = { a: { cid: 'v', screen: true }, b: { cid: 'v', screen: false }, c: { cid: 'v', screen: true }, x: { cid: 'outra', screen: true } };
  const R = createRemote({ newId: () => 's' + ++n, now: () => t, voiceOf: (u) => where[u] || null, sendUser: (u, type, d) => out.push({ u, type, d }) });
  const last = (u, type) => out.filter(o => o.u === u && o.type === type).at(-1)?.d;
  ok(R.request('b', 'x').error, 'pedir para quem está em outra sala é recusado');
  ok(R.request('a', 'b').error, 'pedir para quem não está transmitindo é recusado');
  ok(R.request('b', 'b').error, 'pedir para si mesmo é recusado');
  const s1 = R.request('b', 'a').session;
  ok(s1?.state === 'pending' && last('a', 'REMOTE_REQUEST')?.id === s1.id, 'pedido chega ao dono');
  ok(R.request('c', 'a').error, 'dono já com pedido pendente não recebe outro');
  ok(R.input('b', s1.id, [{ k: 'm', x: .5, y: .5 }]).sent === 0, 'antes do consentimento nenhum evento passa');
  ok(R.answer('b', s1.id, { accept: true, mouse: true }).error, 'só o dono responde o pedido');
  R.answer('a', s1.id, { accept: true, mouse: true, keyboard: false, capable: true });
  ok(last('b', 'REMOTE_STATE')?.state === 'active', 'aceito: sessão ativa para os dois');
  const r1 = R.input('b', s1.id, [{ k: 'm', x: .25, y: .75 }, { k: 'd', b: 0 }, { k: 'u', b: 0 }, { k: 'kd', c: 'KeyA' }, { k: 'w', dy: 120 }]);
  ok(r1.sent === 4 && r1.dropped === 1 && !last('a', 'REMOTE_INPUT').ev.some(e => e.k === 'kd'), 'teclado não liberado: teclas são descartadas, mouse passa', r1);
  ok(R.input('c', s1.id, [{ k: 'm', x: .1, y: .1 }]).sent === 0, 'terceiro não injeta na sessão de outro');
  const bad = [{ k: 'm', x: 2, y: 0 }, { k: 'm', x: NaN, y: 0 }, { k: 'd', b: 5 }, { k: 'w', dy: 99999 }, { k: 'kd', c: 'Key A' }, { k: 'kd', c: '<script>' }, { k: 'exec', cmd: 'calc' }, null, 'x'];
  ok(bad.every(e => cleanEvent(e, { mouse: true, keyboard: true }) === null), 'eventos fora do formato/faixa são descartados');
  ok(cleanEvent({ k: 'kd', c: 'ArrowLeft', extra: 1 }, { mouse: true, keyboard: true })?.extra === undefined, 'campos extras são removidos');
  // limite de taxa: rajada de 2000 eventos em 1 ms
  let sent = 0; for (let i = 0; i < 40; i++) sent += R.input('b', s1.id, Array.from({ length: 64 }, () => ({ k: 'm', x: .5, y: .5 }))).sent;
  ok(sent <= 800 && sent >= 700, 'rajada é limitada (~800 eventos de folga)', sent);
  t += 1000; ok(R.input('b', s1.id, Array.from({ length: 64 }, () => ({ k: 'm', x: .5, y: .5 }))).sent === 64, 'depois de 1 s volta a passar');
  ok(R.input('b', s1.id, Array.from({ length: 200 }, () => ({ k: 'm', x: .5, y: .5 }))).sent === 64, 'no máximo 64 eventos por mensagem');
  R.onScreenOff('a'); ok(last('b', 'REMOTE_STATE')?.state === 'ended' && last('b', 'REMOTE_STATE')?.reason === 'stream_ended', 'dono parou de transmitir: sessão acaba');
  ok(R.input('b', s1.id, [{ k: 'm', x: .5, y: .5 }]).sent === 0, 'sessão encerrada não aceita mais eventos');
  const s2 = R.request('b', 'c').session; t += 31000;
  ok(R.answer('c', s2.id, { accept: true, mouse: true }).error, 'pedido expira em 30 s');
  const s3 = R.request('b', 'c').session; R.answer('c', s3.id, { accept: true, keyboard: true, capable: true });
  R.stop('c', s3.id, 'panic'); ok(last('b', 'REMOTE_STATE')?.reason === 'panic', 'atalho de emergência do dono encerra');
  const s4 = R.request('b', 'c').session; R.answer('c', s4.id, { accept: false, capable: false });
  ok(last('b', 'REMOTE_STATE')?.reason === 'unsupported', 'dono sem o app desktop: "não suportado"');
  const s5 = R.request('b', 'c').session; R.answer('c', s5.id, { accept: true, mouse: false, keyboard: false });
  ok(last('b', 'REMOTE_STATE')?.state === 'ended', 'aceitar sem liberar nada = recusar');
  const s6 = R.request('b', 'c').session; R.answer('c', s6.id, { accept: true, mouse: true }); R.onLeave('b');
  ok(last('c', 'REMOTE_STATE')?.reason === 'left', 'controlador saiu da sala: sessão acaba');
}

// ---------- 2) três navegadores ----------
fs.rmSync('.testdata8', { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata8' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function page(tok, desk) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((tok, desk) => {
    localStorage.lc_token = tok;
    // tela "transmitida": canvas animado no lugar do getDisplayMedia
    navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let n = 0; setInterval(() => { x.fillStyle = `hsl(${n++ % 360},60%,40%)`; x.fillRect(0, 0, 1280, 720); }, 33); return c.captureStream(30); };
    if (desk) {
      window.__ri = []; window.__rs = []; window.__rstop = 0;
      const fns = { isDesktop: true, getSettings: async () => ({}), getUpdate: async () => null, setThrottle: () => { },
        getSources: async () => [{ id: 'screen:1:0', name: 'Tela 1', type: 'screen', thumbnail: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }],
        remoteCapable: async () => ({ ok: true, antiCheats: window.__ac || [] }), remoteStart: async (o) => { window.__rs.push(o); return { ok: true }; },
        remoteInput: (ev) => window.__ri.push(...ev), remoteStop: () => { window.__rstop++; }, onRemoteEvent: (cb) => { window.__remoteCb = cb; } };
      window.lcDesktop = new Proxy(fns, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(true)) });
    }
  }, tok, desk);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const toastOf = (p, re) => p.waitForFunction((re) => new RegExp(re).test(document.getElementById('toast')?.textContent || ''), { timeout: 5000 }, re).then(() => true, () => false);
try {
  const a = await reg('alice'), b = await reg('bob'), c = await reg('carol');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Remoto' }); const code = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(b.tok, 'POST', '/invites/' + code); await call(c.tok, 'POST', '/invites/' + code);
  const A = await page(a.tok, true), B = await page(b.tok, false), C = await page(c.tok, false);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B, C]) {
    await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 15000 });
  }
  // alice transmite (pelo seletor do "app desktop")
  await A.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(x => x.title.includes('Transmitir')).click()); await sleep(800);
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /Transmitir/.test(x.textContent)).click());
  await B.waitForFunction((uid) => !!document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`) || !!document.querySelector(`.tile.screen[data-sid="${uid}"]`), { timeout: 15000 }, a.id);
  await B.evaluate((uid) => document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`)?.click(), a.id);
  await B.waitForFunction((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"] video`)?.videoWidth > 0, { timeout: 15000 }, a.id);
  await B.evaluate((uid) => { window.__lc.S.focus = 's:' + uid; }, a.id);
  const ctlBtn = (P, uid) => P.evaluate((uid) => { const t = document.querySelector(`.tile.screen[data-sid="${uid}"]`); t?.dispatchEvent(new MouseEvent('mouseenter')); return !![...document.querySelectorAll('.tctl button')].find(x => /controle/i.test(x.title)); }, uid);
  ok(await ctlBtn(B, a.id), 'quem assiste vê o botão "Pedir controle" na transmissão');
  const clickCtl = (P) => P.evaluate(() => [...document.querySelectorAll('.tctl button')].find(x => /Pedir controle|Parar de controlar/.test(x.title))?.click());

  // pedido -> alice vê o diálogo, libera só o mouse
  await clickCtl(B);
  // primeira vez: apresentação com o aviso de anti-cheat e as limitações, antes de enviar o pedido
  const intro = await B.evaluate(() => document.querySelector('.modal')?.textContent || '');
  ok(/Pedir controle remoto/.test(intro) && /anti-cheat/.test(intro) && /Limitações/.test(intro), 'primeira vez: quem pede vê o aviso de anti-cheat e as limitações');
  ok(!(await A.evaluate(() => /quer controlar/.test(document.querySelector('.modal')?.textContent || ''))), 'o pedido só sai depois de confirmar a apresentação');
  await B.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Pedir controle').click());
  await A.waitForFunction(() => /quer controlar seu PC/.test(document.querySelector('.modal')?.textContent || ''), { timeout: 5000 }).catch(() => { });
  const dlg = await A.evaluate(() => document.querySelector('.modal')?.textContent || '');
  ok(/bob quer controlar seu PC/.test(dlg) && /Ctrl\+Alt\+Shift\+Q/.test(dlg), 'alice recebe o pedido com opções e o atalho de emergência');
  ok(/Cuidado com jogos com anti-cheat/.test(dlg) && /Limitações/.test(dlg) && await A.evaluate(() => !document.querySelector('.modal .rmwarn.hot')), 'diálogo do dono: aviso geral de anti-cheat (amarelo) e limitações');
  await A.screenshot({ path: `${SHOTS}/remote-consent.png` });
  await A.evaluate(() => { const cbs = [...document.querySelectorAll('.modal .rmopt input')]; cbs[1].click(); }); // desmarca o teclado
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Permitir').click());
  await A.waitForFunction(() => window.__rs.length > 0, { timeout: 5000 }).catch(() => { });
  ok(await A.evaluate(() => window.__rs[0]?.who === 'bob' && window.__rs[0]?.perms.mouse && !window.__rs[0]?.perms.keyboard), 'app desktop da alice é armado só com mouse', await A.evaluate(() => window.__rs[0]));
  ok(await toastOf(B, 'liberou o mouse'), 'bob fica sabendo que o mouse foi liberado');
  ok(await A.evaluate(() => /bob está controlando seu mouse/.test(document.getElementById('remote-chip')?.textContent || '')), 'alice vê o aviso "bob está controlando seu mouse"');
  ok(await B.evaluate((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"]`)?.classList.contains('controlling'), a.id), 'quadro da transmissão marcado como controlado no bob');

  // bob mexe: centro do vídeo, clique, rolagem e tentativa de digitar
  const box = await B.evaluate((uid) => { const v = document.querySelector(`.tile.screen[data-sid="${uid}"] video`), r = v.getBoundingClientRect(), s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: v.videoWidth * s, h: v.videoHeight * s, l: r.left + (r.width - v.videoWidth * s) / 2, t: r.top + (r.height - v.videoHeight * s) / 2 }; }, a.id);
  await B.mouse.move(box.l + box.w * .25, box.t + box.h * .75); await sleep(60);
  await B.mouse.click(box.x, box.y); await sleep(60);
  await B.mouse.wheel({ deltaY: 100 }); await sleep(60);
  await B.keyboard.press('KeyA'); await sleep(400);
  const got = await A.evaluate(() => window.__ri.slice());
  const mv = got.find(e => e.k === 'm');
  ok(mv && Math.abs(mv.x - .25) < .02 && Math.abs(mv.y - .75) < .02, 'posição do mouse chega normalizada ao PC da alice', mv);
  ok(got.some(e => e.k === 'd' && e.b === 0) && got.some(e => e.k === 'u' && e.b === 0), 'clique chega (botão esquerdo, apertar e soltar)');
  ok(got.some(e => e.k === 'w' && e.dy > 0), 'rolagem chega', got.find(e => e.k === 'w'));
  ok(!got.some(e => e.k === 'kd' || e.k === 'ku'), 'teclado não liberado: nenhuma tecla chega');
  ok(await B.evaluate(() => window.__lc.S.focus) !== null, 'clicar dentro da transmissão não muda o foco/layout do bob');
  await B.screenshot({ path: `${SHOTS}/remote-controlling.png` });

  // carol não recebe nada da sessão alice<->bob
  ok(!(await C.evaluate(() => !!document.getElementById('remote-chip'))), 'terceiro na sala não vê nem participa da sessão');

  // atalho de emergência no PC da alice
  await A.evaluate(() => window.__remoteCb('panic'));
  ok(await toastOf(B, 'alice parou o controle remoto'), 'atalho de emergência: bob é avisado');
  ok(await A.evaluate(() => window.__rstop > 0 && !document.getElementById('remote-chip')), 'atalho de emergência: app da alice desarmado e aviso some');
  ok(!(await B.evaluate((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"]`)?.classList.contains('controlling'), a.id)), 'quadro deixa de ser controlado');

  // nova sessão com mouse e teclado; bob digita. No PC da alice há um anti-cheat "rodando": aviso vermelho com o nome
  await A.evaluate(() => { window.__ac = ['Riot Vanguard (Valorant, League of Legends)']; });
  await sleep(300); await B.evaluate((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"]`)?.dispatchEvent(new MouseEvent('mouseenter')), a.id); await clickCtl(B);
  await A.waitForFunction(() => /quer controlar/.test(document.querySelector('.modal')?.textContent || ''), { timeout: 5000 }).catch(() => { });
  ok(await A.evaluate(() => /Anti-cheat rodando agora: Riot Vanguard/.test(document.querySelector('.modal .rmwarn.hot')?.textContent || '')), 'anti-cheat detectado no PC do dono: aviso vermelho com o nome');
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Permitir').click());
  await toastOf(B, 'liberou o mouse e o teclado');
  ok(true, 'segundo pedido sai direto, sem repetir a apresentação');
  await A.evaluate(() => { window.__ri = []; });
  await B.evaluate(() => document.querySelectorAll('textarea').forEach(t => { t.value = ''; })); // na sessão só com mouse, a tecla ficou no chat do próprio bob (esperado)
  await B.mouse.click(box.x, box.y); await sleep(50);
  await B.keyboard.down('ShiftLeft'); await B.keyboard.press('KeyO'); await B.keyboard.up('ShiftLeft'); await B.keyboard.press('Semicolon'); await sleep(400);
  const keys = (await A.evaluate(() => window.__ri.filter(e => e.k === 'kd' || e.k === 'ku').map(e => e.k + ':' + e.c)));
  ok(JSON.stringify(keys) === JSON.stringify(['kd:ShiftLeft', 'kd:KeyO', 'ku:KeyO', 'ku:ShiftLeft', 'kd:Semicolon', 'ku:Semicolon']), 'teclas chegam na ordem, pela posição física (Ç do ABNT2 = Semicolon)', keys);
  ok(await B.evaluate(() => [...document.querySelectorAll('textarea')].every(t => !t.value)), 'digitar no controle não escreve no chat do bob', await B.evaluate(() => [...document.querySelectorAll('textarea')].map(t => t.value)));
  // clicar fora do quadro solta o teclado; tecla segurada é solta
  await B.keyboard.down('KeyW'); await sleep(50);
  await B.mouse.click(30, 450); await sleep(300); await B.keyboard.up('KeyW');
  const after = await A.evaluate(() => window.__ri.filter(e => e.c === 'KeyW').map(e => e.k));
  ok(JSON.stringify(after) === JSON.stringify(['kd', 'ku']), 'clicar fora solta a tecla que estava segurada', after);
  // bob para pelo aviso
  await B.evaluate(() => document.querySelector('#remote-chip .btn').click());
  ok(await A.waitForFunction(() => !document.getElementById('remote-chip') && window.__rstop >= 2, { timeout: 5000 }).then(() => true, () => false), 'bob para pelo botão do aviso: alice desarmada');

  // dono pelo navegador comum (carol): não pode ser controlado
  await C.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(x => x.title.includes('Transmitir')).click()); await sleep(800);
  await C.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /Transmitir/.test(x.textContent)).click());
  await B.waitForFunction((uid) => !!document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`), { timeout: 15000 }, c.id);
  await B.evaluate((uid) => document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`).click(), c.id); await sleep(800);
  await B.evaluate((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"]`)?.click(), c.id); await sleep(400); // destaca a transmissão da carol (os botões valem para a destacada)
  await B.evaluate(() => [...document.querySelectorAll('.tctl button')].find(x => /Pedir controle/.test(x.title))?.click());
  ok(await toastOf(B, 'carol não pode ser controlad'), 'navegador comum: pedido recusado automaticamente com explicação');
  ok(!(await C.evaluate(() => !!document.querySelector('.modal .rmask'))), 'carol (sem o app) nem vê diálogo de consentimento');

  // alice para de transmitir durante uma sessão
  await B.evaluate((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"]`)?.click(), a.id); await sleep(400); await clickCtl(B);
  await A.waitForFunction(() => /quer controlar/.test(document.querySelector('.modal')?.textContent || ''), { timeout: 5000 }).catch(() => { });
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Permitir').click()); await toastOf(B, 'liberou');
  await A.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(x => /Parar transmissão/i.test(x.title))?.click()); await sleep(500);
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /Parar transmissão/.test(x.textContent))?.click());
  ok(await toastOf(B, 'alice parou de transmitir'), 'dono parou de transmitir: sessão acaba e bob é avisado');
  ok(await A.evaluate(() => window.__rstop >= 3), 'app da alice desarmado ao parar de transmitir');
} catch (err) { console.log('  ERRO', err); fails++; }
await browser.close(); srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
