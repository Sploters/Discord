// SFU (mediasoup): cada pessoa envia áudio/vídeo uma vez ao servidor, que repassa aos outros.
// Se o mediasoup não carregar (ou RTC=0), o gateway cai para a malha P2P antiga.
import os from 'node:os';

const PORT = Number(process.env.RTC_PORT || 40000);
const SOURCES = ['mic', 'cam', 'screen', 'screenaudio'];
const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
  // High: o Chromium só usa a placa de vídeo (NVENC/AMF/QuickSync) com várias camadas neste perfil; o Baseline cai no OpenH264 (CPU)
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '640032', 'level-asymmetry-allowed': 1 } },
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } },
];

let worker = null, webRtcServer = null;
const rooms = new Map(); // channelId -> { router, peers: Map<userId, Peer> }

// IPs anunciados: RTC_ANNOUNCED_IP (Docker/NAT) ou todos os IPv4 das interfaces (inclui a da VPN)
function listenInfos() {
  const out = [];
  if (process.env.RTC_ANNOUNCED_IP) {
    const announcedAddress = process.env.RTC_ANNOUNCED_IP.split(',')[0].trim();
    for (const protocol of ['udp', 'tcp']) out.push({ protocol, ip: '0.0.0.0', announcedAddress, port: PORT });
    return out;
  }
  const ips = process.env.RTC_IPS ? process.env.RTC_IPS.split(',').map(s => s.trim())
    : [...new Set(Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4').map(i => i.address))];
  for (const ip of ips) for (const protocol of ['udp', 'tcp']) out.push({ protocol, ip, port: PORT });
  return out;
}

export async function startSfu() {
  if (process.env.RTC === '0') return false;
  try {
    const ms = await import('mediasoup');
    worker = await ms.createWorker({ logLevel: 'warn' });
    worker.on('died', () => { console.error('  SFU: worker do mediasoup morreu; reinicie o servidor'); worker = null; });
    const infos = listenInfos();
    webRtcServer = await worker.createWebRtcServer({ listenInfos: infos });
    console.log(`  SFU de voz ativo (mediasoup ${ms.version}) na porta ${PORT} UDP/TCP: ${[...new Set(infos.map(i => i.announcedAddress || i.ip))].join(', ')}`);
    return true;
  } catch (e) {
    console.log(`  (SFU indisponível, voz em malha P2P: ${e.message})`);
    worker?.close(); worker = webRtcServer = null;
    return false;
  }
}
export const sfuEnabled = () => !!(worker && webRtcServer);

async function roomFor(cid) {
  let r = rooms.get(cid);
  if (!r) {
    r = { router: null, peers: new Map(), ready: null };
    rooms.set(cid, r);
    r.ready = worker.createRouter({ mediaCodecs: MEDIA_CODECS }).then(router => (r.router = router));
  }
  await r.ready;
  return r;
}

// Entra na sala: devolve as capacidades RTP do roteador para o cliente carregar o Device
export async function sfuJoin(cid, uid, notify) {
  const r = await roomFor(cid);
  r.peers.get(uid)?.close();
  const peer = { uid, notify, transports: new Map(), producers: new Map(), consumers: new Map(),
    close() { for (const t of this.transports.values()) t.close(); this.transports.clear(); } };
  r.peers.set(uid, peer);
  return { rtpCapabilities: r.router.rtpCapabilities };
}

export function sfuLeave(cid, uid) {
  const r = rooms.get(cid); if (!r) return;
  const peer = r.peers.get(uid); if (!peer) return;
  peer.close(); r.peers.delete(uid);
  if (!r.peers.size) { r.router?.close(); rooms.delete(cid); }
}

const producerInfo = (p, uid) => ({ producer_id: p.id, user_id: uid, kind: p.kind, source: p.appData.source });

// Publica o producer na sala e avisa os demais participantes
function registerProducer(r, peer, source, p) {
  peer.producers.get(source)?.close();
  peer.producers.set(source, p);
  p.on('transportclose', () => peer.producers.get(source) === p && peer.producers.delete(source));
  p.observer.on('close', () => {
    if (peer.producers.get(source) === p) peer.producers.delete(source);
    for (const o of r.peers.values()) if (o !== peer) o.notify('SFU_PRODUCER_CLOSED', producerInfo(p, peer.uid));
  });
  for (const o of r.peers.values()) if (o !== peer) o.notify('SFU_NEW_PRODUCER', producerInfo(p, peer.uid));
}

// Bot de música: recebe RTP/Opus local (ffmpeg) e publica como o microfone de um participante.
// O ffmpeg deve enviar para 127.0.0.1:<port> com o payload type 101 e o ssrc devolvidos.
export async function sfuAttachRtp(cid, uid) {
  const r = rooms.get(cid), peer = r?.peers.get(uid);
  if (!peer) throw new Error('fora da sala');
  const t = await r.router.createPlainTransport({ listenInfo: { protocol: 'udp', ip: '127.0.0.1' }, rtcpMux: true, comedia: true });
  const ssrc = 1000000 + Math.floor(Math.random() * 1e8);
  const p = await t.produce({ kind: 'audio', appData: { source: 'mic' }, rtpParameters: {
    codecs: [{ mimeType: 'audio/opus', payloadType: 101, clockRate: 48000, channels: 2, parameters: { useinbandfec: 1, 'sprop-stereo': 1 } }],
    encodings: [{ ssrc }] } });
  peer.transports.set(t.id, t);
  t.observer.on('close', () => peer.transports.delete(t.id));
  registerProducer(r, peer, 'mic', p);
  return { port: t.tuple.localPort, ssrc, payloadType: 101, close: () => { try { p.close(); } catch { } try { t.close(); } catch { } } };
}

// Requisições do cliente (via gateway). Retorna o payload da resposta ou lança erro.
export async function sfuRequest(cid, uid, op, d) {
  const r = rooms.get(cid), peer = r?.peers.get(uid);
  if (!peer) throw new Error('fora da sala');
  const transport = () => { const t = peer.transports.get(String(d.transport_id)); if (!t) throw new Error('transporte inválido'); return t; };
  switch (op) {
    case 'transport': {
      if (peer.transports.size >= 2) throw new Error('transportes demais');
      const t = await r.router.createWebRtcTransport({ webRtcServer, enableUdp: true, enableTcp: true, preferUdp: true, initialAvailableOutgoingBitrate: 8_000_000, appData: { dir: d.dir === 'send' ? 'send' : 'recv' } });
      peer.transports.set(t.id, t);
      return { id: t.id, iceParameters: t.iceParameters, iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters };
    }
    case 'connect': await transport().connect({ dtlsParameters: d.dtlsParameters }); return {};
    case 'produce': {
      const t = transport(), source = String(d.source);
      if (t.appData.dir !== 'send' || !SOURCES.includes(source)) throw new Error('produção inválida');
      const p = await t.produce({ kind: d.kind, rtpParameters: d.rtpParameters, appData: { source } });
      registerProducer(r, peer, source, p);
      return { id: p.id };
    }
    case 'close_producer': { const p = peer.producers.get(String(d.source)); p?.close(); return {}; }
    case 'producers': { // o que já está sendo transmitido na sala
      const out = [];
      for (const o of r.peers.values()) if (o !== peer) for (const p of o.producers.values()) out.push(producerInfo(p, o.uid));
      return { producers: out };
    }
    case 'consume': {
      const t = transport(), pid = String(d.producer_id);
      if (t.appData.dir !== 'recv') throw new Error('transporte inválido');
      if (!r.router.canConsume({ producerId: pid, rtpCapabilities: d.rtpCapabilities })) throw new Error('não é possível consumir');
      const c = await t.consume({ producerId: pid, rtpCapabilities: d.rtpCapabilities, paused: true });
      peer.consumers.set(c.id, c);
      const drop = () => { if (peer.consumers.delete(c.id)) peer.notify('SFU_CONSUMER_CLOSED', { consumer_id: c.id }); };
      c.on('producerclose', drop); c.on('transportclose', () => peer.consumers.delete(c.id));
      return { id: c.id, producer_id: pid, kind: c.kind, rtpParameters: c.rtpParameters };
    }
    case 'pause': { const c = peer.consumers.get(String(d.consumer_id)); if (c) d.paused ? await c.pause() : await c.resume(); return {}; }
    case 'layers': { const c = peer.consumers.get(String(d.consumer_id)); if (c?.kind === 'video') await c.setPreferredLayers({ spatialLayer: Math.max(0, Math.min(2, d.spatial | 0)), temporalLayer: 2 }).catch(() => { }); return {}; }
    case 'resume': { await peer.consumers.get(String(d.consumer_id))?.resume(); return {}; }
    default: throw new Error('operação desconhecida');
  }
}

// Para o painel de admin / diagnóstico
export const sfuStats = () => ({ enabled: sfuEnabled(), rooms: rooms.size, peers: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0) });
