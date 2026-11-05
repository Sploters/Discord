// Teste da Fase 2 (Watch) contra um servidor real (ex.: Umbrel): 2 usuários em Edge headless, sala de voz, transmissão simulada
// (canvas animado no lugar do getDisplayMedia, sem capturar a tela de ninguém). Uso:
//   API=http://IP-DA-VPN:3000 UI=https://IP-DA-VPN:3443 node scripts/fase2-test.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const API = process.env.API || 'http://localhost:3000', UI = process.env.UI || API;
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = process.env.OUT || '.testshots/fase2-test.json';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = { checks: [], load: [], notes: {} };
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); results.checks.push({ ok: !!c, m, extra }); if (!c) fails++; };
const api = async (tok, method, path, body) => { const r = await fetch(API + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
const sfx = Math.random().toString(36).slice(2, 6);
const load = async (tok, tag) => { const r = await api(tok, 'GET', '/sfu/load'); if (r.status === 200) { const c = r.data.current; results.load.push({ tag, ...c, peak: r.data.peakCpuPercent }); console.log(`  [carga] ${tag}: cpu ${c.cpu}% rss ${c.rssMB}MB salas ${c.rooms} peers ${c.peers} transports ${c.transports} producers ${c.producers} consumers ${c.consumers}`); } return r; };

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--ignore-certificate-errors', '--disable-features=CalculateNativeWinOcclusion'] });
const fakeScreen = () => { // getDisplayMedia simulado: canvas animado 1280x720, conteúdo muda a cada quadro
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let n = 0;
    const draw = () => { n++; x.fillStyle = `hsl(${n * 3 % 360} 60% 40%)`; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#fff'; for (let i = 0; i < 20; i++) x.fillRect((n * 9 + i * 70) % 1200, (i * 37) % 650, 60, 60); x.font = '60px monospace'; x.fillText('frame ' + n, 40, 100); };
    draw(); setInterval(draw, 1000 / 30); return c.captureStream(30);
  };
};
async function session(name, token) {
  const ctx = await browser.createBrowserContext(), page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => { console.log('  PAGEERROR', name, e.message); results.notes['pageerror-' + name] = (results.notes['pageerror-' + name] || []).concat(e.message); });
  page.on('console', m => { if (m.type() === 'error') { const t = m.text().slice(0, 200); if (!/favicon|net::ERR_CERT/.test(t)) (results.notes['console-' + name] ||= []).push(t); } });
  await page.evaluateOnNewDocument(fakeScreen);
  await page.goto(UI, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('lc_token', t), token);
  await page.goto(UI, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rail .rail-wrap', { timeout: 20000 });
  return page;
}
const clickText = (page, sel, rx) => page.evaluate((sel, rx) => { const el = [...document.querySelectorAll(sel)].find(e => new RegExp(rx).test(e.textContent)); if (!el) return false; el.click(); return true; }, sel, rx);
const clickTitle = (page, rx) => page.evaluate((rx) => { const el = [...document.querySelectorAll('button')].find(e => new RegExp(rx).test(e.title)); if (!el) return false; el.click(); return true; }, rx);
// painel de layout (botão no topo do palco): abre, escolhe a miniatura pelo nome e fecha
const openLayout = async (page) => { if (!(await page.evaluate(() => !!document.querySelector('.layoutpop')))) { await page.evaluate(() => document.getElementById('vc-layout')?.click()); await sleep(200); } };
const setLayout = async (page, label) => { await openLayout(page); const r = await clickText(page, '.layoutpop .lopt .lname', '^' + label); await sleep(500); await page.keyboard.press('Escape'); await sleep(100); return r; };
const stageInfo = (page) => page.evaluate(() => ({ grid: !!document.querySelector('#stage .grid.fit'), spot: !!document.querySelector('#stage .spot'), strip: !!document.querySelector('#stage .strip'), split: !!document.querySelector('#stage .splitwrap'), side: !!document.querySelector('#stage .grid.sidebyside'), tiles: document.querySelectorAll('#stage .tile').length, screens: document.querySelectorAll('#stage .tile.screen').length }));
const recvSnap = (page, uid) => page.evaluate(async (uid) => { const s = await window.__lc.voice.streamStats(uid); const v = window.__lc.voice; return s ? { w: s.w, h: s.h, fps: s.fps, kbps: s.kbps, loss: s.loss, audio: s.audio, layer: s.layer, pref: s.layerPref, q: s.quality, auto: [...(v.autoPaused || [])] } : null; }, uid);
const decoded = (page, uid) => page.evaluate(async (uid) => { const p = window.__lc.voice.peers.get(uid); let n = 0; for (const [id, src] of p.consumers) if (src === 'screen') for (const r of (await window.__lc.voice.sfu.consumers.get(id).c.getStats()).values()) if (r.type === 'inbound-rtp') n = r.framesDecoded; return n; }, uid);

try {
  // ---------- 0. contas, servidor e permissões do /api/sfu/load ----------
  const ra = await api('', 'POST', '/register', { username: 'qa_a' + sfx, password: 'senha12345' }), rb = await api('', 'POST', '/register', { username: 'qa_b' + sfx, password: 'senha12345' });
  const ta = ra.data.token, tb = rb.data.token; ok(ta && tb, 'contas de teste criadas');
  const g = (await api(ta, 'POST', '/guilds', { name: 'QA Fase 2 ' + sfx })).data; const inv = (await api(ta, 'POST', `/guilds/${g.id}/invites`)).data;
  await api(tb, 'POST', `/invites/${inv.code}`);
  const owner = await load(ta, 'ocioso (antes da sala)');
  const member = await api(tb, 'GET', '/sfu/load'), anon = await api('', 'GET', '/sfu/load');
  ok(owner.status === 200 && member.status === 403 && anon.status === 401, '/api/sfu/load: dono 200, membro comum 403, sem login 401', { owner: owner.status, member: member.status, anon: anon.status });

  const A = await session('alice', ta), B = await session('bob', tb);
  const aid = await A.evaluate(() => window.__lc.S.me.id), bid = await B.evaluate(() => window.__lc.S.me.id);
  await sleep(1500);
  const chans = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels, g.id), vch = chans.find(c => c.type === 2);
  for (const p of [A, B]) await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id);
  await sleep(800);
  for (const p of [A, B]) await clickText(p, '#stage .btn', 'Entrar');
  await sleep(3000);
  ok(await A.evaluate(() => window.__lc.voice.active) && await B.evaluate(() => window.__lc.voice.active), 'alice e bob na sala de voz (SFU)');
  await load(ta, 'sala com 2 pessoas, só microfone');

  // ---------- 1. transmissão simulada (VP8 3 camadas) ----------
  if (process.env.CODEC !== 'native') await A.evaluate(() => { window.__lc.voice.hwH264 = async () => false; }); // força o caminho VP8 de 3 camadas (L1T3), o do problema investigado
  const tShare = Date.now();
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }).then(() => true));
  // bob precisa "abrir" a transmissão se vier fechada
  for (let i = 0; i < 80 && !(await B.evaluate((a) => !!window.__lc.voice.peers.get(a)?.streams.screen, aid)); i++) await sleep(100);
  if (await B.evaluate((a) => window.__lc.voice.closedStreams.has(a), aid)) { await B.evaluate((a) => window.__lc.voice.openStream(a), aid); }
  let t720 = null, first = null; for (let i = 0; i < 60; i++) { const s = await recvSnap(B, aid); if (s?.w && first === null) first = Date.now() - tShare; if (s?.w >= 1280) { t720 = Date.now() - tShare; break; } await sleep(250); }
  ok(t720 !== null, 'VP8: bob recebe a camada cheia (1280x720) logo no início', { primeiroQuadroMs: first, camadaCheiaMs: t720 });
  const codec = await A.evaluate(() => window.__lc.voice.sfu?.producers.screen?.rtpParameters?.codecs?.[0]?.mimeType);
  results.notes.codec = codec; console.log('  codec da transmissão:', codec); ok(/vp8/i.test(codec || '') || process.env.CODEC === 'native', 'transmissão usa VP8 (3 camadas)', codec);
  await A.evaluate(() => window.__lc.voice.toggleCam?.()).catch(() => { }); await sleep(2500);
  await load(ta, 'transmissão de tela + câmera (alice), bob assistindo');

  // repete 2x (parar/iniciar) para checar consistência da subida de camada
  const reps = [t720];
  for (let r = 0; r < 2; r++) {
    await A.evaluate(() => window.__lc.voice.stopLocal('screen')); await sleep(1500);
    const t0 = Date.now(); await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }).then(() => true));
    for (let i = 0; i < 80 && !(await B.evaluate((a) => !!window.__lc.voice.peers.get(a)?.streams.screen, aid)); i++) await sleep(100);
    if (await B.evaluate((a) => window.__lc.voice.closedStreams.has(a), aid)) await B.evaluate((a) => window.__lc.voice.openStream(a), aid);
    let t = null; for (let i = 0; i < 60; i++) { const s = await recvSnap(B, aid); if (s?.w >= 1280) { t = Date.now() - t0; break; } await sleep(250); } reps.push(t);
  }
  ok(reps.every(t => t !== null && t < 8000), 'VP8: camada cheia nas 3 repetições (parar/iniciar a transmissão)', reps);

  // ---------- 2. layouts nomeados ----------
  await B.evaluate((a) => { window.__lc.S.focus = null; }, aid); await sleep(300);
  const tiles0 = await stageInfo(B); ok(tiles0.tiles >= 3 && tiles0.screens === 1, 'palco com transmissão + participantes (>= 3 quadros)', tiles0);
  ok(await B.evaluate(() => !!document.getElementById('vc-layout')), 'botão de layout aparece com vários quadros');
  const L = {};
  for (const [lab, key] of [['Grade', 'grid'], ['Destaque', 'spot'], ['Principal', 'sidebar'], ['Lado a lado', 'side'], ['Cinema', 'cinema'], ['Autom', 'auto']]) { const clicked = await setLayout(B, lab); L[key] = { clicked, ...(await stageInfo(B)), pref: await B.evaluate(() => window.__lc.S.prefs.stageLayout) }; }
  ok(L.grid.grid && !L.grid.spot, 'layout Grade', L.grid); ok(L.spot.spot && L.spot.strip && !L.spot.split, 'layout Destaque + faixa', L.spot);
  ok(L.sidebar.split && L.sidebar.spot && L.sidebar.strip, 'layout Principal + miniaturas', L.sidebar); ok(L.side.side && !L.side.spot, 'layout Lado a lado', L.side);
  ok(L.cinema.spot && !L.cinema.strip && L.cinema.tiles === 1, 'layout Cinema (só 1 quadro)', L.cinema); ok(L.auto.grid && L.auto.pref === 'auto', 'volta ao Automático', L.auto);
  ok(['grid', 'spot', 'sidebar', 'side', 'cinema', 'auto'].every(k => L[k].pref === k), 'escolha gravada nas preferências em cada troca');
  // persistência: recarrega bob e vê se mantém
  await setLayout(B, 'Lado a lado'); await sleep(1500);
  const synced = await B.evaluate(async () => { const t = localStorage.lc_token; const r = await (await fetch('/api/me/settings', { headers: { authorization: 'Bearer ' + t } })).json(); return r.settings?.stageLayout || r.stageLayout || null; });
  ok(synced === 'side', 'layout sincronizado no servidor (preferências)', synced);
  await setLayout(B, 'Autom');

  // ---------- 3. painel de qualidade ----------
  ok(await clickTitle(B, '^Qualidade desta transmissão'), 'botão do painel de qualidade existe'); await sleep(3500);
  const panel = await B.evaluate(() => document.querySelector('.qstats .qs-body')?.textContent || '');
  ok(/FPS recebidos/.test(panel) && /\d+×\d+/.test(panel) && /Conexão/.test(panel) && /Áudio da transmissão/.test(panel), 'painel mostra resolução, FPS, conexão e áudio', panel);
  await clickText(B, '.qstats .qs-layer', '^Baixa$'); await sleep(4500);
  const low = await recvSnap(B, aid); ok(low && low.w <= 400, 'camada Baixa: recepção cai para ~320x180', low);
  await clickText(B, '.qstats .qs-layer', '^Alta$'); await sleep(4500);
  const high = await recvSnap(B, aid); ok(high && high.w >= 1280, 'camada Alta: recepção volta para 1280x720', high);
  await clickText(B, '.qstats .qs-layer', '^Auto$'); await sleep(500);
  await clickTitle(B, '^Qualidade desta transmissão'); await sleep(1500);
  ok(await B.evaluate(() => !document.querySelector('.qstats')), 'painel fecha');

  // ---------- 4. pausa automática fora da tela ----------
  await setLayout(B, 'Cinema'); await B.evaluate((a) => { window.__lc.S.focus = 'c:' + a; }, aid); await B.evaluate(() => window.__lc.go(window.__lc.S.view.gid, window.__lc.S.view.cid)); await sleep(400);
  const inDom = await B.evaluate(() => document.querySelectorAll('#stage .tile.screen').length);
  const f0 = await decoded(B, aid); await sleep(2000); const f1 = await decoded(B, aid), mid = await recvSnap(B, aid);
  ok(inDom === 0 && f1 - f0 > 20 && !mid.auto.includes(aid), 'aos 2 s fora da tela o vídeo ainda NÃO pausou (espera de 4 s)', { quadrosEm2s: f1 - f0 });
  await sleep(3500); const p0 = await decoded(B, aid); await sleep(2000); const p1 = await decoded(B, aid), pst = await recvSnap(B, aid);
  ok(pst.auto.includes(aid) && p1 - p0 <= 3, 'após ~5,5 s fora da tela o vídeo está pausado no servidor', { quadrosEm2s: p1 - p0, autoPaused: pst.auto });
  const aud = await B.evaluate((a) => { const p = window.__lc.voice.peers.get(a); return [...p.consumers.entries()].map(([id, s]) => s + ':' + (window.__lc.voice.sfu.consumers.get(id)?.c.paused ? 'local-pausado' : 'ativo')); }, aid);
  results.notes.consumersDuranteAPausa = aud;
  await setLayout(B, 'Autom'); await B.evaluate(() => { window.__lc.S.focus = null; window.__lc.go(window.__lc.S.view.gid, window.__lc.S.view.cid); });
  const tr = Date.now(); let resumed = null, base = await decoded(B, aid); for (let i = 0; i < 40; i++) { await sleep(100); if ((await decoded(B, aid)) - base > 5) { resumed = Date.now() - tr; break; } }
  ok(resumed !== null && resumed < 2500, 'retomada rápida ao voltar para a tela', { ms: resumed });
  // exceção: fora da sala (miniatura flutuante) não pausa
  const text = chans.find(c => c.type === 0); await setLayout(B, 'Cinema'); await B.evaluate((a) => { window.__lc.S.focus = 'c:' + a; }, aid);
  await B.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text.id); await sleep(6500);
  const outside = await recvSnap(B, aid); ok(!outside.auto.includes(aid), 'exceção: navegando em outro canal (janela flutuante) não pausa', outside.auto);
  await B.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(800);
  // exceção: PiP / tela cheia (simulados via document.* — o headless não abre PiP real)
  await B.evaluate(() => { Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, get: () => document.body }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(6500); const pip = await recvSnap(B, aid); ok(!pip.auto.includes(aid), 'exceção: Picture-in-Picture ativo não pausa (condição simulada)', pip.auto);
  await B.evaluate(() => { delete document.pictureInPictureElement; Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.body }); document.dispatchEvent(new Event('fullscreenchange')); });
  await sleep(1000); await B.evaluate(() => { delete document.fullscreenElement; });
  await setLayout(B, 'Autom'); await B.evaluate(() => { window.__lc.S.focus = null; window.__lc.go(window.__lc.S.view.gid, window.__lc.S.view.cid); }); await sleep(2500);

  // ---------- 5. destaque para todos ----------
  const spotBtn = (page) => clickTitle(page, '^(Destacar para todos|Parar de destacar)');
  await B.evaluate(() => { window.__lc.S.focus = null; window.__lc.renderVoiceUI?.(); });
  await A.evaluate(() => { const k = 's:' + window.__lc.S.me.id; window.__lc.S.ctlKey = k; }); await spotBtn(A); await sleep(1500);
  const s1 = { a: await A.evaluate(() => window.__lc.S.room?.spot), b: await B.evaluate(() => ({ spot: window.__lc.S.room?.spot, focus: window.__lc.S.focus })) };
  ok(s1.a === 's:' + aid && s1.b.spot === 's:' + aid && s1.b.focus === 's:' + aid, 'destaque da alice aparece sincronizado e o bob passa a acompanhar', s1);
  ok(await B.evaluate(() => !!document.querySelector('#stage .tile.spotlit')), 'quadro destacado recebe o contorno (spotlit)');
  await spotBtn(A); await sleep(1200);
  const s2 = await B.evaluate(() => ({ spot: window.__lc.S.room?.spot, focus: window.__lc.S.focus })); ok(s2.spot === null && s2.focus === null, 'remover o destaque limpa para todos', s2);
  // bob desliga o acompanhamento
  await openLayout(B); await B.evaluate(() => [...document.querySelectorAll('.layoutpop .lrow')].find(r => /Acompanhar destaques/.test(r.textContent))?.querySelector('.switch')?.click()); await sleep(500); await B.keyboard.press('Escape');
  ok(await B.evaluate(() => window.__lc.S.prefs.followSpot === false), 'bob desativa "Acompanhar destaques"');
  await spotBtn(A); await sleep(1500);
  const s3 = await B.evaluate(() => ({ spot: window.__lc.S.room?.spot, focus: window.__lc.S.focus })); ok(s3.spot === 's:' + aid && s3.focus === null, 'com o acompanhamento desligado o bob recebe o estado mas NÃO muda o foco', s3);
  // transmissor interrompe a transmissão
  await A.evaluate(() => window.__lc.voice.stopLocal('screen')); await sleep(2000);
  const s4 = { a: await A.evaluate(() => window.__lc.S.room?.spot), b: await B.evaluate(() => window.__lc.S.room?.spot) }; ok(s4.a === null && s4.b === null, 'transmissor interrompe a transmissão: destaque é limpo para todos', s4);
  // transmissor destacado sai da sala
  await B.evaluate(() => { window.__lc.S.prefs.followSpot = true; });
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }).then(() => true)); await sleep(2500);
  await A.evaluate(() => { window.__lc.S.ctlKey = 's:' + window.__lc.S.me.id; }); await spotBtn(A); await sleep(1500);
  const s5 = await B.evaluate(() => window.__lc.S.room?.spot); ok(s5 === 's:' + aid, 'destaque reativado antes da saída', s5);
  await A.evaluate(() => window.__lc.voice.leave()); await sleep(2500);
  const s6 = await B.evaluate(() => window.__lc.S.room?.spot ?? null); ok(s6 === null, 'transmissor destacado sai da sala: destaque é limpo', s6);
  await load(ta, 'após a alice sair (bob sozinho)');
} catch (e) { console.log('ERRO NO TESTE', e); fails++; results.notes.erro = String(e.stack || e); }
finally {
  results.fails = fails; fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  console.log(`\n${fails ? fails + ' FALHA(S)' : 'tudo ok'} — resultados em ${OUT}`);
  if (results.notes['pageerror-alice'] || results.notes['pageerror-bob']) console.log('page errors:', JSON.stringify([results.notes['pageerror-alice'], results.notes['pageerror-bob']]));
  await browser.close(); process.exit(fails ? 1 : 0);
}
