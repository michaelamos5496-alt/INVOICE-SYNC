/**
 * integrations.service.js — connecting Shopify, WooCommerce, Stripe, Paystack and Hubtel.
 *
 * Secret keys are WRITE-ONLY from here: connect() sends them to the database function save_integration(),
 * and nothing in this app can read them back. "Test connection" asks the server-side "integrations" Edge Function,
 * which reads the key with the server's own credentials, calls the provider, and returns only a plain result.
 * What the whole team can see is the status and the non-secret details (see supabase/schema.sql).
 *
 * Needs cloud sync: without a shared database there is nowhere safe to keep a key.
 */
import { CLOUD_SYNC } from '../config/supabase.config.js';
import { getSupabase } from './supabase.service.js';
import { integrationByKey, validateIntegrationInput } from '../config/integrations.config.js';
import { friendlyDataError } from './cloud-data.service.js';

const FUNCTION_NAME = 'integrations';

export const integrationsSupported = () => CLOUD_SYNC;

const asError = (error) => Object.assign(new Error(
  error?.code === '42501' ? 'Only the shop owner can connect or change integrations.' : friendlyDataError(error),
), { code: error?.code });

/** @returns {Promise<Map<string, { status: string, settings: object, message: string, checkedAt: string|null, connectedBy: string }>>} */
export async function loadStatuses() {
  if (!CLOUD_SYNC) return new Map();
  const client = await getSupabase();
  const { data, error } = await client.from('integrations').select('provider,status,settings,last_message,last_checked_at,connected_by');
  if (error) throw asError(error);
  return new Map(data.map((row) => [row.provider, {
    status: row.status, settings: row.settings ?? {}, message: row.last_message ?? '', checkedAt: row.last_checked_at, connectedBy: row.connected_by ?? '',
  }]));
}

/** Runs the server-side check. Never throws for "not connected" outcomes — those come back as { ok: false, message }. */
export async function testConnection(provider, extra = {}) {
  const client = await getSupabase();
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body: { action: extra.action ?? 'test', provider, ...extra } });
  if (error) {
    // The function isn't deployed yet (404), or the network failed.
    const status = error.context?.status;
    if (status === 404 || /not found/i.test(error.message ?? '')) {
      return { ok: null, deployed: false, message: 'Saved. To verify the keys, deploy the "integrations" function (README → "Integrations"), then press Test connection.' };
    }
    if (status === 403) return { ok: false, message: 'Only the shop owner can test integrations.' };
    return { ok: false, message: 'Couldn\'t reach the checking service. Check your connection and try again.' };
  }
  return { deployed: true, ...data };
}

/**
 * Validates, saves, then tests. Values left blank for a secret keep what is already saved.
 * @returns {Promise<{ errors?: Record<string,string>, result?: object }>}
 */
export async function connect(providerKey, values, { alreadySaved = {} } = {}) {
  const integration = integrationByKey(providerKey);
  if (!integration) throw new Error('Unknown integration.');
  const { errors, settings, secrets } = validateIntegrationInput(integration, values, alreadySaved);
  if (Object.keys(errors).length) return { errors };

  const client = await getSupabase();
  const { error } = await client.rpc('save_integration', { p_provider: providerKey, p_settings: settings, p_secrets: secrets });
  if (error) throw asError(error);

  return { result: await testConnection(providerKey) };
}

export async function disconnect(providerKey) {
  const client = await getSupabase();
  const { error } = await client.rpc('remove_integration', { p_provider: providerKey });
  if (error) throw asError(error);
}

export const sendTestSms = (to) => testConnection('hubtel', { action: 'test-sms', to });

/** One page of the connected Shopify store's products (see the "integrations" Edge Function). Owner only. */
export async function fetchShopifyProductsPage(cursor = null) {
  const client = await getSupabase();
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body: { action: 'shopify-products', provider: 'shopify', cursor } });
  if (error) {
    const status = error.context?.status;
    if (status === 404 || /not found/i.test(error.message ?? '')) throw new Error('The "integrations" function needs updating before it can read products. Redeploy it from supabase/functions/integrations/index.ts (README → "Integrations").');
    if (status === 403) throw new Error('Only the shop owner can import from Shopify.');
    throw new Error('Couldn\'t reach the import service. Check your connection and try again.');
  }
  if (!data?.ok) throw new Error(data?.message || 'Shopify import failed.');
  return data; // { products, nextCursor }
}

/** Calls one of the Shopify actions of the "integrations" Edge Function and returns its data, or throws a readable message. */
async function invokeShopify(action, extra = {}) {
  const client = await getSupabase();
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body: { action, provider: 'shopify', ...extra } });
  if (error) {
    const status = error.context?.status;
    if (status === 404 || /not found/i.test(error.message ?? '')) throw new Error('The "integrations" function needs updating first. Redeploy it from supabase/functions/integrations/index.ts (README → "Integrations").');
    if (status === 403) throw new Error(action === 'shopify-set-stock' ? 'Sign in as a member of the shop first.' : 'Only the shop owner can do this.');
    throw new Error('Couldn\'t reach the service. Check your connection and try again.');
  }
  if (!data?.ok) throw new Error(data?.message || 'Shopify request failed.');
  return data;
}

/** The store's Shopify locations: [{ id, name }]. Owner only. */
export const fetchShopifyLocations = async () => (await invokeShopify('shopify-locations')).locations;

/** Asks Shopify to send new/cancelled orders to the shopify-webhook function. Owner only. Returns { message, address }. */
export const registerShopifyWebhooks = () => invokeShopify('shopify-register-webhooks');

/** Sets one item's available stock at one Shopify location. Any signed-in staff member (it runs on every sale). */
export const pushShopifyStock = ({ inventoryItemId, locationId, quantity }) => invokeShopify('shopify-set-stock', { inventoryItemId, locationId, quantity });
