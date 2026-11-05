// Aba "Descobrir" (Home, abaixo de Procurar jogadores): Para você, Notícias, Promoções, Lançamentos e Torneios.
// O servidor busca as fontes (server/discover.js); aqui só mostramos. "Para você" junta o que combina com os
// interesses da pessoa (jogos e assuntos que ela escolhe), salvos na conta junto com as outras preferências.
// Notícias: título, resumo curto e imagem; o texto completo abre no site original.
import { h, icon } from './util.js';
import { S, api, savePrefs } from './state.js';

const TABS = [['foryou', 'Para você'], ['news', 'Notícias'], ['deals', 'Promoções'], ['upcoming', 'Lançamentos'], ['tournaments', 'Torneios']];
const ALL = ['news', 'deals', 'upcoming', 'tournaments'];
const st = { tab: 'foryou', data: {}, loading: {}, error: {}, at: {}, root: null, srcFilter: null, game: null, prize: false };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const interests = () => (Array.isArray(S.prefs.discoverInterests) ? S.prefs.discoverInterests : []);
const setInterests = (list) => { S.prefs.discoverInterests = [...new Set(list.map(x => x.trim()).filter(Boolean))].slice(0, 40); savePrefs(); draw(); };
const money = (v, cur) => { try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: cur || 'BRL' }).format(v); } catch { return `${cur} ${v.toFixed(2)}`; } };
const ago = (t) => { if (!t) return ''; const s = (Date.now() - t) / 1000; if (s < 3600) return `há ${Math.max(1, Math.floor(s / 60))} min`; if (s < 86400) return `há ${Math.floor(s / 3600)} h`; const d = Math.floor(s / 86400); return d < 7 ? `há ${d} d` : new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }); };
const until = (t) => { if (!t) return ''; const s = (t - Date.now()) / 1000; if (s <= 0) return 'termina hoje'; if (s < 86400) return `termina em ${Math.max(1, Math.floor(s / 3600))} h`; return `até ${new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`; };
// combina com um interesse? (palavra inteira, sem acento e sem diferenciar maiúsculas)
const matchOf = (item) => { const txt = ' ' + norm([item.title, item.summary, ...(item.tags || [])].join(' ')).replace(/[^a-z0-9]+/g, ' ') + ' '; return interests().find(i => { const k = norm(i).replace(/[^a-z0-9]+/g, ' ').trim(); return k && txt.includes(' ' + k + ' '); }); };

async function load(kind, force) {
  if (st.loading[kind] || (!force && st.data[kind] && Date.now() - st.at[kind] < 5 * 60e3)) return;
  st.loading[kind] = true; st.error[kind] = null; draw();
  const r = await api('GET', `/discover/${kind}`).catch((e) => ({ error: e.message }));
  st.loading[kind] = false;
  if (r?.items) { st.data[kind] = r; st.at[kind] = Date.now(); if (kind === 'tournaments') refreshImages(); } else st.error[kind] = r?.error || 'Não consegui buscar agora. Tente de novo em instantes.';
  draw();
}
const ensure = () => { if (st.tab === 'foryou') ALL.forEach(k => load(k)); else load(st.tab); };
// torneios: as imagens chegam aos poucos (o servidor busca em segundo plano); recarrega uma vez para pegá-las
let imgRetry = 0;
const refreshImages = () => { const it = st.data.tournaments?.items || []; if (imgRetry < 2 && it.some(t => !t.image)) { imgRetry++; setTimeout(() => load('tournaments', true), 8000); } };

// ---------- cartões ----------
const img = (src, cls = '.dimg') => h('div' + cls, src ? h('img', { src, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null);
const link = (url, ...kids) => h('a.dcard', { href: url, target: '_blank', rel: 'noopener noreferrer' }, ...kids);
const why = (item) => { const m = matchOf(item); return m ? h('span.dwhy', icon('star', 12), m) : null; };
const newsCard = (n) => link(n.url, img(n.image),
  h('div.dbody', h('div.dmeta', h('b', n.source), n.date && h('span', ago(n.date)), why(n)), h('div.dtitle', n.title), n.summary && h('p.dsum', n.summary)));
const dealCard = (d) => link(d.url, img(d.image),
  h('div.dbody', h('div.dmeta', h('b', d.store), d.upcoming ? h('span', `grátis a partir de ${new Date(d.starts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`) : d.ends && h('span', until(d.ends)), why(d)),
    h('div.dtitle', d.title),
    h('div.dprice', d.free ? h('span.dfree', d.upcoming ? 'Em breve grátis' : 'Grátis') : h('span.doff', `-${d.discount}%`),
      d.old > 0 && h('s', money(d.old, d.currency)), !d.free && h('b', money(d.price, d.currency)))));
// quando começa: "Hoje, 21:00", "Amanhã, 18:30", "sex., 18 de dez., 19:00" (no horário de quem está vendo)
const dayKey = (t) => new Date(t).toDateString();
const hm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const when = (t) => {
  if (!t) return 'Data a definir';
  const now = Date.now(); if (t <= now) return 'Em andamento';
  if (dayKey(t) === dayKey(now)) return t - now < 3600e3 ? `Começa em ${Math.max(1, Math.round((t - now) / 60e3))} min` : `Hoje, ${hm(t)}`;
  if (dayKey(t) === dayKey(now + 864e5)) return `Amanhã, ${hm(t)}`;
  return new Date(t).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }) + ', ' + hm(t);
};
const FORMATS = { 'single elimination': 'Eliminação simples', 'double elimination': 'Eliminação dupla', 'round robin': 'Todos contra todos', 'swiss': 'Suíço', 'groups': 'Grupos', 'battle royale': 'Battle royale', 'leaderboard': 'Ranking' };
const fmt = (f) => String(f || '').split(' + ').map(x => FORMATS[x.toLowerCase().trim()] || x).join(' + ');
const tourCard = (t) => link(t.url,
  h('div.dimg.dtimg', t.image ? h('img', { src: t.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null, h('span.dtgame', t.game || 'Torneio'),
    h('span.dtwhen' + (t.starts && t.starts - Date.now() < 864e5 ? '.soon' : ''), icon('calendar', 12), when(t.starts))),
  h('div.dbody', h('div.dmeta', h('b', t.source), t.host && h('span', 'por ' + t.host), why(t)),
    h('div.dtitle', t.title),
    h('div.dtags', t.mode && h('span', t.mode), t.slots > 0 && h('span', `${t.slots} vagas`), t.format && h('span', fmt(t.format))),
    h('div.dprice', t.prize ? h('span.dprize', icon('trophy', 13), t.prize) : null, t.free === true ? h('span.dfree', 'Inscrição grátis') : t.free === false ? h('span.dpaid', 'Inscrição paga') : null)));
const upCard = (u) => link(u.url, img(u.image),
  h('div.dbody', h('div.dmeta', h('b', u.store), u.date && h('span', u.soon ? `Lança: ${u.date}` : u.date), why(u)), h('div.dtitle', u.title),
    u.tags?.length && h('div.dtags', u.tags.map(t => h('span', t)))));

const grid = (items, card) => h('div.dgrid', items.map(card));
function state(kind, items, empty) {
  if (st.loading[kind] && !st.data[kind]) return h('div.dgrid', Array.from({ length: 6 }, () => h('div.dcard.skel', h('div.dimg'), h('div.dbody', h('i'), h('i'), h('i')))));
  if (st.error[kind] && !st.data[kind]) return h('div.dempty', h('b', st.error[kind]), h('button.btn.grey', { onclick: () => load(kind, true) }, 'Tentar de novo'));
  if (!items.length) return h('div.dempty', empty);
  return null;
}

// ---------- abas ----------
function newsTab() {
  const all = st.data.news?.items || [], sources = [...new Set(all.map(n => n.source))];
  const hidden = new Set(S.prefs.discoverHide || []);
  const items = all.filter(n => !hidden.has(n.source) && (!st.srcFilter || n.source === st.srcFilter));
  const chips = sources.length > 1 && h('div.dchips', h('button.dchip' + (!st.srcFilter ? '.on' : ''), { onclick: () => { st.srcFilter = null; draw(); } }, 'Todos'),
    sources.map(s => h('button.dchip' + (st.srcFilter === s ? '.on' : '') + (hidden.has(s) ? '.off' : ''), { onclick: () => { st.srcFilter = st.srcFilter === s ? null : s; draw(); }, oncontextmenu: (e) => { e.preventDefault(); const set = new Set(S.prefs.discoverHide || []); set.has(s) ? set.delete(s) : set.add(s); S.prefs.discoverHide = [...set]; savePrefs(); draw(); }, title: 'Clique: só este site · Clique direito: esconder/mostrar' }, s)));
  const failed = st.data.news?.failed?.length ? h('p.dnote', `Não consegui buscar agora: ${st.data.news.failed.join(', ')}.`) : null;
  return [chips, state('news', items, 'Nenhuma notícia por aqui.') || grid(items, newsCard), failed];
}
function dealsTab() {
  const items = st.data.deals?.items || [], free = items.filter(d => d.free), paid = items.filter(d => !d.free);
  return state('deals', items, 'Nenhuma promoção encontrada agora.') || [
    free.length && h('h3.dsec', icon('gift', 18), 'Grátis'), free.length && grid(free, dealCard),
    paid.length && h('h3.dsec', icon('tag', 18), 'Em promoção'), paid.length && grid(paid, dealCard)];
}
const upcomingTab = () => { const items = st.data.upcoming?.items || []; return state('upcoming', items, 'Nenhum lançamento na lista agora.') || grid(items, upCard); };

function tournamentsTab() {
  const data = st.data.tournaments, all = data?.items || [];
  const counts = {}; for (const t of all) if (t.game) counts[t.game] = (counts[t.game] || 0) + 1;
  const games = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 14);
  if (st.game && !counts[st.game]) st.game = null;
  const items = all.filter(t => (!st.game || t.game === st.game) && (!st.prize || t.prize));
  const chips = all.length > 0 && h('div.dchips',
    h('button.dchip' + (!st.game ? '.on' : ''), { onclick: () => { st.game = null; draw(); } }, 'Todos os jogos'),
    games.map(g => h('button.dchip' + (st.game === g ? '.on' : ''), { onclick: () => { st.game = st.game === g ? null : g; draw(); } }, g, h('small.dcount', String(counts[g])))),
    h('button.dchip.dtoggle' + (st.prize ? '.on' : ''), { onclick: () => { st.prize = !st.prize; draw(); }, title: 'Só torneios que anunciam prêmio' }, icon('trophy', 13), 'Com prêmio'));
  // por quando começam: hoje, nos próximos 7 dias, depois
  const now = Date.now(), today = items.filter(t => !t.starts || dayKey(t.starts) === dayKey(now) || t.starts < now), rest = items.filter(t => !today.includes(t));
  const week = rest.filter(t => t.starts - now < 7 * 864e5), later = rest.filter(t => !week.includes(t));
  const sec = (ic, label, list) => list.length ? [h('h3.dsec', icon(ic, 18), label, h('small.dcount', String(list.length))), grid(list, tourCard)] : [];
  const sites = h('div.dsites', (data?.links || []).map(l => h('div.dsite',
    h('a.dsite-main', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, h('b', l.name, icon('external', 14)), h('small', l.desc)),
    l.games?.length ? h('div.dsite-games', l.games.map(([g, u]) => h('a.dchip', { href: u, target: '_blank', rel: 'noopener noreferrer' }, g))) : null)));
  const body = state('tournaments', items, all.length ? 'Nenhum torneio com esses filtros.' : 'Nenhum torneio aberto encontrado agora.')
    || [...sec('star', 'Hoje', today), ...sec('calendar', 'Próximos 7 dias', week), ...sec('trophy', 'Mais adiante', later)];
  return [chips, body, data?.links?.length && h('h3.dsec', icon('external', 18), 'Mais torneios nos sites'), data?.links?.length && sites,
    data?.links?.length && h('p.dnote', 'GamersClub e Battlefy não liberam a lista de torneios para outros apps, então os atalhos abrem direto no site. Inscrição e regras ficam sempre no site de cada torneio.')];
}

// "Para você": interesses (editar) + o que combina com eles nas três listas
async function suggestions() {
  const lfg = await api('GET', '/lfg/meta').catch(() => null);
  return [...(lfg?.games || []).map(g => g.name), 'Steam', 'PlayStation', 'Xbox', 'Nintendo', 'Indie', 'FPS', 'RPG'];
}
let sugg = null;
function forYouTab() {
  const mine = interests();
  if (!sugg) suggestions().then(s => { sugg = s; draw(); });
  const input = h('input.dint-in', { name: 'discover-interest', placeholder: 'Adicionar jogo ou assunto (ex.: Valorant, Minecraft, RPG)', maxLength: 40,
    onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { setInterests([...mine, e.target.value]); } } });
  const box = h('div.dint',
    h('div.dint-head', h('b', 'Seus interesses'), h('small', 'O "Para você" mostra notícias, promoções, lançamentos e torneios destes jogos ou assuntos.')),
    h('div.dchips', mine.map(i => h('span.dchip.on.rm', i, h('button', { title: 'Remover', onclick: () => setInterests(mine.filter(x => x !== i)) }, icon('x', 12)))), input),
    sugg && h('div.dsugg', h('small', 'Sugestões:'), sugg.filter(s => !mine.some(m => norm(m) === norm(s))).slice(0, 12).map(s => h('button.dchip', { onclick: () => setInterests([...mine, s]) }, '+ ' + s))));
  if (!mine.length) return [box, h('div.dempty', h('b', 'Escolha seus jogos e assuntos'), h('p', 'Adicione o que você joga ou acompanha e o seu feed aparece aqui.'))];
  const n = (st.data.news?.items || []).filter(matchOf).slice(0, 30), d = (st.data.deals?.items || []).filter(matchOf), u = (st.data.upcoming?.items || []).filter(matchOf);
  const t = (st.data.tournaments?.items || []).filter(matchOf).slice(0, 12);
  const loading = ALL.some(k => st.loading[k] && !st.data[k]);
  if (!n.length && !d.length && !u.length && !t.length) return [box, loading ? state('news', [], '') : h('div.dempty', h('b', 'Nada sobre seus interesses agora'), h('p', 'Volte mais tarde ou adicione outros jogos e assuntos.'))];
  return [box,
    d.length && h('h3.dsec', icon('tag', 18), 'Promoções para você'), d.length && grid(d, dealCard),
    t.length && h('h3.dsec', icon('trophy', 18), 'Torneios dos seus jogos'), t.length && grid(t, tourCard),
    u.length && h('h3.dsec', icon('calendar', 18), 'Lançamentos que você acompanha'), u.length && grid(u, upCard),
    n.length && h('h3.dsec', icon('news', 18), 'Notícias'), n.length && grid(n, newsCard)];
}

function draw() {
  const root = st.root; if (!root?.isConnected) return;
  const body = st.tab === 'news' ? newsTab() : st.tab === 'deals' ? dealsTab() : st.tab === 'upcoming' ? upcomingTab() : st.tab === 'tournaments' ? tournamentsTab() : forYouTab();
  root.replaceChildren(
    h('div#topbar', h('span.hash', icon('compass', 24)), h('span', 'Descobrir'),
      h('div.dtabs', TABS.map(([k, l]) => h('button.dtab' + (st.tab === k ? '.on' : ''), { onclick: () => { st.tab = k; ensure(); draw(); } }, l))),
      h('div.spacer'), h('button.ibtn', { title: 'Atualizar', onclick: () => (st.tab === 'foryou' ? ALL : [st.tab]).forEach(k => load(k, true)) }, icon('refresh', 20))),
    h('div.dbodywrap', ...[body].flat().filter(Boolean)));
  if (document.activeElement?.name !== 'discover-interest') return;
}

export function renderDiscover(main) {
  st.root = h('div#discoverview'); main.replaceChildren(st.root);
  ensure(); draw();
  if (st.tab === 'foryou') setTimeout(() => st.root?.querySelector('.dint-in') && !interests().length && st.root.querySelector('.dint-in').focus(), 0);
}
