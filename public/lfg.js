// Procurar jogadores: mural de anúncios (quem divide servidor com você ou é seu amigo), "Quero entrar" → o autor
// aceita e você vai para a chamada, "Copiar anúncio" para colar em grupos de LFG, perfil de jogador e atalhos para sites.
import { h, icon, avatar } from './util.js';
import { S, tryApi, toast, modal, notify, savePrefs, guild } from './state.js';
import { toggle } from './ui.js';
import { playSound } from './sounds.js';

let ctx = {}; // injetado por app.js: go, profile(anchor, uid)
export const initLfg = (c) => { ctx = c; };
const st = { games: null, posts: [], game: null, root: null, mine: [] };
const G = (id) => st.games?.find(g => g.id === id);
const meta = async () => (st.games ||= (await tryApi('GET', '/lfg/meta'))?.games || []);

// ---------- textos ----------
const whenText = (p) => {
  if (!p.when_at || p.when_at <= Date.now() + 60e3) return 'Agora';
  const d = new Date(p.when_at), today = new Date(), tm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(d.toDateString()) - new Date(today.toDateString())) / 86400e3);
  return days === 0 ? `Hoje ${tm}` : days === 1 ? `Amanhã ${tm}` : `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${tm}`;
};
const rankText = (p) => (p.rank_min && p.rank_max ? (p.rank_min === p.rank_max ? p.rank_min : `${p.rank_min} – ${p.rank_max}`) : p.rank_min ? `${p.rank_min}+` : p.rank_max ? `até ${p.rank_max}` : 'Qualquer elo');
// links para sites de estatística a partir do nick / Riot ID (só abre o site; nada é consultado daqui)
export function statLinks(game, ign) {
  if (!ign) return [];
  const riot = ign.match(/^(.+?)#(\w{2,6})$/);
  if (game === 'lol' && riot) return [{ name: 'OP.GG', url: `https://op.gg/lol/summoners/br/${encodeURIComponent(riot[1])}-${encodeURIComponent(riot[2])}` }];
  if (game === 'valorant' && riot) return [{ name: 'Tracker', url: `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(ign)}/overview` }];
  if (game === 'cs2') return /^https?:\/\/steamcommunity\.com\//.test(ign) ? [{ name: 'Steam', url: ign }] : [{ name: 'Faceit', url: `https://www.faceit.com/pt/players/${encodeURIComponent(ign)}` }];
  return [];
}
export function adText(p) {
  const prof = p.author_profile;
  return [`🎮 LFG — ${p.game_name} · ${p.mode}`,
    `Precisa de ${p.slots} · ${rankText(p)}`,
    [p.roles.length ? `Funções: ${p.roles.join(', ')}` : null, p.mic ? '🎙️ Com microfone' : null].filter(Boolean).join(' · ') || null,
    `Quando: ${whenText(p) === 'Agora' ? 'agora' : whenText(p)}`,
    prof?.ign ? `${G(p.game)?.idLabel || 'Nick'}: ${prof.ign}${prof.rank ? ` (${prof.rank})` : ''}` : null,
    p.note ? `"${p.note}"` : null].filter(Boolean).join('\n');
}

// ---------- página ----------
async function load() {
  await meta();
  const r = await tryApi('GET', '/lfg/posts'); if (!r) return;
  st.posts = r; draw();
}
export async function renderLfg(main) {
  st.root = h('div#lfgview'); main.replaceChildren(st.root);
  draw(); load();
}
function draw() {
  const root = st.root; if (!root || !document.body.contains(root)) return;
  const games = st.games || [], g = st.game && G(st.game);
  const list = st.posts.filter(p => !st.game || p.game === st.game);
  const open = list.filter(p => !p.closed), done = list.filter(p => p.closed && p.author.id === S.me.id);
  const alerts = S.prefs.lfgAlerts || {};
  const chips = h('div.lfgchips', h('button.lchip' + (!st.game ? '.on' : ''), { onclick: () => { st.game = null; draw(); } }, 'Todos'),
    games.map(x => h('button.lchip' + (st.game === x.id ? '.on' : ''), { style: { '--gc': x.color }, onclick: () => { st.game = x.id; draw(); } }, h('i'), x.name)));
  const links = (g ? [g] : games).flatMap(x => x.links.map(l => ({ ...l, game: x.name })));
  root.replaceChildren(
    h('div#topbar', h('span.hash', icon('gamepad', 24)), h('span', 'Procurar jogadores'), h('span.topic', 'Anúncios de quem divide servidor com você ou é seu amigo'),
      h('div.spacer'),
      h('button.btn.grey.sm', { onclick: () => profileModal() }, icon('edit', 16), 'Meu perfil de jogador'),
      h('button.btn.green.sm', { onclick: () => createModal() }, icon('plus', 16), 'Criar anúncio')),
    h('div.lfgbody',
      chips,
      h('div.lfgbar',
        g ? h('label.lfgalert', toggle(!!alerts[g.id], (v) => { (S.prefs.lfgAlerts ||= {})[g.id] = v; if (!v) delete S.prefs.lfgAlerts[g.id]; savePrefs(); toast(v ? `Você será avisado de novos anúncios de ${g.name}` : 'Aviso desligado'); }), h('span', `Avisar quando alguém anunciar ${g.name}`)) : h('span.lfghint', 'Escolha um jogo para filtrar e ligar avisos.'),
        links.length > 0 && h('div.lfglinks', h('span', 'Procurar também em:'), links.map(l => h('a.lfglink', { href: l.url, target: '_blank', rel: 'noopener noreferrer', title: `${l.name} — ${l.game}` }, l.name + (g ? '' : ` · ${l.game}`), icon('external', 12))))),
      open.length ? h('div.lfggrid', open.map(card)) : h('div.lfgempty', h('div.ceart', icon('users', 40)), h('b', st.posts.length && st.game ? `Ninguém procurando ${g?.name} agora` : 'Ninguém procurando grupo agora'), h('p', 'Crie um anúncio: quem divide servidor com você ou é seu amigo vê na hora e pode pedir para entrar.'), h('button.btn.green', { onclick: () => createModal() }, 'Criar anúncio')),
      done.length > 0 && [h('h4.lfgsec', 'Seus anúncios encerrados (últimas 12 h)'), h('div.lfggrid.done', done.map(card))]));
}

function card(p) {
  const g = G(p.game) || { color: '#5865f2' }, me = p.author.id === S.me.id, myReq = p.requests.find(r => r.user.id === S.me.id);
  const prof = p.author_profile, links = statLinks(p.game, prof?.ign);
  const when = whenText(p), ch = p.channel, gch = ch && guild(ch.guild_id);
  const btns = [];
  if (!me && !p.closed) {
    if (!myReq) btns.push(h('button.btn.green', { onclick: () => tryApi('POST', `/lfg/posts/${p.id}/request`, {}).then(r => r && (upsert(r), toast(`Pedido enviado para ${p.author.display_name}`))) }, 'Quero entrar'));
    else if (myReq.state === 'pending') btns.push(h('button.btn.grey', { title: 'Cancelar o pedido', onclick: () => tryApi('POST', `/lfg/posts/${p.id}/request`, { cancel: true }).then(r => r && upsert(r)) }, 'Pedido enviado', icon('check', 14)));
  }
  if (myReq?.state === 'accepted') btns.push(h('span.lfgok', icon('check', 14), 'Você está no grupo'));
  if (myReq?.state === 'declined') btns.push(h('span.lfgno', 'Pedido recusado'));
  btns.push(h('button.btn.grey', { title: 'Copia o anúncio em texto para colar em grupos de LFG', onclick: () => { navigator.clipboard?.writeText(adText(p)); toast('Anúncio copiado'); } }, icon('copy', 16), 'Copiar anúncio'));
  if (me && !p.closed) btns.push(h('button.btn.link', { onclick: () => tryApi('POST', `/lfg/posts/${p.id}/close`).then(r => r && upsert(r)) }, 'Encerrar'));
  const pend = me ? p.requests.filter(r => r.state === 'pending') : [];
  return h('div.lfgcard' + (p.closed ? '.closed' : '') + (me ? '.mine' : ''), { 'data-id': p.id, style: { '--gc': g.color } },
    h('div.lfgtop', h('span.lfggame', p.game_name), h('span.lfgmode', p.mode), h('span.lfgwhen' + (when === 'Agora' ? '.now' : ''), when),
      p.closed && h('span.lfgstate', p.closed_reason === 'full' ? 'Completo' : p.closed_reason === 'expired' ? 'Expirado' : 'Encerrado')),
    h('div.lfgneed', h('b', p.closed && p.closed_reason === 'full' ? 'Grupo fechado' : `Precisa de ${p.slots}`), h('span', rankText(p)), p.mic && h('span.lfgmic', { title: 'Microfone obrigatório' }, icon('mic', 14), 'mic')),
    p.roles.length > 0 && h('div.lfgroles', p.roles.map(r => h('span', r))),
    p.note && h('div.lfgnote', p.note),
    h('div.lfgwho', { onclick: (e) => ctx.profile?.(e.currentTarget, p.author.id) }, avatar(S.users.get(p.author.id) || p.author, 32, { status: false }),
      h('div.lfgwinfo', h('b', p.author.display_name + (me ? ' (você)' : '')), h('small', prof?.ign ? `${prof.ign}${prof.rank ? ' · ' + prof.rank : ''}${prof.roles?.length ? ' · ' + prof.roles.join('/') : ''}` : 'sem perfil de jogador')),
      links.map(l => h('a.lfgstat', { href: l.url, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, l.name, icon('external', 11)))),
    ch && h('div.lfgch', icon('voice', 16), h('span', `${ch.name}${gch ? ' · ' + gch.name : ''}`), h('small', ch.in_call ? `${ch.in_call} na chamada` : 'sala vazia')),
    p.accepted.length > 0 && h('div.lfgacc', h('small', 'No grupo:'), p.accepted.map(u => h('span', { title: u.display_name }, avatar(S.users.get(u.id) || u, 20, { status: false })))),
    pend.length > 0 && h('div.lfgreqs', h('small', `${pend.length} ${pend.length === 1 ? 'pedido' : 'pedidos'} para entrar`), pend.map(r => h('div.lfgreq',
      avatar(S.users.get(r.user.id) || r.user, 28, { status: false }),
      h('div.lfgwinfo', h('b', r.user.display_name), h('small', r.profile?.ign ? `${r.profile.ign}${r.profile.rank ? ' · ' + r.profile.rank : ''}` : 'sem perfil de jogador'), statLinks(p.game, r.profile?.ign).map(l => h('a.lfgstat', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.name, icon('external', 11)))),
      h('button.btn.green.sm', { onclick: () => answer(p, r.user.id, true) }, 'Aceitar'), h('button.btn.grey.sm', { onclick: () => answer(p, r.user.id, false) }, 'Recusar')))),
    h('div.lfgbtns', btns));
}
async function answer(p, uid, accept) {
  const r = await tryApi('POST', `/lfg/posts/${p.id}/answer`, { user_id: uid, accept }); if (!r) return;
  upsert(r);
  if (accept) toast(ctx.inVoice?.() ? 'Aceito! A pessoa recebeu o convite para a sua chamada.' : 'Aceito! Mandamos uma mensagem para a pessoa. Entre numa sala de voz para chamá-la direto.');
}
function upsert(p) { const i = st.posts.findIndex(x => x.id === p.id); if (i >= 0) st.posts[i] = p; else st.posts.push(p); draw(); }

// replaceChildren não achata listas nem ignora partes ocultas (false/null): esta versão faz as duas coisas
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k || k === 0));

// ---------- criar anúncio ----------
async function createModal() {
  const games = await meta();
  const f = { game: st.game || 'valorant', game_name: '', mode: '', slots: 1, rank_min: '', rank_max: '', roles: new Set(), mic: true, when: 'now', at: '', note: '', channel_id: ctx.voiceChannel?.() || '' };
  const box = h('div.lfgform');
  const voiceRooms = [...S.guilds.values()].flatMap(gg => gg.channels.filter(c => c.type === 2).map(c => ({ id: c.id, label: `${c.name} · ${gg.name}` })));
  const sel = (opts, val, on, cls = '') => h('select' + cls, { onchange: (e) => on(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
  const draw2 = () => {
    const g = G(f.game);
    if (!g.modes.includes(f.mode) && f.game !== 'other') f.mode = g.modes[0];
    if (f.game === 'other' && !f.mode) f.mode = g.modes[0];
    put(box,
      h('div.lfglab', 'Jogo'), h('div.lfgchips.pick', games.map(x => h('button.lchip' + (f.game === x.id ? '.on' : ''), { style: { '--gc': x.color }, onclick: () => { f.game = x.id; f.roles.clear(); f.rank_min = f.rank_max = ''; draw2(); } }, h('i'), x.name))),
      f.game === 'other' && h('label.f', 'Nome do jogo', h('input', { maxLength: 40, value: f.game_name, placeholder: 'Ex.: Lethal Company', oninput: (e) => { f.game_name = e.target.value; } })),
      h('div.lfgrow',
        h('label.f', 'Modo', sel(g.modes.map(m => [m, m]), f.mode, (v) => { f.mode = v; })),
        h('label.f', 'Vagas', sel([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [n, n === 1 ? 'Falta 1' : `Faltam ${n}`]), f.slots, (v) => { f.slots = +v; }))),
      g.ranks.length > 0 && h('div.lfgrow',
        h('label.f', 'Elo mínimo', sel([['', 'Qualquer'], ...g.ranks.map(r => [r, r])], f.rank_min, (v) => { f.rank_min = v; })),
        h('label.f', 'Elo máximo', sel([['', 'Qualquer'], ...g.ranks.map(r => [r, r])], f.rank_max, (v) => { f.rank_max = v; }))),
      g.roles.length > 0 && [h('div.lfglab', 'Funções que faltam (opcional)'), h('div.lfgroles.pick', g.roles.map(r => h('button' + (f.roles.has(r) ? '.on' : ''), { onclick: () => { f.roles.has(r) ? f.roles.delete(r) : f.roles.add(r); draw2(); } }, r)))],
      h('div.lfgrow',
        h('label.f', 'Quando', sel([['now', 'Agora'], ['later', 'Mais tarde…']], f.when, (v) => { f.when = v; draw2(); })),
        f.when === 'later' ? h('label.f', 'Dia e hora', h('input', { type: 'datetime-local', value: f.at, oninput: (e) => { f.at = e.target.value; } })) : h('div')),
      h('label.f', 'Sala de voz (opcional)', sel([['', 'Nenhuma'], ...voiceRooms.map(v => [v.id, v.label])], f.channel_id, (v) => { f.channel_id = v; })),
      h('div.lfgset', h('div', h('b', 'Microfone obrigatório')), toggle(f.mic, (v) => { f.mic = v; })),
      h('label.f', 'Recado (opcional)', h('input', { maxLength: 200, value: f.note, placeholder: 'Ex.: sem rage, call tranquila', oninput: (e) => { f.note = e.target.value; } })));
  };
  draw2();
  modal('Criar anúncio', 'Quem divide servidor com você ou é seu amigo vê o anúncio e pode pedir para entrar.', box, [{ label: 'Cancelar', cls: 'link' }, { label: 'Publicar', cls: 'green', fn: async () => {
    const when_at = f.when === 'later' ? (f.at ? new Date(f.at).getTime() : NaN) : null;
    if (f.when === 'later' && !(when_at > Date.now())) { toast('Escolha um dia e hora no futuro', true); return false; }
    const r = await tryApi('POST', '/lfg/posts', { game: f.game, game_name: f.game_name, mode: f.mode, slots: f.slots, rank_min: f.rank_min || null, rank_max: f.rank_max || null, roles: [...f.roles], mic: f.mic, when_at, note: f.note, channel_id: f.channel_id || null });
    if (!r) return false;
    upsert(r); toast('Anúncio publicado');
  } }], { width: '560px' });
}

// ---------- perfil de jogador ----------
async function profileModal() {
  const games = (await meta()).filter(g => g.id !== 'other');
  const mine = new Map(((await tryApi('GET', '/lfg/profile/@me')) || []).map(p => [p.game, p]));
  let cur = st.game && st.game !== 'other' ? st.game : 'valorant';
  const box = h('div.lfgform');
  const draw2 = () => {
    const g = G(cur), p = mine.get(cur) || { ign: '', rank: '', roles: [] }, roles = new Set(p.roles);
    const ign = h('input', { maxLength: 60, value: p.ign || '', placeholder: g.idHint || 'seu nick no jogo' });
    const rank = g.ranks.length ? h('select', [['', 'Não informar'], ...g.ranks.map(r => [r, r])].map(([v, l]) => h('option', { value: v, selected: (p.rank || '') === v }, l))) : null;
    const roleBtns = h('div.lfgroles.pick', g.roles.map(r => h('button' + (roles.has(r) ? '.on' : ''), { onclick: (e) => { roles.has(r) ? roles.delete(r) : roles.add(r); e.currentTarget.classList.toggle('on'); } }, r)));
    put(box,
      h('div.lfgchips.pick', games.map(x => h('button.lchip' + (cur === x.id ? '.on' : '') + (mine.has(x.id) ? '.has' : ''), { style: { '--gc': x.color }, onclick: () => { cur = x.id; draw2(); } }, h('i'), x.name))),
      h('label.f', g.idLabel || 'Nick no jogo', ign),
      rank && h('label.f', 'Elo atual', rank),
      g.roles.length > 0 && [h('div.lfglab', 'Funções que você costuma jogar'), roleBtns],
      h('p.lfghint', 'Aparece nos seus anúncios e pedidos, com link para o OP.GG/Tracker/Faceit. O elo é informado por você (não é verificado).'),
      h('div.lfgsave', h('button.btn.green', { onclick: async () => {
        const r = await tryApi('PUT', `/lfg/profile/${cur}`, { ign: ign.value.trim(), rank: rank?.value || null, roles: [...roles] });
        if (r === undefined) return; if (r) mine.set(cur, r); else mine.delete(cur); toast(`Perfil de ${g.name} salvo`); draw2(); load();
      } }, `Salvar ${g.name}`)));
  };
  draw2();
  modal('Meu perfil de jogador', null, box, [{ label: 'Fechar', cls: 'grey' }], { width: '520px' });
}

// ---------- eventos em tempo real ----------
export function onLfgEvent(t, d) {
  if (t === 'LFG_POST') {
    const isNew = !st.posts.some(p => p.id === d.id);
    if (isNew && d.author.id !== S.me.id && !d.closed && (S.prefs.lfgAlerts || {})[d.game] && Date.now() - d.created_at < 15000) {
      playSound('mention'); toast(`${d.author.display_name} procura ${d.slots === 1 ? '1 pessoa' : d.slots + ' pessoas'} para ${d.game_name} (${d.mode})`);
      notify(`Procurando grupo: ${d.game_name}`, `${d.author.display_name} · ${d.mode} · precisa de ${d.slots}`, () => ctx.go('@me', 'lfg'));
    }
    if (st.root && document.body.contains(st.root)) upsert(d); else { const i = st.posts.findIndex(p => p.id === d.id); if (i >= 0) st.posts[i] = d; else st.posts.push(d); }
  }
  if (t === 'LFG_REQUEST') {
    playSound('mention'); toast(`${d.user.display_name} quer entrar no seu grupo de ${d.game_name}`);
    notify(`${d.user.display_name} quer entrar no seu grupo`, `${d.game_name} · ${d.mode}`, () => ctx.go('@me', 'lfg'));
  }
  if (t === 'LFG_ANSWER') {
    if (d.accept) { playSound('mention'); toast(d.invited ? `${d.author.display_name} aceitou! Veja o convite para a chamada.` : `${d.author.display_name} aceitou você no grupo de ${d.game_name}!`); }
    else toast(`${d.author.display_name} recusou o pedido para ${d.game_name}`, true);
  }
}
