const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lcDesktop', {
  isDesktop: true,
  getSources: () => ipcRenderer.invoke('get-sources'),
  selectSource: (id) => ipcRenderer.invoke('select-source', id),
  setBadge: (n) => ipcRenderer.send('set-badge', n),
  onHotkey: (cb) => ipcRenderer.on('hotkey', (_e, k) => cb(k)),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (p) => ipcRenderer.invoke('set-settings', p),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  relaunch: () => ipcRenderer.invoke('relaunch'),
  changeServer: () => ipcRenderer.invoke('change-server'),
  testServer: (input) => ipcRenderer.invoke('test-server', input),
  getUpdate: () => ipcRenderer.invoke('get-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdate: (cb) => ipcRenderer.on('update-available', (_e, v) => cb(v)),
  saveServer: (url) => ipcRenderer.invoke('save-server', url),
  setThrottle: (on) => ipcRenderer.send('set-throttle', !!on),
});
