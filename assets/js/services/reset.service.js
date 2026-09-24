/**
 * reset.service.js — data lifecycle controls surfaced in Settings → Data.
 * The app no longer auto-seeds demo data on load (see app.js); instead a
 * shop owner explicitly chooses to start from an empty store or load
 * sample data to explore the product. `clearAllData()` wipes business
 * data only — it deliberately leaves THEME and SETTINGS alone, since
 * those are the owner's real preferences/store profile, not demo content.
 */
import { storage } from './storage.service.js';
import { STORAGE_KEYS } from '../config/constants.js';
import { seedDemoData } from './seed.service.js';
import { clearAllImages } from './image-store.service.js';

const NON_BUSINESS_KEYS = new Set(['THEME', 'SETTINGS', 'SESSION', 'LEGACY_SEED_MIGRATED']);
const BUSINESS_DATA_KEYS = Object.keys(STORAGE_KEYS)
  .filter((key) => !NON_BUSINESS_KEYS.has(key))
  .map((key) => STORAGE_KEYS[key]);

/** Removes every product, order, customer, and log entry. Preferences and store settings are untouched. */
export function clearAllData() {
  BUSINESS_DATA_KEYS.forEach((key) => storage.remove(key));
  clearAllImages(); // product photos live in IndexedDB, outside STORAGE_KEYS; fire-and-forget, it never throws
}

/** Populates empty collections with realistic sample data for exploring the product. Never overwrites existing records. */
export async function loadSampleData() {
  await seedDemoData();
}

/** True if every business-data collection is empty — used to decide whether to offer "Load Sample Data" vs. warn before overwriting. */
export function hasAnyData() {
  return BUSINESS_DATA_KEYS.some((key) => {
    const value = storage.get(key, []);
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}

/**
 * One-time cleanup for browsers that loaded the app before it stopped
 * auto-seeding on every visit. Those installs have demo products/sales
 * sitting in localStorage with deterministic ids like "prod_seed_1" —
 * detect that signature and wipe it exactly once, guarded by a flag so
 * a shop owner's real data (which never has that id shape) is never
 * touched by this again after the first post-update load.
 */
export function migrateLegacyAutoSeed() {
  if (storage.get(STORAGE_KEYS.LEGACY_SEED_MIGRATED, false)) return false;

  const products = storage.get(STORAGE_KEYS.PRODUCTS, []);
  const looksLikeOldAutoSeed = Array.isArray(products) && products.some((p) => String(p.id).startsWith('prod_seed_'));

  if (looksLikeOldAutoSeed) clearAllData();
  storage.set(STORAGE_KEYS.LEGACY_SEED_MIGRATED, true);
  return looksLikeOldAutoSeed;
}
