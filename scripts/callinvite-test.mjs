// Convite para a chamada: regras no servidor (quem pode convidar quem), aviso com toque, cartão na DM,
// aceitar (inclusive entrando no servidor), recusar, cancelar, expirar e reenvio. Uso: node scripts/callinvite-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createCallInvites } from '../server/callinvites.js';
const PORT = 3226, BASE = `http://localhost:${PORT}`, SHOTS = '.testshots';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- 1) módulo isolado: expiração, ban e "recusou e mudou de ideia" com relógio falso ----------
{
  let t = 1e12; const sent = [], joined = [];
  const db = { guilds: { g: { id: 'g', name: 'G' } }, channels: { v: { id: 'v', guild_id: 'g', type: 2, name: 'Sala' } }, users: { a: 1, b: 1, c: 1 } };
  const inv = createCallInvites({
    get: (sql, id) => (sql.includes('FROM guilds') ? db.guilds[id] : sql.includes('FROM channels') ? db.channels[id] : sql.includes('FROM users') ? (db.users[id] && { x: 1 }) : null),
    voiceChannelOf: (u) => (u === 'a' ? 'v' : null), roomSize: () => 1,
    isFriend: (x, y) => x === 'a' && y === 'b', isMember: (g, u) => u === 'a' || joined.includes(u) || u === 'c', isBanned: (g, u) => u === 'c' && db.ban,
    isBlocked: () => false, joinGuild: (g, u) => joined.push(u), userPub: (id) => ({ id, display_name: id }), dispatch: (to, type) => sent.push(type), postDm: () => { }, now: () => t,
  });
  const r1 = inv.create('a', 'b'); ok(r1.invite?.state === 'pending', 'módulo: convite criado pendente');
  ok(inv.create('a', 'b').repeated === true, 'módulo: reenviar logo em seguida devolve o mesmo convite (não toca de novo)');
  t += 6 * 60e3; ok(inv.read(r1.invite.id, 'b').invite.state === 'expired', 'módulo: depois de 5 min o convite expira');
  ok(inv.respond(r1.invite.id, 'b', 'accept').status === 410, 'módulo: aceitar convite expirado é recusado');
  const r2 = inv.create('a', 'b'); inv.respond(r2.invite.id, 'b', 'decline');
  const r2b = inv.respond(r2.invite.id, 'b', 'accept');
  ok(r2b.channel_id === 'v' && r2b.invite.state === 'accepted' && joined.includes('b'), 'módulo: recusou, mudou de ideia dentro do prazo, aceita e entra no servidor');
  db.ban = true; ok(inv.create('a', 'c').status === 403, 'módulo: membro banido não pode ser convidado');
}

// ---------- 2) servidor real + navegador ----------
fs.rmSync('.testdata7', { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata7' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function page(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.goto(BASE); await p.evaluate((t) => localStorage.lc_token = t, tok); await p.reload(); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
try {
  const a = await reg('alice'), b = await reg('bob'), c = await reg('carol'), d = await reg('dave'), e = await reg('eve');
  // alice ↔ bob amigos; carol membro do servidor; eve bloqueou a alice; dave não tem relação
  await call(a.tok, 'POST', '/relationships', { username: 'bob' }); await call(b.tok, 'PUT', `/relationships/${a.id}`, {});
  await call(a.tok, 'POST', '/relationships', { username: 'eve' }); await call(e.tok, 'PUT', `/relationships/${a.id}`, {}); await call(e.tok, 'PUT', `/relationships/${a.id}`, { type: 2 });
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Servidor da Alice' });
  const code = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code; await call(c.tok, 'POST', '/invites/' + code);
  const A = await page(a.tok), B = await page(b.tok);
  await sleep(500);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);

  ok((await call(a.tok, 'POST', '/call-invites', { user_id: b.id })).status === 400, 'fora de uma sala de voz não dá para convidar');
  await A.evaluate((gid, cid) => { window.__lc.go(gid, cid); }, g.id, vch.id); await sleep(400);
  await A.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
  await A.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 15000 }); await sleep(800);

  ok((await call(a.tok, 'POST', '/call-invites', { user_id: d.id })).status === 403, 'desconhecido (nem amigo nem membro) não pode ser convidado');
  ok((await call(a.tok, 'POST', '/call-invites', { user_id: e.id })).status === 403, 'quem bloqueou não recebe convite');
  ok((await call(a.tok, 'POST', '/call-invites', { user_id: a.id })).status === 400, 'não dá para convidar a si mesmo');

  // menu da pessoa (em chamada) tem "Convidar para a chamada" para o amigo
  ok(await A.evaluate(async (uid) => { const m = await import('/callinvite.js'); return m.canCallInvite(uid); }, b.id), 'amigo fora do servidor pode ser convidado (a interface oferece)');

  // alice convida o bob (amigo, ainda não é membro)
  const r = await call(a.tok, 'POST', '/call-invites', { user_id: b.id });
  ok(r.status === 200 && r.invite.state === 'pending' && r.invite.member === false, 'convite criado para amigo que ainda não está no servidor');
  await B.waitForSelector('#call-banner.callinv', { timeout: 5000 }).catch(() => { });
  const ban = await B.evaluate(() => document.querySelector('#call-banner.callinv')?.textContent || '');
  ok(/alice/.test(ban) && /chamou você/.test(ban), 'bob recebe o aviso com toque: ' + ban.slice(0, 80));
  await sleep(400); await B.screenshot({ path: `${SHOTS}/callinv-banner.png` });
  ok((await call(a.tok, 'POST', '/call-invites', { user_id: b.id })).repeated === true, 'reenviar em seguida não cria outro convite');
  ok((await call(c.tok, 'GET', `/call-invites/${r.invite.id}`)).status === 404, 'terceiros não enxergam o convite');
  ok((await call(c.tok, 'POST', `/call-invites/${r.invite.id}/accept`)).status === 404, 'terceiros não aceitam o convite de outro');
  // cartão na DM do bob
  const dm = await B.evaluate(() => [...window.__lc.S.dms.values()][0]?.id);
  await B.evaluate((cid) => window.__lc.go('@me', cid), dm); await sleep(800);
  const card = await B.evaluate(() => ({ t: document.querySelector('.callcard')?.textContent || '', btn: [...document.querySelectorAll('.callcard .btn')].map(x => x.textContent) }));
  ok(card.t.includes('Convite para a chamada') && card.btn.includes('Entrar no servidor e na chamada') && card.btn.includes('Recusar'), 'cartão na DM com "Entrar no servidor e na chamada" e "Recusar": ' + card.btn.join(' | '));
  ok(await B.evaluate(() => !document.querySelector('#msgs')?.textContent.includes('/call/')), 'o link cru não aparece no chat, só o cartão');
  await B.screenshot({ path: `${SHOTS}/callinv-card.png` });
  // aceitar pelo aviso: entra no servidor e na sala
  await B.evaluate(() => [...document.querySelectorAll('#call-banner .btn')].find(x => x.textContent === 'Entrar').click());
  await B.waitForFunction((cid) => window.__lc.voice?.channelId === cid, { timeout: 15000 }, vch.id).catch(() => { });
  ok(await B.evaluate((gid, cid) => window.__lc.S.guilds.has(gid) && window.__lc.voice?.channelId === cid && window.__lc.S.view.cid === cid, g.id, vch.id), 'aceitar: bob entra no servidor, abre a sala e entra na chamada');
  const seen = (re) => A.waitForFunction((re) => new RegExp(re).test(document.getElementById('toast')?.textContent || ''), { timeout: 4000 }, re).then(() => true, () => false);
  await seen('bob aceitou');
  const toastA = await A.evaluate(() => [...document.querySelectorAll('#toast')].map(t => t.textContent).join(' | '));
  ok(/bob aceitou/.test(toastA), 'alice fica sabendo que o bob aceitou: ' + toastA);
  ok(!(await B.evaluate(() => !!document.getElementById('call-banner'))), 'aviso some depois de aceitar');
  ok((await call(a.tok, 'POST', '/call-invites', { user_id: b.id })).status === 400, 'quem já está na chamada não pode ser convidado de novo');

  // carol (membro) recusa
  const rc = await call(a.tok, 'POST', '/call-invites', { user_id: c.id });
  ok(rc.status === 200 && rc.invite.member === true, 'membro do servidor (não amigo) pode ser convidado');
  ok((await call(c.tok, 'POST', `/call-invites/${rc.invite.id}/decline`)).invite?.state === 'declined', 'carol recusa');
  ok(await seen('carol recusou'), 'alice fica sabendo que a carol recusou');
  // cartão da alice (DM com a carol) mostra o resultado
  const dmC = await A.evaluate((cid) => [...window.__lc.S.dms.values()].find(x => x.recipients?.some(u => u.id === cid) || x.recipient_ids?.includes(cid))?.id, c.id);
  if (dmC) { await A.evaluate((id) => window.__lc.go('@me', id), dmC); await sleep(800); }
  ok(await A.evaluate(() => /carol recusou/.test(document.querySelector('.callcard[data-state="declined"] .ccstate')?.textContent || '')), 'cartão de quem convidou mostra "carol recusou"');
  await A.screenshot({ path: `${SHOTS}/callinv-declined.png` });

  // cancelar: alice convida de novo e cancela; aceitar depois falha
  await sleep(100);
  const rc2 = await call(a.tok, 'POST', '/call-invites', { user_id: c.id });
  ok((await call(c.tok, 'POST', `/call-invites/${rc2.invite.id}/cancel`)).status === 403, 'só quem convidou pode cancelar');
  await call(a.tok, 'POST', `/call-invites/${rc2.invite.id}/cancel`);
  ok((await call(c.tok, 'POST', `/call-invites/${rc2.invite.id}/accept`)).status === 410, 'convite cancelado não pode ser aceito');
  ok((await call('', 'POST', '/call-invites', { user_id: c.id })).status === 401, 'sem login: 401');
} catch (err) { console.log('  ERRO', err); fails++; }
await browser.close(); srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
