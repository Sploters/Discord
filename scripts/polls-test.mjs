// Enquetes no chat: validação e permissões (API) e o fluxo em 3 navegadores (criar pelo "+", votar ao vivo,
// trocar e tirar voto, várias respostas, encerrar, prazo). Uso: node scripts/polls-test.mjs  (SHOTS=1 salva capturas)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3230, BASE = `http://localhost:${PORT}`, OUT = '.testshots/polls';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata11', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata11', POLL_TEST_FAST: '1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
async function page(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1280, height: 860 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const card = (P) => P.evaluate(() => { const c = [...document.querySelectorAll('.pollcard')].at(-1); if (!c) return null; return { q: c.querySelector('.pq').textContent, closed: c.classList.contains('closed'), foot: c.querySelector('.pfoot').textContent, opts: [...c.querySelectorAll('.popt')].map(o => ({ t: o.querySelector('.ptext').textContent, n: o.querySelector('.pnum').textContent.replace(/\s+/g, ' ').trim(), mine: o.classList.contains('mine'), win: o.classList.contains('win'), av: o.querySelectorAll('.pvoters .avatar').length })) }; });
const clickOpt = (P, text) => P.evaluate((t) => [...[...document.querySelectorAll('.pollcard')].at(-1).querySelectorAll('.popt')].find(o => o.querySelector('.ptext').textContent.startsWith(t)).click(), text);
const until = (P, fn, arg) => P.waitForFunction(fn, { timeout: 5000 }, arg).then(() => true, () => false);
try {
  const a = await reg('alice'), b = await reg('bruno'), c = await reg('carla'), d = await reg('davi');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Jogatina' }); const code = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(b.tok, 'POST', '/invites/' + code); await call(c.tok, 'POST', '/invites/' + code);
  const chans = (await call(a.tok, 'GET', `/guilds/${g.id}`)).channels || [];
  const A = await page(a.tok), B = await page(b.tok), C = await page(c.tok);
  const text = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0), g.id); void chans;

  // ---------- API: validação e permissões ----------
  const P = (tok, body) => call(tok, 'POST', `/channels/${text.id}/polls`, body);
  ok((await P(a.tok, { question: '', options: ['a', 'b'] })).status === 400, 'sem pergunta é recusado');
  ok((await P(a.tok, { question: 'X?', options: ['a'] })).status === 400, 'só 1 opção é recusado');
  ok((await P(a.tok, { question: 'X?', options: Array.from({ length: 11 }, (_, i) => 'o' + i) })).status === 400, 'mais de 10 opções é recusado');
  ok((await P(a.tok, { question: 'X?', options: ['Sim', 'sim'] })).status === 400, 'opções repetidas são recusadas');
  ok((await P(a.tok, { question: 'X?', options: ['a', 'b'], duration_h: 5 })).status === 400, 'prazo fora da lista é recusado');
  ok((await P(d.tok, { question: 'X?', options: ['a', 'b'] })).status === 404, 'quem não é do servidor não cria enquete lá');
  const m1 = await P(b.tok, { question: 'Pizza ou hambúrguer?', options: ['Pizza', 'Hambúrguer'], duration_h: 0 });
  ok(m1.status === 200 && m1.poll?.options.length === 2 && m1.content === '📊 Pizza ou hambúrguer?', 'enquete criada como mensagem do chat');
  const pid = m1.poll.id;
  ok((await call(a.tok, 'PUT', `/polls/${pid}/vote`, { options: ['1', '2'] })).status === 400, 'resposta única: dois votos é recusado');
  ok((await call(a.tok, 'PUT', `/polls/${pid}/vote`, { options: ['9'] })).status === 400, 'opção inexistente é recusada');
  ok((await call(d.tok, 'PUT', `/polls/${pid}/vote`, { options: ['1'] })).status === 404, 'quem não é do servidor não vota');
  ok((await call(a.tok, 'PUT', `/polls/${pid}/vote`, { options: ['1'] })).options[0].voters[0] === a.id, 'voto registrado com quem votou');
  ok((await call(a.tok, 'PUT', `/polls/${pid}/vote`, { options: ['2'] })).options.map(o => o.voters.length).join() === '0,1', 'trocar o voto substitui o anterior');
  ok((await call(a.tok, 'PUT', `/polls/${pid}/vote`, { options: [] })).voters === 0, 'lista vazia tira o voto');
  ok((await call(c.tok, 'POST', `/polls/${pid}/close`)).status === 403, 'outro membro não encerra');
  ok((await call(b.tok, 'PATCH', `/channels/${text.id}/messages/${m1.id}`, { content: '📊 mudei' })).status === 400, 'a mensagem da enquete não pode ser editada');
  ok((await call(a.tok, 'POST', `/polls/${pid}/close`)).closed === true, 'dono do servidor (moderador) encerra');
  ok((await call(c.tok, 'PUT', `/polls/${pid}/vote`, { options: ['1'] })).status === 409, 'não vota em enquete encerrada');
  await call(b.tok, 'DELETE', `/channels/${text.id}/messages/${m1.id}`);
  ok((await call(a.tok, 'PUT', `/polls/${pid}/vote`, { options: ['1'] })).status === 404, 'apagar a mensagem apaga a enquete');
  const multi = await P(a.tok, { question: 'Quais jogos?', options: ['CS2', 'Valorant', 'Minecraft'], multi: true });
  ok((await call(b.tok, 'PUT', `/polls/${multi.poll.id}/vote`, { options: ['1', '3'] })).options.map(o => o.voters.length).join() === '1,0,1', 'várias respostas: dois votos da mesma pessoa');
  await call(a.tok, 'DELETE', `/channels/${text.id}/messages/${multi.id}`);

  // ---------- navegador: criar pelo "+" ----------
  for (const X of [A, B, C]) await X.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text.id);
  await sleep(600);
  await A.evaluate(() => document.querySelector('#composer button[title^="Enviar arquivo"]').click()); await sleep(200);
  ok(await A.evaluate(() => [...document.querySelectorAll('.menu .it')].some(i => i.textContent.includes('Criar enquete'))), 'menu "+" tem "Criar enquete"');
  await A.evaluate(() => [...document.querySelectorAll('.menu .it')].find(i => i.textContent.includes('Criar enquete')).click()); await sleep(300);
  await A.type('.pollmodal label.f input', 'Que jogo hoje à noite?');
  const opts = await A.$$('.pollmodal .pmrow input'); await opts[0].type('CS2'); await opts[1].type('Valorant');
  await opts[1].press('Enter'); await sleep(100); await A.keyboard.type('Minecraft'); // Enter na última opção cria outra
  if (process.env.SHOTS) { await sleep(300); await A.screenshot({ path: `${OUT}/01-criar.png` }); }
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Publicar enquete').click());
  ok(await until(B, () => !!document.querySelector('.pollcard')), 'enquete aparece na hora para os outros');
  let cb = await card(B);
  ok(cb?.q === 'Que jogo hoje à noite?' && cb.opts.map(o => o.t).join() === 'CS2,Valorant,Minecraft' && /Termina em 24 h/.test(cb.foot), 'pergunta, 3 opções (Enter adicionou a terceira) e prazo padrão de 24 h', cb);
  ok(await B.evaluate(() => !document.querySelector('#msgs')?.textContent.includes('📊')), 'o texto cru não aparece, só o cartão');
  // votos ao vivo
  await clickOpt(B, 'Valorant');
  ok(await until(A, () => [...document.querySelectorAll('.pollcard .popt')].some(o => o.textContent.includes('100%'))), 'voto do bruno aparece na hora para a alice');
  await clickOpt(C, 'CS2'); await sleep(600);
  cb = await card(B);
  ok(cb.opts[0].n === '50% 1' && cb.opts[1].n === '50% 1' && cb.opts[1].mine && !cb.opts[0].mine && cb.opts[1].av === 1, 'porcentagens, minha escolha marcada e avatar de quem votou', cb.opts);
  await clickOpt(B, 'CS2'); await sleep(600);
  cb = await card(B);
  ok(cb.opts[0].n === '100% 2' && cb.opts[0].mine && !cb.opts[1].mine, 'resposta única: clicar em outra opção troca o voto', cb.opts.map(o => o.n));
  if (process.env.SHOTS) { await sleep(300); await B.screenshot({ path: `${OUT}/02-votando.png` }); }
  await B.evaluate(() => [...document.querySelectorAll('.pollcard .pacts .btn')].find(x => x.textContent === 'Tirar meu voto').click()); await sleep(600);
  ok((await card(B)).opts[0].n === '100% 1' && !(await card(B)).opts.some(o => o.mine), '"Tirar meu voto" remove');
  ok(!(await C.evaluate(() => [...document.querySelectorAll('.pollcard .pacts .btn')].some(x => x.textContent === 'Encerrar'))), 'quem não criou nem modera não vê "Encerrar"');
  await clickOpt(B, 'Valorant'); await clickOpt(A, 'CS2'); await sleep(500);
  await A.evaluate(() => [...document.querySelectorAll('.pollcard .pacts .btn')].find(x => x.textContent === 'Encerrar').click());
  ok(await until(C, () => document.querySelector('.pollcard')?.classList.contains('closed')), 'encerrar fecha para todos na hora');
  const cc = await card(C);
  ok(cc.opts[0].win && !cc.opts[1].win && /Encerrada/.test(cc.foot), 'resultado final com o vencedor destacado', cc.opts.map(o => o.t + ':' + o.win));
  ok(await C.evaluate(() => [...document.querySelectorAll('.pollcard .popt')].every(b => b.disabled)), 'opções travadas depois de encerrar');
  if (process.env.SHOTS) { await sleep(300); await C.screenshot({ path: `${OUT}/03-encerrada.png` }); }
  // prazo: enquete de ~3 s fecha sozinha e avisa todos
  await P(b.tok, { question: 'Rapidinha?', options: ['Sim', 'Não'], duration_h: 3 / 3600 });
  ok(await until(A, () => [...document.querySelectorAll('.pollcard')].at(-1)?.querySelector('.pq')?.textContent === 'Rapidinha?' && ![...document.querySelectorAll('.pollcard')].at(-1).classList.contains('closed')), 'enquete com prazo aberta');
  ok(await A.waitForFunction(() => [...document.querySelectorAll('.pollcard')].at(-1)?.classList.contains('closed'), { timeout: 8000 }).then(() => true, () => false), 'no fim do prazo fecha sozinha para quem está vendo');
  // DM também aceita enquete
  const dm = await call(a.tok, 'POST', '/dms', { user_id: b.id });
  ok((await call(a.tok, 'POST', `/channels/${dm.id}/polls`, { question: 'Hoje?', options: ['Sim', 'Não'] })).status === 200, 'enquete em mensagem direta');
} catch (err) { console.log('  ERRO', err); fails++; }
await browser.close(); srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
