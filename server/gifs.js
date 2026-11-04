// GIFs no chat: busca e "em alta" num serviço de GIFs (KLIPY, gratuito; ou GIPHY), favoritos por pessoa e os GIFs
// que já passaram pelos chats que a pessoa vê. O servidor só busca e repassa a lista: o GIF em si vem direto do serviço.
// Chave: KLIPY_API_KEY / GIPHY_API_KEY (variável de ambiente) ou o arquivo klipy.key / giphy.key na pasta de dados.
// Sem chave: o seletor mostra só Favoritos e "Do grupo".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const IMG = /^https?:\/\/[^\s"'<>]+\.(gif|webp)(\?[^\s"'<>]*)?$/i;
const PER = 24;

function readKey(dir, name, env) {
  if (process.env[env]) return process.env[env].trim();
  try { return fs.readFileSync(path.join(dir, name), 'utf8').trim() || null; } catch { return null; }
}

// procura variantes de imagem em qualquer formato de resposta: { url, width, height } com .gif/.webp
function variants(o, out = [], depth = 0) {
  if (!o || typeof o !== 'object' || depth > 6) return out;
  if (typeof o.url === 'string' && IMG.test(o.url)) out.push({ url: o.url, w: +o.width || 0, h: +o.height || 0 });
  for (const v of Object.values(o)) if (v && typeof v === 'object') variants(v, out, depth + 1);
  return out;
}
const pickVar = (file, sizes, kinds) => { for (const s of sizes) for (const k of kinds) { const v = file?.[s]?.[k]; if (v?.url && IMG.test(v.url)) return { url: v.url, w: +v.width || 0, h: +v.height || 0 }; } return null; };

const PROVIDERS = {
  klipy: {
    label: 'KLIPY',
    url: (key, kind, q, page, cust) => `${process.env.KLIPY_API_BASE || 'https://api.klipy.com'}/api/v1/${encodeURIComponent(key)}/gifs/${kind === 'search' ? 'search' : 'trending'}?` +
      new URLSearchParams({ ...(kind === 'search' ? { q } : {}), page: String(page), per_page: String(PER), customer_id: cust, locale: 'pt', content_filter: 'medium' }),
    items: (j) => { const d = j?.data?.data ?? j?.data ?? j?.results ?? []; return { list: Array.isArray(d) ? d : [], more: j?.data?.has_next ?? (Array.isArray(d) && d.length >= PER) }; },
    norm: (it) => {
      const f = it.file || it.files || it.media || {};
      const send = pickVar(f, ['md', 'hd', 'sm'], ['gif', 'webp']), prev = pickVar(f, ['sm', 'xs', 'md'], ['webp', 'gif']);
      const any = variants(it);
      const s = send || any.sort((a, b) => (b.w || 0) - (a.w || 0)).find(v => /\.gif/i.test(v.url)) || any[0], p = prev || any.sort((a, b) => (a.w || 999) - (b.w || 999))[0] || s;
      return s && { id: String(it.id ?? it.slug ?? s.url), url: s.url, preview: p.url, w: p.w || s.w, h: p.h || s.h, title: String(it.title || '').slice(0, 100) };
    },
  },
  giphy: {
    label: 'GIPHY',
    url: (key, kind, q, page) => `${process.env.GIPHY_API_BASE || 'https://api.giphy.com'}/v1/gifs/${kind === 'search' ? 'search' : 'trending'}?` +
      new URLSearchParams({ api_key: key, ...(kind === 'search' ? { q, lang: 'pt' } : {}), limit: String(PER), offset: String((page - 1) * PER), rating: 'pg-13' }),
    items: (j) => ({ list: Array.isArray(j?.data) ? j.data : [], more: (j?.pagination?.total_count ?? 0) > (j?.pagination?.offset ?? 0) + (j?.pagination?.count ?? 0) }),
    norm: (it) => {
      const im = it.images || {}, s = im.downsized_medium || im.fixed_height || im.original, p = im.fixed_width || im.fixed_width_small || s;
      return s?.url && IMG.test(s.url) && { id: String(it.id), url: s.url, preview: (p?.webp && IMG.test(p.webp) ? p.webp : p.url), w: +p.width || 0, h: +p.height || 0, title: String(it.title || '').slice(0, 100) };
    },
  },
};

export function mountGifs(app, d) {
  const { auth, wrap, bad, all, run, get, canSeeChannel, dataDir, clean } = d;
  const klipy = readKey(dataDir, 'klipy.key', 'KLIPY_API_KEY'), giphy = readKey(dataDir, 'giphy.key', 'GIPHY_API_KEY');
  const prov = klipy ? { ...PROVIDERS.klipy, key: klipy, name: 'klipy' } : giphy ? { ...PROVIDERS.giphy, key: giphy, name: 'giphy' } : null;
  if (prov) console.log(`  GIFs: ${prov.label}`);
  const cache = new Map(); // url -> { t, data }
  const hits = new Map(); // uid -> [tempos] (limite por pessoa)
  const limited = (uid) => { const now = Date.now(), a = (hits.get(uid) || []).filter(t => now - t < 60000); a.push(now); hits.set(uid, a); return a.length > 40; };

  async function fetchList(kind, q, page, uid) {
    const cust = crypto.createHash('sha256').update('lc:' + uid).digest('hex').slice(0, 24); // id anônimo por pessoa (pedido do serviço)
    const url = prov.url(prov.key, kind, q, page, cust), ck = kind + '|' + q + '|' + page;
    const c = cache.get(ck); if (c && Date.now() - c.t < 10 * 60000) return c.data;
    const r = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'chave do serviço de GIFs recusada' : 'serviço de GIFs respondeu ' + r.status);
    const { list, more } = prov.items(await r.json());
    const data = { gifs: list.map(it => { try { return prov.norm(it); } catch { return null; } }).filter(Boolean), more: !!more, page };
    cache.set(ck, { t: Date.now(), data }); if (cache.size > 300) cache.delete(cache.keys().next().value);
    return data;
  }
  const listRoute = (kind) => (req, res) => {
    if (!prov) return res.json({ gifs: [], more: false, page: 1, disabled: true });
    if (limited(req.uid)) return bad(res, 'Muitas buscas seguidas, espere um pouco', 429);
    const q = clean(req.query.q, 80) || '', page = Math.max(1, Math.min(50, +req.query.page || 1));
    if (kind === 'search' && !q.trim()) return res.json({ gifs: [], more: false, page });
    fetchList(kind, q.trim(), page, req.uid).then(x => res.json(x), e => bad(res, 'Não consegui buscar GIFs: ' + e.message, 502));
  };

  app.get('/api/gifs/meta', auth, (req, res) => res.json({ provider: prov?.name || null, label: prov?.label || null }));
  app.get('/api/gifs/trending', auth, listRoute('trending'));
  app.get('/api/gifs/search', auth, listRoute('search'));

  // favoritos (por pessoa, até 300)
  const favObj = (r) => ({ url: r.url, preview: r.preview, w: r.w, h: r.h, title: r.title });
  app.get('/api/gifs/favs', auth, wrap((req, res) => res.json({ gifs: all('SELECT * FROM gif_favs WHERE user_id=? ORDER BY created_at DESC LIMIT 300', req.uid).map(favObj) })));
  app.put('/api/gifs/favs', auth, wrap((req, res) => {
    const url = String(req.body.url || ''), preview = String(req.body.preview || url);
    if (!IMG.test(url) || url.length > 600 || !IMG.test(preview) || preview.length > 600) return bad(res, 'GIF inválido');
    if ((get('SELECT COUNT(*) n FROM gif_favs WHERE user_id=?', req.uid)?.n || 0) >= 300) return bad(res, 'Limite de 300 favoritos');
    run('INSERT INTO gif_favs(user_id,url,preview,w,h,title,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,url) DO NOTHING', req.uid, url, preview, Math.max(0, +req.body.w | 0), Math.max(0, +req.body.h | 0), clean(req.body.title, 100) || '', Date.now());
    res.json({ ok: true });
  }));
  app.delete('/api/gifs/favs', auth, wrap((req, res) => { run('DELETE FROM gif_favs WHERE user_id=? AND url=?', req.uid, String(req.body?.url || req.query.url || '')); res.json({ ok: true }); }));

  // "Do grupo": GIFs mandados sozinhos numa mensagem, nos canais e conversas que a pessoa vê (últimos 90 dias)
  app.get('/api/gifs/group', auth, wrap((req, res) => {
    const rows = all(`SELECT m.content, m.channel_id FROM messages m WHERE m.created_at > ? AND m.content LIKE 'http%' AND instr(trim(m.content), ' ') = 0
      AND (lower(m.content) LIKE '%.gif%' OR lower(m.content) LIKE '%.webp%') ORDER BY m.created_at DESC LIMIT 600`, Date.now() - 90 * 86400000);
    const seen = new Set(), ok = new Map(), out = [];
    for (const r of rows) {
      const url = r.content.trim(); if (!IMG.test(url) || seen.has(url)) continue;
      if (!ok.has(r.channel_id)) ok.set(r.channel_id, canSeeChannel(req.uid, get('SELECT * FROM channels WHERE id=?', r.channel_id)));
      if (!ok.get(r.channel_id)) continue;
      seen.add(url); out.push({ url, preview: url, w: 0, h: 0, title: '' });
      if (out.length >= 60) break;
    }
    res.json({ gifs: out });
  }));
}
