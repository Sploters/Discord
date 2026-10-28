// Sons de interface: sintetizados (sem arquivos) com opção de áudio personalizado por evento.
import { S, savePrefs } from './state.js';

// [frequência, início(s), duração(s), { type, gain, to }]
const N = (f, t, d, o = {}) => [f, t, d, o];
const SYN = {
  mute: [N(560, 0, .13, { to: 330 })],
  unmute: [N(330, 0, .13, { to: 640 })],
  deafen: [N(494, 0, .09, { type: 'triangle' }), N(294, .09, .14, { type: 'triangle' })],
  undeafen: [N(294, 0, .09, { type: 'triangle' }), N(523, .09, .14, { type: 'triangle' })],
  selfJoin: [N(523, 0, .1), N(659, .07, .1), N(784, .14, .2)],
  selfLeave: [N(784, 0, .1), N(659, .07, .1), N(523, .14, .2)],
  join: [N(660, 0, .09), N(880, .09, .16)],
  leave: [N(880, 0, .09), N(587, .09, .16)],
  camOn: [N(600, 0, .16, { to: 900 })],
  camOff: [N(900, 0, .16, { to: 500 })],
  streamStart: [N(392, 0, .12, { type: 'triangle' }), N(587, .1, .12, { type: 'triangle' }), N(784, .2, .22, { type: 'triangle' })],
  streamStop: [N(784, 0, .12, { type: 'triangle' }), N(587, .1, .12, { type: 'triangle' }), N(392, .2, .22, { type: 'triangle' })],
  selfStreamStart: [N(440, 0, .26, { to: 880, type: 'triangle' }), N(880, .24, .16, { type: 'triangle' })],
  selfStreamStop: [N(880, 0, .26, { to: 440, type: 'triangle' })],
  ring: [N(740, 0, .14), N(988, .17, .14), N(740, .6, .14), N(988, .77, .14)],
  message: [N(880, 0, .09, { gain: .6 })],
  mention: [N(988, 0, .1), N(1319, .1, .2)],
  friend: [N(659, 0, .1), N(784, .1, .1), N(988, .2, .2)],
  error: [N(196, 0, .16, { type: 'sawtooth', gain: .5 }), N(165, .18, .2, { type: 'sawtooth', gain: .5 })],
};

export const SOUND_DEFS = {
  mute: ['Microfone silenciado', 'voz'], unmute: ['Microfone ativado', 'voz'],
  deafen: ['Ensurdecido', 'voz'], undeafen: ['Áudio reativado', 'voz'],
  selfJoin: ['Você entrou na chamada', 'voz'], selfLeave: ['Você saiu da chamada', 'voz'],
  join: ['Alguém entrou na chamada', 'voz'], leave: ['Alguém saiu da chamada', 'voz'],
  camOn: ['Câmera ligada (qualquer pessoa)', 'voz'], camOff: ['Câmera desligada (qualquer pessoa)', 'voz'],
  streamStart: ['Alguém começou a transmitir', 'transmissão'], streamStop: ['Alguém parou de transmitir', 'transmissão'],
  selfStreamStart: ['Você começou a transmitir', 'transmissão'], selfStreamStop: ['Você parou de transmitir', 'transmissão'],
  ring: ['Chamada recebida (toque)', 'chat'], mention: ['Menção ou mensagem direta', 'chat'], message: ['Mensagem em outro canal', 'chat'],
  friend: ['Pedido de amizade', 'chat'], error: ['Erro', 'chat'],
};
const OFF_BY_DEFAULT = new Set(['message', 'error']);

export const soundCfg = (name) => {
  const all = (S.prefs.soundCfg ||= {});
  return (all[name] ||= { on: !OFF_BY_DEFAULT.has(name), vol: 100, url: null });
};

let ctx; const cache = new Map();
function getCtx() {
  if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
  ctx.resume?.();
  if (S.prefs.outputId && ctx.setSinkId && ctx._sink !== S.prefs.outputId) { ctx._sink = S.prefs.outputId; ctx.setSinkId(S.prefs.outputId).catch(() => { }); }
  return ctx;
}
export function playSound(name, { force = false } = {}) {
  try {
    const cfg = soundCfg(name);
    if (!force && (!cfg.on || S.prefs.soundsMuted)) return;
    const vol = (S.prefs.soundVolume ?? 80) / 100 * (cfg.vol ?? 100) / 100;
    if (vol <= 0) return;
    if (cfg.url) {
      let a = cache.get(cfg.url); if (!a) cache.set(cfg.url, a = new Audio(cfg.url));
      const c = a.cloneNode(); c.volume = Math.min(1, vol); if (S.prefs.outputId && c.setSinkId) c.setSinkId(S.prefs.outputId).catch(() => { }); c.play().catch(() => { }); return;
    }
    const c = getCtx(), spec = SYN[name]; if (!spec) return;
    const out = c.createGain(); out.gain.value = vol * .35; out.connect(c.destination);
    for (const [f, t, d, o] of spec) {
      const osc = c.createOscillator(), g = c.createGain(), at = c.currentTime + t;
      osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, at);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + d);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(o.gain || 1, at + .012); g.gain.exponentialRampToValueAtTime(0.0001, at + d);
      osc.connect(g).connect(out); osc.start(at); osc.stop(at + d + .02);
    }
  } catch { /* som é opcional */ }
}
export { savePrefs };
