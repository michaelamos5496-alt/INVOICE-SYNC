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
