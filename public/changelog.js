// Novidades: o que mudou em cada atualização, mostrado uma vez para cada pessoa (fica gravado na conta, vale em todos os
// aparelhos) e guardado em Configurações -> Novidades. Para uma atualização nova: acrescente uma entrada NO TOPO de NEWS
// com um id novo (data). "try" liga o botão "Experimentar" a uma ação registrada pelo app (setNewsActions).
import { h, icon } from './util.js';
import { S, modal, savePrefs } from './state.js';

export const NEWS = [
  {
    id: '2026-11-04', title: 'Novembro de 2026',
    items: [
      { e: '🎭', t: 'Efeitos de voz', d: 'Robô, voz grossa, esquilo, monstro, rádio, eco e mais, no botão de máscara do painel de voz (atalho Ctrl+Shift+E). Quem ouve pode desligar os efeitos dos outros para si.', try: 'fx' },
      { e: '🎞️', t: 'GIFs no chat', d: 'Botão GIF ao lado do emoji: busca, em alta, favoritos (estrela) e os GIFs que já rolaram no grupo.', try: 'gifs' },
      { e: '✂️', t: 'Cortar clipe', d: '"Salvar e cortar…" no menu de clipes da transmissão, ou "Cortar" na galeria: escolhe o trecho numa linha do tempo, sem perder qualidade.', try: 'clips' },
      { e: '🎮', t: 'Procurar jogadores', d: 'Anuncie que falta gente para o squad (jogo, modo, elo, função) e receba pedidos para entrar. Fica em "Procurar jogadores", abaixo de Amigos.', try: 'lfg' },
      { e: '⚡', t: 'Transmissão a 120 FPS', d: 'No app desktop para Windows, escolha 120 fps ao transmitir: a imagem é comprimida pela placa de vídeo. Quem tem internet mais fraca recebe uma versão leve automaticamente.', try: 'stream' },
      { e: '📊', t: 'Enquetes', d: 'No + do campo de mensagem → "Criar enquete": uma ou várias respostas, prazo, resultado ao vivo.', try: 'poll' },
      { e: '📞', t: 'Convidar para a chamada', d: 'Clique direito num amigo → "Convidar para a chamada", mesmo que ele não esteja no servidor.' },
      { e: '🖱️', t: 'Controle remoto', d: 'Quem assiste sua transmissão pode pedir para controlar mouse e teclado (app desktop). Você aceita e para quando quiser.' },
      { e: '🚀', t: 'App mais leve e rápido', d: 'Abre até 3x mais rápido, sem vazamentos de memória, e trocar o filtro de ruído não deixa mais a voz atrasada.' },
    ],
  },
];

let actions = {};
export const setNewsActions = (a) => { actions = a; };
const latest = () => NEWS[0]?.id;

function card(it, close) {
  const go = it.try && actions[it.try];
  return h('div.newsitem', h('span.newse', it.e), h('div.newst', h('b', it.t), h('p', it.d)),
    go && h('button.btn.sm', { onclick: () => { close?.(); setTimeout(() => go(), 50); } }, 'Experimentar'));
}

// janela de novidades de uma atualização (a mais nova, por padrão)
export function openNews(id = latest()) {
  const n = NEWS.find(x => x.id === id) || NEWS[0]; if (!n) return;
  markSeen();
  let m;
  const close = () => m?.close();
  const body = h('div.newsbody', h('p.newsintro', 'O que chegou desde a última vez que você abriu o LocalCord:'), h('div.newslist', n.items.map(it => card(it, close))));
  m = modal(`Novidades — ${n.title}`, null, body, [{ label: 'Ver todas as novidades', cls: 'link', fn: () => { setTimeout(() => actions.settings?.(), 50); } }, { label: 'Legal!', cls: 'green' }], { width: '620px' });
}
export function markSeen() { if (S.prefs.newsSeen !== latest()) { S.prefs.newsSeen = latest(); savePrefs(); } }

// chamado depois que as preferências da conta chegam: mostra uma vez se há novidade que a pessoa ainda não viu
export function maybeShowNews() {
  const last = latest(); if (!last || S.prefs.newsSeen === last) return;
  setTimeout(() => { if (S.prefs.newsSeen !== last && !document.querySelector('.backdrop')) openNews(last); }, 1200); // depois de a tela montar
}

// página em Configurações
export function newsPage() {
  markSeen();
  return h('div.newspage', h('h2', 'Novidades'),
    ...NEWS.map(n => h('div.newsrel', h('h3', n.title), h('div.newslist', n.items.map(it => card(it, () => document.querySelector('#settings .close')?.click()))))));
}
