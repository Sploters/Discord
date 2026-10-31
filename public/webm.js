// Remontagem de WebM gravado ao vivo (MediaRecorder): corta em clusters, zera os tempos e grava a duração.
// Sem imports: dá para testar fora do navegador.
export const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];

export function findClusters(bytes, base = 0) {
  const out = [];
  for (let i = 0; i <= bytes.length - 4; i++) if (bytes[i] === 0x1f && bytes[i + 1] === 0x43 && bytes[i + 2] === 0xb6 && bytes[i + 3] === 0x75) out.push(base + i);
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

// { ts, body (depois do Timecode), keyStart } de um cluster
export function parseCluster(c) {
  const sz = readSize(c, 4); if (!sz) return null;
  let p = 4 + sz.len;
  const end = sz.unknown ? c.length : Math.min(c.length, p + sz.value);
  if (c[p] !== 0xe7) return null;
  const ts = readSize(c, p + 1); if (!ts) return null;
  const tsVal = uint(c, p + 1 + ts.len, ts.value);
  const body = p + 1 + ts.len + ts.value;
  // quadro-chave de vídeo (trilha 1) como primeiro bloco de vídeo do cluster?
  let keyStart = false;
  for (let q = body; q < end;) {
    const id = readId(c, q); if (!id) break;
    const s = readSize(c, q + id.len); if (!s) break;
    const data = q + id.len + s.len;
    if (id.id === 0xa3) {
      const tr = readSize(c, data);
      if (tr && tr.value === 1) { keyStart = !!(c[data + tr.len + 2] & 0x80); break; }
    } else if (id.id === 0xa0) { // BlockGroup: o quadro-chave é o que não tem ReferenceBlock (0xFB)
      let track = 0, ref = false;
      for (let r = data, e = data + (s.unknown ? 0 : s.value); r < e;) {
        const cid = readId(c, r); const cs = cid && readSize(c, r + cid.len); if (!cs) break;
        const cd = r + cid.len + cs.len;
        if (cid.id === 0xa1) track = readSize(c, cd)?.value; else if (cid.id === 0xfb) ref = true;
        r = cd + cs.value;
      }
      if (track === 1) { keyStart = !ref; break; }
    }
    q = data + (s.unknown ? 0 : s.value);
  }
  return { ts: tsVal, body, end, keyStart };
}

// header: bytes antes do 1º cluster. clusters: [Uint8Array] já contíguos (último = o seguinte ao fim, só para dar o tempo final).
export function buildClip(header, clusters, endTs) {
  const parsed = clusters.map(parseCluster);
  if (!parsed.length || parsed.some(x => !x)) return null;
  const base = parsed[0].ts, dur = Math.max(1, (endTs ?? parsed[parsed.length - 1].ts + 1000) - base);
  const parts = [withDuration(header, dur)];
  clusters.forEach((c, i) => {
    const x = parsed[i], rest = c.subarray(x.body, x.end);
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
      if (hasDur) return h;
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
