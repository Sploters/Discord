// "Algo deu errado?": relatório de problema com um clique. Junta o que ajuda a investigar (versões, placa de vídeo,
// log do app desktop, estado da call, últimos erros da página) num .json e envia por DM ao administrador da instalação
// (ou salva em arquivo). Nada de senha, token ou conteúdo de mensagens.
import { h } from './util.js';
import { S, api, toast, modal, desktop } from './state.js';

// ---- erros da página desde a abertura (os 60 mais recentes) ----
const errs = [];
const keep = (kind, msg) => { errs.push({ t: new Date().toISOString().slice(11, 19), kind, msg: String(msg).slice(0, 400) }); if (errs.length > 60) errs.shift(); };
addEventListener('error', (e) => keep('erro', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
addEventListener('unhandledrejection', (e) => keep('promessa', e.reason?.stack?.split('\n').slice(0, 2).join(' ') || e.reason));
for (const k of ['error', 'warn']) { const orig = console[k].bind(console); console[k] = (...a) => { keep(k === 'error' ? 'console' : 'aviso', a.map(x => (x instanceof Error ? x.message : typeof x === 'object' ? (() => { try { return JSON.stringify(x); } catch { return String(x); } })() : x)).join(' ')); orig(...a); }; }

let voiceRef = () => null; // injetado por app.js (função: o voice só existe depois do READY)
export const initDiag = (fn) => { voiceRef = fn; };

async function collect() {
  const v = voiceRef(), prefs = { ...S.prefs }; delete prefs.customThemes; delete prefs.drafts;
  const vs = v?.active ? {
    sala: v.channelId, servidorDeMidia: !!v.sfu?.ready, pessoas: (v.peers?.size || 0) + 1,
    transmitindo: !!v.screen, camera: !!v.cam, assistindo: [...(S.watching || [])].length, fechadas: [...(v.closedStreams || [])].length,
    pausadasAuto: [...(v.autoPaused || [])].length, versoesNaSala: [...S.voice.values()].filter(x => x.channel_id === v.channelId).map(x => ({ quem: x.user_id === S.me?.id ? 'eu' : x.user_id, app: x.app || 'navegador', tela: !!x.screen })),
  } : null;
  const nav = navigator.connection;
  return {
    pagina: { endereco: location.host, versao: (document.querySelector('script[src*="app.js"]')?.src.match(/v=(\w+)/) || [])[1] || null, navegador: navigator.userAgent, idioma: navigator.language,
      janela: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`, online: navigator.onLine, rede: nav ? `${nav.effectiveType || '?'} ${nav.downlink || '?'} Mb/s ${nav.rtt ?? '?'} ms` : null, abertaHaMin: Math.round(performance.now() / 60000) },
    servidor: await api('GET', '/server-info').catch(() => null),
    desktop: desktop ? (await desktop.getDiagnostics?.().catch(() => null)) || (await desktop.getSettings?.().then(s => ({ app: s.version, placa: s.gpuName, compatibilidadeVideo: s.gpuCompat, compatAtiva: s.gpuCompatActive, servidor: s.server })).catch(() => null)) : null,
    call: vs, preferencias: prefs, erros: errs.slice(),
  };
}

export async function openReport(prefill = '') {
  const text = h('textarea', { name: 'report-text', rows: 4, maxLength: 2000, placeholder: 'Ex.: entrei na call e não aparecia a tela do Fulano; só aparecia quando eu passava o mouse.', value: prefill });
  const tech = h('input', { type: 'checkbox', name: 'report-tech', checked: true });
  const pre = h('pre.rpdata', 'Juntando as informações…');
  let data = null;
  collect().then(d => { data = d; pre.textContent = JSON.stringify(d, null, 2); }).catch(e => { pre.textContent = 'Não consegui juntar as informações: ' + e.message; });
  const details = h('details.rpdet', h('summary', 'Ver o que será enviado'), pre);
  const payload = () => ({ text: text.value.trim(), data: tech.checked ? data || {} : {} });
  const save = () => {
    const blob = new Blob([JSON.stringify({ quando: new Date().toISOString(), descricao: text.value.trim(), ...(tech.checked ? data : {}) }, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `relatorio-resenha-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json` }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  modal('Algo deu errado?', 'Conte o que aconteceu. O relatório vai com as informações técnicas que ajudam a achar o problema.', h('div.report',
    h('label.f', 'O que aconteceu?', text),
    h('label.rpchk', tech, h('span', 'Incluir informações técnicas: versões, placa de vídeo, log do app, estado da call e erros recentes. Não vai senha nem mensagens.')),
    details), [
    { label: 'Cancelar', cls: 'link' },
    { label: 'Salvar em arquivo', cls: 'grey', keep: true, fn: save },
    { label: 'Enviar relatório', cls: 'green', fn: async () => {
      if (!text.value.trim() && !tech.checked) { toast('Escreva o que aconteceu ou inclua as informações técnicas', true); return false; }
      if (tech.checked && !data) data = await collect().catch(() => ({}));
      try {
        const r = await api('POST', '/reports', payload());
        toast(r.sent_to ? `Relatório enviado para ${r.sent_to.display_name || r.sent_to.username}. Obrigado!` : 'Relatório guardado no servidor. Obrigado!');
      } catch (e) { toast('Não consegui enviar: ' + e.message + '. Use "Salvar em arquivo" e mande o arquivo.', true); return false; }
    } }], { width: '560px' });
  setTimeout(() => text.focus(), 0);
}
