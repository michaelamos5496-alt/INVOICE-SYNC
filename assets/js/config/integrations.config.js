/**
 * integrations.config.js — the five integrations shown in Settings → Integrations, and the details each one needs.
 *
 * A field marked `secret: true` is a key that must never be readable again once saved: it is sent to the
 * database's save_integration() function and from then on only the server-side "integrations" function can see it
 * (see supabase/schema.sql and supabase/functions/integrations). Fields without `secret` (a public key, a shop
 * address) are ordinary settings the whole team can see.
 *
 * `normalize` tidies what someone pasted; `pattern` is a first sanity check so a typo is caught before saving —
 * the real check is "Test connection", which asks the provider itself.
 */
const trimmed = (value) => String(value ?? '').trim();

export const INTEGRATIONS = [
  {
    key: 'paystack', name: 'Paystack', icon: 'fa-credit-card', style: 'fa-solid',
    summary: 'Card and mobile-money payments.',
    where: 'Paystack dashboard → Settings → API Keys & Webhooks',
    docsUrl: 'https://dashboard.paystack.com/#/settings/developers',
    fields: [
      { key: 'publicKey', label: 'Public key', secret: false, placeholder: 'pk_live_… or pk_test_…', pattern: /^pk_(test|live)_[A-Za-z0-9]+$/, patternHint: 'A Paystack public key starts with pk_test_ or pk_live_.' },
      { key: 'secretKey', label: 'Secret key', secret: true, placeholder: 'sk_live_… or sk_test_…', pattern: /^sk_(test|live)_[A-Za-z0-9]+$/, patternHint: 'A Paystack secret key starts with sk_test_ or sk_live_.' },
    ],
  },
  {
    key: 'stripe', name: 'Stripe', icon: 'fa-stripe', style: 'fa-brands',
    summary: 'International card payments.',
    where: 'Stripe dashboard → Developers → API keys',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    fields: [
      { key: 'publishableKey', label: 'Publishable key', secret: false, placeholder: 'pk_live_… or pk_test_…', pattern: /^pk_(test|live)_[A-Za-z0-9]+$/, patternHint: 'A Stripe publishable key starts with pk_test_ or pk_live_.' },
      { key: 'secretKey', label: 'Secret key', secret: true, placeholder: 'sk_live_… or sk_test_…', pattern: /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/, patternHint: 'A Stripe secret key starts with sk_test_ or sk_live_ (or rk_ for a restricted key).' },
    ],
  },
  {
    key: 'shopify', name: 'Shopify', icon: 'fa-shopify', style: 'fa-brands',
    summary: 'Online orders and stock levels.',
    where: 'Shopify admin → Settings → Apps and sales channels → Develop apps → your app → API credentials (Admin API access token)',
    docsUrl: 'https://help.shopify.com/en/manual/apps/app-types/custom-apps',
    fields: [
      {
        key: 'shopDomain', label: 'Store address', secret: false, placeholder: 'your-store.myshopify.com',
        normalize: (v) => trimmed(v).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
        pattern: /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, patternHint: 'The store address looks like your-store.myshopify.com (not your custom domain).',
      },
      { key: 'accessToken', label: 'Admin API access token', secret: true, placeholder: 'shpat_…', pattern: /^shp[a-z]{2}_[A-Za-z0-9]+$/, patternHint: 'A Shopify Admin API token starts with shpat_.' },
    ],
  },
  {
    key: 'woocommerce', name: 'WooCommerce', icon: 'fa-wordpress', style: 'fa-brands',
    summary: 'Online orders and stock levels.',
    where: 'WordPress admin → WooCommerce → Settings → Advanced → REST API → Add key (permissions: Read/Write)',
    docsUrl: 'https://woocommerce.com/document/woocommerce-rest-api/',
    fields: [
      {
        key: 'siteUrl', label: 'Shop address', secret: false, placeholder: 'https://yourshop.com',
        normalize: (v) => trimmed(v).replace(/\/+$/, ''),
        pattern: /^https:\/\/[^\s/@]+\.[^\s/@]+$/i, patternHint: 'Use your shop\'s main https address, for example https://yourshop.com.',
      },
      { key: 'consumerKey', label: 'Consumer key', secret: true, placeholder: 'ck_…', pattern: /^ck_[A-Za-z0-9]+$/, patternHint: 'A WooCommerce consumer key starts with ck_.' },
      { key: 'consumerSecret', label: 'Consumer secret', secret: true, placeholder: 'cs_…', pattern: /^cs_[A-Za-z0-9]+$/, patternHint: 'A WooCommerce consumer secret starts with cs_.' },
    ],
  },
  {
    key: 'hubtel', name: 'Hubtel', icon: 'fa-mobile-screen', style: 'fa-solid',
    summary: 'Mobile money and SMS receipts.',
    where: 'Hubtel dashboard → your API / developer settings (Client ID and Client Secret)',
    docsUrl: 'https://developers.hubtel.com/',
    smsTest: true,
    fields: [
      { key: 'senderId', label: 'SMS sender name', secret: false, placeholder: 'MyShop', hint: 'Up to 11 letters or numbers — shown to whoever receives a text.', pattern: /^[A-Za-z0-9]{1,11}$/, patternHint: 'The sender name can be up to 11 letters or numbers, with no spaces.' },
      { key: 'clientId', label: 'Client ID', secret: true, placeholder: 'Your Hubtel Client ID', pattern: /^\S{4,}$/, patternHint: 'Paste your Hubtel Client ID.' },
      { key: 'clientSecret', label: 'Client secret', secret: true, placeholder: 'Your Hubtel Client Secret', pattern: /^\S{4,}$/, patternHint: 'Paste your Hubtel Client Secret.' },
    ],
  },
];

export const integrationByKey = (key) => INTEGRATIONS.find((integration) => integration.key === key);

/**
 * Checks what was typed into the form. `saved` says which secrets already exist, so leaving one blank is fine (keep it).
 * @returns {{ errors: Record<string,string>, settings: object, secrets: object }}
 */
export function validateIntegrationInput(integration, values, saved = {}) {
  const errors = {};
  const settings = {};
  const secrets = {};
  for (const field of integration.fields) {
    const raw = field.normalize ? field.normalize(values[field.key]) : trimmed(values[field.key]);
    if (!raw) {
      if (field.secret && saved[field.key]) continue;                 // left blank on purpose: keep the saved key
      errors[field.key] = `${field.label} is required.`;
      continue;
    }
    if (field.pattern && !field.pattern.test(raw)) { errors[field.key] = field.patternHint ?? `${field.label} doesn't look right.`; continue; }
    (field.secret ? secrets : settings)[field.key] = raw;
  }
  return { errors, settings, secrets };
}
