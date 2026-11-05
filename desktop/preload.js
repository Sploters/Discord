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
  getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'), // relatório de problema (desde a 1.0.23)
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdate: (cb) => ipcRenderer.on('update-available', (_e, v) => cb(v)),
  saveServer: (url) => ipcRenderer.invoke('save-server', url),
  setThrottle: (on) => ipcRenderer.send('set-throttle', !!on),
  // controle remoto: só mouse e teclado, com o programa nativo; ver desktop/remote.js
  remoteCapable: () => ipcRenderer.invoke('remote-capable'),
  remoteStart: (o) => ipcRenderer.invoke('remote-start', o),
  remoteInput: (ev) => ipcRenderer.send('remote-input', ev),
  remoteStop: () => ipcRenderer.send('remote-stop'),
  onRemoteEvent: (cb) => ipcRenderer.on('remote-event', (_e, k) => cb(k)),
  // transmissão a 120 FPS: programa nativo (captura sem limite + placa de vídeo); ver desktop/native.js
  nativeCapable: () => ipcRenderer.invoke('native-capable'),
  nativeStart: (o) => ipcRenderer.invoke('native-start', o),
  nativeStop: () => ipcRenderer.send('native-stop'),
  onNativeEvent: (cb) => ipcRenderer.on('native-event', (_e, ev) => cb(ev)),
});
