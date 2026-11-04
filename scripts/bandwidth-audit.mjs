// Banda e latência numa call: N pessoas (microfone falso tocando sem parar = pior caso, ninguém em silêncio),
// espera o "Auto" da voz se ajustar, e mede por pessoa: kbps enviados (voz), kbps recebidos, protocolo e RTT até o
// servidor, atraso do buffer de recepção; e o total que sai do servidor (soma do que todos recebem).
// Uso: node scripts/bandwidth-audit.mjs [rótulo]  (N=4, WAIT=40)  -> .testshots/banda-<rótulo>.json
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3271, BASE = `http://localhost:${PORT}`, LABEL = process.argv[2] || 'atual', N = +(process.env.N || 4), WAIT = +(process.env.WAIT || 40);
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata24', { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata24', RTC_PORT: '41070', RTC_IPS: '127.0.0.1' }, stdio: process.env.DEBUG_SCORE ? ['ignore', 'inherit', 'inherit'] : 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const R = { label: LABEL, n: N, wait: WAIT };
try {
  const us = []; for (let i = 0; i < N; i++) us.push(await reg('user' + i));
  const g = await call(us[0].tok, 'POST', '/guilds', { name: 'Turma' }); const inv = (await call(us[0].tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of us.slice(1)) await call(u.tok, 'POST', '/invites/' + inv);
  const pages = [];
  for (const u of us) {
    const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1200, height: 800 });
    await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, u.tok);
    await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); pages.push(p);
  }
  const vch = await pages[0].evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const p of pages) {
    await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(200);
    await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await p.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 });
  }
  console.log(`  ${N} pessoas na call; esperando ${WAIT} s para o "Auto" da voz se ajustar…`);
  await sleep(WAIT * 1000);
  const snap = (p) => p.evaluate(async () => {
    const v = window.__lc.voice, s = v.sfu; let out = 0, inn = 0, proto = '', rtt = null, jbd = 0, jbe = 0, conc = null;
    for (const t of [s.send, s.recv]) for (const r of (await t.getStats()).values()) {
      if (r.type === 'outbound-rtp' && r.kind === 'audio') out += r.bytesSent;
      if (r.type === 'inbound-rtp' && r.kind === 'audio') { inn += r.bytesReceived; jbd += r.jitterBufferDelay || 0; jbe += r.jitterBufferEmittedCount || 0; conc ??= r.concealedSamples; }
      if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') { rtt = r.currentRoundTripTime; }
      if (r.type === 'local-candidate' && r.candidateType) proto = r.protocol;
    }
    return { t: performance.now(), out, inn, rtt, proto, jbd, jbe, kbpsSetting: v.micKbps(), stereo: null };
  });
  const a = await Promise.all(pages.map(snap)); await sleep(10000); const b = await Promise.all(pages.map(snap));
  R.users = b.map((x, i) => { const dt = (x.t - a[i].t) / 1000; return { voiceSetting: x.kbpsSetting, sendKbps: Math.round((x.out - a[i].out) * 8 / dt / 1000), recvKbps: Math.round((x.inn - a[i].inn) * 8 / dt / 1000), proto: x.proto, rttMs: x.rtt != null ? Math.round(x.rtt * 1000) : null, jitterBufferMs: x.jbe - a[i].jbe > 0 ? Math.round((x.jbd - a[i].jbd) / (x.jbe - a[i].jbe) * 1000) : null }; });
  R.serverOutKbps = R.users.reduce((n, u) => n + u.recvKbps, 0);
  R.serverInKbps = R.users.reduce((n, u) => n + u.sendKbps, 0);
  // projeção para salas maiores com o mesmo kbps por pessoa (todo mundo falando ao mesmo tempo = pior caso)
  const per = R.users[0].sendKbps; R.projection = Object.fromEntries([5, 8, 10, 15].map(n => [n + ' pessoas', `${Math.round(per * n * (n - 1) / 1000 * 10) / 10} Mbps saindo do servidor`]));
} catch (e) { R.error = String(e); console.log('ERRO', e); }
finally { await browser.close(); srv.kill(); fs.writeFileSync(`.testshots/banda-${LABEL}.json`, JSON.stringify(R, null, 2)); console.log(JSON.stringify(R, null, 1)); setTimeout(() => process.exit(0), 300); }
