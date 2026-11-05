// App instalável (PWA): registra o service worker (sw.js) e oferece "Instalar o LocalCord".
// - Android e Chrome/Edge no computador: o navegador avisa que dá para instalar (beforeinstallprompt) e o cartão
//   mostra o botão "Instalar".
// - iPhone/iPad (Safari não tem botão de instalar): o cartão explica Compartilhar → Adicionar à Tela de Início.
// Só funciona em HTTPS com certificado válido (ou localhost). No app desktop não roda: ele já é um app.
// O cartão aparece depois de 20 s de uso; "Agora não" esconde por 14 dias.
import { h, icon } from './util.js';

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const KEY = 'lc_pwa_later';
const later = () => { try { return Date.now() - (+localStorage.getItem(KEY) || 0) < 14 * 864e5; } catch { return false; } };

let deferred = null, card = null;
export const canInstall = () => !!deferred || (isIos() && !standalone());

export async function installApp() {
  if (deferred) { deferred.prompt(); const r = await deferred.userChoice.catch(() => null); deferred = null; card?.remove(); return r?.outcome === 'accepted'; }
  if (isIos()) showCard(true);
  return false;
}

export function showCard(force) {
  if (card || standalone() || (!force && later())) return;
  const ios = !deferred && isIos();
  const close = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { } card?.remove(); card = null; };
  card = h('div.appupd.pwacard', { role: 'dialog', 'aria-label': 'Instalar o LocalCord' },
    h('div.au-ico', h('img', { src: '/icons/icon-192.png', alt: '', width: 36, height: 36 })),
    h('div.au-body',
      h('b', 'Instale o LocalCord'),
      ios
        ? h('p', 'Toque em ', h('span.pwa-share', icon('upload', 14)), ' Compartilhar e depois em ', h('b.pwa-inline', 'Adicionar à Tela de Início'), '. Ele abre como app, em tela cheia.')
        : h('p', 'Abre como um app, na tela cheia, direto da tela inicial ou da barra de tarefas, e carrega mais rápido.'),
      h('div.au-btns',
        h('button.btn.link', { onclick: close }, ios ? 'Entendi' : 'Agora não'),
        !ios && h('button.btn.green', { onclick: () => installApp() }, 'Instalar'))));
  document.body.append(card);
}

export function initPwa() {
  if (window.lcDesktop) return; // app desktop: já é um app
  if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => { });
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; setTimeout(() => showCard(false), 20000); });
  addEventListener('appinstalled', () => { deferred = null; card?.remove(); card = null; });
  // iPhone no Safari: não há aviso do navegador; o cartão com as instruções aparece só em tela de celular/tablet
  if (isIos() && !standalone() && isSecureContext) setTimeout(() => showCard(false), 20000);
}
