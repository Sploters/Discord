// Soundboard: sons pessoais (sincronizados na conta) + sons dos servidores, tocados para toda a sala de voz.
import { h, icon, avatar, initials, whenGone } from './util.js';
import { S, api, tryApi, toast, savePrefs, modal, promptBox, popout, closeFloating, guild, can, PERM, confirmBox, menu, emojiPicker } from './state.js';
import { toggle, slider, comboFromEvent, comboLabel, captureKey } from './ui.js';

const MAX_BYTES = 2 * 1024 * 1024, MAX_SECS = 15;
const vol = (s) => s.volume ?? s.vol ?? 100;
export const mySounds = () => (S.prefs.mySounds ||= []);
const favs = () => (S.prefs.sbFav ||= []);

// todas as fontes: pessoais + servidores
export function soundSources() {
  const out = [{ key: 'me', title: 'Meus sons', own: true, sounds: mySounds() }];
  for (const g of S.guilds.values()) if ((g.sounds || []).length) out.push({ key: g.id, title: g.name, guild: g, sounds: g.sounds, off: !!(S.prefs.sbOffGuilds || {})[g.id] });
  return out;
}
export const findSound = (id) => { for (const src of soundSources()) { const s = src.sounds.find(x => x.id === id); if (s) return s; } return null; };

let ctx;
const sink = (el) => { if (S.prefs.outputId && el.setSinkId) el.setSinkId(S.prefs.outputId).catch(() => { }); };
export function playLocal(url, volumePct = 100) {
  try {
    const a = new Audio(url); a.volume = Math.min(1, volumePct / 100 * (S.prefs.sbVolume ?? 70) / 100); sink(a); a.play().catch(() => { });
    a.addEventListener('timeupdate', () => { if (a.currentTime >= MAX_SECS) { a.pause(); a.dispatchEvent(new Event('ended')); } }); // nunca toca além do limite, mesmo se o arquivo for maior
    return a;
  } catch { }
}
// recebido do servidor (alguém na sala tocou)
export function onIncoming(msg, voice) {
  if (S.prefs.sbMuted || voice?.deafened || S.prefs.sbMutedUsers?.[msg.user_id]) return;
  const a = playLocal(msg.url, msg.volume), uid = msg.user_id;
  if (uid && voice) { // anel roxo no avatar enquanto o som toca
    voice.sbActive.add(uid); voice.onUpdate?.(true);
    let t; const end = () => { clearTimeout(t); voice.sbActive.delete(uid); voice.onUpdate?.(true); };
    t = setTimeout(end, 3000);
    if (a) { a.addEventListener('loadedmetadata', () => { clearTimeout(t); t = setTimeout(end, Math.min(15, a.duration || 3) * 1000 + 100); }); a.addEventListener('ended', end); }
  }
  const stage = document.getElementById('stage');
  if (stage) {
    const who = S.users.get(msg.user_id)?.display_name || 'alguém';
    const el = h('div.sbflash', h('span.e', msg.emoji || '🔊'), h('span', `${who}: ${msg.name || 'som'}`));
    stage.append(el); setTimeout(() => el.remove(), 2600);
  }
}
export function trigger(sound, voice, { preview = false } = {}) {
  if (!sound) return;
  if (!preview && voice?.deafened) return toast('Soundboard indisponível enquanto você está ensurdecido.', true);
  if (!preview && sound.id) { const u = (S.prefs.sbUse ||= {}); u[sound.id] = (u[sound.id] || 0) + 1; savePrefs(); } // alimenta "Usados com frequência"
  if (!preview && voice?.active) voice.send('SOUNDBOARD', { url: sound.url, volume: vol(sound), name: sound.name, emoji: sound.emoji });
  else { if (!preview && !voice?.active) toast('Entre em uma sala de voz para tocar para os outros. Tocando prévia.'); playLocal(sound.url, vol(sound)); }
}
export function handleKey(e, voice) { // atalho por som (enquanto o app está em foco)
  const keys = S.prefs.sbKeys; if (!keys) return false;
  const c = comboFromEvent(e); if (!c) return false;
  const id = Object.keys(keys).find(k => keys[k] === c); if (!id) return false;
  const s = findSound(id); if (!s) return false;
  e.preventDefault(); trigger(s, voice); return true;
}

// ---- adicionar/editar ----
async function pickAudio() {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept: 'audio/*', onchange: async () => {
      const f = i.files[0]; if (!f) return res(null);
      if (f.size > MAX_BYTES) { toast('Arquivo muito grande (máx. 2 MB)', true); return res(null); }
      const url = URL.createObjectURL(f), a = new Audio(url);
      const dur = await new Promise(r => { a.onloadedmetadata = () => r(a.duration); a.onerror = () => r(-1); });
      URL.revokeObjectURL(url);
      if (!(dur > 0)) { toast('Não foi possível ler esse áudio', true); return res(null); }
      if (dur > MAX_SECS) { toast(`Áudio muito longo (máx. ${MAX_SECS}s, este tem ${Math.round(dur)}s)`, true); return res(null); }
      try { const up = await api('POST', `/upload?name=${encodeURIComponent(f.name)}`, f); res({ url: up.url, name: f.name.replace(/\.[^.]+$/, '').slice(0, 32), dur }); } catch (e) { toast(e.message, true); res(null); }
    } });
    i.click();
  });
}
export async function addSound(guildId) {
  const f = await pickAudio(); if (!f) return;
  const st = { name: f.name, emoji: '🔊', volume: 100 };
  const name = h('input', { value: st.name, maxLength: 32, oninput: () => (st.name = name.value) });
  const emo = h('button.btn.grey', { style: { minWidth: '48px', fontSize: '20px' }, onclick: (e) => emojiPicker(e.currentTarget, (x) => { if (x.startsWith('<:')) return; st.emoji = x; emo.textContent = x; }, { noCustom: true }) }, st.emoji);
  const prev = h('button.btn.grey', { onclick: () => playLocal(f.url, st.volume) }, '▶ Ouvir');
  modal('Novo som', (guildId ? 'Será visível para todos do servidor.' : 'Fica na sua conta, em qualquer dispositivo.') + ` Duração máxima: ${MAX_SECS}s.`, h('div',
    h('label.f', 'Nome', name), h('label.f', 'Emoji'), emo, h('label.f', { style: { marginTop: '14px' } }, 'Volume ', h('span', '100%'), slider(10, 200, 100, 5, v => (st.volume = v), v => v + '%')), prev),
  [{ label: 'Cancelar', cls: 'link' }, { label: 'Adicionar', fn: async () => {
    if (!st.name.trim()) { toast('Dê um nome ao som', true); return false; }
    if (guildId) return !!(await tryApi('POST', `/guilds/${guildId}/sounds`, { name: st.name, emoji: st.emoji, url: f.url, volume: st.volume }));
    if (mySounds().length >= 30) { toast('Limite de 30 sons pessoais', true); return false; }
    mySounds().push({ id: 'm' + Date.now().toString(36), name: st.name.trim(), emoji: st.emoji, url: f.url, vol: st.volume }); savePrefs(); document.dispatchEvent(new Event('sb-changed'));
  } }]);
}
export async function editSound(src, s) {
  const st = { name: s.name, emoji: s.emoji || '🔊', volume: vol(s) };
  const name = h('input', { value: st.name, maxLength: 32, oninput: () => (st.name = name.value) });
  const emo = h('button.btn.grey', { style: { minWidth: '48px', fontSize: '20px' }, onclick: (e) => emojiPicker(e.currentTarget, (x) => { if (x.startsWith('<:')) return; st.emoji = x; emo.textContent = x; }, { noCustom: true }) }, st.emoji);
  modal('Editar som', '', h('div', h('label.f', 'Nome', name), h('label.f', 'Emoji'), emo, h('label.f', { style: { marginTop: '14px' } }, 'Volume', slider(10, 200, st.volume, 5, v => (st.volume = v), v => v + '%')), h('button.btn.grey', { onclick: () => playLocal(s.url, st.volume) }, '▶ Ouvir')),
    [{ label: 'Excluir', cls: 'red', fn: async () => {
      if (!(await confirmBox('Excluir som', `Excluir "${s.name}"?`, 'Excluir'))) return false;
      if (src.own) { S.prefs.mySounds = mySounds().filter(x => x.id !== s.id); savePrefs(); document.dispatchEvent(new Event('sb-changed')); } else await tryApi('DELETE', `/sounds/${s.id}`);
    } }, { label: 'Cancelar', cls: 'link' }, { label: 'Salvar', fn: async () => {
      if (src.own) { Object.assign(s, { name: st.name, emoji: st.emoji, vol: st.volume }); savePrefs(); document.dispatchEvent(new Event('sb-changed')); }
      else await tryApi('PATCH', `/sounds/${s.id}`, { name: st.name, emoji: st.emoji, volume: st.volume });
    } }]);
}

// ---- painel (popout) ----
// busca + volume no topo, trilho de categorias à esquerda e seções recolhíveis com os sons em grade (3 por linha)
const toggleFav = (id) => { S.prefs.sbFav = favs().includes(id) ? favs().filter(x => x !== id) : [...favs(), id]; savePrefs(); };
const guildIcon = (g) => g.icon ? h('img.sbgi', { src: g.icon, alt: '' }) : h('span.sbgi', initials(g.name));
export function openSoundboard(anchor, voice, { openSettings } = {}) {
  const closed = () => (S.prefs.sbClosed ||= {}); // seções recolhidas
  let q = '', cur = null, lock = 0;
  const body = h('div.sbpick'), rail = h('div.sbrail'), list = h('div.sblist');
  const search = h('input', { placeholder: 'Encontre o som perfeito', oninput: () => { q = search.value.trim().toLowerCase(); draw(); } });
  let pop = null;
  // popup de volume (como o do Discord): menu flutuante ao lado do botão, por cima do painel
  const volMenu = () => {
    const m = h('div.menu.sbvolmenu', { onclick: (e) => e.stopPropagation() },
      h('div.mnode', h('div.sbvl-t', 'Volume da soundboard'), slider(0, 100, S.prefs.sbVolume ?? 70, 1, v => { S.prefs.sbVolume = v; savePrefs(); }, v => v + '%')),
      h('div.mnode.sbvolrow', h('span', 'Silenciar soundboard'), toggle(!!S.prefs.sbMuted, v => { S.prefs.sbMuted = v; savePrefs(); })),
      openSettings && h('div.mnode', h('button.btn.link', { onclick: () => { closeFloating(); openSettings('soundboard'); } }, 'Gerenciar sons…')));
    return m;
  };
  const volBtn = h('button.sbvolbtn', { title: 'Volume da soundboard', onclick: () => {
    const open = document.querySelector('.sbvolmenu'); if (open) { open.remove(); volBtn.classList.remove('on'); return; }
    const m = volMenu(); (pop?.parentElement || document.body).append(m); volBtn.classList.add('on');
    const r = volBtn.getBoundingClientRect(), p = pop.getBoundingClientRect(), w = m.getBoundingClientRect();
    let x = p.right + 8; if (x + w.width > innerWidth - 8) x = p.left - w.width - 8; // à direita do painel; sem espaço, à esquerda
    m.style.left = Math.max(8, x) + 'px'; m.style.top = Math.max(8, Math.min(r.top, innerHeight - w.height - 8)) + 'px';
  } }, icon('voice', 20));
  // seções: favoritos, frequentes, meus sons e cada servidor (com sons, ou vazio se eu puder adicionar)
  const sections = () => {
    const own = { key: 'me', own: true, title: 'Meus sons', sounds: mySounds() };
    const srcs = [own, ...[...S.guilds.values()].filter(g => !(S.prefs.sbOffGuilds || {})[g.id]).map(g => ({ key: g.id, guild: g, title: g.name, sounds: g.sounds || [] }))];
    const all = srcs.flatMap(src => src.sounds.map(s => ({ src, s }))), byId = new Map(all.map(x => [x.s.id, x]));
    const freq = Object.entries(S.prefs.sbUse || {}).filter(([id]) => byId.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => byId.get(id));
    return [
      { key: 'fav', title: 'Favoritos', ic: () => icon('star', 18), items: favs().map(id => byId.get(id)).filter(Boolean), empty: 'Passe o mouse num som e clique na ★ para favoritar.' },
      freq.length && { key: 'freq', title: 'Usados com frequência', ic: () => icon('clock', 18), items: freq },
      ...srcs.map(src => {
        const add = src.own || can(src.guild.id, PERM.MANAGE_GUILD);
        return (src.sounds.length || add) && { key: src.key, title: src.title, ic: () => src.own ? avatar(S.me, 18, { status: false }) : guildIcon(src.guild), items: src.sounds.map(s => ({ src, s })), add: add && (() => addSound(src.own ? null : src.guild.id)) };
      })].filter(Boolean);
  };
  const tile = ({ src, s }) => {
    const fav = favs().includes(s.id), key = (S.prefs.sbKeys || {})[s.id];
    return h('div.sbsnd', { title: s.name + (key ? ` — atalho: ${comboLabel(key)}` : ''), onclick: () => trigger(s, voice),
      oncontextmenu: (e) => menu(e, [{ label: 'Tocar só para mim (prévia)', fn: () => trigger(s, voice, { preview: true }) }, { label: fav ? 'Remover dos favoritos' : 'Favoritar', fn: () => { toggleFav(s.id); draw(); } },
        { label: 'Definir atalho…', fn: () => keyDialog(s) }, (src.own || (src.guild && can(src.guild.id, PERM.MANAGE_GUILD))) && { label: 'Editar / excluir…', fn: () => { closeFloating(); editSound(src, s); } }]) },
      h('span.e', s.emoji || '🔊'), h('span.n', s.name),
      // ao passar o mouse: prévia (só você ouve) e favoritar; clicar no resto do botão toca para a sala
      h('div.sbov', h('button', { title: 'Prévia (só você ouve)', onclick: (e) => { e.stopPropagation(); trigger(s, voice, { preview: true }); } }, icon('voice', 16)),
        h('button' + (fav ? '.on' : ''), { title: fav ? 'Remover dos favoritos' : 'Favoritar', onclick: (e) => { e.stopPropagation(); toggleFav(s.id); draw(); } }, icon('star', 16))));
  };
  const draw = () => {
    const secs = sections(), top = list.scrollTop;
    rail.replaceChildren(...secs.map(sec => h('button' + (sec.key === cur ? '.on' : ''), { title: sec.title, 'data-k': sec.key, onclick: () => {
      const el = list.querySelector(`[data-sec="${sec.key}"]`); if (!el) return;
      cur = sec.key; lock = Date.now() + 700; rail.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === cur)); // marca já, mesmo que a lista não role (seção curta)
      list.scrollTo({ top: el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop, behavior: 'smooth' });
    } }, sec.ic())));
    const shown = secs.map(sec => {
      const items = q ? sec.items.filter(x => x.s.name.toLowerCase().includes(q)) : sec.items;
      if (q && !items.length) return null;
      const shut = !q && closed()[sec.key];
      return h('div.sbsec', { 'data-sec': sec.key },
        h('div.sbsec-h', { onclick: () => { closed()[sec.key] = !closed()[sec.key]; savePrefs(); draw(); } }, sec.ic(), h('b', sec.title), icon(shut ? 'chevr' : 'chevdown', 16)),
        !shut && (items.length || (sec.add && !q) ? h('div.sbrow', items.map(tile), !q && sec.add && h('div.sbsnd.sbadd', { title: 'Adicionar som', onclick: sec.add }, icon('plus', 18), h('span.n', 'Adicionar som')))
          : h('div.sbnote', sec.empty || 'Sem sons aqui.')));
    }).filter(Boolean);
    list.replaceChildren(...(shown.length ? shown : [h('div.sbnote.big', 'Nenhum som encontrado.')]));
    list.scrollTop = top; spy();
  };
  // categoria marcada no trilho = seção visível no topo da lista
  const spy = () => {
    if (Date.now() < lock) return;
    let k = null; for (const el of list.querySelectorAll('[data-sec]')) if (el.offsetTop - list.offsetTop <= list.scrollTop + 8) k = el.dataset.sec;
    k ||= list.querySelector('[data-sec]')?.dataset.sec; if (k === cur) return; cur = k;
    rail.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  };
  list.onscroll = spy;
  body.append(h('div.sbtop', h('div.sbsearch', icon('search', 16), search), volBtn), rail, list,
    !voice?.active && h('div.sbhint', 'Você não está em uma sala de voz: os sons tocam só para você.'));
  const onChange = () => draw();
  document.addEventListener('sb-changed', onChange);
  queueMicrotask(() => whenGone(body, () => document.removeEventListener('sb-changed', onChange)));
  draw();
  const el = pop = popout(anchor, body, 'up'); el.classList.add('sb-pop');
  const r = anchor.getBoundingClientRect(); el.style.top = Math.max(8, r.top - el.getBoundingClientRect().height - 12) + 'px'; el.style.left = Math.max(8, Math.min(r.left - 120, innerWidth - el.getBoundingClientRect().width - 8)) + 'px';
  spy(); setTimeout(() => search.focus(), 0);
}
function keyDialog(s) {
  const btn = h('button.btn.grey');
  captureKey(btn, (S.prefs.sbKeys || {})[s.id], (c) => { (S.prefs.sbKeys ||= {})[s.id] = c; savePrefs(); toast('Atalho definido'); });
  modal('Atalho do som', `"${s.name}" — funciona com o app em foco.`, h('div', btn), [{ label: 'Remover atalho', cls: 'grey', fn: () => { delete (S.prefs.sbKeys || {})[s.id]; savePrefs(); } }, { label: 'Concluir' }]);
}
export { vol as soundVol };
