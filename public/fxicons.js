// Ícones dos efeitos de voz: sólidos, cantos arredondados e recortes vazados (estilo "glyph").
// Cada ícone é uma lista de partes num quadro 24x24: { d } preenchido (recortes por evenodd) ou { d, w } em traço.
// Opcional t: transform do grupo inteiro (ex.: o megafone é desenhado reto e girado).
const C = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const E = (cx, cy, rx, ry) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
const R = (x, y, w, hh, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${hh - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(hh - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;

export const FXI = {
  // sem efeito: círculo cortado
  none: [{ d: C(12, 12, 10) + C(12, 12, 7.3) }, { d: 'M7.2 5.4 18.6 16.8 16.8 18.6 5.4 7.2Z' }],
  // robô: cabeça com antena, olhos e boca vazados, orelhas
  robo: [
    { d: C(12, 2.9, 1.6) },
    { d: R(11.25, 3.8, 1.5, 3.6, 0.5) },
    { d: R(4, 7.6, 16, 13, 3.2) + C(8.8, 12.6, 1.9) + C(15.2, 12.6, 1.9) + R(8.4, 16.3, 7.2, 1.7, 0.85) },
    { d: R(1.3, 11.2, 1.8, 5.4, 0.9) }, { d: R(20.9, 11.2, 1.8, 5.4, 0.9) },
  ],
  // voz grossa: urso
  grossa: [
    { d: C(5.6, 5.6, 2.9) + C(5.2, 5.2, 1.2) }, { d: C(18.4, 5.6, 2.9) + C(18.8, 5.2, 1.2) },
    { d: C(12, 13, 8.6) + C(8.6, 11.2, 1.3) + C(15.4, 11.2, 1.3) + E(12, 16.2, 4, 3.1) + E(12, 14.9, 1.7, 1.15) + R(11.4, 15.4, 1.2, 2.4, 0.6) },
  ],
  // esquilo: sentado, com o rabo enrolado separado do corpo
  esquilo: [
    { d: 'M4.6 21.2h8.6c.9-2.8.5-5.6-1.1-7.8.7-1.5.7-3.1-.2-4.4l-.4-2.9-1.5 1.9c-1.6-.4-3.2.3-4 1.6L3.9 10.6c-.4.9.3 1.8 1.4 1.7 1 1 2 1.4 2.9 1.5-1.5 1.5-2.4 3.4-2.2 5.6-.7.4-1.4 1-1.4 1.8Z' + C(8.2, 10.5, 0.75) },
    { d: 'M14.4 21.2c4.9-.3 7.6-3.6 7.6-8 0-2.6-1.2-4.2-1-6.6.2-2.5-1.5-4.1-3.8-4.1-2.5 0-4 2.1-3.4 4.1.6 2 2.6 2.6 3.6 3.2 1 .8.8 2.4 0 3.8-1 1.8-2.4 3.4-2.8 5.4Z' },
  ],
  // monstro: chifres, olhos bravos e boca com presas
  monstro: [
    { d: 'M5.4 10.4C3.3 8.5 2.8 5.3 3.7 2.4c1.1 2.6 3.2 4.3 5.4 5.3Z' }, { d: 'M18.6 10.4c2.1-1.9 2.6-5.1 1.7-8-1.1 2.6-3.2 4.3-5.4 5.3Z' },
    { d: R(4.4, 7.4, 15.2, 14, 4.4) + 'M7.2 11.2l3.9 1.4-.3 1.7c-1.6.4-3-.2-3.6-1.4Z' + 'M16.8 11.2l-3.9 1.4.3 1.7c1.6.4 3-.2 3.6-1.4Z' + 'M7.4 16h9.2c-.3 2.5-2.1 3.6-4.6 3.6S7.7 18.5 7.4 16Z' + 'M9 16h1.5l-.75 1.7Z' + 'M13.5 16H15l-.75 1.7Z' },
  ],
  // alien: cabeça de gota invertida, olhos amendoados vazados
  alien: [{ d: 'M12 1.8c5 0 8.6 3.6 8.6 8.6 0 4.6-4.9 9.4-7.1 10.9a2.6 2.6 0 0 1-3 0C8.3 19.8 3.4 15 3.4 10.4 3.4 5.4 7 1.8 12 1.8Z' + 'M5.5 11.4c2.4-.4 4.7.7 5.1 2.6.3 1.3-.2 1.8-1 1.7-2.2-.3-3.8-1.8-4.3-3.4-.1-.5 0-.8.2-.9Z' + 'M18.5 11.4c-2.4-.4-4.7.7-5.1 2.6-.3 1.3.2 1.8 1 1.7 2.2-.3 3.8-1.8 4.3-3.4.1-.5 0-.8-.2-.9Z' }],
  // rádio: antena, tampa e corpo com alto-falante e botões vazados
  radio: [
    { d: 'M3.6 7.4 19.9 3.3', w: 1.7 },
    { d: 'M2.4 9.6a2.6 2.6 0 0 1 2.6-2.6h14a2.6 2.6 0 0 1 2.6 2.6v1H2.4Z' },
    { d: R(2.4, 11.9, 19.2, 8.9, 2.2) + C(8, 16.35, 3.1) + C(8, 16.35, 1.75) + R(13.4, 14.1, 5.2, 1.5, 0.75) + R(13.4, 17.1, 5.2, 1.5, 0.75) },
  ],
  // megafone: corpo, aro separado, pegador e ondas de som (desenhado reto e girado)
  megafone: {
    t: 'rotate(-26 12 12) translate(.3 .8)',
    parts: [
      { d: 'M2.6 10.2c0-.8.6-1.4 1.4-1.4h1.4c2.6 0 4.8-1.6 6.6-3.6v13.6c-1.8-2-4-3.6-6.6-3.6H4c-.8 0-1.4-.6-1.4-1.4Z' },
      { d: R(13.2, 3.6, 2.6, 16.8, 1.3) },
      { d: 'M5.6 16.1h3l.9 3.2c.3 1.1-.5 2.1-1.6 2.1h-.2c-.8 0-1.4-.5-1.6-1.3Z' },
      { d: 'M18.6 8.4l1.8-1.3M19.3 12h2.3M18.6 15.6l1.8 1.3', w: 1.7 },
    ],
  },
  // eco: montanhas com neve e ondas voltando
  eco: [
    { d: 'M1.4 20.6 8.6 8.2l3.5 6 2.6-3.8 7.9 10.2Z' + 'M6.6 12l1.2 1.1.9-1 .9 1 1.1-1.1-.5-.9-1.5-2.7-1.6 2.7Z' },
    { d: 'M15.6 3.6a3.6 3.6 0 0 1 0 5.1M18.2 1.8a6.6 6.6 0 0 1 0 8.6', w: 1.6 },
  ],
  // estádio: arquibancada oval, gramado, faixa e portão, bandeiras
  estadio: [
    { d: 'M5.7 8.3 4.6 2', w: 1.4 }, { d: 'M18.3 8.3 19.4 2', w: 1.4 },
    { d: 'M4.7 1.4 1.2 2l1.1 1.4-.9 1.5 3.7-.6Z' }, { d: 'M19.3 1.4l3.5.6-1.1 1.4.9 1.5-3.7-.6Z' },
    { d: E(12, 10.6, 10, 3.6) + E(12, 10.9, 7.6, 2.5) + E(12, 11.3, 5, 1.4) },
    { d: 'M2 12v4.2c0 2.2 4.5 3.9 10 3.9s10-1.7 10-3.9V12a10 3.6 0 0 1-20 0Z' + 'M9.6 19.7v-1.1a2.4 2.4 0 0 1 4.8 0v1.1c-1.6.2-3.2.2-4.8 0Z' },
  ],
};

// <svg> do efeito (id do FX ou 'none'), na cor do texto
const NS = 'http://www.w3.org/2000/svg';
export function fxIcon(id, size = 20) {
  const def = FXI[id] || FXI.none, d = Array.isArray(def) ? { parts: def } : def;
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'icon fxicon');
  s.style.width = s.style.height = size + 'px';
  const g = d.t ? s.appendChild(document.createElementNS(NS, 'g')) : s; if (d.t) g.setAttribute('transform', d.t);
  for (const p of d.parts) {
    const e = g.appendChild(document.createElementNS(NS, 'path')); e.setAttribute('d', p.d);
    if (p.w) { e.setAttribute('fill', 'none'); e.setAttribute('stroke', 'currentColor'); e.setAttribute('stroke-width', p.w); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round'); }
    else { e.setAttribute('fill', 'currentColor'); e.setAttribute('fill-rule', 'evenodd'); }
  }
  return s;
}
