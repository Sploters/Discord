// Painéis rápidos: dispositivos de áudio, cancelamento de eco/ruído e status — sem abrir as configurações.
import { h, icon, avatar, framePos } from './util.js';
import { styleName } from './themes.js';
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

// Menu do botão de microfone/fone (como o do Discord): dispositivo em submenu, volume e configurações de voz
export function openAudioPanel(anchor, voice, kind, { openSettings } = {}) {
  const inp = kind === 'in', key = inp ? 'inputId' : 'outputId', dk = inp ? 'audioinput' : 'audiooutput';
  const sub = h('div.dm-sub'), cur = h('div.dm-subtext', 'Padrão do sistema');
  let fly = null, flyTimer = 0;
  const closeFly = () => { clearTimeout(flyTimer); fly?.remove(); fly = null; };
  const later = () => { clearTimeout(flyTimer); flyTimer = setTimeout(closeFly, 200); };
  const pick = (d) => { S.prefs[key] = d.deviceId; savePrefs(); closeFly(); refresh(); if (inp) voice.active && voice.rebuildMic(); else applyOutput(voice); };
  const refresh = async () => {
    const list = (await devices(dk)).filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications');
    const all = [{ deviceId: '', label: 'Padrão do sistema' }, ...list], on = all.find(d => d.deviceId === (S.prefs[key] || '')) || all[0];
    cur.textContent = on.label || 'Padrão do sistema'; row.__all = all;
  };
  const openFly = () => {
    clearTimeout(flyTimer); if (fly) return;
    const all = row.__all || [{ deviceId: '', label: 'Padrão do sistema' }];
    fly = h('div.popout.dsub', { onmouseenter: () => clearTimeout(flyTimer), onmouseleave: later },
      all.map(d => h('div.dm-item', { role: 'menuitemradio', 'aria-checked': (S.prefs[key] || '') === d.deviceId, onclick: () => pick(d) },
        h('span.dm-lab', d.label || 'Dispositivo'), h('span.dm-radio' + ((S.prefs[key] || '') === d.deviceId ? '.on' : '')))));
    document.getElementById('layer').append(fly);
    const rr = row.getBoundingClientRect(), card = body.closest('.popout').getBoundingClientRect(), fb = fly.getBoundingClientRect();
    const right = card.right + 4, left = card.left - fb.width - 4;
    fly.style.left = (right + fb.width <= innerWidth - 8 ? right : Math.max(8, left)) + 'px';
    fly.style.top = Math.max(8, Math.min(rr.top - 4, innerHeight - fb.height - 8)) + 'px';
  };
  const row = h('div.dm-item.dm-two', { role: 'menuitem', onmouseenter: openFly, onmouseleave: later, onclick: openFly },
    h('div.dm-label', h('span', inp ? 'Dispositivo de entrada' : 'Dispositivo de saída'), cur), icon('chevr', 18));
  refresh();
  const vol = (title, get, set) => {
    const rg = h('input.dm-range', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': title });
    const paint = () => rg.style.setProperty('--p', rg.value + '%');
    rg.value = get(); paint(); rg.oninput = () => { paint(); set(+rg.value); }; rg.onchange = savePrefs;
    return h('div.dm-vol', h('div.dm-label', title), rg);
  };
  const body = h('div.dmenu', { role: 'menu' },
    row, h('div.dm-sep'),
    inp ? vol('Volume de entrada', () => Math.min(100, S.prefs.inputVolume ?? 100), v => { S.prefs.inputVolume = v; if (voice.micGraph) voice.micGraph.gain.gain.value = v / 100; })
      : vol('Volume de saída', () => S.prefs.volume ?? 100, v => { S.prefs.volume = v; voice.peers.forEach((_, id) => voice.applyVolume(id)); }),
    h('div.dm-sep'),
    openSettings && h('div.dm-item', { role: 'menuitem', onclick: () => { closeFly(); closeFloating(); openSettings('voice'); } }, icon('gear', 18), h('span.dm-lab', 'Configurações de voz')));
  body.addEventListener('mouseover', (e) => { if (!e.target.closest('.dm-two')) later(); });
  const el = popout(anchor, body, 'up'); el.classList.add('quick', 'dmpop');
  const r = anchor.getBoundingClientRect(), bb = el.getBoundingClientRect();
  el.style.top = Math.max(8, r.top - bb.height - 10) + 'px'; el.style.left = Math.max(8, Math.min(r.left - 20, innerWidth - bb.width - 8)) + 'px';
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

// Cartão do próprio usuário (clique na barra do usuário): banner, status personalizado, editar perfil, status, trocar de conta
export function openStatusPanel(anchor, { openSettings, openFullProfile, logout } = {}) {
  const body = h('div.mepop');
  let editing = false, fly = null, flyTimer = 0;
  const closeFly = () => { clearTimeout(flyTimer); fly?.remove(); fly = null; };
  const later = () => { clearTimeout(flyTimer); flyTimer = setTimeout(closeFly, 180); };
  // status: popup ao lado que abre só de passar o mouse
  const openFly = (row) => {
    clearTimeout(flyTimer); if (fly) return;
    fly = h('div.popout.mefly', { onmouseenter: () => clearTimeout(flyTimer), onmouseleave: later },
      STATUS.map(([k, l, c, d]) => h('div.stat' + (S.me.status === k ? '.on' : ''), { onclick: async () => { const r = await tryApi('PATCH', '/me', { status: k }); if (r) { S.me = { ...S.me, status: k }; closeFly(); draw(); } } },
        h('i.sdot.' + c), h('div', h('div', l), d && h('small', d)))));
    document.getElementById('layer').append(fly);
    const rr = row.getBoundingClientRect(), card = body.closest('.popout').getBoundingClientRect(), fb = fly.getBoundingClientRect();
    const right = card.right + 6, left = card.left - fb.width - 6;
    fly.style.left = (right + fb.width <= innerWidth - 8 ? right : Math.max(8, left)) + 'px';
    fly.style.top = Math.max(8, Math.min(rr.top - 6, innerHeight - fb.height - 8)) + 'px';
  };
  const draw = () => {
    const me = S.me, themed = !!(me.theme_primary && me.theme_accent), color = themed ? me.theme_primary : me.banner_color || me.color || '#5865f2';
    const banner = h('div.mebanner', { style: { background: themed ? `linear-gradient(160deg, ${me.theme_primary}, ${me.theme_accent})` : color } });
    if (me.banner) banner.append(framePos(h('img', { src: me.banner, alt: '', draggable: false }), me.banner_pos));
    const cur = STATUS.find(x => x[0] === me.status) || STATUS[0];
    const csInput = h('input', { value: me.custom_status || '', maxLength: 100, placeholder: 'Qual é o seu status?' });
    const saveCs = async () => { if (await tryApi('PATCH', '/me', { custom_status: csInput.value.trim() })) { editing = false; draw(); } };
    csInput.onkeydown = (e) => { if (e.key === 'Enter') saveCs(); if (e.key === 'Escape') { editing = false; draw(); } };
    const csBox = editing
      ? h('div.mecs.edit', csInput, h('button.btn', { onclick: saveCs }, 'Salvar'))
      : h('div.mecs', { title: 'Definir status personalizado', onclick: () => { editing = true; draw(); csInput.focus(); setTimeout(() => body.querySelector('.mecs input')?.focus()); } },
        me.custom_status ? h('span', (me.status_emoji && !/^<:/.test(me.status_emoji) ? me.status_emoji + ' ' : '') + me.custom_status) : [icon('plus', 16), h('span.ph', 'Adicionar status personalizado')]);
    const item = (ic, label, fn, extra, hover) => h('div.meitem', { onclick: fn, onmouseenter: hover ? (e) => openFly(e.currentTarget) : closeFly, onmouseleave: hover ? later : null }, h('span.mei', ic), h('span.mel', label), extra);
    body.replaceChildren(
      h('div.mehead', banner, h('div.meav', { title: 'Ver perfil completo', onclick: () => { closeFly(); closeFloating(); openFullProfile?.(); } }, avatar(me, 80, { ring: 'var(--bg-float)' })), csBox),
      h('div.mebody',
        h('div.mename', styleName(h('span', me.display_name), me.name_style),
          h('button.mecopy', { title: 'Copiar nome de usuário', onclick: () => { navigator.clipboard?.writeText(me.username); toast('Nome de usuário copiado'); } }, icon('copy', 16))),
        h('div.meun', me.username),
        h('div.megroup',
          item(icon('edit', 16), 'Editar perfil', () => { closeFloating(); openSettings?.('profile'); }),
          item(h('i.sdot.' + cur[2]), h('span', 'Status: ' + cur[1], me.status === 'invisible' && h('span', { title: 'Seu status e sua atividade ficam ocultos quando você está invisível', style: { marginLeft: '6px' } }, '⚠')), () => openFly(body.querySelector('.meitem:nth-child(2)')), h('span.mearrow', '›'), true),
        ),
        h('div.megroup',
          item(icon('phoneoff', 16), 'Trocar de conta', () => { closeFloating(); logout?.(); }),
          item(icon('copy', 16), 'Copiar ID do usuário', () => { navigator.clipboard?.writeText(me.id); toast('ID copiado'); closeFloating(); }))));
  };
  draw();
  const el = popout(anchor, body, 'up'); el.classList.add('quick', 'mecard');
  const r = anchor.getBoundingClientRect(), bb = el.getBoundingClientRect();
  el.style.top = Math.max(8, r.top - bb.height - 10) + 'px'; el.style.left = Math.max(8, r.left) + 'px';
  new MutationObserver(() => { const q = el.getBoundingClientRect(); el.style.top = Math.max(8, Math.min(parseFloat(el.style.top), innerHeight - q.height - 8)) + 'px'; }).observe(body, { childList: true });
}
