// Painéis rápidos: dispositivos de áudio, cancelamento de eco/ruído e status — sem abrir as configurações.
import { h, icon } from './util.js';
import { S, api, tryApi, toast, savePrefs, popout, closeFloating, user, nameOf } from './state.js';
import { seg, toggle, slider } from './ui.js';
import { NOISE_MODES } from './voice.js';

const STATUS = [['online', 'Online', 's-online', ''], ['idle', 'Ausente', 's-idle', 'Aparece como ausente'], ['dnd', 'Não perturbe', 's-dnd', 'Silencia notificações'], ['invisible', 'Invisível', 's-offline', 'Aparece offline, mas você usa normalmente']];

async function devices(kind) {
  try { const ds = await navigator.mediaDevices.enumerateDevices(); return ds.filter(d => d.kind === kind); } catch { return []; }
}
export function applyOutput(voice) {
  for (const p of voice.peers.values()) { p.audioEl?.setSinkId?.(S.prefs.outputId).catch(() => { }); p.screenAudioEl?.setSinkId?.(S.prefs.outputId).catch(() => { }); }
}
function deviceList(kind, key, onPick) {
  const box = h('div.devlist');
  const draw = async () => {
    const list = await devices(kind);
    box.replaceChildren(...[{ deviceId: '', label: 'Padrão do sistema' }, ...list.filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications')].map((d, i) =>
      h('div.dev' + ((S.prefs[key] || '') === d.deviceId ? '.on' : ''), { onclick: () => { S.prefs[key] = d.deviceId; savePrefs(); draw(); onPick?.(d); } }, h('span.dot'), h('span', d.label || `Dispositivo ${i}`))));
    if (!list.length) box.append(h('small', { style: { color: 'var(--text-muted)' } }, 'Permita o acesso ao microfone para listar os dispositivos.'));
  };
  draw(); navigator.mediaDevices?.addEventListener?.('devicechange', draw);
  return box;
}

// ---------- volume por usuário: controle deslizante até 200% + campo numérico até 1000% ----------
export const MAX_VOL = 1000;
const VOL_STEPS = [[0, 'Mudo'], [50, '50%'], [100, '100%'], [200, '200%'], [400, '400%']];
export function volumeControl(voice, uid, kind = 'mic', label) {
  const get = () => (kind === 'screen' ? voice.streamVolumes : voice.volumes)[uid] ?? 100;
  const set = (v) => {
    v = Math.round(Math.max(0, Math.min(MAX_VOL, Number.isFinite(v) ? v : 100)));
    kind === 'screen' ? voice.setStreamVolume(uid, v) : voice.setVolume(uid, v); savePrefs(); sync();
  };
  // escala do controle deslizante: 0–100% na primeira metade, 100–400% na segunda (mais precisão perto do normal)
  const toPos = (v) => (v <= 100 ? v / 2 : 50 + (Math.min(v, 400) - 100) / 6);
  const fromPos = (p) => (p <= 50 ? p * 2 : 100 + (p - 50) * 6);
  const snap = (v) => (Math.abs(v - 100) < 4 ? 100 : v > 100 ? Math.round(v / 10) * 10 : Math.round(v));
  const rg = h('input.vrange', { type: 'range', min: 0, max: 100, step: .5, 'aria-label': label || 'Volume', oninput: () => set(snap(fromPos(+rg.value))) });
  const num = h('input.volnum', { type: 'number', min: 0, max: MAX_VOL, step: 1, title: `0 a ${MAX_VOL}% (vazio = 100%)`,
    onchange: () => set(num.value.trim() === '' ? 100 : +num.value), onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') num.blur(); } });
  const chips = h('div.vchips', VOL_STEPS.map(([v, l]) => h('button', { 'data-v': v, onclick: () => set(v) }, l)));
  const tag = h('span.vtag');
  const el = h('div.volctl',
    h('div.vchead', h('span.vlab', icon(kind === 'screen' ? 'screen' : 'voice', 16), label || 'Volume'), tag, h('label.volbox', num, h('span', '%'))),
    h('div.vtrack', rg, h('i.vmark', { title: '100%' })),
    chips);
  const sync = () => {
    const v = get(), p = toPos(v);
    rg.value = p; num.value = v;
    el.style.setProperty('--p', p + '%');
    el.classList.toggle('boost', v > 100); el.classList.toggle('muted', v === 0);
    tag.textContent = v === 0 ? 'mudo' : v > 100 ? 'amplificado' : '';
    chips.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === v));
  };
  sync(); return el;
}

export function openAudioPanel(anchor, voice, kind, { openSettings } = {}) {
  const body = h('div.qpop');
  if (kind === 'in') {
    const rebuild = () => voice.active && voice.rebuildMic();
    body.append(h('h4', 'Dispositivo de entrada'), deviceList('audioinput', 'inputId', rebuild),
      h('h4', 'Redução de ruído'), seg(NOISE_MODES, S.prefs.noiseMode, v => { S.prefs.noiseMode = v; savePrefs(); rebuild(); }),
      h('div.qrow', h('span', 'Cancelamento de eco'), toggle(S.prefs.echo !== false, v => { S.prefs.echo = v; savePrefs(); rebuild(); })),
      h('div.qrow', h('span', 'Porta de ruído'), toggle(!!S.prefs.gate, v => { S.prefs.gate = v; savePrefs(); rebuild(); })),
      h('div.qrow', h('span', 'Ganho automático'), toggle(S.prefs.agc !== false, v => { S.prefs.agc = v; savePrefs(); rebuild(); })),
      h('h4', 'Volume do microfone'), slider(0, 200, S.prefs.inputVolume ?? 100, 5, v => { S.prefs.inputVolume = v; savePrefs(); if (voice.micGraph) voice.micGraph.gain.gain.value = v / 100; }, v => v + '%'),
      h('h4', 'Modo de entrada'), seg({ vad: 'Atividade de voz', ptt: 'Push-to-talk' }, S.prefs.inputMode, v => { S.prefs.inputMode = v; savePrefs(); voice.applyMute(); }),
      openSettings && h('button.btn.link', { style: { marginTop: '8px' }, onclick: () => { closeFloating(); openSettings('voice'); } }, 'Configurações de voz…'));
  } else {
    body.append(h('h4', 'Dispositivo de saída'), deviceList('audiooutput', 'outputId', () => applyOutput(voice)),
      h('h4', 'Volume geral da voz'), slider(0, 100, S.prefs.volume ?? 100, 5, v => { S.prefs.volume = v; savePrefs(); voice.peers.forEach((_, id) => voice.applyVolume(id)); }, v => v + '%'),
      h('h4', 'Volume dos sons do app'), slider(0, 100, S.prefs.soundVolume ?? 80, 5, v => { S.prefs.soundVolume = v; savePrefs(); }, v => v + '%'),
      h('h4', 'Volume do soundboard'), slider(0, 100, S.prefs.sbVolume ?? 70, 5, v => { S.prefs.sbVolume = v; savePrefs(); }, v => v + '%'),
      voice.peers.size > 0 && h('h4', 'Volume de cada pessoa'), ...[...voice.peers.keys()].filter(id => id !== voice.myId).map(id => volumeControl(voice, id, 'mic', nameOf(id, S.view.gid))),
      h('div.qrow', h('span', 'Silenciar sons do app'), toggle(!!S.prefs.soundsMuted, v => { S.prefs.soundsMuted = v; savePrefs(); })),
      h('div.qrow', h('span', 'Silenciar soundboard'), toggle(!!S.prefs.sbMuted, v => { S.prefs.sbMuted = v; savePrefs(); })));
  }
  const el = popout(anchor, body, 'up'); el.classList.add('quick');
  const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
  el.style.top = Math.max(8, r.top - b.height - 10) + 'px'; el.style.left = Math.max(8, Math.min(r.left - 20, innerWidth - b.width - 8)) + 'px';
}

// Teste de microfone (medidor + ouvir a si mesmo) e filtros: ruído, eco, porta de ruído
export function openMicPanel(anchor, voice, { openSettings } = {}) {
  const rebuild = async () => { const wasOn = loop; if (voice.active) await voice.rebuildMic(); if (wasOn) voice.micGraph?.setLoopback(true); };
  const fill = h('div.mfill'), meter = h('div.mmeter', fill);
  let loop = false;
  const loopBtn = h('button.btn.grey', { style: { width: '100%' }, onclick: () => {
    loop = !loop; voice.micGraph?.setLoopback(loop);
    loopBtn.textContent = loop ? 'Parar de me ouvir' : 'Ouvir meu microfone'; loopBtn.classList.toggle('red', loop);
  } }, 'Ouvir meu microfone');
  const body = h('div.qpop.micpop',
    h('h4', 'Teste de microfone'), meter, h('small.mhint', voice.micGraph ? 'Fale algo: a barra mostra o que os outros recebem (já com os filtros).' : 'Microfone indisponível nesta chamada.'),
    voice.micGraph && loopBtn, voice.micGraph && h('small.mhint', 'Use fone de ouvido para não dar microfonia.'),
    h('h4', 'Redução de ruído'), seg(NOISE_MODES, S.prefs.noiseMode, v => { S.prefs.noiseMode = v; savePrefs(); rebuild(); }),
    h('div.qrow', h('span', 'Cancelamento de eco'), toggle(S.prefs.echo !== false, v => { S.prefs.echo = v; savePrefs(); rebuild(); })),
    h('div.qrow', h('span', 'Porta de ruído'), toggle(!!S.prefs.gate, v => { S.prefs.gate = v; savePrefs(); rebuild(); })),
    openSettings && h('button.btn.link', { style: { marginTop: '8px' }, onclick: () => { closeFloating(); openSettings('voice'); } }, 'Mais opções de voz…'));
  const el = popout(anchor, body, 'up'); el.classList.add('quick');
  const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
  el.style.top = Math.max(8, r.top - b.height - 10) + 'px'; el.style.left = Math.max(8, Math.min(r.left - 20, innerWidth - b.width - 8)) + 'px';
  const iv = setInterval(() => {
    if (!document.body.contains(body)) { clearInterval(iv); if (loop) voice.micGraph?.setLoopback(false); return; }
    const lv = voice.analysers.get(voice.myId)?.level || 0;
    fill.style.width = Math.min(100, Math.round(lv * 160)) + '%'; fill.classList.toggle('hot', lv > .55);
  }, 80);
}

export function openStatusPanel(anchor, { openSettings, openProfile } = {}) {
  const me = S.me;
  const body = h('div.qpop');
  const cs = h('input', { value: me.custom_status || '', maxLength: 100, placeholder: 'Definir um status personalizado' });
  const draw = () => {
    body.replaceChildren(
      h('div.qhead', h('b', me.display_name), h('small', '@' + me.username)),
      ...STATUS.map(([k, l, c, d]) => h('div.stat' + (S.me.status === k ? '.on' : ''), { onclick: async () => { const r = await tryApi('PATCH', '/me', { status: k }); if (r) { S.me = { ...S.me, status: k }; draw(); } } },
        h('i.sdot.' + c), h('div', h('div', l), d && h('small', d)))),
      h('h4', 'Status personalizado'), cs,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, h('button.btn', { onclick: async () => { if (await tryApi('PATCH', '/me', { custom_status: cs.value })) { toast('Status atualizado'); closeFloating(); } } }, 'Salvar'),
        h('button.btn.grey', { onclick: async () => { cs.value = ''; if (await tryApi('PATCH', '/me', { custom_status: '' })) closeFloating(); } }, 'Limpar')),
      h('div', { style: { height: '1px', background: 'var(--divider)', margin: '12px 0' } }),
      h('div.stat', { onclick: () => { closeFloating(); openProfile?.(); } }, h('div', 'Ver meu perfil')),
      h('div.stat', { onclick: () => { closeFloating(); openSettings?.('profile'); } }, h('div', 'Editar perfil')),
      h('div.stat', { onclick: () => { closeFloating(); openSettings?.('account'); } }, h('div', 'Configurações')));
  };
  draw();
  const el = popout(anchor, body, 'up'); el.classList.add('quick');
  const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
  el.style.top = Math.max(8, r.top - b.height - 10) + 'px'; el.style.left = Math.max(8, r.left) + 'px';
}
