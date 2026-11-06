const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lcDesktop', {
  isDesktop: true,
  getSources: () => ipcRenderer.invoke('get-sources'),
  selectSource: (id, name) => ipcRenderer.invoke('select-source', id, name),
  // áudio da transmissão só do jogo (loopback por processo do Windows; desde a 1.0.24): ver desktop/appaudio.js
  appAudioCapable: () => ipcRenderer.invoke('app-audio-capable'),
  appAudioStart: (o) => ipcRenderer.invoke('app-audio-start', o),
  appAudioStop: () => ipcRenderer.send('app-audio-stop'),
  detectGame: () => ipcRenderer.invoke('detect-game'), // { id, title } | null (desde a 1.0.24)
  onAppAudio: (() => { let cb = null; ipcRenderer.on('app-audio-data', (_e, b) => cb?.(b)); return (f) => { cb = f; }; })(),
  setBadge: (n) => ipcRenderer.send('set-badge', n),
  clipFlash: (o) => ipcRenderer.send('clip-flash', o), // aviso de clipe por cima do jogo (desde a 1.0.24)
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
  silentUpdate: true, // o app atualiza sem abrir o instalador (só reinicia); a página ajusta os textos
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
