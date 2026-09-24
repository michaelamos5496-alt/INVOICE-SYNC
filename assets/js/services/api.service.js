/**
 * api.service.js
 *
 * Data-access facade. Every page/component imports from HERE, never from
 * storage.service.js directly. That indirection is the whole point: today
 * `DATA_ADAPTER` is 'local' and every call resolves against localStorage;
 * flipping it to 'rest' in constants.js (Phase 10) repoints every one of
 * these methods at `fetch(`${API_BASE_URL}/...`)` against the Node/Express
 * + Postgres/MySQL backend, or a Supabase client, with zero changes needed
 * in page code.
 *
 * All methods are async and return Promises even in the 'local' adapter,
 * so calling code is already written the way it needs to be for a real
 * network round-trip.
 */
import { storage } from './storage.service.js';
import { STORAGE_KEYS, DATA_ADAPTER, API_BASE_URL } from '../config/constants.js';

const SIMULATED_LATENCY_MS = 120;

function delay(ms = SIMULATED_LATENCY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    subscribe() {
      // Phase 10: replace with a WebSocket/SSE subscription to the backend
      // so multi-device/multi-terminal stock changes push in real time.
      return () => {};
    },
  };
}

const factory = DATA_ADAPTER === 'rest' ? createRestCollection : createCollection;

export const api = {
  products:        DATA_ADAPTER === 'rest' ? factory('products')        : factory(STORAGE_KEYS.PRODUCTS, 'prod'),
  categories:      DATA_ADAPTER === 'rest' ? factory('categories')      : factory(STORAGE_KEYS.CATEGORIES, 'cat'),
  brands:          DATA_ADAPTER === 'rest' ? factory('brands')          : factory(STORAGE_KEYS.BRANDS, 'brand'),
  suppliers:       DATA_ADAPTER === 'rest' ? factory('suppliers')       : factory(STORAGE_KEYS.SUPPLIERS, 'sup'),
  customers:       DATA_ADAPTER === 'rest' ? factory('customers')       : factory(STORAGE_KEYS.CUSTOMERS, 'cust'),
  employees:       DATA_ADAPTER === 'rest' ? factory('employees')       : factory(STORAGE_KEYS.EMPLOYEES, 'emp'),
  sales:           DATA_ADAPTER === 'rest' ? factory('sales')           : factory(STORAGE_KEYS.SALES, 'sale'),
  onlineOrders:    DATA_ADAPTER === 'rest' ? factory('online-orders')   : factory(STORAGE_KEYS.ONLINE_ORDERS, 'onl'),
  purchaseOrders:  DATA_ADAPTER === 'rest' ? factory('purchase-orders') : factory(STORAGE_KEYS.PURCHASE_ORDERS, 'po'),
  stockTransfers:  DATA_ADAPTER === 'rest' ? factory('stock-transfers') : factory(STORAGE_KEYS.STOCK_TRANSFERS, 'trf'),
  returns:         DATA_ADAPTER === 'rest' ? factory('returns')         : factory(STORAGE_KEYS.RETURNS, 'ret'),
  invoices:        DATA_ADAPTER === 'rest' ? factory('invoices')        : factory(STORAGE_KEYS.INVOICES, 'invc'),
  inventoryLog:    DATA_ADAPTER === 'rest' ? factory('inventory-log')   : factory(STORAGE_KEYS.INVENTORY_LOG, 'invlog'),
  activityLog:     DATA_ADAPTER === 'rest' ? factory('activity-log')   : factory(STORAGE_KEYS.ACTIVITY_LOG, 'act'),
  notifications:   DATA_ADAPTER === 'rest' ? factory('notifications')  : factory(STORAGE_KEYS.NOTIFICATIONS, 'note'),
  warehouses:      DATA_ADAPTER === 'rest' ? factory('warehouses')     : factory(STORAGE_KEYS.WAREHOUSES, 'wh'),
};

export { generateId };
