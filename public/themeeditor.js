// Editor de tema em painel lateral: prévia ao vivo no app, cores do gradiente, direção, intensidade, "Surpreenda-me".
import { h, icon } from './util.js';
import { S, savePrefs, applyTheme, toast, promptBox } from './state.js';
import { gradientCss, paintTheme, encodeTheme, HEX, MAX_COLORS } from './themes.js';

export function shareTheme(t) {
  const code = encodeTheme(t);
  (navigator.clipboard?.writeText(code) || Promise.reject()).then(() => toast('Código copiado — cole no chat ou envie para alguém'), () => promptBox('Código do tema', 'Copie o código', code, 'Fechar'));
}
// salva um tema (novo ou existente) e o aplica
export function saveCustomTheme(t) {
  const list = S.prefs.customThemes = [...(S.prefs.customThemes || [])];
  const same = (x) => x.name === t.name && x.base === t.base && x.angle === t.angle && (x.intensity ?? 50) === (t.intensity ?? 50) && x.colors.join() === t.colors.join();
  const i = list.findIndex(x => t.id ? x.id === t.id : same(x)); // sem id: reaproveita um idêntico (ex.: "Usar tema" duas vezes)
  if (!t.id && i >= 0) t = { ...t, id: list[i].id };
  const v = { ...t, id: t.id || Date.now().toString(36) };
  if (i >= 0) list[i] = v; else list.push(v);
  S.prefs.theme = 'c:' + v.id; savePrefs(); applyTheme();
  return v;
}

// ---------- cores ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexToRgb = (x) => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  const hue = d === 0 ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hue * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
function hsvToRgb(hu, s, v) {
  const f = (n) => { const k = (n + hu / 60) % 6; return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255; };
  return [f(5), f(3), f(1)];
}
const hsvHex = (hu, s, v) => rgbToHex(...hsvToRgb(hu, s, v));

// arrastar com o ponteiro dentro de um elemento: fn(x 0–1, y 0–1)
function drag(el, fn) {
  const at = (e) => { const r = el.getBoundingClientRect(); fn(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)); };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); at(e); const mv = (ev) => at(ev); el.addEventListener('pointermove', mv); el.addEventListener('pointerup', () => el.removeEventListener('pointermove', mv), { once: true }); });
}

// seletor: quadrado saturação×brilho + barra de matiz
function colorPicker(onPick) {
  let hsv = [0, 0, 0];
  const dot = h('i.cp-dot'), sv = h('div.cp-sv', h('div.cp-w'), h('div.cp-b'), dot);
  const hdot = h('i.cp-dot'), hue = h('div.cp-hue', hdot);
  const paint = () => {
    sv.style.background = `hsl(${hsv[0]}, 100%, 50%)`;
    Object.assign(dot.style, { left: hsv[1] * 100 + '%', top: (1 - hsv[2]) * 100 + '%', background: hsvHex(...hsv) });
    Object.assign(hdot.style, { left: hsv[0] / 360 * 100 + '%', background: `hsl(${hsv[0]}, 100%, 50%)` });
  };
  drag(sv, (x, y) => { hsv = [hsv[0], x, 1 - y]; paint(); onPick(hsvHex(...hsv)); });
  drag(hue, (x) => { hsv = [x * 359.9, hsv[1], hsv[2]]; paint(); onPick(hsvHex(...hsv)); });
  return { el: h('div.cp', sv, hue), set: (hex) => { const n = rgbToHsv(...hexToRgb(hex)); if (n[1] === 0 || n[2] === 0) n[0] = hsv[0]; hsv = n; paint(); } };
}

function surprise(base) {
  const h0 = Math.random() * 360, spread = 25 + Math.random() * 70, n = 2 + (Math.random() < .4 ? 1 : 0), dir = Math.random() < .5 ? 1 : -1;
  const colors = Array.from({ length: n }, (_, i) => {
    const hu = (h0 + dir * spread * i / (n - 1) + 360) % 360;
    return base === 'light' ? hsvHex(hu, .12 + Math.random() * .15, .93 + Math.random() * .07) : hsvHex(hu, .5 + Math.random() * .3, .3 + Math.random() * .25);
  });
  return { colors, angle: Math.round(Math.random() * 24) * 15, intensity: 40 + Math.round(Math.random() * 40) };
}

// ---------- painel ----------
export function openThemeEditor(src, { onExit } = {}) {
  document.getElementById('tedit')?.remove();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isMine = !!src?.id && (S.prefs.customThemes || []).some(x => x.id === src.id);
  const initial = { name: 'Meu tema', base: 'dark', colors: ['#3a2a6b', '#0e5c6b'], angle: 160, intensity: 50, ...(src ? clone(src) : {}) };
  if (!isMine) delete initial.id;
  let t = clone(initial), sel = 0, saved = false;
  const root = document.documentElement, settings = document.getElementById('settings');
  settings?.classList.add('hidden');

  const preview = () => { root.dataset.theme = t.base; paintTheme(root, t); };
  const cp = colorPicker((hex) => { t.colors[sel] = hex; hexIn.value = hex.toUpperCase(); drawColors(); preview(); });
  const hexIn = h('input.hexin', { maxLength: 7, spellcheck: false, oninput: () => { let v = hexIn.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (HEX.test(v)) { t.colors[sel] = v.toLowerCase(); cp.set(v); drawColors(); preview(); } } });
  const swatch = h('i.hexsw');
  const eyedrop = window.EyeDropper && h('button.ibtn', { title: 'Pegar cor da tela', onclick: async () => { try { const r = await new window.EyeDropper().open(); select(sel, r.sRGBHex); } catch { } } }, icon('pipette', 16));
  const removeBtn = h('button.ibtn', { title: 'Remover esta cor', onclick: () => { if (t.colors.length < 2) return; t.colors.splice(sel, 1); select(Math.min(sel, t.colors.length - 1)); preview(); } }, icon('minus', 16));
  const addBtn = h('button.btn.grey.wide', { onclick: () => { if (t.colors.length >= MAX_COLORS) return; t.colors.splice(sel + 1, 0, t.colors[sel]); select(sel + 1); preview(); } }, icon('plus', 18), 'Adicionar cor');
  const bar = h('div.gbar');
  const pos = (i) => (t.colors.length === 1 ? 50 : 10 + 80 * i / (t.colors.length - 1));
  function drawColors() {
    bar.style.background = `linear-gradient(to right, ${t.colors.map((c, i) => `${c} ${pos(i)}%`).join(', ')})`;
    bar.replaceChildren(...t.colors.map((c, i) => h('button.gstop' + (i === sel ? '.on' : ''), { title: `Cor ${i + 1}`, style: { left: pos(i) + '%', background: c }, onclick: () => select(i) })));
    swatch.style.background = t.colors[sel];
    removeBtn.disabled = t.colors.length < 2; addBtn.disabled = t.colors.length >= MAX_COLORS;
  }
  function select(i, hex) {
    sel = i; if (hex) t.colors[i] = hex.toLowerCase();
    cp.set(t.colors[i]); hexIn.value = t.colors[i].toUpperCase(); drawColors(); if (hex) preview();
  }

  // controle deslizante com valor editável ao lado do rótulo
  const control = (label, min, max, key, unit) => {
    const txt = h('input.cval', { onchange: () => { const v = clamp(parseInt(txt.value) || 0, min, max); t[key] = v; sync(); preview(); } });
    const rg = h('input', { type: 'range', min, max, step: 1, oninput: () => { t[key] = +rg.value; txt.value = rg.value + unit; preview(); } });
    const sync = () => { rg.value = t[key]; txt.value = t[key] + unit; };
    sync(); return { el: h('div.tctl', h('div.tlab', h('span', label), txt), rg), sync };
  };
  const dirCtl = control('Direção do gradiente', 0, 360, 'angle', '°'), intCtl = control('Intensidade da cor', 0, 100, 'intensity', '%');
  const pill = h('div.tpills');
  const drawPills = () => pill.replaceChildren(...[['dark', 'moon', 'Escuro'], ['light', 'sun', 'Claro']].map(([k, ic, l]) =>
    h('button' + (t.base === k ? '.on' : ''), { title: l, 'aria-pressed': t.base === k, onclick: () => { t.base = k; drawPills(); preview(); } }, icon(ic, 18), h('span', l))));
  const nameIn = h('input', { value: t.name, maxLength: 40, placeholder: 'Nome do tema', oninput: () => { t.name = nameIn.value; } });
  const refresh = () => { nameIn.value = t.name; drawPills(); dirCtl.sync(); intCtl.sync(); select(Math.min(sel, t.colors.length - 1)); preview(); };

  const exit = () => {
    if (!saved) applyTheme();
    panel.remove(); document.removeEventListener('keydown', esc, true);
    settings?.classList.remove('hidden'); onExit?.();
  };
  const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.backdrop')) { e.stopPropagation(); exit(); } };
  document.addEventListener('keydown', esc, true);

  const sec = (title, ...k) => h('section', h('h5', title), ...k);
  const panel = h('aside#tedit',
    h('header', h('b', isMine ? 'Editar tema' : 'Personalize seu tema'), h('button.ibtn', { title: 'Fechar (Esc)', onclick: exit }, icon('x', 18))),
    h('div.tbody',
      sec('Aparência', pill),
      sec('Cores', bar, cp.el, h('div.hexrow', swatch, hexIn, eyedrop, removeBtn), addBtn),
      sec('Ajustes', dirCtl.el, intCtl.el),
      h('div.tbtns',
        h('button.btn.grey.wide', { title: 'Gera um tema aleatório para servir de ponto de partida', onclick: () => { Object.assign(t, surprise(t.base)); sel = 0; refresh(); } }, icon('sparkle', 18), 'Surpreenda-me'),
        h('button.btn.grey.wide', { onclick: () => { t = clone(initial); sel = 0; refresh(); } }, 'Redefinir'))),
    h('footer', h('label.f', 'Nome', nameIn),
      h('button.btn.wide', { onclick: () => { t.name = t.name.trim() || 'Meu tema'; saveCustomTheme(t); saved = true; toast(`Tema "${t.name}" salvo`); exit(); } }, 'Salvar e usar'),
      h('div.tbtns', h('button.btn.grey.wide', { onclick: () => shareTheme(t) }, 'Copiar código'), h('button.btn.grey.wide', { onclick: exit }, 'Voltar às configurações'))));
  document.getElementById('layer').append(panel);
  refresh();
}
