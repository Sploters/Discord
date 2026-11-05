// Teste da transmissão nativa (120 FPS): gera o código para o programa de captura do PC, assiste a própria
// transmissão pelo servidor (o vídeo faz a volta inteira: PC -> servidor -> este app) e mede quadros por segundo.
import { h, icon } from './util.js';
import { S, api, toast, modal } from './state.js';

let cur = null; // teste aberto
export function nativeEnded(d) { if (cur && d.producer_id === cur.producer_id) cur.ended(d.reason); }

const med = (v) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const pctl = (v, p) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const avg = (v) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;

export function openNativeTest() {
  const voice = window.__lc?.voice;
  const st = h('div.ntstate'), codeBox = h('div.ntcode'), live = h('div.ntlive'), result = h('pre.ntres');
  const video = h('video.ntvid', { autoplay: true, muted: true, playsInline: true });
  const body = h('div.ntest',
    h('p.ntintro', 'Mede se a sua tela chega a 120 FPS do outro lado: o programa de teste captura a tela, comprime na placa de vídeo e envia ao servidor; este app assiste e conta os quadros.'),
    st, codeBox, h('div.ntview', video, live), result);
  const m = modal('Teste: transmissão a 120 FPS', null, body, [{ label: 'Fechar', cls: 'grey', fn: () => stop() }], { width: '760px', sticky: true });
  let watch = null, timer = null, rows = [], last = null, frames = 0, startedAt = 0, lastFrameAt = 0, endedWhy = null;
  const say = (t, cls = '') => st.replaceChildren(h('div.ntmsg' + cls, t));
  function stop() { clearInterval(timer); watch?.close(); watch = null; if (cur?.producer_id) api('POST', '/native-screen/stop').catch(() => { }); cur = null; }
  const watchClose = new MutationObserver(() => { if (!m.el.isConnected) { stop(); watchClose.disconnect(); } }); watchClose.observe(m.el.parentNode || document.body, { childList: true });

  if (!voice?.channelId) return say('Entre numa sala de voz antes de começar o teste.', '.warn');
  if (!voice.sfu?.ready) return say('A sala de voz ainda não conectou ao servidor (ou o servidor está sem SFU). Tente de novo em alguns segundos.', '.warn');

  say('Passo 1: gere o código e cole no programa de teste (TESTAR.bat).');
  codeBox.append(h('button.btn', { onclick: start }, icon('play', 16), 'Gerar código'));

  async function start() {
    let r; try { r = await api('POST', '/native-screen'); } catch (e) { return say(e.message, '.warn'); }
    cur = { producer_id: r.producer_id, ended: (why) => { endedWhy = why; finish(); } };
    const copy = async () => { try { await navigator.clipboard.writeText(r.code); toast('Código copiado'); } catch { toast('Selecione e copie o código', true); } };
    codeBox.replaceChildren(h('code', r.code), h('button.btn.grey', { onclick: copy }, icon('copy', 16), 'Copiar'));
    copy();
    say('Passo 2: no programa de teste, cole o código e aperte Enter. Deixe esta janela visível: os quadros são contados aqui.');
    try { watch = await voice.watchProducer(r.producer_id); } catch (e) { return say('Não consegui assistir: ' + e.message, '.warn'); }
    video.srcObject = new MediaStream([watch.track]); video.play().catch(() => { });
    const cb = () => { frames++; lastFrameAt = performance.now(); video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback?.(cb);
    timer = setInterval(sample, 1000);
  }

  async function sample() {
    if (!watch) return;
    const rep = await watch.consumer.getStats().catch(() => null); let s = null;
    rep?.forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'video') s = x; });
    if (!s) return;
    const now = performance.now();
    if (last && s.framesReceived > last.framesReceived) {
      const dt = (now - last.t) / 1000;
      const row = { rx: (s.framesReceived - last.framesReceived) / dt, dec: (s.framesDecoded - last.framesDecoded) / dt, drop: ((s.framesDropped || 0) - (last.framesDropped || 0)) / dt,
        shown: (frames - last.frames) / dt, mbps: (s.bytesReceived - last.bytesReceived) * 8 / 1e6 / dt, lost: (s.packetsLost || 0) - (last.packetsLost || 0),
        w: s.frameWidth, hgt: s.frameHeight, jb: s.jitterBufferEmittedCount ? (s.jitterBufferDelay - (last.jbd || 0)) / Math.max(1, s.jitterBufferEmittedCount - (last.jbe || 0)) * 1000 : 0 };
      if (!startedAt) { startedAt = now; say('Recebendo… espere o programa terminar (1 minuto).'); }
      else rows.push(row); // descarta o 1º segundo
      live.replaceChildren(
        h('div.ntbig', h('b', Math.round(row.rx)), h('span', 'FPS recebidos')),
        h('div.ntbig', h('b', Math.round(row.dec)), h('span', 'decodificados')),
        h('div.ntbig', h('b', Math.round(row.shown)), h('span', 'exibidos')),
        h('div.ntsmall', `${row.w}×${row.hgt} · ${row.mbps.toFixed(1)} Mbps · pacotes perdidos ${Math.max(0, row.lost)} · ${rows.length} s medidos`));
    } else if (startedAt && now - lastFrameAt > 4000 && rows.length) { finish(); return; }
    last = { t: now, framesReceived: s.framesReceived || 0, framesDecoded: s.framesDecoded || 0, framesDropped: s.framesDropped || 0, bytesReceived: s.bytesReceived || 0, packetsLost: s.packetsLost || 0, frames, jbd: s.jitterBufferDelay || 0, jbe: s.jitterBufferEmittedCount || 0 };
  }

  function finish() {
    if (!timer) return;
    clearInterval(timer); timer = null;
    { const md = med(rows.map(r => r.rx)); while (rows.length > 1 && rows.at(-1).rx < md * 0.9) rows.pop(); } // último segundo incompleto (o programa parou no meio dele)
    const rx = rows.map(r => r.rx), dec = rows.map(r => r.dec), shown = rows.map(r => r.shown);
    const f = (v) => v.toFixed(1).replace('.', ',');
    const txt = [
      'Resenha - teste da transmissão nativa (lado de quem assiste)',
      `Data: ${new Date().toLocaleString('pt-BR')}`,
      `Segundos medidos: ${rows.length}${endedWhy ? ' (fim: ' + endedWhy + ')' : ''}`,
      `Resolução recebida: ${rows.at(-1)?.w || '?'}x${rows.at(-1)?.hgt || '?'}`,
      `Recebidos:      média ${f(avg(rx))} fps | mediana ${f(med(rx))} | pior segundo ${f(Math.min(...rx, 9999))} | p5 ${f(pctl(rx, 0.05))}`,
      `Decodificados:  média ${f(avg(dec))} fps | mediana ${f(med(dec))} | pior segundo ${f(Math.min(...dec, 9999))}`,
      `Exibidos:       média ${f(avg(shown))} fps | mediana ${f(med(shown))} | pior segundo ${f(Math.min(...shown, 9999))}`,
      `Banda: ${f(avg(rows.map(r => r.mbps)))} Mbps | pacotes perdidos: ${rows.reduce((n, r) => n + Math.max(0, r.lost), 0)} | atraso do buffer: ${f(avg(rows.map(r => r.jb)))} ms`,
      `Série (recebidos/s): ${rx.map(Math.round).join(' ')}`,
    ].join('\n');
    result.textContent = txt;
    say(rows.length ? 'Teste terminado. Copie o resultado e mande junto com o do programa.' : 'Nenhum quadro chegou. Veja a mensagem do programa de teste.', rows.length ? '' : '.warn');
    codeBox.replaceChildren(h('button.btn', { onclick: async () => { try { await navigator.clipboard.writeText(txt); toast('Resultado copiado'); } catch { toast('Selecione o texto e copie', true); } } }, icon('copy', 16), 'Copiar resultado'),
      h('button.btn.grey', { onclick: () => { m.close(); stop(); openNativeTest(); } }, 'Testar de novo'));
    watch?.close(); watch = null; window.__lcNativeResult = txt;
  }
}
