// Efeitos de voz. Quem fala escolhe o efeito; a voz vai NORMAL pela rede junto com o nome do efeito, e o app de cada
// pessoa que ouve aplica o efeito na hora. Assim cada um pode ouvir sem efeito (todo mundo ou só alguém), nada fica
// mais alto que a voz normal (limitador no fim) e o processamento é leve (nós nativos do navegador + 1 worklet pequeno).
export const FX = [
  { id: 'robo', label: 'Robô', emoji: '🤖' },
  { id: 'grossa', label: 'Voz grossa', emoji: '🐻' },
  { id: 'esquilo', label: 'Esquilo', emoji: '🐿️' },
  { id: 'monstro', label: 'Monstro', emoji: '👹' },
  { id: 'alien', label: 'Alien', emoji: '👽' },
  { id: 'radio', label: 'Rádio', emoji: '📻' },
  { id: 'megafone', label: 'Megafone', emoji: '📢' },
  { id: 'eco', label: 'Eco', emoji: '🏔️' },
  { id: 'estadio', label: 'Estádio', emoji: '🏟️' },
];
export const FX_IDS = FX.map(f => f.id);
export const fxInfo = (id) => FX.find(f => f.id === id) || null;

const ready = new WeakMap(); // contexto -> Promise (worklet carregado)
export const loadFx = (ctx) => { if (!ready.has(ctx)) ready.set(ctx, ctx.audioWorklet.addModule('/fx-pitch.js').catch(() => null)); return ready.get(ctx); };

function curve(amount) { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(amount * x) / Math.tanh(amount); } return c; }
function impulse(ctx, secs, decay) { const len = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, len, ctx.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); } return b; }

/**
 * Monta o efeito: { input, output, stop() }. Precisa de loadFx(ctx) antes para os que mudam o tom
 * (sem o worklet, esses caem para um filtro simples em vez de falhar).
 */
export function createFx(ctx, id) {
  const input = ctx.createGain(), output = ctx.createGain(), stops = [];
  const node = (n) => n;
  const pitch = (ratio) => { try { const w = new AudioWorkletNode(ctx, 'lc-pitch', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }); w.parameters.get('ratio').value = ratio; return w; } catch { const f = ctx.createBiquadFilter(); f.type = ratio < 1 ? 'lowpass' : 'highpass'; f.frequency.value = ratio < 1 ? 900 : 1200; return f; } };
  const ring = (freq, depth) => { // modulação em anel: o "metálico" do robô
    const g = ctx.createGain(); g.gain.value = 1 - depth; const o = ctx.createOscillator(); o.frequency.value = freq; const og = ctx.createGain(); og.gain.value = depth; o.connect(og).connect(g.gain); o.start(); stops.push(() => o.stop()); return g;
  };
  const shaper = (amt) => { const s = ctx.createWaveShaper(); s.curve = curve(amt); s.oversample = '2x'; return s; };
  const filt = (type, freq, q = 0.7, gain = 0) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; f.gain.value = gain; return f; };
  const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const chain = (...ns) => { let a = input; for (const n of ns) { a.connect(n); a = n; } a.connect(output); };
  const mix = (dryV, wet, wetV) => { const d = gain(dryV), w = gain(wetV); input.connect(d).connect(output); input.connect(wet.in); wet.out.connect(w).connect(output); };
  switch (id) {
    case 'robo': chain(filt('highpass', 120), ring(55, 1), shaper(2.5), filt('lowpass', 4500), gain(0.62)); break;
    case 'grossa': chain(pitch(0.72), filt('lowshelf', 180, 0.7, 4), gain(0.85)); break;
    case 'esquilo': chain(pitch(1.65), filt('highshelf', 3000, 0.7, -3), gain(1.15)); break;
    case 'monstro': chain(pitch(0.58), ring(28, 0.35), shaper(1.8), filt('lowpass', 3500), gain(1)); break;
    case 'alien': chain(pitch(1.22), ring(180, 0.6), filt('peaking', 2200, 2, 6), gain(1.7)); break;
    case 'radio': chain(filt('highpass', 450, 0.9), filt('lowpass', 3000, 0.9), filt('peaking', 1600, 1.2, 6), shaper(3), gain(0.75)); break;
    case 'megafone': chain(filt('highpass', 700, 1), filt('bandpass', 1800, 0.8), shaper(6), filt('lowpass', 4000), gain(0.8)); break;
    case 'eco': {
      const d = ctx.createDelay(1), fb = gain(0.38), w = { in: d, out: d }; d.delayTime.value = 0.28; d.connect(fb).connect(d);
      mix(0.72, w, 0.32); break;
    }
    case 'estadio': {
      const c = ctx.createConvolver(); c.buffer = impulse(ctx, 2.6, 2.2); const pre = filt('highpass', 200);
      pre.connect(c); mix(0.85, { in: pre, out: c }, 0.5); break;
    }
    default: input.connect(output);
  }
  void node;
  return { input, output, stop: () => { stops.forEach(f => { try { f(); } catch { } }); try { input.disconnect(); output.disconnect(); } catch { } } };
}
