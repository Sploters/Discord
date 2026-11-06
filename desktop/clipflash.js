// Aviso de "clipe capturado" por cima de tudo (inclusive do jogo), só na tela de quem apertou o atalho.
// - não rouba o foco (showInactive + focusable:false): roubar o foco minimizaria um jogo em tela cheia
// - não recebe cliques (o mouse continua indo para o jogo)
// - fica FORA da captura de tela (setContentProtection -> WDA_EXCLUDEFROMCAPTURE no Windows 10 2004+): não aparece
//   na transmissão nem no próprio clipe
// - janela pequena no canto (não cobre a tela); a página é só HTML/CSS (sem JavaScript); some sozinha
const { BrowserWindow, screen } = require('electron');

let win = null, timer = null;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// discreto, como o Medal / ShadowPlay: uma pílula pequena no canto de cima à direita, sem piscar a tela
const W = 250, H = 56, M = 22; // tamanho da janela e distância da borda da tela
function html({ ok, title, sub }) {
  const c = ok ? '#23a55a' : '#f23f43';
  const ic = ok
    ? '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="#fff" d="M9 4 7.2 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4H9Zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="#fff" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3 1.4 1.4Z"/></svg>';
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;user-select:none;font:13px "Segoe UI",system-ui,sans-serif}
.t{position:absolute;top:6px;right:6px;display:flex;align-items:center;gap:9px;max-width:${W - 12}px;box-sizing:border-box;padding:7px 14px 7px 8px;border-radius:999px;
  background:rgba(17,18,20,.86);color:#f2f3f5;border:1px solid rgba(255,255,255,.08);box-shadow:0 4px 14px rgba(0,0,0,.35);
  opacity:0;transform:translateX(24px);animation:in .22s ease-out forwards,out .25s ease-in 1.75s forwards}
.ic{width:26px;height:26px;border-radius:50%;background:${c};display:grid;place-items:center;flex:none}
b{font-weight:600;white-space:nowrap}small{color:#b5bac1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes in{to{opacity:1;transform:none}}@keyframes out{from{opacity:1;transform:none}to{opacity:0;transform:translateX(24px)}}
</style><div class="t"><div class="ic">${ic}</div><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
}

function hide() { clearTimeout(timer); timer = null; const w = win; win = null; if (w && !w.isDestroyed()) w.destroy(); }

// o: { ok: boolean, title: string, sub?: string }
function show(o = {}) {
  hide();
  // tela onde está o mouse = normalmente a do jogo
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), b = d.workArea;
  win = new BrowserWindow({
    x: b.x + b.width - W - M, y: b.y + M, width: W, height: H, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
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
  timer = setTimeout(hide, 2200);
}

module.exports = { show, hide, html };
