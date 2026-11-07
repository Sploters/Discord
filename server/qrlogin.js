// Entrar com QR Code: a tela de login (computador, app desktop) mostra um QR; o celular, já logado no Resenha, lê o QR
// com a câmera, abre o endereço e confirma "Entrar no outro aparelho". Aí o computador recebe uma sessão nova.
//   POST /api/qr-login                 -> { code, expires_at }        (tela de login; sem conta)
//   GET  /api/qr-login/:code           -> { state, user?, token? }    (a tela de login consulta a cada ~1,5 s)
//   POST /api/qr-login/:code/scan      -> { agent, created_at }       (celular logado abriu o link: mostra o pedido)
//   POST /api/qr-login/:code/approve   -> {}                          (celular confirmou: cria a sessão)
//   POST /api/qr-login/:code/cancel    -> {}                          (celular recusou)
// Segurança: o código é aleatório (192 bits), vale 2 minutos, só um aparelho pode escanear, a aprovação é explícita
// (mostra o aparelho que pediu) e a chave da sessão é entregue uma única vez a quem criou o código.
import crypto from 'node:crypto';

const TTL = 2 * 60 * 1000;

export function mountQrLogin(app, { auth, wrap, bad, run, userPub, ipLimited, clean }) {
  const codes = new Map(); // code -> { created, expires, agent, state: pending|scanned|approved|canceled|done, uid, token }
  const sweep = () => { const t = Date.now(); for (const [k, c] of codes) if (t > c.expires + 60e3) codes.delete(k); };
  const live = (c) => c && Date.now() <= c.expires && c.state !== 'done';
  const device = (ua) => {
    ua = String(ua || '');
    const app = /Electron\//.test(ua) ? 'App desktop' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${app} no ${os}` : app;
  };

  app.post('/api/qr-login', wrap((req, res) => {
    if (ipLimited(req, 'qr', 30, 60e3)) return bad(res, 'Muitas tentativas. Espere um minuto.', 429);
    sweep();
    const code = crypto.randomBytes(24).toString('base64url'), now = Date.now();
    codes.set(code, { created: now, expires: now + TTL, agent: device(req.headers['user-agent']), rawAgent: clean(req.headers['user-agent'], 200), state: 'pending' });
    res.json({ code, expires_at: now + TTL });
  }));

  // consulta da tela de login: quando aprovado, entrega a chave uma vez e o código deixa de valer
  app.get('/api/qr-login/:code', wrap((req, res) => {
    const c = codes.get(req.params.code);
    if (!c || (Date.now() > c.expires && c.state !== 'approved')) return res.json({ state: 'expired' });
    if (c.state === 'approved') { c.state = 'done'; return res.json({ state: 'approved', token: c.token }); }
    if (c.state === 'done') return res.json({ state: 'expired' });
    res.json({ state: c.state, ...(c.state === 'scanned' ? { user: userPub(c.uid) } : {}) });
  }));

  app.post('/api/qr-login/:code/scan', auth, wrap((req, res) => {
    const c = codes.get(req.params.code);
    if (!live(c) || c.state === 'approved') return bad(res, 'Este QR Code expirou. Gere outro na tela de login.', 410);
    if (c.state === 'scanned' && c.uid !== req.uid) return bad(res, 'Este QR Code já foi lido por outra conta.', 409);
    if (c.state === 'canceled') return bad(res, 'Este pedido foi recusado. Gere outro QR Code na tela de login.', 410);
    c.state = 'scanned'; c.uid = req.uid;
    res.json({ agent: c.agent, created_at: c.created, expires_at: c.expires });
  }));

  app.post('/api/qr-login/:code/:action(approve|cancel)', auth, wrap((req, res) => {
    const c = codes.get(req.params.code);
    if (!live(c) || c.uid !== req.uid || c.state !== 'scanned') return bad(res, 'Este QR Code expirou. Gere outro na tela de login.', 410);
    if (req.params.action === 'cancel') { c.state = 'canceled'; return res.json({}); }
    const token = crypto.randomBytes(32).toString('hex');
    run('INSERT INTO sessions(token,user_id,created_at,agent) VALUES(?,?,?,?)', token, req.uid, Date.now(), c.rawAgent);
    c.state = 'approved'; c.token = token; c.expires = Math.max(c.expires, Date.now() + 30e3); // tempo para a tela buscar a chave
    res.json({});
  }));
}
