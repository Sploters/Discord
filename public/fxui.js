// Efeitos de voz (interface): escolher o efeito, ouvir a própria voz com ele, indicador de quem está usando.
import { h, icon } from './util.js';
import { S, popout, savePrefs, closeFloating } from './state.js';
import { FX, fxInfo } from './voicefx.js';
import { toggle } from './ui.js';

// selinho ao lado do nome de quem está com efeito (para todo mundo saber que a voz não é a normal)
export const fxBadge = (fx) => { const f = fxInfo(fx); return f ? h('span.fxb', { title: `Efeito de voz: ${f.label}` }, f.emoji) : null; };

export function openFxPicker(anchor, voice, opts = {}) {
  const draw = () => box.replaceChildren(
    h('div.fxhead', h('b', 'Efeitos de voz'), h('small', 'Quem ouve pode desligar os efeitos só para si.')),
    h('div.fxgrid',
      h('button.fxopt' + (!voice.fx ? '.on' : ''), { onclick: () => { voice.setFx(null); draw(); } }, h('span.fxe', '🙂'), h('span', 'Sem efeito')),
      FX.map(f => h('button.fxopt' + (voice.fx === f.id ? '.on' : ''), { onclick: () => { voice.setFx(voice.fx === f.id ? null : f.id); draw(); } }, h('span.fxe', f.emoji), h('span', f.label)))),
    h('div.fxrow', h('div', h('div', 'Ouvir minha voz'), h('small', 'Use fone para não dar eco.')), toggle(!!voice.monitorOn, (v) => voice.setMonitor(v))),
    h('div.fxrow', h('div', h('div', 'Ouvir efeitos dos outros'), h('small', 'Desligado: você ouve todos sem efeito.')), toggle(S.prefs.hearFx !== false, (v) => { S.prefs.hearFx = v; savePrefs(); for (const uid of voice.peers.keys()) voice.applyVolume(uid); })),
    h('div.fxfoot', 'Atalho para ligar/desligar o último efeito: ', h('kbd', 'Ctrl + Shift + E'), opts.openSettings && h('a', { href: '#', onclick: (e) => { e.preventDefault(); closeFloating(); opts.openSettings('keys'); } }, ' mudar')));
  const box = h('div.fxpicker');
  draw();
  popout(anchor, box, 'right');
  const el = box.closest('.popout');
  if (el) { const r = anchor.getBoundingClientRect(), w = el.getBoundingClientRect(); el.style.top = Math.max(8, Math.min(r.top - w.height - 8, innerHeight - w.height - 8)) + 'px'; el.style.left = Math.max(8, Math.min(r.left, innerWidth - w.width - 8)) + 'px'; }
}
