/**
 * shopify-push.service.js — sends OneDesk stock changes to Shopify (the OneDesk → Shopify half of two-way sync).
 *
 * Runs after every stock change (see inventory.service.js) when the owner has turned it on in Settings → Integrations →
 * Shopify → Two-way sync. Only products WITHOUT variants are sent: OneDesk's till sells a product, not a variant, so for a
 * product with variants there is no way to know which variant's Shopify count a shop sale should lower. (Shopify →
 * OneDesk works for variants too — the order says which variant sold.)
 *
 * Failures never block the sale: they are reported through the sync-error banner and the next change sends the
 * up-to-date number anyway.
 */
import { CLOUD_SYNC } from '../config/supabase.config.js';
import { getSettings } from './settings.service.js';
import { loadStatuses, pushShopifyStock } from './integrations.service.js';
import { reportSyncError } from './cloud-data.service.js';

const CONNECTED_TTL_MS = 5 * 60 * 1000;
let connected = false;
let checkedAt = 0;
let queue = Promise.resolve(); // one push at a time, in order, so Shopify ends on the newest number (and stays inside its rate limit)

async function shopifyConnected() {
  if (Date.now() - checkedAt > CONNECTED_TTL_MS) {
    try { connected = (await loadStatuses()).get('shopify')?.status === 'connected'; } catch { connected = false; }
    checkedAt = Date.now();
  }
  return connected;
}

/** Fire-and-forget: call with the product record as it stands after the stock change. */
export function pushProductStock(product) {
  if (!CLOUD_SYNC) return;
  const { shopifyPushStock, shopifyLocationId } = getSettings();
  const inventoryItemId = product?.shopify?.inventoryItemId;
  if (!shopifyPushStock || !shopifyLocationId || !inventoryItemId) return;

  queue = queue.then(async () => {
    if (!(await shopifyConnected())) return;
    try {
      await pushShopifyStock({ inventoryItemId, locationId: shopifyLocationId, quantity: product.stockQuantity });
    } catch (err) {
      reportSyncError(err, `sending ${product.name}'s stock to Shopify`);
    }
  });
}
