/**
 * auth.service.js — sign-in with Supabase Auth. The only module pages and
 * components use for "who is using the app", mirroring how api.service.js is the
 * single door to data.
 *
 * Two modes, chosen by CLOUD_SYNC in supabase.config.js:
 *   off → no login; everyone is the local "guest" (GUEST_NAME) and Supabase is never loaded.
 *   on  → a person gets in only when ALL of these are true (see getAccessState):
 *           1. they're signed in,
 *           2. their email address is confirmed, and
 *           3. they belong to a shop: a row in the database's `staff` table ties their email to a shop —
 *              either because they created one (createShop) or because a shop owner added their email.
 *         Every shop's data is separate: the database only ever shows a person their own shop's rows.
 *         The database enforces (2) and (3) itself through row-level-security rules
 *         (supabase/schema.sql) — this file just reads the same facts so it can show the
 *         right screen instead of an error.
 */
import { CLOUD_SYNC, GUEST_NAME, isSupabaseConfigured } from '../config/supabase.config.js';
import { getSupabase } from './supabase.service.js';
import { clearCloudImageCache } from './image-store.service.js';
import { storage } from './storage.service.js';
import { STORAGE_KEYS } from '../config/constants.js';
import { showConnectionProblem, isConnectionError, connectionProblemFor } from '../components/connection-screen.js';

const LOGIN_PATH = '/pages/login.html';
const DEFAULT_LANDING = '/pages/dashboard.html';

let currentUser = null;
let currentShop = null;
let signingOut = false;

// ---------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------
/** Display name: the name given at sign-up, else the part of the email before the @. */
export function displayNameFor(user) {
  const named = (user?.displayName ?? user?.user_metadata?.full_name ?? '').trim();
  return named || (user?.email ? user.email.split('@')[0] : 'User');
}

/** A small copy of the Supabase user — the rest of the app never sees the SDK object. */
const toAppUser = (sbUser) => ({
  id: sbUser.id,
  email: sbUser.email ?? '',
  displayName: sbUser.user_metadata?.full_name ?? '',
  user_metadata: { full_name: sbUser.user_metadata?.full_name ?? '' },
});

const guestUser = () => ({ id: 'guest', email: '', displayName: GUEST_NAME, user_metadata: { full_name: GUEST_NAME }, isGuest: true });

/** Sync accessor, valid after `requireSession()` has resolved. */
export function getCurrentUser() {
  return currentUser;
}

/** The shop the signed-in person belongs to — `{ id, name }` — valid after `requireSession()` has resolved (null in local mode). */
export function getCurrentShop() {
  return currentShop;
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

/** Turns Supabase's error messages into something a shop owner can act on. */
function friendlyError(error) {
  const message = String(error?.message ?? error ?? 'Something went wrong.');
  if (/invalid login credentials/i.test(message)) return 'That email and password don\'t match. Check them and try again.';
  if (/email not confirmed/i.test(message)) return 'Please confirm your email first — check your inbox for the link we sent.';
  if (/already registered|already been registered/i.test(message)) return 'An account with that email already exists. Try signing in instead.';
  if (/password should be at least|weak password/i.test(message)) return 'Choose a stronger password (at least 8 characters).';
  if (/rate limit|too many|security purposes/i.test(message)) return 'Too many attempts. Please wait a minute and try again.';
  if (/signups not allowed|signup is disabled/i.test(message)) return 'New sign-ups are turned off right now.';
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'Can\'t reach the sign-in service. Check your internet connection.';
  if (/same password|different from the old/i.test(message)) return 'Choose a password you haven\'t used before.';
  return message;
}

async function run(fn) {
  try {
    const client = await getSupabase();
    const { data, error } = await fn(client);
    if (error) throw error;
    return data;
  } catch (err) {
    throw Object.assign(new Error(friendlyError(err)), { code: err?.code });
  }
}

// ---------------------------------------------------------------------
// Access state — the single source of truth for "may this person use the app?"
// ---------------------------------------------------------------------
/**
 * @returns {Promise<{ state: 'signed-out' | 'unverified' | 'no-shop' | 'ok', user?: object, shop?: { id: string, name: string } }>}
 *   `ok` means signed in + email confirmed + in a shop. `no-shop` means confirmed but not in any shop yet —
 *   the login page then asks them to name their new shop (or to ask an owner to add their email).
 */
export async function getAccessState() {
  if (!CLOUD_SYNC) return { state: 'ok', user: guestUser() };
  if (!isSupabaseConfigured()) return { state: 'signed-out' };

  const client = await getSupabase();
  const { data: { session } } = await client.auth.getSession(); // also consumes a confirmation / recovery link in the URL
  if (!session) return { state: 'signed-out' };

  const user = toAppUser(session.user);
  if (!session.user.email_confirmed_at) return { state: 'unverified', user };

  let shop = await loadMyShop(client);

  // Signed up with a shop name (the sign-up form asks for one) and not invited into an existing shop: create it now.
  const wantedName = String(session.user.user_metadata?.shop_name ?? '').trim();
  if (!shop && wantedName) {
    const { error } = await client.rpc('create_my_shop', { p_shop_name: wantedName, p_owner_name: user.displayName });
    if (error && !/already belongs|23505|duplicate/i.test(`${error.code} ${error.message}`)) throw error;
    shop = await loadMyShop(client);
  }

  return shop ? { state: 'ok', user, shop } : { state: 'no-shop', user };
}

/** The signed-in person's shop, or null when they're not in one. Also tells "database not set up" apart from "no shop". */
async function loadMyShop(client) {
  const { data: shopId, error } = await client.rpc('current_shop_id');
  if (error) {
    if (/current_shop_id/.test(error.message) || error.code === 'PGRST202') {
      throw new Error('The database isn\'t set up yet. Run supabase/schema.sql in the Supabase SQL Editor.');
    }
    throw error;
  }
  if (!shopId) return null;
  const { data: row } = await client.from('shops').select('id,name').eq('id', shopId).maybeSingle();
  return { id: shopId, name: row?.name ?? '' };
}

/** Creates the signed-in person's own shop and makes them its Shop Owner. Returns the new access state. */
export async function createShop(shopName) {
  const name = String(shopName ?? '').trim();
  if (!name) throw new Error('Give your shop a name.');
  const before = await getAccessState();
  await run((client) => client.rpc('create_my_shop', { p_shop_name: name, p_owner_name: before.user?.displayName ?? '' }));
  return getAccessState();
}

/** Re-checks the account — used after the person confirms their email or the owner approves them. */
export async function refreshAccess() {
  return run(async (client) => {
    await client.auth.refreshSession().catch(() => {});
    return { data: await getAccessState(), error: null };
  });
}

function redirectToLogin() {
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`${LOGIN_PATH}?next=${encodeURIComponent(here)}`);
}

/**
 * The route guard. Resolves with `{ user }` once the person may use the app.
 * Otherwise it redirects to the login page (which explains what's missing) and
 * returns a promise that never settles — so the page script that awaited it
 * simply stops, instead of rendering protected content for a moment first.
 */
export async function requireSession() {
  if (!CLOUD_SYNC) {
    currentUser = guestUser();
    return { user: currentUser };
  }

  let access;
  try {
    access = await getAccessState();
  } catch (err) {
    console.error('[auth] Could not check access', err);
    // Offline isn't the same as signed out: don't bounce someone to the login page just because the signal dropped.
    if (isConnectionError(err) || connectionProblemFor(err)) { showConnectionProblem(connectionProblemFor(err)); return new Promise(() => {}); }
    access = { state: 'signed-out' };
  }

  if (access.state === 'ok') {
    currentUser = access.user;
    currentShop = access.shop ?? null;
    watchForSignOut();
    return { user: currentUser };
  }
  redirectToLogin();
  return new Promise(() => {});
}

let watching = false;
async function watchForSignOut() {
  if (watching) return;
  watching = true;
  const client = await getSupabase();
  // Fires when the person signs out in another tab, or their session is revoked/expires.
  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && !signingOut) redirectToLogin();
  });
}

// ---------------------------------------------------------------------
// Actions used by the login page and sidebar
// ---------------------------------------------------------------------
/** Signs in and reports what the person can do next — see getAccessState(). */
export async function signIn(email, password) {
  try {
    await run((client) => client.auth.signInWithPassword({ email: email.trim(), password }));
  } catch (err) {
    // Supabase refuses to sign in an unconfirmed address; route the person to the "confirm your email" screen instead.
    if (err.code === 'email_not_confirmed') return { state: 'unverified', user: { email: email.trim() } };
    throw err;
  }
  return getAccessState();
}

/** Creates the login (saving the person's name) and emails a confirmation link. Returns the resulting access state — normally 'unverified'. */
export async function signUp({ email, password, fullName, shopName = '' }) {
  const data = await run((client) => client.auth.signUp({
    email: email.trim(),
    password,
    // The shop name rides along with the account and is used to create the shop once the email is confirmed.
    options: { data: { full_name: fullName.trim(), shop_name: shopName.trim() }, emailRedirectTo: `${window.location.origin}${LOGIN_PATH}` },
  }));
  // With confirmation on, an already-registered address comes back as a user with no identities.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('An account with that email already exists. Try signing in instead.');
  }
  if (data.session) return getAccessState(); // this project doesn't require confirmation
  return { state: 'unverified', user: { email: email.trim() } };
}

export async function resendVerification(email) {
  await run((client) => client.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: `${window.location.origin}${LOGIN_PATH}` } }));
}

export async function sendPasswordReset(email) {
  await run((client) => client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}${LOGIN_PATH}` }));
}

/** Sets a new password for the person who just arrived from a reset link (they hold a recovery session). */
export async function updatePassword(newPassword) {
  await run((client) => client.auth.updateUser({ password: newPassword }));
}

export async function signOut() {
  signingOut = true;
  currentUser = null;
  currentShop = null;
  storage.remove(STORAGE_KEYS.SETTINGS); // this browser's copy of the shop's settings must not greet the next person to sign in
  try {
    const client = await getSupabase();
    await client.auth.signOut();
    await clearCloudImageCache(); // photos downloaded from the shared bucket shouldn't linger on a shared computer
  } catch (err) {
    console.error('[auth] Sign-out request failed; clearing local session anyway', err);
  }
  window.location.replace(LOGIN_PATH);
}
