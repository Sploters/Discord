// Componentes de interface compartilhados (app + configurações)
import { h } from './util.js';
import { SCREEN_PRESETS } from './voice.js';

export const seg = (opts, val, on) => {
  const box = h('div.seg');
  const draw = (v) => box.replaceChildren(...Object.entries(opts).map(([k, l]) => h('button' + (String(k) === String(v) ? '.on' : ''), { onclick: () => { on(isNaN(+k) ? k : +k); draw(k); } }, l)));
  draw(val); return box;
};
export const toggle = (on, fn) => { const s = h('div.switch' + (on ? '.on' : ''), { role: 'switch', tabIndex: 0, onclick: () => { on = !on; s.classList.toggle('on', on); fn(on); }, onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); s.click(); } } }); return s; };
export const row = (title, desc, ctl) => h('div.perm', h('div', h('div.rt', title), desc && h('div.rd', desc)), ctl);
export const section = (t) => h('h3.sec', t);
export const slider = (min, max, value, step, onInput, fmt = (v) => v) => {
  const out = h('span.sval', fmt(value)), r = h('input', { type: 'range', min, max, step, value, oninput: () => { out.textContent = fmt(+r.value); onInput(+r.value); } });
  return h('div.sl', r, out);
};

export const SHARE_PRESETS = [
  ['720p • 30 fps', { res: 720, fps: 30, hint: 'motion' }],
  ['1080p • 30 fps', { res: 1080, fps: 30, hint: 'motion' }],
  ['1080p • 60 fps', { res: 1080, fps: 60, hint: 'motion' }],
  ['1440p • 60 fps', { res: 1440, fps: 60, hint: 'motion' }],
  ['Apresentação (1080p • 15 fps, nítido)', { res: 1080, fps: 15, hint: 'detail' }],
  ['Original • 60 fps', { res: 'source', fps: 60, hint: 'motion' }],
];
export const qualityLabel = (o) => `${o.res === 'source' ? 'Original' : o.res + 'p'} • ${o.fps} fps • ${o.hint === 'detail' ? 'nitidez' : 'movimento'}${o.audio ? ' • com áudio' : ''}`;
export const estMbps = (o) => (({ 720: 2.5, 1080: 5, 1440: 9, source: 10 })[o.res] * (o.fps >= 60 ? 1.6 : o.fps <= 15 ? .6 : 1)).toFixed(1);

// painel de qualidade da transmissão (antes e durante)
export function qualityPanel(o, onChange) {
  const box = h('div.qpanel');
  const draw = () => box.replaceChildren(
    h('div.presets', SHARE_PRESETS.map(([l, p]) => h('button.preset' + (o.res === p.res && o.fps === p.fps && o.hint === p.hint ? '.on' : ''), { onclick: () => { Object.assign(o, p); draw(); onChange?.(o); } }, l))),
    h('label.f', 'Resolução', seg(SCREEN_PRESETS.res, o.res, v => { o.res = v; draw(); onChange?.(o); })),
    h('label.f', 'Taxa de quadros (FPS)', seg(SCREEN_PRESETS.fps, o.fps, v => { o.fps = v; draw(); onChange?.(o); })),
    h('label.f', 'Otimizar para', seg({ motion: 'Movimento (jogos/vídeo)', detail: 'Nitidez (texto/apresentação)' }, o.hint, v => { o.hint = v; draw(); onChange?.(o); })),
    h('div.qinfo', `Taxa de dados estimada: ~${estMbps(o)} Mbps por espectador`));
  draw(); return box;
}

// ---- atalhos de teclado ----
export function comboFromEvent(e) {
  if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code)) return null; // só modificador
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.code].filter(Boolean).join('+');
}
export const comboLabel = (c) => !c ? '—' : c.split('+').map(p => p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, 'Seta ').replace('Backquote', '`').replace('Space', 'Espaço')).join(' + ');
export function comboToAccel(c) {
  if (!c) return '';
  return c.split('+').map(p => p === 'Ctrl' ? 'CommandOrControl' : p.replace(/^Key/, '').replace(/^Digit/, '').replace('Space', 'Space').replace(/^Arrow/, '')).join('+');
}
export function captureKey(button, current, onSet, { combo = true, label = '' } = {}) {
  const paint = (c) => (button.textContent = `${label}${comboLabel(c)}`);
  paint(current);
  button.onclick = () => {
    button.textContent = 'Pressione as teclas… (Esc cancela)'; button.classList.add('capturing');
    const on = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') { button.classList.remove('capturing'); paint(current); return removeEventListener('keydown', on, true); }
      const c = combo ? comboFromEvent(e) : e.code; if (!c) return;
      current = c; onSet(c); button.classList.remove('capturing'); paint(c); removeEventListener('keydown', on, true);
    };
    addEventListener('keydown', on, true);
  };
  return button;
}
