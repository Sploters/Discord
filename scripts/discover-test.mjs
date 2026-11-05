// Aba Descobrir: notícias (RSS), promoções (Steam/Epic) e lançamentos, com fontes FALSAS locais (jogos e notícias
// fictícios), torneios (feed no formato do Challengermode), fonte fora do ar, "Para você" filtrando pelos interesses e interesses salvos na conta.
// Uso: node scripts/discover-test.mjs  (prints em .testshots/discover)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import http from 'node:http';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = '.testshots/discover', PORT = 3303, MOCK = 4580, BASE = `http://localhost:${PORT}`, M = `http://localhost:${MOCK}`, DATA = './.testdata33';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
// imagens: retângulos coloridos gerados aqui
const svg = (c, t) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${c}"/><text x="40" y="200" font-size="56" font-family="sans-serif" fill="#fff">${t}</text></svg>`;
const now = Date.now(), day = 864e5;
const rss = `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Jogos Hoje</title>
${[['Estrela Cadente 2 ganha data de lançamento', 'O RPG de exploração espacial chega no próximo mês com modo cooperativo.', '#7b4cff'],
   ['Torneio de Arena Rápida terá premiação recorde', 'Equipes do Brasil confirmadas na fase final do campeonato.', '#e8484f'],
   ['Atualização de Blocos & Picaretas adiciona novo bioma', 'O jogo de construção recebe cavernas de cristal e novos inimigos.', '#2ea869'],
   ['Guia: como melhorar a mira em jogos de tiro', 'Dicas de sensibilidade e treino para qualquer FPS competitivo.', '#f0a020'],
   ...Array.from({ length: 26 }, (_, i) => [`Nota rápida número ${i + 1}`, 'Resumo curto de uma notícia fictícia.', '#4a5568'])]
  .map(([t, d, c], i) => `<item><title>${t}</title><link>${M}/n/${i}</link><pubDate>${new Date(now - i * 3 * 3600e3).toUTCString()}</pubDate><description>${d}</description><media:content url="${M}/img/${i}.svg?c=${encodeURIComponent(c)}" medium="image"/></item>`).join('')}
</channel></rss>`;
const featured = { specials: { items: [
  { id: 101, name: 'Estrela Cadente', discounted: true, discount_percent: 60, original_price: 9999, final_price: 3999, currency: 'BRL', large_capsule_image: `${M}/img/s1.svg?c=%237b4cff`, discount_expiration: Math.floor((now + 3 * day) / 1000) },
  { id: 102, name: 'Arena Rápida: Edição Completa', discounted: true, discount_percent: 35, original_price: 14990, final_price: 9743, currency: 'BRL', large_capsule_image: `${M}/img/s2.svg?c=%23e8484f`, discount_expiration: Math.floor((now + 20 * 3600e3) / 1000) }] },
  coming_soon: { items: [{ id: 201 }, { id: 202 }] } };
const apps = { 201: { name: 'Estrela Cadente 2', header_image: `${M}/img/u1.svg?c=%235865f2`, release_date: { coming_soon: true, date: '12 dez., 2026' }, genres: [{ description: 'RPG' }, { description: 'Aventura' }] },
  202: { name: 'Fazendinha Tranquila', header_image: `${M}/img/u2.svg?c=%2323a55a`, release_date: { coming_soon: true, date: '2027' }, genres: [{ description: 'Simulação' }, { description: 'Indie' }] } };
const epic = { data: { Catalog: { searchStore: { elements: [
  { id: 'e1', title: 'Labirinto das Sombras', productSlug: 'labirinto', keyImages: [{ type: 'OfferImageWide', url: `${M}/img/e1.svg?c=%23333344` }], price: { totalPrice: { originalPrice: 5999, currencyCode: 'BRL' } },
    promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: new Date(now - day).toISOString(), endDate: new Date(now + 5 * day).toISOString(), discountSetting: { discountPercentage: 0 } }] }], upcomingPromotionalOffers: [] } },
  { id: 'e2', title: 'Corrida Neon', productSlug: 'corrida-neon', keyImages: [{ type: 'OfferImageWide', url: `${M}/img/e2.svg?c=%23d946ef` }], price: { totalPrice: { originalPrice: 3999, currencyCode: 'BRL' } },
    promotions: { promotionalOffers: [], upcomingPromotionalOffers: [{ promotionalOffers: [{ startDate: new Date(now + 5 * day).toISOString(), endDate: new Date(now + 12 * day).toISOString(), discountSetting: { discountPercentage: 0 } }] }] } }] } } } };
// torneios fictícios no formato do feed do Challengermode (um hoje, um amanhã, um daqui a 10 dias, um que já passou)
const tours = [['Copa Relâmpago', 'VALORANT', '5 vs 5', 16, 'Prize R$ 500, ', now + 3 * 3600e3, '#e8484f'], ['Liga dos Amigos', 'CS2', '5 vs 5', 32, '', now + day + 3600e3, '#f0a020'],
  ['Desafio Solo', 'Rocket League', '1 vs 1', 64, '', now + 10 * day, '#2ea869'], ['Torneio Antigo', 'VALORANT', '5 vs 5', 8, '', now - 2 * day, '#555'], ['(NA) Weekly Cup', 'CS2', '5 vs 5', 16, '', now + 2 * day, '#345']];
const atom = `<?xml version="1.0" encoding="utf-8" ?><feed xmlns="http://www.w3.org/2005/Atom"><title>Tournament Feed</title>${tours.map(([t, g, m, n, p, at], i) =>
  `<entry><id>cm:tournament:${i}</id><link href="${M}/t/${i}" /><title>${t} - Overview - Tournament</title><summary>${g}, ${m}, ${n} Slots, ${p}Free to enter, ${i === 2 ? 'Double' : 'Single'} Elimination, Start time ${new Date(at).toUTCString()}. Hosted by ${i === 4 ? 'Far Away Club' : 'Clube Fictício'}..</summary></entry>`).join('')}</feed>`;
// Steam (formato das APIs públicas): jogos fictícios
const SG = { 1: 'Arena Rápida', 2: 'Estrela Cadente', 3: 'Blocos & Picaretas', 4: 'Fazendinha Tranquila', 5: 'Corrida Neon' };
const sapi = { 'ISteamChartsService/GetGamesByConcurrentPlayers': { response: { ranks: [1, 3, 2, 5].map((a, i) => ({ rank: i + 1, appid: a, concurrent_in_game: 900000 - i * 200000, peak_in_game: 1000000 - i * 150000 })) } },
  'IStoreTopSellersService/GetWeeklyTopSellers': { response: { ranks: [{ rank: 1, appid: 2, last_week_rank: 3, consecutive_weeks: 4 }, { rank: 2, appid: 5, last_week_rank: 1, consecutive_weeks: 9 }, { rank: 3, appid: 3, last_week_rank: 30, consecutive_weeks: 1 }] } },
  'IStoreService/GetTagList': { response: { tags: [{ tagid: 10, name: 'Ação' }, { tagid: 11, name: 'RPG' }, { tagid: 12, name: 'Indie' }] } } };
const sitem = (a) => ({ success: 1, appid: a, name: SG[a], is_free: a === 1, tagids: [10 + (a % 3), 12], assets: { asset_url_format: `img/${a}/\${FILENAME}`, header: 'h.svg', small_capsule: 's.svg' },
  best_purchase_option: a === 1 ? null : { formatted_final_price: `R$ ${a}9,90`, discount_pct: a === 5 ? 40 : 0, formatted_original_price: 'R$ 99,90' }, reviews: { summary_filtered: { review_count: 1000, percent_positive: 80 + a, review_score_label: 'Muito positivas' } } });
const mock = http.createServer((q, r) => {
  const su = new URL(q.url, M);
  if (su.pathname.startsWith('/sapi/')) { const k = su.pathname.slice(6).replace(/\/v1\/?$/, ''); r.setHeader('content-type', 'application/json');
    if (k === 'IStoreBrowseService/GetItems') return r.end(JSON.stringify({ response: { store_items: JSON.parse(su.searchParams.get('input_json')).ids.map(x => sitem(x.appid)) } }));
    return r.end(JSON.stringify(sapi[k] || {})); }
  if (su.pathname === '/stats') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify({ users_online: '35,458,983', users_ingame: '9,806,958' })); }
  if (q.url === '/tours.xml') { r.setHeader('content-type', 'application/atom+xml'); return r.end(atom); }
  if (q.url.startsWith('/t/')) { const t = tours[+q.url.slice(3)]; r.setHeader('content-type', 'text/html'); return r.end(`<html><head><meta property="og:image" content="${M}/img/t.svg?c=${encodeURIComponent(t[6])}" /></head><body>${'x'.repeat(5000)}</body></html>`); }
  const u = new URL(q.url, M);
  if (u.pathname === '/feed.xml') { r.setHeader('content-type', 'application/rss+xml'); return r.end(rss); }
  if (u.pathname === '/steam/api/featuredcategories') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify(featured)); }
  if (u.pathname === '/steam/api/appdetails') { const id = u.searchParams.get('appids'); r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify({ [id]: { success: true, data: apps[id] } })); }
  if (u.pathname === '/epic') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify(epic)); }
  if (u.pathname === '/broken.xml') { r.statusCode = 500; return r.end(); }
  if (u.pathname.startsWith('/img/')) { r.setHeader('content-type', 'image/svg+xml'); return r.end(svg(u.searchParams.get('c') || '#555', '')); }
  r.statusCode = 404; r.end();
}).listen(MOCK);
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(DATA + '/discover.json', JSON.stringify({ news: [{ name: 'Jogos Hoje', url: M + '/feed.xml', lang: 'pt' }, { name: 'Site Fora do Ar', url: M + '/broken.xml', lang: 'pt' }], steamBase: M + '/steam', epicUrl: M + '/epic', cmFeed: M + '/tours.xml', steamApi: M + '/sapi', steamStats: M + '/stats', hostRegions: { 'Clube Fictício': 'br' } }));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const r = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'senha123' }) }).then(r => r.json());
  const P = await browser.newPage(); P.setDefaultTimeout(15000); await P.setViewport({ width: 1366, height: 860, deviceScaleFactor: 1 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, r.token);
  await P.goto(BASE); await P.waitForSelector('#rail');
  ok(await P.evaluate(() => [...document.querySelectorAll('#side-list .ch .name')].some(x => x.textContent === 'Descobrir')), 'entrada "Descobrir" na Home, abaixo de Procurar jogadores');
  await P.evaluate(() => [...document.querySelectorAll('#side-list .ch')].find(x => /Descobrir/.test(x.textContent)).click());
  await P.waitForSelector('#discoverview .dint'); await sleep(1500);
  ok(await P.evaluate(() => [...document.querySelectorAll('.dtab')].map(x => x.textContent).join(',') === 'Início,Notícias,Torneios'), 'só 3 abas: Início, Notícias, Torneios');
  const secs = () => P.evaluate(() => [...document.querySelectorAll('.dhsec')].map(s => ({ k: s.dataset.sec, cards: s.querySelectorAll('.dcard').length, rail: !!s.querySelector('.drail'), rows: s.querySelectorAll('.drow').length, more: s.querySelector('.dmore')?.textContent || '' })));
  const home = await secs();
  ok(['charts', 'deals', 'upcoming', 'tournaments', 'news'].every(k => home.some(x => x.k === k)), 'Início: Na Steam, Promoções, Lançamentos, Torneios e Notícias', home);
  const rd = await P.evaluate(() => { const r = document.querySelector('.dhsec[data-sec="news"] .drail'); const c = r.querySelectorAll('.dcard'); const vis = [...c].filter(x => x.getBoundingClientRect().right <= r.getBoundingClientRect().right + 2).length; return { n: c.length, vis, scrolls: r.scrollWidth > r.clientWidth }; });
  ok(rd.n === 12 && rd.vis === 3 && rd.scrolls, 'carrossel: 3 visíveis, até 12, rola para o lado', rd);
  await P.evaluate(() => document.querySelector('.dhsec[data-sec="news"] .drailbtn.next').click()); await sleep(700);
  ok(await P.evaluate(() => document.querySelector('.dhsec[data-sec="news"] .drail').scrollLeft > 100 && !document.querySelector('.dhsec[data-sec="news"] .drailwrap').classList.contains('atstart')), 'seta "Próximos" rola o carrossel');
  ok(home.find(x => x.k === 'deals').rail && /Ver tudo \(4\)/.test(home.find(x => x.k === 'deals').more), 'seções com "Ver tudo (N)" em cima', home.find(x => x.k === 'deals'));
  ok(home.find(x => x.k === 'charts').rows === 7, 'Na Steam resumido: mais jogados e mais vendidos (até 5 cada)', home.find(x => x.k === 'charts'));
  ok(await P.evaluate(() => !document.querySelector('.dstats')), 'sem os números de online/jogando');
  const click = (sec, re) => P.evaluate((k, r) => [...document.querySelector(`.dhsec[data-sec="${k}"]`).querySelectorAll('.dmore')].find(b => new RegExp(r).test(b.textContent)).click(), sec, re);
  await click('deals', 'Ver tudo'); await sleep(300);
  const deals = await P.evaluate(() => [...document.querySelectorAll('.dhsec[data-sec="deals"] .dgrid .dcard')].map(c => c.querySelector('.dtitle').textContent + ' | ' + c.querySelector('.dprice').textContent));
  ok(deals.length === 4 && /Grátis/.test(deals[0]) && /Em breve grátis/.test(deals[1]) && /-60%/.test(deals[2]) && /39,99/.test(deals[2]), '"Ver tudo" abre em grade: grátis da Epic primeiro, depois Steam por desconto', deals);
  await click('deals', 'Ver menos'); await click('charts', 'Ver tudo'); await sleep(300);
  const ch = await P.evaluate(() => ({ panels: [...document.querySelectorAll('.dpanel')].map(p => [...p.querySelectorAll('.drow')].map(r => r.innerText.replace(/\n+/g, ' | '))) }));
  ok(ch.panels[0].length === 4 && /Arena Rápida/.test(ch.panels[0][0]) && /900\.000/.test(ch.panels[0][0]), 'mais jogados agora, com jogadores', ch.panels[0]);
  ok(ch.panels[1].length === 3 && /▲2/.test(ch.panels[1][0]) && /▼1/.test(ch.panels[1][1]) && /-40%/.test(ch.panels[1][1]) && /▲27/.test(ch.panels[1][2]), 'mais vendidos com subida/descida e preço', ch.panels[1]);
  await click('charts', 'Ver menos');
  const up = await P.evaluate(() => [...document.querySelectorAll('.dhsec[data-sec="upcoming"] .dcard')].map(c => c.innerText.replace(/\n+/g, ' | ')));
  ok(up.length === 2 && /12 dez/.test(up[0]) && /RPG/.test(up[0]), 'lançamentos com data e gêneros', up);
  await P.evaluate(() => document.querySelector('.dbodywrap').scrollTo(0, 0)); await P.screenshot({ path: OUT + '/disc-inicio.png' });

  const tab = async (name) => { await P.evaluate((n) => [...document.querySelectorAll('.dtab')].find(x => x.textContent === n).click(), name); await sleep(900); };
  await tab('Notícias');
  const pg = await P.evaluate(() => ({ cards: document.querySelectorAll('.dcard').length, first: document.querySelector('.dcard .dtitle')?.textContent, href: document.querySelector('a.dcard')?.target, pages: [...document.querySelectorAll('.dpg.num')].map(x => x.textContent), note: document.querySelector('.dnote')?.textContent }));
  ok(pg.cards === 12 && /Estrela Cadente 2/.test(pg.first) && pg.href === '_blank' && pg.pages.join() === '1,2,3', 'notícias em páginas de 12, mais nova primeiro', pg);
  ok(/Site Fora do Ar/.test(pg.note || ''), 'fonte fora do ar aparece no aviso, sem quebrar as outras', pg.note);
  await P.evaluate(() => [...document.querySelectorAll('.dpg.num')].find(x => x.textContent === '3').click()); await sleep(200);
  ok(await P.evaluate(() => document.querySelectorAll('.dcard').length === 6 && document.querySelector('.dpg.on').textContent === '3'), 'última página com o resto (30 notícias)');
  await P.screenshot({ path: OUT + '/disc-noticias.png' });

  await tab('Torneios');
  const tr = await P.evaluate(() => ({ secs: [...document.querySelectorAll('.dsec')].map(x => x.textContent), cards: [...document.querySelectorAll('.dcard')].map(c => c.innerText.replace(/\n+/g, ' | ')), sites: [...document.querySelectorAll('.dsite b')].map(x => x.textContent) }));
  ok(tr.cards.length === 3 && /Copa Relâmpago/.test(tr.cards[0]) && /R\$ 500/.test(tr.cards[0]) && /Hoje|Começa/.test(tr.cards[0]) && /Amanhã/.test(tr.cards[1]) && /Eliminação dupla/.test(tr.cards[2]) && !tr.cards.some(c => /Antigo/.test(c)), 'torneios: por data, com prêmio, formato traduzido e sem os que já passaram', tr.cards);
  ok(tr.secs.some(x => /^Hoje/.test(x)) && tr.secs.some(x => /Próximos 7 dias/.test(x)) && tr.secs.some(x => /Mais adiante/.test(x)), 'torneios separados por hoje / 7 dias / depois', tr.secs);
  ok(['GamersClub', 'Battlefy', 'Challengermode'].every(n => tr.sites.includes(n)), 'atalhos para GamersClub, Battlefy e Challengermode', tr.sites);
  await P.evaluate(() => [...document.querySelectorAll('.dchips .dchip')].find(x => /^CS2/.test(x.textContent)).click()); await sleep(200);
  ok(await P.evaluate(() => document.querySelectorAll('.dcard').length === 1 && /Liga dos Amigos/.test(document.querySelector('.dcard').textContent)), 'filtro por jogo');
  await P.evaluate(() => [...document.querySelectorAll('.dchips .dchip')].find(x => /Todos os jogos/.test(x.textContent)).click());
  await P.evaluate(() => document.querySelector('.dchip.dtoggle').click()); await sleep(200);
  ok(await P.evaluate(() => document.querySelectorAll('.dcard').length === 1), 'filtro "Com prêmio"');
  await P.evaluate(() => document.querySelector('.dchip.dtoggle').click());
  await P.evaluate(() => [...document.querySelectorAll('.dregions .dchip')].find(x => /Todas/.test(x.textContent)).click()); await sleep(300);
  const allReg = await P.evaluate(() => [...document.querySelectorAll('.dcard .dtitle')].map(x => x.textContent));
  ok(allReg.length === 4 && allReg.includes('(NA) Weekly Cup') && !tr.cards.some(c => /Weekly/.test(c)), 'região: Brasil por padrão esconde torneio dos EUA; "Todas as regiões" mostra', allReg);
  await P.evaluate(() => [...document.querySelectorAll('.dregions .dchip')].find(x => x.textContent === 'Brasil').click()); await sleep(300);
  await sleep(9500); // as imagens chegam em segundo plano e a aba recarrega sozinha
  ok(await P.evaluate(() => document.querySelectorAll('.dtimg img').length === 3), 'imagens dos torneios (og:image) carregadas', await P.evaluate(() => document.querySelectorAll('.dtimg img').length));
  await P.screenshot({ path: OUT + '/disc-torneios.png' });

  await tab('Início');
  const addInt = async (t) => { await P.waitForSelector('.dint-in'); await P.evaluate(() => document.querySelector('.dint-in').focus()); await P.keyboard.type(t); await P.keyboard.press('Enter'); await sleep(400); };
  await addInt('Estrela Cadente'); await addInt('Valorant');
  const fy = await P.evaluate(() => { const s = document.querySelector('.dhsec[data-sec="foryou"]'); return { titles: [...s.querySelectorAll('.dcard .dtitle')].map(x => x.textContent), kinds: [...s.querySelectorAll('.dcard .dmeta b')].map(x => x.textContent), more: s.querySelector('.dmore')?.textContent }; });
  ok(fy.titles.includes('Estrela Cadente') && fy.titles.includes('Copa Relâmpago') && !fy.titles.some(t => /^Arena/.test(t)) && fy.kinds[0] === 'Steam' && fy.kinds[1] === 'Challengermode', '"Para você" mistura promoções, torneios etc. do que combina', fy);
  await P.evaluate(() => [...document.querySelectorAll('.dint .btn')].find(b => /Pronto/.test(b.textContent)).click()); await sleep(200);
  ok(await P.evaluate(() => !!document.querySelector('.dint.mini') && document.querySelectorAll('.dint.mini .dchip').length === 2), 'interesses ficam resumidos numa linha com "Editar"');
  await sleep(1800); const saved = await P.evaluate(async () => (await (await fetch('/api/me/settings', { headers: { authorization: 'Bearer ' + localStorage.lc_token } })).json()));
  ok(JSON.stringify(saved).includes('Estrela Cadente'), 'interesses salvos na conta');
  await P.evaluate(() => document.querySelector('.dbodywrap').scrollTo(0, 0)); await P.screenshot({ path: OUT + '/disc-paravoce.png' });
  await P.setViewport({ width: 412, height: 860, isMobile: true, hasTouch: true }); await sleep(500);
  await P.screenshot({ path: OUT + '/disc-celular.png' });
} catch (e) { console.log('ERRO', e.message); fails++; }
finally { await browser.close(); srv.kill(); mock.close(); fs.rmSync(DATA, { recursive: true, force: true }); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
