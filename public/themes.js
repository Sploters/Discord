// Temas em gradiente: prontos e criados pelo usuário (compartilháveis por código).
// Valores de S.prefs.theme: 'dark' | 'darker' | 'midnight' | 'light' (sólidos), 'g:<id>' (pronto) ou 'c:<id>' (do usuário).

export const SOLID_THEMES = { dark: 'Escuro', darker: 'Preto (AMOLED)', midnight: 'Meia-noite', light: 'Claro' };
export const GRADIENT_THEMES = {
  aurora: { name: 'Aurora', base: 'dark', colors: ['#0f5c4f', '#2a1f6b'], angle: 160 },
  ocean: { name: 'Oceano', base: 'dark', colors: ['#0a2a4a', '#0e5c6b'], angle: 180 },
  forest: { name: 'Floresta', base: 'dark', colors: ['#142b1d', '#3c5a2a'], angle: 150 },
  sunset: { name: 'Pôr do sol', base: 'dark', colors: ['#48254f', '#b4513a'], angle: 200 },
  dusk: { name: 'Crepúsculo', base: 'dark', colors: ['#1d1b3a', '#6b3a5c'], angle: 135 },
  crimson: { name: 'Lua carmesim', base: 'dark', colors: ['#2a0b10', '#6b1424'], angle: 170 },
  neon: { name: 'Neon', base: 'dark', colors: ['#3a0d5c', '#0b4d6b', '#5c0d4a'], angle: 120 },
  sepia: { name: 'Sépia', base: 'dark', colors: ['#2b2219', '#4a3a28'], angle: 180 },
  lavender: { name: 'Lavanda', base: 'light', colors: ['#e6dcff', '#ffd9ec'], angle: 135 },
  mint: { name: 'Menta', base: 'light', colors: ['#d6f5e8', '#dbeafe'], angle: 160 },
  candy: { name: 'Algodão-doce', base: 'light', colors: ['#ffd6e8', '#d6e4ff'], angle: 120 },
  peach: { name: 'Pêssego', base: 'light', colors: ['#ffe1cc', '#fff3c4'], angle: 180 },
  // agentes do Valorant (seção própria em Aparência; group separa da lista principal)
  v_jett: { name: 'Jett', group: 'valorant', base: 'light', colors: ['#ffffff', '#2eb6de'], angle: 135 },
  v_phoenix: { name: 'Phoenix', group: 'valorant', base: 'dark', colors: ['#1b2a4a', '#f26b1d'], angle: 135 },
  v_reyna: { name: 'Reyna', group: 'valorant', base: 'dark', colors: ['#111118', '#6a00ff'], angle: 135 },
  v_raze: { name: 'Raze', group: 'valorant', base: 'dark', colors: ['#22c3a6', '#f36a2d'], angle: 135 },
  v_breach: { name: 'Breach', group: 'valorant', base: 'light', colors: ['#d9b48a', '#f38b2f'], angle: 135 },
  v_sova: { name: 'Sova', group: 'valorant', base: 'dark', colors: ['#c9b38b', '#2c4e80'], angle: 135 },
  v_neon: { name: 'Neon', group: 'valorant', base: 'light', colors: ['#ffd84a', '#1b56ff'], angle: 135 },
  v_yoru: { name: 'Yoru', group: 'valorant', base: 'dark', colors: ['#111827', '#1e3a8a'], angle: 135 },
  v_sage: { name: 'Sage', group: 'valorant', base: 'dark', colors: ['#1b2e3a', '#1fbfa6'], angle: 135 },
  v_astra: { name: 'Astra', group: 'valorant', base: 'dark', colors: ['#1e1b2e', '#6b3fa0'], angle: 135 },
  v_harbor: { name: 'Harbor', group: 'valorant', base: 'dark', colors: ['#2cc7b2', '#0b3b6e'], angle: 135 },
  v_brimstone: { name: 'Brimstone', group: 'valorant', base: 'dark', colors: ['#b8b1a6', '#d35a2a'], angle: 135 },
  v_gekko: { name: 'Gekko', group: 'valorant', base: 'light', colors: ['#b6f552', '#f2a23a'], angle: 135 },
  v_omen: { name: 'Omen', group: 'valorant', base: 'dark', colors: ['#1b1533', '#7b4cff'], angle: 135 },
  v_viper: { name: 'Viper', group: 'valorant', base: 'dark', colors: ['#111214', '#00ff9a'], angle: 135 },
  v_kayo: { name: 'KAY/O', group: 'valorant', base: 'light', colors: ['#c7d0da', '#2e86ff'], angle: 135 },
  v_skye: { name: 'Skye', group: 'valorant', base: 'dark', colors: ['#c39a5a', '#2f6b3f'], angle: 135 },
  v_deadlock: { name: 'Deadlock', group: 'valorant', base: 'dark', colors: ['#b7c1d6', '#1f2c5c'], angle: 135 },
  v_clove: { name: 'Clove', group: 'valorant', base: 'light', colors: ['#7a3cff', '#d9d6e8'], angle: 135 },
  v_iso: { name: 'Iso', group: 'valorant', base: 'dark', colors: ['#673db4', '#8e84d0'], angle: 135 },
  v_fade: { name: 'Fade', group: 'valorant', base: 'dark', colors: ['#020d1f', '#f11c1b'], angle: 135 },
  v_miks: { name: 'Miks', group: 'valorant', base: 'light', colors: ['#bfdaa0', '#9ca7f9'], angle: 135 },
  v_tejo: { name: 'Tejo', group: 'valorant', base: 'light', colors: ['#fff673', '#feac84'], angle: 135 },
  v_cypher: { name: 'Cypher', group: 'valorant', base: 'dark', colors: ['#948a7f', '#192c57'], angle: 135 },
  v_killjoy: { name: 'Killjoy', group: 'valorant', base: 'light', colors: ['#ffff5d', '#e631ea'], angle: 135 },
  v_waylay: { name: 'Waylay', group: 'valorant', base: 'light', colors: ['#d3b7f5', '#d5f297'], angle: 135 },
  v_vyse: { name: 'Vyse', group: 'valorant', base: 'dark', colors: ['#d7d4d8', '#7545c4'], angle: 135 },
  v_veto: { name: 'Veto', group: 'valorant', base: 'dark', colors: ['#0072a4', '#0e0a12'], angle: 135 },
  v_chamber: { name: 'Chamber', group: 'valorant', base: 'light', colors: ['#ffe950', '#ce3d86'], angle: 135 },
  v_hush: { name: 'Hush', group: 'valorant', base: 'light', colors: ['#faa4ff', '#ff53bd'], angle: 135 },
};

export const HEX = /^#[0-9a-f]{6}$/i;
export const MAX_COLORS = 5;
// mantém o matiz e traz o brilho para a faixa legível da base: pastel no claro, fundo no escuro
export function fitColor(hex, base) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let l = (mx + mn) / 2, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const hue = !d ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  [l, s] = base === 'light' ? [Math.min(.96, Math.max(.82, l)), Math.min(s, .85)] : [Math.min(.45, Math.max(.08, l)), s];
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(hue % 2 - 1)), m = l - c / 2;
  const [R, G, B] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hue) % 6];
  return '#' + [R, G, B].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}
const shown = (t) => t.colors.map(c => fitColor(c, t.base));
export const gradientCss = (t) => `linear-gradient(${t.angle ?? 180}deg, ${shown(t).join(', ')})`;
export function themeDef(id, custom = []) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('g:')) return GRADIENT_THEMES[id.slice(2)] || null;
  if (id.startsWith('c:')) return custom.find(t => t.id === id.slice(2)) || null;
  return null;
}

// superfícies opacas tingidas pela cor média do gradiente (modais, menus, campos)
const SURFACES = {
  dark: { 'bg-tert': ['30%', '#0b0c0e'], 'bg-sec': ['26%', '#17181b'], 'bg-pri': ['22%', '#1f2023'], 'bg-user': ['30%', '#111214'], 'bg-input': ['20%', '#2a2c31'],
    'bg-float': ['25%', '#0e0f11'], 'bg-mod-hover': ['20%', '#2e3035'], 'bg-mod-sel': ['25%', '#3a3c42'], divider: ['30%', '#3f4147'], scroll: ['30%', '#0b0c0e'] },
  light: { 'bg-tert': ['45%', '#e3e5e8'], 'bg-sec': ['35%', '#f2f3f5'], 'bg-pri': ['25%', '#ffffff'], 'bg-user': ['45%', '#ebedef'], 'bg-input': ['45%', '#e3e5e8'],
    'bg-float': ['20%', '#ffffff'], 'bg-mod-hover': ['45%', '#ebedef'], 'bg-mod-sel': ['50%', '#d7d9dc'], divider: ['50%', '#d7d9dc'], scroll: ['60%', '#c1c3c7'] },
};
const VARS = [...Object.keys(SURFACES.dark), 'grad', 'gi'];
export function paintTheme(root, t) {
  root.classList.toggle('grad', !!t);
  for (const k of VARS) root.style.removeProperty('--' + k);
  if (!t) return;
  const cs = shown(t), avg = cs.length > 1 ? `color-mix(in srgb, ${cs[0]}, ${cs.at(-1)})` : cs[0];
  // intensidade 0–100 (50 = padrão): quanto a cor tinge as superfícies e o quanto o gradiente aparece atrás dos painéis
  const k = (t.intensity ?? 50) / 50;
  for (const [v, [pct, base]] of Object.entries(SURFACES[t.base] || SURFACES.dark)) root.style.setProperty('--' + v, `color-mix(in srgb, ${avg} ${Math.min(90, Math.round(parseFloat(pct) * k))}%, ${base})`);
  root.style.setProperty('--grad', gradientCss(t)); root.style.setProperty('--gi', (1.5 - k / 2).toFixed(2));
}

// código para compartilhar: "localcord-theme:" + base64url(JSON)
const PREFIX = 'localcord-theme:';
export const THEME_CODE_RE = /localcord-theme:[A-Za-z0-9_-]{8,600}/;
export function encodeTheme(t) {
  const json = JSON.stringify({ n: t.name, b: t.base, c: t.colors, a: t.angle, i: t.intensity ?? 50 });
  return PREFIX + btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// mensagens com tema: o código fica escondido; em textos curtos (resposta, notificação) vira 🎨 Tema "Nome"
const CODE_G = new RegExp(THEME_CODE_RE.source, 'g');
export const stripThemeCodes = (s) => String(s || '').replace(CODE_G, '').trim();
export const themeText = (s) => String(s || '').replace(CODE_G, (c) => { const t = decodeTheme(c); return t ? `🎨 Tema "${t.name}"` : c; });
export function decodeTheme(code) {
  try {
    const raw = String(code).trim().match(THEME_CODE_RE)?.[0].slice(PREFIX.length); if (!raw) return null;
    const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
    const colors = Array.isArray(o.c) ? o.c.filter(c => HEX.test(c)).slice(0, MAX_COLORS) : [];
    if (!colors.length) return null;
    return { name: String(o.n || 'Tema compartilhado').slice(0, 40), base: o.b === 'light' ? 'light' : 'dark', colors, angle: Math.max(0, Math.min(360, +o.a || 180)), intensity: Math.max(0, Math.min(100, o.i ?? 50)) };
  } catch { return null; }
}

// ---------- temas de perfil: gradiente vertical da cor principal para a de destaque ----------
// Os marcados com "dt" vieram do discordthemes.com (cores compartilhadas pela comunidade).
export const PROFILE_THEMES = [
  { name: 'Yabba dabba', p: '#53aba9', a: '#2f4451', dt: true },
  { name: 'Light Pastel Pink', p: '#b884b3', a: '#593566', dt: true },
  { name: 'Black & Pastel Green', p: '#0b0c0d', a: '#93e9be', dt: true },
  { name: 'Black and Red', p: '#000000', a: '#ff0000', dt: true },
  { name: 'A T M O I C', p: '#000000', a: '#6f2da8', dt: true },
  { name: 'Koa', p: '#ff0063', a: '#ff0063', dt: true },
  { name: 'Turquesa', p: '#118a95', a: '#3eabb0', dt: true },
  { name: 'Grafite', p: '#0d0d0d', a: '#434343', dt: true },
  { name: 'Aurora', p: '#0f5c4f', a: '#2a1f6b' },
  { name: 'Pôr do sol', p: '#f5a25d', a: '#8e3b75' },
  { name: 'Céu', p: '#a8d8ff', a: '#5865f2' },
  { name: 'Algodão-doce', p: '#ffd6e8', a: '#b9c8ff' },
];
// acha as duas primeiras cores hex num texto qualquer (ex.: copiado do discordthemes.com)
export function parseColorPair(text) {
  const m = String(text).match(/#?\b[0-9a-f]{6}\b/gi) || [];
  const cs = m.map(c => '#' + c.replace('#', '').toLowerCase());
  return cs.length ? [cs[0], cs[1] || cs[0]] : null;
}
// luminância média das duas cores: decide se o texto do cartão é escuro ou claro
export function isLightPair(p, a) {
  const lum = (x) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16) / 255).map(v => (v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)); return .2126 * r + .7152 * g + .0722 * b; };
  return (lum(p) + lum(a)) / 2 > .4;
}

// ---------- estilo do nome (fonte, efeito e cores) ----------
export const NAME_FONTS = { default: 'Padrão', serif: 'Clássica', mono: 'Código', rounded: 'Arredondada', script: 'Cursiva', display: 'Impacto', comic: 'Gibi', type: 'Máquina' };
export const NAME_EFFECTS = { solid: 'Sólido', gradient: 'Gradiente', neon: 'Neon', toon: 'Contorno', pop: 'Sombra 3D', shimmer: 'Brilho', rainbow: 'Arco-íris' };
export const TWO_COLOR_EFFECTS = new Set(['gradient', 'neon', 'toon', 'pop', 'shimmer']);
// aplica o estilo do usuário num elemento de nome (sobrepõe a cor do cargo)
export function styleName(el, ns) {
  if (!ns || !el) return el;
  el.classList.add('ns', 'nf-' + (NAME_FONTS[ns.font] ? ns.font : 'default'), 'ne-' + (NAME_EFFECTS[ns.effect] ? ns.effect : 'solid'));
  el.style.color = '';
  el.style.setProperty('--n1', ns.c1 || '#ffffff'); el.style.setProperty('--n2', ns.c2 || ns.c1 || '#ffffff');
  return el;
}
