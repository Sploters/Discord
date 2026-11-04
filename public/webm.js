// Remontagem de WebM gravado ao vivo (MediaRecorder): corta em clusters, zera os tempos e grava a duração.
// Sem imports: dá para testar fora do navegador.
export const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];

export function findClusters(bytes, base = 0) {
  const out = [];
  // indexOf (nativo) pula direto para cada 0x1F: dezenas de vezes mais rápido que olhar byte a byte num clipe de 60 MB
  for (let i = bytes.indexOf(0x1f); i >= 0 && i <= bytes.length - 4; i = bytes.indexOf(0x1f, i + 1)) if (bytes[i + 1] === 0x43 && bytes[i + 2] === 0xb6 && bytes[i + 3] === 0x75) out.push(base + i);
  return out;
}

// vint de tamanho: { len, value, unknown }
function readSize(b, p) {
  const first = b[p]; if (!first) return null;
  let len = 1, mask = 0x80; while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8) return null;
  let v = first & (mask - 1), all = v === mask - 1;
  for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) all = false; }
  return { len, value: v, unknown: all };
}
function readId(b, p) { const first = b[p]; let len = 1, mask = 0x80; while (len <= 4 && !(first & mask)) { len++; mask >>= 1; } if (len > 4) return null; let id = 0; for (let i = 0; i < len; i++) id = id * 256 + b[p + i]; return { len, id }; }
const uint = (b, p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; };
const size8 = (v) => { const o = new Uint8Array(8); o[0] = 0x01; for (let i = 7; i >= 1; i--) { o[i] = v % 256; v = Math.floor(v / 256); } return o; };
const u64 = (v) => { const o = new Uint8Array(8); for (let i = 7; i >= 0; i--) { o[i] = v % 256; v = Math.floor(v / 256); } return o; };

// número da trilha de vídeo no cabeçalho (Tracks > TrackEntry com TrackType 1). O MediaRecorder numera as trilhas na ordem
// em que o primeiro quadro de cada uma chega: se o áudio chega antes, o vídeo vira a trilha 2. Sem cabeçalho legível: 1.
export function videoTrack(h) {
  if (!h) return 1;
  for (let i = 0; i < h.length - 4; i++) {
    if (h[i] !== 0x16 || h[i + 1] !== 0x54 || h[i + 2] !== 0xae || h[i + 3] !== 0x6b) continue;
    const s = readSize(h, i + 4); if (!s) return 1;
    const end = s.unknown ? h.length : Math.min(h.length, i + 4 + s.len + s.value);
    for (let q = i + 4 + s.len; q < end;) {
      const id = readId(h, q); const z = id && readSize(h, q + id.len); if (!z || z.unknown) break;
      const d = q + id.len + z.len;
      if (id.id === 0xae) {
        let num = 0, type = 0;
        for (let r = d, e = Math.min(end, d + z.value); r < e;) {
          const cid = readId(h, r); const cs = cid && readSize(h, r + cid.len); if (!cs || cs.unknown) break;
          const cd = r + cid.len + cs.len;
          if (cid.id === 0xd7) num = uint(h, cd, cs.value); else if (cid.id === 0x83) type = uint(h, cd, cs.value);
          r = cd + cs.value;
        }
        if (type === 1 && num) return num;
      }
      q = d + z.value;
    }
    return 1;
  }
  return 1;
}

// { ts, body (depois do Timecode), keyStart } de um cluster. vt: trilha de vídeo (videoTrack do cabeçalho)
export function parseCluster(c, vt = 1) {
  const sz = readSize(c, 4); if (!sz) return null;
  let p = 4 + sz.len;
  const end = sz.unknown ? c.length : Math.min(c.length, p + sz.value);
  if (c[p] !== 0xe7) return null;
  const ts = readSize(c, p + 1); if (!ts) return null;
  const tsVal = uint(c, p + 1 + ts.len, ts.value);
  const body = p + 1 + ts.len + ts.value;
  // o primeiro bloco de vídeo do cluster é um quadro-chave? (os blocos de áudio antes dele não contam)
  let keyStart = false;
  for (let q = body; q < end;) {
    const id = readId(c, q); if (!id) break;
    const s = readSize(c, q + id.len); if (!s) break;
    const data = q + id.len + s.len;
    if (id.id === 0xa3) {
      const tr = readSize(c, data);
      if (tr && tr.value === vt) { keyStart = !!(c[data + tr.len + 2] & 0x80); break; }
    } else if (id.id === 0xa0) { // BlockGroup: o quadro-chave é o que não tem ReferenceBlock (0xFB)
      let track = 0, ref = false;
      for (let r = data, e = data + (s.unknown ? 0 : s.value); r < e;) {
        const cid = readId(c, r); const cs = cid && readSize(c, r + cid.len); if (!cs) break;
        const cd = r + cid.len + cs.len;
        if (cid.id === 0xa1) track = readSize(c, cd)?.value; else if (cid.id === 0xfb) ref = true;
        r = cd + cs.value;
      }
      if (track === vt) { keyStart = !ref; break; }
    }
    q = data + (s.unknown ? 0 : s.value);
  }
  return { ts: tsVal, body, end, keyStart };
}

// fim do último elemento inteiro do cluster: o MediaRecorder entrega pedaços que podem terminar no meio de um bloco
// (ex.: só o byte 0xA3 do próximo SimpleBlock); um bloco pela metade no fim fazia o arquivo parecer quebrado
function wholeEnd(c, from, to) {
  let q = from;
  while (q < to) {
    const id = readId(c, q); const s = id && q + id.len < to && readSize(c, q + id.len);
    if (!s || s.unknown || q + id.len + s.len + s.value > to) break;
    q += id.len + s.len + s.value;
  }
  return q;
}

// header: bytes antes do 1º cluster. clusters: [Uint8Array] já contíguos (último = o seguinte ao fim, só para dar o tempo final).
export function buildClip(header, clusters, endTs) {
  const parsed = clusters.map(c => parseCluster(c));
  if (!parsed.length || parsed.some(x => !x)) return null;
  const base = parsed[0].ts, dur = Math.max(1, (endTs ?? parsed[parsed.length - 1].ts + 1000) - base);
  const parts = [withDuration(header, dur)];
  clusters.forEach((c, i) => {
    const x = parsed[i], rest = c.subarray(x.body, wholeEnd(c, x.body, x.end));
    const tc = new Uint8Array(10); tc[0] = 0xe7; tc[1] = 0x88; tc.set(u64(x.ts - base), 2);
    parts.push(Uint8Array.from(CLUSTER_ID), size8(tc.length + rest.length), tc, rest);
  });
  let n = 0; parts.forEach(p => (n += p.length));
  const out = new Uint8Array(n); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
  return out;
}

// acrescenta Duration (float64, em ms com TimecodeScale padrão) ao Info; só se o Segment for de tamanho desconhecido (ao vivo)
function withDuration(h, ms) {
  let seg = -1;
  for (let i = 0; i < Math.min(h.length - 4, 64); i++) if (h[i] === 0x18 && h[i + 1] === 0x53 && h[i + 2] === 0x80 && h[i + 3] === 0x67) { seg = i; break; }
  if (seg < 0) return h;
  const ss = readSize(h, seg + 4); if (!ss?.unknown) return h;
  const from = seg + 4 + ss.len;
  for (let i = from; i < h.length - 4; i++) {
    if (h[i] === 0x15 && h[i + 1] === 0x49 && h[i + 2] === 0xa9 && h[i + 3] === 0x66) {
      const s = readSize(h, i + 4); if (!s || s.unknown) return h;
      const bodyStart = i + 4 + s.len, bodyEnd = bodyStart + s.value;
      let hasDur = false;
      for (let q = bodyStart; q < bodyEnd;) { const id = readId(h, q); const z = id && readSize(h, q + id.len); if (!z) break; if (id.id === 0x4489) hasDur = true; q += id.len + z.len + z.value; }
      if (hasDur) return setDuration(h, bodyStart, bodyEnd, ms);
      const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, ms);
      const dur = new Uint8Array([0x44, 0x89, 0x88, ...new Uint8Array(dv.buffer)]);
      const nl = s.value + dur.length, sizeBytes = new Uint8Array([0x10 | ((nl >> 24) & 0x0f), (nl >> 16) & 255, (nl >> 8) & 255, nl & 255]);
      const out = new Uint8Array(h.length - s.len + sizeBytes.length + dur.length);
      out.set(h.subarray(0, i + 4)); out.set(sizeBytes, i + 4); out.set(h.subarray(bodyStart, bodyEnd), i + 4 + 4); out.set(dur, i + 8 + s.value); out.set(h.subarray(bodyEnd), i + 8 + s.value + dur.length);
      return out;
    }
  }
  return h;
}

// troca o valor de um Duration (float 4 ou 8 bytes) que já existe no Info
function setDuration(h, from, to, ms) {
  const out = h.slice();
  for (let q = from; q < to;) {
    const id = readId(out, q); const z = id && readSize(out, q + id.len); if (!z) break;
    if (id.id === 0x4489) { const dv = new DataView(out.buffer, out.byteOffset + q + id.len + z.len, z.value); if (z.value === 8) dv.setFloat64(0, ms); else if (z.value === 4) dv.setFloat32(0, ms); break; }
    q += id.len + z.len + z.value;
  }
  return out;
}

// ---------- corte de um clipe já pronto (sem recomprimir) ----------
const isCluster = (b, p) => b[p] === 0x1f && b[p + 1] === 0x43 && b[p + 2] === 0xb6 && b[p + 3] === 0x75;
// cabeçalho limpo: Segment de tamanho desconhecido e sem SeekHead/Cues/Void (os deslocamentos antigos deixariam de valer)
function cleanHeader(h) {
  let seg = -1;
  for (let i = 0; i < Math.min(h.length - 4, 64); i++) if (h[i] === 0x18 && h[i + 1] === 0x53 && h[i + 2] === 0x80 && h[i + 3] === 0x67) { seg = i; break; }
  if (seg < 0) return h;
  const ss = readSize(h, seg + 4); if (!ss) return h;
  const parts = [h.subarray(0, seg + 4), Uint8Array.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])];
  for (let q = seg + 4 + ss.len; q < h.length;) {
    const id = readId(h, q); const z = id && readSize(h, q + id.len); if (!z || z.unknown) { parts.push(h.subarray(q)); break; }
    const end = q + id.len + z.len + z.value;
    if (![0x114d9b74, 0x1c53bb6b, 0xec].includes(id.id)) parts.push(h.subarray(q, Math.min(end, h.length)));
    q = end;
  }
  let n = 0; parts.forEach(p => (n += p.length));
  const out = new Uint8Array(n); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
  return out;
}

// separa um WebM inteiro em cabeçalho + clusters (anda pelo tamanho; tamanho desconhecido = até o próximo cluster válido)
export function splitWebm(b) {
  const cand = findClusters(b).filter(p => parseCluster(b.subarray(p, Math.min(b.length, p + 64)), 0));
  if (!cand.length) return null;
  const clusters = []; let p = cand[0];
  while (p < b.length && isCluster(b, p)) {
    const sz = readSize(b, p + 4); if (!sz) break;
    const next = sz.unknown ? (cand.find(c => c > p) ?? b.length) : p + 4 + sz.len + sz.value;
    clusters.push(b.subarray(p, Math.min(next, b.length)));
    p = next;
  }
  return { header: b.subarray(0, cand[0]), clusters };
}

// blocos de um cluster com o tempo de cada um (relativo ao cluster)
function blocksOf(c, x) {
  const out = [];
  for (let q = x.body; q < x.end;) {
    const id = readId(c, q); if (!id) break;
    const s = readSize(c, q + id.len); if (!s || s.unknown) break;
    const data = q + id.len + s.len, end = data + s.value;
    let blk = -1;
    if (id.id === 0xa3) blk = data;
    else if (id.id === 0xa0) for (let r = data; r < end;) { const cid = readId(c, r); const cs = cid && readSize(c, r + cid.len); if (!cs) break; if (cid.id === 0xa1) { blk = r + cid.len + cs.len; break; } r += cid.len + cs.len + cs.value; }
    let tc = 0;
    if (blk >= 0) { const tr = readSize(c, blk); if (tr) { const v = (c[blk + tr.len] << 8) | c[blk + tr.len + 1]; tc = v & 0x8000 ? v - 0x10000 : v; } }
    out.push({ from: q, to: end, tc, timed: blk >= 0 });
    q = end;
  }
  return out;
}

/**
 * Corta um WebM entre startMs e endMs (tempos do próprio arquivo) sem recomprimir.
 * O início volta para o quadro-chave mais próximo (até ~1 s antes); o fim é exato (descarta os blocos depois dele).
 * Devolve { bytes, startMs, endMs } com os tempos reais, ou null se não der.
 */
export function trimWebm(bytes, startMs, endMs) {
  const sp = splitWebm(bytes); if (!sp) return null;
  const vt = videoTrack(sp.header), info = sp.clusters.map(c => parseCluster(c, vt));
  if (!info.length || info.some(x => !x)) return null;
  const base = info[0].ts, rel = (i) => info[i].ts - base;
  let pick = -1;
  for (let i = 0; i < info.length; i++) if (info[i].keyStart && rel(i) <= startMs) pick = i;
  if (pick < 0) pick = info.findIndex(x => x.keyStart);
  if (pick < 0) return null;
  const sel = [];
  for (let i = pick; i < info.length && rel(i) < endMs; i++) {
    const c = sp.clusters[i], x = info[i], limit = endMs - rel(i);
    const blocks = blocksOf(c, x), keep = blocks.filter(b => !b.timed || b.tc < limit);
    if (keep.length === blocks.length) { sel.push(c); continue; }
    // último cluster: só os blocos antes do fim
    const tcEl = c.subarray(4 + readSize(c, 4).len, x.body), parts = keep.map(b => c.subarray(b.from, b.to));
    let n = tcEl.length; parts.forEach(p => (n += p.length));
    const out = new Uint8Array(4 + 8 + n); out.set(CLUSTER_ID); out.set(size8(n), 4); out.set(tcEl, 12); let o = 12 + tcEl.length; parts.forEach(p => { out.set(p, o); o += p.length; });
    sel.push(out);
  }
  if (!sel.length) return null;
  // fim real: o pedido, ou o último bloco que existe (se pediram além do fim do arquivo)
  const li = pick + sel.length - 1, lb = blocksOf(sp.clusters[li], info[li]).filter(b => b.timed);
  const realEnd = Math.min(endMs, rel(li) + (lb.length ? Math.max(...lb.map(b => b.tc)) + 34 : 1000));
  const out = buildClip(cleanHeader(sp.header), sel, base + realEnd);
  return out && { bytes: out, startMs: rel(pick), endMs: realEnd };
}

// tempos (relativos ao início) dos clusters que começam com quadro-chave: onde um corte pode começar
export function keyframeTimes(bytes) {
  const sp = splitWebm(bytes); if (!sp) return [];
  const vt = videoTrack(sp.header), info = sp.clusters.map(c => parseCluster(c, vt)); if (!info[0]) return [];
  return info.filter(x => x && x.keyStart).map(x => x.ts - info[0].ts);
}
