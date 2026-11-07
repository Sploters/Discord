// Tela de entrar / criar conta e "Entrar com QR Code".
// Entrar: cartão em duas colunas, com o formulário à esquerda e o QR Code à direita (some em telas estreitas).
// O QR leva ao endereço /qr/<código> deste servidor: o celular já logado abre, confirma e o computador entra sozinho
// (server/qrlogin.js). Criar conta: só o formulário.
import { h, icon, avatar } from './util.js';
import { api, modal } from './state.js';

const req = (label, input, extra) => h('label.f.auth-f', h('span.auth-l', label, h('span.auth-req', { 'aria-hidden': 'true' }, ' *')), input, extra);

// ---------- QR Code ----------
let qrLib = null;
const loadQr = () => (qrLib ||= import('/vendor/qr/qrcode.js').then(m => m.default || m.qrcode));
// desenha o QR em SVG (módulos escuros sobre branco), com o ícone do Resenha no meio
async function qrSvg(text) {
  const qrcode = await loadQr();
  const q = qrcode(0, 'H'); q.addData(text); q.make(); // nível H: o ícone no meio cobre até ~30% sem atrapalhar a leitura
  const n = q.getModuleCount(), m = 2, size = n + m * 2, logo = Math.round(n * 0.22), lo = Math.floor((size - logo) / 2);
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const cx = x + m, cy = y + m;
    if (q.isDark(y, x) && !(cx >= lo - 1 && cx < lo + logo + 1 && cy >= lo - 1 && cy < lo + logo + 1)) d += `M${cx} ${cy}h1v1h-1z`;
  }
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR Code para entrar');
  svg.innerHTML = `<rect width="${size}" height="${size}" rx="1.5" fill="#fff"/><path d="${d}" fill="#111214" shape-rendering="crispEdges"/>`
    + `<image href="/icons/icon-192.png" x="${lo}" y="${lo}" width="${logo}" height="${logo}" preserveAspectRatio="xMidYMid meet"/>`;
  return svg;
}

// coluna do QR: gera o código, consulta o servidor e, aprovado no celular, entra com a chave recebida
function qrPanel(onToken) {
  const box = h('div.auth-qrbox'), title = h('h2', 'Entrar com QR Code'), sub = h('p');
  const col = h('div.auth-qr', box, title, sub);
  let code = null, timer = null, dead = false;
  const stop = () => { clearTimeout(timer); timer = null; };
  const idle = () => { title.textContent = 'Entrar com QR Code'; sub.replaceChildren('Leia com a ', h('b', 'câmera do celular'), ' em que você já entrou no Resenha para entrar na hora.'); };
  const expired = () => {
    stop(); box.className = 'auth-qrbox off';
    box.replaceChildren(h('button.auth-qrnew', { onclick: () => start() }, icon('refresh', 22), h('span', 'Gerar outro QR Code')));
    title.textContent = 'O QR Code expirou'; sub.textContent = 'Por segurança ele vale só 2 minutos.';
  };
  const poll = async () => {
    if (dead || !col.isConnected) return stop();
    const r = await api('GET', `/qr-login/${encodeURIComponent(code)}`).catch(() => null);
    if (dead || !col.isConnected) return;
    if (r?.state === 'approved' && r.token) { dead = true; return onToken(r.token); }
    if (r?.state === 'expired' || r?.state === 'canceled') return r.state === 'canceled' ? start(true) : expired();
    if (r?.state === 'scanned' && r.user) {
      box.className = 'auth-qrbox scanned'; box.replaceChildren(avatar(r.user, 72, { status: false }));
      title.textContent = `Olá, ${r.user.display_name}!`; sub.textContent = 'Confirme no celular para entrar.';
    }
    timer = setTimeout(poll, 1500);
  };
  async function start(again) {
    stop(); box.className = 'auth-qrbox loading'; box.replaceChildren(h('div.auth-spin')); idle();
    if (again) sub.textContent = 'O pedido foi recusado no celular. Leia o QR Code de novo se quiser entrar.';
    const r = await api('POST', '/qr-login').catch(() => null);
    if (!col.isConnected) return;
    if (!r?.code) { box.className = 'auth-qrbox off'; box.replaceChildren(h('button.auth-qrnew', { onclick: () => start() }, icon('refresh', 22), h('span', 'Tentar de novo'))); sub.textContent = 'Não deu para gerar o QR Code agora.'; return; }
    code = r.code;
    const svg = await qrSvg(`${location.origin}/qr/${code}`).catch(() => null);
    if (!col.isConnected) return;
    box.className = 'auth-qrbox'; box.replaceChildren(svg || h('small', 'QR Code indisponível'));
    timer = setTimeout(poll, 1500);
    setTimeout(() => { if (code === r.code && col.isConnected && box.className === 'auth-qrbox') expired(); }, Math.max(5000, r.expires_at - Date.now()));
  }
  start();
  return col;
}

// "Esqueceu sua senha?": sem e-mail de recuperação (o servidor é de vocês), então diz o que dá para fazer de verdade
function forgotHelp() {
  modal('Esqueceu sua senha?', null, h('div.auth-forgot',
    h('p', 'O Resenha roda no servidor de vocês, então não há e-mail de recuperação. Dá para voltar de dois jeitos:'),
    h('ol',
      h('li', h('b', 'Entre com o QR Code'), ' (ao lado), lendo com o celular em que você ainda está logado. Depois troque a senha em ', h('i', 'Configurações › Minha conta'), '.'),
      h('li', h('b', 'Peça ao administrador do servidor'), ' para redefinir sua senha. Ele roda no servidor: ', h('code', 'node scripts/reset-password.mjs <usuário> <senha nova>'), '.'))),
  [{ label: 'Entendi' }]);
}

// mode: 'login' | 'register'; o: { invited, onToken(token) }
export function renderAuth(root, mode, o) {
  const login = mode === 'login', err = h('div.err', { role: 'alert' });
  const u = h('input', { autocomplete: 'username', maxLength: 32, required: true, 'aria-required': 'true' });
  const p = h('input', { type: 'password', autocomplete: login ? 'current-password' : 'new-password', required: true, 'aria-required': 'true' });
  const dn = h('input', { maxLength: 32, autocomplete: 'nickname' }), p2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const go = h('button.btn.block.auth-go', { type: 'submit' }, login ? 'Entrar' : 'Continuar');
  const submit = async (e) => {
    e?.preventDefault(); err.textContent = '';
    if (!u.value.trim()) { err.textContent = 'Digite seu nome de usuário'; return u.focus(); }
    if (!p.value) { err.textContent = 'Digite a senha'; return p.focus(); }
    if (!login && p.value !== p2.value) { err.textContent = 'As senhas não coincidem'; return p2.focus(); }
    go.disabled = true;
    try { const r = await api('POST', login ? '/login' : '/register', { username: u.value, password: p.value, display_name: dn.value }); o.onToken(r.token); }
    catch (x) { err.textContent = x.message; go.disabled = false; }
  };
  const swap = (e) => { e.preventDefault(); renderAuth(root, login ? 'register' : 'login', o); };
  const form = h('form.auth-form', { onsubmit: submit, novalidate: true },
    h('h1', login ? 'Boas-vindas de volta!' : 'Criar uma conta'),
    h('p.sub', login ? 'Estamos muito animados em te ver novamente!' : 'Junte-se ao servidor dos seus amigos.'),
    o.invited && h('p.sub.invited', icon('invite', 18), 'Você foi convidado! Entre para aceitar o convite.'),
    o.qrPending && h('p.sub.invited.qr', icon('phone', 18), 'Entre aqui para aprovar o login no outro aparelho.'),
    req('Nome de usuário', u),
    !login && h('label.f.auth-f', h('span.auth-l', 'Nome de exibição'), dn, h('small.auth-hint', 'Como os outros veem você. Dá para mudar depois.')),
    req('Senha', p, login && h('a.auth-link.auth-forgot-l', { href: '#', onclick: (e) => { e.preventDefault(); forgotHelp(); } }, 'Esqueceu sua senha?')),
    !login && req('Confirmar senha', p2),
    err, go,
    h('p.auth-switch', login ? 'Precisa de uma conta? ' : 'Já tem uma conta? ', h('a.auth-link', { href: '#', onclick: swap }, login ? 'Registre-se' : 'Entrar')));
  const card = h('div.auth-card' + (login ? '.two' : ''), form, login && !o.qrPending && [h('div.auth-sep'), qrPanel(o.onToken)]);
  root.replaceChildren(
    h('div.auth-bg', { 'aria-hidden': 'true' }, h('i.b1'), h('i.b2'), h('i.b3'), h('i.grid')),
    h('div.auth-brand', h('img', { src: '/icons/icon-192.png', alt: '' }), h('span', 'Resenha')),
    card);
  u.focus();
}

// ---------- aprovar no celular: /qr/<código> ----------
export const qrCodeInUrl = () => { const m = /^\/qr\/([\w-]{20,64})\/?$/.exec(location.pathname); return m ? m[1] : null; };
export async function approveQr(code, me) {
  history.replaceState(null, '', '/' + location.hash); // o endereço volta ao normal (recarregar não repete o pedido)
  let info;
  try { info = await api('POST', `/qr-login/${encodeURIComponent(code)}/scan`); }
  catch (e) { return modal('Entrar com QR Code', null, h('p', e.message), [{ label: 'Ok' }]); }
  return new Promise((res) => {
    modal('Entrar em outro aparelho?', null, h('div.qr-approve',
      h('div.qra-who', avatar(me, 48, { status: false }), h('div', h('b', me.display_name), h('small', me.username))),
      h('div.qra-dev', icon('screen', 20), h('div', h('b', info.agent), h('small', 'pediu para entrar na sua conta agora'))),
      h('p.qra-warn', icon('lock', 16), 'Só confirme se foi você que abriu a tela de login nesse aparelho. Quem entrar terá acesso total à sua conta.')),
    [{ label: 'Recusar', cls: 'grey', fn: async () => { await api('POST', `/qr-login/${encodeURIComponent(code)}/cancel`).catch(() => { }); res(false); } },
      { label: 'Entrar', cls: 'green', fn: async () => { try { await api('POST', `/qr-login/${encodeURIComponent(code)}/approve`); res(true); } catch (e) { modal('Entrar com QR Code', null, h('p', e.message), [{ label: 'Ok' }]); res(false); } } }], { sticky: true, width: 'min(440px, 94vw)' });
  });
}
