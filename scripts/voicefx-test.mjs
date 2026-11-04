// Efeitos de voz: processamento (cada efeito em um tom de 220 Hz: não fica mais alto, tom muda onde deve) e o fluxo
// na call (escolher no painel, quem ouve aplica, indicador, "ouvir sem efeito" por pessoa e geral, atalho, servidor
// recusa efeito desconhecido). Uso: node scripts/voicefx-test.mjs  (SHOTS=1 salva capturas em .testshots/voicefx)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3249, BASE = `http://localhost:${PORT}`, OUT = '.testshots/voicefx';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const FXN = ['robo', 'grossa', 'esquilo', 'monstro', 'alien', 'radio', 'megafone', 'eco', 'estadio'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata17', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata17', RTC_PORT: '41030', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function page(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p;
}
try {
  const a = await reg('alice'), b = await reg('bruno');
  const A = await page(a.tok), B = await page(b.tok);
  // ---------- processamento ----------
  const dsp = await A.evaluate(async () => {
    const { FX, createFx, loadFx } = await window.__lc.import('voicefx.js');
    const out = {};
    for (const f of [{ id: 'nenhum' }, ...FX, { id: 'nenhum', key: 'tom', tone: true }, { id: 'grossa', key: 'tomGrossa', tone: true }, { id: 'esquilo', key: 'tomEsquilo', tone: true }, { id: 'eco', key: 'tomEco', tone: true }]) {
      const ctx = new OfflineAudioContext(1, 48000 * 2, 48000); await loadFx(ctx);
      const o = ctx.createOscillator(); o.type = f.tone ? 'sine' : 'sawtooth'; o.frequency.value = f.tone ? 220 : 150; /* dente de serra ~ voz (cheia de harmônicos) */ const g = ctx.createGain(); g.gain.value = 0.5; o.connect(g);
      const fx = createFx(ctx, f.id); g.connect(fx.input); fx.output.connect(ctx.destination); o.start();
      const buf = await ctx.startRendering(), d = buf.getChannelData(0).subarray(48000 * 0.5); // ignora o começo
      let peak = 0, sum = 0, zc = 0; for (let i = 0; i < d.length; i++) { peak = Math.max(peak, Math.abs(d[i])); sum += d[i] * d[i]; if (i && (d[i - 1] < 0) !== (d[i] < 0)) zc++; }
      out[f.key || f.id] = { rms: +Math.sqrt(sum / d.length).toFixed(3), peak: +peak.toFixed(2), hz: Math.round(zc / 2 / (d.length / 48000)) };
    }
    return out;
  });
  const base = dsp.nenhum.rms, lv = Object.fromEntries(FXN.map(k => [k, +(dsp[k].rms / base).toFixed(2)]));
  ok(FXN.every(k => lv[k] >= 0.55), 'todos os efeitos com volume parecido com a voz normal (nada some)', lv);
  ok(FXN.every(k => lv[k] <= 1.2), 'nenhum efeito deixa a voz mais alta que a normal (e o limitador ainda segura no fim)', lv);
  ok(Math.abs(dsp.tomGrossa.hz - 220 * 0.72) < 25, 'voz grossa: tom ~28% mais baixo', dsp.tomGrossa.hz);
  ok(Math.abs(dsp.tomEsquilo.hz - 220 * 1.65) < 40, 'esquilo: tom ~65% mais alto', dsp.tomEsquilo.hz);
  ok(Math.abs(dsp.tom.hz - 220) < 5 && Math.abs(dsp.tomEco.hz - 220) < 15, 'sem efeito / eco: mesmo tom', { normal: dsp.tom.hz, eco: dsp.tomEco.hz });
  // ---------- na call ----------
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Turma' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(b.tok, 'POST', '/invites/' + inv);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) {
    await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 15000 });
  }
  await B.waitForFunction((uid) => !!window.__lc.voice.peers.get(uid)?.audioEl, { timeout: 15000 }, a.id);
  // alice escolhe Robô pelo botão do painel de voz
  await A.evaluate(() => [...document.querySelectorAll('#voice-panel .row button')].find(x => /Efeitos de voz/.test(x.title)).click()); await sleep(300);
  ok(await A.evaluate(() => document.querySelectorAll('.fxpicker .fxopt').length) === 10, 'seletor com "Sem efeito" + 9 efeitos');
  await A.evaluate(() => [...document.querySelectorAll('.fxpicker .fxopt')].find(x => /Robô/.test(x.textContent)).click()); await sleep(300);
  if (process.env.SHOTS) await A.screenshot({ path: `${OUT}/01-seletor.png` });
  await B.waitForFunction((uid) => window.__lc.S.voice.get(uid)?.fx === 'robo', { timeout: 5000 }, a.id).catch(() => { });
  await sleep(800);
  const st1 = await B.evaluate((uid) => { const p = window.__lc.voice.peers.get(uid), bo = p?.audioElBoost; return { fx: bo?.fx, node: !!bo?.fxNode, badge: [...document.querySelectorAll('.vuser')].find(r => r.dataset.uid === uid)?.querySelector('.fxb svg.fxicon') ? 'icone' : null }; }, a.id);
  ok(st1.fx === 'robo' && st1.node && st1.badge === 'icone', 'bruno ouve alice com o efeito (aplicado no app dele) e vê o ícone do efeito ao lado do nome', st1);
  ok(await A.evaluate(() => !!document.querySelector('#voice-panel .row button.fxon svg.fxicon')) === true, 'botão da alice mostra o efeito ligado');
  // bruno desliga só a alice
  await B.evaluate((uid) => [...document.querySelectorAll('.vuser')].find(r => r.dataset.uid === uid).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 })), a.id); await sleep(300);
  if (process.env.SHOTS) await B.screenshot({ path: `${OUT}/02-menu-ouvir-sem.png` });
  await B.evaluate(() => [...document.querySelectorAll('.menu .it')].find(x => /Ouvir sem efeito/.test(x.textContent)).click()); await sleep(400);
  ok(await B.evaluate((uid) => window.__lc.voice.peers.get(uid).audioElBoost.fx, a.id) === null, '"Ouvir sem efeito de voz" (só a alice): bruno ouve normal');
  await B.evaluate((uid) => { delete window.__lc.S.prefs.noFxUsers[uid]; window.__lc.voice.applyVolume(uid); }, a.id); await sleep(300);
  await B.evaluate(() => { window.__lc.S.prefs.hearFx = false; for (const u of window.__lc.voice.peers.keys()) window.__lc.voice.applyVolume(u); }); await sleep(300);
  ok(await B.evaluate((uid) => window.__lc.voice.peers.get(uid).audioElBoost.fx, a.id) === null, '"Ouvir efeitos dos outros" desligado: ninguém com efeito');
  await B.evaluate(() => { window.__lc.S.prefs.hearFx = true; for (const u of window.__lc.voice.peers.keys()) window.__lc.voice.applyVolume(u); }); await sleep(300);
  // ouvir a própria voz
  await A.evaluate(() => window.__lc.voice.setMonitor(true)); await sleep(500);
  ok(await A.evaluate(() => !!window.__lc.voice._mon), '"Ouvir minha voz" liga o retorno com o efeito');
  await A.evaluate(() => window.__lc.voice.setMonitor(false));
  // atalho desliga e liga de novo o último efeito
  await A.evaluate(() => document.activeElement?.blur()); await A.keyboard.down('Control'); await A.keyboard.down('Shift'); await A.keyboard.press('KeyE'); await A.keyboard.up('Shift'); await A.keyboard.up('Control');
  await B.waitForFunction((uid) => !window.__lc.S.voice.get(uid)?.fx, { timeout: 5000 }, a.id).catch(() => { });
  ok(await B.evaluate((uid) => !window.__lc.S.voice.get(uid)?.fx && window.__lc.voice.peers.get(uid).audioElBoost?.fx == null, a.id), 'Ctrl+Shift+E desliga o efeito para todos');
  await sleep(600);
  await A.keyboard.down('Control'); await A.keyboard.down('Shift'); await A.keyboard.press('KeyE'); await A.keyboard.up('Shift'); await A.keyboard.up('Control');
  ok(await B.waitForFunction((uid) => window.__lc.S.voice.get(uid)?.fx === 'robo', { timeout: 5000 }, a.id).then(() => true, () => false), 'apertar de novo liga o último efeito (Robô)');
  // servidor recusa efeito desconhecido
  await sleep(600); await A.evaluate(() => window.__lc.voice.send('VOICE_STATE', { fx: '<script>' })); await sleep(600);
  ok(await B.evaluate((uid) => window.__lc.S.voice.get(uid)?.fx ?? null, a.id) === null, 'efeito desconhecido vira "sem efeito" no servidor');
  if (process.env.SHOTS) { await A.evaluate(() => window.__lc.voice.setFx('alien')); await sleep(800); await B.screenshot({ path: `${OUT}/03-sala.png` }); }
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
