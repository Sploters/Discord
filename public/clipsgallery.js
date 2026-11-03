// Galeria de clipes do servidor: todos os clipes salvos nas salas de voz, num só lugar.
// Abas Todos / Meus / Favoritos, busca, prévia que só carrega quando aparece na tela, player com anterior/próximo,
// renomear, favoritar, baixar, ir para a mensagem e apagar. Atualiza em tempo real (CLIP_CREATE/UPDATE/DELETE).
import { h, icon, fsVideo } from './util.js';
import { S, tryApi, toast, menu, modal, confirmBox, promptBox, can, PERM, guild, nameOf } from './state.js';

let ctx = {}; // injetado por app.js: go(gid, cid), jumpTo(mid)
export const initClipsGallery = (c) => { ctx = c; };

const st = { gid: null, filter: 'all', q: '', clips: [], total: 0, more: false, loading: false, root: null };
const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 60) return 'agora'; if (s < 3600) return `há ${Math.floor(s / 60)} min`; if (s < 86400) return `há ${Math.floor(s / 3600)} h`; const d = Math.floor(s / 86400); return d < 30 ? `há ${d} d` : new Date(t).toLocaleDateString('pt-BR'); };
const mb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const canEdit = (c) => c.author.id === S.me.id || can(c.guild_id, PERM.MANAGE_MESSAGES);
const who = (u) => (u ? nameOf(u.id, st.gid) || u.display_name : 'alguém');
const fileName = (c) => c.title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + (c.url.includes('.mp4') ? '.mp4' : '.webm');

// a prévia (primeiro quadro) só é baixada quando o cartão entra na tela
const lazy = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { const v = e.target; if (!v.src) { v.preload = 'metadata'; v.src = v.dataset.src + '#t=0.1'; } lazy.unobserve(v); } }, { rootMargin: '200px' });

async function load(reset) {
  if (st.loading) return; st.loading = true;
  const before = reset ? '' : st.clips.at(-1)?.id || '';
  const qs = new URLSearchParams({ filter: st.filter, ...(st.q ? { q: st.q } : {}), ...(before ? { before } : {}) });
  const gid = st.gid, r = await tryApi('GET', `/guilds/${gid}/clips?${qs}`);
  st.loading = false;
  if (!r || gid !== st.gid) return;
  st.clips = reset ? r.clips : [...st.clips, ...r.clips]; st.total = r.total; st.more = r.clips.length === 30;
  draw();
}

function card(c, i) {
  const v = h('video', { muted: true, playsInline: true, preload: 'none', disablePictureInPicture: true, 'data-src': c.url });
  v.muted = true; lazy.observe(v);
  const thumb = h('div.cthumb', { title: 'Assistir', onclick: () => player(i), onmouseenter: () => { if (v.src) { v.currentTime = 0; v.play().catch(() => { }); } }, onmouseleave: () => { v.pause(); if (v.src) v.currentTime = .1; } },
    v, h('span.cdur', `${c.secs}s`), !c.has_audio && h('span.cmute', { title: 'Sem áudio' }, icon('micoff', 14)), h('span.cplay', icon('play', 28)));
  const fav = h('button.ibtn' + (c.fav ? '.on' : ''), { title: c.fav ? 'Tirar dos favoritos' : 'Favoritar', onclick: (e) => { e.stopPropagation(); toggleFav(c); } }, icon('star', 18));
  return h('div.clipcard', { 'data-id': c.id, oncontextmenu: (e) => moreMenu(e, c) }, thumb,
    h('div.cinfo',
      h('div.ctitle', { title: c.title }, c.title),
      h('div.cmeta', c.streamer && h('span', 'de ', h('b', who(c.streamer))), h('span', 'clipado por ', h('b', who(c.author))), h('span', ago(c.created_at))),
      h('div.cbtns', fav,
        h('a.ibtn', { title: `Baixar (${mb(c.size)})`, href: c.url, download: fileName(c), onclick: (e) => e.stopPropagation() }, icon('dl', 18)),
        h('button.ibtn', { title: 'Mais opções', onclick: (e) => { e.stopPropagation(); moreMenu(e, c); } }, icon('more', 18)))));
}

function moreMenu(e, c) {
  menu(e, [
    { label: 'Assistir', fn: () => player(st.clips.findIndex(x => x.id === c.id)) },
    canEdit(c) && { label: 'Renomear…', fn: () => rename(c) },
    { label: c.fav ? 'Tirar dos favoritos' : 'Favoritar', fn: () => toggleFav(c) },
    { label: 'Ir para a mensagem', fn: () => { ctx.go(c.guild_id, c.channel_id); setTimeout(() => ctx.jumpTo?.(c.message_id), 600); } },
    { label: 'Copiar link do vídeo', fn: () => { navigator.clipboard?.writeText(location.origin + c.url); toast('Link copiado'); } },
    canEdit(c) && '-',
    canEdit(c) && { label: 'Apagar clipe', danger: true, fn: () => remove(c) },
  ]);
}
async function rename(c) {
  const t = await promptBox('Renomear clipe', 'Nome', c.title); if (t == null || !t.trim() || t.trim() === c.title) return;
  const r = await tryApi('PATCH', `/clips/${c.id}`, { title: t.trim() }); if (r) upsert(r);
}
async function toggleFav(c) {
  const r = await tryApi(c.fav ? 'DELETE' : 'PUT', `/clips/${c.id}/fav`); if (!r) return;
  if (st.filter === 'fav' && !r.fav) { st.clips = st.clips.filter(x => x.id !== c.id); draw(); } else upsert(r);
}
async function remove(c) {
  if (!await confirmBox('Apagar clipe', `"${c.title}" sai da galeria e do chat da sala, e o vídeo é apagado do servidor.`, 'Apagar')) return;
  if (await tryApi('DELETE', `/clips/${c.id}`)) toast('Clipe apagado');
}
function upsert(c) { const i = st.clips.findIndex(x => x.id === c.id); if (i >= 0) { st.clips[i] = c; draw(); } }

// player: vídeo grande, anterior/próximo (botões e setas), Esc fecha
function player(i) {
  if (i < 0 || !st.clips[i]) return;
  let cur = i;
  const vbox = fsVideo({ autoplay: true }, '.pvid'), v = vbox.video;
  const title = h('b.pttl'), meta = h('div.pmeta'), prev = h('button.pnav.prev', { title: 'Anterior (←)', onclick: () => show(cur - 1) }, icon('chevl', 28)), next = h('button.pnav.next', { title: 'Próximo (→)', onclick: () => show(cur + 1) }, icon('chevr', 28));
  const dl = h('a.btn.grey', { download: '' }, icon('dl', 16), 'Baixar');
  const box = h('div.clipplayer', h('div.pstage', prev, vbox, next), h('div.pbar', h('div.ptxt', title, meta), dl));
  const show = (k) => {
    if (k < 0 || k >= st.clips.length) return; cur = k; const c = st.clips[k];
    v.src = c.url; v.play().catch(() => { });
    title.textContent = c.title; meta.textContent = `${c.streamer ? 'de ' + who(c.streamer) + ' · ' : ''}clipado por ${who(c.author)} · ${ago(c.created_at)} · ${c.secs}s${c.has_audio ? '' : ' · sem áudio'}`;
    dl.href = c.url; dl.download = fileName(c);
    prev.disabled = k === 0; next.disabled = k === st.clips.length - 1;
  };
  const keys = (e) => { if (!document.body.contains(box)) return removeEventListener('keydown', keys); if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); };
  addEventListener('keydown', keys);
  modal('Clipe', null, box, [{ label: 'Fechar', cls: 'grey' }], { width: 'min(1100px, 94vw)' });
  box.closest('.modal')?.classList.add('clipmodal');
  show(cur);
}

function draw() {
  const root = st.root; if (!root || !document.body.contains(root)) return;
  const g = guild(st.gid);
  const tabs = [['all', 'Todos'], ['mine', 'Meus'], ['fav', 'Favoritos']].map(([k, l]) => h('button.ctab' + (st.filter === k ? '.on' : ''), { onclick: () => { if (st.filter === k) return; st.filter = k; st.clips = []; draw(); load(true); } }, l));
  const search = h('input.csearch', { placeholder: 'Buscar por nome ou pessoa', value: st.q, oninput: (e) => { clearTimeout(st.t); st.t = setTimeout(() => { st.q = e.target.value.trim(); load(true); }, 250); } });
  const grid = h('div.cgrid', st.clips.map(card));
  const empty = !st.clips.length && !st.loading && h('div.cempty', h('div.ceart', icon('clip', 40)),
    h('b', st.q ? 'Nenhum clipe encontrado' : st.filter === 'fav' ? 'Nenhum favorito ainda' : st.filter === 'mine' ? 'Você ainda não tem clipes' : 'Nenhum clipe ainda'),
    h('p', st.q ? 'Tente outro nome.' : st.filter === 'fav' ? 'Clique na estrela de um clipe para guardá-lo aqui.' : 'Numa sala de voz, assista uma transmissão e use o botão de clipes (ou Ctrl+Alt+C) para salvar os últimos segundos. Eles aparecem aqui para todo o servidor.'));
  const focused = document.activeElement?.classList?.contains('csearch');
  root.replaceChildren(
    h('div#topbar', h('span.hash', icon('clip', 24)), h('span', 'Clipes'), h('span.topic', `${st.total} ${st.total === 1 ? 'clipe' : 'clipes'} em ${g?.name || 'este servidor'}`)),
    h('div.cbody', h('div.ctool', h('div.ctabs', tabs), search), grid, empty || null,
      st.more && h('button.btn.grey.cmore', { onclick: () => load(false) }, 'Carregar mais')));
  if (focused) { const s = root.querySelector('.csearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

export function renderClips(main, gid) {
  if (st.gid !== gid) Object.assign(st, { gid, filter: 'all', q: '', clips: [], total: 0, more: false });
  st.root = h('div#clipsview'); main.replaceChildren(st.root);
  draw(); load(true);
}

// eventos em tempo real
export function onClipEvent(t, d) {
  if (d.guild_id !== st.gid || !st.root || !document.body.contains(st.root)) return;
  if (t === 'CLIP_CREATE') { st.total++; if (st.filter === 'all' && !st.q) { st.clips.unshift(d); } draw(); }
  if (t === 'CLIP_UPDATE') upsert({ ...d, fav: st.clips.find(x => x.id === d.id)?.fav ?? d.fav });
  if (t === 'CLIP_DELETE') { st.total = Math.max(0, st.total - 1); st.clips = st.clips.filter(x => x.id !== d.id); draw(); }
}
