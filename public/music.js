// Bot de música: painel com fila, controles e volume do bot (o áudio chega como um participante da sala).
import { h, icon } from './util.js';
import { S, toast, popout } from './state.js';
import { slider } from './ui.js';

let send = () => { }, state = null, redraw = null, rid = 0;
const waiting = new Map();
const recvAt = { t: 0 };

export const initMusic = (gwSend) => { send = gwSend; };
export const musicState = () => state;

export function onState(d) {
  if (!d.active) { if (state && d.notice) toast(d.notice); state = d.channel_id ? { channel_id: d.channel_id, active: false } : null; }
  else { state = d; recvAt.t = Date.now(); if (d.notice) toast(d.notice, true); }
  redraw?.();
  document.dispatchEvent(new Event('music-changed'));
}
export function onRes(d) {
  const w = waiting.get(d.rid); if (!w) return;
  waiting.delete(d.rid); d.error ? w.reject(new Error(d.error)) : w.resolve(d.data);
}
export const musicCmd = (op, extra = {}) => new Promise((resolve, reject) => {
  const id = ++rid; waiting.set(id, { resolve, reject });
  send('MUSIC', { rid: id, op, ...extra });
  setTimeout(() => { if (waiting.delete(id)) reject(new Error('Sem resposta do servidor')); }, 60_000);
});
const act = (op, extra) => musicCmd(op, extra).catch(e => toast(e.message, true));

const fmt = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const who = (id) => S.users.get(id)?.display_name || 'alguém';
const elapsedNow = () => state?.current ? (state.elapsed + (state.paused ? 0 : Date.now() - recvAt.t)) / 1000 : 0;

export function openMusic(anchor, voice) {
  const body = h('div.mupanel');
  const input = h('input.muin', { placeholder: 'Link (YouTube, Spotify, SoundCloud…) ou nome da música', maxlength: 500 });
  const addBtn = h('button.btn', 'Tocar');
  let busy = false;
  const add = async () => {
    const q = input.value.trim(); if (!q || busy) return;
    busy = true; addBtn.disabled = true; addBtn.textContent = 'Buscando…';
    try { const r = await musicCmd('play', { query: q }); input.value = ''; toast(r.added > 1 ? `${r.added} músicas adicionadas` : `Adicionada: ${r.title}`); }
    catch (e) { toast(e.message, true); }
    busy = false; addBtn.disabled = false; addBtn.textContent = 'Tocar';
  };
  addBtn.onclick = add; input.onkeydown = (e) => { if (e.key === 'Enter') add(); e.stopPropagation(); };

  const bar = h('div.mufill'), time = h('span.mutime', '0:00');
  const tick = () => {
    if (!document.body.contains(body)) return clearInterval(iv);
    const c = state?.current; if (!c) return;
    const el = Math.min(elapsedNow(), c.duration || Infinity);
    bar.style.width = c.duration ? (el / c.duration * 100) + '%' : '0%';
    time.textContent = `${fmt(el)} / ${c.duration ? fmt(c.duration) : '∞'}`;
  };
  const iv = setInterval(tick, 500);

  const ctl = (label, title, fn, cls = '') => h('button.mubtn' + cls, { title, onclick: fn }, label);
  const draw = () => {
    const inRoom = voice?.active && state?.channel_id === voice.channelId;
    const kids = [h('div.muhead', h('b', icon('music', 18), 'Música'), state?.active && h('small', 'sai sozinho após alguns minutos parado')), h('div.muadd', input, addBtn)];
    if (!state?.active) kids.push(h('div.muempty', 'O bot ainda não está na sala. Cole um link ou digite o nome de uma música e ele entra para tocar.'));
    else {
      const c = state.current;
      kids.push(c ? h('div.munow',
        c.thumb ? h('img', { src: c.thumb, alt: '' }) : h('div.muthumb', icon('music', 28)),
        h('div.mumeta', h('b', { title: c.title }, c.title), h('small', [c.artist, `pedido por ${who(c.by)}`].filter(Boolean).join(' • ')), h('div.mubar', bar), time))
        : h('div.muempty', 'Nada tocando. Adicione uma música acima.'));
      kids.push(h('div.mubtns',
        c && ctl(icon(state.paused ? 'play' : 'pause', 18), state.paused ? 'Continuar' : 'Pausar', () => act(state.paused ? 'resume' : 'pause')),
        c && ctl(icon('skip', 18), 'Pular', () => act('skip')),
        c && ctl(icon('stop', 18), 'Parar e limpar a fila', () => act('stop')),
        state.queue.length > 1 && ctl(icon('shuffle', 18), 'Embaralhar a fila', () => act('shuffle')),
        h('span', { style: { flex: 1 } }),
        ctl([icon('eject', 16), 'Tirar da chamada'], 'Remover o bot da chamada', () => act('disconnect'), '.red')));
      if (inRoom) kids.push(h('div.muvol', h('span', icon('vol', 16), 'Volume do bot (só para você)'), slider(0, 200, voice.volumes[state.bot_id] ?? 100, 5, v => voice.setVolume(state.bot_id, v), v => v + '%')));
      kids.push(h('div.muqh', `Fila (${state.queue.length})`, state.queue.length > 0 && h('button.btn.link', { onclick: () => act('clear') }, 'Limpar')));
      kids.push(h('div.muq', ...(state.queue.length ? state.queue.map((t, i) => h('div.muitem',
        h('span.muidx', String(i + 1)), h('div.mumeta', h('b', { title: t.title }, t.title), h('small', [t.artist, t.duration ? fmt(t.duration) : '', who(t.by)].filter(Boolean).join(' • '))),
        h('button.mux', { title: 'Remover da fila', onclick: () => act('remove', { id: t.id }) }, icon('x', 16)))) : [h('div.muempty', 'Fila vazia.')])));
    }
    body.replaceChildren(...kids.filter(Boolean));
    tick();
  };
  redraw = () => { if (document.body.contains(body)) { const f = document.activeElement === input, v = input.value; draw(); input.value = v; if (f) input.focus(); } else redraw = null; };
  draw();
  const el = popout(anchor, body, 'up'); el.classList.add('mu-pop');
  const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
  el.style.top = Math.max(8, r.top - b.height - 12) + 'px'; el.style.left = Math.max(8, Math.min(r.left - 120, innerWidth - b.width - 8)) + 'px';
  setTimeout(() => input.focus(), 30);
}
