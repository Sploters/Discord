// Controle remoto (Fase 3, só mouse e teclado). O servidor é o porteiro:
// - a sessão nasce de um PEDIDO de quem assiste e só vale depois do CONSENTIMENTO do dono da tela (no cliente dele);
// - permissões separadas (mouse, teclado), escolhidas pelo dono;
// - cada evento é validado (formato, faixa, tamanho) e só passa se vier do controlador daquela sessão, com taxa limitada;
// - acaba na hora quando qualquer um para, sai da sala, desconecta ou o dono para de transmitir.
// A injeção em si acontece só no app desktop do dono (programa nativo), nunca no navegador.

export const REMOTE_PENDING_MS = 30 * 1000;
const MAX_EVENTS_PER_MSG = 64;
const RATE = 400, BURST = 800; // eventos por segundo (movimento já chega agrupado ~60/s)
const KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,23}$/; // KeyboardEvent.code (ex.: KeyA, Digit1, ArrowLeft, F5)

// valida e normaliza um evento; null = descartado
export function cleanEvent(e, perms) {
  if (!e || typeof e !== 'object') return null;
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  switch (e.k) {
    case 'm': { if (!perms.mouse) return null; const x = num(e.x, 0, 1), y = num(e.y, 0, 1); return x === null || y === null ? null : { k: 'm', x: Math.round(x * 1e5) / 1e5, y: Math.round(y * 1e5) / 1e5 }; }
    case 'd': case 'u': { if (!perms.mouse) return null; const b = num(e.b, 0, 2); return b === null || !Number.isInteger(b) ? null : { k: e.k, b }; }
    case 'w': { if (!perms.mouse) return null; const dx = num(e.dx ?? 0, -2400, 2400), dy = num(e.dy ?? 0, -2400, 2400); return dx === null || dy === null || (!dx && !dy) ? null : { k: 'w', dx: Math.round(dx), dy: Math.round(dy) }; }
    case 'kd': case 'ku': { if (!perms.keyboard) return null; return typeof e.c === 'string' && KEY_RE.test(e.c) ? { k: e.k, c: e.c } : null; }
    default: return null;
  }
}

export function createRemote({ voiceOf, sendUser, now = () => Date.now(), newId }) {
  const sessions = new Map(); // id -> { id, owner, controller, cid, perms, state, created, bucket, last }
  const pub = (s, reason) => ({ id: s.id, owner: s.owner, controller: s.controller, channel_id: s.cid, perms: s.perms, state: s.state, ...(reason ? { reason } : {}) });
  const tell = (s, reason) => { const p = pub(s, reason); sendUser(s.owner, 'REMOTE_STATE', p); sendUser(s.controller, 'REMOTE_STATE', p); };
  const live = (s) => s.state === 'pending' ? now() - s.created < REMOTE_PENDING_MS : s.state === 'active';
  const of = (uid) => [...sessions.values()].filter(s => live(s) && (s.owner === uid || s.controller === uid));
  const end = (s, reason) => { if (s.state === 'ended') return; s.state = 'ended'; sessions.delete(s.id); tell(s, reason); };

  function request(from, to) {
    for (const s of sessions.values()) if (!live(s)) sessions.delete(s.id);
    const a = voiceOf(from), b = voiceOf(to);
    if (!to || to === from) return { error: 'Pedido inválido' };
    if (!a || !b || a.cid !== b.cid) return { error: 'Vocês precisam estar na mesma sala de voz' };
    if (!b.screen) return { error: 'A pessoa precisa estar transmitindo a tela' };
    if (of(to).length) return { error: 'Essa pessoa já está numa sessão de controle remoto' };
    if (of(from).length) return { error: 'Você já está numa sessão de controle remoto' };
    const s = { id: newId(), owner: to, controller: from, cid: a.cid, perms: { mouse: false, keyboard: false }, state: 'pending', created: now(), bucket: BURST, last: now() };
    sessions.set(s.id, s);
    sendUser(to, 'REMOTE_REQUEST', pub(s));
    sendUser(from, 'REMOTE_STATE', pub(s));
    return { session: pub(s) };
  }

  // resposta do dono (no cliente dele). Sem o programa nativo (navegador comum), o cliente responde capable:false.
  function answer(uid, id, { accept, mouse, keyboard, capable }) {
    const s = sessions.get(String(id));
    if (!s || s.owner !== uid || s.state !== 'pending' || !live(s)) return { error: 'Pedido não encontrado ou expirado' };
    if (!accept) { end(s, capable === false ? 'unsupported' : 'declined'); return {}; }
    const perms = { mouse: !!mouse, keyboard: !!keyboard };
    if (!perms.mouse && !perms.keyboard) { end(s, 'declined'); return {}; }
    const v = voiceOf(uid);
    if (!v || v.cid !== s.cid || !v.screen) { end(s, 'stream_ended'); return {}; }
    s.perms = perms; s.state = 'active'; s.bucket = BURST; s.last = now();
    tell(s);
    return { session: pub(s) };
  }

  // eventos do controlador -> dono; o que não passa é descartado em silêncio (o retorno conta, para testes)
  function input(uid, id, events) {
    const s = sessions.get(String(id));
    if (!s || s.state !== 'active' || s.controller !== uid) return { dropped: Array.isArray(events) ? events.length : 0, sent: 0 };
    if (!Array.isArray(events)) return { dropped: 1, sent: 0 };
    const t = now(); s.bucket = Math.min(BURST, s.bucket + (t - s.last) / 1000 * RATE); s.last = t;
    const out = [];
    for (const e of events.slice(0, MAX_EVENTS_PER_MSG)) {
      if (s.bucket < 1) break;
      const c = cleanEvent(e, s.perms); if (!c) continue;
      s.bucket -= 1; out.push(c);
    }
    if (out.length) sendUser(s.owner, 'REMOTE_INPUT', { id: s.id, ev: out });
    return { sent: out.length, dropped: events.length - out.length };
  }

  function stop(uid, id, reason = 'stopped') {
    const s = sessions.get(String(id));
    if (!s || (s.owner !== uid && s.controller !== uid)) return { error: 'Sessão não encontrada' };
    end(s, uid === s.owner && reason === 'panic' ? 'panic' : 'stopped'); return {}; // "panic" = atalho de emergência no PC do dono
  }
  // saiu da sala, desconectou ou parou de transmitir: encerra o que envolver a pessoa
  function onLeave(uid) { for (const s of of(uid)) end(s, 'left'); }
  function onScreenOff(uid) { for (const s of of(uid)) if (s.owner === uid) end(s, 'stream_ended'); }

  return { request, answer, input, stop, onLeave, onScreenOff, _sessions: sessions };
}
