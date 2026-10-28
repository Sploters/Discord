// Teste de UI com Edge/Chrome headless (2 usuários, voz WebRTC, ruído RNNoise, transmissão de tela)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3222, BASE = `http://localhost:${PORT}`, SHOTS = '.testshots';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.rmSync('.testdata2', { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata2' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
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
try {
  const A = await newUser('alice'), B = await newUser('bob');
  await sleep(500); await A.screenshot({ path: `${SHOTS}/01-home.png` });
  ok(await A.evaluate(() => !!window.__lc.S.me), 'alice logada, UI montada');

  const tokA = await A.evaluate(() => localStorage.lc_token);
  const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
  const g = await api(tokA, 'POST', '/guilds', { name: 'Servidor Teste' });
  const inv = await api(tokA, 'POST', `/guilds/${g.id}/invites`);
  await B.evaluate(async (code) => { const t = localStorage.lc_token; await fetch('/api/invites/' + code, { method: 'POST', headers: { authorization: 'Bearer ' + t } }); }, inv.code);
  await sleep(800);
  const gid = g.id;
  const chans = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels, gid);
  const text = chans.find(c => c.type === 0), vch = chans.find(c => c.type === 2);
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), gid, text.id); await B.evaluate((gid, cid) => window.__lc.go(gid, cid), gid, text.id);
  await sleep(800);
  await A.type('#composer textarea', 'Olá **mundo** `código` :fire: ||spoiler||'); await A.keyboard.press('Enter');
  await sleep(600);
  ok(await B.evaluate(() => !!document.querySelector('.msg .body b')), 'mensagem com markdown chegou no bob');
  await B.screenshot({ path: `${SHOTS}/02-chat.png` });

  for (const page of [A, B]) await page.evaluate((gid, cid) => window.__lc.go(gid, cid), gid, vch.id);
  await sleep(600);
  await A.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent)).click());
  await sleep(3000);
  const errA = await A.evaluate(() => window.__lc.voice.error);
  ok(!errA, 'alice entrou na voz sem erro de mic/IA' + (errA ? ' — ' + errA : ''));
  ok(await A.evaluate(() => window.__lc.voice.micGraph?.processed === true), 'cadeia RNNoise ativa (processed)');
  await B.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent)).click());
  await sleep(5000);
  // SFU: estado dos 2 transportes com o servidor; malha: de cada RTCPeerConnection
  const conn = (p) => p.evaluate(() => { const v = window.__lc.voice; return v.sfu ? [v.sfu.send, v.sfu.recv].map(t => t?.connectionState || 'new') : [...v.peers.values()].map(x => x.pc.connectionState + '/' + x.pc.iceConnectionState); });
  ok(await A.evaluate(() => !!window.__lc.voice.sfu) === (process.env.RTC !== '0'), 'modo de voz: ' + (process.env.RTC === '0' ? 'malha P2P' : 'SFU'));
  for (let i = 0; i < 30 && !((await conn(A)).some(x => x.startsWith('connected')) && (await conn(B)).some(x => x.startsWith('connected'))); i++) await sleep(500);
  const cA = await conn(A), cB = await conn(B);
  ok(cA.some(x => x.startsWith('connected')), 'WebRTC conectado (alice) ' + JSON.stringify(cA));
  ok(cB.some(x => x.startsWith('connected')), 'WebRTC conectado (bob) ' + JSON.stringify(cB));
  if (!cB.some(x => x.startsWith('connected'))) console.log('  diag', JSON.stringify(await Promise.all([A, B].map(p => p.evaluate(() => ({ err: window.__lc.voice.error, mic: !!window.__lc.voice.mic, ch: window.__lc.voice.channelId, peers: window.__lc.voice.peers.size, states: [...window.__lc.S.voice.values()].length }))))));
  const bytes = await B.evaluate(async () => { let n = 0; const v = window.__lc.voice; for (const pc of v.sfu ? [v.sfu.recv] : [...v.peers.values()].map(p => p.pc)) for (const r of (await pc.getStats()).values()) if (r.type === 'inbound-rtp' && r.kind === 'audio') n += r.bytesReceived; return n; });
  ok(bytes > 1000, `áudio fluindo para o bob (${bytes} bytes)`);
  await A.screenshot({ path: `${SHOTS}/03-voice.png` });

  // transmissão de tela: getDisplayMedia substituído por canvas (headless não tem seletor de tela)
  await A.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let t = 0;
    setInterval(() => { x.fillStyle = `hsl(${t++ % 360},70%,40%)`; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#fff'; x.font = '80px sans-serif'; x.fillText('TELA ' + t, 100, 300); }, 33);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(30);
  });
  await A.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(b => b.title.includes('Transmitir')).click());
  await sleep(600); await A.screenshot({ path: `${SHOTS}/04-share-modal.png` });
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(b => /Transmitir/.test(b.textContent)).click());
  await sleep(4500);
  ok(await B.evaluate(() => !!window.__lc.voice.peers.values().next().value?.streams.screen), 'bob recebeu stream de tela');
  ok(await B.evaluate(() => { const v = document.querySelector('.tile.screen video'); return !!v && v.videoWidth > 0; }), 'vídeo da tela renderizando no bob');
  const br = await A.evaluate(() => { const v = window.__lc.voice, s = v.sfu ? v.sfu.producers.screen?.rtpSender : v.peers.values().next().value.senders.screenvideo; return s && Math.max(...s.getParameters().encodings.map(e => e.maxBitrate || 0)); });
  ok(br > 1e6, `bitrate da transmissão configurado (${br})`);
  let w=0;for(let i=0;i<30&&w<640;i++){await sleep(500);w=await B.evaluate(()=>document.querySelector('.tile.screen video')?.videoWidth||0);}
  ok(w>=640,'resolução da transmissão sobe para '+w+'px de largura');
  await B.screenshot({ path: `${SHOTS}/05-share-view.png` });

  await A.evaluate(async () => { window.__lc.S.prefs.noiseMode = 'gtcrn'; await window.__lc.voice.rebuildMic(); });
  await sleep(1500);
  ok(await A.evaluate(() => window.__lc.voice.micGraph?.processed === true && !window.__lc.voice.error), 'troca ao vivo para GTCRN');
  await A.evaluate(async () => { window.__lc.S.prefs.noiseMode = 'rnnoise'; await window.__lc.voice.rebuildMic(); });

  // ---- sons de interface: cada ação deve disparar um oscilador ----
  await A.evaluate(() => { window.__osc = 0; const o = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function () { window.__osc++; return o.call(this); }; });
  const osc = () => A.evaluate(() => window.__osc);
  let n0 = await osc(); await A.evaluate(() => window.__lc.voice.toggleMute()); await sleep(300); ok(await osc() > n0, 'som ao silenciar');
  n0 = await osc(); await A.evaluate(() => window.__lc.voice.toggleMute()); await sleep(300); ok(await osc() > n0, 'som ao reativar microfone');
  n0 = await osc(); await A.evaluate(() => window.__lc.voice.toggleDeaf()); await sleep(300); ok(await osc() > n0, 'som ao ensurdecer');
  await A.evaluate(() => window.__lc.voice.toggleDeaf()); await sleep(200);
  n0 = await osc(); await B.evaluate(() => window.__lc.voice.toggleCam?.().catch(() => { })); await sleep(1200); ok(await osc() > n0, 'som quando outra pessoa liga a câmera');
  await B.evaluate(() => window.__lc.voice.cam && window.__lc.voice.toggleCam()); await sleep(500);

  // ---- soundboard: pessoal e do servidor, tocando para a sala ----
  const wav = await A.evaluate(async () => { const sr = 8000, n = 2400, b = new ArrayBuffer(44 + n * 2), v = new DataView(b); const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0))); w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true); for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 6) * 12000, true); const r = await fetch('/api/upload?name=beep.wav', { method: 'POST', headers: { authorization: 'Bearer ' + localStorage.lc_token, 'content-type': 'audio/wav' }, body: b }); return (await r.json()).url; });
  ok(!!wav, 'áudio de teste enviado');
  await B.evaluate(() => { window.__plays = []; const A0 = window.Audio; window.Audio = function (u) { window.__plays.push(u); return new A0(u); }; window.Audio.prototype = A0.prototype; });
  await A.evaluate((u) => { window.__lc.S.prefs.mySounds = [{ id: 'm1', name: 'Bip', emoji: '🔔', url: u, vol: 100 }]; }, wav);
  await A.evaluate(() => document.querySelector('#userbar button[title="Soundboard"]').click()); await sleep(500);
  await A.evaluate(() => [...document.querySelectorAll('.sbtabs button')].find(b => /Meus/.test(b.textContent))?.click()); await sleep(300);
  await A.screenshot({ path: `${SHOTS}/07-soundboard.png` });
  await A.evaluate(() => document.querySelector('.sbtn')?.click()); await sleep(1200);
  ok((await B.evaluate(() => window.__plays)).includes(wav), 'som do soundboard tocou para a outra pessoa na sala');
  await A.keyboard.press('Escape'); await A.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await api(tokA, 'POST', `/guilds/${gid}/sounds`, { name: 'Do servidor', emoji: '📣', url: wav, volume: 120 }); await sleep(500);
  ok(await B.evaluate((gid) => window.__lc.S.guilds.get(gid).sounds.length === 1, gid), 'som do servidor chegou aos membros');

  // ---- painéis rápidos: dispositivos, ruído, eco e status ----
  await A.evaluate(() => document.querySelectorAll('#userbar .ibtn.caret')[0].click()); await sleep(500);
  await A.screenshot({ path: `${SHOTS}/08-quick-input.png` });
  await A.evaluate(() => [...document.querySelectorAll('.quick .seg button')].find(b => /Padrão/.test(b.textContent)).click()); await sleep(1200);
  ok(await A.evaluate(() => window.__lc.S.prefs.noiseMode === 'standard'), 'troca de ruído pelo painel rápido');
  const echo0 = await A.evaluate(() => window.__lc.S.prefs.echo !== false);
  await A.evaluate(() => document.querySelector('.quick .qrow .switch').click()); await sleep(300);
  ok(await A.evaluate(() => (window.__lc.S.prefs.echo !== false)) !== echo0, 'eco ligado/desligado pelo painel rápido');
  const nDev = await A.evaluate(() => document.querySelectorAll('.quick .dev').length);
  ok(nDev >= 2, `dispositivos de entrada listados no painel (${nDev})`);
  await A.evaluate(() => [...document.querySelectorAll('.quick .dev')][1]?.click()); await sleep(1500);
  ok(await A.evaluate(() => !!window.__lc.S.prefs.inputId) && !(await A.evaluate(() => window.__lc.voice.error)), 'troca de dispositivo de entrada ao vivo');
  await A.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))); await sleep(200);
  await A.evaluate(() => document.querySelectorAll('#userbar .ibtn.caret')[1].click()); await sleep(400);
  await A.screenshot({ path: `${SHOTS}/09-quick-output.png` });
  await A.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))); await sleep(200);
  await A.evaluate(() => document.querySelector('#userbar .me').click()); await sleep(400);
  await A.screenshot({ path: `${SHOTS}/10-status-panel.png` });
  await A.evaluate(() => [...document.querySelectorAll('.quick .stat')].find(b => /Ausente/.test(b.textContent)).click()); await sleep(600);
  ok(await A.evaluate(() => window.__lc.S.me.status === 'idle'), 'status "Ausente" pelo painel rápido');
  await A.evaluate(() => [...document.querySelectorAll('.quick .stat')].find(b => /Invisível/.test(b.textContent)).click()); await sleep(600);
  ok(await B.evaluate(() => { const u = [...window.__lc.S.users.values()].find(u => u.username === 'alice'); return u.status === 'offline'; }), 'invisível: aparece offline para os outros');
  await A.evaluate(() => [...document.querySelectorAll('.quick .stat')].find(b => /Online/.test(b.textContent)).click()); await sleep(400);
  await A.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));

  // ---- todas as páginas de configurações (usuário e servidor) ----
  const userPages = ['account', 'profile', 'privacy', 'appearance', 'accessibility', 'voice', 'stream', 'sounds', 'soundboard', 'notifications', 'keys', 'advanced'];
  for (const k of userPages) {
    await A.evaluate((k) => window.__lc.openSettings(k), k); await sleep(500);
    const info = await A.evaluate(() => ({ kids: document.querySelector('#settings .pane').children.length, h2: document.querySelector('#settings .pane h2')?.textContent }));
    ok(info.kids > 0 && !!info.h2, `página de configurações "${k}" renderizou (${info.h2})`);
    if (['account', 'profile', 'voice', 'sounds', 'appearance', 'keys'].includes(k)) await A.screenshot({ path: `${SHOTS}/11-settings-${k}.png` });
    await A.keyboard.press('Escape'); await sleep(150);
  }
  await A.evaluate((gid) => window.__lc.openSettings('server'), gid); await sleep(500);
  const navCount = await A.evaluate(() => document.querySelectorAll('#settings .ni').length);
  for (let i = 0; i < navCount; i++) {
    await A.evaluate((i) => document.querySelectorAll('#settings .ni')[i].click(), i); await sleep(350);
    const t = await A.evaluate(() => document.querySelector('#settings .pane h2')?.textContent);
    ok(!!t, `página do servidor "${t}"`);
    if (i === 0) await A.screenshot({ path: `${SHOTS}/12-settings-server.png` });
  }
  await A.keyboard.press('Escape');
  await A.setViewport({ width: 1000, height: 640 }); await A.evaluate(() => window.__lc.openSettings('voice')); await sleep(500);
  await A.screenshot({ path: `${SHOTS}/13-settings-small.png` }); await A.keyboard.press('Escape');
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
console.log(fails ? `\n${fails} FALHA(S)` : '\nUI OK');
await browser.close(); srv.kill(); process.exit(fails ? 1 : 0);
