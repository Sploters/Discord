import { h, icon } from './util.js';
import { toast } from './state.js';

// Editor de código compartilhado da sala: o texto inteiro é sincronizado (último a digitar vence); o cursor de quem recebe é preservado
const LANGS = ['javascript', 'typescript', 'python', 'html', 'css', 'json', 'c', 'cpp', 'java', 'csharp', 'go', 'rust', 'sql', 'texto'];
let send = () => { };
export const initCode = (fn) => { send = fn; };
let text = '', lang = 'javascript', node = null, ta = null, timer = 0;
export const codeSet = (d) => { // estado vindo do servidor ou de outra pessoa
  const old = text; text = d.text ?? ''; lang = d.lang || lang;
  if (!ta) return;
  if (ta.value !== text) {
    const a = ta.selectionStart, b = ta.selectionEnd; let p = 0; const m = Math.min(old.length, text.length);
    while (p < m && old[p] === text[p]) p++;
    let s = 0; while (s < m - p && old[old.length - 1 - s] === text[text.length - 1 - s]) s++;
    const fix = (i) => (i <= p ? i : i >= old.length - s ? i + text.length - old.length : p);
    ta.value = text; ta.setSelectionRange(Math.max(0, fix(a)), Math.max(0, fix(b)));
  }
  node.querySelector('select').value = lang;
};
export const codeReset = () => { text = ''; lang = 'javascript'; node = ta = null; };
const push = () => { clearTimeout(timer); timer = setTimeout(() => send('ROOM_CODE', { text, lang }), 120); };

// o mesmo elemento é reaproveitado entre redesenhos da sala, para não perder o foco, o cursor nem a rolagem
export function codeTile({ onFocus, onClose }) {
  if (node) return node;
  ta = h('textarea.codeta', { spellcheck: false, placeholder: 'Escreva ou cole o código aqui — todos na chamada veem e podem editar.',
    oninput: () => { text = ta.value; push(); },
    onkeydown: (e) => {
      e.stopPropagation();
      if (e.key === 'Tab') { e.preventDefault(); const a = ta.selectionStart; ta.setRangeText('  ', a, ta.selectionEnd, 'end'); text = ta.value; push(); }
    } });
  ta.value = text;
  const sel = h('select', { title: 'Linguagem', onchange: (e) => { lang = e.target.value; push(); } }, LANGS.map(l => h('option', { value: l, selected: l === lang }, l)));
  node = h('div.tile.codetile', { 'data-key': 'code', onclick: (e) => e.stopPropagation() },
    h('div.codebar', icon('code', 16), h('b', 'Editor de código'), sel, h('span.sp'),
      h('button.ibtn', { title: 'Copiar tudo', onclick: () => { navigator.clipboard?.writeText(ta.value); toast('Código copiado'); } }, icon('copy', 16)),
      h('button.ibtn', { title: 'Destacar / voltar à grade', onclick: onFocus }, icon('expand', 16)),
      h('button.ibtn', { title: 'Fechar o editor para todos', onclick: onClose }, icon('x', 16))), ta);
  return node;
}
// redesenha a sala sem tirar o foco do editor
export function keepEditorFocus(fn) {
  const had = ta && document.activeElement === ta, a = ta?.selectionStart, b = ta?.selectionEnd, top = ta?.scrollTop;
  fn();
  if (ta?.isConnected) { ta.scrollTop = top || 0; if (had) { ta.focus({ preventScroll: true }); ta.setSelectionRange(a, b); } }
}
