/**
 * migrate.service.js — one-time tool that copies what's stored in THIS browser
 * (products, sales, customers, settings, photos…) up into the shared database, so
 * switching cloud sync on doesn't mean starting from an empty shop.
 *
 * Safe by design:
 *   • Records that already exist in the shared database are left exactly as they are —
 *     nothing there is ever overwritten — so running it twice, or from two devices, is harmless.
 *   • This browser's own copy is never touched; it stays as a backup.
 *   • Photos are uploaded first and the product records are rewritten to point at the
 *     shared copies; if a photo fails, the tool stops before writing anything for that product.
 */
import { storage } from './storage.service.js';
import { STORAGE_KEYS } from '../config/constants.js';
import { RESOURCES } from './api.service.js';
import { getSupabase } from './supabase.service.js';
import { saveImage, readLocalImage, isIdbRef } from './image-store.service.js';
import { friendlyDataError } from './cloud-data.service.js';

const BATCH = 200;
const MIGRATED_KEY = 'invsync.migrated_to_cloud_at';

/** Counts what this browser holds, without touching the network. */
export function readLocalSummary() {
  const counts = {};
  let photos = 0;
  for (const [name, [, storageKey]] of Object.entries(RESOURCES)) {
    const records = storage.get(storageKey, []);
    if (Array.isArray(records) && records.length) counts[name] = records.length;
    if (name === 'products' && Array.isArray(records)) photos = records.reduce((n, p) => n + (p.images ?? []).filter(isIdbRef).length, 0);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total, photos, hasSettings: Boolean(storage.get(STORAGE_KEYS.SETTINGS)), lastRunAt: localStorage.getItem(MIGRATED_KEY) };
}

const toRow = (record) => {
  const { id, ...data } = record;
  const created = Date.parse(data.createdAt);
  return { id, data, created_at: Number.isNaN(created) ? new Date().toISOString() : new Date(created).toISOString() };
};

/**
 * @param {(progress: { label: string, done: number, total: number }) => void} [onProgress]
 * @returns {Promise<{ added: Record<string, number>, skipped: number, photos: number }>}
 */
export async function uploadLocalDataToCloud(onProgress = () => {}) {
  const client = await getSupabase();
  const summary = readLocalSummary();
  const total = summary.total + summary.photos + (summary.hasSettings ? 1 : 0);
  let done = 0;
  const tick = (label, n = 1) => { done += n; onProgress({ label, done, total }); };
  const result = { added: {}, skipped: 0, photos: 0 };

  // 1. Photos, then rewrite each product's references to the shared copies.
  const products = storage.get(STORAGE_KEYS.PRODUCTS, []).map((product) => ({ ...product }));
  for (const product of products) {
    if (!Array.isArray(product.images)) continue;
    const images = [];
    for (const ref of product.images) {
      if (!isIdbRef(ref)) { images.push(ref); continue; }
      const blob = await readLocalImage(ref);
      if (!blob) { tick('Photos'); continue; } // the photo is already gone from this browser — drop the dead reference
      try { images.push(await saveImage(blob)); } catch (err) { throw new Error(`Couldn't upload a photo for "${product.name}": ${err.message}`); }
      result.photos += 1;
      tick('Photos');
    }
    product.images = images;
  }

  // 2. The records, oldest kinds of data first (people & catalog before the orders that refer to them).
  const order = ['categories', 'brands', 'suppliers', 'warehouses', 'employees', 'customers', 'products', 'purchaseOrders', 'stockTransfers', 'sales', 'onlineOrders', 'returns', 'invoices', 'inventoryLog', 'activityLog', 'notifications'];
  for (const name of order) {
    const [path, storageKey] = RESOURCES[name];
    const records = name === 'products' ? products : storage.get(storageKey, []);
    if (!Array.isArray(records) || !records.length) continue;
    const table = path.replace(/-/g, '_');
    for (let i = 0; i < records.length; i += BATCH) {
      const chunk = records.slice(i, i + BATCH);
      // ignoreDuplicates → "insert unless it's already there": existing shared records are never overwritten.
      const { data, error } = await client.from(table).upsert(chunk.map(toRow), { onConflict: 'id', ignoreDuplicates: true }).select('id');
      if (error) throw new Error(`Couldn't upload ${name}: ${friendlyDataError(error)}`);
      result.added[name] = (result.added[name] ?? 0) + data.length;
      result.skipped += chunk.length - data.length;
      tick(name, chunk.length);
    }
  }

  // 3. Store settings — only if the shared database has none yet, and only the owner may write them.
  const localSettings = storage.get(STORAGE_KEYS.SETTINGS);
  if (localSettings && typeof localSettings === 'object') {
    const { error } = await client.from('config').upsert({ id: 'settings', data: { ...localSettings, createdAt: new Date().toISOString() } }, { onConflict: 'id', ignoreDuplicates: true });
    if (!error) result.added.settings = 1;
    tick('Settings');
  }

  localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
  return result;
}
