/**
 * supabase.config.js — the switch for shared, live-synced data, plus the
 * connection details for your Supabase project.
 *
 * CLOUD_SYNC is the master switch.
 *   false → the app works in this browser only (data in localStorage), with no
 *           login, exactly as before. Supabase is never contacted.
 *   true  → people sign in with Supabase Auth and ALL business data lives in your
 *           Supabase database, so everything one person adds shows up live on
 *           every other person's screen.
 * Turn it on only after filling in the two values below and running
 * supabase/schema.sql — see README.md ("Live sync (Supabase)").
 *
 * SUPABASE_URL and SUPABASE_ANON_KEY are safe to commit: they ship to every browser
 * by design and can only do what the database's row-level-security rules (created by
 * schema.sql) allow. NEVER put the `service_role` key anywhere in this repo — it
 * bypasses all of those rules.
 */
export const CLOUD_SYNC = true;

/** Shown in the sidebar and recorded in activity logs while CLOUD_SYNC is off. */
export const GUEST_NAME = 'Michael Amos';

/**
 * Whether the login page offers "Create an account" (anyone could then start their own shop).
 * false → accounts are created by hand in Supabase (Authentication → Users → Add user), which is
 * how you invite people. Also switch off "Allow new users to sign up" in Supabase (Authentication →
 * Sign In / Providers) so nobody can create an account by calling the API directly.
 */
export const ALLOW_SIGNUP = false;

/** Supabase dashboard → Project Settings → API → "Project URL" and the "anon public" key. */
export const SUPABASE_URL = 'https://lvszvpkxklgplrbktndb.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2c3p2cGt4a2xncGxyYmt0bmRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNTQ3MDAsImV4cCI6MjEwNTgzMDcwMH0.nUsfk3vEHDjLA4G2TC-VEXMco8XPwQyZg8UcLUnWj8w';

/** Pinned so a CDN update can never silently change behaviour. */
export const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm';

/** Name of the private Storage bucket that holds product photos (created by schema.sql). */
export const IMAGE_BUCKET = 'product-images';

export function isSupabaseConfigured() {
  const realProject = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(SUPABASE_URL) && !SUPABASE_URL.includes('YOUR-PROJECT-REF');
  const localDev = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SUPABASE_URL); // for testing against a local Supabase stack
  return (realProject || localDev) && SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.startsWith('YOUR-');
}
