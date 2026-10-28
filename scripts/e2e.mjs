// Teste de ponta a ponta contra um servidor rodando. Uso: BASE=http://localhost:3111 node scripts/e2e.mjs
import WebSocket from 'ws';
const BASE = process.env.BASE || 'http://localhost:3000';
let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) fails++; };
const call = async (tok, method, path, body) => {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const sfx = Math.random().toString(36).slice(2, 7);
async function user(name) {
  const r = await call('', 'POST', '/register', { username: name + sfx, password: 'senha123' });
  return r.data.token;
}
function gateway(tok) {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok), q = [], waiters = [];
  ws.on('message', (raw) => { const m = JSON.parse(raw); const i = waiters.findIndex(w => w.t === m.t && (!w.f || w.f(m.d))); if (i >= 0) waiters.splice(i, 1)[0].res(m.d); else q.push(m); });
  return { ws, wait: (t, f, ms = 3000) => new Promise((res, rej) => { const i = q.findIndex(m => m.t === t && (!f || f(m.d))); if (i >= 0) return res(q.splice(i, 1)[0].d); const w = { t, f, res }; waiters.push(w); setTimeout(() => rej(new Error('timeout ' + t)), ms); }), send: (t, d) => ws.send(JSON.stringify({ t, d })) };
}

const ta = await user('alice'), tb = await user('bob');
const ga = gateway(ta), gb = gateway(tb);
const ra = await ga.wait('READY'), rb = await gb.wait('READY');
ok(ra.user.username === 'alice' + sfx, 'READY alice');

// servidor + convite
const g = (await call(ta, 'POST', '/guilds', { name: 'Teste' })).data;
const gc = await ga.wait('GUILD_CREATE');
ok(gc.channels.length === 4 && gc.id === g.id, 'servidor criado com 2 categorias + 2 canais');
const inv = (await call(ta, 'POST', `/guilds/${g.id}/invites`)).data;
ok(!!inv.code, 'convite gerado');
ok((await call('', 'GET', `/invites/${inv.code}`)).data.guild.name === 'Teste', 'convite público legível');
await call(tb, 'POST', `/invites/${inv.code}`);
const gcb = await gb.wait('GUILD_CREATE');
ok(gcb.members.length === 2, 'bob entrou via convite');
await ga.wait('MEMBER_ADD');

// mensagens
const text = gc.channels.find(c => c.type === 0), vch = gc.channels.find(c => c.type === 2);
const mp = ga.wait('MESSAGE_CREATE', d => d.type === 0), mpb = gb.wait('MESSAGE_CREATE', d => d.type === 0);
await call(ta, 'POST', `/channels/${text.id}/messages`, { content: `oi <@${rb.user.id}> **negrito**` });
const m1 = await mpb; await mp;
ok(m1.mentions.includes(rb.user.id), 'menção entregue ao bob');
const up = await call(tb, 'POST', `/channels/${text.id}/messages`, { content: 'resposta', reply_to: m1.id });
ok(up.data.reply?.id === m1.id, 'resposta referencia mensagem');
await call(tb, 'PUT', `/channels/${text.id}/messages/${m1.id}/reactions/${encodeURIComponent('👍')}`);
const upd = await gb.wait('MESSAGE_UPDATE');
ok(upd.reactions[0].emoji === '👍', 'reação');
ok((await call(tb, 'PATCH', `/channels/${text.id}/messages/${m1.id}`, { content: 'x' })).status === 403, 'bob não edita msg da alice');
ok((await call(tb, 'DELETE', `/channels/${text.id}/messages/${m1.id}`)).status === 403, 'bob sem permissão para apagar de outros');
ok((await call(tb, 'POST', `/guilds/${g.id}/channels`, { name: 'hack' })).status === 403, 'bob não cria canal');
ok((await call(ta, 'GET', `/search?q=negrito&guild=${g.id}`)).data.length === 1, 'busca');
const hist = (await call(tb, 'GET', `/channels/${text.id}/messages`)).data;
ok(hist.filter(m => m.type === 0).length === 2, 'histórico');

// cargo com permissão
const role = (await call(ta, 'POST', `/guilds/${g.id}/roles`, { name: 'Mod', perms: 8 })).data;
await call(ta, 'PATCH', `/guilds/${g.id}/members/${rb.user.id}`, { roles: [role.id] });
ok((await call(tb, 'DELETE', `/channels/${text.id}/messages/${m1.id}`)).status === 200, 'bob (Mod) apaga mensagem');

// DM + amizade
const dm = (await call(ta, 'POST', '/dms', { user_id: rb.user.id })).data;
ok(dm.recipients.length === 2, 'DM criada');
await call(ta, 'POST', `/channels/${dm.id}/messages`, { content: 'privado' });
ok((await call(tb, 'GET', `/channels/${dm.id}/messages`)).data.length === 1, 'bob lê DM');
const g3 = await user('carol'); ok((await call(g3, 'GET', `/channels/${dm.id}/messages`)).status === 404, 'terceiro não lê DM');
await call(ta, 'POST', '/relationships', { username: 'bob' + sfx });
await gb.wait('RELATIONSHIP', d => d.type === 3);
await call(tb, 'PUT', `/relationships/${ra.user.id}`, {});
const rel = await gb.wait('RELATIONSHIP', d => d.type === 1);
ok(rel.user.id === ra.user.id, 'amizade aceita');

// voz
ga.send('VOICE_JOIN', { channel_id: vch.id });
const j1 = await ga.wait('VOICE_JOINED'); ok(j1.peers.length === 0, 'alice entra na voz');
gb.send('VOICE_JOIN', { channel_id: vch.id });
const j2 = await gb.wait('VOICE_JOINED'); ok(j2.peers[0] === ra.user.id, 'bob vê alice na sala');
gb.send('VOICE_SIGNAL', { to: ra.user.id, data: { desc: { type: 'offer', sdp: 'x' } } });
const sig = await ga.wait('VOICE_SIGNAL'); ok(sig.from === rb.user.id, 'sinalização WebRTC retransmitida');
gb.send('VOICE_STATE', { screen: true });
const vs = await ga.wait('VOICE_STATE', d => d.screen === true); ok(vs.user_id === rb.user.id, 'estado de tela propagado');
// soundboard: relé para a sala + permissões
ga.send('SOUNDBOARD', { url: '/files/abc.wav', volume: 100, name: 'Bip', emoji: '🔔' });
const sb = await gb.wait('SOUNDBOARD'); ok(sb.user_id === ra.user.id && sb.url === '/files/abc.wav', 'soundboard relé para a sala');
ga.send('SOUNDBOARD', { url: 'http://evil/x.wav' }); await new Promise(r => setTimeout(r, 1400));
let bad = false; try { await gb.wait('SOUNDBOARD', null, 600); bad = true; } catch { } ok(!bad, 'soundboard rejeita URL externa');
ok((await call(tb, 'POST', `/guilds/${g.id}/sounds`, { name: 'x', url: '/files/a.wav' })).status === 403, 'membro comum não cria som do servidor');
const sres = await call(ta, 'POST', `/guilds/${g.id}/sounds`, { name: 'Som', emoji: '📣', url: '/files/a.wav', volume: 120 });
ok(!!sres.data.id, 'dono cria som do servidor'); const su = await gb.wait('SOUNDS_UPDATE'); ok(su.sounds.length === 1, 'membros recebem sons do servidor');
gb.ws.close(); const left = await ga.wait('VOICE_PEER_LEFT'); ok(left.user_id === rb.user.id, 'saída de voz ao desconectar');

// conta: configurações sincronizadas, sessões, username, privacidade, transferência, exclusão
await call(ta, 'PUT', '/me/settings', { settings: { theme: 'midnight', soundVolume: 42 } });
ok((await call(ta, 'GET', '/me/settings')).data.settings.theme === 'midnight', 'configurações sincronizadas na conta');
const ses = (await call(ta, 'GET', '/sessions')).data; ok(ses.length >= 1 && ses.some(s => s.current), 'lista de sessões');
ok((await call(ta, 'POST', '/me/username', { username: 'alice2' + sfx, password: 'errada' })).status === 403, 'trocar usuário exige a senha');
ok((await call(ta, 'POST', '/me/username', { username: 'alice2' + sfx, password: 'senha123' })).status === 200, 'trocar nome de usuário');
await call(g3, 'PUT', '/me/settings', { friend_policy: 'none' });
ok((await call(tb, 'POST', '/relationships', { username: 'carol' + sfx })).status === 403, 'privacidade: ninguém pode enviar pedido');
ok((await call(tb, 'PATCH', `/guilds/${g.id}`, { owner_id: rb.user.id })).status === 403, 'só o dono transfere o servidor');
ok((await call(ta, 'PATCH', `/guilds/${g.id}`, { owner_id: rb.user.id })).status === 200, 'dono transfere o servidor');
ok((await call(g3, 'POST', '/me/delete', { password: 'senha123' })).status === 200, 'excluir a própria conta');
ok((await call('', 'POST', '/login', { username: 'carol' + sfx, password: 'senha123' })).status === 401, 'conta excluída não entra mais');

// upload
const buf = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const upl = await fetch(BASE + '/api/upload?name=a.png', { method: 'POST', headers: { authorization: 'Bearer ' + ta, 'content-type': 'image/png' }, body: buf });
const file = await upl.json(); const got = await fetch(BASE + file.url);
ok(got.status === 200 && got.headers.get('content-type') === 'image/png', 'upload + download imagem');
const up2 = await (await fetch(BASE + '/api/upload?name=x.html', { method: 'POST', headers: { authorization: 'Bearer ' + ta }, body: '<script>1</script>' })).json();
const g2 = await fetch(BASE + up2.url); ok(g2.headers.get('content-disposition')?.includes('attachment'), 'html forçado a download (anti-XSS)');
ok((await fetch(BASE + '/api/channels/1/messages')).status === 401, 'API exige autenticação');

console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
