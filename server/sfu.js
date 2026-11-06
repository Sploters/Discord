// SFU (mediasoup): cada pessoa envia áudio/vídeo uma vez ao servidor, que repassa aos outros.
// Se o mediasoup não carregar (ou RTC=0), o gateway cai para a malha P2P antiga.
import os from 'node:os';
import crypto from 'node:crypto';

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
// Piso da banda estimada de cada espectador. Sem ele o consumidor começa na camada MENOR (480x270) e leva 10-25 s (às vezes nunca) para subir,
// porque a estimativa de banda no servidor fica em ~0,3-0,5 Mbps enquanto só a camada pequena é enviada. 0 desliga (internet muito lenta).
const MIN_OUT_KBPS = process.env.SFU_MIN_OUT_KBPS != null ? Math.max(0, +process.env.SFU_MIN_OUT_KBPS || 0) : 6000;
const WEAK_KBPS = 800; // piso para quem mostrou perda (a camada leve da transmissão + voz cabem)
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

// Transmissão nativa (teste de 120 FPS): um programa no PC captura a tela, comprime em H.264 na placa de vídeo e
// manda RTP puro (UDP) para esta porta. Aparece na sala como a transmissão de tela da pessoa.
// Porta(s): RTC_NATIVE_PORTS (padrão 40001-40010, UDP), anunciadas no mesmo IP do SFU. comedia: o servidor aprende o
// endereço de quem enviar o primeiro pacote (só quem tem o código sabe a porta e o ssrc; numa VPN isso basta para o teste).
const NATIVE_PORTS = (() => { const [a, b] = String(process.env.RTC_NATIVE_PORTS || '40001-40010').split('-').map(Number); return { min: a || 40001, max: b || a || 40010 }; })();
function nativeListen() {
  if (process.env.RTC_ANNOUNCED_IP) return { protocol: 'udp', ip: '0.0.0.0', announcedAddress: process.env.RTC_ANNOUNCED_IP.split(',')[0].trim(), portRange: NATIVE_PORTS };
  return { protocol: 'udp', ip: '0.0.0.0', portRange: NATIVE_PORTS };
}
export const NATIVE_PT = 102;
// layers: quantas camadas (simulcast por ssrc, da mais leve para a cheia); o SFU escolhe para cada espectador a que cabe na banda dele
export async function sfuAttachNative(cid, uid, layers = 1) {
  const r = rooms.get(cid), peer = r?.peers.get(uid);
  if (!peer) throw new Error('fora da sala');
  // SRTP: só quem recebeu a chave (o app de quem transmite, pelo gateway autenticado) consegue mandar vídeo nesta porta
  const t = await r.router.createPlainTransport({ listenInfo: nativeListen(), rtcpMux: true, comedia: true, enableSctp: false, enableSrtp: true, srtpCryptoSuite: 'AES_CM_128_HMAC_SHA1_80' });
  const key = crypto.randomBytes(30).toString('base64');
  try { await t.connect({ srtpParameters: { cryptoSuite: 'AES_CM_128_HMAC_SHA1_80', keyBase64: key } }); } catch (e) { t.close(); throw e; }
  const n = Math.max(1, Math.min(3, layers | 0)), base = 1000000 + Math.floor(Math.random() * 1e8);
  const ssrcs = Array.from({ length: n }, (_, i) => base + i * 7919), ssrc = ssrcs[n - 1];
  let p;
  try {
    p = await t.produce({ kind: 'video', appData: { source: 'screen', native: true, layers: n }, rtpParameters: {
      codecs: [{ mimeType: 'video/H264', payloadType: NATIVE_PT, clockRate: 90000,
        parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 },
        rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }, { type: 'ccm', parameter: 'fir' }] }],
      encodings: ssrcs.map(x => ({ ssrc: x })) } });
  } catch (e) { t.close(); throw e; }
  peer.transports.set(t.id, t);
  t.observer.on('close', () => peer.transports.delete(t.id));
  registerProducer(r, peer, 'screen', p);
  return { transport: t, producer: p, port: t.tuple.localPort, ip: t.tuple.localAddress, ssrc, ssrcs, payloadType: NATIVE_PT, key, serverKey: t.srtpParameters.keyBase64,
    close: () => { try { p.close(); } catch { } try { t.close(); } catch { } } };
}

// Requisições do cliente (via gateway). Retorna o payload da resposta ou lança erro.
export async function sfuRequest(cid, uid, op, d) {
  const r = rooms.get(cid), peer = r?.peers.get(uid);
  if (!peer) throw new Error('fora da sala');
  const transport = () => { const t = peer.transports.get(String(d.transport_id)); if (!t) throw new Error('transporte inválido'); return t; };
  switch (op) {
    case 'transport': {
      if ([...peer.transports.values()].filter(t => t.appData?.dir).length >= 2) throw new Error('transportes demais');
      const t = await r.router.createWebRtcTransport({ webRtcServer, enableUdp: true, enableTcp: true, preferUdp: true, initialAvailableOutgoingBitrate: 8_000_000, appData: { dir: d.dir === 'send' ? 'send' : 'recv' } });
      if (t.appData.dir === 'recv' && MIN_OUT_KBPS > 0) await t.setMinOutgoingBitrate(MIN_OUT_KBPS * 1000).catch(() => { });
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
      if (!r.router.canConsume({ producerId: pid, rtpCapabilities: d.rtpCapabilities })) {
        // quem pediu não decodifica o codec da transmissão (ex.: H.264 High num PC sem decodificação de vídeo pela placa):
        // pede a quem transmite para trocar pelo VP8, que todo navegador recebe; a nova transmissão chega a todos sozinha
        for (const o of r.peers.values()) for (const p of o.producers.values()) {
          if (p.id !== pid || p.kind !== 'video' || p.appData.native || p.appData.fallbackAsked || !/h264/i.test(p.rtpParameters.codecs[0]?.mimeType || '')) continue;
          p.appData.fallbackAsked = true; o.notify('SFU_CODEC_FALLBACK', { source: p.appData.source });
        }
        throw new Error('não é possível consumir');
      }
      const c = await t.consume({ producerId: pid, rtpCapabilities: d.rtpCapabilities, paused: true });
      peer.consumers.set(c.id, c);
      // conexão fraca de quem recebe: a nota (0-10) do que chega até ela cai com perda. Aí o piso de banda deixa de valer
      // para essa pessoa (senão o servidor seguia mandando vídeo acima do que a internet dela aguenta e a voz picotava)
      c.on('score', (sc) => { if (sc.score < 7 && !t.appData.weak && MIN_OUT_KBPS > WEAK_KBPS) { t.appData.weak = true; t.setMinOutgoingBitrate(WEAK_KBPS * 1000).catch(() => { }); } });
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

// Carga do worker único do mediasoup: CPU (% de um núcleo, entre duas amostras), memória e contagem de objetos.
// Amostrado a cada 15 s; guarda o pico e as últimas amostras. Se o pico se aproximar de 100% de um núcleo, é hora de usar mais workers.
const loadHist = []; let lastRu = null, peakCpu = 0;
async function sampleLoad() {
  if (!worker) return null;
  const ru = await worker.getResourceUsage(), now = Date.now();
  let cpu = null;
  if (lastRu) { const dt = now - lastRu.t, du = (ru.ru_utime + ru.ru_stime) - lastRu.cpu; cpu = dt > 0 ? +(du / dt * 100).toFixed(1) : null; } // ru_utime/ru_stime em ms (mediasoup): % de um núcleo
  lastRu = { t: now, cpu: ru.ru_utime + ru.ru_stime };
  let transports = 0, producers = 0, consumers = 0;
  for (const r of rooms.values()) for (const p of r.peers.values()) { transports += p.transports.size; producers += p.producers.size; consumers += p.consumers.size; }
  const smp = { t: now, cpu, rssMB: Math.round(ru.ru_maxrss / 1024), rooms: rooms.size, peers: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0), transports, producers, consumers };
  if (cpu != null) peakCpu = Math.max(peakCpu, cpu);
  loadHist.push(smp); if (loadHist.length > 240) loadHist.shift();
  return smp;
}
setInterval(() => { sampleLoad().catch(() => { }); }, 15000).unref();
export async function sfuLoad() {
  const cur = await sampleLoad();
  return { enabled: sfuEnabled(), workers: worker ? 1 : 0, current: cur, peakCpuPercent: peakCpu, history: loadHist.slice(-40) };
}
