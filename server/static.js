// Entrega da interface (public/): comprimida (brotli/gzip, guardada em memória), com versão no endereço dos módulos e
// cache longo, e com a lista de módulos avisada na página (modulepreload) para o navegador baixar tudo em paralelo.
// - index.html: sem cache (sempre revalida); aponta para app.js?v=<versão> e os CSS ?v=<versão>.
// - módulos e CSS da raiz com ?v=<versão atual>: "immutable" por 1 ano. Os imports dentro deles também ganham ?v.
//   A versão é um hash de todos os arquivos: qualquer mudança (deploy) troca a versão e tudo é baixado de novo.
// - o resto (vendor, worklets, imagens): comprimido quando é texto/wasm, com ETag (revalida).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8' };
const COMPRESS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.wasm', '.txt', '.map', '.webmanifest']);
const IMPORT_RE = /(\bfrom\s*|\bimport\s*)(['"])\.\/([\w.-]+\.js)\2/g;

export function mountStatic(app, dir) {
  const root = path.resolve(dir);
  // versão: conteúdo de todos os .js/.css/.html da raiz de public
  const top = fs.readdirSync(root).filter(f => /\.(js|css|html)$/.test(f)).sort();
  const hash = crypto.createHash('sha1'); for (const f of top) hash.update(f).update(fs.readFileSync(path.join(root, f)));
  const V = hash.digest('hex').slice(0, 10);
  const mods = new Set(top.filter(f => f.endsWith('.js')));
  const rewrite = (src) => src.replace(IMPORT_RE, (m, kw, q, f) => (mods.has(f) ? `${kw}${q}./${f}?v=${V}${q}` : m));
  // módulos que o app.js puxa (direta ou indiretamente) — vão no modulepreload
  const graph = new Set(); const walk = (f) => { if (graph.has(f) || !mods.has(f)) return; graph.add(f); for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(IMPORT_RE)) walk(m[3]); };
  walk('app.js');
  const index = () => fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/(href|src)="\/([\w.-]+\.(?:js|css))"/g, (m, a, f) => `${a}="/${f}?v=${V}"`)
    .replace('</head>', [...graph].map(f => `<link rel="modulepreload" href="/${f}?v=${V}">`).join('\n') + '\n</head>');

  const cache = new Map(); // caminho -> { mtime, body, br, gz, etag, type }
  function entry(rel, file) {
    let st; try { st = fs.statSync(file); } catch { return null; }
    if (!st.isFile()) return null;
    const c = cache.get(rel); if (c && c.mtime === st.mtimeMs) return c;
    const ext = path.extname(file).toLowerCase();
    let body = fs.readFileSync(file);
    if (rel === 'index.html') body = Buffer.from(index());
    else if (mods.has(rel)) body = Buffer.from(rewrite(body.toString('utf8')));
    const e = { mtime: st.mtimeMs, body, type: TYPES[ext] || null, ext, etag: '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16) + '"' };
    cache.set(rel, e); return e;
  }
  const encoded = (e, enc) => {
    if (enc === 'br') return (e.br ||= zlib.brotliCompressSync(e.body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: e.body.length } }));
    return (e.gz ||= zlib.gzipSync(e.body, { level: 9 }));
  };
  function send(req, res, rel, longCache) {
    const e = entry(rel, path.join(root, rel)); if (!e) return false;
    if (e.type) res.setHeader('Content-Type', e.type);
    res.setHeader('Cache-Control', longCache ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.setHeader('ETag', e.etag); res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === e.etag) { res.statusCode = 304; res.end(); return true; }
    const ae = String(req.headers['accept-encoding'] || ''), enc = COMPRESS.has(e.ext) && e.body.length > 512 ? (/\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null) : null;
    const out = enc ? encoded(e, enc) : e.body;
    if (enc) res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', out.length);
    res.end(req.method === 'HEAD' ? undefined : out);
    return true;
  }
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (/^\/(api|files|gateway)(\/|$)/.test(req.path)) return next();
    let rel = decodeURIComponent(req.path).replace(/^\/+/, '');
    if (rel === '' || rel === 'index.html') return send(req, res, 'index.html', false) || next();
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return next();
    rel = path.relative(root, file).split(path.sep).join('/');
    if (!fs.existsSync(file)) { // rota da interface (ex.: /@me): a página
      if (!path.extname(rel)) return send(req, res, 'index.html', false) || next();
      return next();
    }
    const versioned = req.query.v === V && (mods.has(rel) || /^[\w.-]+\.css$/.test(rel));
    return send(req, res, rel, versioned) || next();
  });
  return V;
}
