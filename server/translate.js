// Tradução de mensagens. O servidor repassa o texto a um mecanismo externo (o cliente nunca fala com ele).
//   TRANSLATE=0                 desliga o recurso
//   LIBRETRANSLATE_URL=...      usa uma instância LibreTranslate (pode ser local; LIBRETRANSLATE_KEY opcional)
//   sem LIBRETRANSLATE_URL      usa o endpoint público não oficial do Google Tradutor (o texto sai do servidor)
const URL_LT = (process.env.LIBRETRANSLATE_URL || '').replace(/\/$/, '');
const KEY_LT = process.env.LIBRETRANSLATE_KEY || '';
export const translateEnabled = process.env.TRANSLATE !== '0';
export const engineName = URL_LT ? 'libretranslate' : 'google';

const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const cache = new Map(); // chave -> { at, v }

async function viaGoogle(text, to, from) {
  const u = new URL('https://translate.googleapis.com/translate_a/single');
  u.search = new URLSearchParams({ client: 'gtx', sl: from || 'auto', tl: to, dt: 't', q: text }).toString();
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('O tradutor recusou o pedido (' + r.status + ')');
  const j = await r.json();
  return { text: (j[0] || []).map(s => s[0]).join(''), from: j[2] || from || 'auto' };
}
async function viaLibre(text, to, from) {
  const r = await fetch(URL_LT + '/translate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ q: text, source: from || 'auto', target: to.split('-')[0], format: 'text', api_key: KEY_LT || undefined }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'O tradutor recusou o pedido (' + r.status + ')');
  return { text: j.translatedText, from: j.detectedLanguage?.language || from || 'auto' };
}

export async function translate(text, to, from) {
  text = String(text || '').slice(0, 4000);
  if (!text.trim()) throw new Error('Nada para traduzir');
  if (!LANG.test(to)) throw new Error('Idioma inválido');
  if (from && from !== 'auto' && !LANG.test(from)) from = 'auto';
  const key = `${to}|${from || ''}|${text}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3600e3) return hit.v;
  const v = await (URL_LT ? viaLibre : viaGoogle)(text, to, from);
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return v;
}
