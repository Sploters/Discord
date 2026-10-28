// Painéis rápidos: dispositivos de áudio, cancelamento de eco/ruído e status — sem abrir as configurações.
import { h, icon } from './util.js';
import { S, api, tryApi, toast, savePrefs, popout, closeFloating } from './state.js';
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
      h('div.qrow', h('span', 'Silenciar sons do app'), toggle(!!S.prefs.soundsMuted, v => { S.prefs.soundsMuted = v; savePrefs(); })),
      h('div.qrow', h('span', 'Silenciar soundboard'), toggle(!!S.prefs.sbMuted, v => { S.prefs.sbMuted = v; savePrefs(); })));
  }
  const el = popout(anchor, body, 'up'); el.classList.add('quick');
  const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
  el.style.top = Math.max(8, r.top - b.height - 10) + 'px'; el.style.left = Math.max(8, Math.min(r.left - 20, innerWidth - b.width - 8)) + 'px';
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
