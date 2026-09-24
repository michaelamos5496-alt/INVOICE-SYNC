/**
 * settings.service.js — store-wide configuration: profile, tax/currency
 * defaults, and preferences. With CLOUD_SYNC on it lives in one shared
 * database row (config → settings), so a change made by the owner shows up
 * for everyone; a copy is mirrored into localStorage so the login and splash
 * screens can show the shop's name before anyone has signed in. A single record, unlike every other service
 * here which manages a collection — so it skips api.service.js's generic
 * CRUD factory and talks to storage.service.js directly.
 *
 * DEFAULT_SETTINGS is merged under whatever's persisted so that adding a
 * new field here later doesn't break existing saved settings (old saves
 * just won't have that key, and the default fills in).
 */
import { storage } from './storage.service.js';
import { STORAGE_KEYS, APP_NAME } from '../config/constants.js';
import { CLOUD_SYNC } from '../config/supabase.config.js';
import { createCloudCollection } from './cloud-data.service.js';

export const DEFAULT_SETTINGS = {
  storeName: '', // unset until the owner enters one; the UI falls back to APP_NAME (see getBrandName)
  storeEmail: '',
  storePhone: '',
  storeAddress: '',
  currency: 'GHS',
  taxRate: 0,
  timezone: 'Africa/Accra',
  lowStockAlerts: true,
  emailNotifications: false,
};

/**
 * Currencies a shop can choose. `locale` decides symbol placement and number
 * grouping (en-GH → "GH₵1,234.50", en-NG → "₦1,234.50", en-US → "$1,234.50").
 * This is a display setting only — changing it relabels amounts, it does not
 * convert them.
 */
export const CURRENCIES = Object.freeze([
  { code: 'GHS', name: 'Ghanaian cedi', locale: 'en-GH' },
  { code: 'USD', name: 'US dollar', locale: 'en-US' },
  { code: 'NGN', name: 'Nigerian naira', locale: 'en-NG' },
  { code: 'EUR', name: 'Euro', locale: 'en-IE' },
  { code: 'GBP', name: 'British pound', locale: 'en-GB' },
]);

/** The old built-in default. Settings saved with it verbatim were never a name the owner chose. */
const LEGACY_PLACEHOLDER_NAME = 'InvSync Retail';

/** The shared settings, once they've been seen (CLOUD_SYNC only). Until then — and in local mode — settings come from localStorage. */
let cloudSettings = null;

export function getSettings() {
  const settings = { ...DEFAULT_SETTINGS, ...(cloudSettings ?? storage.get(STORAGE_KEYS.SETTINGS, {})) };
  if (settings.storeName === LEGACY_PLACEHOLDER_NAME) settings.storeName = '';
  return settings;
}

/** True once the owner has entered a business name in Settings → Store Profile. */
export function hasStoreName() {
  return Boolean(getSettings().storeName?.trim());
}

/** The name to show as the site's brand everywhere: the store name from Settings, or the app name until one is set. */
export function getBrandName() {
  return getSettings().storeName?.trim() || APP_NAME;
}

const SETTINGS_ID = 'settings';
let configCollection = null;
let lastOwnWriteAt = 0;
const remoteChangeHandlers = new Set();

/** Calls `handler(changedKeys)` when ANOTHER device changes currency or tax rate (pages already drawn keep showing the old ones until reloaded). */
export function onRemoteSettingsChange(handler) {
  remoteChangeHandlers.add(handler);
  return () => remoteChangeHandlers.delete(handler);
}
const stripMeta = ({ id, createdAt, updatedAt, ...settings }) => settings;

/**
 * Loads the shared settings and keeps them live (no-op unless CLOUD_SYNC). Awaited once at startup so
 * the first screen already uses the right currency, tax rate and shop name.
 */
export async function initSettings() {
  if (!CLOUD_SYNC) return;
  configCollection ??= createCloudCollection('config', 'cfg');
  const apply = (records) => {
    const doc = records.find((record) => record.id === SETTINGS_ID);
    if (!doc) return;
    const previous = cloudSettings;
    cloudSettings = stripMeta(doc);
    const changedElsewhere = previous && Date.now() - lastOwnWriteAt > 5000
      && ['currency', 'taxRate'].filter((key) => previous[key] !== cloudSettings[key]);
    if (changedElsewhere?.length) remoteChangeHandlers.forEach((handler) => handler(changedElsewhere));
    storage.set(STORAGE_KEYS.SETTINGS, cloudSettings); // mirror for pre-login screens; also tells open pages to refresh
  };
  apply(await configCollection.list());
  configCollection.subscribe(apply);
}

/** Saves settings. With sync on, the change is shared with everyone (owner only — see schema.sql). */
export async function updateSettings(patch) {
  const before = getSettings();
  const updated = { ...before, ...patch };
  if (!CLOUD_SYNC) { storage.set(STORAGE_KEYS.SETTINGS, updated); return updated; }

  lastOwnWriteAt = Date.now();
  const previousCloud = cloudSettings;
  cloudSettings = updated;
  storage.set(STORAGE_KEYS.SETTINGS, updated); // instant on this screen; rolled back below if refused
  try {
    configCollection ??= createCloudCollection('config', 'cfg');
    if (await configCollection.get(SETTINGS_ID)) await configCollection.update(SETTINGS_ID, patch);
    else await configCollection.create({ id: SETTINGS_ID, ...updated });
  } catch (err) {
    cloudSettings = previousCloud;
    storage.set(STORAGE_KEYS.SETTINGS, before);
    throw new Error(err?.code === '42501' ? 'Only the shop owner can change store settings.' : err.message);
  }
  return updated;
}

export function subscribeSettings(handler) {
  return storage.on(STORAGE_KEYS.SETTINGS, () => handler(getSettings()));
}

// formatCurrency() runs once per money value on screen — a table of 200 rows is
// hundreds of calls — so the current currency is cached rather than re-parsing
// the settings JSON each time. Saving settings (in this tab or another) clears it.
let currencyCache = null;
storage.on(STORAGE_KEYS.SETTINGS, () => { currencyCache = null; });

/** The shop's currency code, e.g. 'GHS'. Falls back to GHS if the saved value isn't a known currency. */
export function getCurrency() {
  if (currencyCache === null) {
    const saved = getSettings().currency;
    currencyCache = CURRENCIES.some((c) => c.code === saved) ? saved : DEFAULT_SETTINGS.currency;
  }
  return currencyCache;
}
