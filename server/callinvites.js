// Convites para a chamada: "vem para a sala onde eu estou", com aceitar/recusar dentro do app.
// Diferente do convite de servidor (link permanente): vale só para uma pessoa, expira em poucos minutos e,
// se ela ainda não for membro do servidor, aceitar já a coloca no servidor e na sala.
// Estado em memória (reiniciar o servidor invalida os convites pendentes; o cartão na DM mostra "expirado").
import crypto from 'node:crypto';

export const CALL_INVITE_TTL = 5 * 60 * 1000;
const RESEND_MS = 20 * 1000; // o mesmo convite pendente não é reenviado (nem toca de novo) antes disso

export function createCallInvites({ get, voiceChannelOf, roomSize, isFriend, isMember, isBanned, isBlocked, joinGuild, userPub, dispatch, postDm, now = () => Date.now() }) {
  const invites = new Map(); // id -> { id, from, to, guild_id, channel_id, created, expires, state }

  const stateOf = (i) => (i.state === 'pending' && now() > i.expires ? 'expired' : i.state);
  const pub = (i) => {
    const g = get('SELECT id,name,icon FROM guilds WHERE id=?', i.guild_id), ch = get('SELECT id,name FROM channels WHERE id=?', i.channel_id);
    return { id: i.id, state: stateOf(i), from: userPub(i.from), to: i.to, guild: g || { id: i.guild_id, name: '?' }, channel: ch || { id: i.channel_id, name: '?' },
      expires_at: i.expires, in_call: roomSize(i.channel_id), from_in_call: voiceChannelOf(i.from) === i.channel_id, member: isMember(i.guild_id, i.to) };
  };
  const notifyBoth = (i, extra = {}) => dispatch([i.from, i.to], 'CALL_INVITE_UPDATE', { ...pub(i), ...extra });
  // limpeza: convites resolvidos/expirados há mais de 1 h somem da memória
  const sweep = () => { const t = now(); for (const [id, i] of invites) if (t > i.expires + 3600e3) invites.delete(id); };

  function create(from, to) {
    sweep();
    const cid = voiceChannelOf(from);
    const ch = cid && get('SELECT id,guild_id,type FROM channels WHERE id=?', cid);
    if (!ch || ch.type !== 2 || !ch.guild_id) return { error: 'Entre numa sala de voz de um servidor para convidar alguém', status: 400 };
    if (!to || to === from || !get('SELECT 1 x FROM users WHERE id=?', to)) return { error: 'Usuário inválido', status: 400 };
    if (isBlocked(from, to)) return { error: 'Não foi possível convidar esta pessoa', status: 403 };
    // só amigos ou quem já está no servidor (evita convite de desconhecidos)
    if (!isFriend(from, to) && !isMember(ch.guild_id, to)) return { error: 'Só dá para convidar amigos ou membros deste servidor', status: 403 };
    if (isBanned(ch.guild_id, to)) return { error: 'Esta pessoa foi banida deste servidor', status: 403 };
    if (voiceChannelOf(to) === cid) return { error: 'Essa pessoa já está na chamada', status: 400 };
    // idempotente: mesmo par e mesma sala com convite pendente recente -> devolve o mesmo
    for (const i of invites.values()) {
      if (i.from === from && i.to === to && i.channel_id === cid && stateOf(i) === 'pending') {
        if (now() - i.created < RESEND_MS) return { invite: pub(i), repeated: true };
        i.state = 'canceled'; notifyBoth(i); // pendente antigo: substitui por um novo (toca de novo)
      }
    }
    const i = { id: crypto.randomBytes(9).toString('base64url'), from, to, guild_id: ch.guild_id, channel_id: cid, created: now(), expires: now() + CALL_INVITE_TTL, state: 'pending' };
    invites.set(i.id, i);
    postDm(from, to, `📞 /call/${i.id}`); // o cartão da DM guarda o histórico e funciona mesmo se o aviso for perdido
    dispatch([to], 'CALL_INVITE', pub(i));
    return { invite: pub(i) };
  }

  function read(id, uid) {
    const i = invites.get(id);
    if (!i || (uid !== i.from && uid !== i.to)) return { error: 'Convite não encontrado ou expirado', status: 404 };
    return { invite: pub(i) };
  }

  function respond(id, uid, action) {
    const i = invites.get(id);
    if (!i || (uid !== i.from && uid !== i.to)) return { error: 'Convite não encontrado ou expirado', status: 404 };
    const st = stateOf(i);
    if (action === 'cancel') {
      if (uid !== i.from) return { error: 'Sem permissão', status: 403 };
      if (st === 'pending') { i.state = 'canceled'; notifyBoth(i); }
      return { invite: pub(i) };
    }
    if (uid !== i.to) return { error: 'Sem permissão', status: 403 };
    if (st === 'expired') return { error: 'Este convite expirou', status: 410 };
    if (st === 'canceled') return { error: 'O convite foi cancelado', status: 410 };
    if (action === 'decline') {
      if (st === 'pending') { i.state = 'declined'; notifyBoth(i); }
      return { invite: pub(i) };
    }
    // aceitar (repetir depois de aceito só devolve o destino de novo)
    const ch = get('SELECT id,guild_id,type FROM channels WHERE id=?', i.channel_id);
    if (!ch || ch.type !== 2) { i.state = 'expired'; return { error: 'A sala de voz não existe mais', status: 410 }; }
    if (isBanned(i.guild_id, uid)) return { error: 'Você foi banido deste servidor', status: 403 };
    if (!isMember(i.guild_id, uid)) joinGuild(i.guild_id, uid);
    if (st === 'pending' || st === 'declined') { i.state = 'accepted'; notifyBoth(i); } // recusou e mudou de ideia: vale enquanto não expirar
    return { invite: pub(i), guild_id: i.guild_id, channel_id: i.channel_id };
  }

  // convites para mim ainda pendentes (a página mostra na lista de amigos e no "Ativo agora", mesmo se o aviso sumiu)
  function pendingFor(uid) {
    sweep();
    return [...invites.values()].filter(i => i.to === uid && stateOf(i) === 'pending').sort((a, b) => b.created - a.created).map(pub);
  }

  return { create, read, respond, pendingFor, _invites: invites };
}
