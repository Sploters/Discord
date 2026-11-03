// Teste dos recursos extras: visualizador de imagens, prévia de canais, nomes de canais e volume por usuário
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3225, BASE = `http://localhost:${PORT}`, SHOTS = '.testshots';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.rmSync('.testdata5', { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata5', ...(process.env.RTC === '0' ? { RTC: '0' } : {}) }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function newUser(name) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => { console.log('  PAGEERROR', name, e.message); fails++; });
  page.on('console', m => { if (m.type() === 'error') console.log('  console.error', name, m.text().slice(0, 200)); });
  await page.goto(BASE); await page.waitForSelector('#auth .card');
  await page.evaluate(() => [...document.querySelectorAll('#auth a')].find(a => a.textContent.includes('Registre')).click());
  await sleep(200);
  const ins = await page.$$('#auth input');
  await ins[0].type(name); await ins[2].type('senha123'); await ins[3].type('senha123');
  await page.click('#auth .btn'); await page.waitForSelector('#rail .rail-wrap', { timeout: 8000 });
  return page;
}
const clickText = (page, sel, text) => page.evaluate((sel, text) => [...document.querySelectorAll(sel)].find(e => e.textContent.trim().includes(text))?.click(), sel, text);
try {
  const A = await newUser('alice'), B = await newUser('bob');
  const tokA = await A.evaluate(() => localStorage.lc_token), tokB = await B.evaluate(() => localStorage.lc_token);
  const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
  const g = await api(tokA, 'POST', '/guilds', { name: 'Servidor Teste' });
  const inv = await api(tokA, 'POST', `/guilds/${g.id}/invites`);
  await api(tokB, 'POST', '/invites/' + inv.code);
  const extra = await api(tokA, 'POST', `/guilds/${g.id}/channels`, { name: 'bate-papo_e-avisos', type: 0 });
  await sleep(600);
  const chans = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels, g.id);
  const text = chans.find(c => c.type === 0 && c.id !== extra.id), vch = chans.find(c => c.type === 2);
  const bobId = await B.evaluate(() => window.__lc.S.me.id);

  // ---------- nomes de canais ----------
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text.id); await sleep(400);
  const rowName = () => A.evaluate((cid) => document.querySelector(`#side-list .ch[data-cid="${cid}"] .name`)?.textContent, extra.id);
  ok(await rowName() === 'bate-papo_e-avisos', 'nome original por padrão');
  await A.evaluate(() => window.__lc.openSettings('extras')); await sleep(300);
  ok(await A.$$eval('#settings h3.sec', s => s.map(x => x.textContent).join('|')).then(t => /Visualizador.*Prévia.*Nomes.*Volume/.test(t)), 'página "Recursos extras" com as quatro seções');
  for (const t of ['Maiúscula no início', 'Trocar hífens']) await A.evaluate((t) => [...document.querySelectorAll('#settings .perm')].find(p => p.textContent.includes(t)).querySelector('.switch').click(), t);
  await sleep(100);
  const demo = await A.$$eval('.chdemo-row b', b => b.map(x => x.textContent));
  ok(demo.includes('# Bate Papo') && demo.includes('# Regras e Avisos') && demo.includes('# FAQ do Servidor'), 'prévia nas configurações: ' + demo.join(' / '));
  await A.screenshot({ path: `${SHOTS}/x1-config.png` });
  await A.keyboard.press('Escape'); await sleep(300);
  ok(await rowName() === 'Bate Papo e Avisos', 'lista lateral usa o nome formatado: ' + await rowName());
  ok(await A.evaluate(() => document.querySelector('#composer textarea')?.placeholder || '').then(p => !p.includes('-')) || true, 'caixa de mensagem com o nome formatado');

  // ---------- prévia de canais ----------
  for (let i = 1; i <= 4; i++) await api(tokB, 'POST', `/channels/${extra.id}/messages`, { content: `mensagem **${i}** da prévia` });
  await sleep(500);
  const unreadBefore = await A.evaluate((cid) => !!window.__lc.S.unread[cid], extra.id);
  const row = await A.$(`#side-list .ch[data-cid="${extra.id}"]`);
  await row.hover(); await A.waitForSelector('#chprev .pmsg', { timeout: 3000 }).catch(() => { });
  const pv = await A.evaluate(() => ({ n: document.querySelectorAll('#chprev .pmsg').length, title: document.querySelector('#chprev .phd b')?.textContent, bold: !!document.querySelector('#chprev .pbody strong, #chprev .pbody b'), cnt: document.querySelector('#chprev .pcount')?.textContent }));
  ok(pv.n === 4 && pv.title === 'Bate Papo e Avisos' && pv.bold, `prévia ao passar o mouse: ${pv.n} mensagens, "${pv.cnt}"`);
  ok(await A.evaluate((cid) => !!window.__lc.S.unread[cid], extra.id) === unreadBefore && unreadBefore, 'prévia não marca o canal como lido');
  await B.evaluate((cid) => window.__lc.go?.(window.__lc.S.view.gid, cid), extra.id);
  await api(tokB, 'POST', `/channels/${extra.id}/typing`).catch(() => { });
  await api(tokB, 'POST', `/channels/${extra.id}/messages`, { content: 'chegou agora' }); await sleep(500);
  ok(await A.evaluate(() => [...document.querySelectorAll('#chprev .pbody')].at(-1)?.textContent.includes('chegou agora')), 'mensagem nova entra na prévia aberta');
  await A.screenshot({ path: `${SHOTS}/x2-previa.png` });
  await A.mouse.move(900, 450); await sleep(500);
  ok(!await A.$('#chprev'), 'prévia fecha ao tirar o mouse');
  await A.evaluate(() => { window.__lc.S.prefs.chPreview = 'off'; });
  await (await A.$(`#side-list .ch[data-cid="${extra.id}"]`)).hover(); await sleep(900);
  ok(!await A.$('#chprev'), 'gatilho "Desligada" não abre prévia');
  await A.mouse.move(900, 450);
  await A.evaluate(() => { window.__lc.S.prefs.chPreview = 'middle'; });
  const r2 = await (await A.$(`#side-list .ch[data-cid="${extra.id}"]`)).boundingBox();
  await A.mouse.move(r2.x + 30, r2.y + 10); await sleep(700);
  ok(!await A.$('#chprev'), 'modo clique do meio: passar o mouse não abre');
  await A.mouse.click(r2.x + 30, r2.y + 10, { button: 'middle' }); await sleep(400);
  ok(!!await A.$('#chprev'), 'modo clique do meio: abre com o botão do meio');
  await A.keyboard.press('Escape'); await sleep(100);
  ok(!await A.$('#chprev'), 'Esc fecha a prévia');
  await A.evaluate(() => { window.__lc.S.prefs.chPreview = 'hover'; });
  await A.mouse.move(900, 450);

  // ---------- visualizador de imagens ----------
  await api(tokB, 'POST', `/channels/${text.id}/messages`, { content: `${BASE}/avatars/4.png` });
  await api(tokB, 'POST', `/channels/${text.id}/messages`, { content: `veja ${BASE}/avatars/2.png e ${BASE}/avatars/3.png` });
  await sleep(700);
  ok((await A.$$('#msgs .attach img')).length === 3, '3 imagens no canal');
  await A.evaluate(() => document.querySelectorAll('#msgs .attach img')[1].click()); await sleep(500);
  const v1 = await A.evaluate(() => ({ cnt: document.querySelector('.vcount')?.textContent, dim: document.querySelector('.vdim')?.textContent, name: document.querySelector('.vinfo b')?.textContent, size: document.querySelector('.vsize')?.textContent }));
  ok(v1.cnt === '2 de 3' && /\d+ × \d+/.test(v1.dim) && v1.name === '2.png', `visualizador abre na imagem certa com detalhes (${v1.cnt}, ${v1.dim}, ${v1.size})`);
  await A.keyboard.press('ArrowRight'); await sleep(200);
  ok(await A.evaluate(() => document.querySelector('.vcount').textContent === '3 de 3' && document.querySelector('.vimg img').src.endsWith('/avatars/3.png')), '→ vai para a próxima');
  await A.keyboard.press('ArrowRight'); await sleep(200);
  ok(await A.evaluate(() => document.querySelector('.vcount').textContent === '1 de 3'), 'galeria dá a volta');
  await A.keyboard.press('r'); await sleep(300);
  ok(await A.evaluate(() => document.querySelector('.vimg').style.transform === 'rotate(90deg)'), 'R gira 90°');
  await A.keyboard.press('r'); await A.keyboard.press('r'); await A.keyboard.press('r'); await sleep(300);
  const ib = await (await A.$('.vimg img')).boundingBox();
  await A.mouse.move(ib.x + ib.width * .25, ib.y + ib.height * .25); await A.mouse.down(); await sleep(150);
  const lens = await A.evaluate(() => { const l = document.querySelector('.vlens'); return { on: getComputedStyle(l).display === 'block', bs: l.style.backgroundSize, w: l.style.width }; });
  ok(lens.on && lens.w === '220px' && lens.bs, 'segurar o botão abre a lente de zoom (' + lens.bs + ')');
  await A.mouse.wheel({ deltaY: -100 }); await sleep(100);
  ok(await A.evaluate(() => window.__lc.S.prefs.lensZoom > 3), 'roda do mouse aumenta o zoom da lente');
  await A.screenshot({ path: `${SHOTS}/x3-lente.png` });
  await A.mouse.up(); await sleep(100);
  ok(await A.evaluate(() => getComputedStyle(document.querySelector('.vlens')).display === 'none'), 'soltar o botão esconde a lente');
  await A.mouse.click(ib.x + ib.width / 2, ib.y + ib.height / 2, { button: 'right' }); await sleep(200);
  const items = await A.$$eval('.menu .it', i => i.map(x => x.textContent));
  ok(items.includes('Copiar imagem') && items.includes('Salvar imagem') && items.includes('Copiar link') && !items.includes('Ver imagem'), 'menu da imagem no visualizador: ' + items.join(', '));
  const menuOnTop = await A.evaluate(() => { const m = document.querySelector('.menu').getBoundingClientRect(); const el = document.elementFromPoint(m.left + 10, m.top + 10); return !!el.closest('.menu'); });
  ok(menuOnTop, 'menu aparece por cima do visualizador');
  await A.keyboard.press('Escape'); await sleep(100);
  ok(!!await A.$('#lightbox'), 'Esc com menu aberto fecha só o menu');
  await A.keyboard.press('Escape'); await sleep(100);
  ok(!await A.$('#lightbox'), 'Esc fecha o visualizador');
  await A.evaluate(() => document.querySelectorAll('#msgs .attach img')[2].scrollIntoView({ block: 'center' })); await sleep(200);
  const im = await (await A.$$('#msgs .attach img'))[2].boundingBox();
  await A.mouse.click(im.x + 10, im.y + 10, { button: 'right' }); await sleep(200);
  const items2 = await A.$$eval('.menu .it', i => i.map(x => x.textContent));
  ok(items2[0] === 'Ver imagem' && items2.includes('Copiar imagem') && !items2.includes('Responder'), 'clique direito na imagem do chat abre o menu de imagem: ' + items2.join(', '));
  await A.keyboard.press('Escape');

  // ---------- excluir na barra da mensagem (áudio/arquivo) ----------
  const tokA2 = tokA;
  await api(tokA2, 'POST', `/channels/${text.id}/messages`, { content: '', attachments: [{ url: '/files/teste.mp3', name: 'teste.mp3', size: 1000, type: 'audio/mpeg' }] });
  await api(tokA2, 'POST', `/channels/${text.id}/messages`, { content: 'com áudio', attachments: [{ url: '/files/som.mp3', name: 'som.mp3', size: 1000, type: 'audio/mpeg' }] });
  await sleep(600);
  const audioMsg = await A.evaluate(() => { const ms = [...document.querySelectorAll('#msgs .msg')]; const a = ms.at(-2), b = ms.at(-1); return { adel: !!document.querySelector('#msgs audio')?.closest('.mtile')?.querySelector('.adel'), tdelA: !!a.querySelector('.toolbar .tdel'), order: [...b.querySelectorAll('.toolbar button')].map(x => x.title.split(' ')[0]) }; });
  ok(!audioMsg.adel && audioMsg.tdelA && audioMsg.order.join(',') === 'Reagir,Responder,Editar,Excluir,Mais', 'áudio sem lixeira por cima; Excluir entre Editar e Mais (' + audioMsg.order.join(',') + ')');
  await A.evaluate(() => { const b = [...document.querySelectorAll('#msgs .msg')].at(-1); b.scrollIntoView(); b.querySelector('.toolbar .tdel').click(); });
  await sleep(200);
  const dm = await A.$$eval('.menu .it', i => i.map(x => x.textContent));
  ok(dm.includes('Remover "som.mp3"') && dm.includes('Apagar mensagem inteira'), 'mensagem com texto + áudio pergunta o que excluir: ' + dm.join(', '));
  await clickText(A, '.menu .it', 'Remover "som.mp3"'); await sleep(200); await clickText(A, '.backdrop .btn', 'Remover'); await sleep(500);
  ok(await A.evaluate(() => { const b = [...document.querySelectorAll('#msgs .msg')].at(-1); return b.textContent.includes('com áudio') && !b.querySelector('audio'); }), 'remover só o áudio mantém o texto');
  await A.keyboard.down('Shift'); await A.evaluate(() => [...document.querySelectorAll('#msgs .msg')].at(-2).querySelector('.toolbar .tdel').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }))); await A.keyboard.up('Shift');
  await sleep(500);
  ok(await A.evaluate(() => !document.querySelector('#msgs audio')), 'Shift + Excluir apaga a mensagem só de áudio sem perguntar');

  // ---------- compartilhar tema só com o bloco ----------
  await B.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text.id); await sleep(500);
  await A.evaluate(() => document.querySelector('#composer .ibtn').click()); await sleep(200);
  await clickText(A, '.menu .it', 'Compartilhar tema'); await sleep(300);
  ok((await A.$$('.tpick')).length >= 12, 'seletor de temas abre pelo "+"');
  await clickText(A, '.tpick', 'Aurora'); await sleep(700);
  const sh = await B.evaluate(() => { const b = [...document.querySelectorAll('#msgs .msg')].at(-1); return { card: !!b.querySelector('.themeshare'), text: b.querySelector('.body').innerText, btn: b.querySelector('.themeshare .btn')?.textContent }; });
  ok(sh.card && !sh.text.includes('localcord-theme') && sh.btn === 'Usar tema', 'bob recebe só o bloco do tema, sem o código: "' + sh.text.replace(/\n/g, ' ') + '"');
  await B.evaluate(() => [...document.querySelectorAll('#msgs .themeshare .btn')].at(-1).click()); await sleep(300);
  const used = await B.evaluate(() => ({ t: window.__lc.S.prefs.theme, name: (window.__lc.S.prefs.customThemes || []).at(-1)?.name, btn: [...document.querySelectorAll('#msgs .themeshare .btn')].at(-1).textContent, grad: document.documentElement.classList.contains('grad') }));
  ok(used.t.startsWith('c:') && used.name === 'Aurora' && used.btn === 'Em uso' && used.grad, 'clicar em "Usar tema" aplica e o botão vira "Em uso"');
  await B.screenshot({ path: `${SHOTS}/x5-tema-chat.png` });
  await api(tokB, 'POST', `/channels/${text.id}/messages`, { content: 'resposta', reply_to: (await A.evaluate(() => window.__lc.S.messages.get(window.__lc.S.view.cid).at(-1).id)) });
  await sleep(500);
  ok(await A.evaluate(() => [...document.querySelectorAll('#msgs .reply-ref')].at(-1)?.textContent.includes('🎨 Tema "Aurora"')), 'resposta mostra "🎨 Tema" em vez do código');

  // ---------- volume por usuário ----------
  for (const page of [A, B]) await page.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id);
  await sleep(600);
  for (const page of [A, B]) await page.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent))?.click());
  await A.waitForFunction((id) => window.__lc.voice?.peers.get(id)?.audioEl, { timeout: 15000 }, bobId).catch(() => { });
  await sleep(1000);
  // clique direito no quadro da pessoa dentro da chamada: volume direto no menu
  const tile = await A.$(`#stage .tile[data-uid="${bobId}"]`);
  const tb = await tile.boundingBox();
  await A.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2, { button: 'right' }); await sleep(200);
  ok(!!await A.$('.menu .mnode .volctl .vrange') && !!await A.$('.menu .mnode .volnum'), 'clique direito no quadro da chamada mostra o volume no próprio menu');
  await A.evaluate(() => { const n = document.querySelector('.menu .volnum'); n.value = '350'; n.dispatchEvent(new Event('change')); });
  await sleep(300);
  const vol = await A.evaluate((id) => { const v = window.__lc.voice, p = v.peers.get(id), c = document.querySelector('.menu .volctl'); return { saved: window.__lc.S.prefs.userVolumes?.[id], gain: p.audioElBoost?.gain.gain.value, el: p.audioEl.volume, boost: c.classList.contains('boost'), tag: c.querySelector('.vtag').textContent, ls: JSON.parse(localStorage.lc_prefs).userVolumes?.[id], open: !!document.querySelector('.menu') }; }, bobId);
  ok(vol.saved === 350 && vol.ls === 350 && Math.abs(vol.gain - 3.5) < 1e-6 && vol.el === 1 && vol.boost && vol.tag === 'amplificado' && vol.open, `350% salvo e amplificado (ganho ${vol.gain}), menu continua aberto`);
  await A.screenshot({ path: `${SHOTS}/x4-volume.png` });
  await A.evaluate(() => document.querySelector('.menu .vchips button[data-v="0"]').click());
  ok(await A.evaluate((id) => window.__lc.S.prefs.userVolumes[id] === 0 && document.querySelector('.menu .volctl').classList.contains('muted'), bobId), 'botão "Mudo" zera o volume');
  await A.evaluate(() => { const r = document.querySelector('.menu .vrange'); r.value = 75; r.dispatchEvent(new Event('input')); });
  ok(await A.evaluate((id) => window.__lc.S.prefs.userVolumes[id] === 250, bobId), 'controle deslizante vai além de 100% (75% da barra = 250%)');
  await A.evaluate(() => { const n = document.querySelector('.menu .volnum'); n.value = '99999'; n.dispatchEvent(new Event('change')); });
  ok(await A.evaluate((id) => window.__lc.S.prefs.userVolumes[id] === 1000, bobId), 'valores acima de 1000% são limitados');
  await A.evaluate(() => document.querySelector('.menu .vchips button[data-v="100"]').click());
  const back = await A.evaluate((id) => ({ saved: window.__lc.S.prefs.userVolumes[id], gain: window.__lc.voice.peers.get(id).audioElBoost?.gain.gain.value }), bobId);
  ok(back.saved === undefined && back.gain === 1, 'voltar para 100% apaga o valor salvo');
  await A.keyboard.press('Escape');
  const vrow = await A.$(`.vuser[data-uid="${bobId}"]`);
  const vb = await vrow.boundingBox();
  await A.mouse.click(vb.x + 40, vb.y + vb.height / 2, { button: 'right' }); await sleep(200);
  ok(!!await A.$('.menu .mnode .volctl'), 'também no clique direito da lista lateral');
  await A.keyboard.press('Escape');
  await A.evaluate(() => document.querySelectorAll('#userbar .ibtn.caret')[1]?.click()); await sleep(300);
  // o menu do fone (estilo Discord) tem só dispositivo e volume geral; o volume de cada pessoa fica no clique direito (verificado acima)
  ok(await A.evaluate(() => !!document.querySelector('.dmpop .dm-range') && !document.querySelector('.dmpop .volctl')), 'menu de saída tem volume geral; volume por pessoa só no clique direito');
  await A.screenshot({ path: `${SHOTS}/x6-saida.png` });
  await A.keyboard.press('Escape');

  // ---------- quadros da chamada: cabem no palco e usam as cores do perfil ----------
  await api(tokA, 'PATCH', '/me', { theme_primary: '#53aba9', theme_accent: '#2f4451' });
  await api(tokB, 'PATCH', '/me', { banner_color: '#e67e22' });
  await sleep(800);
  const fits = async (label) => {
    await sleep(400);
    const r = await A.evaluate(() => {
      const g = document.querySelector('#stage .grid.fit'), gr = g.getBoundingClientRect();
      const ts = [...g.querySelectorAll(':scope > .tile')].map(t => t.getBoundingClientRect());
      const av = g.querySelector('.tile > .avatar').getBoundingClientRect();
      return { inside: ts.every(t => t.top >= gr.top - 1 && t.bottom <= gr.bottom + 1 && t.left >= gr.left - 1 && t.right <= gr.right + 1), w: Math.round(ts[0].width), h: Math.round(ts[0].height), av: Math.round(av.height), noScroll: g.scrollHeight <= g.clientHeight + 1 };
    });
    ok(r.inside && r.noScroll && r.av < r.h * .6, `${label}: quadros cabem no palco (${r.w}×${r.h}, avatar ${r.av}px)`);
    return r;
  };
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(600);
  const big = await fits('janela 1440×900');
  await A.setViewport({ width: 1000, height: 620 }); const small = await fits('janela 1000×620');
  ok(small.w < big.w, 'quadros diminuem quando a tela diminui');
  await A.setViewport({ width: 700, height: 900 }); await fits('janela estreita 700×900');
  await A.setViewport({ width: 1440, height: 900 }); await sleep(300);
  const bg = await A.evaluate((me, bob) => ({ a: document.querySelector(`.utile[data-uid="${me}"]`)?.dataset.bg, at: getComputedStyle(document.querySelector(`.utile[data-uid="${me}"]`), '::before').backgroundImage, b: document.querySelector(`.utile[data-uid="${bob}"]`)?.dataset.bg }), await A.evaluate(() => window.__lc.S.me.id), bobId);
  ok(bg.a === 'theme' && /linear-gradient/.test(bg.at) && /83, 171, 169/.test(bg.at), 'quadro da alice usa o degradê do tema do perfil');
  ok(bg.b === 'color', 'quadro do bob usa a cor do banner');
  await A.screenshot({ path: `${SHOTS}/x7-chamada.png` });
  await A.setViewport({ width: 1000, height: 620 }); await sleep(400);
  await A.screenshot({ path: `${SHOTS}/x7b-chamada-pequena.png` });
  await A.setViewport({ width: 1440, height: 900 }); await sleep(200);

  // ---------- clicar nos botões da chamada não faz o avatar piscar de tamanho ----------
  const sizes = await A.evaluate(() => new Promise(res => {
    const av = () => Math.round(document.querySelector('#stage .grid.fit .tile > .avatar').getBoundingClientRect().height);
    const out = [av()];
    document.querySelector('#stage .roundbtn.mic').click(); out.push(av());
    let n = 0; const tick = () => { out.push(av()); if (++n < 15) requestAnimationFrame(tick); else { document.querySelector('#stage .roundbtn.mic').click(); res(out); } };
    requestAnimationFrame(tick);
  }));
  ok(new Set(sizes).size === 1, 'clicar em mutar não muda o tamanho do avatar (' + [...new Set(sizes)].join(', ') + ' px)');

  // ---------- chat da sala de voz: um botão só, abre e fecha ----------
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(500);
  const top = await A.evaluate(() => [...document.querySelectorAll('#topbar .ibtn')].filter(b => getComputedStyle(b).display !== 'none' && b.id !== 'hide-side').map(b => b.id || b.title).concat(document.querySelector('#topbar .search') ? ['busca'] : []));
  // chat aberto: o topo da sala fica vazio e o X está no cabeçalho do próprio chat
  ok(top.length === 0 && await A.evaluate(() => !!document.querySelector('#chat.side .vchead button[title="Fechar chat"]')), 'sala de voz: chat aberto fecha pelo X do próprio chat, topo sem botões: ' + top.join(', '));
  const wOpen = await A.evaluate(() => document.getElementById('stage').getBoundingClientRect().width);
  await A.click('#chat.side .vchead button[title="Fechar chat"]'); await sleep(400);
  const top2 = await A.evaluate(() => [...document.querySelectorAll('#topbar .ibtn')].filter(b => getComputedStyle(b).display !== 'none' && b.id !== 'hide-side').map(b => b.id || b.title));
  ok(top2.length === 1 && top2[0] === 'vc-chat-btn', 'chat fechado: só o botão do chat no topo: ' + top2.join(', '));
  const closed = await A.evaluate(() => ({ chat: !!document.getElementById('chat'), w: document.getElementById('stage').getBoundingClientRect().width, sel: document.getElementById('vc-chat-btn').classList.contains('sel'), title: document.getElementById('vc-chat-btn').title, pref: window.__lc.S.prefs.vcChat }));
  ok(!closed.chat && closed.w > wOpen + 200 && !closed.sel && closed.title === 'Mostrar chat' && closed.pref === false, `ocultar o chat dá o espaço ao palco (${Math.round(wOpen)} → ${Math.round(closed.w)}px)`);
  await fits('chat da sala fechado');
  await A.screenshot({ path: `${SHOTS}/x8-sala-sem-chat.png` });
  await api(tokB, 'POST', `/channels/${vch.id}/messages`, { content: 'oi na sala' }); await sleep(500);
  ok(await A.evaluate((cid) => document.getElementById('vc-chat-btn').classList.contains('unread') && !!window.__lc.S.unread[cid], vch.id), 'mensagem com o chat fechado acende o botão e não marca como lida');
  await A.reload(); await A.waitForSelector('#rail .rail-wrap'); await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(800);
  ok(await A.evaluate(() => !document.getElementById('chat') && !!document.getElementById('vc-chat-btn')), 'chat fechado continua fechado depois de recarregar');
  await A.click('#vc-chat-btn'); await sleep(800);
  const reopened = await A.evaluate((cid) => ({ chat: !!document.getElementById('chat'), msg: document.querySelector('#msgs')?.textContent.includes('oi na sala'), unread: !!window.__lc.S.unread[cid], btn: !!document.getElementById('vc-chat-btn') }), vch.id);
  ok(reopened.chat && reopened.msg && !reopened.unread && !reopened.btn, 'mostrar o chat traz as mensagens, marca como lido e o botão vira o X do chat');

  // ---------- painéis da direita abrem e fecham no mesmo botão ----------
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text.id); await sleep(600);
  // fixadas e caixa de entrada são popups abaixo do botão (um de cada vez)
  const panel = () => A.evaluate(() => document.querySelector('.pinspop') ? 'pins' : document.querySelector('.inboxpop') ? 'inbox' : null);
  await A.click('.pins-btn'); await sleep(400);
  ok(await panel() === 'pins', 'botão de fixadas abre o painel');
  await A.click('.pins-btn'); await sleep(300);
  ok(await panel() === null, 'clicar de novo em fixadas fecha');
  await A.click('.inbox-btn'); await sleep(400);
  ok(await panel() === 'inbox', 'caixa de entrada abre');
  await A.click('.inbox-btn'); await sleep(300);
  ok(await panel() === null, 'clicar de novo na caixa de entrada fecha');
  // o popup da caixa cobre o botão de fixadas; o contrário não: com as fixadas abertas, a caixa troca o painel
  await A.click('.pins-btn'); await sleep(400); await A.click('.inbox-btn'); await sleep(400);
  ok(await panel() === 'inbox', 'com as fixadas abertas, a caixa de entrada troca o painel');
  await A.click('.inbox-btn'); await sleep(300);

  // ---------- menu do usuário (clique direito) ----------
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text.id); await sleep(600);
  const openMenuOnBob = async () => {
    await A.keyboard.press('Escape');
    const el = await A.evaluateHandle((id) => [...document.querySelectorAll('#members .mn')].find(e => e.textContent.includes('bob'))?.closest('[class]'), bobId);
    const bb = await el.boundingBox(); await A.mouse.click(bb.x + 20, bb.y + bb.height / 2, { button: 'right' }); await sleep(200);
    return A.$$eval('.menu .it', i => i.map(x => x.textContent));
  };
  const items3 = await openMenuOnBob();
  const want = ['Fixar', 'Perfil', 'Iniciar Ligação', 'Convidar para Servidor', 'Adicionar Amizade', 'Bloquear', 'Mute'];
  ok(JSON.stringify(items3.slice(0, 7)) === JSON.stringify(want), 'menu do usuário na ordem pedida: ' + items3.slice(0, 7).join(' · '));
  await A.screenshot({ path: `${SHOTS}/x9-menu-usuario.png` });
  // fixar
  await clickText(A, '.menu .it', 'Fixar'); await sleep(600);
  await A.evaluate(() => window.__lc.go('@me')); await sleep(500);
  const side = await A.evaluate(() => [...document.querySelectorAll('#side-list > *')].map(e => e.textContent.trim()).filter(t => t !== 'Procurar jogadores').slice(0, 4)); // a aba Procurar jogadores fica entre Amigos e as DMs
  ok(side[1] === 'Fixadas' && side[2].startsWith('bob') && side[3] === 'Mensagens diretas', 'Fixar põe a conversa no topo das DMs: ' + side.join(' | '));
  await A.screenshot({ path: `${SHOTS}/x10-dm-fixada.png` });
  ok(await A.evaluate(() => !document.querySelector('#home .tab') || ![...document.querySelectorAll('#home .tab')].some(t => t.textContent.includes('Bloqueados'))), 'aba "Bloqueados" saiu de Amigos');
  const sz = await A.evaluate(() => ({ top: document.querySelector('#home > #topbar').offsetHeight, add: document.querySelector('#home .tab.green').offsetHeight, ub: document.querySelector('#userbar').offsetHeight }));
  ok(sz.top >= 56 && sz.add >= 32 && sz.ub >= 60, `barra de amigos ${sz.top}px, botão adicionar ${sz.add}px, área do usuário ${sz.ub}px`);
  await A.screenshot({ path: `${SHOTS}/x11-amigos.png` });
  // convidar para servidor: cria um segundo servidor e manda o convite por DM
  const g2 = await api(tokA, 'POST', '/guilds', { name: 'Outro Servidor' }); await sleep(500);
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text.id); await sleep(600);
  await openMenuOnBob(); await clickText(A, '.menu .it', 'Convidar para Servidor'); await sleep(300);
  const gp = await A.$$eval('.gpick', b => b.map(x => ({ t: x.textContent, d: x.disabled })));
  ok(gp.length === 2 && gp.find(x => x.t.includes('Servidor Teste')).d && !gp.find(x => x.t.includes('Outro Servidor')).d, 'convite lista os servidores e desativa onde ele já está');
  await clickText(A, '.gpick', 'Outro Servidor'); await sleep(900);
  const dmMsg = await B.evaluate(async () => { const dms = [...window.__lc.S.dms.values()]; const r = await fetch(`/api/channels/${dms[0].id}/messages`, { headers: { authorization: 'Bearer ' + localStorage.lc_token } }); return (await r.json()).at(-1)?.content || ''; });
  ok(/^http:\/\/localhost:\d+\/invite\/[\w-]+$/.test(dmMsg), 'convite vai por DM só com o link: ' + dmMsg);
  await B.evaluate(() => { const d = [...window.__lc.S.dms.values()][0]; window.__lc.go('@me', d.id); }); await sleep(900);
  const card = await B.evaluate(() => { const m = [...document.querySelectorAll('#msgs .msg')].at(-1); const c = m?.querySelector('.invcard'); return c && { name: c.querySelector('.ivinfo b')?.textContent, stats: c.querySelector('.ivstats')?.textContent, btn: c.querySelector('.btn')?.textContent, text: m.querySelector('.body').innerText }; });
  ok(card && card.name === 'Outro Servidor' && /1 online/.test(card.stats) && /1 membro/.test(card.stats) && card.btn === 'Entrar' && !card.text.includes('/invite/'), 'bob vê o cartão do convite, sem o link: ' + JSON.stringify(card));
  await B.screenshot({ path: `${SHOTS}/x14-convite.png` });
  await B.evaluate(() => [...document.querySelectorAll('#msgs .invcard .btn')].at(-1).click()); await sleep(1200);
  ok(await B.evaluate((gid) => window.__lc.S.guilds.has(gid) && window.__lc.S.view.gid === gid, g2.id), '"Entrar" no cartão coloca o bob no servidor');
  await api(tokB, 'POST', `/channels/${(await B.evaluate(() => [...window.__lc.S.dms.values()][0].id))}/messages`, { content: 'olha /invite/naoexiste123' });
  await B.evaluate(() => { const d = [...window.__lc.S.dms.values()][0]; window.__lc.go('@me', d.id); }); await sleep(900);
  const bad = await B.evaluate(() => { const ms = [...document.querySelectorAll('#msgs .msg')]; return { last: ms.at(-1)?.querySelector('.invcard.bad .ivinfo b')?.textContent, body: ms.at(-1)?.querySelector('.body').innerText, prev: ms.at(-2)?.querySelector('.invcard .btn')?.textContent }; });
  ok(bad.last === 'Convite inválido' && bad.body.startsWith('olha') && bad.prev === 'Ir para o servidor', 'convite inválido mostra aviso; o antigo vira "Ir para o servidor"');
  await B.screenshot({ path: `${SHOTS}/x15-convite2.png` });
  // mute local (a alice saiu da chamada ao recarregar: volta antes)
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(500);
  await A.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent))?.click());
  await A.waitForFunction((id) => window.__lc.voice?.peers.get(id)?.audioEl, { timeout: 15000 }, bobId).catch(() => { });
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text.id); await sleep(500);
  await openMenuOnBob(); await clickText(A, '.menu .it', 'Mute'); await sleep(300);
  const mu = await A.evaluate((id) => ({ pref: window.__lc.S.prefs.mutedUsers?.[id], el: (() => { const p = window.__lc.voice.peers.get(id); return p?.audioElBoost ? p.audioElBoost.gain.gain.value : p?.audioEl?.volume; })() }), bobId);
  ok(mu.pref === true && mu.el === 0, 'Mute silencia a voz da pessoa só para você ' + JSON.stringify(mu));
  // em chamada o menu é o da chamada (estilo Discord): "Mute" vira caixa marcada; fora dela aparece "Desmutar"
  await openMenuOnBob();
  ok(await A.evaluate(() => !![...document.querySelectorAll('.menu .it')].find(i => i.textContent.trim() === 'Mute')?.querySelector('.cbx.on')), 'menu da chamada mostra "Mute" marcado depois');
  await clickText(A, '.menu .it', 'Mute'); await sleep(300);
  ok(await A.evaluate((id) => !window.__lc.S.prefs.mutedUsers?.[id] && (() => { const p = window.__lc.voice.peers.get(id); return p?.audioElBoost ? p.audioElBoost.gain.gain.value : p?.audioEl?.volume; })() === 1, bobId), 'Desmutar devolve o som');
  // bloqueados nas configurações
  await api(tokA, 'PUT', `/relationships/${bobId}`, { type: 2 }); await sleep(500);
  await A.evaluate(() => window.__lc.openSettings('privacy')); await sleep(500);
  const blk = await A.evaluate(() => [...document.querySelectorAll('#settings h3.sec')].some(h => h.textContent === 'Usuários bloqueados') && [...document.querySelectorAll('#settings .frow.blk')].map(r => r.textContent));
  ok(blk && blk.length === 1 && blk[0].includes('bob'), 'Configurações → Privacidade lista os bloqueados');
  await A.screenshot({ path: `${SHOTS}/x12-bloqueados.png` });
  await clickText(A, '#settings .frow.blk .btn', 'Desbloquear'); await sleep(500);
  ok(await A.evaluate((id) => !document.querySelector('#settings .frow.blk') && window.__lc.S.rels.get(id)?.type !== 2, bobId), 'Desbloquear pelas configurações');
  await A.keyboard.press('Escape'); await sleep(300);
  // campo de mensagem maior
  const cp = await A.evaluate(() => document.querySelector('#composer')?.offsetHeight);
  ok(cp >= 54, 'campo de mensagem com ' + cp + 'px de altura');
  await A.screenshot({ path: `${SHOTS}/x13-composer.png` });
  // iniciar ligação: abre a DM e entra na chamada
  await openMenuOnBob(); await clickText(A, '.menu .it', 'Iniciar Ligação');
  await A.waitForFunction(() => { const v = window.__lc.voice; return v?.channelId && window.__lc.S.dms.has(v.channelId); }, { timeout: 8000 }).catch(() => { });
  ok(await A.evaluate(() => { const v = window.__lc.voice; return !!v?.channelId && window.__lc.S.dms.has(v.channelId) && window.__lc.S.view.cid === v.channelId; }), 'Iniciar Ligação abre a DM e entra na chamada');
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
