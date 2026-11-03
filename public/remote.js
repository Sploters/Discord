// Controle remoto (só mouse e teclado). Dois papéis:
//  - quem ASSISTE pede o controle no quadro da transmissão e, aceito, controla clicando e digitando dentro dele;
//  - quem TRANSMITE recebe o pedido, escolhe o que libera (mouse, teclado) e vê um aviso permanente enquanto durar.
// A injeção acontece só no app desktop do dono (programa nativo); o navegador comum só pode controlar, nunca ser controlado.
import { h, icon } from './util.js';
import { S, toast, modal, desktop } from './state.js';
import { playSound } from './sounds.js';

let ctx = {}; // injetado por app.js: send(t, d), name(uid), rerender()
export const initRemote = (c) => { ctx = c; };
const REASON = { declined: 'recusou o pedido de controle', unsupported: 'não pode ser controlado (só pelo app para Windows, transmitindo a tela inteira)', stream_ended: 'parou de transmitir', left: 'saiu da sala', panic: 'parou o controle remoto', stopped: 'encerrou o controle remoto' };
export const session = () => S.remote || null;
export const controlling = (uid) => { const s = S.remote; return !!s && s.state === 'active' && s.controller === S.me.id && s.owner === uid; };
export const pendingFor = (uid) => { const s = S.remote; return !!s && s.state === 'pending' && s.controller === S.me.id && s.owner === uid; };

// ---------- quem assiste ----------
export function requestControl(uid) {
  if (S.remote) return toast('Já existe uma sessão de controle remoto', true);
  // primeira vez: explica o que é, os riscos com anti-cheat e as limitações antes de pedir
  if (S.prefs.remoteIntroSeen) return ctx.send('REMOTE_REQUEST', { to: uid });
  modal('Pedir controle remoto', null, h('div.rmask',
    h('p', `Você vai pedir para controlar o mouse e/ou o teclado de ${ctx.name(uid)} pela transmissão. A pessoa escolhe o que liberar e pode parar quando quiser.`),
    antiCheatWarning([]), limitations()),
    [{ label: 'Cancelar', cls: 'grey' }, { label: 'Pedir controle', fn: () => { S.prefs.remoteIntroSeen = true; ctx.savePrefs?.(); ctx.send('REMOTE_REQUEST', { to: uid }); } }]);
}
export function stopControl() { if (S.remote) ctx.send('REMOTE_STOP', { id: S.remote.id }); }

// botão nos controles do quadro da transmissão
export function tileButton(uid) {
  const on = controlling(uid), wait = pendingFor(uid);
  return h('button.ibtn' + (on ? '.rec' : ''), { title: on ? 'Parar de controlar' : wait ? 'Aguardando a resposta…' : 'Pedir controle (mouse e teclado)', disabled: wait,
    onclick: (e) => { e.stopPropagation(); on ? stopControl() : requestControl(uid); } }, icon('pointer', 18));
}

// eventos capturados no quadro -> fila -> servidor (movimento agrupado a cada 16 ms)
let queue = [], lastMove = null, flushTimer = 0, kbOn = false;
const keysDown = new Set(), btnsDown = new Set();
const push = (e) => { if (e.k === 'm') { lastMove = e; } else { if (lastMove) { queue.push(lastMove); lastMove = null; } queue.push(e); } if (!flushTimer) flushTimer = setTimeout(flush, 16); };
function flush() {
  flushTimer = 0; if (lastMove) { queue.push(lastMove); lastMove = null; }
  const s = S.remote; if (!s || s.state !== 'active' || !queue.length) { queue = []; return; }
  while (queue.length) ctx.send('REMOTE_INPUT', { id: s.id, ev: queue.splice(0, 64) });
}
// ponto do vídeo (0..1) sob o cursor, descontando as faixas pretas do object-fit: contain
function norm(video, cx, cy) {
  const r = video.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh || !r.width || !r.height) return null;
  const s = Math.min(r.width / vw, r.height / vh), w = vw * s, hh = vh * s, x0 = r.left + (r.width - w) / 2, y0 = r.top + (r.height - hh) / 2;
  const x = (cx - x0) / w, y = (cy - y0) / hh;
  return x < 0 || y < 0 || x > 1 || y > 1 ? null : { x, y };
}
const videoOf = (t) => t?.closest?.('.tile.screen')?.querySelector('video');
const ownerTile = (t) => { const tile = t?.closest?.('.tile.screen'); return tile && controlling(tile.dataset.sid) ? tile : null; };
const releaseAll = () => { for (const c of keysDown) push({ k: 'ku', c }); keysDown.clear(); for (const b of btnsDown) push({ k: 'u', b }); btnsDown.clear(); };
function setKb(on) {
  if (kbOn === on) return; kbOn = on; if (!on) releaseAll();
  document.querySelectorAll('.tile.screen.controlling').forEach(t => t.classList.toggle('kbcap', on));
}
// tudo no modo captura: o clique dentro do quadro não troca o foco nem abre menus da página
const opts = { capture: true, passive: false };
addEventListener('pointermove', (e) => { const t = ownerTile(e.target); if (!t || !S.remote?.perms.mouse) return; const p = norm(videoOf(t), e.clientX, e.clientY); if (p) push({ k: 'm', ...p }); }, opts);
addEventListener('pointerdown', (e) => {
  const t = ownerTile(e.target); if (!t) { setKb(false); return; }
  if (e.target.closest('.tctl, .remote-chip, button')) return; // botões do próprio quadro continuam funcionando
  e.preventDefault(); e.stopPropagation(); setKb(true);
  if (!S.remote.perms.mouse || e.button > 2) return;
  const p = norm(videoOf(t), e.clientX, e.clientY); if (!p) return;
  push({ k: 'm', ...p }); push({ k: 'd', b: e.button }); btnsDown.add(e.button);
}, opts);
addEventListener('pointerup', (e) => { if (!btnsDown.has(e.button)) return; e.preventDefault(); e.stopPropagation(); btnsDown.delete(e.button); push({ k: 'u', b: e.button }); }, opts);
addEventListener('click', (e) => { if (ownerTile(e.target) && !e.target.closest('.tctl, .remote-chip, button')) { e.preventDefault(); e.stopPropagation(); } }, opts);
addEventListener('dblclick', (e) => { if (ownerTile(e.target)) { e.preventDefault(); e.stopPropagation(); } }, opts);
addEventListener('contextmenu', (e) => { if (ownerTile(e.target)) { e.preventDefault(); e.stopPropagation(); } }, opts);
addEventListener('wheel', (e) => {
  const t = ownerTile(e.target); if (!t || !S.remote?.perms.mouse) return;
  e.preventDefault(); e.stopPropagation();
  const f = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1.2; // pixels/linhas/páginas -> unidades do Windows (120 por "dente")
  const cl = (v) => Math.max(-2400, Math.min(2400, Math.round(v * f)));
  if (e.deltaX || e.deltaY) push({ k: 'w', dx: cl(e.deltaX), dy: cl(e.deltaY) });
}, opts);
const keyHandler = (down) => (e) => {
  if (!kbOn || !S.remote || S.remote.state !== 'active' || S.remote.controller !== S.me.id) return;
  if (!S.remote.perms.keyboard || !e.code) return;
  e.preventDefault(); e.stopPropagation();
  if (down) { if (e.repeat && keysDown.has(e.code)) { push({ k: 'kd', c: e.code }); return; } keysDown.add(e.code); push({ k: 'kd', c: e.code }); }
  else if (keysDown.delete(e.code)) push({ k: 'ku', c: e.code });
};
addEventListener('keydown', keyHandler(true), true);
addEventListener('keyup', keyHandler(false), true);
addEventListener('blur', () => { if (S.remote) { setKb(false); releaseAll(); flush(); } });

// ---------- quem transmite ----------
let askDlg = null, askTimer = 0;
async function onRequest(s) {
  const who = ctx.name(s.controller);
  const cap = desktop?.remoteCapable ? await desktop.remoteCapable() : { ok: false, reason: 'O controle remoto só funciona no app LocalCord para Windows.' };
  if (!cap.ok) { ctx.send('REMOTE_ANSWER', { id: s.id, accept: false, capable: false }); toast(`${who} pediu para controlar seu PC, mas não é possível: ${cap.reason}`, true); return; }
  playSound('ring');
  const mouse = h('input', { type: 'checkbox', checked: true }), kb = h('input', { type: 'checkbox', checked: true });
  const answer = (accept) => { clearTimeout(askTimer); askDlg = null; ctx.send('REMOTE_ANSWER', { id: s.id, accept, mouse: mouse.checked, keyboard: kb.checked, capable: true }); };
  askDlg = modal(`${who} quer controlar seu PC`, null, h('div.rmask',
    h('p', `${who} vai poder mexer no seu computador pela transmissão, como se estivesse sentado aí. Só aceite se confiar nessa pessoa.`),
    h('label.rmopt', mouse, h('span', h('b', 'Mouse'), h('small', 'mover, clicar, arrastar e rolar'))),
    h('label.rmopt', kb, h('span', h('b', 'Teclado'), h('small', 'digitar e usar atalhos'))),
    antiCheatWarning(cap.antiCheats || []),
    h('ul.rmnotes',
      h('li', 'Para parar a qualquer momento: botão ', h('b', 'Parar'), ' no aviso vermelho ou ', h('b', 'Ctrl+Alt+Shift+Q'), ' (só o seu teclado aciona).'),
      h('li', 'Acaba sozinho se alguém sair da sala ou você parar de transmitir.')),
    limitations()),
    [{ label: 'Recusar', cls: 'grey', fn: () => answer(false) }, { label: 'Permitir', cls: 'red', fn: () => { if (!mouse.checked && !kb.checked) { toast('Escolha mouse e/ou teclado', true); return false; } answer(true); } }]);
  askTimer = setTimeout(() => { askDlg?.close?.(); askDlg = null; }, 30000); // o servidor também expira o pedido
}
desktop?.onRemoteEvent?.((k) => {
  if (k === 'panic' && S.remote?.owner === S.me.id) ctx.send('REMOTE_STOP', { id: S.remote.id, reason: 'panic' });
  if (k === 'blocked') toast('O Windows bloqueou o controle: a janela em foco foi aberta como administrador.', true);
});

// jogos com anti-cheat: a entrada injetada pode ser ignorada ou tratada como trapaça (risco de banimento da conta do dono)
export function antiCheatWarning(found) {
  const hot = found.length > 0;
  return h('div.rmwarn' + (hot ? '.hot' : ''),
    h('b', hot ? `Anti-cheat rodando agora: ${found.join(', ')}` : 'Cuidado com jogos com anti-cheat'),
    h('p', 'Jogos online com anti-cheat (Valorant, League of Legends, Fortnite, Apex, PUBG, Rainbow Six, CS2 com FACEIT, Call of Duty, Battlefield e outros) podem ', h('b', 'ignorar'), ' os comandos do controle remoto ou considerá-los ', h('b', 'trapaça'), '. Quem corre risco de suspensão ou banimento é a conta do jogo ', h('b', 'neste PC'), ', não a de quem controla.'),
    h('p', hot ? 'Recomendado: recuse, ou feche o jogo antes de permitir.' : 'Recomendado: não use com esses jogos abertos. Para ajudar alguém com o PC (programas, configurações, jogos sem anti-cheat) não há problema.'));
}
// o que o controle remoto não faz (aparece no pedido e no "saiba mais")
export function limitations() {
  return h('details.rmlimits', h('summary', 'Limitações'),
    h('ul',
      h('li', 'Só funciona transmitindo a ', h('b', 'tela inteira'), ' pelo app para Windows (não uma janela, nem pelo navegador).'),
      h('li', 'Programas abertos ', h('b', 'como administrador'), ' não recebem os comandos (regra do Windows); você vê um aviso quando acontecer.'),
      h('li', 'Jogos em ', h('b', 'tela cheia exclusiva'), ' podem não receber os comandos e às vezes aparecem pretos na transmissão; use "janela sem bordas".'),
      h('li', h('b', 'Ctrl+Alt+Del'), ' e a tela de bloqueio/UAC do Windows não podem ser controlados.'),
      h('li', 'Há um pequeno atraso: os comandos passam pelo servidor. Bom para ajudar; para jogar à distância pode não ser ideal.'),
      h('li', 'Só mouse e teclado: controle de videogame ainda não é suportado.'),
      h('li', 'Com vários monitores, só o monitor transmitido é controlado.')));
}

// ---------- eventos do servidor ----------
export function onRemoteEvent(t, d) {
  if (t === 'REMOTE_REQUEST') return onRequest(d);
  if (t === 'REMOTE_ERROR') return toast(d.error, true);
  if (t === 'REMOTE_INPUT') { if (S.remote?.id === d.id && S.remote.owner === S.me.id) desktop?.remoteInput?.(d.ev); return; }
  if (t !== 'REMOTE_STATE') return;
  const mine = d.owner === S.me.id, other = ctx.name(mine ? d.controller : d.owner);
  if (d.state === 'ended') {
    const was = S.remote; S.remote = null; setKb(false); queue = []; lastMove = null;
    if (mine) { desktop?.remoteStop?.(); askDlg?.close?.(); askDlg = null; }
    if (was?.id === d.id || !was) {
      const r = d.reason || 'stopped';
      if (mine) { if (was?.state === 'active') toast('Controle remoto encerrado'); } // recusar/expirar o pedido: quem recusou não precisa de aviso
      else toast(`${other} ${REASON[r] || 'encerrou o controle remoto'}`, r !== 'stopped' && r !== 'panic');
    }
  } else {
    const before = S.remote; S.remote = d;
    if (d.state === 'active' && before?.state !== 'active') {
      if (mine) {
        desktop?.remoteStart?.({ who: other, perms: d.perms }).then(r => { if (!r?.ok) { toast(r?.reason || 'Não foi possível iniciar o controle remoto', true); ctx.send('REMOTE_STOP', { id: d.id }); } });
      } else toast(`${other} liberou o ${d.perms.mouse && d.perms.keyboard ? 'mouse e o teclado' : d.perms.mouse ? 'mouse' : 'teclado'}. Clique na transmissão para controlar. Evite jogos com anti-cheat.`);
    }
  }
  paintChip(); ctx.rerender();
}
function paintChip() { document.getElementById('remote-chip')?.remove(); const c = remoteBar(); if (c) { c.id = 'remote-chip'; document.body.append(c); } }

// aviso dentro do app (os dois lados); o dono também tem o aviso nativo sempre por cima
export function remoteBar() {
  const s = S.remote; if (!s || s.state !== 'active') return null;
  const mine = s.owner === S.me.id, who = ctx.name(mine ? s.controller : s.owner);
  const what = s.perms.mouse && s.perms.keyboard ? 'mouse e teclado' : s.perms.mouse ? 'mouse' : 'teclado';
  return h('div.remote-chip' + (mine ? '.owner' : ''), h('i'), h('span', mine ? `${who} está controlando seu ${what}` : `Você está controlando o PC de ${who} (${what})`),
    h('button.btn.red.sm', { onclick: (e) => { e.stopPropagation(); stopControl(); } }, 'Parar'));
}
