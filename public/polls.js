// Enquetes no chat: criar (pergunta, 2–10 opções, uma ou várias respostas, prazo) e votar em tempo real.
// O cartão mostra a porcentagem e quem votou em cada opção; o autor (ou um moderador) pode encerrar.
import { h, icon, avatar } from './util.js';
import { S, tryApi, toast, modal, can, PERM, user, channelById, nameOf } from './state.js';
import { toggle } from './ui.js';

const DURATIONS = [[0, 'Sem prazo'], [1, '1 hora'], [4, '4 horas'], [8, '8 horas'], [24, '24 horas'], [72, '3 dias'], [168, '1 semana']];

export function pollModal(ch) {
  const q = h('input', { maxLength: 300, placeholder: 'Ex.: Que jogo hoje à noite?' });
  const list = h('div.pmopts');
  let multi = false, dur = 24;
  const row = (val = '') => {
    const inp = h('input', { maxLength: 80, value: val, placeholder: 'Opção', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (list.children.length < 10 && e.target === list.lastElementChild?.querySelector('input')) { add(); } else e.target.closest('.pmrow').nextElementSibling?.querySelector('input')?.focus(); } } });
    const r = h('div.pmrow', h('span.pmn'), inp, h('button.ibtn.pmx', { title: 'Remover opção', onclick: () => { if (list.children.length > 2) { r.remove(); paint(); } } }, icon('x', 16)));
    return r;
  };
  const paint = () => { [...list.children].forEach((r, i) => { r.querySelector('.pmn').textContent = i + 1; r.querySelector('.pmx').disabled = list.children.length <= 2; }); addBtn.disabled = list.children.length >= 10; };
  const add = () => { const r = row(); list.append(r); paint(); r.querySelector('input').focus(); };
  const addBtn = h('button.btn.grey.pmadd', { onclick: add }, icon('plus', 16), 'Adicionar opção');
  list.append(row(), row());
  const sel = h('select.pmdur', { onchange: (e) => { dur = +e.target.value; } }, DURATIONS.map(([v, l]) => h('option', { value: v, selected: v === dur }, l)));
  const body = h('div.pollmodal',
    h('label.f', 'Pergunta', q),
    h('div.pmlab', 'Opções'), list, addBtn,
    h('div.pmset', h('div', h('b', 'Várias respostas'), h('small', 'Cada pessoa pode marcar mais de uma opção')), toggle(false, (v) => { multi = v; })),
    h('div.pmset', h('div', h('b', 'Prazo'), h('small', 'Depois disso a votação fecha e mostra o resultado')), sel));
  paint();
  modal('Criar enquete', null, body, [{ label: 'Cancelar', cls: 'link' }, { label: 'Publicar enquete', fn: async () => {
    const options = [...list.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    if (!q.value.trim()) { toast('Escreva a pergunta', true); q.focus(); return false; }
    if (options.length < 2) { toast('Preencha pelo menos 2 opções', true); return false; }
    if (new Set(options.map(o => o.toLowerCase())).size !== options.length) { toast('Há opções repetidas', true); return false; }
    return !!(await tryApi('POST', `/channels/${ch.id}/polls`, { question: q.value.trim(), options, multi, duration_h: dur })) || false;
  } }]);
  setTimeout(() => q.focus(), 0);
}

const left = (t) => { const s = Math.max(0, (t - Date.now()) / 1000); if (s < 60) return 'menos de 1 min'; if (s < 3600) return `${Math.ceil(s / 60)} min`; if (s < 86400) return `${Math.round(s / 3600)} h`; return `${Math.round(s / 86400)} d`; };

// cartão da enquete dentro da mensagem
export function pollCard(m) {
  const p = m.poll, ch = channelById(m.channel_id), gid = ch?.guild_id;
  const total = p.options.reduce((n, o) => n + o.voters.length, 0), top = Math.max(0, ...p.options.map(o => o.voters.length));
  const mine = new Set(p.options.filter(o => o.voters.includes(S.me.id)).map(o => o.id));
  const canClose = !p.closed && (p.author_id === S.me.id || (gid && can(gid, PERM.MANAGE_MESSAGES)));
  const vote = (ids) => tryApi('PUT', `/polls/${p.id}/vote`, { options: ids });
  const pick = (o) => {
    if (p.closed) return;
    if (p.multi) { const s = new Set(mine); s.has(o.id) ? s.delete(o.id) : s.add(o.id); vote([...s]); }
    else vote(mine.has(o.id) ? [] : [o.id]);
  };
  const opt = (o) => {
    const n = o.voters.length, pct = total ? Math.round(n / total * 100) : 0, me = mine.has(o.id), win = p.closed && n > 0 && n === top;
    return h('button.popt' + (me ? '.mine' : '') + (win ? '.win' : ''), { disabled: p.closed, title: o.voters.length ? o.voters.map(id => nameOf(id, gid) || user(id).display_name).join(', ') : 'Ninguém votou ainda', onclick: () => pick(o) },
      h('span.pfill', { style: { width: pct + '%' } }),
      h('span.pmark' + (p.multi ? '.sq' : ''), me && icon('check', 14)),
      h('span.ptext', o.text, win && h('span.pwin', '🏆')),
      h('span.pvoters', o.voters.slice(0, 4).map(id => avatar(user(id), 18, { status: false }))),
      h('span.pnum', `${pct}%`, h('small', ` ${n}`)));
  };
  const state = p.closed ? 'Encerrada' : p.ends_at ? `Termina em ${left(p.ends_at)}` : 'Sem prazo';
  return h('div.pollcard' + (p.closed ? '.closed' : ''),
    h('div.pq', p.question),
    h('div.psub', p.closed ? 'Resultado final' : p.multi ? 'Escolha uma ou mais opções' : 'Escolha uma opção'),
    h('div.popts', p.options.map(opt)),
    h('div.pfoot', h('span', `${p.voters} ${p.voters === 1 ? 'pessoa votou' : 'pessoas votaram'} · ${state}`),
      h('span.pacts',
        !p.closed && mine.size > 0 && h('button.btn.link.sm', { onclick: () => vote([]) }, 'Tirar meu voto'),
        canClose && h('button.btn.grey.sm', { onclick: () => tryApi('POST', `/polls/${p.id}/close`) }, 'Encerrar'))));
}
