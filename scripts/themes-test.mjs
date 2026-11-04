// Teste de temas em gradiente, código compartilhado no chat, qualidade da voz e avatares padrão
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3224, BASE = `http://localhost:${PORT}`, SHOTS = '.testshots';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.rmSync('.testdata4', { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata4', ...(process.env.RTC === '0' ? { RTC: '0' } : {}) }, stdio: 'ignore' });
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
  const info = await (await fetch(BASE + '/api/server-info')).json();
  const nums = info.default_avatars.map(u => parseInt(u.match(/\/avatars\/(\d+)\./)?.[1]));
  ok(nums.length >= 10 && nums.every((n, i) => n === i + 1), `avatares padrão 1–${nums.length} em ordem numérica (10 depois de 9, não depois de 1)`);

  const A = await newUser('alice'), B = await newUser('bob');
  const tokA = await A.evaluate(() => localStorage.lc_token);
  const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
  const g = await api(tokA, 'POST', '/guilds', { name: 'Servidor Teste' });
  const inv = await api(tokA, 'POST', `/guilds/${g.id}/invites`);
  await B.evaluate(async (code) => { await fetch('/api/invites/' + code, { method: 'POST', headers: { authorization: 'Bearer ' + localStorage.lc_token } }); }, inv.code);
  await sleep(600);
  const chans = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels, g.id);
  const text = chans.find(c => c.type === 0), vch = chans.find(c => c.type === 2);

  // galeria de temas
  await A.evaluate(() => window.__lc.openSettings?.('appearance'));
  if (!await A.$('#settings')) { await A.click('#userbar [title*="Configura"]').catch(() => { }); await sleep(300); await clickText(A, '#settings .ni', 'Aparência'); }
  await sleep(400);
  ok((await A.$$('.ncard.tgrad')).length >= 12, 'galeria mostra os temas em gradiente');
  await clickText(A, '.ncard.tgrad', 'Aurora'); await sleep(300);
  const st = await A.evaluate(() => ({ t: window.__lc.S.prefs.theme, grad: document.documentElement.classList.contains('grad'), bg: getComputedStyle(document.body).backgroundImage, base: document.documentElement.dataset.theme }));
  ok(st.t === 'g:aurora' && st.grad && st.bg.includes('linear-gradient') && st.base === 'dark', 'aplicar Aurora pinta o gradiente');
  await A.screenshot({ path: `${SHOTS}/t1-galeria.png` });

  // criar tema (painel lateral)
  await clickText(A, '.ncard.tnew', 'Criar tema'); await sleep(300);
  ok(!!await A.$('#tedit') && await A.$eval('#settings', e => e.classList.contains('hidden')), 'editor abre ao lado e esconde as configurações');
  await A.evaluate(() => { const i = document.querySelector('#tedit footer input'); i.value = 'Meu Roxo'; i.dispatchEvent(new Event('input')); });
  await clickText(A, '#tedit .tpills button', 'Claro');
  ok(await A.evaluate(() => document.documentElement.dataset.theme === 'light'), 'prévia ao vivo troca para a base clara');
  await clickText(A, '#tedit .btn', 'Adicionar cor'); await sleep(100);
  await A.evaluate(() => { const i = document.querySelector('#tedit .hexin'); i.value = '#CA4887'; i.dispatchEvent(new Event('input')); });
  const sv = await A.$('#tedit .cp-hue'); const bb = await sv.boundingBox(); await A.mouse.click(bb.x + bb.width * .75, bb.y + bb.height / 2);
  await A.evaluate(() => { const r = document.querySelectorAll('#tedit input[type=range]'); r[1].value = 80; r[1].dispatchEvent(new Event('input')); });
  ok(await A.evaluate(() => document.querySelectorAll('#tedit .gstop').length === 3 && getComputedStyle(document.documentElement).getPropertyValue('--gi').trim() === '0.70'), '3 cores, intensidade 80% aplicada na prévia');
  await A.screenshot({ path: `${SHOTS}/t2-editor.png` });
  await clickText(A, '#tedit .btn', 'Surpreenda-me'); await sleep(100);
  await A.screenshot({ path: `${SHOTS}/t2b-surpresa.png` });
  await clickText(A, '#tedit .btn', 'Redefinir'); await sleep(100);
  await A.evaluate(() => { const i = document.querySelector('#tedit footer input'); i.value = 'Meu Roxo'; i.dispatchEvent(new Event('input')); });
  await clickText(A, '#tedit .tpills button', 'Claro');
  await clickText(A, '#tedit .btn', 'Salvar e usar'); await sleep(300);
  const mine = await A.evaluate(() => ({ list: window.__lc.S.prefs.customThemes, t: window.__lc.S.prefs.theme, base: document.documentElement.dataset.theme, back: !document.getElementById('tedit') && !document.querySelector('#settings.hidden') }));
  ok(mine.list?.length === 1 && mine.t === 'c:' + mine.list[0].id && mine.base === 'light' && mine.back, 'tema salvo, aplicado e volta às configurações');
  await clickText(A, '.ncard.tnew', 'Criar tema'); await sleep(200);
  await clickText(A, '#tedit .tpills button', 'Escuro'); await A.keyboard.press('Escape'); await sleep(200);
  ok(await A.evaluate(() => !document.getElementById('tedit') && !!document.getElementById('settings') && document.documentElement.dataset.theme === 'light'), 'Esc no editor descarta a prévia e mantém as configurações abertas');
  await A.keyboard.press('Escape'); await sleep(300);
  await A.evaluate((gid, cid) => window.__lc.go?.(gid, cid), g.id, text.id); await sleep(500);
  await A.screenshot({ path: `${SHOTS}/t3-claro.png` });

  // compartilhar no chat
  const code = await A.evaluate(async () => (await window.__lc.import('themes.js')).encodeTheme(window.__lc.S.prefs.customThemes[0]));
  await api(tokA, 'POST', `/channels/${text.id}/messages`, { content: 'olha meu tema ' + code });
  await B.evaluate((gid, cid) => window.__lc.go?.(gid, cid), g.id, text.id); await sleep(800);
  ok(!!await B.$('.themeshare'), 'código no chat vira cartão de tema');
  await B.screenshot({ path: `${SHOTS}/t4-cartao.png` });
  await clickText(B, '.themeshare .btn', 'Usar tema'); await sleep(200); await clickText(B, '.themeshare .btn', 'Usar tema'); await sleep(300);
  const bt = await B.evaluate(() => ({ n: window.__lc.S.prefs.customThemes?.length, name: window.__lc.S.prefs.customThemes?.[0]?.name, t: window.__lc.S.prefs.theme }));
  ok(bt.n === 1 && bt.name === 'Meu Roxo' && bt.t.startsWith('c:'), '"Usar tema" aplica e não duplica');

  // tema do perfil
  await A.evaluate(() => window.__lc.openSettings('profile')); await sleep(400);
  await clickText(A, '.ptheme .pgal button', 'Yabba dabba'); await sleep(200);
  await A.evaluate(() => document.querySelector('#settings .content').scrollTo(0, 0)); await sleep(200);
  ok(await A.evaluate(() => { const b = document.querySelector('.savebar'), r = b.getBoundingClientRect(); return !b.classList.contains('hidden') && r.bottom <= innerHeight && r.top > 0; }), 'barra de salvar visível sem rolar até o fim');
  await A.screenshot({ path: `${SHOTS}/t6a-perfil-topo.png` });
  ok(await A.evaluate(() => { const c = document.querySelector('.preview .pcard'); return c?.classList.contains('themed') && c.classList.contains('tdark') && getComputedStyle(c).backgroundImage.includes('linear-gradient'); }), 'prévia do perfil com o tema Yabba dabba');
  await A.evaluate(() => { const i = document.querySelector('.ptheme .ppaste'); i.value = 'Primary Color #B884B3  Accent Color #593566'; i.dispatchEvent(new Event('input')); }); await sleep(200);
  ok(await A.evaluate(() => [...document.querySelectorAll('.ptheme .pcol input[type=text]')].map(i => i.value).join() === '#B884B3,#593566'), 'colar texto do discordthemes.com acha as duas cores');
  await A.evaluate(() => document.querySelector('.ptheme').scrollIntoView({ block: 'center' })); await sleep(200);
  await A.screenshot({ path: `${SHOTS}/t6-perfil-config.png` });
  await clickText(A, '.savebar .btn', 'Salvar'); await sleep(500);
  const me = await api(tokA, 'GET', '/users/' + (await A.evaluate(() => window.__lc.S.me.id)));
  const meTheme = await A.evaluate(() => [window.__lc.S.me.theme_primary, window.__lc.S.me.theme_accent].join());
  ok(meTheme === '#b884b3,#593566' || (me.theme_primary === '#b884b3' && me.theme_accent === '#593566'), 'tema do perfil salvo no servidor');
  const bad = await api(tokA, 'PATCH', '/me', { theme_primary: 'red;}', theme_accent: '#593566' });
  ok(bad.theme_primary === null && bad.theme_accent === null, 'servidor recusa cor inválida (zera o tema)');
  await api(tokA, 'PATCH', '/me', { theme_primary: '#b884b3', theme_accent: '#593566' });
  await A.keyboard.press('Escape'); await sleep(300);
  await B.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text.id); await sleep(800);
  await B.evaluate(() => [...document.querySelectorAll('#members .mem')].find(e => e.textContent.includes('alice'))?.click()); await sleep(600);
  ok(await B.evaluate(() => { const c = document.querySelector('.popout .pcard'); return !!c?.classList.contains('themed') && c.style.getPropertyValue('--tp') === '#b884b3'; }), 'bob vê o cartão da alice com o tema');
  await B.screenshot({ path: `${SHOTS}/t7-perfil-cartao.png` });
  await B.keyboard.press('Escape');

  // estilo do nome
  await A.evaluate(() => window.__lc.openSettings('profile')); await sleep(400);
  await clickText(A, '.nstyle .nsgrid button', 'Cursiva'); await sleep(100);
  await clickText(A, '.nstyle .nsgrid button', 'Gradiente'); await sleep(100);
  ok(await A.evaluate(() => { const n = document.querySelector('.preview .pcard h3 span.ns'); return !!n && n.classList.contains('nf-script') && n.classList.contains('ne-gradient') && getComputedStyle(n).backgroundImage.includes('gradient'); }), 'prévia mostra o nome em cursiva com gradiente');
  await A.evaluate(() => document.querySelector('.nstyle').scrollIntoView({ block: 'center' })); await sleep(200);
  await A.screenshot({ path: `${SHOTS}/t8-nome-config.png` });
  await clickText(A, '.savebar .btn', 'Salvar'); await sleep(500);
  const ns = (await api(tokA, 'PATCH', '/me', {})).name_style;
  ok(ns?.font === 'script' && ns?.effect === 'gradient' && /^#[0-9a-f]{6}$/.test(ns.c2), 'estilo do nome salvo no servidor');
  const evil = await api(tokA, 'PATCH', '/me', { name_style: { font: 'x;}', effect: 'neon', c1: 'url(x)', c2: '#00ff00' } });
  ok(evil.name_style?.font === 'default' && evil.name_style?.c1 === '#ffffff' && evil.name_style?.effect === 'neon', 'servidor limpa valores inválidos do estilo');
  await api(tokA, 'PATCH', '/me', { name_style: ns });
  await A.keyboard.press('Escape'); await sleep(300);
  await api(tokA, 'POST', `/channels/${text.id}/messages`, { content: 'nome estiloso' }); await sleep(800);
  ok(await B.evaluate(() => { const a = [...document.querySelectorAll('#msgs .author')].find(e => e.textContent === 'alice'); const m = [...document.querySelectorAll('#members .mnn')].find(e => e.textContent === 'alice'); return !!a?.classList.contains('ne-gradient') && !!m?.classList.contains('nf-script'); }), 'bob vê o nome estilizado no chat e na lista de membros');
  await B.screenshot({ path: `${SHOTS}/t9-nome-chat.png` });

  // qualidade da voz
  await B.evaluate(async () => { window.__lc.S.prefs.theme = 'g:sunset'; (await window.__lc.import('state.js')).applyTheme(); });
  for (const page of [A, B]) await page.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id);
  await sleep(600);
  for (const page of [A, B]) await page.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent))?.click());
  await sleep(3000);
  await B.waitForSelector('#vp-abr', { timeout: 8000 }).catch(async () => console.log('  diag', JSON.stringify(await B.evaluate(() => ({ active: window.__lc.voice?.active, ch: window.__lc.voice?.channelId, err: window.__lc.voice?.error, vp: !!document.getElementById('voice-panel'), html: document.getElementById('voice-panel')?.outerHTML.slice(0, 300) })))));
  ok((await B.$eval('#vp-abr', e => e.textContent).catch(() => '')).startsWith('Auto · 64k'), 'painel de voz mostra "Auto · 64k"');
  await sleep(4000);
  await B.click('#vp-abr'); await sleep(300);
  await clickText(B, '.qpop .seg button', '384 kbps'); await sleep(1500);
  const q = await B.evaluate(() => ({ badge: document.getElementById('vp-abr')?.textContent, pref: window.__lc.S.prefs.voiceBitrate }));
  ok(q.badge === '384k' && q.pref === 384, 'escolher 384 kbps atualiza o selo');
  await B.screenshot({ path: `${SHOTS}/t5-voz.png` });
  const enc = await B.evaluate(() => { const v = window.__lc.voice, s = v.sfu ? v.sfu.producers.mic?.rtpSender : [...v.peers.values()][0]?.senders.micaudio; return s?.getParameters().encodings[0]?.maxBitrate; });
  ok(enc === 384000, 'microfone enviando com teto de 384 kbps (' + enc + ')');
  const sdp = await A.evaluate(() => { const v = window.__lc.voice; const p = [...v.peers.values()][0]; return v.sfu ? 'sfu' : p?.pc.localDescription?.sdp || ''; });
  ok(sdp === 'sfu' || /maxaveragebitrate=384000/.test(sdp), 'SDP pede Opus até 384 kbps (' + (sdp === 'sfu' ? 'via SFU' : 'P2P') + ')');
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
