// Controle remoto no app desktop (processo principal): liga o programa nativo lc-input, diz a ele qual monitor
// está sendo transmitido e mostra um aviso sempre por cima de tudo enquanto alguém controla.
// O renderer (página do LocalCord) só chega aqui depois que o dono aceitou o pedido na própria tela.
const { BrowserWindow, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let helper = null, ready = false, armed = false, indicator = null, onEvent = () => { }, shared = null;
const log = (...a) => console.log('[remote]', ...a);

const helperPath = () => {
  const cands = [path.join(process.resourcesPath || '', 'lc-input.exe'), path.join(__dirname, 'native', 'lc-input.exe')];
  return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
};

// fonte escolhida para transmitir (vem do setDisplayMediaRequestHandler)
function setShared(src) { shared = src ? { id: src.id, display_id: src.display_id || '' } : null; }

// retângulo do monitor transmitido em pixels físicos; null se a transmissão é de uma janela
function sharedRect() {
  if (!shared || !shared.id.startsWith('screen:')) return null;
  const all = screen.getAllDisplays();
  const d = all.find(x => String(x.id) === String(shared.display_id)) || (all.length === 1 ? all[0] : null);
  if (!d) return null;
  const r = process.platform === 'win32' ? screen.dipToScreenRect(null, d.bounds) : d.bounds;
  return [r.x, r.y, r.width, r.height];
}

function capable() {
  if (process.platform !== 'win32') return { ok: false, reason: 'O controle remoto só funciona no app para Windows.' };
  if (!helperPath()) return { ok: false, reason: 'Componente de controle remoto não encontrado. Atualize o app.' };
  if (!sharedRect()) return { ok: false, reason: 'Transmita a tela inteira (não uma janela) para permitir controle remoto.' };
  return { ok: true };
}

function ensureHelper() {
  if (helper) return true;
  const exe = helperPath(); if (!exe) return false;
  helper = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let buf = '';
  helper.stdout.on('data', (d) => {
    buf += d.toString(); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.t === 'ready') ready = true;
      if (m.t === 'panic') { armed = false; closeIndicator(); onEvent('panic'); }
      if (m.t === 'err' && m.msg === 'blocked') onEvent('blocked');
      if (m.t === 'err' && m.msg !== 'blocked') log('helper:', m.msg);
    }
  });
  helper.on('exit', (code) => { log('helper saiu', code); const was = armed; helper = null; ready = false; armed = false; closeIndicator(); if (was) onEvent('panic'); });
  helper.stdin.on('error', () => { });
  return true;
}
const write = (o) => { try { helper?.stdin.write(JSON.stringify(o) + '\n'); } catch { } };

function showIndicator(who, perms) {
  closeIndicator();
  const d = screen.getAllDisplays().find(x => String(x.id) === String(shared?.display_id)) || screen.getPrimaryDisplay();
  const w = 560, h = 46, b = d.workArea || d.bounds;
  indicator = new BrowserWindow({
    width: w, height: h, x: Math.round(b.x + (b.width - w) / 2), y: b.y + 8, frame: false, resizable: false, movable: true, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, backgroundColor: '#1e1f22', hasShadow: true,
    webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
  });
  indicator.setAlwaysOnTop(true, 'screen-saver'); // por cima de janelas sem borda e da barra de tarefas
  indicator.setVisibleOnAllWorkspaces(true);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const what = perms.mouse && perms.keyboard ? 'mouse e teclado' : perms.mouse ? 'mouse' : 'teclado';
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#1e1f22;color:#f2f3f5;font:13px "Segoe UI",sans-serif;user-select:none;-webkit-app-region:drag}
    body{display:flex;align-items:center;gap:10px;padding:0 8px 0 12px;border:2px solid #f23f43;box-sizing:border-box;border-radius:8px}
    i{width:10px;height:10px;border-radius:50%;background:#f23f43;flex:none}b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}small{color:#b5bac1;white-space:nowrap}span{flex:1}
    a{-webkit-app-region:no-drag;background:#da373c;color:#fff;text-decoration:none;padding:6px 14px;border-radius:4px;font-weight:600}</style>
    <i></i><b>${esc(who)} está controlando seu ${what}</b><span></span><small>Ctrl+Alt+Shift+Q</small><a href="lc-stop:">Parar</a>`;
  // a página não roda JS: o botão é um link que o processo principal intercepta
  indicator.webContents.on('will-navigate', (e, url) => { e.preventDefault(); if (url.startsWith('lc-stop:')) { stop(); onEvent('panic'); } });
  indicator.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  indicator.on('closed', () => { indicator = null; if (armed) { stop(); onEvent('panic'); } }); // fechar o aviso = parar
  indicator.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  indicator.once('ready-to-show', () => indicator?.showInactive());
}
function closeIndicator() { const w = indicator; indicator = null; if (w && !w.isDestroyed()) w.destroy(); }

function start({ who, perms }) {
  const c = capable(); if (!c.ok) return c;
  if (!ensureHelper()) return { ok: false, reason: 'Não foi possível iniciar o componente de controle remoto.' };
  write({ t: 'arm', rect: sharedRect() }); armed = true;
  showIndicator(String(who || 'Alguém').slice(0, 40), { mouse: !!perms?.mouse, keyboard: !!perms?.keyboard });
  return { ok: true };
}
function input(ev) { if (armed && Array.isArray(ev) && ev.length <= 64) write({ t: 'ev', ev }); }
function stop() { if (armed) write({ t: 'disarm' }); armed = false; closeIndicator(); }
function shutdown() { stop(); try { helper?.stdin.end(); } catch { } }

module.exports = { setShared, capable, start, input, stop, shutdown, onRemoteEvent: (cb) => { onEvent = cb; } };
