// Atualizações do app desktop entregues pelo próprio servidor: o repositório no GitHub pode ser privado.
// O servidor consulta a release mais nova com uma chave de acesso (somente leitura) e entrega o instalador aos apps.
// - Chave: variável GITHUB_TOKEN ou o arquivo <pasta de dados>/github-token.txt (no Umbrel: ~/resenha-data/github-token.txt).
//   Sem chave, funciona só se o repositório for público.
// - GET /api/desktop/update            -> { version, name, size, url } da release mais nova (ou {} se não houver)
// - GET /desktop/download/<instalador> -> o instalador (baixado do GitHub uma vez e guardado em <dados>/desktop)
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const SETUP = /^Resenha-Setup-[\d.]+\.exe$/i;

export function mountDesktopUpdate(app, dataDir) {
  const REPO = process.env.DESKTOP_REPO || 'Sploters/Resenha';
  const dir = path.join(dataDir, 'desktop');
  const token = () => {
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
    try { return fs.readFileSync(path.join(dataDir, 'github-token.txt'), 'utf8').trim(); } catch { return ''; }
  };
  // pedido ao GitHub (segue redirecionamentos; a chave só vai para api.github.com)
  const get = (url, accept, hops = 5) => new Promise((resolve, reject) => {
    const u = new URL(url), t = u.hostname === 'api.github.com' ? token() : '';
    const req = https.get(u, { headers: { 'User-Agent': 'Resenha', Accept: accept, ...(t ? { Authorization: `Bearer ${t}` } : {}) }, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) { res.resume(); resolve(get(new URL(res.headers.location, u).href, accept, hops - 1)); return; }
      resolve(res);
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
  });
  const json = async (url) => { const r = await get(url, 'application/vnd.github+json'); let b = ''; for await (const c of r) b += c; if (r.statusCode !== 200) throw new Error(`GitHub ${r.statusCode}`); return JSON.parse(b); };

  let cache = { at: 0, rel: null, err: '' };
  async function latest() {
    if (Date.now() - cache.at < 2 * 60e3) return cache.rel; // 2 min: versão recém-publicada aparece logo
    try {
      const j = await json(`https://api.github.com/repos/${REPO}/releases/latest`);
      const a = (j.assets || []).find(x => SETUP.test(x.name));
      cache = { at: Date.now(), rel: a ? { version: String(j.tag_name || '').replace(/^v/i, ''), id: a.id, name: a.name, size: a.size } : null, err: '' };
    } catch (e) {
      if (e.message !== cache.err) console.log(`  Atualização do app desktop: não consegui consultar o GitHub (${e.message})${token() ? '' : ' — sem chave: com o repositório privado, coloque github-token.txt na pasta de dados'}`);
      cache = { at: Date.now() - 60e3, rel: cache.rel, err: e.message }; // tenta de novo em 1 min
    }
    return cache.rel;
  }

  app.get('/api/desktop/update', async (req, res) => {
    const r = await latest().catch(() => null);
    res.set('Cache-Control', 'no-store');
    res.json(r ? { version: r.version, name: r.name, size: r.size, url: `/desktop/download/${encodeURIComponent(r.name)}` } : {});
  });

  const pending = new Map(); // nome -> Promise (vários apps pedindo ao mesmo tempo baixam do GitHub uma vez só)
  async function fetchInstaller(r) {
    const file = path.join(dir, r.name);
    try { if (fs.statSync(file).size === r.size) return file; } catch { }
    if (!pending.has(r.name)) pending.set(r.name, (async () => {
      fs.mkdirSync(dir, { recursive: true });
      const res = await get(`https://api.github.com/repos/${REPO}/releases/assets/${r.id}`, 'application/octet-stream');
      if (res.statusCode !== 200) { res.resume(); throw new Error(`GitHub ${res.statusCode}`); }
      const tmp = file + '.part';
      await new Promise((ok, no) => { const f = fs.createWriteStream(tmp); res.pipe(f); f.on('finish', ok); f.on('error', no); res.on('error', no); });
      fs.renameSync(tmp, file);
      for (const old of fs.readdirSync(dir)) if (old !== r.name && SETUP.test(old)) fs.unlink(path.join(dir, old), () => { }); // só o mais novo fica
      return file;
    })().finally(() => pending.delete(r.name)));
    return pending.get(r.name);
  }
  app.get('/desktop/download/:name', async (req, res) => {
    const r = await latest().catch(() => null);
    if (!r || req.params.name !== r.name) return res.sendStatus(404);
    try {
      const file = await fetchInstaller(r);
      res.set('Cache-Control', 'no-store'); res.download(file, r.name);
    } catch (e) { console.log('  Atualização do app desktop: falha ao baixar o instalador', e.message); if (!res.headersSent) res.sendStatus(502); }
  });
}
