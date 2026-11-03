// Adaptador Steam: OpenID 2.0 (vinculação, sem segredo) + Web API oficial (chave só no servidor, variável STEAM_API_KEY).
// Este é o ÚNICO arquivo que conhece a Steam. Sem scraping, sem endpoints privados, sem credenciais de usuário.
import { PollError } from './errors.js';

const OPENID = () => process.env.STEAM_OPENID_URL || 'https://steamcommunity.com/openid/login';
const API = () => process.env.STEAM_API_BASE || 'https://api.steampowered.com';
const NS = 'http://specs.openid.net/auth/2.0';
const ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const STATES = ['offline', 'online', 'busy', 'away', 'away', 'online', 'online']; // personastate 0..6
const key = () => process.env.STEAM_API_KEY || '';

async function fetchT(url, opts = {}, ms = 10000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  catch (e) { throw new PollError(e.name === 'AbortError' ? 'tempo esgotado' : 'rede: ' + e.message, 0); }
  finally { clearTimeout(t); }
}

export default {
  id: 'steam', name: 'Steam', capabilities: ['link', 'presence', 'playtime'],
  configured: () => !!key(),

  startLink({ returnTo, realm }) {
    const q = new URLSearchParams({ 'openid.ns': NS, 'openid.mode': 'checkid_setup', 'openid.return_to': returnTo, 'openid.realm': realm,
      'openid.identity': NS + '/identifier_select', 'openid.claimed_id': NS + '/identifier_select' });
    return OPENID() + '?' + q;
  },

  // Valida a resposta do OpenID: retorno esperado idêntico, endpoint da Steam, SteamID de 17 dígitos e confirmação direta
  // na Steam (check_authentication), que também invalida o nonce (sem replay).
  async finishLink(query, { returnTo }) {
    const p = (k) => String(query['openid.' + k] ?? '');
    if (p('mode') !== 'id_res') throw new Error('Login na Steam cancelado');
    if (p('ns') !== NS) throw new Error('Resposta OpenID inválida');
    if (p('return_to') !== returnTo) throw new Error('Retorno inesperado');
    if (p('op_endpoint') !== OPENID()) throw new Error('Provedor inesperado');
    const m = ID_RE.exec(p('claimed_id')); if (!m || p('identity') !== p('claimed_id')) throw new Error('SteamID inválido');
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (k.startsWith('openid.')) body.set(k, String(v));
    body.set('openid.mode', 'check_authentication');
    const r = await fetchT(OPENID(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }).catch(e => { throw new Error('Não foi possível confirmar com a Steam: ' + e.message); });
    const txt = await r.text();
    if (!r.ok || !/^is_valid\s*:\s*true\s*$/m.test(txt)) throw new Error('A Steam não confirmou o login');
    return { external_id: m[1] };
  },

  // Lote de até 100 SteamIDs por chamada (1 requisição atende todos os usuários vinculados)
  async poll(ids) {
    if (!key()) throw new PollError('STEAM_API_KEY ausente', 401);
    const out = new Map();
    for (let i = 0; i < ids.length; i += 100) {
      const url = `${API()}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key())}&steamids=${ids.slice(i, i + 100).join(',')}`;
      const r = await fetchT(url);
      if (!r.ok) throw new PollError('Steam respondeu ' + r.status, r.status);
      const j = await r.json().catch(() => { throw new PollError('resposta inválida', 502); });
      for (const s of j?.response?.players || []) {
        const pub = s.communityvisibilitystate === 3; // 3 = perfil público; senão a Steam omite o jogo
        out.set(String(s.steamid), { name: s.personaname || null, avatar: s.avatarfull || s.avatarmedium || null, profileUrl: s.profileurl || null,
          state: STATES[s.personastate] || 'unknown', visibility: pub ? 'public' : 'private',
          game: pub && s.gameid ? { id: String(s.gameid), title: s.gameextrainfo || 'Jogo ' + s.gameid } : null });
      }
    }
    return out;
  },
};
