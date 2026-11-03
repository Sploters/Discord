// Modo leve: um botão que desliga o que pesa na CPU/GPU (bom para jogar com o app aberto) e lembra os valores anteriores para desfazer.
import { h } from './util.js';
import { S, savePrefs, applyTheme, toast, desktop } from './state.js';
import { toggle, row, section } from './ui.js';
import { refreshFreeze } from './freeze.js';
import { stopAllBuffers } from './clips.js';

const HEAVY_NOISE = ['rnnoise', 'gtcrn'];
const scr = () => ({ res: 1080, fps: 30, hint: 'motion', audio: true, ...S.prefs.screen });
// cada item: valor leve a partir do valor atual (undefined = já está leve) e descrição para a lista
const ITEMS = [
  { key: 'animations', lite: (v) => (v !== false ? false : undefined), title: 'Animações da interface', desc: 'Sem transições ao trocar de canal, abrir janelas e receber mensagens.' },
  { key: 'animMode', lite: (v) => ((v || 'always') !== 'never' ? 'never' : undefined), title: 'Avatares e banners animados', desc: 'GIFs ficam parados (decodificar animações gasta CPU o tempo todo).' },
  { key: 'noiseMode', lite: (v) => (HEAVY_NOISE.includes(v) ? 'standard' : undefined), title: 'Redução de ruído leve', desc: 'Troca a redução por IA (RNNoise/GTCRN) pela do navegador, bem mais leve. Cancelamento de eco e ganho automático continuam: custam quase nada e evitam eco na chamada.' },
  { key: 'clipsOn', lite: (v) => (v !== false ? false : undefined), title: 'Gravação de clipes em segundo plano', desc: 'Para de gravar os últimos 60 s das transmissões que você assiste.' },
  { key: 'screen', lite: (v) => { const o = { res: 1080, fps: 30, ...v }; return o.res === 'source' || o.res > 720 || o.fps > 30 ? { ...scr(), res: 720, fps: 30 } : undefined; }, title: 'Transmissão em 720p • 30 fps', desc: 'Valor inicial ao transmitir a tela (dá para mudar na hora). Codificar menos pixels deixa mais folga para o jogo.' },
];
if (desktop) ITEMS.push({ key: null, title: 'Economia em segundo plano', desc: 'Com o app minimizado e fora de chamada, o Windows pode desacelerar o LocalCord.' });

export const liteOn = () => !!S.prefs.lightMode;

// app desktop: deixa o Chromium desacelerar a página escondida, mas nunca durante uma chamada (timers da voz)
let throttled = null;
export function syncThrottle(inCall) {
  const on = liteOn() && !inCall;
  if (on === throttled || !desktop?.setThrottle) return;
  throttled = on; desktop.setThrottle(on);
}

export function setLite(on, voice) {
  const P = S.prefs, prevNoise = P.noiseMode;
  if (on === liteOn()) return;
  if (on) {
    const prev = {}, applied = {};
    for (const it of ITEMS) { if (!it.key) continue; const v = it.lite(P[it.key]); if (v === undefined) continue; prev[it.key] = P[it.key] ?? null; P[it.key] = applied[it.key] = v; }
    P.lightPrev = { prev, applied };
  } else {
    // só desfaz o que continua como o modo leve deixou (se você mudou algo depois, fica como você mudou)
    const { prev = {}, applied = {} } = P.lightPrev || {};
    for (const k of Object.keys(prev)) if (JSON.stringify(P[k]) === JSON.stringify(applied[k])) { if (prev[k] === null) delete P[k]; else P[k] = prev[k]; }
    delete P.lightPrev;
  }
  P.lightMode = on; savePrefs(); applyTheme(); refreshFreeze();
  if (P.clipsOn === false) stopAllBuffers();
  if (voice?.active && P.noiseMode !== prevNoise) voice.rebuildMic();
  syncThrottle(!!voice?.active);
  toast(on ? 'Modo leve ativado' : 'Modo leve desativado: configurações anteriores de volta');
}

export function litePage(ctx) {
  const box = h('div');
  const draw = () => {
    const on = liteOn(), applied = S.prefs.lightPrev?.applied || {};
    box.replaceChildren(
      h('div.card2.litehero' + (on ? '.on' : ''),
        h('div', h('div.rt', on ? 'Modo leve ativado' : 'Ativar modo leve'), h('div.rd', on ? 'Desligue para voltar exatamente às configurações que você tinha.' : 'Um clique para o LocalCord pesar o mínimo possível no computador. Ideal para jogar com o app aberto.')),
        toggle(on, (v) => { setLite(v, ctx?.voice); draw(); })),
      section('O que o modo leve faz'),
      h('div.card2', ITEMS.map(it => row((on ? (it.key && !(it.key in applied) ? '• ' : '✓ ') : '• ') + it.title, it.desc + (on && it.key && !(it.key in applied) ? ' (já estava assim)' : ''), null))),
      section('O que já vem leve no LocalCord'),
      h('div.card2',
        row('Sem sobreposição dentro do jogo', 'O LocalCord não injeta nada no jogo, então não há overlay para desligar.', null),
        row('Sem coleta de dados', 'Nenhum rastreamento ou telemetria: o servidor é seu.', null),
        row('Prioridade normal', 'O app roda com prioridade normal do Windows; não é preciso mexer no Gerenciador de Tarefas.', null)),
      ...(desktop ? [section('Opcional'), h('div.card2', h('div.hdacc', 'Carregando…'))] : []));
    if (desktop) desktop.getSettings().then(s => box.querySelector('.hdacc')?.replaceWith(
      row('Aceleração de hardware', 'Desligar só ajuda se a placa de vídeo estiver no limite com o jogo: a interface e os vídeos passam para a CPU, o que costuma pesar mais. Reinicia o app.', toggle(s.hardwareAcceleration !== false, v => { desktop.setSettings({ hardwareAcceleration: v }); toast('Reinicie o app para aplicar'); }))));
  };
  draw();
  return h('div', h('h2', 'Modo leve'), box);
}
