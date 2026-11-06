import { h, icon, avatar, framePos, parsePos, whenGone, soundEmoji } from './util.js';
import { S, api, tryApi, savePrefs, user, guild, can, PERM, PERM_LABELS, toast, confirmBox, promptBox, modal, menu, nameOf, desktop, applyTheme, emojiPicker, channelById } from './state.js';
import { createMic, newAudioContext, NOISE_MODES, VOICE_BITRATES } from './voice.js';
import { profileCard } from './card.js';
import { seg, toggle, row, section, slider, qualityPanel, captureKey, comboToAccel } from './ui.js';
import { playSound, SOUND_DEFS, soundCfg } from './sounds.js';
import { soundSources, mySounds, addSound, editSound, playLocal, soundVol } from './soundboard.js';
import { applyOutput } from './quick.js';
import { timeoutDialog, removeTimeout, banDialog, timedOutUntil, bansPage, auditPage } from './mod.js';
import { LANGS, myLang } from './translate.js';
import { SOLID_THEMES, GRADIENT_THEMES, gradientCss, decodeTheme, PROFILE_THEMES, parseColorPair, isLightPair, NAME_FONTS, NAME_EFFECTS, TWO_COLOR_EFFECTS, styleName } from './themes.js';
import { openThemeEditor, shareTheme } from './themeeditor.js';
import { prettyName, DEFAULT_NAME_WORDS } from './chnames.js';
import { PREVIEW_TRIGGERS } from './chpreview.js';
import { MAX_VOL } from './quick.js';
import { refreshFreeze } from './freeze.js';
import { connectionsPage } from './activity.js';
import { litePage, liteOn } from './lite.js';
import { openNativeTest } from './nativetest.js';
import { newsPage } from './changelog.js';
import { checkAppUpdate, installAppUpdate, silentUpdate } from './appupdate.js';
import { openReport } from './diag.js';

const SWATCHES = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#3ba55d', '#faa61a', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#95a5a6', '#2c2f33', '#ffffff'];
const save = () => savePrefs();

async function uploadFile(accept = 'image/*', maxMB = 12) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, onchange: async () => {
      const f = i.files[0]; if (!f) return res(null);
      if (f.size > maxMB * 1048576) { toast(`Arquivo muito grande (máx. ${maxMB} MB)`, true); return res(null); }
      try { res({ ...(await api('POST', `/upload?name=${encodeURIComponent(f.name)}`, f)), file: f }); } catch (e) { toast(e.message, true); res(null); }
    } });
    i.click();
  });
}
const uploadImage = () => uploadFile('image/*', 12);
// avatares prontos do servidor + opção de enviar uma imagem própria
// ajustar enquadramento: arraste a imagem e use o zoom; salva "x,y,zoom"
function positionEditor(kind, url, current, onSave) {
  const isAv = kind === 'avatar', p = parsePos(current);
  const img = h('img', { src: url, alt: '', draggable: false, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } });
  const frame = h('div', { style: { position: 'relative', overflow: 'hidden', cursor: 'grab', touchAction: 'none', background: '#000', margin: '0 auto', ...(isAv ? { width: '220px', height: '220px', borderRadius: '50%' } : { width: '100%', maxWidth: '420px', aspectRatio: '3 / 1', borderRadius: '8px' }) } }, img);
  const apply = () => framePos(img, p.x.toFixed(1) + ',' + p.y.toFixed(1) + ',' + p.z.toFixed(2));
  apply();
  let drag = null;
  frame.onpointerdown = (e) => { frame.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, px: p.x, py: p.y }; frame.style.cursor = 'grabbing'; };
  frame.onpointerup = frame.onpointercancel = () => { drag = null; frame.style.cursor = 'grab'; };
  frame.onpointermove = (e) => {
    if (!drag) return; const r = frame.getBoundingClientRect();
    // arrastar para a direita mostra mais da esquerda da imagem (x diminui); o movimento útil é proporcional ao excesso da imagem
    p.x = Math.max(0, Math.min(100, drag.px - (e.clientX - drag.x) / r.width * 100));
    p.y = Math.max(0, Math.min(100, drag.py - (e.clientY - drag.y) / r.height * 100));
    apply();
  };
  const zoom = h('input', { type: 'range', min: 1, max: 3, step: 0.05, value: p.z, style: { width: '100%', marginTop: '14px' }, oninput: () => { p.z = +zoom.value; apply(); } });
  modal(isAv ? 'Ajustar avatar' : 'Ajustar banner', 'Arraste a imagem para reposicionar e use o controle para dar zoom.', h('div', frame, h('label.f', { style: { marginTop: '14px' } }, 'Zoom'), zoom),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Centralizar', cls: 'grey', fn: () => { p.x = p.y = 50; p.z = 1; zoom.value = 1; apply(); return false; } }, { label: 'Aplicar', cls: 'green', fn: () => onSave(p.x.toFixed(1) + ',' + p.y.toFixed(1) + ',' + p.z.toFixed(2)) }]);
}
async function avatarPicker(current, onPick) {
  const info = await fetch('/api/server-info').then(r => r.json()).catch(() => ({}));
  let m;
  const pick = (url) => { onPick(url, ''); m.close(); };
  // imagem própria: abre o enquadramento antes; só troca o avatar se o usuário aplicar
  const upload = async () => { const u = await uploadImage(); if (!u) return; m.close(); positionEditor('avatar', u.url, '', (pos) => onPick(u.url, pos)); };
  m = modal('Escolha seu avatar', 'Use um dos avatares prontos ou envie uma imagem sua.', h('div',
    h('div.avgrid', (info.default_avatars || []).map(url => h('button.avopt' + (url === current ? '.on' : ''), { title: 'Usar este avatar', onclick: () => pick(url) }, h('img', { src: url, alt: '' })))),
    h('button.btn', { style: { marginTop: '16px', width: '100%' }, onclick: upload }, 'Enviar uma imagem…')),
  [{ label: 'Cancelar', cls: 'link' }]);
}
const swatches = (cur, onPick) => {
  // cor personalizada: botão com a paleta (o seletor nativo fica invisível por cima); escolhida, o botão ganha a cor.
  // Marcar a seleção só troca classes/estilo: recriar o seletor fecharia o nativo no meio do arraste
  const inp = h('input', { type: 'color', name: 'custom-color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#5865f2', oninput: (e) => { onPick(e.target.value); mark(e.target.value); } });
  const own = h('label.swcustom', { title: 'Cor personalizada' }, icon('palette', 18), inp);
  const dots = SWATCHES.map(s => h('i', { style: { background: s }, onclick: () => { onPick(s); mark(s); } }));
  const mark = (c) => {
    dots.forEach((d, i) => d.classList.toggle('sel', SWATCHES[i] === c));
    const mine = !!c && !SWATCHES.includes(c); own.classList.toggle('sel', mine); own.style.background = mine ? c : '';
  };
  mark(cur); return h('div.swatches', ...dots, own);
};
const card = (...k) => h('div.card2', ...k);
const hint = (t) => h('div.hintline', t);

// ============================ shell ============================
const USER_GROUPS = [
  ['Configurações do usuário', [['account', 'Minha conta', 'senha usuário nome excluir'], ['profile', 'Perfil', 'avatar banner bio status pronomes'], ['privacy', 'Privacidade e segurança', 'amizade sessões dispositivos links'], ['connections', 'Contas vinculadas', 'steam jogos atividade vincular conta']]],
  ['Configurações do aplicativo', [['lite', 'Modo leve', 'desempenho otimizar leve fps jogo cpu gpu rápido pesado'], ['appearance', 'Aparência', 'tema cor fonte compacto hora'], ['accessibility', 'Acessibilidade', 'movimento contraste saturação'], ['voice', 'Voz e vídeo', 'microfone ruído eco câmera dispositivo bitrate'], ['stream', 'Transmissão', 'tela resolução fps qualidade'], ['sounds', 'Sons', 'efeitos silenciar ensurdecer entrar sair'], ['soundboard', 'Soundboard', 'sons pad meme'], ['extras', 'Recursos extras', 'plugins imagem lente zoom galeria prévia canal nomes volume amplificar'], ['notifications', 'Notificações', 'avisos menção silenciar servidor'], ['keys', 'Atalhos', 'teclas push-to-talk mutar'], ['advanced', 'Avançado', 'desenvolvedor exportar importar redefinir'], ['news', 'Novidades', 'novidades atualização changelog o que mudou versão'], ['report', 'Relatar um problema', 'bug erro problema relatório suporte ajuda travou log diagnóstico']]],
];
const SERVER_PAGES = [['overview', 'Visão geral', 'nome ícone banner dono'], ['channels', 'Canais', 'ordem renomear'], ['roles', 'Cargos', 'permissões'], ['emojis', 'Emojis', ''], ['sounds', 'Soundboard do servidor', 'sons áudio'], ['members', 'Membros', 'expulsar banir castigo'], ['bans', 'Banimentos', 'banir desbanir'], ['audit', 'Registro de auditoria', 'log moderação histórico'], ['invites', 'Convites', 'link']];

export function openSettings(kind, ctx) {
  const prev = document.getElementById('settings'); if (prev) (prev._close ? prev._close() : prev.remove()); // abrir de novo: fecha direito a anterior (solta os ouvintes)
  const root = h('div#settings'), pane = h('div.pane'), nav = h('div.nav'), content = h('div.content', pane);
  const cleanups = []; const reg = (f) => cleanups.push(f);
  const close = () => { cleanups.forEach(f => f()); cleanups.length = 0; root.remove(); document.removeEventListener('keydown', esc); document.removeEventListener('lite-changed', onLite); document.dispatchEvent(new Event('settings-closed')); };
  // (antes o ouvinte de "modo leve mudou" só saía quando o modo leve mudava: segurava a tela inteira na memória a cada abertura)
  const onLite = () => drawNav();
  const esc = (e) => { if (e.key === 'Escape' && !document.getElementById('tedit') && !document.querySelector('.backdrop') && !pane.querySelector('.capturing') && !document.querySelector('.popout,.menu,.emoji-picker')) close(); };
  const isServer = kind === 'server', gid = ctx?.gid;
  const R = {
    account: () => accountPage(close), profile: () => profilePage(), privacy: (r) => privacyPage(r), connections: (r) => connectionsPage(r), appearance: () => appearancePage(), accessibility: () => accessibilityPage(),
    voice: (r) => voicePage(ctx, r), stream: () => streamPage(), sounds: () => soundsPage(), soundboard: () => soundboardPage(), notifications: () => notificationsPage(), keys: () => keysPage(), extras: () => extrasPage(ctx), advanced: () => advancedPage(ctx), news: () => newsPage(), report: () => reportPage(), app: () => appPage(), lite: () => litePage(ctx),
    overview: () => overviewPage(gid), channels: () => channelsPage(gid), roles: () => rolesPage(gid), emojis: () => emojisPage(gid), sounds_srv: () => serverSoundsPage(gid), members: () => membersPage(gid), bans: () => bansPage(gid), audit: () => auditPage(gid), invites: () => invitesPage(gid),
  };
  const sKey = (k) => (isServer && k === 'sounds' ? 'sounds_srv' : k);
  let current;
  const show = (key) => { cleanups.forEach(f => f()); cleanups.length = 0; current = key; pane.replaceChildren(); pane.replaceChildren(R[sKey(key)](reg)); nav.querySelectorAll('.ni').forEach(n => n.classList.toggle('active', n.dataset.k === key)); content.scrollTop = 0; };
  const search = h('input.nsearch', { placeholder: 'Buscar configuração…', oninput: () => drawNav() });
  const groups = isServer ? [[guild(gid)?.name || 'Servidor', SERVER_PAGES]] : USER_GROUPS.map(([t, l]) => [t, desktop && t.includes('aplicativo') ? [...l, ['app', 'Aplicativo (desktop)', 'iniciar bandeja hardware']] : l]);
  const drawNav = () => {
    const q = search.value.trim().toLowerCase();
    nav.replaceChildren(h('div.ninner', search, ...groups.flatMap(([title, items]) => {
      const list = items.filter(([k, l, kw]) => !q || (l + ' ' + kw).toLowerCase().includes(q));
      return list.length ? [h('h6', title), ...list.map(([k, l]) => h('div.ni' + (k === current ? '.active' : ''), { 'data-k': k, onclick: () => show(k) }, l, k === 'lite' && liteOn() && h('span.nlite', { title: 'O modo leve está ligado neste computador' }, 'Ativo')))] : [];
    }), !isServer && h('div', { style: { height: '1px', background: 'var(--divider)', margin: '10px 8px' } }),
    !isServer && h('div.ni.danger', { onclick: async () => { if (await confirmBox('Sair', 'Deseja sair da sua conta?', 'Sair')) ctx.logout(); } }, 'Sair'),
    h('div.nfoot', 'Resenha' + (desktop ? ' Desktop' : ' Web'))));
  };
  root.append(nav, content, h('button.close', { onclick: close, title: 'Fechar (Esc)' }, icon('x', 20), h('small', 'ESC')));
  document.getElementById('layer').append(root); document.addEventListener('keydown', esc);
  const first = isServer ? 'overview' : (['account', 'profile', 'privacy', 'connections', 'appearance', 'accessibility', 'voice', 'stream', 'sounds', 'soundboard', 'notifications', 'keys', 'extras', 'advanced', 'app', 'lite', 'news', 'report'].includes(kind) ? kind : 'account');
  current = first; drawNav(); show(first);
  root._close = close;
  document.addEventListener('lite-changed', onLite);
}

// ============================ Conta ============================
function accountPage(close) {
  const me = S.me;
  return h('div', h('h2', 'Minha conta'),
    card(h('div.accrow', avatar(me, 80), h('div', h('div.big', me.display_name), h('div.mut', '@' + me.username))),
      row('Nome de usuário', '@' + me.username, h('button.btn.grey', { onclick: usernameDialog }, 'Alterar')),
      row('Nome de exibição', me.display_name, h('button.btn.grey', { onclick: async () => { const n = await promptBox('Nome de exibição', 'Como você aparece para os outros', me.display_name, 'Salvar'); if (n) { await tryApi('PATCH', '/me', { display_name: n }); toast('Nome atualizado'); } } }, 'Editar'))),
    section('Senha'), card(passwordForm()),
    section('Remoção da conta'), card(hint('Excluir apaga seu perfil, suas mensagens, seus servidores (como dono) e remove você de todos os outros. Não dá para desfazer.'), h('button.btn.red', { onclick: () => deleteDialog(close) }, 'Excluir conta')));
}
function passwordForm() {
  const o = h('input', { type: 'password', autocomplete: 'current-password' }), n = h('input', { type: 'password', autocomplete: 'new-password' }), n2 = h('input', { type: 'password', autocomplete: 'new-password' });
  return h('div', h('label.f', 'Senha atual', o), h('label.f', 'Nova senha', n), h('label.f', 'Confirmar nova senha', n2),
    h('button.btn', { onclick: async () => { if (n.value !== n2.value) return toast('As senhas não coincidem', true); if (await tryApi('POST', '/me/password', { old: o.value, new: n.value })) { toast('Senha alterada!'); o.value = n.value = n2.value = ''; } } }, 'Alterar senha'));
}
function usernameDialog() {
  const u = h('input', { value: S.me.username, maxLength: 32 }), p = h('input', { type: 'password' });
  modal('Alterar nome de usuário', 'Seus amigos usam esse nome para te adicionar.', h('div', h('label.f', 'Novo nome de usuário', u), h('label.f', 'Senha atual', p)),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Salvar', fn: async () => { if (await tryApi('POST', '/me/username', { username: u.value, password: p.value })) toast('Nome de usuário alterado'); else return false; } }]);
}
function deleteDialog(close) {
  const p = h('input', { type: 'password' });
  modal('Excluir conta', 'Digite sua senha para confirmar. Esta ação é permanente.', h('label.f', 'Senha', p),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Excluir minha conta', cls: 'red', fn: async () => { if (await tryApi('POST', '/me/delete', { password: p.value })) { localStorage.removeItem('lc_token'); location.reload(); } else return false; } }]);
}

// ============================ Perfil ============================
function profilePage({ full } = {}) {
  const me = S.me;
  const base = () => ({ name_style: me.name_style ? { ...me.name_style } : null, theme_primary: me.theme_primary || null, theme_accent: me.theme_accent || null, display_name: me.display_name, avatar: me.avatar, banner: me.banner, avatar_pos: me.avatar_pos || '', banner_pos: me.banner_pos || '', color: me.color, banner_color: me.banner_color || me.color, pronouns: me.pronouns || '', bio: me.bio || '', custom_status: me.custom_status || '', status_emoji: me.status_emoji || '' });
  const d = base(), wrap = h('div.profile-ed'), prevBox = h('div.preview'), bar = h('div.savebar.hidden');
  const draft = () => ({ ...me, ...d, status: me.status === 'invisible' ? 'invisible' : 'online' });
  const redraw = () => { prevBox.replaceChildren(h('div.popout.static', profileCard(draft(), { accent: d.banner ? null : d.banner_color, onEditAvatar: editAvatar, onEditBanner: editBanner }))); };
  const touch = () => { bar.classList.remove('hidden'); redraw(); };
  const changeAvatar = () => avatarPicker(d.avatar, (url, pos) => { d.avatar = url; d.avatar_pos = pos; touch(); });
  const editAvatar = (av) => { const r = av.getBoundingClientRect(); menu({ preventDefault() {}, clientX: r.left, clientY: r.bottom + 6 }, [{ label: 'Trocar avatar', fn: changeAvatar },
    d.avatar && { label: 'Ajustar avatar', fn: () => positionEditor('avatar', d.avatar, d.avatar_pos, (v) => { d.avatar_pos = v; touch(); }) },
    d.avatar && { label: 'Remover avatar', danger: true, fn: () => { d.avatar = null; touch(); } }]); };
  const changeBanner = async () => { const u = await uploadImage(); if (u) positionEditor('banner', u.url, '', (v) => { d.banner = u.url; d.banner_pos = v; touch(); }); };
  const editBanner = (e) => menu({ preventDefault() {}, clientX: e.clientX, clientY: e.clientY }, [{ label: 'Trocar banner', fn: changeBanner },
    d.banner && { label: 'Ajustar banner', fn: () => positionEditor('banner', d.banner, d.banner_pos, (v) => { d.banner_pos = v; touch(); }) },
    d.banner && { label: 'Remover banner', danger: true, fn: () => { d.banner = null; touch(); } }]);
  const bind = (key, input) => { input.value = d[key]; input.oninput = () => { d[key] = input.value; touch(); }; return input; };
  const emojiBtn = h('button.btn.grey', { style: { minWidth: '44px' }, title: 'Escolher emoji', onclick: (e) => emojiPicker(e.currentTarget, (em) => { d.status_emoji = em.startsWith('<:') ? '' : em; emojiBtn.replaceChildren(d.status_emoji || icon('smile', 20)); touch(); }, { noCustom: true }) }, d.status_emoji || icon('smile', 20));
  const left = h('div.col',
    card(h('label.f', 'Nome de exibição', bind('display_name', h('input', { maxLength: 32 }))),
      h('label.f', 'Cor do avatar'), swatches(d.color, (c) => { d.color = c; touch(); }), h('label.f', { style: { marginTop: '16px' } }, 'Cor do banner / destaque'), swatches(d.banner_color, (c) => { d.banner_color = c; touch(); }), hint('Com tema do perfil ativo, o banner sem imagem usa a cor principal do tema.')),
    nameStyleCard(d, touch),
    profileThemeCard(d, touch),
    card(h('label.f', 'Status personalizado'), h('div.btns', emojiBtn, bind('custom_status', h('input', { maxLength: 100, placeholder: 'O que você está fazendo?', style: { flex: 1, background: 'var(--bg-tert)', border: 0, borderRadius: '3px', padding: '10px', minWidth: 0 } }))),
      h('label.f', { style: { marginTop: '16px' } }, 'Presença', seg({ online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível' }, me.status, (v) => tryApi('PATCH', '/me', { status: v }))),
      h('label.f', { style: { marginTop: '16px' } }, 'Sobre mim', bind('bio', h('textarea', { rows: 4, maxLength: 300 })))));
  bar.append(h('span', 'Cuidado — você tem alterações não salvas!'), h('div.btns', h('button.btn.link', { onclick: () => { Object.assign(d, base()); bar.classList.add('hidden'); redraw(); wrap.replaceWith(profilePage({ full })); } }, 'Redefinir'),
    h('button.btn.green', { onclick: async () => { const r = await tryApi('PATCH', '/me', { display_name: d.display_name, avatar: d.avatar || '', banner: d.banner || '', avatar_pos: d.avatar_pos || '', banner_pos: d.banner_pos || '', color: d.color, banner_color: d.banner_color, pronouns: d.pronouns, bio: d.bio, custom_status: d.custom_status, status_emoji: d.status_emoji, theme_primary: d.theme_primary || '', theme_accent: d.theme_accent || '', name_style: d.name_style }); if (r) { toast('Perfil salvo!'); bar.classList.add('hidden'); } } }, 'Salvar alterações')));
  wrap.append(h('h2', 'Perfil'), h('div.pgrid', left, h('div.col', h('div.fh', 'Prévia'), prevBox)), bar);
  redraw(); return wrap;
}
// "perfil completo": estilos à esquerda (avatar, banner, cores, tema, estilo do nome) e a prévia do cartão à direita
export function openFullProfile() {
  modal('Seu perfil completo', 'Edite avatar, banner, tema e informações. A prévia mostra como os outros veem o seu perfil.', profilePage({ full: true }), [{ label: 'Fechar', cls: 'link' }], { width: '1040px' });
}

// estilo do nome: fonte, efeito e até duas cores; a prévia ao lado mostra o resultado
function nameStyleCard(d, touch) {
  const box = h('div.nstyle'), name = () => d.display_name || S.me.username;
  const cur = () => d.name_style || { font: 'default', effect: 'solid', c1: '#5865f2', c2: '#eb459e' };
  const upd = (patch) => { d.name_style = { ...cur(), ...patch }; touch(); draw(); };
  const sample = (ns) => styleName(h('span', name()), ns);
  const colorIn = (key, label) => {
    const val = h('span', { style: { fontFamily: 'Consolas, monospace', fontSize: '14px', color: 'var(--text-strong)' } }, cur()[key].toUpperCase());
    const pick = h('input', { type: 'color', value: cur()[key], oninput: () => { d.name_style = { ...cur(), [key]: pick.value }; val.textContent = pick.value.toUpperCase(); touch(); box.querySelectorAll('.nsgrid span.ns').forEach(s => s.style.setProperty(key === 'c1' ? '--n1' : '--n2', pick.value)); } });
    return h('div.pcol', h('label.f', { style: { marginBottom: 0 } }, label), h('div', pick, val));
  };
  const draw = () => {
    const s = cur(), two = TWO_COLOR_EFFECTS.has(s.effect);
    box.replaceChildren(
      hint('Muda como seu nome aparece nas mensagens, na lista de membros e no seu perfil. Todo mundo vê.'),
      h('label.f', { style: { margin: '12px 0 0' } }, 'Fonte'),
      h('div.nsgrid', Object.entries(NAME_FONTS).map(([k, l]) => h('button' + (s.font === k ? '.on' : ''), { onclick: () => upd({ font: k }) }, sample({ ...s, font: k }), h('small', l)))),
      h('label.f', { style: { margin: 0 } }, 'Efeito'),
      h('div.nsgrid', Object.entries(NAME_EFFECTS).map(([k, l]) => h('button' + (s.effect === k ? '.on' : ''), { onclick: () => upd({ effect: k }) }, sample({ ...s, effect: k }), h('small', l)))),
      s.effect !== 'rainbow' && h('div.ptheme', h('div.pcols', colorIn('c1', two ? 'Cor 1' : 'Cor'), two && colorIn('c2', s.effect === 'gradient' || s.effect === 'shimmer' ? 'Cor 2' : 'Cor do efeito'))),
      d.name_style && h('div.pfoot', h('span'), h('button.btn.grey', { onclick: () => { d.name_style = null; touch(); draw(); } }, 'Remover estilo')));
  };
  draw();
  return card(h('label.f', { style: { marginBottom: '4px' } }, 'Estilo do nome'), box);
}

// tema do perfil: duas cores (principal → destaque), prontos ou colados do discordthemes.com
function profileThemeCard(d, touch) {
  const ctls = {}, gal = h('div.pgal'), foot = h('div.pfoot');
  const sync = () => { // atualiza campos, galeria e rodapé sem recriar os seletores (o nativo fecharia no meio do arraste)
    for (const [k, c] of Object.entries(ctls)) { if (document.activeElement !== c.txt) c.txt.value = d[k]?.toUpperCase() || ''; if (d[k]) c.pick.value = d[k]; }
    gal.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', d.theme_primary === PROFILE_THEMES[i].p && d.theme_accent === PROFILE_THEMES[i].a));
    foot.replaceChildren(h('a', { href: 'https://discordthemes.com/', target: '_blank', rel: 'noopener' }, 'Mais temas em discordthemes.com →'),
      d.theme_primary && h('button.btn.grey', { onclick: () => set(null, null) }, 'Remover tema'));
  };
  const set = (p, a) => { d.theme_primary = p; d.theme_accent = a; touch(); sync(); };
  const colorCtl = (label, key) => {
    const other = key === 'theme_primary' ? 'theme_accent' : 'theme_primary';
    // a primeira cor escolhida vale para as duas, para o tema já aparecer
    const apply = (v) => { d[key] = v; d[other] ||= v; touch(); sync(); };
    const txt = h('input', { type: 'text', maxLength: 7, placeholder: '#000000', onchange: () => { const v = parseColorPair(txt.value)?.[0]; if (v) apply(v); else sync(); } });
    const pick = h('input', { type: 'color', value: '#5865f2', oninput: () => apply(pick.value) });
    ctls[key] = { txt, pick };
    return h('div.pcol', h('label.f', { style: { marginBottom: 0 } }, label), h('div', pick, txt));
  };
  const paste = h('input.ppaste', { placeholder: 'Cole as cores aqui (ex.: #53aba9 #2f4451)', oninput: () => { const pr = parseColorPair(paste.value); if (pr) { paste.value = ''; set(...pr); toast('Cores aplicadas na prévia'); } } });
  gal.append(...PROFILE_THEMES.map(t => h('button' + (isLightPair(t.p, t.a) ? '.tlight' : '.tdark'),
    { title: t.name + (t.dt ? ' — discordthemes.com' : '') + `
${t.p} → ${t.a}`, style: { background: `linear-gradient(${t.p}, ${t.a})` }, onclick: () => set(t.p, t.a) }, t.name)));
  const box = h('div.ptheme', hint('Duas cores viram o fundo do seu cartão: a principal no topo e a de destaque embaixo. Todo mundo vê.'),
    h('div.pcols', colorCtl('Principal', 'theme_primary'), colorCtl('Destaque', 'theme_accent')), paste, gal, foot);
  sync();
  return card(h('label.f', { style: { marginBottom: '4px' } }, 'Tema do perfil'), box);
}

// ============================ Privacidade ============================
const agentName = (a) => {
  const b = /Electron/.test(a) ? 'Resenha Desktop' : /Edg\//.test(a) ? 'Edge' : /Firefox/.test(a) ? 'Firefox' : /Chrome/.test(a) ? 'Chrome' : /Safari/.test(a) ? 'Safari' : 'Navegador';
  const o = /Windows/.test(a) ? 'Windows' : /Android/.test(a) ? 'Android' : /iPhone|iPad/.test(a) ? 'iOS' : /Mac/.test(a) ? 'macOS' : /Linux/.test(a) ? 'Linux' : '';
  return `${b}${o ? ' em ' + o : ''}`;
};
// lista de bloqueados (antes era uma aba em Amigos)
function blockedCard() {
  const box = card();
  const draw = () => {
    const list = [...S.rels.values()].filter(r => r.type === 2);
    box.replaceChildren(...(list.length ? list.map(r => { const u = S.users.get(r.user.id) || r.user; return h('div.frow.blk', { style: { cursor: 'default' } }, avatar(u, 36, { status: false }), h('div.fn', h('b', u.display_name), h('small', '@' + u.username)),
      h('button.btn.grey', { onclick: async () => { if (await tryApi('DELETE', `/relationships/${u.id}`)) { S.rels.delete(u.id); draw(); toast(`${u.display_name} desbloqueado`); } } }, 'Desbloquear')); })
      : [hint('Você não bloqueou ninguém. Para bloquear, clique com o botão direito em alguém → Bloquear.')]));
  };
  draw(); return box;
}
function privacyPage(reg) {
  const sessions = h('div');
  const draw = async () => {
    const list = await tryApi('GET', '/sessions') || [];
    sessions.replaceChildren(...list.map(s => h('div.frow', { style: { cursor: 'default' } }, h('div.fn', h('b', agentName(s.agent)), h('small', `${s.current ? 'Este dispositivo • ' : ''}entrou em ${new Date(+s.created_at).toLocaleString('pt-BR')}`)),
      !s.current && h('button.btn.red', { onclick: async () => { await tryApi('DELETE', `/sessions/${s.id}`); draw(); } }, 'Encerrar'))));
  };
  draw();
  return h('div', h('h2', 'Privacidade e segurança'),
    section('Pedidos de amizade'), card(seg({ all: 'Qualquer pessoa pode enviar', none: 'Ninguém pode enviar' }, S.friendPolicy || 'all', (v) => { S.friendPolicy = v; api('PUT', '/me/settings', { friend_policy: v }).catch(e => toast(e.message, true)); })),
    section('Usuários bloqueados'), blockedCard(),
    section('Links'), card(row('Confirmar antes de abrir links externos', 'Mostra o endereço antes de abrir.', toggle(!!S.prefs.confirmLinks, v => { S.prefs.confirmLinks = v; save(); }))),
    section('Dispositivos conectados'), card(hint('Encerre sessões que você não reconhece.'), sessions, h('button.btn.red', { style: { marginTop: '12px' }, onclick: async () => { if (await confirmBox('Sair de todos os outros dispositivos', 'Essas sessões precisarão entrar de novo.', 'Encerrar todas')) { await tryApi('DELETE', '/sessions'); draw(); } } }, 'Encerrar todas as outras sessões')));
}

// ============================ Aparência / acessibilidade ============================
function appearancePage() {
  const th = h('div.cards'), gr = h('div.cards'), val = h('div.cards'), mine = h('div.cards');
  const pick = (k) => { S.prefs.theme = k; save(); applyTheme(); drawTh(); };
  const gcard = (k, t, extra) => h('div.ncard.tgrad' + (t.base === 'light' ? '.light' : '') + (S.prefs.theme === k ? '.on' : ''), { style: { background: gradientCss(t) }, onclick: () => pick(k) }, extra, h('b', t.name));
  const drawTh = () => {
    th.replaceChildren(...Object.entries(SOLID_THEMES).map(([k, l]) => h('div.ncard.theme-' + k + (S.prefs.theme === k ? '.on' : ''), { onclick: () => pick(k) }, h('b', l))));
    const preset = ([k, t]) => gcard('g:' + k, t, h('div.tact', h('button', { title: 'Personalizar uma cópia', onclick: (e) => { e.stopPropagation(); openThemeEditor({ ...t, name: t.name + ' (cópia)' }, { onExit: drawTh }); } }, icon('edit', 14))));
    const all = Object.entries(GRADIENT_THEMES);
    gr.replaceChildren(...all.filter(([, t]) => !t.group).map(preset));
    val.replaceChildren(...all.filter(([, t]) => t.group === 'valorant').map(preset));
    mine.replaceChildren(...(S.prefs.customThemes || []).map(t => gcard('c:' + t.id, t, h('div.tact',
      h('button', { title: 'Copiar código para compartilhar', onclick: (e) => { e.stopPropagation(); shareTheme(t); } }, icon('link', 14)),
      h('button', { title: 'Editar', onclick: (e) => { e.stopPropagation(); openThemeEditor(t, { onExit: drawTh }); } }, icon('edit', 14)),
      h('button', { title: 'Excluir', onclick: async (e) => { e.stopPropagation(); if (await confirmBox('Excluir tema', `"${t.name}" será removido.`, 'Excluir')) { S.prefs.customThemes = S.prefs.customThemes.filter(x => x !== t); if (S.prefs.theme === 'c:' + t.id) S.prefs.theme = t.base; save(); applyTheme(); drawTh(); } } }, icon('trash', 14))))),
      h('div.ncard.tnew', { onclick: () => openThemeEditor(null, { onExit: drawTh }) }, icon('palette', 20), h('small', 'Criar tema')),
      h('div.ncard.tnew', { onclick: async () => { const code = await promptBox('Importar tema', 'Cole o código do tema', '', 'Importar'); if (code == null) return; const t = decodeTheme(code); if (!t) return toast('Código de tema inválido', true); openThemeEditor(t, { onExit: drawTh }); } }, icon('dl', 20), h('small', 'Importar código')));
  };
  drawTh();
  const set = (k) => (v) => { S.prefs[k] = v; save(); applyTheme(); };
  return h('div', h('h2', 'Aparência'), section('Tema'), card(th),
    section('Temas em gradiente'), card(gr, hint('Passe o mouse num tema e clique no lápis para criar uma versão sua a partir dele.')),
    section('Agentes do Valorant'), card(val, hint('Um tema para cada agente, nas cores dele.')),
    section('Seus temas'), card(mine, hint('Crie um gradiente com até 5 cores e compartilhe: o código colado no chat vira um cartão com o botão "Usar tema".')),
    section('Cor de destaque'), card(swatches(S.prefs.accent, (c) => { S.prefs.accent = c; save(); applyTheme(); })),
    section('Fonte'), card(h('label.f', 'Família da fonte', seg({ default: 'Padrão', rounded: 'Arredondada', serif: 'Serifada', mono: 'Monoespaçada', dyslexia: 'Legível (dislexia)' }, S.prefs.fontFamily, set('fontFamily'))),
      h('label.f', 'Tamanho da interface', slider(80, 140, S.prefs.zoom, 5, set('zoom'), v => v + '%'))),
    section('Mensagens'), card(row('Modo compacto', 'Mostra o autor em todas as mensagens.', toggle(S.prefs.compact, v => { S.prefs.compact = v; save(); })),
      h('label.f', { style: { marginTop: '12px' } }, 'Espaço entre grupos de mensagens', slider(0, 32, S.prefs.msgGap, 1, set('msgGap'), v => v + 'px')),
      h('label.f', 'Arredondamento dos cartões', slider(0, 20, S.prefs.radius, 1, set('radius'), v => v + 'px')),
      h('label.f', 'Formato da hora', seg({ 0: '24 horas', 1: '12 horas (AM/PM)' }, S.prefs.hour12 ? 1 : 0, (v) => { S.prefs.hour12 = !!v; save(); applyTheme(); })),
      row('Mostrar imagens de links no chat', 'Pré-visualiza links que terminam em .png/.jpg/.gif.', toggle(S.prefs.embedLinks !== false, v => { S.prefs.embedLinks = v; save(); })),
      row('Cores dos cargos nos nomes', null, toggle(S.prefs.roleColors !== false, v => { S.prefs.roleColors = v; save(); }))),
    section('Animações'), card(row('Animações aprimoradas', 'Transições suaves ao trocar de canal, abrir janelas e menus e receber mensagens. "Reduzir animações" em Acessibilidade tem prioridade.', toggle(S.prefs.animations !== false, set('animations')))),
    section('Avatares e banners animados'), card(h('label.f', 'Avatares e banners em GIF/WebP', seg({ always: 'Sempre', speak: 'Na chamada, só quando fala', never: 'Nunca (desligar todas)' }, S.prefs.animMode || 'always', (v) => { S.prefs.animMode = v; save(); refreshFreeze(); }))),
    section('Tradução'), card(
      h('label.f', 'Traduzir mensagens para', (() => { const s = h('select', { onchange: () => { S.prefs.trLang = s.value; save(); } }, Object.entries(LANGS).map(([k, l]) => h('option', { value: k, selected: myLang() === k }, l))); return s; })()),
      row('Manter o original ao enviar com $idioma', 'Ex.: "$en bom dia" envia "good morning" e, em spoiler, o texto original.', toggle(!!S.prefs.trSendOriginal, v => { S.prefs.trSendOriginal = v; save(); }))),
    hint('Clique direito numa mensagem → Traduzir. No compositor, o botão de tradução converte o rascunho. O texto passa pelo servidor, que usa o tradutor configurado (LIBRETRANSLATE_URL ou Google).'));
}
// ============================ Recursos extras (inspirados em plugins) ============================
function extrasPage(ctx) {
  const P = S.prefs, set = (k, after) => (v) => { P[k] = v; save(); after?.(); };
  // nomes de canais: prévia ao vivo com exemplos
  const SAMPLES = ['bate-papo', 'regras_e_avisos', '🎮-jogos-de-rpg', 'faq-do-servidor'];
  const demo = h('div.chdemo');
  const drawDemo = () => demo.replaceChildren(...SAMPLES.map(n => h('div.chdemo-row', h('span.from', '# ' + n), h('span.arrow', '→'), h('b', '# ' + prettyName(n)))));
  const words = h('input', { value: P.chNameWords ?? DEFAULT_NAME_WORDS, placeholder: DEFAULT_NAME_WORDS, oninput: () => { P.chNameWords = words.value; save(); drawDemo(); } });
  drawDemo();
  // volumes salvos
  const vols = h('div');
  const drawVols = () => {
    const ent = Object.entries(P.userVolumes || {});
    vols.replaceChildren(row('Volumes salvos por pessoa', ent.length ? ent.map(([id, v]) => `${nameOf(id)}: ${v}%`).join(' • ') : 'Nenhum — todos em 100%.',
      ent.length > 0 && h('button.btn.grey', { onclick: () => { P.userVolumes = {}; P.streamVolumes = {}; save(); ctx?.voice?.peers.forEach((_, id) => ctx.voice.applyVolume(id)); drawVols(); toast('Volumes redefinidos para 100%'); } }, 'Redefinir')));
  };
  drawVols();
  return h('div', h('h2', 'Recursos extras'),
    hint('Recursos inspirados em plugins populares da comunidade, feitos do zero para a Resenha.'),
    section('Visualizador de imagens'),
    card(
      row('Lente de zoom no clique', 'Desligado: segure o botão do mouse sobre a imagem. Ligado: um clique liga e outro desliga.', toggle(!!P.lensClick, set('lensClick'))),
      row('Lente pixelada', 'Mostra os pixels nítidos ao ampliar, em vez de suavizar.', toggle(!!P.lensPixel, set('lensPixel'))),
      h('label.f', { style: { marginTop: '12px' } }, 'Tamanho da lente', slider(100, 500, P.lensSize ?? 220, 10, set('lensSize'), v => v + ' px')),
      h('label.f', 'Ampliação da lente', slider(1.5, 12, P.lensZoom ?? 3, .5, set('lensZoom'), v => v + '×'))),
    hint('No visualizador: ← → trocam de imagem do canal, R gira, F alterna tamanho real, roda do mouse com a lente muda o zoom e Shift + roda muda o tamanho. Clique com o botão direito numa imagem para copiar, salvar ou abrir no navegador.'),
    section('Prévia de canais'),
    card(
      h('label.f', 'Como abrir a prévia', seg(PREVIEW_TRIGGERS, P.chPreview ?? 'hover', set('chPreview'))),
      h('label.f', { style: { marginTop: '12px' } }, 'Atraso ao passar o mouse', slider(100, 2000, P.chPreviewDelay ?? 450, 50, set('chPreviewDelay'), v => (v / 1000).toFixed(2).replace('.', ',') + ' s')),
      h('label.f', 'Quantidade de mensagens', slider(10, 100, P.chPreviewCount ?? 20, 5, set('chPreviewCount'))),
      h('label.f', 'Altura da prévia', slider(20, 90, P.chPreviewHeight ?? 45, 5, set('chPreviewHeight'), v => v + '% da janela')),
      h('label.f', 'Escurecer o chat atrás da prévia', slider(0, 70, P.chPreviewDim ?? 0, 5, set('chPreviewDim'), v => v + '%')),
      row('Mostrar quem está digitando', null, toggle(P.chPreviewTyping !== false, set('chPreviewTyping')))),
    hint('A prévia não abre o canal nem marca as mensagens como lidas.'),
    section('Nomes de canais'),
    card(
      row('Maiúscula no início das palavras', null, toggle(!!P.chCaps, set('chCaps', drawDemo))),
      row('Trocar hífens e sublinhados por espaços', null, toggle(!!P.chDashes, set('chDashes', drawDemo))),
      row('Remover emojis do nome', null, toggle(!!P.chNoEmoji, set('chNoEmoji', drawDemo))),
      row('Aplicar também em canais de voz', null, toggle(!!P.chNamesVoice, set('chNamesVoice'))),
      h('label.f', { style: { marginTop: '12px' } }, 'Palavras com grafia fixa (separadas por vírgula)', words),
      demo),
    hint('Só muda como os nomes aparecem para você: na lista, no topo, na caixa de mensagem e nas abas. O nome real do canal continua o mesmo.'),
    section('Volume das pessoas'),
    card(vols),
    hint(`Clique com o botão direito em alguém na chamada → "Volume do usuário" para digitar valores até ${MAX_VOL}% (acima de 100% o som é amplificado). Também dá para ajustar cada pessoa no menu de saída de áudio (seta ao lado do fone).`));
}

function accessibilityPage() {
  const set = (k) => (v) => { S.prefs[k] = v; save(); applyTheme(); };
  return h('div', h('h2', 'Acessibilidade'),
    card(row('Reduzir animações', 'Desliga transições e movimentos.', toggle(S.prefs.reduceMotion, set('reduceMotion'))), row('Alto contraste', 'Bordas e textos mais fortes.', toggle(S.prefs.highContrast, set('highContrast'))),
      row('Sublinhar links', null, toggle(S.prefs.underlineLinks, set('underlineLinks'))), h('label.f', { style: { marginTop: '12px' } }, 'Saturação das cores', slider(0, 100, S.prefs.saturation, 5, set('saturation'), v => v + '%'))),
    hint('Dica: em Aparência há uma fonte legível para dislexia e o tamanho da interface.'));
}

// ============================ Voz e vídeo ============================
function voicePage(ctx, reg) {
  const voice = ctx.voice;
  const sel = (kind, key, label, after) => {
    const s = h('select', { onchange: () => { S.prefs[key] = s.value; save(); after?.(); } }, h('option', { value: '' }, 'Padrão'));
    navigator.mediaDevices?.enumerateDevices().then(ds => ds.filter(d => d.kind === kind).forEach(d => s.append(h('option', { value: d.deviceId, selected: S.prefs[key] === d.deviceId }, d.label || d.kind))));
    return h('label.f', label, s);
  };
  const meterBar = h('i'), gateMark = h('b.gatemark'), meterWrap = h('div.meter.big', meterBar, gateMark);
  const placeMark = () => { gateMark.style.left = Math.max(0, Math.min(100, (S.prefs.gateDb + 70) / 70 * 100)) + '%'; };
  let test = null, raf = 0, loopback = false, testCtx;
  const stopTest = () => { cancelAnimationFrame(raf); test?.dispose(); test = null; testCtx?.close(); testCtx = null; meterBar.style.width = '0'; testBtn.textContent = 'Testar microfone'; };
  reg(stopTest);
  // reiniciar o teste: um de cada vez (cliques seguidos viram um só); o anterior sempre é desligado antes
  let testBusy = null, testAgain = false;
  const restartTest = () => {
    if (voice.active) voice.rebuildMic();
    if (!test && !testBusy) return;
    if (testBusy) { testAgain = true; return; }
    testBusy = (async () => { do { testAgain = false; stopTest(); await startTest(); } while (testAgain); })().finally(() => { testBusy = null; });
  };
  const startTest = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Acesse via HTTPS ou use o app desktop para usar o microfone.');
      const myCtx = testCtx = newAudioContext(); await myCtx.resume();
      const t = await createMic(S.prefs, myCtx);
      if (testCtx !== myCtx) { t.dispose(); myCtx.close(); return; } // parou (ou recomeçou) enquanto abria o microfone
      test = t; test.setLoopback(loopback);
      if (test.error) toast(test.error, true);
      const buf = new Uint8Array(test.analyser.fftSize);
      const loop = () => { test.analyser.getByteTimeDomainData(buf); let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v - 128)); const db = 20 * Math.log10(Math.max(p / 128, 1e-4)); meterBar.style.width = Math.max(0, Math.min(100, (db + 70) / 70 * 100)) + '%'; raf = requestAnimationFrame(loop); };
      loop(); testBtn.textContent = 'Parar teste';
    } catch (e) { toast(e.message || 'Falha ao acessar o microfone', true); stopTest(); }
  };
  const testBtn = h('button.btn', { onclick: () => (test ? stopTest() : startTest()) }, 'Testar microfone');
  const noiseCards = h('div.cards'), drawNoise = () => noiseCards.replaceChildren(...Object.entries(NOISE_MODES).map(([k, l]) => h('div.ncard' + (S.prefs.noiseMode === k ? '.on' : ''), { onclick: () => { if ((S.prefs.noiseMode || 'standard') === k) return; S.prefs.noiseMode = k; save(); drawNoise(); restartTest(); } },
    h('b', l), h('small', { off: 'Sem processamento. Voz crua.', standard: 'Filtro do navegador; leve e simples.', rnnoise: 'Rede neural RNNoise: remove teclado, ventilador e ruído de fundo.', gtcrn: 'Modelo mais forte; melhor em ruídos difíceis, usa mais CPU.' }[k]))));
  drawNoise(); setTimeout(placeMark, 0);
  const gateLbl = h('span', S.prefs.gateDb + ' dB');
  const gate = h('input', { type: 'range', min: -70, max: -10, value: S.prefs.gateDb, oninput: () => { S.prefs.gateDb = +gate.value; gateLbl.textContent = gate.value + ' dB'; placeMark(); }, onchange: () => { save(); restartTest(); } });
  const pttBtn = captureKey(h('button.btn.grey'), S.prefs.pttKey, (c) => { S.prefs.pttKey = c; save(); }, { combo: false, label: 'Tecla de push-to-talk: ' });
  const dev = (kind) => async () => { try { const s = await navigator.mediaDevices.getUserMedia(kind === 'cam' ? { video: true } : { audio: true }); s.getTracks().forEach(t => t.stop()); toast('Permissão concedida. Reabra a página para listar os nomes.'); } catch (e) { toast(e.message, true); } };
  const camPrev = h('video', { autoplay: true, muted: true, playsInline: true, style: { width: '100%', borderRadius: '8px', background: '#000', display: 'none', marginTop: '12px' } });
  let camStream; reg(() => camStream?.getTracks().forEach(t => t.stop()));
  const camBtn = h('button.btn.grey', { onclick: async () => { if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; camPrev.style.display = 'none'; return; } try { camStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: S.prefs.videoId ? { exact: S.prefs.videoId } : undefined, height: { ideal: S.prefs.camRes }, frameRate: { ideal: S.prefs.camFps } } }); camPrev.srcObject = camStream; camPrev.style.display = 'block'; } catch (e) { toast('Câmera: ' + e.message, true); } } }, 'Testar câmera');
  return h('div', h('h2', 'Voz e vídeo'),
    card(sel('audioinput', 'inputId', 'Dispositivo de entrada', restartTest), sel('audiooutput', 'outputId', 'Dispositivo de saída', () => applyOutput(voice)),
      h('label.f', 'Volume do microfone', slider(0, 200, S.prefs.inputVolume, 5, v => { S.prefs.inputVolume = v; save(); if (test) test.gain.gain.value = v / 100; if (voice.micGraph) voice.micGraph.gain.gain.value = v / 100; }, v => v + '%')),
      h('label.f', 'Volume geral da voz', slider(0, 100, S.prefs.volume, 5, v => { S.prefs.volume = v; save(); voice.peers.forEach((_, id) => voice.applyVolume(id)); }, v => v + '%')),
      !navigator.mediaDevices?.enumerateDevices ? null : h('button.btn.grey', { onclick: dev('mic') }, 'Pedir permissão do microfone')),
    section('Supressão de ruído'), card(noiseCards,
      row('Porta de ruído', 'Silencia o microfone abaixo do limite. Útil com teclado mecânico e ventoinhas.', toggle(S.prefs.gate, v => { S.prefs.gate = v; save(); restartTest(); })),
      h('label.f', { style: { marginTop: '12px' } }, 'Limite da porta: ', gateLbl, gate),
      row('Cancelamento de eco', 'Evita retorno do som dos alto-falantes.', toggle(S.prefs.echo !== false, v => { S.prefs.echo = v; save(); restartTest(); })),
      row('Ganho automático', 'Equaliza o volume da sua voz.', toggle(S.prefs.agc !== false, v => { S.prefs.agc = v; save(); restartTest(); }))),
    section('Teste de microfone'), card(h('div.btns', testBtn, h('span', { style: { color: 'var(--text-muted)' } }, 'Ouvir a mim mesmo (use fones!)'), toggle(false, (v) => { loopback = v; test?.setLoopback(v); })), meterWrap),
    section('Modo de entrada'), card(seg({ vad: 'Atividade de voz', ptt: 'Push-to-talk' }, S.prefs.inputMode, v => { S.prefs.inputMode = v; save(); voice.applyMute(); }), h('div', { style: { marginTop: '12px' } }, pttBtn), hint('O push-to-talk funciona com a janela do app em foco.')),
    section('Qualidade da voz'), card(h('label.f', 'Taxa de bits do áudio', seg(VOICE_BITRATES, S.prefs.voiceBitrate ?? 'auto', v => { S.prefs.voiceBitrate = v; save(); voice?.retuneAudio(); })), hint('Automático: voz mono a 64 kbps, que já soa perfeita; desce para 48 ou 32 kbps se a sua conexão tiver perda ou ping alto. 128 kbps ou mais só faz diferença para música e pesa para todos: o servidor repassa a sua voz para cada pessoa da sala. O nível atual aparece no painel de voz.')),
    section('Efeitos de voz'), card(row('Ouvir efeitos de voz dos outros', 'Desligado: você ouve todo mundo com a voz normal, mesmo quem estiver usando efeito. Dá também para desligar só de uma pessoa (clique direito nela → "Ouvir sem efeito de voz").', toggle(S.prefs.hearFx !== false, v => { S.prefs.hearFx = v; save(); if (voice) for (const uid of voice.peers.keys()) voice.applyVolume(uid); }))),
    section('Câmera'), card(sel('videoinput', 'videoId', 'Câmera'), h('label.f', 'Resolução', seg({ 360: '360p', 720: '720p', 1080: '1080p' }, S.prefs.camRes, v => { S.prefs.camRes = v; save(); })), h('label.f', 'Quadros por segundo', seg({ 15: '15', 30: '30', 60: '60' }, S.prefs.camFps, v => { S.prefs.camFps = v; save(); })), camBtn, camPrev),
    section('Diagnóstico'), card(h('button.btn.grey', { onclick: async () => { const st = voice.active ? await voice.stats() : []; modal('Diagnóstico de voz', voice.active ? 'Conexões com os outros participantes' : 'Você não está em uma sala de voz', h('div', ...st.map(s => row(user(s.uid).display_name, `estado: ${s.state}`, h('b', s.rtt != null ? s.rtt + ' ms' : '—'))), !st.length && hint('Entre em uma sala de voz para ver os dados.')), [{ label: 'Fechar' }]); } }, 'Ver conexões agora'),
      h('button.btn.grey', { style: { marginLeft: '8px' }, onclick: () => { voice.active ? voice.rebuildMic().then(() => toast('Áudio reiniciado')) : toast('Entre em uma sala primeiro', true); } }, 'Reiniciar áudio')),
    !window.isSecureContext && card(hint([h('span.hint-ic', icon('warn', 16)), 'Conexão não segura (HTTP): navegadores só liberam microfone/câmera/tela em HTTPS. Use https://…:3443 ou o aplicativo desktop.'])));
}

// ============================ Transmissão ============================
function streamPage() {
  const o = { res: 1080, fps: 30, hint: 'motion', audio: true, ...S.prefs.screen };
  const commit = () => { S.prefs.screen = { res: o.res, fps: o.fps, hint: o.hint, audio: o.audio }; save(); };
  return h('div', h('h2', 'Transmissão de tela'), hint('Esses são os valores iniciais ao clicar em "Transmitir tela". Você ainda escolhe a tela/janela e pode mudar a qualidade durante a transmissão.'),
    card(qualityPanel(o, commit), row('Compartilhar áudio do sistema por padrão', null, toggle(o.audio, v => { o.audio = v; commit(); }))),
    section('Experimental'),
    card(row('Teste: transmissão a 120 FPS', 'A transmissão normal fica limitada a ~48 FPS pelo Windows. Este teste usa um programa à parte (pacote de teste) que captura sem esse limite, e mede aqui quantos quadros chegam. Entre numa sala de voz antes.',
      h('button.btn', { onclick: () => openNativeTest() }, 'Abrir teste'))));
}

// ============================ Sons do app ============================
function soundsPage() {
  const groups = { voz: 'Voz', transmissão: 'Transmissão', chat: 'Mensagens e chamadas' };
  const rowFor = (name) => {
    const [label] = SOUND_DEFS[name], cfg = soundCfg(name);
    const status = h('small.mut', cfg.url ? 'Som personalizado' : 'Som padrão');
    return h('div.srow', h('div.sl1', toggle(cfg.on, v => { cfg.on = v; save(); }), h('div', h('div.rt', label), status)),
      h('div.sl2', slider(0, 100, cfg.vol, 5, v => { cfg.vol = v; save(); }, v => v + '%'),
        h('button.btn.grey', { title: 'Testar', onclick: () => playSound(name, { force: true }) }, '▶'),
        h('button.btn.grey', { title: 'Usar seu próprio áudio (até 1 MB, 5 s)', onclick: async () => { const u = await uploadFile('audio/*', 1); if (u) { cfg.url = u.url; save(); status.textContent = 'Som personalizado'; } } }, icon('music', 16)),
        h('button.btn.link', { title: 'Voltar ao som padrão', onclick: () => { cfg.url = null; save(); status.textContent = 'Som padrão'; } }, icon('refresh', 16))));
  };
  return h('div', h('h2', 'Sons'), card(row('Silenciar todos os sons do app', null, toggle(!!S.prefs.soundsMuted, v => { S.prefs.soundsMuted = v; save(); })), h('label.f', { style: { marginTop: '12px' } }, 'Volume geral dos sons', slider(0, 100, S.prefs.soundVolume, 5, v => { S.prefs.soundVolume = v; save(); }, v => v + '%'))),
    ...Object.entries(groups).flatMap(([g, title]) => [section(title), card(...Object.keys(SOUND_DEFS).filter(n => SOUND_DEFS[n][1] === g).map(rowFor))]),
    hint([icon('music', 14), ' troca o som pelo seu próprio arquivo de áudio; ', icon('refresh', 14), ' volta ao padrão. As configurações acompanham sua conta.']));
}

// ============================ Soundboard (gerenciar) ============================
function soundboardPage() {
  const box = h('div');
  const draw = () => {
    box.replaceChildren(...soundSources().map(src => card(
      h('div.sbtitle', h('b', src.title), src.own ? h('button.btn', { onclick: () => addSound(null) }, '+ Novo som') : [h('small.mut', `${src.sounds.length} som(ns)`), h('span', { style: { flex: 1 } }),
        h('label.sbmute', 'Usar neste servidor', toggle(!src.off, v => { (S.prefs.sbOffGuilds ||= {})[src.key] = !v; save(); }))]),
      ...(src.sounds.length ? src.sounds.map(s => h('div.srow2', h('span.e', soundEmoji(s.emoji)), h('span.n', s.name), h('small.mut', soundVol(s) + '%'),
        h('button.btn.grey', { onclick: () => playLocal(s.url, soundVol(s)) }, '▶'),
        (src.own || (src.guild && can(src.guild.id, PERM.MANAGE_GUILD))) && h('button.btn.grey', { onclick: () => editSound(src, s) }, 'Editar'))) : [h('div.mut', 'Nenhum som ainda.')]))));
  };
  const onChange = () => draw();
  document.addEventListener('sb-changed', onChange); draw(); queueMicrotask(() => whenGone(box, () => document.removeEventListener('sb-changed', onChange)));
  return h('div', h('h2', 'Soundboard'), card(row('Silenciar sons do soundboard', 'Você deixa de ouvir os sons que os outros tocam.', toggle(!!S.prefs.sbMuted, v => { S.prefs.sbMuted = v; save(); })),
    h('label.f', { style: { marginTop: '12px' } }, 'Volume dos sons que você ouve', slider(0, 100, S.prefs.sbVolume ?? 70, 5, v => { S.prefs.sbVolume = v; save(); }, v => v + '%'))),
    hint(['Abra o soundboard rapidamente pelo botão ', icon('soundboard', 14), ' da barra do usuário ou da chamada. Clique direito num som: favoritar, atalho, prévia.']), box);
}

// ============================ Notificações ============================
function notificationsPage() {
  const list = [...S.guilds.values()].map(g => { const cfg = ((S.prefs.notifyCfg ||= {})[g.id] ||= { level: 'all', muted: false, noEveryone: false }); return card(h('div.sbtitle', h('b', g.name), h('span', { style: { flex: 1 } }), h('label.sbmute', 'Silenciar', toggle(cfg.muted, v => { cfg.muted = v; save(); }))), seg({ all: 'Todas', mentions: 'Só @menções', none: 'Nada' }, cfg.level, v => { cfg.level = v; save(); }), row('Suprimir @everyone e @here', null, toggle(cfg.noEveryone, v => { cfg.noEveryone = v; save(); }))); });
  return h('div', h('h2', 'Notificações'),
    card(row('Notificações da área de trabalho', 'Avisa de menções e mensagens diretas quando a janela não está em foco.', toggle(S.prefs.desktopNotif, v => { S.prefs.desktopNotif = v; save(); if (v && 'Notification' in window) Notification.requestPermission(); })),
      row('Mostrar o texto da mensagem na notificação', 'Desligado: mostra só "Nova mensagem".', toggle(S.prefs.notifPreview !== false, v => { S.prefs.notifPreview = v; save(); })),
      hint('Sons de notificação, de chamada e de voz ficam em "Sons".')),
    section('Por servidor'), ...(list.length ? list : [hint('Você ainda não está em nenhum servidor.')]));
}

// ============================ Atalhos ============================
function keysPage() {
  const cap = (key, label, desktopKey) => captureKey(h('button.btn.grey', { style: { minWidth: '190px' } }), S.prefs[key], (c) => { S.prefs[key] = c; save(); if (desktop && desktopKey) desktop.setSettings({ [desktopKey]: comboToAccel(c) }); }, { combo: true });
  const rows = [['Ctrl + K', 'Busca rápida'], ['↑ (campo vazio)', 'Editar sua última mensagem'], ['Esc', 'Cancelar resposta / fechar'], ['Shift + Enter', 'Quebra de linha']];
  return h('div', h('h2', 'Atalhos'),
    card(row('Silenciar / ativar microfone', desktop ? 'Funciona também com o app em segundo plano.' : 'Com a aba em foco.', cap('keyMute', '', 'hotkeyMute')),
      row('Ensurdecer / ativar áudio', null, cap('keyDeafen', '', 'hotkeyDeafen')),
      row('Salvar clipe da transmissão', 'Salva os últimos segundos da transmissão em destaque no chat da sala (clipes ficam ligados por padrão nas transmissões dos outros).', cap('keyClip', '', 'hotkeyClip')),
      row('Ligar / desligar efeito de voz', 'Liga o último efeito usado (Robô na primeira vez) ou desliga. Com o app em foco.', cap('keyFx', '')),
      row('Duração do clipe do atalho', null, seg({ 15: '15s', 30: '30s', 60: '60s' }, S.prefs.clipSecs || 30, (v) => { S.prefs.clipSecs = +v; save(); })),
      row('Push-to-talk', 'Segurar para falar (modo "Push-to-talk" em Voz e vídeo).', captureKey(h('button.btn.grey', { style: { minWidth: '190px' } }), S.prefs.pttKey, (c) => { S.prefs.pttKey = c; save(); }, { combo: false }))),
    section('Fixos'), card(...rows.map(([k, d]) => row(d, null, h('kbd', k)))),
    hint('Atalhos para tocar sons do soundboard: clique direito no som → "Definir atalho".'));
}

// ============================ Avançado ============================
function advancedPage(ctx) {
  const exportBtn = h('button.btn.grey', { onclick: () => { const p = { ...S.prefs }; ['inputId', 'outputId', 'videoId'].forEach(k => delete p[k]); const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })), download: 'resenha-configuracoes.json' }); a.click(); } }, 'Exportar configurações');
  const importBtn = h('button.btn.grey', { onclick: () => { const i = h('input', { type: 'file', accept: '.json', onchange: async () => { try { Object.assign(S.prefs, JSON.parse(await i.files[0].text())); save(); applyTheme(); toast('Configurações importadas'); } catch { toast('Arquivo inválido', true); } } }); i.click(); } }, 'Importar configurações');
  const resetBtn = h('button.btn.red', { onclick: async () => { if (await confirmBox('Redefinir configurações', 'Volta tudo ao padrão (tema, voz, sons, atalhos…).', 'Redefinir')) { const keep = { inputId: S.prefs.inputId, outputId: S.prefs.outputId, videoId: S.prefs.videoId }; for (const k of Object.keys(S.prefs)) delete S.prefs[k]; localStorage.removeItem('lc_prefs'); S.prefs.inputId = keep.inputId; save(); location.reload(); } } }, 'Redefinir tudo');
  const dsk = h('div'); if (desktop) desktop.getSettings().then(s => dsk.replaceChildren(
    row('Aceleração de hardware', 'Usa a GPU para desenhar a interface. Reinicia o app.', toggle(s.hardwareAcceleration !== false, v => { desktop.setSettings({ hardwareAcceleration: v }); toast('Reinicie o app para aplicar'); })),
    row('Limpar cache do app', 'Libera espaço; as configurações e a conta permanecem.', h('button.btn.grey', { onclick: async () => { await desktop.clearCache(); toast('Cache limpo'); } }, 'Limpar')),
    row('Reiniciar o aplicativo', null, h('button.btn.grey', { onclick: () => desktop.relaunch() }, 'Reiniciar'))));
  return h('div', h('h2', 'Avançado'),
    card(row('Modo desenvolvedor', 'Mostra "Copiar ID" nos menus.', toggle(!!S.prefs.devMode, v => { S.prefs.devMode = v; save(); }))),
    desktop && [section('Aplicativo'), card(dsk)],
    section('Configurações'), card(h('div.btns', exportBtn, importBtn, resetBtn), hint('Suas preferências ficam salvas na conta e acompanham você em outros dispositivos (menos os dispositivos de áudio).')),
    section('Informações'), card(row('Contexto seguro (HTTPS)', 'Necessário para microfone, câmera e tela.', h('b', window.isSecureContext ? 'Sim' : 'Não')), row('Servidores ICE', (S.ice || []).map(i => i.urls).join(', ') || '—', null), row('Navegador', navigator.userAgent.slice(0, 90), null)));
}
// relatar um problema: explica o que vai junto e abre o formulário
function reportPage() {
  return h('div', h('h2', 'Relatar um problema'),
    card(h('p', { style: { marginTop: 0 } }, 'Algo travou, não apareceu ou ficou estranho? Conte o que aconteceu e o relatório vai com as informações técnicas que ajudam a achar a causa: versões do app e do navegador, placa de vídeo, log do app desktop, estado da call e erros recentes.'),
      hint('Não vai senha, chave nem o conteúdo das suas mensagens. Dá para ver tudo antes de enviar.'),
      h('button.btn.green', { style: { marginTop: '12px' }, onclick: () => openReport() }, 'Relatar um problema')));
}
// versão do app desktop com "Procurar atualização": diz se já está na mais nova ou oferece atualizar
function versionRow(version) {
  const status = h('span', `Resenha Desktop ${version}`);
  const btn = h('button.btn.grey', { onclick: async () => {
    btn.disabled = true; btn.textContent = 'Procurando…';
    const r = await checkAppUpdate();
    btn.disabled = false;
    if (!r?.latest) { btn.textContent = 'Procurar atualização'; return toast('Não consegui consultar as atualizações agora. Tente de novo em instantes.', true); }
    if (!r.available) { btn.textContent = 'Procurar atualização'; status.textContent = `Resenha Desktop ${version} — você está na versão mais nova`; return; }
    status.textContent = `Resenha Desktop ${version} — versão ${r.latest} disponível`;
    btn.className = 'btn green'; btn.textContent = `Atualizar para ${r.latest}`;
    const quiet = silentUpdate();
    if (quiet) btn.textContent = `Reiniciar e atualizar para ${r.latest}`;
    btn.onclick = async () => { btn.disabled = true; btn.textContent = quiet ? 'Reiniciando…' : 'Baixando…'; if (!await installAppUpdate()) { btn.disabled = false; btn.textContent = quiet ? `Reiniciar e atualizar para ${r.latest}` : `Atualizar para ${r.latest}`; toast(quiet ? 'Não deu para atualizar agora. Tente de novo em instantes.' : 'Baixando o instalador: quando terminar, abra o Resenha-Setup.'); } };
  } }, 'Procurar atualização');
  return row('Versão', status, btn);
}
function appPage() {
  const box = h('div.card2', 'Carregando…');
  desktop.getSettings().then((s) => box.replaceChildren(
    row('Iniciar com o Windows', 'Abre a Resenha ao ligar o computador.', toggle(s.autoStart, v => desktop.setSettings({ autoStart: v }))),
    row('Iniciar minimizado', null, toggle(s.startMinimized, v => desktop.setSettings({ startMinimized: v }))),
    row('Fechar para a bandeja', 'Ao fechar a janela o app continua rodando (para ficar em chamada).', toggle(s.closeToTray, v => desktop.setSettings({ closeToTray: v }))),
    row('Atalhos globais', 'Mutar/ensurdecer funcionam com o app em segundo plano (veja Atalhos).', toggle(s.globalHotkeys, v => desktop.setSettings({ globalHotkeys: v }))),
    row('Compatibilidade de vídeo', 'Por padrão o app desenha igual ao navegador. Ligue se as letras ficam borradas ou os vídeos piscam/aparecem escuros só no app (no navegador normais): o vídeo é decodificado pela CPU, em sRGB e sem a sobreposição de vídeo da placa (um pouco mais pesado). Em placas antigas também desenha o texto pela CPU. "Automático" liga sozinho em placas de vídeo antigas.' + (s.gpuName ? ` Placa: ${s.gpuName}.` : '') + ` Agora: ${s.gpuCompatActive ? 'ligada' : 'desligada'}.`,
      h('select.gpucompat', { onchange: async (e) => { await desktop.setSettings({ gpuCompat: e.target.value }); if (await confirmBox('Reiniciar a Resenha?', 'A compatibilidade de vídeo só muda depois de reiniciar o app. Se estiver numa chamada, você sai dela.', 'Reiniciar agora')) desktop.relaunch(); else toast('Vale na próxima vez que abrir o app'); } },
        [['auto', 'Automático'], ['on', 'Ligada'], ['off', 'Desligada']].map(([v, l]) => h('option', { value: v, selected: (s.gpuCompat || 'auto') === v }, l)))),
    row('Servidor', s.server, h('button.btn.grey', { onclick: () => desktop.changeServer() }, 'Trocar servidor')),
    versionRow(s.version)));
  return h('div', h('h2', 'Aplicativo (desktop)'), box);
}

// ============================ Servidor ============================
function overviewPage(gid) {
  const g = guild(gid), canEdit = can(gid, PERM.MANAGE_GUILD);
  let icn = g.icon, ban = g.banner, accent = g.accent || '#5865f2';
  const name = h('input', { value: g.name, maxLength: 100, disabled: !canEdit }), desc = h('textarea', { value: g.description || '', rows: 3, maxLength: 300, disabled: !canEdit, placeholder: 'Do que se trata este servidor?' });
  const iconEl = h('div.rail-item', { style: { width: '88px', height: '88px', borderRadius: '50%', fontSize: '30px', cursor: canEdit ? 'pointer' : 'default' } }), bannerEl = h('div.srv-banner');
  const draw = () => { iconEl.replaceChildren(icn ? h('img', { src: icn }) : g.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3)); bannerEl.style.backgroundImage = ban ? `url("${String(ban).replace(/["\\\n]/g, encodeURIComponent)}")` : ''; bannerEl.style.backgroundColor = accent; };
  iconEl.onclick = async () => { if (!canEdit) return; const u = await uploadImage(); if (u) { icn = u.url; draw(); } };
  draw();
  const members = [...g.members.keys()].filter(id => id !== S.me.id);
  return h('div', h('h2', 'Visão geral do servidor'), h('div.card2', { style: { padding: 0, overflow: 'hidden' } }, bannerEl, h('div', { style: { padding: '0 16px 16px', display: 'flex', gap: '16px', alignItems: 'flex-end', marginTop: '-44px', flexWrap: 'wrap' } }, iconEl,
    canEdit && h('div.btns', h('button.btn', { onclick: async () => { const u = await uploadImage(); if (u) { ban = u.url; draw(); } } }, 'Banner'), h('button.btn.grey', { onclick: () => { ban = null; draw(); } }, 'Remover banner'), h('button.btn.grey', { onclick: () => { icn = null; draw(); } }, 'Remover ícone')))),
  card(h('label.f', 'Nome do servidor', name), h('label.f', 'Descrição', desc), h('label.f', 'Cor de destaque'), swatches(accent, (c) => { accent = c; draw(); })),
  canEdit && h('button.btn', { onclick: async () => { if (await tryApi('PATCH', `/guilds/${gid}`, { name: name.value, icon: icn || '', banner: ban || '', description: desc.value, accent })) toast('Servidor salvo!'); } }, 'Salvar alterações'),
  g.owner_id === S.me.id && [section('Zona de perigo'), card(
    row('Transferir propriedade', 'Escolha outro membro como dono.', h('button.btn.grey', { onclick: async () => { if (!members.length) return toast('Não há outros membros', true); const sel = h('select', ...members.map(id => h('option', { value: id }, nameOf(id, gid)))); modal('Transferir propriedade', 'O novo dono terá controle total.', h('label.f', 'Novo dono', sel), [{ label: 'Cancelar', cls: 'link' }, { label: 'Transferir', cls: 'red', fn: async () => { if (!(await tryApi('PATCH', `/guilds/${gid}`, { owner_id: sel.value }))) return false; toast('Propriedade transferida'); } }]); } }, 'Transferir')),
    row('Excluir servidor', 'Apaga canais e mensagens para sempre.', h('button.btn.red', { onclick: async () => { if (await confirmBox(`Excluir ${g.name}`, 'Permanente: apaga canais e mensagens.', 'Excluir servidor')) { await tryApi('DELETE', `/guilds/${gid}`); document.getElementById('settings')?.remove(); } } }, 'Excluir')))]);
}
function channelsPage(gid) {
  const g = guild(gid), box = h('div'), canEdit = can(gid, PERM.MANAGE_CHANNELS);
  const draw = () => {
    const cats = g.channels.filter(c => c.type === 4), kids = (pid) => g.channels.filter(c => c.type !== 4 && (c.parent_id || null) === pid);
    const move = async (c, siblings, dir) => { const i = siblings.indexOf(c), j = i + dir; if (j < 0 || j >= siblings.length) return; const o = siblings[j]; const [a, b] = [c.position, o.position]; await tryApi('PATCH', `/channels/${c.id}`, { position: b === a ? b + dir : b }); await tryApi('PATCH', `/channels/${o.id}`, { position: a }); setTimeout(draw, 250); };
    const line = (c, siblings) => h('div.chrow', h('span.ico', icon(c.type === 2 ? 'voice' : c.type === 4 ? 'caret' : 'hash', 16)), h('span.cn', c.name),
      canEdit && h('div.btns', h('button.ibtn', { title: 'Subir', onclick: () => move(c, siblings, -1) }, '▲'), h('button.ibtn', { title: 'Descer', onclick: () => move(c, siblings, 1) }, '▼'),
        h('button.btn.grey', { onclick: async () => { const n = await promptBox('Renomear canal', 'Nome', c.name); if (n) { await tryApi('PATCH', `/channels/${c.id}`, { name: n }); setTimeout(draw, 250); } } }, 'Renomear'),
        h('button.btn.red', { onclick: async () => { if (await confirmBox('Excluir canal', `Excluir ${c.name}?`, 'Excluir')) { await tryApi('DELETE', `/channels/${c.id}`); setTimeout(draw, 250); } } }, 'Excluir')));
    box.replaceChildren(...kids(null).map(c => line(c, kids(null))), ...cats.flatMap(cat => [line(cat, cats), h('div.chkids', ...kids(cat.id).map(c => line(c, kids(cat.id))))]));
  };
  draw();
  const create = (type) => async () => { const n = await promptBox(type === 4 ? 'Nova categoria' : type === 2 ? 'Novo canal de voz' : 'Novo canal de texto', 'Nome', '', 'Criar'); if (n) { await tryApi('POST', `/guilds/${gid}/channels`, { name: n, type }); setTimeout(draw, 300); } };
  return h('div', h('h2', 'Canais'), canEdit && h('div.btns', { style: { marginBottom: '16px' } }, h('button.btn', { onclick: create(0) }, '+ Texto'), h('button.btn', { onclick: create(2) }, '+ Voz'), h('button.btn.grey', { onclick: create(4) }, '+ Categoria')), card(box));
}
function emojisPage(gid) {
  const g = guild(gid), canEdit = can(gid, PERM.MANAGE_GUILD), box = h('div.emoji-list');
  const draw = () => { box.replaceChildren(...(g.emojis || []).map(e => h('div.emoji-item', h('img', { src: e.url }), h('span', ':' + e.name + ':'), canEdit && h('button.ibtn', { title: 'Excluir', onclick: async () => { await tryApi('DELETE', `/emojis/${e.id}`); setTimeout(draw, 250); } }, icon('trash', 16))))); if (!g.emojis?.length) box.append(hint('Nenhum emoji personalizado ainda.')); };
  draw();
  return h('div', h('h2', 'Emojis'), canEdit && card(hint('Envie imagens quadradas (PNG/GIF). Use no chat digitando :nome: ou pelo seletor de emojis.'), h('button.btn', { onclick: async () => {
    const u = await uploadImage(); if (!u) return;
    const nm = await promptBox('Nome do emoji', 'Nome (letras, números e _)', u.name.replace(/\.[^.]+$/, '').replace(/\W/g, '_').slice(0, 32), 'Adicionar'); if (!nm) return;
    if (await tryApi('POST', `/guilds/${gid}/emojis`, { name: nm, url: u.url })) setTimeout(draw, 300);
  } }, 'Enviar emoji')), box);
}
function serverSoundsPage(gid) {
  const g = guild(gid), canEdit = can(gid, PERM.MANAGE_GUILD), box = h('div');
  const draw = () => {
    const src = { key: gid, title: g.name, guild: g, sounds: g.sounds || [] };
    box.replaceChildren(...(src.sounds.length ? src.sounds.map(s => h('div.srow2', h('span.e', soundEmoji(s.emoji)), h('span.n', s.name), h('small.mut', soundVol(s) + '%'), h('button.btn.grey', { onclick: () => playLocal(s.url, soundVol(s)) }, '▶'), canEdit && h('button.btn.grey', { onclick: () => editSound(src, s) }, 'Editar'))) : [hint('Nenhum som neste servidor ainda.')]));
  };
  const onChange = () => draw(); document.addEventListener('sb-changed', onChange); draw(); queueMicrotask(() => whenGone(box, () => document.removeEventListener('sb-changed', onChange)));
  return h('div', h('h2', 'Soundboard do servidor'), canEdit && card(hint('Sons curtos (até 15 s, 2 MB) que qualquer membro pode tocar na sala de voz, até 48 por servidor.'), h('button.btn', { onclick: () => addSound(gid) }, '+ Adicionar som')), card(box));
}
function invitesPage(gid) {
  const box = h('div'), draw = async () => {
    const list = await tryApi('GET', `/guilds/${gid}/invites`) || [];
    box.replaceChildren(...list.map(i => h('div.frow', { style: { cursor: 'default' } }, h('div.fn', h('b', `${location.origin}/invite/${i.code}`), h('small', `${i.uses} uso(s) • por ${nameOf(i.creator_id, gid)}`)),
      h('button.btn.grey', { onclick: () => { navigator.clipboard?.writeText(`${location.origin}/invite/${i.code}`); toast('Copiado!'); } }, 'Copiar'), h('button.btn.red', { onclick: async () => { await tryApi('DELETE', `/invites/${i.code}`); draw(); } }, 'Revogar'))));
    if (!list.length) box.append(hint('Nenhum convite ativo.'));
  };
  draw();
  return h('div', h('h2', 'Convites'), h('button.btn', { style: { marginBottom: '16px' }, onclick: async () => { await tryApi('POST', `/guilds/${gid}/invites`); draw(); } }, 'Criar convite'), box);
}
function rolesPage(gid) {
  const g = guild(gid), box = h('div'), editor = h('div');
  const draw = () => {
    box.replaceChildren(...g.roles.map(r => h('div.role-row', { onclick: () => edit(r) }, h('i.dot', { style: { background: r.color } }), h('span', { style: { flex: 1 } }, r.name), h('small', { style: { color: 'var(--text-muted)' } }, `${[...g.members.values()].filter(m => m.roles.includes(r.id)).length} membros`))));
    if (!g.roles.length) box.append(hint('Nenhum cargo ainda.'));
  };
  const edit = (r) => {
    let color = r.color, perms = r.perms; const name = h('input', { value: r.name, maxLength: 50 });
    editor.replaceChildren(card(h('h3', { style: { marginTop: 0, color: 'var(--header)' } }, 'Editar cargo'), h('label.f', 'Nome do cargo', name), h('label.f', 'Cor'), swatches(color, c => (color = c)),
      h('div', { style: { marginTop: '16px' } }, PERM_LABELS.map(([bit, label, desc]) => row(label, desc, toggle(perms & bit, on => { perms = on ? perms | bit : perms & ~bit; })))),
      h('div.btns', { style: { marginTop: '16px' } }, h('button.btn', { onclick: async () => { await tryApi('PATCH', `/roles/${r.id}`, { name: name.value, color, perms }); toast('Cargo salvo!'); setTimeout(draw, 200); } }, 'Salvar'),
        h('button.btn.red', { onclick: async () => { if (await confirmBox('Excluir cargo', `Excluir ${r.name}?`, 'Excluir')) { await tryApi('DELETE', `/roles/${r.id}`); editor.replaceChildren(); setTimeout(draw, 200); } } }, 'Excluir'))));
  };
  draw();
  return h('div', h('h2', 'Cargos'), can(gid, PERM.MANAGE_ROLES) && h('button.btn', { style: { marginBottom: '16px' }, onclick: async () => { await tryApi('POST', `/guilds/${gid}/roles`, { name: 'novo cargo' }); setTimeout(draw, 250); } }, 'Criar cargo'), box, editor);
}
function membersPage(gid) {
  const g = guild(gid), box = h('div'), q = h('input.fsearch', { placeholder: 'Buscar membro', oninput: () => draw() });
  const draw = () => {
    box.replaceChildren(...[...g.members.values()].filter(m => nameOf(m.user_id, gid).toLowerCase().includes(q.value.toLowerCase())).map(m => {
      const u = user(m.user_id);
      return h('div.frow', { style: { cursor: 'default' } }, avatar(u, 36, { ring: 'var(--bg-pri)' }), h('div.fn', h('b', nameOf(m.user_id, gid)), h('small', '@' + u.username + (g.owner_id === u.id ? ' • Dono' : '') + (timedOutUntil(gid, u.id) ? ' • de castigo até ' + new Date(timedOutUntil(gid, u.id)).toLocaleString('pt-BR') : ''))),
        can(gid, PERM.MANAGE_ROLES) && g.roles.length > 0 && h('button.btn.grey', { onclick: () => rolePicker(g, m) }, 'Cargos'),
        can(gid, PERM.MODERATE) && u.id !== g.owner_id && u.id !== S.me.id && h('button.btn.grey', { onclick: () => (timedOutUntil(gid, u.id) ? removeTimeout(gid, u.id) : timeoutDialog(gid, u.id)) }, timedOutUntil(gid, u.id) ? 'Tirar castigo' : 'Castigo'),
        can(gid, PERM.BAN) && u.id !== g.owner_id && u.id !== S.me.id && h('button.btn.red', { onclick: () => banDialog(gid, u.id, () => setTimeout(draw, 300)) }, 'Banir'),
        can(gid, PERM.KICK) && u.id !== g.owner_id && u.id !== S.me.id && h('button.btn.red', { onclick: async () => { if (await confirmBox('Expulsar', `Expulsar ${u.display_name}?`, 'Expulsar')) { await tryApi('DELETE', `/guilds/${gid}/members/${u.id}`); setTimeout(draw, 300); } } }, 'Expulsar'));
    }));
  };
  draw(); return h('div', h('h2', `Membros — ${g.members.size}`), q, box);
}
function rolePicker(g, m) {
  const sel = new Set(m.roles);
  modal(`Cargos de ${nameOf(m.user_id, g.id)}`, '', h('div', g.roles.map(r => row(r.name, null, toggle(sel.has(r.id), on => (on ? sel.add(r.id) : sel.delete(r.id)))))),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Salvar', fn: () => tryApi('PATCH', `/guilds/${g.id}/members/${m.user_id}`, { roles: [...sel] }) }]);
}
void channelById;
