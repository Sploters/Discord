// Transmissão a 120 FPS (processo principal): liga o programa nativo lc-stream, que captura a tela/janela sem o limite
// de ~48 fps do Chromium, comprime em H.264 na placa de vídeo e envia por SRTP direto ao servidor.
// O renderer pede a sessão ao servidor (chaves, porta) e passa para cá; o áudio e a prévia local continuam no Chromium.
const { screen, desktopCapturer } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

let proc = null, onEvent = () => { }, probed = null;
const log = (...a) => console.log('[native]', ...a);
const helperPath = () => {
  const cands = [path.join(process.resourcesPath || '', 'lc-stream.exe'), path.join(__dirname, 'native', 'lc-stream.exe')];
  return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
};

// Há codificador H.264 de hardware e captura WGC? (resultado guardado: o programa só lista, não captura nada)
function capable() {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, reason: 'Só no app para Windows.' });
  const exe = helperPath(); if (!exe) return Promise.resolve({ ok: false, reason: 'Componente de transmissão nativa não encontrado. Atualize o app.' });
  if (probed) return probed;
  probed = new Promise((res) => execFile(exe, ['--probe'], { windowsHide: true, timeout: 10000 }, (err, out) => {
    let j = null; try { j = JSON.parse(String(out).trim().split(/\r?\n/).pop()); } catch { }
    if (!j) { probed = null; return res({ ok: false, reason: 'Não consegui testar a placa de vídeo' + (err ? ': ' + err.message : '') }); }
    res(j.ok ? { ok: true, encoders: j.encoders } : { ok: false, reason: j.error || (j.wgc === false ? 'Este Windows não tem a captura de tela necessária (Windows 10 1903 ou mais novo).' : 'Nenhum codificador de vídeo de hardware (NVIDIA, AMD ou Intel) encontrado.') });
  }));
  return probed;
}

// id do desktopCapturer -> o que o programa entende: janela (HWND) ou um ponto dentro do monitor (pixels físicos)
async function sourceFor(id) {
  if (!id) return {};
  if (id.startsWith('window:')) { const hwnd = parseInt(id.split(':')[1], 10); return hwnd ? { window: hwnd } : {}; }
  if (id.startsWith('screen:')) {
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => []);
    const src = list.find(s => s.id === id), all = screen.getAllDisplays();
    const d = all.find(x => String(x.id) === String(src?.display_id)) || (all.length === 1 ? all[0] : null);
    if (!d) return {};
    const r = process.platform === 'win32' ? screen.dipToScreenRect(null, d.bounds) : d.bounds;
    return { monitor: [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] };
  }
  return {};
}

function stop() {
  const p = proc; if (!p) return;
  proc = null;
  try { p.stdin.write('stop\n'); p.stdin.end(); } catch { }
  setTimeout(() => { try { p.kill(); } catch { } }, 3000);
}

// o: { host, port, ssrc, pt, key, serverKey, fps, height, kbps, sourceId }. Resolve com o evento "started" ou "error".
async function start(o) {
  stop();
  const exe = helperPath(); if (!exe) return { ok: false, error: 'Componente de transmissão nativa não encontrado' };
  const cfg = { host: String(o.host), port: o.port | 0, ssrc: o.ssrc >>> 0, pt: o.pt | 0, key: String(o.key), serverKey: String(o.serverKey),
    fps: Math.max(1, Math.min(240, o.fps | 0)), height: Math.max(144, Math.min(2160, o.height | 0)), kbps: Math.max(500, Math.min(100000, o.kbps | 0)), ...(await sourceFor(o.sourceId)) };
  const p = spawn(exe, ['--stdin'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  proc = p;
  return new Promise((resolve) => {
    let done = false, buf = '';
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const t = setTimeout(() => { finish({ ok: false, error: 'O programa de transmissão não respondeu' }); if (proc === p) stop(); }, 15000);
    p.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.t === 'started') { clearTimeout(t); finish({ ok: true, ...ev }); }
        if (ev.t === 'error') { clearTimeout(t); finish({ ok: false, error: ev.error }); }
        if (proc === p || ev.t !== 'stats') onEvent(ev);
      }
    });
    p.stderr.on('data', (d) => log(String(d).trim()));
    p.on('error', (e) => { clearTimeout(t); finish({ ok: false, error: e.message }); });
    p.on('exit', (code) => { clearTimeout(t); finish({ ok: false, error: 'o programa fechou (código ' + code + ')' }); if (proc === p) { proc = null; onEvent({ t: 'exit', code }); } });
    p.stdin.write(JSON.stringify(cfg) + '\n');
  });
}

module.exports = { capable, start, stop, onNativeEvent: (cb) => { onEvent = cb; }, shutdown: stop };
