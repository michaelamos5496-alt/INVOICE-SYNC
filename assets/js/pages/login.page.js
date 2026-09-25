/**
 * login.page.js — controller for pages/login.html. One card, six modes:
 *   signin  → email + password
 *   signup  → name + shop name + email + password (hidden when ALLOW_SIGNUP is false)
 *   forgot  → email, sends a reset link
 *   recover → choose a new password (reached by clicking that reset link)
 *   verify  → the email address isn't confirmed yet
 *   shop    → confirmed, but not in any shop yet: name a new one (or ask an owner to add this email)
 * The last two exist because getting into a synced shop takes three things:
 * a login, a confirmed email, and a shop to belong to (see auth.service.js).
 *
 * Recovery mode is detected from the URL hash *before* supabase-js loads, because
 * the library consumes the hash (and fires its PASSWORD_RECOVERY event) during
 * initialization — before any listener we add could hear it.
 */
import { CLOUD_SYNC, ALLOW_SIGNUP, isSupabaseConfigured } from '../config/supabase.config.js';
import {
  getAccessState, refreshAccess, createShop, signIn, signUp, sendPasswordReset, updatePassword, resendVerification, signOut, safeNextPath,
} from '../services/auth.service.js';
import { getQueryParam, escapeHTML } from '../utils/helpers.js';
import { APP_NAME } from '../config/constants.js';

const COPY = {
  signin: { title: 'Welcome back', subtitle: 'Sign in to manage your shop.', submit: 'Sign in' },
  signup: { title: 'Create your account', subtitle: 'Sign up to run your own shop, or to join one you\'ve been invited to.', submit: 'Create account' },
  forgot: { title: 'Reset your password', subtitle: 'Enter your email and we\'ll send you a link to choose a new one.', submit: 'Send reset link' },
  recover: { title: 'Choose a new password', subtitle: 'Pick something you haven\'t used before.', submit: 'Update password' },
  verify: { title: 'Confirm your email', subtitle: 'One quick step before you can get in.' },
  shop: { title: 'Name your shop', subtitle: 'Your email is confirmed. One last step: set up your own shop.', submit: 'Create my shop' },
};

const MIN_PASSWORD = 8;
const $ = (id) => document.getElementById(id);

let mode = 'signin';
let busy = false;
let leaving = false; // set once we're navigating away, so the button doesn't flicker back to enabled
let recovering = false;
let panelEmail = '';
let lastCredentials = null; // kept in memory only, so "I've confirmed — continue" can sign in without retyping

export async function initLoginPage() {
  // No shop's name here: the sign-in page belongs to the app, not to whichever shop last used this browser.

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  recovering = hash.get('type') === 'recovery';
  const linkError = hash.get('error_description');

  // Sync is switched off: there's nothing to log in to, so head straight into the app.
  if (!CLOUD_SYNC) { redirectIntoApp(); return; }

  if (!isSupabaseConfigured()) {
    setMode('signin');
    showAlert('danger', '<strong>Supabase isn\'t connected yet.</strong> Add your project URL and anon key in <code>assets/js/config/supabase.config.js</code>, then reload this page.', { html: true });
    setFormDisabled(true);
    return;
  }

  bindEvents();

  if (linkError) {
    setMode('signin', { focus: false });
    showAlert('danger', hash.get('error_code') === 'otp_expired' ? 'That link has expired. Request a new one and try again.' : linkError.replace(/\+/g, ' '));
    history.replaceState({}, '', window.location.pathname + window.location.search);
    return;
  }

  let access;
  try {
    access = await getAccessState();
  } catch (err) {
    console.error(err);
    setMode('signin', { focus: false });
    showAlert('danger', /isn't set up/.test(err.message) ? err.message : 'Can\'t reach the sign-in service. Check your internet connection and reload.');
    return;
  }

  // Arrived from a reset link: they hold a temporary session, so ask for a new password instead of letting them straight in.
  if (recovering) {
    if (access.state === 'signed-out') {
      recovering = false;
      setMode('forgot', { focus: false });
      showAlert('danger', 'That reset link has expired or was already used. Request a new one below.');
      return;
    }
    setMode('recover');
  } else {
    routeByAccess(access, { focus: false });
  }
  if (window.location.hash) history.replaceState({}, '', window.location.pathname + window.location.search);
}

function redirectIntoApp(delayMs = 0) {
  leaving = true;
  setTimeout(() => window.location.replace(safeNextPath(getQueryParam('next'))), delayMs);
}

/** Sends the person wherever their account status says they should be. */
function routeByAccess(access, { focus = true } = {}) {
  panelEmail = access.user?.email ?? panelEmail;
  if (access.state === 'ok') { redirectIntoApp(); return; }
  if (access.state === 'unverified') { setMode('verify', { focus }); return; }
  if (access.state === 'no-shop') { setMode('shop', { focus }); return; }
  setMode(getQueryParam('mode') === 'signup' && ALLOW_SIGNUP ? 'signup' : 'signin', { focus: false });
}

// ---------------------------------------------------------------------
// Mode / rendering
// ---------------------------------------------------------------------
function setMode(next, { keepAlert = false, focus = true } = {}) {
  mode = next;
  const copy = COPY[mode];
  const isPanel = mode === 'verify';

  $('auth-title').textContent = copy.title;
  $('auth-subtitle').textContent = typeof copy.subtitle === 'function' ? copy.subtitle() : copy.subtitle;
  document.title = `${mode === 'signup' ? 'Create account' : mode === 'signin' ? 'Sign in' : copy.title} · ${APP_NAME}`;

  $('auth-form').hidden = isPanel;
  $('auth-panel').hidden = !isPanel;
  if (isPanel) renderPanel();
  else {
    $('auth-submit-label').textContent = copy.submit;
    document.querySelectorAll('#auth-form [data-modes]').forEach((el) => {
      el.hidden = !el.dataset.modes.split(' ').includes(mode);
    });
    const isNewPassword = mode === 'signup' || mode === 'recover';
    $('f-password').autocomplete = isNewPassword ? 'new-password' : 'current-password';
    $('f-password-label').textContent = mode === 'recover' ? 'New password' : 'Password';
    $('pw-hint').hidden = !isNewPassword;
    $('f-shop-hint').innerHTML = mode === 'shop'
      ? `Joining an existing shop instead? Ask its owner to add <strong>${escapeHTML(panelEmail || 'your email')}</strong> under Employees → <strong>Can sign in</strong>, then choose “Check again” below.`
      : 'This creates your own shop, with its own products, sales and staff. Leave it empty if a shop owner is adding you to theirs.';
  }

  renderSwitchLinks();
  if (!keepAlert) hideAlert();
  if (focus && !isPanel) (document.querySelector('#auth-form input:not([hidden]):not([type="password"])') ?? $('f-password')).focus?.();
}

function renderPanel() {
  const email = escapeHTML(panelEmail || 'your email');
  if (mode === 'verify') {
    $('auth-panel-text').innerHTML = `We sent a confirmation link to <strong>${email}</strong>. Click it, then come back here and press the button below. Can't find it? Check your spam folder.`;
    $('panel-primary').textContent = 'I\'ve confirmed — continue';
    $('panel-secondary').textContent = 'Send the email again';
    $('panel-secondary').hidden = false;
  }
}

function renderSwitchLinks() {
  const el = $('auth-switch');
  const link = (target, label) => `<button type="button" class="font-semibold text-primary-600 hover:underline" data-switch="${target}">${label}</button>`;

  if (mode === 'signin') el.innerHTML = ALLOW_SIGNUP ? `New to ${escapeHTML(APP_NAME)}? ${link('signup', 'Create an account')}` : 'No account yet? Ask the person who runs InvSync to create one for you.';
  else if (mode === 'signup') el.innerHTML = `Already have an account? ${link('signin', 'Sign in')}`;
  else if (mode === 'forgot') el.innerHTML = link('signin', '← Back to sign in');
  else if (mode === 'shop') el.innerHTML = `${link('check', 'Check again')} · ${link('signout', 'Sign out')}`;
  else el.innerHTML = '';

  el.querySelectorAll('[data-switch]').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.switch === 'check') return recheckShop();
    if (btn.dataset.switch === 'signout') { leaving = true; lastCredentials = null; return signOut(); }
    return setMode(btn.dataset.switch);
  }));
}

function showAlert(variant, message, { html = false } = {}) {
  const el = $('auth-alert');
  el.className = `alert alert-${variant} mt-5`;
  el.innerHTML = `<i class="fa-solid ${variant === 'danger' ? 'fa-circle-exclamation' : 'fa-circle-check'} mt-0.5" aria-hidden="true"></i><span></span>`;
  const text = el.querySelector('span');
  if (html) text.innerHTML = message; else text.textContent = message;
  el.hidden = false;
}

function hideAlert() { $('auth-alert').hidden = true; }

function setFormDisabled(disabled) {
  document.querySelectorAll('#auth-form input, #auth-form button').forEach((el) => { el.disabled = disabled; });
  document.querySelectorAll('#auth-switch button').forEach((el) => { el.disabled = disabled; });
}

function setBusy(value) {
  busy = value;
  $('auth-submit').disabled = value;
  $('auth-submit-label').innerHTML = value
    ? `<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Please wait…`
    : (COPY[mode].submit ?? '');
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------
function bindEvents() {
  $('auth-form').addEventListener('submit', onSubmit);
  $('forgot-link').addEventListener('click', () => setMode('forgot'));

  document.querySelectorAll('[data-toggle-password]').forEach((btn) => btn.addEventListener('click', () => {
    const input = btn.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.innerHTML = `<i class="fa-solid ${show ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i>`;
  }));

  $('panel-primary').addEventListener('click', () => withPanelBusy(async () => {
    if (mode === 'verify' && !lastCredentials) { // e.g. the page was reloaded — we don't keep passwords around
      setMode('signin', { focus: true });
      showAlert('success', 'Once you\'ve confirmed your email, sign in below.');
      return;
    }
    const access = mode === 'verify' ? await signIn(lastCredentials.email, lastCredentials.password) : await refreshAccess();
    if (access.state === 'ok') { redirectIntoApp(); return; }
    routeByAccess(access, { focus: false });
    showAlert('danger', access.state === 'unverified'
      ? 'Not confirmed yet — open the email we sent and click the link first.'
      : 'Please sign in again.');
  }));
  $('panel-secondary').addEventListener('click', () => withPanelBusy(async () => {
    await resendVerification(panelEmail);
    showAlert('success', 'Sent again. It can take a minute to arrive.');
  }));
  $('panel-signout').addEventListener('click', () => withPanelBusy(async () => {
    leaving = true;
    lastCredentials = null;
    await signOut();
  }));
}

/** "Check again" on the name-your-shop screen: an owner may have added this email to their shop in the meantime. */
async function recheckShop() {
  if (busy) return;
  hideAlert();
  try {
    const access = await refreshAccess();
    if (access.state === 'ok') { redirectIntoApp(); return; }
    showAlert('danger', 'You\'re not on a shop\'s staff list yet. Ask the owner to add your email, or name your own shop above.');
  } catch (err) { showAlert('danger', err.message); }
}

async function withPanelBusy(fn) {
  const buttons = [...document.querySelectorAll('#auth-panel button')];
  buttons.forEach((b) => { b.disabled = true; });
  hideAlert();
  try { await fn(); } catch (err) { showAlert('danger', err.message); } finally { if (!leaving) buttons.forEach((b) => { b.disabled = false; }); }
}

function validate() {
  const email = $('f-email').value.trim();
  const password = $('f-password').value;

  if (mode === 'shop') return $('f-shop').value.trim() ? null : 'Give your shop a name.';
  if (mode !== 'recover') {
    if (!email) return 'Enter your email address.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'That email address doesn\'t look right.';
  }
  if (mode === 'signup' && !$('f-name').value.trim()) return 'Enter your name.';
  if (mode === 'signin' && !password) return 'Enter your password.';
  if ((mode === 'signup' || mode === 'recover') && password.length < MIN_PASSWORD) return `Your password needs at least ${MIN_PASSWORD} characters.`;
  if (mode === 'recover' && password !== $('f-confirm').value) return 'The two passwords don\'t match.';
  return null;
}

async function onSubmit(event) {
  event.preventDefault();
  if (busy) return;

  const problem = validate();
  if (problem) { showAlert('danger', problem); return; }

  hideAlert();
  setBusy(true);
  const email = $('f-email').value;
  const password = $('f-password').value;

  try {
    if (mode === 'signin') {
      lastCredentials = { email: email.trim(), password };
      routeByAccess(await signIn(email, password));
    } else if (mode === 'signup') {
      lastCredentials = { email: email.trim(), password };
      routeByAccess(await signUp({ email, password, fullName: $('f-name').value, shopName: $('f-shop').value }));
    } else if (mode === 'shop') {
      routeByAccess(await createShop($('f-shop').value));
    } else if (mode === 'forgot') {
      await sendPasswordReset(email);
      showAlert('success', `If an account exists for ${email.trim()}, a reset link is on its way. Check your inbox (and spam).`);
    } else if (mode === 'recover') {
      await updatePassword(password);
      showAlert('success', 'Password updated. Taking you in…');
      redirectIntoApp(900);
      return;
    }
  } catch (err) {
    showAlert('danger', err.message);
  } finally {
    if (!leaving) setBusy(false);
  }
}
