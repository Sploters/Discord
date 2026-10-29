// Tradução de mensagens: pelo menu da mensagem, antes de enviar (botão do compositor) ou com o prefixo $en, $es, $ja…
import { h, icon } from './util.js';
import { S, api, toast, menu } from './state.js';

export const LANGS = { pt: 'Português', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano', nl: 'Nederlands', pl: 'Polski', ru: 'Русский', uk: 'Українська', tr: 'Türkçe', ar: 'العربية', hi: 'हिन्दी', ja: '日本語', ko: '한국어', 'zh-CN': '中文 (简体)', id: 'Bahasa Indonesia', vi: 'Tiếng Việt' };
export const myLang = () => (LANGS[S.prefs.trLang] ? S.prefs.trLang : (LANGS[(navigator.language || 'pt').split('-')[0]] ? (navigator.language || 'pt').split('-')[0] : 'pt'));

// partes que a tradução não pode mexer: menções, emojis do servidor, links, código
const KEEP = /<@[^>]+>|<:\w+:[^>]+>|@everyone|https?:\/\/\S+|`[^`\n]+`/g;
export async function translateText(text, to, from = 'auto') {
  const keep = [];
  const src = text.replace(KEEP, (t) => `{{${keep.push(t) - 1}}}`);
  const r = await api('POST', '/translate', { text: src, to, from });
  let out = r.text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, i) => keep[+i] ?? '');
  keep.forEach((t, i) => { if (!text.includes(t) || out.includes(t)) return; out += ' ' + t; }); // o tradutor engoliu algum trecho: devolve ao fim
  return { text: out, from: r.from };
}

// ---- mensagens recebidas: traduções ficam só neste navegador ----
const shown = new Map(); // id da mensagem -> { src, text, from, to }
export const isTranslated = (m) => shown.get(m.id)?.src === m.content;
export async function toggleTranslation(m, refresh) {
  if (isTranslated(m)) { shown.delete(m.id); return refresh(m); }
  try {
    const to = myLang(), r = await translateText(m.content, to);
    if (r.from === to) return toast('A mensagem já está no seu idioma');
    shown.set(m.id, { src: m.content, text: r.text, from: r.from, to }); refresh(m);
  } catch (e) { toast('Não foi possível traduzir: ' + e.message, true); }
}
// bloco exibido sob a mensagem; render(texto) devolve o corpo já formatado
export function translationBlock(m, render) {
  const t = shown.get(m.id); if (!t || t.src !== m.content) return null;
  return h('div.trans', h('div.tl', icon('translate', 12), `Traduzido de ${LANGS[t.from] || t.from} para ${LANGS[t.to] || t.to}`), render(t.text));
}

// ---- mensagens que você envia ----
const PREFIX = /^\$([a-z]{2,3}(?:-[A-Z]{2})?)\s+([\s\S]+)$/;
// "$en olá" -> traduz para inglês antes de enviar. Devolve null se não houver prefixo de idioma.
export async function translateOutgoing(content) {
  const m = content.match(PREFIX); if (!m || !LANGS[m[1]]) return null;
  const r = await translateText(m[2].trim(), m[1]);
  const keepOrig = S.prefs.trSendOriginal && !/[\n|]/.test(m[2]);
  return keepOrig ? `${r.text}\n||${m[2].trim()}||` : r.text;
}
// botão do compositor: traduz o rascunho para o idioma escolhido
export function draftMenu(e, ta) {
  menu(e, Object.entries(LANGS).map(([k, l]) => ({ label: `Traduzir rascunho → ${l}`, fn: async () => {
    if (!ta.value.trim()) return toast('Escreva algo para traduzir');
    try { const r = await translateText(ta.value, k); ta.value = r.text; ta.dispatchEvent(new Event('input')); ta.focus(); }
    catch (err) { toast('Não foi possível traduzir: ' + err.message, true); }
  } })));
}
