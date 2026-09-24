/**
 * auth.service.js — Supabase Auth wrapper. The only module that talks to
 * supabase-js; pages and components use these functions, mirroring how
 * api.service.js is the single door to data.
 *
 * supabase-js is loaded lazily from a pinned CDN URL the first time it's
 * needed, so nothing about auth costs anything until a page asks for it.
 * The session lives in localStorage (supabase-js's default) and refreshes
 * itself; `clearAllData()` in reset.service.js only removes InvSync's own
 * business keys, so "Clear data" never signs anyone out.
 *
 * NOTE: this is a static, client-side app, so the guard in app.js gates
 * the UI, not the data — business data still lives in each browser's
 * localStorage until Phase 10 moves it to Supabase tables. Real
 * enforcement will come from Row Level Security policies on those tables.
 */
import {
  AUTH_REQUIRED, GUEST_NAME, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JS_URL, isSupabaseConfigured,
} from '../config/supabase.config.js';

const LOGIN_PATH = '/pages/login.html';
const DEFAULT_LANDING = '/pages/dashboard.html';

let clientPromise = null;
let currentUser = null;

async function getClient() {
  if (!isSupabaseConfigured()) throw new Error('Supabase isn\'t configured yet. Add your project URL and anon key in assets/js/config/supabase.config.js.');
  clientPromise ??= import(/* @vite-ignore */ SUPABASE_JS_URL).then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    }));
  return clientPromise;
}

/** Turns Supabase's error messages into something a shop owner can act on. */
function friendlyError(error) {
  const message = String(error?.message ?? error ?? 'Something went wrong.');
  if (/invalid login credentials/i.test(message)) return 'That email and password don\'t match. Check them and try again.';
  if (/email not confirmed/i.test(message)) return 'Please confirm your email first — check your inbox for the link we sent.';
  if (/already registered|already been registered/i.test(message)) return 'An account with that email already exists. Try signing in instead.';
  if (/password should be at least/i.test(message)) return message;
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Please wait a minute and try again.';
  if (/signups not allowed|signup is disabled/i.test(message)) return 'New sign-ups are turned off. Ask an administrator to invite you.';
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'Can\'t reach the sign-in service. Check your internet connection.';
  return message;
}

async function run(fn) {
  try {
    const client = await getClient();
    const { data, error } = await fn(client.auth);
    if (error) throw error;
    return data;
  } catch (err) {
    throw new Error(friendlyError(err));
  }
}

// ---------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------
/** Display name: the name given at sign-up, else the part of the email before the @. */
export function displayNameFor(user) {
  const named = user?.user_metadata?.full_name?.trim();
  return named || (user?.email ? user.email.split('@')[0] : 'User');
}

/** Sync accessor, valid after `requireSession()` has resolved. */
export function getCurrentUser() {
  return currentUser;
}

/** Name recorded in activity logs / audit trails for whoever is signed in. */
export function getActorName() {
  return currentUser ? displayNameFor(currentUser) : 'system';
}

/**
 * Only same-site absolute paths are allowed as a post-login destination —
 * otherwise `login.html?next=https://evil.example` would be an open redirect.
 */
export function safeNextPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return DEFAULT_LANDING;
  if (raw.startsWith(LOGIN_PATH)) return DEFAULT_LANDING;
  return raw;
}

// ---------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------
export async function getSession() {
  if (!isSupabaseConfigured()) return null;
  try {
    const client = await getClient();
    const { data } = await client.auth.getSession();
    currentUser = data.session?.user ?? null;
    return data.session ?? null;
  } catch (err) {
    console.error('[auth] Could not read session', err);
    return null;
  }
}

function redirectToLogin() {
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`${LOGIN_PATH}?next=${encodeURIComponent(here)}`);
}

/** Stand-in identity used while AUTH_REQUIRED is off, so the rest of the app can treat "who's using this" uniformly. */
const guestUser = () => ({ id: 'guest', email: '', user_metadata: { full_name: GUEST_NAME }, isGuest: true });

/**
 * The route guard. With sign-in switched off it resolves immediately with a
 * guest user and never touches Supabase. Otherwise it resolves with the
 * session when someone is signed in.
 * Otherwise it redirects to the login page and returns a promise that
 * never settles — so the page script that awaited it simply stops,
 * instead of rendering protected content for a moment before navigating.
 */
export async function requireSession() {
  if (!AUTH_REQUIRED) {
    currentUser = guestUser();
    return { user: currentUser };
  }
  const session = await getSession();
  if (session) {
    watchForSignOut();
    return session;
  }
  redirectToLogin();
  return new Promise(() => {});
}

let watching = false;
let signingOut = false; // this tab initiated the sign-out and is already navigating to the login page
async function watchForSignOut() {
  if (watching) return;
  watching = true;
  const client = await getClient();
  // Fires when the user signs out in another tab, or a refresh token is revoked/expired.
  client.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user ?? null;
    if (event === 'SIGNED_OUT' && !signingOut) redirectToLogin();
  });
}

// ---------------------------------------------------------------------
// Actions used by the login page and sidebar
// ---------------------------------------------------------------------
export async function signIn(email, password) {
  const data = await run((auth) => auth.signInWithPassword({ email: email.trim(), password }));
  currentUser = data.user;
  return data.session;
}

/** Resolves `{ needsConfirmation }` — Supabase returns no session until the email link is clicked, when confirmations are on. */
export async function signUp({ email, password, fullName }) {
  const data = await run((auth) => auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { full_name: fullName.trim() },
      emailRedirectTo: `${window.location.origin}${LOGIN_PATH}`,
    },
  }));
  // With email confirmation on, an already-registered address comes back as a user with no identities.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error(friendlyError('User already registered'));
  }
  if (data.session) currentUser = data.user;
  return { needsConfirmation: !data.session };
}

export async function sendPasswordReset(email) {
  await run((auth) => auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}${LOGIN_PATH}` }));
}

export async function updatePassword(newPassword) {
  await run((auth) => auth.updateUser({ password: newPassword }));
}

export async function signOut() {
  signingOut = true;
  try {
    const client = await getClient();
    await client.auth.signOut();
  } catch (err) {
    console.error('[auth] Sign-out request failed; clearing local session anyway', err);
  }
  currentUser = null;
  window.location.replace(LOGIN_PATH);
}
