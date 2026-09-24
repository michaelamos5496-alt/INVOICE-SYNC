/**
 * supabase.service.js — loads supabase-js and hands out the one shared client.
 * The only module that imports the library; auth.service, cloud-data.service and
 * image-store.service all get the client from here.
 *
 * The library comes from a pinned CDN URL and is loaded on first use, so while
 * CLOUD_SYNC is off it costs nothing. The session lives in localStorage
 * (supabase-js's default), refreshes itself, and is shared by every open tab.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JS_URL, isSupabaseConfigured } from '../config/supabase.config.js';

let clientPromise = null;

/** @returns {Promise<import('@supabase/supabase-js').SupabaseClient>} */
export function getSupabase() {
  if (!isSupabaseConfigured()) {
    return Promise.reject(new Error('Supabase isn\'t configured yet. Add your project URL and anon key in assets/js/config/supabase.config.js.'));
  }
  clientPromise ??= import(/* @vite-ignore */ SUPABASE_JS_URL)
    .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
      realtime: { params: { eventsPerSecond: 20 } },
    }))
    .catch((err) => { clientPromise = null; throw err; });
  return clientPromise;
}
