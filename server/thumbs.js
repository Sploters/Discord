// Miniaturas de vídeos (clipes e vídeos enviados no chat): uma imagem pequena gerada uma vez pelo ffmpeg e guardada ao
// lado do vídeo (<arquivo>.thumb.jpg). O chat e a galeria mostram a miniatura; o vídeo só baixa quando alguém dá play.
// GET /thumbs/<24 hex>.(webm|mp4): gera na primeira vez (fila de 1 em 1, para não pesar o servidor) e depois serve do disco.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const VIDEO = /^[a-f0-9]{24}\.(webm|mp4)$/;

export function createThumbs(dir) {
  const UPLOAD_DIR = path.resolve(dir);
  const thumbOf = (f) => path.join(UPLOAD_DIR, f + '.thumb.jpg');
  const pending = new Map(); // arquivo -> Promise<boolean>
  let chain = Promise.resolve();
  const run = (args) => new Promise((res) => {
    let p; try { p = spawn(FFMPEG, args, { stdio: 'ignore' }); } catch { return res(false); }
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { } res(false); }, 20000);
    p.on('error', () => { clearTimeout(t); res(false); }); p.on('exit', (c) => { clearTimeout(t); res(c === 0); });
  });
  // quadro de ~1 s (o 1º costuma ser preto); vídeo curto demais: o primeiro quadro
  const make = (f) => {
    const src = path.join(UPLOAD_DIR, f), out = thumbOf(f), tmp = out + '.tmp.jpg';
    const args = (ss) => ['-hide_banner', '-loglevel', 'error', '-y', ...(ss ? ['-ss', ss] : []), '-i', src, '-frames:v', '1', '-vf', "scale='min(480,iw)':-2", '-q:v', '6', tmp];
    return run(args('1')).then(ok => (ok && fs.existsSync(tmp) && fs.statSync(tmp).size > 0 ? ok : run(args(null))))
      .then(ok => { if (ok && fs.existsSync(tmp)) { fs.renameSync(tmp, out); return true; } try { fs.unlinkSync(tmp); } catch { } return false; });
  };
  function ensure(f) {
    if (!VIDEO.test(f)) return Promise.resolve(false);
    if (fs.existsSync(thumbOf(f))) return Promise.resolve(true);
    if (!fs.existsSync(path.join(UPLOAD_DIR, f))) return Promise.resolve(false);
    if (!pending.has(f)) { const p = (chain = chain.then(() => make(f))).finally(() => pending.delete(f)); pending.set(f, p); }
    return pending.get(f);
  }
  function route(req, res) {
    const f = path.basename(String(req.params.f || ''));
    if (!VIDEO.test(f)) return res.sendStatus(404);
    ensure(f).then(ok => {
      if (!ok) return res.sendStatus(404);
      res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.type('image/jpeg'); res.sendFile(thumbOf(f));
    }, () => res.sendStatus(500));
  }
  // faixa da linha do tempo do editor de corte: até 10 quadros lado a lado (128x72 cada) numa imagem só.
  // Decodifica só os quadros-chave (-skip_frame nokey) e pega os de índice `idx` (os mais próximos de cada décimo do
  // clipe): poucos décimos de segundo mesmo num clipe de 60 s. GET /thumbs/<arquivo>/strip
  const stripOf = (f) => path.join(UPLOAD_DIR, f + '.strip.jpg');
  const stripPending = new Map();
  function ensureStrip(f, idx) {
    if (!VIDEO.test(f) || !idx.length) return Promise.resolve(false);
    if (fs.existsSync(stripOf(f))) return Promise.resolve(true);
    if (!fs.existsSync(path.join(UPLOAD_DIR, f))) return Promise.resolve(false);
    if (!stripPending.has(f)) {
      const out = stripOf(f), tmp = out + '.tmp.jpg', sel = idx.map(i => `eq(n\\,${i})`).join('+');
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-skip_frame', 'nokey', '-i', path.join(UPLOAD_DIR, f), '-an',
        '-vf', `select='${sel}',scale=128:72,tile=${idx.length}x1`, '-frames:v', '1', '-fps_mode', 'vfr', '-q:v', '5', tmp];
      const p = (chain = chain.then(() => run(args)).then(ok => { if (ok && fs.existsSync(tmp)) { fs.renameSync(tmp, out); return true; } try { fs.unlinkSync(tmp); } catch { } return false; }))
        .finally(() => stripPending.delete(f));
      stripPending.set(f, p);
    }
    return stripPending.get(f);
  }
  // keys: tempos (ms) dos quadros-chave do arquivo
  function stripRoute(req, res, keys) {
    const f = path.basename(String(req.params.f || ''));
    if (!VIDEO.test(f)) return res.sendStatus(404);
    const end = (keys.at(-1) || 0) + 1000, idx = [];
    for (let i = 0; i < 10 && keys.length; i++) {
      const want = end * (i + 0.5) / 10; let best = 0;
      keys.forEach((t, k) => { if (Math.abs(t - want) < Math.abs(keys[best] - want)) best = k; });
      if (idx.at(-1) !== best) idx.push(best);
    }
    ensureStrip(f, idx).then(ok => {
      if (!ok) return res.sendStatus(404);
      res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.type('image/jpeg'); res.sendFile(stripOf(f));
    }, () => res.sendStatus(500));
  }
  const remove = (f) => { fs.unlink(thumbOf(path.basename(f)), () => { }); fs.unlink(stripOf(path.basename(f)), () => { }); };
  return { route, ensure, remove, stripRoute };
}
