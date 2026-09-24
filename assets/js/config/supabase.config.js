/**
 * supabase.config.js — sign-in switch and connection details for Supabase Auth.
 *
 * AUTH_REQUIRED is the master switch. While it's `false` the app opens
 * straight to the dashboard with no login (as it did before auth was
 * added), Supabase is never contacted, and the sidebar shows GUEST_NAME.
 * Flip it to `true` once the two Supabase values below are filled in.
 */
export const AUTH_REQUIRED = false;

/** Shown in the sidebar and recorded in activity logs while sign-in is off. */
export const GUEST_NAME = 'Michael Amos';

/**
 * Connection details for Supabase Auth (only used when AUTH_REQUIRED is true).
 *
 * Fill these two values in from your Supabase dashboard:
 *   Project Settings → API → "Project URL" and "anon public" key.
 *
 * The anon key is designed to be public — it ships to every browser and
 * only grants what your Row Level Security policies allow, so it's safe
 * to commit. NEVER put the `service_role` key anywhere in this repo: it
 * bypasses all security rules.
 *
 * With AUTH_REQUIRED on but these values missing, the login page shows a
 * setup notice and the app stays locked (the guard fails closed, not open).
 */
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

/** Pinned so a CDN update can never silently change auth behaviour. */
export const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm';

/**
 * Whether the login page offers "Create account". This only hides the UI —
 * to truly close registration, also switch off "Allow new users to sign up"
 * in Supabase → Authentication → Sign In / Providers, then invite staff
 * from Authentication → Users.
 */
export const ALLOW_SIGNUP = true;

export function isSupabaseConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(SUPABASE_URL) && !SUPABASE_URL.includes('YOUR-PROJECT-REF')
    && SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.startsWith('YOUR-');
}
