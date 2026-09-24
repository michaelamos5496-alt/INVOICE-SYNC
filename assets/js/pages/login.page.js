/**
 * login.page.js — controller for pages/login.html. One card, four modes:
 *   signin  → email + password
 *   signup  → name + email + password (hidden when ALLOW_SIGNUP is false)
 *   forgot  → email, sends a reset link
 *   recover → new password, reached by clicking that reset link
 *
 * Recovery mode is detected from the URL hash *before* supabase-js loads,
 * because the library consumes the hash (and fires its PASSWORD_RECOVERY
 * event) during initialization — before any listener we add could hear it.
 */
import { AUTH_REQUIRED, isSupabaseConfigured, ALLOW_SIGNUP } from '../config/supabase.config.js';
import {
  getSession, signIn, signUp, sendPasswordReset, updatePassword, safeNextPath,
} from '../services/auth.service.js';
import { getQueryParam } from '../utils/helpers.js';

const COPY = {
  signin: { title: 'Welcome back', subtitle: 'Sign in to manage your shop.', submit: 'Sign in' },
  signup: { title: 'Create your account', subtitle: 'Set up access to InvSync in a minute.', submit: 'Create account' },
  forgot: { title: 'Reset your password', subtitle: 'Enter your email and we\'ll send you a link to choose a new one.', submit: 'Send reset link' },
  recover: { title: 'Choose a new password', subtitle: 'Pick something you haven\'t used before.', submit: 'Update password' },
};

const MIN_PASSWORD = 8;
const $ = (id) => document.getElementById(id);

let mode = 'signin';
let busy = false;
let leaving = false; // set once we're navigating away, so the button doesn't flicker back to enabled
let recovering = false;

export async function initLoginPage() {
  // Sign-in is switched off: there's nothing to log in to, so head straight into the app.
  if (!AUTH_REQUIRED) { redirectIntoApp(); return; }

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  recovering = hash.get('type') === 'recovery';
  const linkError = hash.get('error_description');

  if (!isSupabaseConfigured()) {
    setMode('signin');
    showAlert('danger', '<strong>Supabase isn\'t connected yet.</strong> Add your project URL and anon key in <code>assets/js/config/supabase.config.js</code>, then reload this page.', { html: true });
    setFormDisabled(true);
    return;
  }

  bindEvents();

  // Already signed in (or just arrived from a confirmation link) → straight to the app,
  // unless they're here to set a new password.
  if (!linkError) {
    const session = await getSession();
    if (session && !recovering) { redirectIntoApp(); return; }
    if (recovering && !session) {
      recovering = false;
      showAlert('danger', 'That reset link has expired or was already used. Request a new one below.');
      setMode('forgot', { keepAlert: true });
      return;
    }
  }

  if (recovering) setMode('recover');
  else setMode(getQueryParam('mode') === 'signup' && ALLOW_SIGNUP ? 'signup' : 'signin', { focus: false });

  if (linkError) showAlert('danger', hash.get('error_code') === 'otp_expired' ? 'That link has expired. Request a new one and try again.' : linkError.replace(/\+/g, ' '));
  // Don't leave tokens or error text sitting in the address bar.
  if (window.location.hash) history.replaceState({}, '', window.location.pathname + window.location.search);
}

function redirectIntoApp(delayMs = 0) {
  leaving = true;
  setTimeout(() => window.location.replace(safeNextPath(getQueryParam('next'))), delayMs);
}

// ---------------------------------------------------------------------
// Mode / rendering
// ---------------------------------------------------------------------
function setMode(next, { keepAlert = false, focus = true } = {}) {
  mode = next;
  const copy = COPY[mode];
  $('auth-title').textContent = copy.title;
  $('auth-subtitle').textContent = copy.subtitle;
  $('auth-submit-label').textContent = copy.submit;
  document.title = `${mode === 'signup' ? 'Create account' : mode === 'signin' ? 'Sign in' : copy.title} · InvSync`;

  document.querySelectorAll('[data-modes]').forEach((el) => {
    el.hidden = !el.dataset.modes.split(' ').includes(mode);
  });

  const isNewPassword = mode === 'signup' || mode === 'recover';
  $('f-password').autocomplete = isNewPassword ? 'new-password' : 'current-password';
  $('f-password-label').textContent = mode === 'recover' ? 'New password' : 'Password';
  $('pw-hint').hidden = !isNewPassword;

  renderSwitchLinks();
  if (!keepAlert) hideAlert();
  if (focus) (document.querySelector('#auth-form input:not([hidden]):not([type="password"])') ?? $('f-password')).focus?.();
}

function renderSwitchLinks() {
  const el = $('auth-switch');
  const link = (target, label) => `<button type="button" class="font-semibold text-primary-600 hover:underline" data-switch="${target}">${label}</button>`;

  if (mode === 'signin') el.innerHTML = ALLOW_SIGNUP ? `New to InvSync? ${link('signup', 'Create an account')}` : 'Need access? Ask an administrator to invite you.';
  else if (mode === 'signup') el.innerHTML = `Already have an account? ${link('signin', 'Sign in')}`;
  else if (mode === 'forgot') el.innerHTML = link('signin', '← Back to sign in');
  else el.innerHTML = '';

  el.querySelectorAll('[data-switch]').forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.switch)));
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
  const btn = $('auth-submit');
  btn.disabled = value;
  $('auth-submit-label').innerHTML = value
    ? `<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Please wait…`
    : COPY[mode].submit;
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
}

function validate() {
  const email = $('f-email').value.trim();
  const password = $('f-password').value;

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
      await signIn(email, password);
      redirectIntoApp();
      return;
    }

    if (mode === 'signup') {
      const { needsConfirmation } = await signUp({ email, password, fullName: $('f-name').value });
      if (!needsConfirmation) { redirectIntoApp(); return; }
      $('auth-form').reset();
      setMode('signin', { focus: false });
      showAlert('success', `We sent a confirmation link to ${email.trim()}. Click it to activate your account, then sign in.`);
    } else if (mode === 'forgot') {
      await sendPasswordReset(email);
      showAlert('success', `If an account exists for ${email.trim()}, a reset link is on its way. Check your inbox (and spam).`);
    } else if (mode === 'recover') {
      await updatePassword(password);
      showAlert('success', 'Password updated. Taking you to your dashboard…');
      redirectIntoApp(900);
      return;
    }
  } catch (err) {
    showAlert('danger', err.message);
  } finally {
    if (!leaving) setBusy(false);
  }
}
