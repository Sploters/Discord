// Voz/vídeo/tela via WebRTC: pelo SFU do servidor (mediasoup) quando disponível; senão em malha (P2P).
// Sinalização pelo gateway.
// Microfone passa por uma cadeia WebAudio: high-pass → denoise (RNNoise/GTCRN) → noise gate → ganho.

import { playSound } from './sounds.js';

const NS = '/vendor/ns';
const loadedModules = new WeakMap();
let nsLib;

export const NOISE_MODES = {
  off: 'Nenhuma',
  standard: 'Padrão (navegador)',
  rnnoise: 'Alta — RNNoise (IA)',
  gtcrn: 'Máxima — GTCRN (IA, mais pesado)',
};
export const SCREEN_PRESETS = {
  res: { 720: '720p', 1080: '1080p', 1440: '1440p', source: 'Fonte (original)' },
  fps: { 15: '15 fps', 30: '30 fps', 60: '60 fps' },
};
const bitrateFor = (res, fps) => {
  const base = { 720: 2.5, 1080: 5, 1440: 9, source: 10 }[res] || 5;
  return Math.round(base * (fps >= 60 ? 1.6 : fps <= 15 ? .6 : 1) * 1e6);
};

async function ensureModule(ctx, name) {
  let set = loadedModules.get(ctx); if (!set) loadedModules.set(ctx, set = new Set());
  if (!set.has(name)) { await ctx.audioWorklet.addModule(`${NS}/${name}/workletProcessor.js`); set.add(name); }
}

// Cria o microfone processado. Retorna { raw, stream, analyser, dispose, setLoopback }
export async function createMic(prefs, ctx) {
  const mode = prefs.noiseMode || 'standard';
  const raw = await navigator.mediaDevices.getUserMedia({ audio: {
    deviceId: prefs.inputId ? { exact: prefs.inputId } : undefined,
    echoCancellation: prefs.echo !== false, noiseSuppression: mode === 'standard',
    autoGainControl: prefs.agc !== false, channelCount: 1, sampleRate: 48000 }, video: false });
  const nodes = [], gain = (prefs.inputVolume ?? 100) / 100;
  const out = { raw, nodes, error: null, processed: false };
  const src = ctx.createMediaStreamSource(raw); nodes.push(src);
  let last = src;
  const chain = (n) => { last.connect(n); nodes.push(n); last = n; };
  try {
    if (mode === 'rnnoise' || mode === 'gtcrn') {
      nsLib ||= await import(`${NS}/index.js`);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80; chain(hp);
      await ensureModule(ctx, mode);
      if (mode === 'rnnoise') {
        const wasmBinary = await nsLib.loadRnnoise({ url: `${NS}/rnnoise.wasm`, simdUrl: `${NS}/rnnoise_simd.wasm` });
        chain(new nsLib.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary }));
      } else {
        const wasmBinary = await nsLib.loadGtcrn({ url: `${NS}/gtcrn.wasm` });
        chain(new nsLib.GtcrnWorkletNode(ctx, { maxChannels: 1, wasmBinary }));
      }
      out.processed = true;
    }
    if (prefs.gate) {
      nsLib ||= await import(`${NS}/index.js`);
      await ensureModule(ctx, 'noiseGate');
      chain(new nsLib.NoiseGateWorkletNode(ctx, { openThreshold: prefs.gateDb ?? -45, closeThreshold: (prefs.gateDb ?? -45) - 6, holdMs: 250, maxChannels: 1 }));
      out.processed = true;
    }
  } catch (e) { // se a IA falhar, segue sem ela (usa o que já está na cadeia)
    console.warn('denoise', e); out.error = `Redução de ruído indisponível: ${e.message || e}`;
  }
  const g = ctx.createGain(); g.gain.value = gain; chain(g);
  const analyser = ctx.createAnalyser(); analyser.fftSize = 512; g.connect(analyser); nodes.push(analyser);
  const dest = ctx.createMediaStreamDestination(); g.connect(dest); nodes.push(dest);
  out.stream = dest.stream; out.analyser = analyser; out.gain = g;
  out.setLoopback = (on) => { try { on ? g.connect(ctx.destination) : g.disconnect(ctx.destination); } catch { } };
  out.dispose = () => {
    out.setLoopback(false);
    for (const n of nodes) { try { n.port?.postMessage('destroy'); } catch { } try { n.disconnect(); } catch { } }
    raw.getTracks().forEach(t => t.stop()); out.stream.getTracks().forEach(t => t.stop());
  };
  return out;
}
export const newAudioContext = () => new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000, latencyHint: 'interactive' });

export class Voice {
  constructor({ send, ice, myId, onUpdate, prefs }) {
    this.send = send; this.ice = ice; this.myId = myId; this.onUpdate = onUpdate; this.prefs = prefs;
    this.channelId = null; this.peers = new Map(); this.micGraph = null; this.mic = null; this.cam = null; this.screen = null;
    this.muted = false; this.deafened = false; this.ptt = false; this.speaking = new Set(); this.volumes = {}; this.streamVolumes = {};
    this.ctx = null; this.analysers = new Map(); this.timer = null; this.screenOpts = null;
  }
  get active() { return !!this.channelId; }
  getCtx() { this.ctx ||= newAudioContext(); this.ctx.resume?.(); return this.ctx; }

  async buildMic() {
    this.micGraph?.dispose(); this.analysers.get(this.myId)?.src.disconnect(); this.analysers.delete(this.myId);
    const g = await createMic(this.prefs, this.getCtx());
    this.micGraph = g; this.mic = g.stream;
    this.error = g.error;
    this.analysers.set(this.myId, { src: { disconnect() { } }, an: g.analyser, buf: new Uint8Array(g.analyser.fftSize), level: 0 });
    this.applyMute();
  }
  // Troca a cadeia de áudio (ex.: mudou o modo de ruído) sem reconectar
  async rebuildMic() {
    if (!this.channelId) return;
    try {
      const old = this.micGraph; await this.buildMic();
      const track = this.mic.getAudioTracks()[0];
      if (this.sfu) await this.sfuProduce('mic', track);
      else for (const p of this.peers.values()) { const s = p.senders.micaudio; if (s) await s.replaceTrack(track); else p.senders.micaudio = p.pc.addTrack(track, this.mic); }
      void old;
    } catch (e) { this.error = e.message; }
    this.onUpdate();
  }

  async join(channelId) {
    if (this.channelId === channelId) return;
    if (this.channelId) this.leave();
    this.error = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microfone indisponível: abra o app via HTTPS ou use o aplicativo desktop.');
      await this.buildMic();
    } catch (e) { this.mic = null; this.error = e.message || 'Não foi possível acessar o microfone (entrando como ouvinte).'; }
    this.channelId = channelId;
    this.timer = setInterval(() => this.poll(), 100);
    this.send('VOICE_JOIN', { channel_id: channelId });
    this.sendState(); this.onUpdate(); playSound('selfJoin');
  }
  leave() {
    if (!this.channelId) return;
    playSound('selfLeave');
    this.send('VOICE_LEAVE', {});
    this.sfuClose();
    for (const uid of [...this.peers.keys()]) this.drop(uid);
    this.micGraph?.dispose(); this.micGraph = null;
    for (const s of [this.cam, this.screen]) s?.getTracks().forEach(t => t.stop());
    this.mic = this.cam = this.screen = null; this.channelId = null; this.speaking.clear();
    for (const a of this.analysers.values()) a.src.disconnect(); this.analysers.clear();
    clearInterval(this.timer); this.onUpdate();
  }
  onJoined({ channel_id, peers, sfu }) {
    if (channel_id !== this.channelId) return;
    if (sfu) this.sfuStart(sfu).catch(e => { console.warn('sfu', e); this.error = 'Falha ao conectar a voz: ' + (e.message || e); this.onUpdate(); });
    else for (const uid of peers) this.connect(uid, true);
  }
  onPeerLeft({ user_id }) { this.drop(user_id); this.onUpdate(); }

  // ---------- SFU (mediasoup): um envio ao servidor, que repassa a todos ----------
  sfuReq(op, d = {}) {
    const rid = (this.rid = (this.rid || 0) + 1);
    return new Promise((resolve, reject) => {
      (this.pending ||= new Map()).set(rid, { resolve, reject });
      this.send('SFU', { ...d, rid, op });
      setTimeout(() => { if (this.pending.delete(rid)) reject(new Error('sem resposta do servidor (' + op + ')')); }, 15000);
    });
  }
  onSfuRes({ rid, data, error }) {
    const p = this.pending?.get(rid); if (!p) return;
    this.pending.delete(rid); error ? p.reject(new Error(error)) : p.resolve(data);
  }
  async sfuStart({ rtpCapabilities }) {
    const { Device } = await import('/vendor/msc/mediasoup-client.js');
    const cid = this.channelId, device = new Device();
    await device.load({ routerRtpCapabilities: rtpCapabilities });
    const sfu = { cid, device, producers: {}, consumers: new Map(), seen: new Set(), ready: false };
    this.sfu = sfu;
    const transport = async (dir) => {
      const info = await this.sfuReq('transport', { dir });
      const t = device[dir === 'send' ? 'createSendTransport' : 'createRecvTransport']({ ...info, iceServers: this.ice });
      t.on('connect', ({ dtlsParameters }, ok, fail) => this.sfuReq('connect', { transport_id: t.id, dtlsParameters }).then(ok, fail));
      t.on('connectionstatechange', (s) => { if (s === 'failed') t.restartIce?.(); this.onUpdate(true); });
      if (dir === 'send') t.on('produce', ({ kind, rtpParameters, appData }, ok, fail) =>
        this.sfuReq('produce', { transport_id: t.id, kind, rtpParameters, source: appData.source }).then(ok, fail));
      return t;
    };
    sfu.send = await transport('send'); sfu.recv = await transport('recv');
    if (this.sfu !== sfu) return;
    const { producers } = await this.sfuReq('producers');
    if (this.sfu !== sfu) return;
    sfu.ready = true;
    for (const p of producers) this.onSfuProducer(p);
    // o que já estava ligado antes de conectar
    if (this.mic) await this.sfuProduce('mic', this.mic.getAudioTracks()[0]);
    if (this.cam) await this.sfuProduce('cam', this.cam.getVideoTracks()[0]);
    if (this.screen) await this.sfuPublishScreen();
    this.onUpdate();
  }
  sfuClose() {
    const s = this.sfu; if (!s) return;
    this.sfu = null;
    s.send?.close(); s.recv?.close();
    for (const p of this.pending?.values() || []) p.reject(new Error('saiu da sala'));
    this.pending?.clear();
  }
  sfuEncodings(source) {
    const o = this.screenOpts || {};
    if (source === 'mic') return [{ maxBitrate: (this.prefs.voiceBitrate || 64) * 1000, priority: 'high', networkPriority: 'high' }];
    if (source === 'cam') return [ // simulcast: o servidor escolhe a camada que cabe na banda de cada um
      { rid: 'r0', scaleResolutionDownBy: 4, maxBitrate: 150_000 },
      { rid: 'r1', scaleResolutionDownBy: 2, maxBitrate: 500_000 },
      { rid: 'r2', scaleResolutionDownBy: 1, maxBitrate: 2_000_000 }];
    if (source === 'screen') {
      const top = bitrateFor(o.res || 1080, o.fps || 30);
      // fps vem da restrição da trilha (prioridade/fps por camada não são aceitos pelo Chromium no simulcast)
      return [{ rid: 'r0', scaleResolutionDownBy: 2, maxBitrate: Math.round(top / 4) },
        { rid: 'r1', scaleResolutionDownBy: 1, maxBitrate: top }];
    }
    return undefined;
  }
  async sfuProduce(source, track) {
    const s = this.sfu; if (!s?.ready || !track) return;
    const cur = s.producers[source];
    if (cur && !cur.closed) return cur.replaceTrack({ track });
    const opts = { track, appData: { source }, encodings: this.sfuEncodings(source), stopTracks: false };
    if (source === 'mic') opts.codecOptions = { opusStereo: false, opusDtx: true, opusFec: true, opusMaxAverageBitrate: (this.prefs.voiceBitrate || 64) * 1000 };
    if (source === 'screenaudio') opts.codecOptions = { opusStereo: true, opusFec: true, opusMaxAverageBitrate: 128000 };
    if (source === 'screen') opts.codecOptions = { videoGoogleStartBitrate: 1000 };
    const p = await s.send.produce(opts);
    if (this.sfu !== s) return p.close();
    s.producers[source] = p;
    if (source === 'screen') this.sfuTuneScreen();
  }
  async sfuPublishScreen() {
    const vt = this.screen?.getVideoTracks()[0], at = this.screen?.getAudioTracks()[0];
    if (vt) await this.sfuProduce('screen', vt);
    if (at) await this.sfuProduce('screenaudio', at);
  }
  sfuStop(source) {
    const s = this.sfu, p = s?.producers[source]; if (!p) return;
    p.close(); delete s.producers[source];
    this.sfuReq('close_producer', { source }).catch(() => { });
  }
  async sfuTuneScreen() {
    const p = this.sfu?.producers.screen; if (!p?.rtpSender) return;
    try {
      const prm = p.rtpSender.getParameters(), enc = this.sfuEncodings('screen');
      prm.encodings.forEach((e, i) => Object.assign(e, enc[i] || {}));
      prm.degradationPreference = this.screenOpts?.hint === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
      await p.rtpSender.setParameters(prm);
    } catch (e) { console.warn('screen params', e); }
  }
  ensurePeer(uid) {
    let p = this.peers.get(uid);
    if (!p) this.peers.set(uid, p = { uid, streams: {}, meta: {}, audioEl: null, screenAudioEl: null, senders: {}, consumers: new Map() });
    return p;
  }
  async onSfuProducer({ producer_id, user_id, source, channel_id }) {
    const s = this.sfu;
    if (!s?.ready || channel_id && channel_id !== s.cid || s.seen.has(producer_id) || user_id === this.myId) return;
    s.seen.add(producer_id);
    try {
      const r = await this.sfuReq('consume', { transport_id: s.recv.id, producer_id, rtpCapabilities: s.device.rtpCapabilities });
      const c = await s.recv.consume({ id: r.id, producerId: r.producer_id, kind: r.kind, rtpParameters: r.rtpParameters });
      if (this.sfu !== s) return c.close();
      const p = this.ensurePeer(user_id), stream = new MediaStream([c.track]);
      s.consumers.set(c.id, { c, uid: user_id, source });
      p.consumers.set(c.id, source);
      if (source === 'mic') this.attachAudio(p, stream, 'mic');
      else if (source === 'screenaudio') this.attachAudio(p, stream, 'screen');
      else { p.streams[source] = stream; c.track.onmute = c.track.onunmute = () => this.onUpdate(); }
      await this.sfuReq('resume', { consumer_id: c.id });
      this.onUpdate();
    } catch (e) { console.warn('consume', e); s.seen.delete(producer_id); }
  }
  onSfuConsumerClosed({ consumer_id }) {
    const e = this.sfu?.consumers.get(consumer_id); if (!e) return;
    this.sfu.consumers.delete(consumer_id); e.c.close();
    const p = this.peers.get(e.uid); if (!p) return;
    p.consumers.delete(consumer_id);
    if (e.source === 'mic') { p.audioEl?.remove(); p.audioEl = null; this.analysers.get(e.uid)?.src.disconnect(); this.analysers.delete(e.uid); this.speaking.delete(e.uid); }
    else if (e.source === 'screenaudio') { p.screenAudioEl?.remove(); p.screenAudioEl = null; }
    else delete p.streams[e.source];
    this.onUpdate();
  }

  connect(uid, initiator) {
    if (this.peers.has(uid)) return this.peers.get(uid);
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const p = { uid, pc, polite: this.myId > uid, making: false, ignore: false, streams: {}, meta: {}, audioEl: null, screenAudioEl: null, senders: {} };
    this.peers.set(uid, p);
    pc.onicecandidate = (e) => e.candidate && this.send('VOICE_SIGNAL', { to: uid, data: { cand: e.candidate } });
    pc.onnegotiationneeded = async () => {
      try { p.making = true; await pc.setLocalDescription(); this.send('VOICE_SIGNAL', { to: uid, data: { desc: pc.localDescription } }); }
      catch (e) { console.warn('negotiation', e); } finally { p.making = false; }
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (e.track.kind === 'audio') this.attachAudio(p, stream, p.meta[stream.id] === 'screen' ? 'screen' : 'mic');
      else {
        const kind = p.meta[stream.id] || 'cam';
        p.streams[kind] = stream;
        e.track.onmute = e.track.onunmute = e.track.onended = () => this.onUpdate();
        stream.onremovetrack = () => { if (!stream.getTracks().length) delete p.streams[kind]; this.onUpdate(); };
      }
      this.onUpdate();
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce?.(); this.onUpdate(true); };
    this.addLocalTracks(p);
    this.sendMeta(uid);
    return p;
  }
  addLocalTracks(p) {
    const add = (stream, kind) => stream?.getTracks().forEach(t => { p.senders[kind + t.kind] = p.pc.addTrack(t, stream); });
    add(this.mic, 'mic'); add(this.cam, 'cam'); add(this.screen, 'screen'); this.tuneAudio(p);
    // sem microfone (ouvinte): garante uma linha de áudio só-recepção para a negociação acontecer e a pessoa ouvir os outros
    if (!this.mic && !p.pc.getTransceivers().length) p.pc.addTransceiver('audio', { direction: 'recvonly' });
    if (this.screen) this.tuneSender(p, 'screenvideo', 'screen'); if (this.cam) this.tuneSender(p, 'camvideo', 'cam');
  }
  tuneAudio(p) { // taxa de bits da voz (kbps) e prioridade
    const s = this.sfu ? this.sfu.producers.mic?.rtpSender : p.senders.micaudio; if (!s) return;
    setTimeout(async () => { try { const prm = s.getParameters(); if (!prm.encodings?.length) prm.encodings = [{}]; prm.encodings[0].maxBitrate = (this.prefs.voiceBitrate || 64) * 1000; prm.encodings[0].priority = 'high'; await s.setParameters(prm); } catch { } }, 800);
  }
  sendMeta(uid) {
    const streams = {};
    if (this.cam) streams[this.cam.id] = 'cam';
    if (this.screen) streams[this.screen.id] = 'screen';
    this.send('VOICE_SIGNAL', { to: uid, data: { meta: streams } });
  }
  // limita/ajusta bitrate e fps do vídeo enviado
  tuneSender(p, key, kind) {
    const apply = async () => {
      const s = p.senders[key]; if (!s) return;
      try {
        const prm = s.getParameters(); if (!prm.encodings?.length) prm.encodings = [{}];
        const o = this.screenOpts || {};
        if (kind === 'screen') {
          prm.encodings[0].maxBitrate = bitrateFor(o.res || 1080, o.fps || 30); prm.encodings[0].maxFramerate = +o.fps || 30;
          prm.degradationPreference = o.hint === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
        } else prm.encodings[0].maxBitrate = 2_000_000;
        prm.encodings[0].networkPriority = 'high';
        await s.setParameters(prm);
      } catch (e) { /* ainda negociando */ }
    };
    [300, 1500, 4000].forEach(ms => setTimeout(apply, ms));
  }
  async onSignal({ from, data }) {
    if (!this.channelId || this.sfu) return;
    const p = this.connect(from, false), pc = p.pc;
    try {
      if (data.meta) {
        Object.assign(p.meta, data.meta);
        for (const [id, kind] of Object.entries(data.meta)) for (const [k, s] of Object.entries(p.streams)) if (s.id === id && k !== kind) { p.streams[kind] = s; delete p.streams[k]; }
        this.onUpdate();
      } else if (data.desc) {
        const collision = data.desc.type === 'offer' && (p.making || pc.signalingState !== 'stable');
        p.ignore = !p.polite && collision;
        if (p.ignore) return;
        await pc.setRemoteDescription(data.desc);
        if (data.desc.type === 'offer') { await pc.setLocalDescription(); this.send('VOICE_SIGNAL', { to: from, data: { desc: pc.localDescription } }); }
      } else if (data.cand) {
        try { await pc.addIceCandidate(data.cand); } catch (e) { if (!p.ignore) throw e; }
      }
    } catch (e) { console.warn('signal', e); }
  }
  drop(uid) {
    const p = this.peers.get(uid); if (!p) return;
    p.pc?.close(); p.audioEl?.remove(); p.screenAudioEl?.remove();
    for (const id of p.consumers?.keys() || []) { this.sfu?.consumers.get(id)?.c.close(); this.sfu?.consumers.delete(id); }
    this.analysers.get(uid)?.src.disconnect(); this.analysers.delete(uid); this.speaking.delete(uid);
    this.peers.delete(uid);
  }

  attachAudio(p, stream, kind) {
    const key = kind === 'screen' ? 'screenAudioEl' : 'audioEl';
    p[key]?.remove();
    const a = document.createElement('audio'); a.autoplay = true; a.srcObject = stream; a.style.display = 'none';
    if (this.prefs.outputId && a.setSinkId) a.setSinkId(this.prefs.outputId).catch(() => { });
    document.body.append(a); p[key] = a; this.applyVolume(p.uid); a.play?.().catch(() => { });
    if (kind === 'mic') this.watch(p.uid, stream);
  }
  applyVolume(uid) {
    const p = this.peers.get(uid); if (!p) return;
    const master = (this.prefs.volume ?? 100) / 100;
    if (p.audioEl) { p.audioEl.volume = Math.min(1, (this.volumes[uid] ?? 100) / 100 * master); p.audioEl.muted = this.deafened; }
    if (p.screenAudioEl) { p.screenAudioEl.volume = Math.min(1, (this.streamVolumes[uid] ?? 100) / 100 * master); p.screenAudioEl.muted = this.deafened; }
  }
  setVolume(uid, v) { this.volumes[uid] = v; this.applyVolume(uid); }
  setStreamVolume(uid, v) { this.streamVolumes[uid] = v; this.applyVolume(uid); }
  watch(uid, stream) {
    try {
      const ctx = this.getCtx(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 512; src.connect(an); this.analysers.set(uid, { src, an, buf: new Uint8Array(an.fftSize), level: 0 });
    } catch { }
  }
  poll() {
    let changed = false;
    for (const [uid, a] of this.analysers) {
      a.an.getByteTimeDomainData(a.buf);
      let peak = 0; for (const v of a.buf) peak = Math.max(peak, Math.abs(v - 128));
      a.level = peak / 128;
      const mine = uid === this.myId;
      const on = a.level > (mine ? .03 : .04) && !(mine && (this.muted || this.deafened || !this.micEnabled()));
      if (on !== this.speaking.has(uid)) { on ? this.speaking.add(uid) : this.speaking.delete(uid); changed = true; }
    }
    if (changed) this.onUpdate(true);
    this.onLevel?.(this.analysers.get(this.myId)?.level || 0);
  }

  micEnabled() { return this.prefs.inputMode !== 'ptt' || this.ptt; }
  applyMute() { this.mic?.getAudioTracks().forEach(t => (t.enabled = !this.muted && !this.deafened && this.micEnabled())); }
  setPtt(down) { if (this.ptt === down) return; this.ptt = down; this.applyMute(); this.onUpdate(true); }
  toggleMute() { const wasDeaf = this.deafened; this.muted = !this.muted; if (!this.muted && this.deafened) this.deafened = false; playSound(wasDeaf && !this.deafened ? 'undeafen' : this.muted ? 'mute' : 'unmute'); this.afterAudioChange(); }
  toggleDeaf() { this.deafened = !this.deafened; this.muted = this.deafened; playSound(this.deafened ? 'deafen' : 'undeafen'); this.afterAudioChange(); }
  afterAudioChange() { this.applyMute(); for (const uid of this.peers.keys()) this.applyVolume(uid); this.sendState(); this.onUpdate(); }
  sendState() { if (!this.channelId) return; this.send('VOICE_STATE', { mute: this.muted || this.deafened, deaf: this.deafened, video: !!this.cam, screen: !!this.screen }); }

  async toggleCam() {
    if (this.cam) return this.stopLocal('cam');
    try {
      this.cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: this.prefs.videoId ? { exact: this.prefs.videoId } : undefined, height: { ideal: +(this.prefs.camRes || 720) }, width: { ideal: Math.round(+(this.prefs.camRes || 720) * 16 / 9) }, frameRate: { ideal: +(this.prefs.camFps || 30) } } });
    } catch (e) { throw new Error('Não foi possível acessar a câmera: ' + (e.message || e.name)); }
    this.publish('cam', this.cam); playSound('camOn');
  }
  // opts: { res: 720|1080|1440|'source', fps: 15|30|60, audio: bool, hint: 'motion'|'detail' }
  async toggleScreen(opts) {
    if (this.screen) return this.stopLocal('screen');
    opts = { res: 1080, fps: 30, audio: true, hint: 'motion', ...opts };
    const video = { frameRate: { ideal: +opts.fps, max: +opts.fps } };
    if (opts.res !== 'source') { video.height = { ideal: +opts.res, max: +opts.res }; video.width = { ideal: Math.round(+opts.res * 16 / 9) }; }
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('indisponível (use HTTPS ou o app desktop)');
      this.screen = await navigator.mediaDevices.getDisplayMedia({ video, audio: opts.audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false, systemAudio: 'include', selfBrowserSurface: 'exclude' });
    } catch (e) { if (e.name === 'NotAllowedError' || e.name === 'AbortError') return; throw new Error('Não foi possível compartilhar a tela: ' + (e.message || e.name)); }
    const vt = this.screen.getVideoTracks()[0];
    vt.contentHint = opts.hint; vt.onended = () => this.stopLocal('screen');
    this.screenOpts = opts;
    this.publish('screen', this.screen); playSound('selfStreamStart');
  }
  // muda resolução/fps/otimização da transmissão em andamento
  async changeScreenQuality(opts) {
    const vt = this.screen?.getVideoTracks()[0]; if (!vt) return;
    const o = this.screenOpts = { ...this.screenOpts, ...opts };
    const c = { frameRate: { ideal: +o.fps, max: +o.fps } };
    if (o.res !== 'source') { c.height = { ideal: +o.res, max: +o.res }; c.width = { ideal: Math.round(+o.res * 16 / 9) }; }
    try { await vt.applyConstraints(c); } catch (e) { console.warn('applyConstraints', e); }
    vt.contentHint = o.hint;
    if (this.sfu) this.sfuTuneScreen();
    else for (const p of this.peers.values()) this.tuneSender(p, 'screenvideo', 'screen');
    this.onUpdate();
  }
  publish(kind, stream) {
    if (this.sfu) {
      (kind === 'screen' ? this.sfuPublishScreen() : this.sfuProduce(kind, stream.getVideoTracks()[0])).catch(e => { console.warn('produce', e); this.error = e.message; this.onUpdate(); });
    } else for (const p of this.peers.values()) {
      this.sendMeta(p.uid);
      stream.getTracks().forEach(t => { p.senders[kind + t.kind] = p.pc.addTrack(t, stream); });
      this.tuneSender(p, kind + 'video', kind);
    }
    this.sendState(); this.onUpdate();
  }
  stopLocal(kind) {
    const s = this[kind]; if (!s) return;
    if (this.sfu) { this.sfuStop(kind); if (kind === 'screen') this.sfuStop('screenaudio'); }
    else for (const p of this.peers.values()) for (const t of s.getTracks()) { const snd = p.senders[kind + t.kind]; if (snd) { try { p.pc.removeTrack(snd); } catch { } delete p.senders[kind + t.kind]; } }
    s.getTracks().forEach(t => t.stop()); this[kind] = null;
    playSound(kind === 'cam' ? 'camOff' : 'selfStreamStop');
    this.sendState(); this.onUpdate();
  }
  // latência (ms): até o servidor no SFU; pior par na malha; null se ainda não há medida
  async ping() {
    const rtts = [];
    const read = async (src) => { try { for (const r of (await src.getStats()).values()) if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && r.currentRoundTripTime != null) rtts.push(Math.round(r.currentRoundTripTime * 1000)); } catch { } };
    if (this.sfu) { await read(this.sfu.send); if (!rtts.length && this.sfu.recv) await read(this.sfu.recv); return rtts.length ? Math.min(...rtts) : null; }
    for (const p of this.peers.values()) if (p.pc) await read(p.pc);
    return rtts.length ? Math.max(...rtts) : null;
  }
  // estatísticas simples de qualidade (para o painel de conexão)
  async stats() {
    const out = [];
    if (this.sfu) { // uma conexão só (com o servidor); repete a latência para cada participante
      let rtt = null;
      try { for (const r of (await this.sfu.send.getStats()).values()) if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) rtt = Math.round(r.currentRoundTripTime * 1000); } catch { }
      const state = this.sfu.recv?.connectionState || 'new';
      for (const p of this.peers.values()) out.push({ uid: p.uid, state: `${state} (via servidor)`, rtt, kbpsIn: 0 });
      return out;
    }
    for (const p of this.peers.values()) {
      let rtt = null, kbpsIn = 0;
      try { for (const r of (await p.pc.getStats()).values()) { if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) rtt = Math.round(r.currentRoundTripTime * 1000); } } catch { }
      out.push({ uid: p.uid, state: p.pc.connectionState, rtt, kbpsIn });
    }
    return out;
  }
}

// sons de interface (entrar/sair/chamada) sintetizados — sem arquivos
export function playTone(kind, volume = .15) {
  try {
    const ctx = playTone.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume?.();
    const seqs = { join: [[660, 0], [880, .09]], leave: [[880, 0], [520, .09]], mute: [[500, 0]], unmute: [[740, 0]], ring: [[740, 0], [988, .16], [740, .5], [988, .66]], msg: [[880, 0]] };
    for (const [f, t] of seqs[kind] || []) {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = ctx.currentTime + t;
      o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(volume, at); g.gain.exponentialRampToValueAtTime(.001, at + .14);
      o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + .15);
    }
  } catch { }
}
