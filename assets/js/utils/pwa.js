/**
 * pwa.js — registers the service worker and powers the "Install app" button.
 * Chrome/Edge/Android fire `beforeinstallprompt`, which we hold until the button is tapped. iOS Safari has no
 * such prompt, so there the button explains Share → Add to Home Screen instead. The button stays hidden once
 * the app is already running installed.
 */
let deferredPrompt = null;

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[pwa] service worker failed', err)));
  }
  const button = document.getElementById('install-app-btn');
  if (!button || isStandalone()) return;

  const show = () => { button.hidden = false; };
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; show(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; button.hidden = true; });
  if (isIOS()) show();

  button.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      button.hidden = true;
    } else if (isIOS()) {
      alert('To install: tap the Share button in Safari, then "Add to Home Screen".');
    }
  });
}
