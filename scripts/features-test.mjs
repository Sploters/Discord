// Mensagem de voz, espectadores de transmissão e tradução. Uso: BASE=http://localhost:3000 node scripts/features-test.mjs
import WebSocket from 'ws';
const BASE = process.env.BASE || 'http://localhost:3000';
let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) fails++; };
const call = async (tok, method, path, body, raw) => {
  const r = await fetch(BASE + '/api' + path, { method, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), authorization: 'Bearer ' + tok }, body: raw ? body : body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const sfx = Math.random().toString(36).slice(2, 7);
const user = async (n) => (await call('', 'POST', '/register', { username: n + sfx, password: 'senha123' })).data.token;
function gateway(tok) {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok), q = [], waiters = [];
  ws.on('message', (raw) => { const m = JSON.parse(raw); const i = waiters.findIndex(w => w.t === m.t && (!w.f || w.f(m.d))); if (i >= 0) waiters.splice(i, 1)[0].res(m.d); else q.push(m); });
  const wait = (t, f, ms = 3000) => new Promise((res, rej) => { const i = q.findIndex(m => m.t === t && (!f || f(m.d))); if (i >= 0) return res(q.splice(i, 1)[0].d); const w = { t, f, res }; waiters.push(w); setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); rej(new Error('timeout ' + t)); } }, ms); });
  return { ws, wait, send: (t, d) => ws.send(JSON.stringify({ t, d })), ready: new Promise(r => ws.on('open', r)) };
}

const ta = await user('alice'), tb = await user('bob');
const ga = gateway(ta), gb = gateway(tb);
const ra = await ga.wait('READY'), rb = await gb.wait('READY');
const g = (await call(ta, 'POST', '/guilds', { name: 'Teste' })).data;
const gc = await ga.wait('GUILD_CREATE');
const inv = (await call(ta, 'POST', `/guilds/${g.id}/invites`)).data;
await call(tb, 'POST', `/invites/${inv.code}`); await gb.wait('GUILD_CREATE');
const text = gc.channels.find(c => c.type === 0), vch = gc.channels.find(c => c.type === 2);

// ---- mensagem de voz ----
const up = (await call(ta, 'POST', '/upload?name=mensagem-de-voz.webm', Buffer.from('fake-webm'), true)).data;
ok(up.url?.startsWith('/files/') && up.url.endsWith('.webm/mensagem-de-voz.webm'), 'upload da gravação');
const vm = (await call(ta, 'POST', `/channels/${text.id}/messages`, { content: '', attachments: [{ ...up, voice: true, duration: 4.2, waveform: 'AAECAwQFBgc=' }] })).data;
ok(vm.attachments?.[0]?.voice === true && vm.attachments[0].duration === 4.2 && vm.attachments[0].waveform === 'AAECAwQFBgc=', 'mensagem de voz guarda duração e forma de onda');
const bad = (await call(ta, 'POST', `/channels/${text.id}/messages`, { content: '', attachments: [{ ...up, voice: true, duration: 99999, waveform: '<script>' }] })).data;
ok(bad.attachments?.[0]?.duration === 3600 && bad.attachments[0].waveform === '', 'duração limitada e forma de onda inválida descartada');
const plain = (await call(ta, 'POST', `/channels/${text.id}/messages`, { content: '', attachments: [{ ...up, waveform: 'AAEC' }] })).data;
ok(plain.attachments?.[0]?.voice === undefined && plain.attachments[0].waveform === undefined, 'anexo comum não ganha campos de voz');
const hist = (await call(tb, 'GET', `/channels/${text.id}/messages`)).data;
ok(hist.find(m => m.id === vm.id)?.attachments[0].voice === true, 'bob lê a mensagem de voz no histórico');

// ---- espectadores ----
ga.send('VOICE_JOIN', { channel_id: vch.id }); gb.send('VOICE_JOIN', { channel_id: vch.id });
await ga.wait('VOICE_JOINED'); await gb.wait('VOICE_JOINED');
gb.send('STREAM_WATCH', { target: ra.user.id, watching: true });
await new Promise(r => setTimeout(r, 300));
ok(!(await ga.wait('STREAM_VIEWERS', null, 300).then(() => true, () => false)), 'sem transmissão ativa, ninguém vira espectador');
ga.send('VOICE_STATE', { screen: true }); await ga.wait('VOICE_STATE', d => d.user_id === ra.user.id && d.screen);
gb.send('STREAM_WATCH', { target: ra.user.id, watching: true });
const v1 = await ga.wait('STREAM_VIEWERS', d => d.viewers.length === 1);
ok(v1.streamer_id === ra.user.id && v1.viewers[0] === rb.user.id, 'alice vê que bob assiste');
gb.send('STREAM_WATCH', { target: ra.user.id, watching: false });
ok((await ga.wait('STREAM_VIEWERS', d => d.viewers.length === 0)).viewers.length === 0, 'bob para de assistir');
gb.send('STREAM_WATCH', { target: ra.user.id, watching: true }); await ga.wait('STREAM_VIEWERS', d => d.viewers.length === 1);
ga.send('VOICE_STATE', { screen: false });
ok((await gb.wait('STREAM_VIEWERS', d => d.viewers.length === 0)).streamer_id === ra.user.id, 'parar a transmissão zera os espectadores');
ga.send('VOICE_STATE', { screen: true }); await gb.wait('VOICE_STATE', d => d.user_id === ra.user.id && d.screen);
gb.send('STREAM_WATCH', { target: ra.user.id, watching: true }); await ga.wait('STREAM_VIEWERS', d => d.viewers.length === 1);
gb.send('VOICE_LEAVE', {});
ok((await ga.wait('STREAM_VIEWERS', d => d.viewers.length === 0)).viewers.length === 0, 'sair da sala remove o espectador');

// ---- tradução ----
const info = await call(ta, 'GET', '/translate/info');
ok(info.data.enabled === true, 'tradução ativa (' + info.data.engine + ')');
ok((await call(ta, 'POST', '/translate', { text: 'hello', to: 'x y' })).status === 502, 'idioma inválido recusado');
ok((await call(ta, 'POST', '/translate', { text: '   ', to: 'pt' })).status === 502, 'texto vazio recusado');
const tr = await call(ta, 'POST', '/translate', { text: 'Good morning, friends', to: 'pt' });
if (tr.status === 200) ok(/bom dia/i.test(tr.data.text) && tr.data.from === 'en', 'traduz en → pt: ' + tr.data.text);
else console.log('  skip  tradutor externo indisponível: ' + tr.data.error);

console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
