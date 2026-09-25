// Supabase Edge Function: integrations
//
// The ONLY place that ever reads a saved integration key. The website can save keys (through the
// database function save_integration) but can never read them back; when the owner presses "Test
// connection", the website asks THIS function, which reads the key with the server-side service key, calls the
// provider, and reports back a plain "connected / not connected + why" — never the key itself.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name it exactly `integrations`,
// paste this file, deploy. (Or: `supabase functions deploy integrations` with the CLI.)
// Supabase provides SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to functions automatically.
//
// NOTE: written to each provider's public API documentation. Provider APIs change, so treat the first
// "Test connection" against a real account as the real test.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const SHOPIFY_API_VERSION = '2026-01';
const TIMEOUT_MS = 12000;

/** Replaces any secret that slipped into a provider's error text, so a key can never travel back to the browser. */
function redact(text, secrets) {
  let out = String(text ?? '');
  for (const value of Object.values(secrets ?? {})) if (typeof value === 'string' && value.length > 5) out = out.split(value).join('[hidden]');
  return out.slice(0, 300);
}

async function call(fetcher, url, init = {}) {
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
  let body = null;
  try { body = await response.json(); } catch { /* not JSON */ }
  return { status: response.status, body, redirected: response.status >= 300 && response.status < 400 };
}

/** Only real public https sites — never localhost, private networks, or addresses with embedded logins. */
function safePublicHttps(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const isPrivate = host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || !host.includes('.');
  if (url.protocol !== 'https:' || url.username || url.password || isPrivate) return null;
  return url.origin;
}

const basic = (user, pass) => `Basic ${btoa(`${user}:${pass}`)}`;

const CHECKS = {
  async paystack({ secrets }, fetcher) {
    const r = await call(fetcher, 'https://api.paystack.co/balance', { headers: { Authorization: `Bearer ${secrets.secretKey}` } });
    if (r.status === 200 && r.body?.status !== false) return { ok: true, message: `Connected to Paystack (${String(secrets.secretKey).startsWith('sk_test_') ? 'test' : 'live'} mode).` };
    if (r.status === 401) return { ok: false, message: 'Paystack rejected that secret key. Copy it again from your Paystack dashboard (Settings → API Keys).' };
    return { ok: false, message: `Paystack answered with an unexpected error (${r.status}). Try again in a moment.` };
  },

  async stripe({ secrets }, fetcher) {
    const r = await call(fetcher, 'https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${secrets.secretKey}` } });
    if (r.status === 200) return { ok: true, message: `Connected to Stripe (${r.body?.livemode ? 'live' : 'test'} mode).` };
    if (r.status === 401) return { ok: false, message: 'Stripe rejected that secret key. Copy it again from your Stripe dashboard (Developers → API keys).' };
    if (r.status === 403) return { ok: false, message: 'That Stripe key is restricted and can\'t read the balance. Allow "Balance: read" on it, or use the standard secret key.' };
    return { ok: false, message: `Stripe answered with an unexpected error (${r.status}). Try again in a moment.` };
  },

  async shopify({ settings, secrets }, fetcher) {
    const domain = String(settings.shopDomain ?? '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) return { ok: false, message: 'The store address should look like your-store.myshopify.com.' };
    const r = await call(fetcher, `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, { headers: { 'X-Shopify-Access-Token': secrets.accessToken } });
    if (r.status === 200 && r.body?.shop) return { ok: true, message: `Connected to the Shopify store "${String(r.body.shop.name ?? domain)}".` };
    if (r.status === 401 || r.status === 403) return { ok: false, message: 'Shopify rejected that access token, or it lacks permission. Check the app\'s Admin API scopes and copy the token again.' };
    if (r.status === 404 || r.redirected) return { ok: false, message: 'Shopify couldn\'t find that store. Check the address (your-store.myshopify.com).' };
    return { ok: false, message: `Shopify answered with an unexpected error (${r.status}). Try again in a moment.` };
  },

  async woocommerce({ settings, secrets }, fetcher) {
    const origin = safePublicHttps(String(settings.siteUrl ?? ''));
    if (!origin) return { ok: false, message: 'Use your shop\'s full https address, for example https://yourshop.com.' };
    const r = await call(fetcher, `${origin}/wp-json/wc/v3/products?per_page=1`, { headers: { Authorization: basic(secrets.consumerKey, secrets.consumerSecret) } });
    if (r.status === 200) return { ok: true, message: 'Connected to your WooCommerce shop.' };
    if (r.status === 401 || r.status === 403) return { ok: false, message: 'WooCommerce rejected those keys. Create a new Read/Write key (WooCommerce → Settings → Advanced → REST API) and copy both parts again.' };
    if (r.status === 404 || r.redirected) return { ok: false, message: 'That address doesn\'t have the WooCommerce API. Check the address, and that permalinks are switched on (not "Plain").' };
    return { ok: false, message: `The shop answered with an unexpected error (${r.status}). Try again in a moment.` };
  },

  // Hubtel has no free, harmless "check my keys" call that I can rely on, so keys are only confirmed by sending a text.
  async hubtel() {
    return { ok: null, message: 'Saved. Hubtel can only be confirmed by sending a test text message — use "Send test SMS".' };
  },
};

async function sendHubtelSms({ settings, secrets }, fetcher, to) {
  const number = String(to ?? '').replace(/[\s()-]/g, '');
  if (!/^\+?\d{9,15}$/.test(number)) return { ok: false, message: 'Enter a phone number with country code, for example +233240000000.' };
  const from = String(settings.senderId ?? '').trim();
  if (!from) return { ok: false, message: 'Add a sender name (up to 11 letters or numbers) to your Hubtel details first.' };
  const r = await call(fetcher, 'https://sms.hubtel.com/v1/messages/send', {
    method: 'POST',
    headers: { Authorization: basic(secrets.clientId, secrets.clientSecret), 'content-type': 'application/json' },
    body: JSON.stringify({ From: from, To: number.replace(/^\+/, ''), Content: 'Test message from your shop — Hubtel is connected.' }),
  });
  if (r.status >= 200 && r.status < 300) return { ok: true, message: `Test text sent to ${number}. If it arrives, Hubtel is connected.` };
  if (r.status === 401 || r.status === 403) return { ok: false, message: 'Hubtel rejected those credentials. Copy your Client ID and Client Secret again.' };
  return { ok: false, message: `Hubtel couldn't send the message (${r.status}). Check the sender name and that your account has SMS credit.` };
}

/**
 * @param req   the incoming Request
 * @param deps  { createClient, fetch, env } — injected so this file can be tested without Supabase.
 */
export async function handle(req, deps) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, message: 'Use POST.' });

  let body;
  try { body = await req.json(); } catch { return json(400, { ok: false, message: 'Bad request.' }); }
  const { action, provider } = body ?? {};
  if (!['test', 'test-sms'].includes(action) || !Object.hasOwn(CHECKS, provider ?? '')) return json(400, { ok: false, message: 'Unknown action or provider.' });

  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = deps.env;
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization) return json(401, { ok: false, message: 'Sign in first.' });

  // Only the Shop Owner may run this: ask the database, as the caller, whether they are one.
  const asCaller = deps.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authorization } } });
  const { data: isOwner, error: ownerError } = await asCaller.rpc('is_owner');
  if (ownerError || isOwner !== true) return json(403, { ok: false, message: 'Only the shop owner can test integrations.' });

  // Every shop has its own connections: only ever touch the caller's shop.
  const { data: shopId, error: shopError } = await asCaller.rpc('current_shop_id');
  if (shopError || !shopId) return json(403, { ok: false, message: 'Only the shop owner can test integrations.' });

  const server = deps.createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const [{ data: row }, { data: secretRow }] = await Promise.all([
    server.from('integrations').select('settings,status').eq('shop_id', shopId).eq('provider', provider).maybeSingle(),
    server.from('integration_secrets').select('secrets').eq('shop_id', shopId).eq('provider', provider).maybeSingle(),
  ]);
  if (!row || !secretRow || row.status === 'disconnected') return json(200, { ok: false, status: 'disconnected', message: 'Nothing is saved for this integration yet.' });

  const credentials = { settings: row.settings ?? {}, secrets: secretRow.secrets ?? {} };
  let result;
  try {
    result = action === 'test-sms' ? (provider === 'hubtel' ? await sendHubtelSms(credentials, deps.fetch, body.to) : { ok: false, message: 'Test SMS is only for Hubtel.' })
      : await CHECKS[provider](credentials, deps.fetch);
  } catch (err) {
    result = { ok: false, message: err?.name === 'TimeoutError' ? 'The provider took too long to answer. Try again.' : 'Couldn\'t reach the provider. Check the address and try again.' };
  }
  result.message = redact(result.message, credentials.secrets);

  // ok === null means "saved but this provider can't be checked automatically" — leave the status as it is.
  if (result.ok !== null) {
    await server.from('integrations').update({
      status: result.ok ? 'connected' : 'error', last_checked_at: new Date().toISOString(), last_message: result.message,
    }).eq('shop_id', shopId).eq('provider', provider);
  }
  return json(200, { ok: result.ok, status: result.ok === null ? row.status : result.ok ? 'connected' : 'error', message: result.message });
}

// Entry point when running on Supabase (Deno). Skipped when the file is imported by a test.
if (typeof Deno !== 'undefined' && Deno.serve) {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  Deno.serve((req) => handle(req, { createClient, fetch, env: {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  } }));
}
