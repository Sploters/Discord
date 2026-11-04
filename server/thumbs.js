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
  const remove = (f) => fs.unlink(thumbOf(path.basename(f)), () => { });
  return { route, ensure, remove };
}
