/**
 * login.motion.js — GSAP animation for the sign-in page.
 * Everything here is progressive enhancement: if GSAP failed to load, or the
 * visitor prefers reduced motion, every export is a harmless no-op and the page
 * simply appears as-is.
 */
const gsap = window.gsap;
const enabled = !!gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let ready = false; // set once the intro has finished, so mode switches don't fight it
const HERO_SCALE = 1.06; // resting zoom; leaves headroom so the mouse drift never shows an edge

/** Logo splash: the mark pops in, the wordmark spreads into place, a bar fills, then the whole screen lifts away. */
function playSplash() {
  const splash = document.getElementById('auth-splash');
  if (!splash) return Promise.resolve();
  if (!enabled) { splash.remove(); return Promise.resolve(); }

  return new Promise((resolve) => {
    gsap.timeline({ defaults: { ease: 'power3.out' }, onComplete: () => { splash.remove(); resolve(); } })
      .from('.auth-splash-mark img', { scale: 0.5, opacity: 0, duration: 0.8, ease: 'back.out(1.8)' })
      .fromTo('.auth-splash-ring', { scale: 0.7, opacity: 0.9 }, { scale: 1.5, opacity: 0, duration: 1.1, ease: 'power2.out' }, 0.25)
      .from('.auth-splash-name', { opacity: 0, y: 10, letterSpacing: '0.5em', duration: 0.9 }, 0.35)
      .from('.auth-splash-tag', { opacity: 0, y: 8, duration: 0.6 }, 0.7)
      .to('.auth-splash-bar i', { scaleX: 1, duration: 1, ease: 'power1.inOut' }, 0.3)
      .to(splash, { yPercent: -100, duration: 0.7, ease: 'power4.inOut' }, 1.5);
  });
}

export async function playIntro() {
  await playSplash();
  if (!enabled) { ready = true; return; }

  const tl = gsap.timeline({ defaults: { ease: 'power3.out' }, onComplete: () => { ready = true; initParallax(); } });
  tl.fromTo('.auth-hero', { scale: 1.2 }, { scale: HERO_SCALE, duration: 2.2, ease: 'power2.out' }, 0)
    .from('.auth-glass', { xPercent: -100, duration: 1, ease: 'power4.out' }, 0)
    .from('.auth-glass .auth-mark, .auth-glass .auth-brand', { y: -16, opacity: 0, duration: 0.7, stagger: 0.08 }, 0.55)
    .from('.auth-num', { opacity: 0, x: -12, duration: 0.6 }, 0.7)
    .from('#auth-title, #auth-subtitle', { y: 22, opacity: 0, duration: 0.7, stagger: 0.1 }, 0.75)
    .from('#auth-form > :not([hidden]), #auth-panel > :not([hidden])', { y: 20, opacity: 0, duration: 0.6, stagger: 0.09 }, 0.9)
    .from('#auth-switch, .auth-foot', { y: 12, opacity: 0, duration: 0.6, stagger: 0.08 }, 1.2)
    .from('.auth-meta > div', { y: 16, opacity: 0, duration: 0.7, stagger: 0.12 }, 1.3);
}

/** Cross-fades the heading and fields when the card changes mode (sign in → forgot password, etc.). */
export function animateModeChange() {
  if (!enabled || !ready) return;
  gsap.fromTo('#auth-title, #auth-subtitle, #auth-form > :not([hidden]), #auth-panel > :not([hidden]), #auth-switch',
    { y: 14, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.45, stagger: 0.06, ease: 'power2.out', overwrite: true, clearProps: 'transform,opacity' });
}

export function shakeAlert() {
  if (!enabled) return;
  gsap.fromTo('#auth-alert', { x: 0, opacity: 0 }, { opacity: 1, duration: 0.2 });
  gsap.fromTo('#auth-alert', { x: -8 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.25)', clearProps: 'transform' });
}

/** Slow mouse-follow drift on the photo, plus a tactile press on the buttons. */
function initParallax() {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (fine) {
    const x = gsap.quickTo('.auth-hero', 'x', { duration: 1.2, ease: 'power3.out' });
    const y = gsap.quickTo('.auth-hero', 'y', { duration: 1.2, ease: 'power3.out' });
    window.addEventListener('pointermove', (e) => {
      x((e.clientX / window.innerWidth - 0.5) * -22);
      y((e.clientY / window.innerHeight - 0.5) * -14);
    }, { passive: true });
  }

  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn || btn.disabled) return;
    gsap.to(btn, { scale: 0.97, duration: 0.12, ease: 'power2.out' });
    const release = () => gsap.to(btn, { scale: 1, duration: 0.4, ease: 'elastic.out(1, 0.5)', clearProps: 'transform' });
    window.addEventListener('pointerup', release, { once: true });
    window.addEventListener('pointercancel', release, { once: true });
  });
}
