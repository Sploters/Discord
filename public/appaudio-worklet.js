// AudioWorklet do áudio "só do jogo" (app desktop): recebe o PCM do programa nativo lc-audio (float32, 48 kHz, estéreo,
// intercalado, em pedaços de tamanho qualquer) e toca como uma trilha normal. Fila curta (~60 ms): se o relógio do Windows
// e o do Chromium se afastarem, descarta o excesso; se faltar áudio (jogo em silêncio, o Windows não manda nada), sai silêncio.
const RATE = 48000, TARGET = Math.round(RATE * 0.06), MAX = Math.round(RATE * 0.25), PRIME = Math.round(RATE * 0.03);
class LcPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(RATE * 2 * 2); // 2 s estéreo (anel)
    this.r = 0; this.n = 0; // posição de leitura e quadros guardados
    this.rest = new Uint8Array(0); this.primed = false;
    this.port.onmessage = (e) => this.push(e.data);
  }
  push(chunk) {
    let bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    if (this.rest.length) { const j = new Uint8Array(this.rest.length + bytes.length); j.set(this.rest); j.set(bytes, this.rest.length); bytes = j; }
    const usable = bytes.length - (bytes.length % 8); // quadro = 2 canais × 4 bytes; o pedaço pode cortar um quadro no meio
    this.rest = bytes.slice(usable);
    const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + usable)); // cópia alinhada
    const cap = this.buf.length / 2, frames = f.length / 2;
    for (let i = 0; i < frames; i++) {
      const w = ((this.r + this.n) % cap) * 2;
      this.buf[w] = f[i * 2]; this.buf[w + 1] = f[i * 2 + 1];
      if (this.n < cap) this.n++; else this.r = (this.r + 1) % cap;
    }
    if (this.n > MAX) { const drop = this.n - TARGET; this.r = (this.r + drop) % cap; this.n -= drop; } // atraso acumulado: volta para ~60 ms
    if (!this.primed && this.n >= PRIME) this.primed = true;
  }
  process(_in, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], cap = this.buf.length / 2;
    if (!this.primed) { L.fill(0); R.fill(0); return true; }
    for (let i = 0; i < L.length; i++) {
      if (!this.n) { L.fill(0, i); R.fill(0, i); this.primed = false; break; } // acabou: espera juntar um pouco antes de voltar (sem estalos)
      L[i] = this.buf[this.r * 2]; R[i] = this.buf[this.r * 2 + 1];
      this.r = (this.r + 1) % cap; this.n--;
    }
    return true;
  }
}
registerProcessor('lc-pcm', LcPcm);
