// AudioWorklet: mudança de tom em tempo real (duas leituras de uma linha de atraso, com janela que se cruza).
// Barato e com ~30 ms de atraso; usado pelos efeitos "voz grossa", "esquilo", "monstro" e "alien".
class LcPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor() { super(); this.n = 8192; this.buf = new Float32Array(this.n); this.w = 0; this.p = 0; this.win = 1440; }
  read(d) { const n = this.n; let x = this.w - d; while (x < 0) x += n; const i = Math.floor(x), f = x - i; return this.buf[i % n] * (1 - f) + this.buf[(i + 1) % n] * f; }
  process(inputs, outputs, params) {
    const inp = inputs[0]?.[0], out = outputs[0]; if (!out?.length) return true;
    const ratio = params.ratio[0], W = this.win, step = (1 - ratio) / W;
    for (let k = 0; k < out[0].length; k++) {
      this.buf[this.w] = inp ? inp[k] : 0;
      let p = this.p + step; p -= Math.floor(p); this.p = p;
      const q = (p + 0.5) % 1, g1 = Math.sin(Math.PI * p) ** 2, g2 = Math.sin(Math.PI * q) ** 2;
      const y = g1 * this.read(p * W + 1) + g2 * this.read(q * W + 1);
      for (const ch of out) ch[k] = y;
      this.w = (this.w + 1) % this.n;
    }
    return true;
  }
}
registerProcessor('lc-pitch', LcPitch);
