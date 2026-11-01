const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, session, shell, globalShortcut, nativeImage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');

app.setAppUserModelId('br.local.localcord');
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
const defaults = { server: '', autoStart: false, startMinimized: false, closeToTray: true, globalHotkeys: true, hotkeyMute: 'CommandOrControl+Shift+M', hotkeyDeafen: 'CommandOrControl+Shift+D', hotkeyClip: 'CommandOrControl+Alt+C', hardwareAcceleration: true, bounds: { width: 1360, height: 860 } };
let cfg = { ...defaults };
try { cfg = { ...defaults, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; } catch { /* primeira execução */ }
const saveCfg = () => { try { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2)); } catch (e) { console.error(e); } };

// bug do Chromium no Windows: a janela deixa de repintar até trocar de programa
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,DirectCompositionVideoOverlays,DirectCompositionVideoOverlaySupport');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (cfg.hardwareAcceleration === false) app.disableHardwareAcceleration();
const log = (...a) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'main.log'), `${new Date().toISOString()} ${a.join(' ')}\n`); } catch { /* sem log */ } };
let win, tray, quitting = false, pickedSource = null, badge = 0;
const serverHost = () => { try { return new URL(cfg.server).hostname; } catch { return ''; } };
const trustedHosts = new Set();
const icon = () => nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));

// ---------- teste/normalização do endereço do servidor ----------
function probe(url) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch { return resolve(null); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get({ hostname: u.hostname, port: u.port || undefined, path: '/api/server-info', rejectUnauthorized: false, timeout: 4000 }, (res) => {
      let b = ''; res.on('data', d => (b += d)); res.on('end', () => { try { const j = JSON.parse(b); resolve(j.name ? { url: u.origin, name: j.name } : null); } catch { resolve(null); } });
    });
    req.on('error', (e) => { log('probe err', url, e.code, e.message); resolve(null); }); req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
async function resolveServer(input) {
  input = String(input || '').trim().replace(/\/+$/, '');
  if (!input) return null;
  const cands = /^https?:\/\//i.test(input) ? [input] : [`https://${input}:3443`, `https://${input}`, `http://${input}:3000`, `http://${input}`];
  if (/^[^/]+:\d+$/.test(input)) cands.splice(0, cands.length, `https://${input}`, `http://${input}`);
  for (const c of cands) { const r = await probe(c); log('probe', c, JSON.stringify(r)); if (r) return r; }
  return null;
}

// ---------- janela ----------
function showConnect(error) {
  if (!win) createWindow(true);
  win.loadFile(path.join(__dirname, 'connect.html'), { query: { current: cfg.server, error: error || '' } });
}
function loadServer() {
  if (!cfg.server) return showConnect();
  trustedHosts.add(serverHost());
  win.loadURL(cfg.server).catch(() => { });
}
function createWindow(forceShow) {
  win = new BrowserWindow({
    ...cfg.bounds, minWidth: 940, minHeight: 600, show: false, titleBarStyle: 'hidden', titleBarOverlay: { color: '#1e1f22', symbolColor: '#b5bac1', height: 28 }, backgroundColor: '#1e1f22', title: 'LocalCord', icon: icon(), autoHideMenuBar: true,
    webPreferences: { devTools: false, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.removeMenu(); Menu.setApplicationMenu(null);
  const CSS = 'html.lc-desk #app{margin-top:28px;height:calc(100vh - 28px)} html.lc-desk #settings{top:28px} html.lc-desk #settings .close{top:40px} body.lc-connect{padding-top:28px} #lc-titlebar{position:fixed;top:0;left:0;right:0;height:28px;z-index:2147483000;-webkit-app-region:drag;background:#1e1f22;display:flex;align-items:center;padding-left:12px;font:600 12px "Segoe UI",sans-serif;color:#b5bac1;user-select:none}#lc-upd{display:none;-webkit-app-region:no-drag;margin-left:auto;margin-right:150px;width:28px;height:20px;padding:0;border:0;border-radius:4px;background:#248046;color:#fff;cursor:pointer;align-items:center;justify-content:center}#lc-upd:hover{background:#1a6334}#lc-upd.on{display:flex}#lc-upd svg{width:14px;height:14px;fill:currentColor}';
  win.webContents.on('dom-ready', () => {
    win.webContents.insertCSS(CSS).catch(() => { });
    win.webContents.executeJavaScript("document.documentElement.classList.add('lc-desk');if(location.protocol==='file:')document.body.classList.add('lc-connect');if(!document.getElementById('lc-titlebar')){const t=document.createElement('div');t.id='lc-titlebar';t.textContent='LocalCord';document.documentElement.appendChild(t)}").catch(() => { });
    // ícone de download na barra do topo quando há versão nova
    win.webContents.executeJavaScript(`(()=>{const t=document.getElementById('lc-titlebar');if(!t||document.getElementById('lc-upd')||!window.lcDesktop)return;const b=document.createElement('button');b.id='lc-upd';b.innerHTML='<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2ZM19 9h-4V3H9v6H5l7 7 7-7Z"/></svg>';let busy=false;b.onclick=async()=>{if(busy)return;busy=true;b.style.opacity='.6';const ok=await lcDesktop.installUpdate();if(!ok){busy=false;b.style.opacity=''}};t.appendChild(b);const on=v=>{b.title='Atualizar para a versão '+v.version;b.classList.add('on')};lcDesktop.onUpdate(on);lcDesktop.getUpdate().then(v=>v&&on(v))})()`).catch(() => { });
  });
  // força o repaint depois de trocar de tela (evita artefatos que só somem ao trocar de janela)
  win.webContents.on('did-navigate-in-page', () => [0, 60, 300].forEach(t => setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.invalidate(); }, t)));
  win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());
  win.webContents.on('before-input-event', (e, i) => {
    const k = String(i.key).toLowerCase();
    if (k === 'alt' || k === 'f12' || k === 'f11' || (i.control && i.shift && ['i', 'j', 'c'].includes(k))) e.preventDefault();
  });
  win.once('ready-to-show', () => { if (!(process.argv.includes('--hidden') || cfg.startMinimized) || forceShow) win.show(); });
  win.on('close', (e) => {
    cfg.bounds = win.isMaximized() ? cfg.bounds : win.getBounds(); saveCfg();
    if (!quitting && cfg.closeToTray) { e.preventDefault(); win.hide(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(cfg.server) && !url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain && code !== -3 && !url.startsWith('file:')) showConnect(`Não foi possível carregar ${cfg.server} (${desc}).`); });
  win.on('page-title-updated', (e, t) => { win.setTitle(t); });
}
function showWin() { if (!win) return; win.show(); win.focus(); }

// ---------- bandeja / badge / atalhos ----------
function buildTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png')));
  tray.setToolTip('LocalCord');
  const send = (k) => win?.webContents.send('hotkey', k);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir LocalCord', click: showWin },
    { label: 'Silenciar / ativar microfone', click: () => send('mute') },
    { label: 'Ensurdecer / ativar áudio', click: () => send('deafen') },
    { type: 'separator' },
    { label: 'Trocar servidor…', click: () => { showWin(); showConnect(); } },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => (win?.isVisible() ? win.focus() : showWin()));
}
function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (!cfg.globalHotkeys) return;
  const send = (k) => win?.webContents.send('hotkey', k);
  const reg = (acc, k) => { try { if (acc && !globalShortcut.register(acc, () => send(k))) log('atalho em uso por outro app:', acc); } catch (e) { log('atalho inválido', acc, e.message); } };
  reg(cfg.hotkeyMute, 'mute'); reg(cfg.hotkeyDeafen, 'deafen'); reg(cfg.hotkeyClip, 'clip');
}
function setBadge(n) {
  badge = n | 0;
  tray?.setToolTip(badge ? `LocalCord — ${badge} não lida(s)` : 'LocalCord');
  if (process.platform === 'win32' && win) {
    if (!badge) return win.setOverlayIcon(null, '');
    // ponto vermelho 16x16 desenhado em memória (BGRA)
    const s = 16, buf = Buffer.alloc(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const d = (x - 7.5) ** 2 + (y - 7.5) ** 2, i = (y * s + x) * 4; if (d <= 49) { buf[i] = 67; buf[i + 1] = 63; buf[i + 2] = 242; buf[i + 3] = 255; } }
    win.setOverlayIcon(nativeImage.createFromBitmap(buf, { width: s, height: s }), `${badge} não lida(s)`);
  }
}

// ---------- sessão (certificado, permissões, captura de tela) ----------
function setupSession() {
  const ses = session.defaultSession;
  ses.setCertificateVerifyProc((req, cb) => cb(trustedHosts.has(req.hostname) ? 0 : -3));
  app.on('certificate-error', (e, _wc, url, _err, _cert, cb) => { try { if (trustedHosts.has(new URL(url).hostname)) { e.preventDefault(); return cb(true); } } catch { } cb(false); });
  const allowed = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'audioCapture', 'videoCapture']);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm)));
  ses.setPermissionCheckHandler((wc, perm) => allowed.has(perm));
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      // janela minimizada (jogo em tela cheia após alt+tab) não pode ser capturada: cai para a tela inteira, que mostra o jogo quando ele volta
      const s = sources.find(x => x.id === pickedSource) || sources.find(x => x.id.startsWith('screen:')) || sources[0];
      if (!s) return callback({});
      // áudio = loopback do sistema todo (o Windows não isola uma janela), tanto de tela quanto de janela; o renderer pede restrictOwnAudio para excluir o próprio LocalCord
      callback(request.audioRequested ? { video: s, audio: 'loopback' } : { video: s });
    } catch (e) { console.error(e); callback({}); }
  }, { useSystemPicker: false });
}

// ---------- IPC ----------
// janelas já vistas ficam na lista por alguns minutos: jogo em tela cheia some do Windows ao dar alt+tab (minimiza)
const seenWindows = new Map();
ipcMain.handle('get-sources', async () => {
  const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
  const now = Date.now(), out = [];
  for (const s of list) {
    if (s.name === 'LocalCord' || /NVIDIA GeForce Overlay/i.test(s.name)) continue; // o overlay da NVIDIA só aparece preto
    const type = s.id.startsWith('screen') ? 'screen' : 'window';
    const item = { id: s.id, name: s.name, type, thumbnail: s.thumbnail.toDataURL(), appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null };
    out.push(item);
    if (type === 'window') seenWindows.set(s.id, { item, at: now });
  }
  const live = new Set(out.map(o => o.id));
  for (const [id, v] of seenWindows) {
    if (now - v.at > 10 * 60 * 1000) seenWindows.delete(id);
    else if (!live.has(id)) out.push({ ...v.item, name: v.item.name + ' (minimizado)' });
  }
  return out;
});
ipcMain.handle('select-source', (_e, id) => { pickedSource = id; return true; });
ipcMain.on('set-badge', (_e, n) => setBadge(n));
ipcMain.handle('get-settings', () => ({ ...cfg, version: app.getVersion() }));
ipcMain.handle('set-settings', (_e, patch) => {
  for (const k of ['autoStart', 'startMinimized', 'closeToTray', 'globalHotkeys']) if (k in patch) cfg[k] = !!patch[k];
  for (const k of ['hotkeyMute', 'hotkeyDeafen', 'hotkeyClip']) if (typeof patch[k] === 'string') cfg[k] = patch[k];
  if ('hardwareAcceleration' in patch) cfg.hardwareAcceleration = !!patch.hardwareAcceleration;
  if ('hotkeyMute' in patch || 'hotkeyDeafen' in patch || 'hotkeyClip' in patch) registerHotkeys();
  if ('autoStart' in patch) app.setLoginItemSettings({ openAtLogin: cfg.autoStart, args: ['--hidden'] });
  if ('globalHotkeys' in patch) registerHotkeys();
  saveCfg(); return true;
});
ipcMain.handle('clear-cache', async () => { await session.defaultSession.clearCache(); return true; });
ipcMain.handle('relaunch', () => { app.relaunch(); quitting = true; app.exit(0); return true; });
ipcMain.handle('change-server', () => { showConnect(); return true; });
ipcMain.handle('test-server', async (_e, input) => { const r = await resolveServer(input); return r; });
ipcMain.handle('save-server', async (_e, url) => { cfg.server = url; saveCfg(); trustedHosts.add(serverHost()); loadServer(); return true; });

// ---------- atualização (GitHub Releases) ----------
const REPO = 'Sploters/Discord';
let update = null, updating = false;
const getJson = (url) => new Promise((resolve) => {
  https.get(url, { headers: { 'User-Agent': 'LocalCord', Accept: 'application/vnd.github+json' }, timeout: 8000 }, (res) => {
    let b = ''; res.on('data', d => (b += d)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function checkUpdate() {
  const rel = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  const ver = String(rel?.tag_name || '').replace(/^v/i, '');
  const asset = rel?.assets?.find(a => /^LocalCord-Setup-.*\.exe$/i.test(a.name));
  if (!ver || !asset || !newer(ver, app.getVersion())) return;
  update = { version: ver, url: asset.browser_download_url, name: asset.name };
  win?.webContents.send('update-available', { version: ver });
}
function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'LocalCord' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); return resolve(download(res.headers.location, dest, redirects - 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const f = fs.createWriteStream(dest); res.pipe(f); f.on('finish', () => f.close(resolve)); f.on('error', reject);
    }).on('error', reject);
  });
}
ipcMain.handle('get-update', () => update && { version: update.version });
ipcMain.handle('install-update', async () => {
  if (!update || updating) return false;
  updating = true;
  try {
    const file = path.join(app.getPath('temp'), update.name);
    await download(update.url, file);
    require('node:child_process').spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    quitting = true; app.quit(); return true;
  } catch (e) { log('update err', e.message); updating = false; return false; }
});

app.on('second-instance', () => showWin());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (quitting) app.quit(); });

app.whenReady().then(() => {
  setupSession(); createWindow(); buildTray(); registerHotkeys();
  if (cfg.server) trustedHosts.add(serverHost());
  loadServer();
  setTimeout(checkUpdate, 5000); setInterval(checkUpdate, 3600e3);
  if (process.env.LC_TEST_SERVER && !cfg.server) { cfg.server = process.env.LC_TEST_SERVER; trustedHosts.add(serverHost()); loadServer(); }
});
