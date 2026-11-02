// Servidor de diagnóstico: roda o server/index.js SEM alterá-lo e expõe estatísticas do SFU (mediasoup) em /diag.
// Usa o observer global do mediasoup para enxergar produtores/consumidores criados pelo sfu.js.
// Uso: node scripts/fps-diag-server.mjs   (PORT, DIAG_PORT, DATA_DIR etc. como no servidor normal)
import http from 'node:http';
import { observer } from 'mediasoup';

const producers = new Set(), consumers = new Set(), transports = new Set();
observer.on('newworker', w => w.observer.on('newrouter', r => r.observer.on('newtransport', t => {
  transports.add(t); t.observer.on('close', () => transports.delete(t));
  t.observer.on('newproducer', p => { producers.add(p); p.observer.on('close', () => producers.delete(p)); });
  t.observer.on('newconsumer', c => { consumers.add(c); c.observer.on('close', () => consumers.delete(c)); });
})));

const slim = (s) => ({ type: s.type, rid: s.rid, ssrc: s.ssrc, bitrate: s.bitrate, packetCount: s.packetCount, byteCount: s.byteCount, packetsLost: s.packetsLost, score: s.score, jitter: s.jitter, nackCount: s.nackCount, pliCount: s.pliCount, firCount: s.firCount, roundTripTime: s.roundTripTime });
const snap = async () => {
  const out = { t: Date.now(), producers: [], consumers: [] };
  const src = new Map();
  for (const p of producers) {
    if (p.kind !== 'video') continue;
    src.set(p.id, p.appData?.source);
    out.producers.push({ id: p.id, source: p.appData?.source, stats: (await p.getStats().catch(() => [])).map(slim) });
  }
  for (const c of consumers) {
    if (c.kind !== 'video') continue;
    out.consumers.push({ id: c.id, producerId: c.producerId, source: src.get(c.producerId), layers: c.currentLayers, paused: c.paused, stats: (await c.getStats().catch(() => [])).map(slim) });
  }
  out.transports = [];
for (const t of transports) { const st = (await t.getStats().catch(() => []))[0]; if (st) out.transports.push({ dir: t.appData?.dir, availOut: st.availableOutgoingBitrate, availIn: st.availableIncomingBitrate, recvMbps: st.recvBitrate, sendMbps: st.sendBitrate, rtt: st.rtt }); }
  return out;
};
http.createServer(async (req, res) => {
  try { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(await snap())); } catch (e) { res.statusCode = 500; res.end(String(e)); }
}).listen(Number(process.env.DIAG_PORT || 3299), '127.0.0.1');

await import('../server/index.js');
