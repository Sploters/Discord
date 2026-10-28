// Soundboard: sons pessoais (sincronizados na conta) + sons dos servidores, tocados para toda a sala de voz.
import { h, icon } from './util.js';
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
    return a;
  } catch { }
}
// recebido do servidor (alguém na sala tocou)
export function onIncoming(msg, voice) {
  if (S.prefs.sbMuted || voice?.deafened) return;
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
  modal('Novo som', guildId ? 'Será visível para todos do servidor.' : 'Fica na sua conta, em qualquer dispositivo.', h('div',
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
export function openSoundboard(anchor, voice, { openSettings } = {}) {
  let tab = S.prefs.sbTab || 'fav';
  const body = h('div.sbpanel');
  const sources = () => soundSources().filter(x => !x.off);
  const allEnabled = () => sources().flatMap(src => src.sounds.map(s => ({ src, s })));
  const draw = () => {
    const srcs = sources();
    if (tab !== 'fav' && !srcs.some(x => x.key === tab)) tab = 'fav';
    const tabs = h('div.sbtabs', h('button' + (tab === 'fav' ? '.on' : ''), { onclick: () => { tab = 'fav'; draw(); } }, '★ Favoritos'), ...srcs.map(x => h('button' + (tab === x.key ? '.on' : ''), { onclick: () => { tab = x.key; draw(); } }, x.own ? 'Meus' : x.title)));
    let items;
    if (tab === 'fav') items = favs().map(id => allEnabled().find(x => x.s.id === id)).filter(Boolean);
    else items = (srcs.find(x => x.key === tab)?.sounds || []).map(s => ({ src: srcs.find(x => x.key === tab), s }));
    const grid = h('div.sbgrid', ...(items.length ? items.map(({ src, s }) => {
      const fav = favs().includes(s.id), key = (S.prefs.sbKeys || {})[s.id];
      return h('div.sbtn', { title: s.name + (key ? ` — atalho: ${comboLabel(key)}` : ''), onclick: () => trigger(s, voice),
        oncontextmenu: (e) => menu(e, [{ label: 'Tocar só para mim (prévia)', fn: () => trigger(s, voice, { preview: true }) }, { label: fav ? 'Remover dos favoritos' : 'Favoritar', fn: () => { S.prefs.sbFav = fav ? favs().filter(x => x !== s.id) : [...favs(), s.id]; savePrefs(); draw(); } },
          { label: 'Definir atalho…', fn: () => keyDialog(s) }, (src.own || (src.guild && can(src.guild.id, PERM.MANAGE_GUILD))) && { label: 'Editar / excluir…', fn: () => { closeFloating(); editSound(src, s); } }]) },
        h('span.e', s.emoji || '🔊'), h('span.n', s.name), h('button.star' + (fav ? '.on' : ''), { title: 'Favoritar', onclick: (e) => { e.stopPropagation(); S.prefs.sbFav = fav ? favs().filter(x => x !== s.id) : [...favs(), s.id]; savePrefs(); draw(); } }, '★'));
    }) : [h('div.sbempty', tab === 'fav' ? 'Nenhum favorito ainda. Clique na ★ de um som (ou clique direito).' : 'Sem sons aqui.')]));
    const canAddGuild = tab !== 'fav' && tab !== 'me' && can(tab, PERM.MANAGE_GUILD);
    body.replaceChildren(...[
      h('div.sbhead', h('b', 'Soundboard'), h('span', { style: { flex: 1 } }), h('label.sbmute', 'Silenciar sons', toggle(!!S.prefs.sbMuted, v => { S.prefs.sbMuted = v; savePrefs(); }))),
      h('div.sbvol', icon('voice', 16), slider(0, 100, S.prefs.sbVolume ?? 70, 5, v => { S.prefs.sbVolume = v; savePrefs(); }, v => v + '%')),
      tabs, grid,
      h('div.sbfoot', h('button.btn.grey', { onclick: () => addSound(tab !== 'fav' && tab !== 'me' && canAddGuild ? tab : null) }, canAddGuild ? '+ Som do servidor' : '+ Meu som'),
        openSettings && h('button.btn.link', { onclick: () => { closeFloating(); openSettings('sounds'); } }, 'Gerenciar…')),
      !voice?.active && h('div.sbhint', 'Você não está em uma sala de voz: os sons tocam só para você.')].filter(Boolean));
  };
  const onChange = () => document.body.contains(body) ? draw() : document.removeEventListener('sb-changed', onChange);
  document.addEventListener('sb-changed', onChange);
  draw();
  const el = popout(anchor, body, 'up'); el.classList.add('sb-pop');
  const r = anchor.getBoundingClientRect(); el.style.top = Math.max(8, r.top - el.getBoundingClientRect().height - 12) + 'px'; el.style.left = Math.max(8, Math.min(r.left - 120, innerWidth - el.getBoundingClientRect().width - 8)) + 'px';
}
function keyDialog(s) {
  const btn = h('button.btn.grey');
  captureKey(btn, (S.prefs.sbKeys || {})[s.id], (c) => { (S.prefs.sbKeys ||= {})[s.id] = c; savePrefs(); toast('Atalho definido'); });
  modal('Atalho do som', `"${s.name}" — funciona com o app em foco.`, h('div', btn), [{ label: 'Remover atalho', cls: 'grey', fn: () => { delete (S.prefs.sbKeys || {})[s.id]; savePrefs(); } }, { label: 'Concluir' }]);
}
export { vol as soundVol };
