// Aviso de "clipe capturado" por cima de tudo (inclusive do jogo), só na tela de quem apertou o atalho.
// - não rouba o foco (showInactive + focusable:false): roubar o foco minimizaria um jogo em tela cheia
// - não recebe cliques (o mouse continua indo para o jogo)
// - fica FORA da captura de tela (setContentProtection -> WDA_EXCLUDEFROMCAPTURE no Windows 10 2004+): não aparece
//   na transmissão nem no próprio clipe
// - a página é só HTML/CSS (sem JavaScript); some sozinha
const { BrowserWindow, screen } = require('electron');

let win = null, timer = null;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html({ ok, title, sub }) {
  const c = ok ? '#23a55a' : '#f23f43', flash = ok ? 'rgba(255,255,255,.85)' : 'rgba(242,63,67,.7)';
  const ic = ok
    ? '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="#fff" d="M9 4 7.2 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4H9Zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="#fff" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1 5v7h2V7h-2Zm0 9v2h2v-2h-2Z"/></svg>';
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;user-select:none;font:14px "Segoe UI",system-ui,sans-serif}
.edge{position:fixed;inset:0;box-shadow:inset 0 0 0 6px ${flash},inset 0 0 90px 10px ${flash};opacity:0;animation:edge .9s ease-out forwards}
@keyframes edge{0%{opacity:0}12%{opacity:1}100%{opacity:0}}
.badge{position:fixed;top:28px;left:50%;display:flex;align-items:center;gap:12px;padding:10px 18px 10px 12px;border-radius:14px;background:rgba(17,18,20,.92);
  color:#f2f3f5;box-shadow:0 8px 28px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.08);transform:translate(-50%,-140%);opacity:0;
  animation:in .35s cubic-bezier(.2,1.4,.4,1) .05s forwards,out .35s ease-in 2.05s forwards}
.ic{width:40px;height:40px;border-radius:50%;background:${c};display:grid;place-items:center;flex:none;position:relative}
.ic:after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid ${c};opacity:0;animation:ring 1s ease-out .2s 2}
@keyframes ring{0%{opacity:.9;transform:scale(.8)}100%{opacity:0;transform:scale(1.6)}}
b{display:block;font-size:15px;font-weight:700}small{display:block;color:#b5bac1;font-size:12.5px;margin-top:1px}
@keyframes in{to{transform:translate(-50%,0);opacity:1}}@keyframes out{from{transform:translate(-50%,0);opacity:1}to{transform:translate(-50%,-140%);opacity:0}}
</style><div class="edge"></div><div class="badge"><div class="ic">${ic}</div><div><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`;
}

function hide() { clearTimeout(timer); timer = null; const w = win; win = null; if (w && !w.isDestroyed()) w.destroy(); }

// o: { ok: boolean, title: string, sub?: string }
function show(o = {}) {
  hide();
  // tela onde está o mouse = normalmente a do jogo
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), b = d.bounds;
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false,
    alwaysOnTop: true, show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false, backgroundThrottling: false },
  });
  const w = win;
  w.setAlwaysOnTop(true, 'screen-saver'); // por cima de jogos em janela sem borda e da barra de tarefas
  w.setVisibleOnAllWorkspaces(true);
  w.setIgnoreMouseEvents(true);
  w.setContentProtection(true); // fora da captura: não entra na transmissão nem no clipe
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.once('ready-to-show', () => { if (win === w && !w.isDestroyed()) w.showInactive(); });
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html(o))).catch(() => { });
  timer = setTimeout(hide, 2600);
}

module.exports = { show, hide, html };
