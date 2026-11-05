// Aviso de versão nova do app desktop: cartão no canto com "Atualizar agora" e "Depois".
// Vem do servidor junto com a página, então aparece também nos apps antigos (a ponte getUpdate/onUpdate/installUpdate
// existe no app desde a 1.0.12): ninguém precisa baixar nada à mão. Duas fontes, a que chegar primeiro:
// - o próprio app (procura a release nova no GitHub ao abrir e de hora em hora);
// - a página, que também consulta o GitHub e compara com a versão instalada (se o app não achar, o aviso aparece igual).
// "Atualizar agora" usa o instalador automático do app; se ele falhar, abre a página da release para baixar.
// "Depois" esconde o aviso até o app abrir de novo.
import { h, icon } from './util.js';

const REPO = 'Sploters/Discord';
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

// versão instalada e a mais nova publicada: { current, latest, available }
export async function checkAppUpdate() {
  const d = window.lcDesktop; if (!d) return null;
  const current = (await d.getSettings?.().catch(() => null))?.version || null;
  let latest = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (j.assets?.some(a => /^LocalCord-Setup-.*\.exe$/i.test(a.name))) latest = String(j.tag_name || '').replace(/^v/i, '') || null; }
  } catch { /* sem internet ou GitHub fora: fica com o que o app achou */ }
  const fromApp = (await d.getUpdate?.().catch(() => null))?.version || null;
  latest = [latest, fromApp].filter(Boolean).sort((a, b) => (newer(a, b) ? -1 : 1))[0] || null;
  return { current, latest, available: !!latest && (!current || newer(latest, current)) };
}

// instala: o app baixa e abre o instalador; se não der (app antigo sem a release em mãos, rede), abre a página da release
export async function installAppUpdate() {
  const ok = await window.lcDesktop?.installUpdate?.().catch(() => false);
  if (!ok) window.open(RELEASES, '_blank');
  return ok;
}

let shown = null;
function showCard(version) {
  if (!version || shown?.dataset.v === version) return;
  try { if (sessionStorage.getItem('lc_upd_later') === version) return; } catch { }
  shown?.remove();
  const msg = h('p', 'Uma versão nova do app desktop está pronta. Leva menos de um minuto.');
  const btn = h('button.btn.green', { onclick: async () => {
    btn.disabled = true; later.disabled = true; btn.textContent = 'Baixando…';
    msg.textContent = 'O app fecha sozinho e abre o instalador quando o download terminar.';
    if (!await installAppUpdate()) { btn.disabled = false; later.disabled = false; btn.textContent = 'Atualizar agora'; msg.textContent = 'Abri a página da versão nova no navegador: baixe o LocalCord-Setup e abra.'; }
  } }, 'Atualizar agora');
  const later = h('button.btn.link', { onclick: () => { try { sessionStorage.setItem('lc_upd_later', version); } catch { } shown?.remove(); shown = null; } }, 'Depois');
  shown = h('div.appupd', { 'data-v': version, role: 'status' },
    h('div.au-ico', icon('dl', 20)),
    h('div.au-body', h('b', `LocalCord ${version} disponível`), msg, h('div.au-btns', later, btn)));
  document.body.append(shown);
}

export function initAppUpdate() {
  const d = window.lcDesktop;
  if (!d?.getUpdate || !d.installUpdate) return; // navegador ou app sem a ponte
  d.onUpdate?.((u) => showCard(u?.version));
  const check = () => checkAppUpdate().then(r => { if (r?.available) showCard(r.latest); }).catch(() => { });
  check(); setInterval(check, 3600e3);
}
