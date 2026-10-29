// Nomes de canais mais legíveis: "bate-papo_geral" → "Bate Papo Geral" (só na exibição; o nome salvo não muda).
import { S } from './state.js';

export const DEFAULT_NAME_WORDS = 'e, de, do, da, dos, das, em, no, na, com, FAQ, VC, RPG, PvP, GitHub, YouTube, LoL';
const EMOJI = /(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator})(️|‍|\p{Emoji_Modifier}|\p{Extended_Pictographic})*/gu;

const words = () => new Map((S.prefs.chNameWords ?? DEFAULT_NAME_WORDS).split(',').map(w => w.trim()).filter(Boolean).map(w => [w.toLowerCase(), w]));
const enabled = (p) => p.chCaps || p.chDashes || p.chNoEmoji;

// formata um nome qualquer segundo as preferências (usado também na prévia das configurações)
export function prettyName(name, p = S.prefs) {
  let s = String(name ?? '');
  if (!enabled(p)) return s;
  if (p.chNoEmoji) s = s.replace(EMOJI, '');
  if (p.chDashes) s = s.replace(/[-_]+/g, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (p.chCaps) {
    const w = words();
    s = s.split(' ').map((x, i) => {
      const o = w.get(x.toLowerCase());
      if (o) return i === 0 && o === o.toLowerCase() ? o[0].toUpperCase() + o.slice(1) : o; // conectivo no início também ganha maiúscula
      return x ? x[0].toLocaleUpperCase('pt-BR') + x.slice(1) : x;
    }).join(' ');
  }
  return s || String(name ?? ''); // nunca deixa o nome vazio (ex.: canal só de emoji)
}

// nome de exibição de um canal: canais de voz só mudam se "também em canais de voz" estiver ligado
export const chName = (c) => (!c ? '' : c.type === 2 && !S.prefs.chNamesVoice ? c.name : prettyName(c.name));
