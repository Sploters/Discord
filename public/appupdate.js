// Aviso de versão nova do app desktop: cartão no canto com "Atualizar agora" e "Depois".
// Vem do servidor junto com a página, então aparece também nos apps antigos (a ponte getUpdate/onUpdate/installUpdate
// existe no app desde a 1.0.12): ninguém precisa baixar nada à mão. O app procura a release nova no GitHub ao abrir e
// de hora em hora; "Depois" esconde o aviso até a próxima vez que o app abrir.
import { h, icon } from './util.js';

let shown = null;
export function initAppUpdate() {
  const d = window.lcDesktop;
  if (!d?.getUpdate || !d.installUpdate) return; // navegador ou app sem a ponte
  const show = (u) => {
    if (!u?.version || shown?.dataset.v === u.version) return;
    try { if (sessionStorage.getItem('lc_upd_later') === u.version) return; } catch { }
    shown?.remove();
    const btn = h('button.btn.green', { onclick: async () => {
      btn.disabled = true; later.disabled = true; btn.textContent = 'Baixando…';
      msg.textContent = 'O app fecha sozinho e abre o instalador quando o download terminar.';
      const ok = await d.installUpdate().catch(() => false);
      if (!ok) { btn.disabled = false; later.disabled = false; btn.textContent = 'Tentar de novo'; msg.textContent = 'Não consegui baixar a atualização. Verifique a internet e tente de novo.'; }
    } }, 'Atualizar agora');
    const later = h('button.btn.link', { onclick: () => { try { sessionStorage.setItem('lc_upd_later', u.version); } catch { } shown?.remove(); shown = null; } }, 'Depois');
    const msg = h('p', 'Uma versão nova do app desktop está pronta. Leva menos de um minuto.');
    shown = h('div.appupd', { 'data-v': u.version, role: 'status' },
      h('div.au-ico', icon('dl', 20)),
      h('div.au-body', h('b', `LocalCord ${u.version} disponível`), msg, h('div.au-btns', later, btn)));
    document.body.append(shown);
  };
  d.onUpdate?.(show);
  d.getUpdate().then(show).catch(() => { });
}
