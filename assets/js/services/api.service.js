/**
 * api.service.js
 *
 * Data-access facade. Every page/component imports from HERE, never from
 * storage.service.js directly. That indirection is the whole point: today
 * `DATA_ADAPTER` is 'local' and every call resolves against localStorage.
 * With CLOUD_SYNC on (supabase.config.js) the very same methods talk to a
 * shared Supabase database instead — see cloud-data.service.js — with zero
 * changes needed in page code. (A custom REST backend is still supported via
 * DATA_ADAPTER = 'rest'.)
 *
 * All methods are async and return Promises even in the 'local' adapter,
 * so calling code is already written the way it needs to be for a real
 * network round-trip.
 */
import { storage } from './storage.service.js';
import { STORAGE_KEYS, DATA_ADAPTER, API_BASE_URL } from '../config/constants.js';
import { CLOUD_SYNC } from '../config/supabase.config.js';
import { createCloudCollection } from './cloud-data.service.js';
import { generateId } from '../utils/ids.js';

const SIMULATED_LATENCY_MS = 120;

function delay(ms = SIMULATED_LATENCY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generic CRUD factory over a storage collection (array of records keyed
 * by `id`). Every domain entity (products, customers, suppliers, ...)
 * gets one of these so business logic never hand-rolls array splicing.
 */
function createCollection(storageKey, idPrefix) {
  /** storage.set() reports failure with `false` (usually a full browser quota) — never let that pass as success. */
  const persist = (records) => {
    if (!storage.set(storageKey, records)) {
      throw new Error('Your browser\'s storage is full, so this couldn\'t be saved. Delete some unused products or photos and try again.');
    }
  };

  return {
    async list(filterFn) {
      await delay();
      const all = storage.get(storageKey, []);
      return typeof filterFn === 'function' ? all.filter(filterFn) : all;
    },

    async get(id) {
      await delay();
      return storage.get(storageKey, []).find((r) => r.id === id) ?? null;
    },

    async create(record) {
      await delay();
      const all = storage.get(storageKey, []);
      const newRecord = {
        id: generateId(idPrefix),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...record,
      };
      all.push(newRecord);
      persist(all);
      return newRecord;
    },

    async update(id, patch) {
      await delay();
      const all = storage.get(storageKey, []);
      const idx = all.findIndex((r) => r.id === id);
      if (idx === -1) throw new Error(`Record ${id} not found in ${storageKey}`);
      all[idx] = { ...all[idx], ...patch, id, updatedAt: new Date().toISOString() };
      persist(all);
      return all[idx];
    },

    async remove(id) {
      await delay();
      const all = storage.get(storageKey, []);
      storage.set(storageKey, all.filter((r) => r.id !== id));
      return true;
    },

    /** Read-modify-write in one step: `fn(current)` returns the fields to change, or throws to abort. */
    async mutate(id, fn) {
      await delay();
      const all = storage.get(storageKey, []);
      const idx = all.findIndex((r) => r.id === id);
      if (idx === -1) throw new Error(`Record ${id} not found in ${storageKey}`);
      all[idx] = { ...all[idx], ...fn(all[idx]), id, updatedAt: new Date().toISOString() };
      persist(all);
      return all[idx];
    },

    /** Live subscription — fires with the fresh list whenever it changes. */
    subscribe(handler) {
      return storage.on(storageKey, (value) => handler(value ?? []));
    },
  };
}

// ---------------------------------------------------------------------------
// REST adapter stub (Phase 10 target). Kept side-by-side with the local
// adapter so the swap is a one-line change in constants.js, not a rewrite.
// ---------------------------------------------------------------------------
function createRestCollection(resourcePath) {
  const url = `${API_BASE_URL}/${resourcePath}`;
  return {
    async list(query = {}) {
      const qs = new URLSearchParams(query).toString();
      const res = await fetch(qs ? `${url}?${qs}` : url, { credentials: 'include' });
      return res.json();
    },
    async get(id) {
      const res = await fetch(`${url}/${id}`, { credentials: 'include' });
      return res.json();
    },
    async create(record) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(record),
      });
      return res.json();
    },
    async update(id, patch) {
      const res = await fetch(`${url}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      });
      return res.json();
    },
    async remove(id) {
      await fetch(`${url}/${id}`, { method: 'DELETE', credentials: 'include' });
      return true;
    },
    async mutate(id, fn) { // not atomic over plain REST — the real backend should expose a dedicated endpoint
      const patch = fn(await this.get(id));
      return this.update(id, patch);
    },
    subscribe() {
      // Phase 10: replace with a WebSocket/SSE subscription to the backend
      // so multi-device/multi-terminal stock changes push in real time.
      return () => {};
    },
  };
}

/**
 * name → [collection path, local storage key, id prefix, cloud options].
 * The path doubles as the database table name (hyphens become underscores) and must match supabase/schema.sql.
 * `windowDays` limits busy history collections to recent records when synced,
 * so the amount downloaded doesn't grow forever (see cloud-data.service.js).
 */
export const RESOURCES = {
  products:       ['products',        STORAGE_KEYS.PRODUCTS,        'prod'],
  categories:     ['categories',      STORAGE_KEYS.CATEGORIES,      'cat'],
  brands:         ['brands',          STORAGE_KEYS.BRANDS,          'brand'],
  suppliers:      ['suppliers',       STORAGE_KEYS.SUPPLIERS,       'sup'],
  customers:      ['customers',       STORAGE_KEYS.CUSTOMERS,       'cust'],
  employees:      ['employees',       STORAGE_KEYS.EMPLOYEES,       'emp'],
  sales:          ['sales',           STORAGE_KEYS.SALES,           'sale', { windowDays: 45 }],
  onlineOrders:   ['online-orders',   STORAGE_KEYS.ONLINE_ORDERS,   'onl',  { windowDays: 45 }],
  purchaseOrders: ['purchase-orders', STORAGE_KEYS.PURCHASE_ORDERS, 'po'],
  stockTransfers: ['stock-transfers', STORAGE_KEYS.STOCK_TRANSFERS, 'trf'],
  returns:        ['returns',         STORAGE_KEYS.RETURNS,         'ret'],
  invoices:       ['invoices',        STORAGE_KEYS.INVOICES,        'invc'],
  inventoryLog:   ['inventory-log',   STORAGE_KEYS.INVENTORY_LOG,   'invlog', { windowDays: 30 }],
  activityLog:    ['activity-log',    STORAGE_KEYS.ACTIVITY_LOG,    'act',    { windowDays: 30 }],
  notifications:  ['notifications',   STORAGE_KEYS.NOTIFICATIONS,   'note',   { windowDays: 30 }],
  warehouses:     ['warehouses',      STORAGE_KEYS.WAREHOUSES,      'wh'],
};

/** CLOUD_SYNC on → shared Supabase data; otherwise DATA_ADAPTER ('local' browser storage, or the future 'rest' backend). */
function build([path, storageKey, prefix, cloudOptions]) {
  if (CLOUD_SYNC) return createCloudCollection(path, prefix, cloudOptions);
  return DATA_ADAPTER === 'rest' ? createRestCollection(path) : createCollection(storageKey, prefix);
}

export const api = Object.fromEntries(Object.entries(RESOURCES).map(([name, def]) => [name, build(def)]));

export { generateId };
