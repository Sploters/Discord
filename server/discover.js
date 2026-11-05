// Aba "Descobrir": notícias de jogos, promoções e próximos lançamentos, buscados pelo servidor e guardados por um tempo
// (o app é rápido e os sites não recebem um pedido por pessoa). Das notícias só vão título, um resumo curto, imagem e
// o link para ler no site original.
// Fontes: as padrão abaixo, ou o arquivo <dados>/discover.json ({ "news": [{ "name", "url", "lang" }], "steam": true,
// "epic": true, "country": "BR" }). DISCOVER_OFF=1 desliga tudo. ("steamBase"/"epicUrl" trocam os endereços: testes)
//   GET /api/discover/news      -> { items: [{ id, title, summary, url, image, source, lang, date }], failed: [nomes] }
//   GET /api/discover/deals     -> { items: [{ id, title, url, image, store, price, old, currency, discount, free, starts, ends }] }
//   GET /api/discover/upcoming  -> { items: [{ id, title, url, image, store, date, tags }] }
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_NEWS = [
  { name: 'Adrenaline', url: 'https://adrenaline.com.br/feed/', lang: 'pt' },
  { name: 'MeuPlayStation', url: 'https://meups.com.br/feed/', lang: 'pt' },
  { name: 'GameBlast', url: 'https://www.gameblast.com.br/feeds/posts/default', lang: 'pt' },
  { name: 'PC Gamer', url: 'https://www.pcgamer.com/rss/', lang: 'en' },
  { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/mashup/', lang: 'en' },
  { name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml', lang: 'en' },
];
const UA = 'Mozilla/5.0 (compatible; LocalCord-Discover/1.0; +https://github.com/Sploters)';

// ---------- texto ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s) => String(s || '').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));
const cdata = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const strip = (html) => decode(cdata(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n) > n * 0.6 ? s.lastIndexOf(' ', n) : n).replace(/[\s,.;:–-]+$/, '') + '…');
const httpUrl = (u) => { try { const x = new URL(decode(cdata(u)).trim()); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

// ---------- RSS / Atom (só o necessário: título, link, data, resumo, imagem) ----------
const tag = (xml, names) => { for (const n of names) { const m = xml.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i')); if (m) return m[1]; } return ''; };
const attr = (xml, el, a, cond) => { const re = new RegExp(`<${el}\\b([^>]*)>`, 'gi'); let m; while ((m = re.exec(xml))) { const at = m[1]; if (cond && !cond.test(at)) continue; const v = at.match(new RegExp(`\\b${a}\\s*=\\s*["']([^"']+)["']`, 'i')); if (v) return v[1]; } return ''; };
export function parseFeed(xml, source) {
  const out = [], items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const it of items.slice(0, 40)) {
    const title = strip(tag(it, ['title'])); if (!title) continue;
    const url = httpUrl(tag(it, ['link']).trim()) || httpUrl(attr(it, 'link', 'href', /rel\s*=\s*["']alternate|^(?![\s\S]*rel=)/i)) || httpUrl(attr(it, 'link', 'href')) || httpUrl(tag(it, ['guid', 'id']));
    if (!url) continue;
    const body = tag(it, ['content:encoded', 'description', 'summary', 'content']);
    const image = httpUrl(attr(it, 'media:content', 'url', /medium\s*=\s*["']image|type\s*=\s*["']image|^(?![\s\S]*(medium|type)=)/i)) || httpUrl(attr(it, 'media:thumbnail', 'url'))
      || httpUrl(attr(it, 'enclosure', 'url', /type\s*=\s*["']image/i)) || httpUrl((cdata(decode(body)).match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || '');
    const d = Date.parse(strip(tag(it, ['pubDate', 'published', 'updated', 'dc:date'])));
    out.push({ id: `${source.name}:${url}`, title: cut(title, 160), summary: cut(strip(body), 220), url, image, source: source.name, lang: source.lang || '', date: isFinite(d) ? d : null });
  }
  return out;
}

export function mountDiscover(app, { auth, dataDir }) {
  const conf = () => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'discover.json'), 'utf8')); } catch { return {}; } };
  const off = () => process.env.DISCOVER_OFF === '1';
  const get = async (url, type = 'text', ms = 10000) => {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: type === 'json' ? 'application/json' : 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const len = +r.headers.get('content-length') || 0; if (len > 4e6) throw new Error('grande demais');
    return type === 'json' ? r.json() : r.text();
  };
  // cache por chave: guarda o último resultado bom; se a fonte falhar, continua servindo o antigo
  const cache = new Map(), busy = new Map(), warned = new Set();
  const cached = (key, ttl, load) => {
    const c = cache.get(key);
    if (c && Date.now() - c.at < ttl) return Promise.resolve(c.v);
    if (!busy.has(key)) busy.set(key, load().then(v => { cache.set(key, { at: Date.now(), v }); warned.delete(key); return v; })
      .catch(e => { if (!warned.has(key)) { warned.add(key); console.log(`  Descobrir: ${key} falhou (${e.message})`); } if (c) { c.at = Date.now() - ttl + 5 * 60e3; return c.v; } throw e; }) // tenta de novo em 5 min
      .finally(() => busy.delete(key)));
    return busy.get(key);
  };

  // ---------- notícias ----------
  async function news() {
    const sources = (Array.isArray(conf().news) ? conf().news : DEFAULT_NEWS).filter(s => s?.name && httpUrl(s.url));
    const res = await Promise.all(sources.map(s => cached('news:' + s.url, 20 * 60e3, async () => parseFeed(await get(s.url), s)).then(v => ({ s, v }), () => ({ s, v: null }))));
    const seen = new Set(), items = [];
    for (const { v } of res) for (const it of v || []) { const k = it.title.toLowerCase(); if (!seen.has(k)) { seen.add(k); items.push(it); } }
    items.sort((a, b) => (b.date || 0) - (a.date || 0));
    return { items: items.slice(0, 150), failed: res.filter(r => !r.v).map(r => r.s.name) };
  }

  // ---------- Steam (promoções e lançamentos da loja, em reais com country BR) ----------
  const country = () => String(conf().country || 'BR').slice(0, 2).toUpperCase();
  const steamFeatured = () => cached('steam:featured', 30 * 60e3, () => get(`${steamBase()}/api/featuredcategories?cc=${country()}&l=portuguese`, 'json'));
  const steamBase = () => String(conf().steamBase || 'https://store.steampowered.com').replace(/\/+$/, '');
  const steamUrl = (id) => `https://store.steampowered.com/app/${id}/`;
  async function steamDeals() {
    if (conf().steam === false) return [];
    const f = await steamFeatured();
    return (f?.specials?.items || []).filter(x => x.discounted && x.discount_percent > 0).map(x => ({
      id: 'steam:' + x.id, title: x.name, url: steamUrl(x.id), image: x.large_capsule_image || x.header_image || '', store: 'Steam',
      price: x.final_price / 100, old: x.original_price / 100, currency: x.currency || 'BRL', discount: x.discount_percent, free: x.final_price === 0,
      ends: x.discount_expiration ? x.discount_expiration * 1000 : null,
    }));
  }
  async function steamUpcoming() {
    if (conf().steam === false) return [];
    const f = await steamFeatured();
    const ids = [...new Set((f?.coming_soon?.items || []).map(x => x.id))].slice(0, 16);
    const out = [];
    for (const id of ids) { // detalhes de cada jogo (data e gêneros), guardados por 12 h
      const d = await cached('steam:app:' + id, 12 * 3600e3, () => get(`${steamBase()}/api/appdetails?appids=${id}&cc=${country()}&l=portuguese`, 'json')).catch(() => null);
      const a = d?.[id]?.data; if (!a) continue;
      out.push({ id: 'steam:' + id, title: a.name, url: steamUrl(id), image: a.header_image || '', store: 'Steam', date: a.release_date?.date || '', soon: !!a.release_date?.coming_soon, tags: (a.genres || []).map(g => g.description).slice(0, 4) });
    }
    return out;
  }

  // ---------- Epic Games: jogos grátis da semana e os próximos ----------
  async function epicFree() {
    if (conf().epic === false) return [];
    const j = await cached('epic:free', 60 * 60e3, () => get(conf().epicUrl || `https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=pt-BR&country=${country()}&allowCountries=${country()}`, 'json'));
    const out = [];
    for (const e of j?.data?.Catalog?.searchStore?.elements || []) {
      const now = e.promotions?.promotionalOffers?.[0]?.promotionalOffers?.find(o => o.discountSetting?.discountPercentage === 0);
      const next = e.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers?.find(o => o.discountSetting?.discountPercentage === 0);
      const offer = now || next; if (!offer) continue;
      const slug = e.productSlug || e.catalogNs?.mappings?.[0]?.pageSlug || e.offerMappings?.[0]?.pageSlug;
      const img = (e.keyImages || []).find(k => /OfferImageWide|DieselStoreFrontWide/.test(k.type)) || (e.keyImages || [])[0];
      out.push({
        id: 'epic:' + e.id, title: e.title, url: slug ? `https://store.epicgames.com/pt-BR/p/${slug}` : 'https://store.epicgames.com/pt-BR/free-games',
        image: img?.url || '', store: 'Epic Games', price: 0, old: (e.price?.totalPrice?.originalPrice || 0) / 100, currency: e.price?.totalPrice?.currencyCode || 'BRL',
        discount: 100, free: true, upcoming: !now, starts: Date.parse(offer.startDate) || null, ends: Date.parse(offer.endDate) || null,
      });
    }
    return out;
  }

  const send = (fn) => async (req, res) => {
    if (off()) return res.json({ items: [], off: true });
    try { res.set('Cache-Control', 'private, max-age=120'); res.json(await fn()); }
    catch (e) { res.status(502).json({ items: [], error: 'Não consegui buscar agora. Tente de novo em instantes.' }); }
  };
  app.get('/api/discover/news', auth, send(news));
  app.get('/api/discover/deals', auth, send(async () => {
    const [epic, steam] = await Promise.all([epicFree().catch(() => []), steamDeals().catch(() => [])]);
    const items = [...epic.sort((a, b) => (a.upcoming ? 1 : 0) - (b.upcoming ? 1 : 0)), ...steam.sort((a, b) => b.discount - a.discount)];
    if (!items.length && !(await Promise.allSettled([epicFree(), steamDeals()])).some(r => r.status === 'fulfilled')) throw new Error('sem fontes');
    return { items };
  }));
  app.get('/api/discover/upcoming', auth, send(async () => ({ items: await steamUpcoming() })));
}
