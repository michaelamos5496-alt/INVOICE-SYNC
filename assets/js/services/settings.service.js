/**
 * settings.service.js — store-wide configuration: profile, tax/currency
 * defaults, and preferences. A single record, unlike every other service
 * here which manages a collection — so it skips api.service.js's generic
 * CRUD factory and talks to storage.service.js directly.
 *
 * DEFAULT_SETTINGS is merged under whatever's persisted so that adding a
 * new field here later doesn't break existing saved settings (old saves
 * just won't have that key, and the default fills in).
 */
import { storage } from './storage.service.js';
import { STORAGE_KEYS } from '../config/constants.js';

export const DEFAULT_SETTINGS = {
  storeName: 'InvSync Retail',
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

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...storage.get(STORAGE_KEYS.SETTINGS, {}) };
}

export function updateSettings(patch) {
  const updated = { ...getSettings(), ...patch };
  storage.set(STORAGE_KEYS.SETTINGS, updated);
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
