/**
 * App-wide constants. Centralized so environment/backend swaps (Phase 10)
 * touch one file instead of scattered magic strings.
 */
export const APP_NAME = 'InvSync';

export const STORAGE_KEYS = Object.freeze({
  THEME: 'invsync.theme',
  PRODUCTS: 'invsync.products',
  CATEGORIES: 'invsync.categories',
  BRANDS: 'invsync.brands',
  SUPPLIERS: 'invsync.suppliers',
  CUSTOMERS: 'invsync.customers',
  EMPLOYEES: 'invsync.employees',
  SALES: 'invsync.sales',
  ONLINE_ORDERS: 'invsync.online_orders',
  PURCHASE_ORDERS: 'invsync.purchase_orders',
  STOCK_TRANSFERS: 'invsync.stock_transfers',
  RETURNS: 'invsync.returns',
  INVOICES: 'invsync.invoices',
  INVENTORY_LOG: 'invsync.inventory_log',
  ACTIVITY_LOG: 'invsync.activity_log',
  NOTIFICATIONS: 'invsync.notifications',
  WAREHOUSES: 'invsync.warehouses',
  SESSION: 'invsync.session',
  SETTINGS: 'invsync.settings',
  LEGACY_SEED_MIGRATED: 'invsync.legacy_seed_migrated',
});

// Sales channels — every stock-moving transaction is tagged with one of
// these so the dashboard/reports can break down movement by channel while
// still writing to the single shared inventory pool.
export const CHANNELS = Object.freeze({
  PHYSICAL: 'physical_shop',
  ONLINE: 'online_shop',
});

export const STOCK_MOVEMENT_TYPES = Object.freeze({
  SALE: 'sale',
  RETURN: 'return',
  ADJUSTMENT: 'adjustment',
  RESTOCK: 'restock',
  TRANSFER_IN: 'transfer_in',
  TRANSFER_OUT: 'transfer_out',
  STOCK_COUNT: 'stock_count',
});

export const PRODUCT_STATUS = Object.freeze({
  ACTIVE: 'active',
  DRAFT: 'draft',
  ARCHIVED: 'archived',
});

export const STOCK_STATUS = Object.freeze({
  IN_STOCK: 'in_stock',
  LOW_STOCK: 'low_stock',
  OUT_OF_STOCK: 'out_of_stock',
});

export const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  FULFILLED: 'fulfilled',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
});

export const PAYMENT_METHODS = Object.freeze({
  CASH: 'cash',
  CARD: 'card',
  MOBILE_MONEY: 'mobile_money',
  SPLIT: 'split',
});

// Roles are informational/display-only in this phase — there is no auth
// system to actually enforce them yet (that arrives with the real backend
// in Phase 10). ROLE_PERMISSIONS just drives the "what this role can do"
// preview shown in the Employees form.
export const EMPLOYEE_ROLES = Object.freeze(['Shop Owner', 'Manager', 'Cashier', 'Inventory Staff']);

export const ROLE_PERMISSIONS = Object.freeze({
  'Shop Owner': ['Full access to every module', 'Manage employees & settings', 'View financial reports'],
  Manager: ['Manage products & inventory', 'Process sales & refunds', 'View reports'],
  Cashier: ['Process sales (POS)', 'View products & customers'],
  'Inventory Staff': ['Manage stock & purchase orders', 'View products'],
});

// Feature flag: which backend adapter api.service.js should use.
// 'local'  -> browser localStorage (current, offline-first default)
// 'rest'   -> Node/Express + Postgres/MySQL REST API (Phase 10)
// 'supabase' -> Supabase client (Phase 10 alternative)
export const DATA_ADAPTER = 'local';

export const API_BASE_URL = 'https://api.your-invsync-domain.com/v1';
