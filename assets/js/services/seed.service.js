/**
 * seed.service.js — realistic sample data for exploring the product,
 * loaded on demand from Settings → Data → "Load Sample Data"
 * (reset.service.js), never automatically. `storage.seedIfEmpty` is a
 * no-op per-key once real data exists, so this never clobbers anything
 * a shop owner has actually entered. This module is the first thing
 * removed when Phase 10 wires a real backend — every other module talks
 * to api.service.js and has no idea seeding ever happened.
 */
import { storage } from './storage.service.js';
import { STORAGE_KEYS, CHANNELS, PRODUCT_STATUS, STOCK_STATUS, STOCK_MOVEMENT_TYPES } from '../config/constants.js';

function iso(daysAgo = 0, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

/** Deterministic PRNG so demo data looks the same across fresh seeds. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = [
  { id: 'cat_electronics', name: 'Electronics', description: 'Phones, audio, accessories' },
  { id: 'cat_apparel', name: 'Apparel', description: 'Clothing and footwear' },
  { id: 'cat_home', name: 'Home & Living', description: 'Kitchen and household goods' },
  { id: 'cat_beauty', name: 'Beauty', description: 'Skincare and cosmetics' },
];

const BRANDS = [
  { id: 'brand_aurora', name: 'Aurora', country: 'Global' },
  { id: 'brand_nimbus', name: 'Nimbus', country: 'Global' },
  { id: 'brand_terra', name: 'Terra Home', country: 'Local' },
];

const SUPPLIERS = [
  { id: 'sup_westport', name: 'Westport Distributors', email: 'orders@westport.example', phone: '+233 20 000 1111', leadTimeDays: 7 },
  { id: 'sup_haven', name: 'Haven Wholesale Co.', email: 'sales@haven.example', phone: '+233 24 222 3333', leadTimeDays: 4 },
];

const WAREHOUSES = [
  { id: 'wh_main', name: 'Main Store Floor', type: 'retail', address: 'Osu, Accra' },
  { id: 'wh_backroom', name: 'Backroom Storage', type: 'storage', address: 'Osu, Accra' },
];

const PRODUCTS = [
  {
    name: 'Aurora Wireless Earbuds Pro', sku: 'AUR-EAR-001', barcode: '6291041500213',
    categoryId: 'cat_electronics', brandId: 'brand_aurora', supplierId: 'sup_westport',
    costPrice: 120, sellingPrice: 249.99, discount: 0, stockQuantity: 42, minStock: 15, maxStock: 150,
    status: PRODUCT_STATUS.ACTIVE, location: 'wh_main', color: 'Black', size: null, weight: '5g',
  },
  {
    name: 'Nimbus Smartwatch Series 4', sku: 'NIM-WAT-004', barcode: '6291041500220',
    categoryId: 'cat_electronics', brandId: 'brand_nimbus', supplierId: 'sup_westport',
    costPrice: 310, sellingPrice: 599.0, discount: 10, stockQuantity: 8, minStock: 10, maxStock: 80,
    status: PRODUCT_STATUS.ACTIVE, location: 'wh_main', color: 'Silver', size: null, weight: '48g',
  },
  {
    name: 'Terra Ceramic Mug Set (4pc)', sku: 'TER-MUG-014', barcode: '6291041500237',
    categoryId: 'cat_home', brandId: 'brand_terra', supplierId: 'sup_haven',
    costPrice: 18, sellingPrice: 39.5, discount: 0, stockQuantity: 0, minStock: 20, maxStock: 200,
    status: PRODUCT_STATUS.ACTIVE, location: 'wh_backroom', color: 'Terracotta', size: null, weight: '900g',
  },
  {
    name: 'Aurora Classic Tee', sku: 'AUR-APP-102', barcode: '6291041500244',
    categoryId: 'cat_apparel', brandId: 'brand_aurora', supplierId: 'sup_haven',
    costPrice: 22, sellingPrice: 59.0, discount: 15, stockQuantity: 130, minStock: 30, maxStock: 300,
    status: PRODUCT_STATUS.ACTIVE, location: 'wh_main', color: 'Navy', size: 'M', weight: '180g',
  },
  {
    name: 'Nimbus Hydrating Serum 30ml', sku: 'NIM-BEA-030', barcode: '6291041500251',
    categoryId: 'cat_beauty', brandId: 'brand_nimbus', supplierId: 'sup_haven',
    costPrice: 14, sellingPrice: 34.99, discount: 0, stockQuantity: 19, minStock: 20, maxStock: 120,
    status: PRODUCT_STATUS.ACTIVE, location: 'wh_main', color: null, size: '30ml', weight: '60g',
  },
];

const CUSTOMERS = [
  { id: 'cust_ama', name: 'Ama Boateng', email: 'ama.b@example.com', phone: '+233 24 111 2222', totalOrders: 12, totalSpent: 2140.5 },
  { id: 'cust_kojo', name: 'Kojo Mensah', email: 'kojo.m@example.com', phone: '+233 20 333 4444', totalOrders: 4, totalSpent: 560.0 },
];

const EMPLOYEES = [
  { id: 'emp_michael', name: 'Michael Amos', role: 'Shop Owner', email: 'michael.amos5496@gmail.com', status: 'active' },
  { id: 'emp_efua', name: 'Efua Asante', role: 'Cashier', email: 'efua.a@example.com', status: 'active' },
];

export async function seedDemoData() {
  storage.seedIfEmpty(STORAGE_KEYS.CATEGORIES, CATEGORIES.map((c) => ({ ...c, createdAt: iso(60), updatedAt: iso(60) })));
  storage.seedIfEmpty(STORAGE_KEYS.BRANDS, BRANDS.map((b) => ({ ...b, createdAt: iso(60), updatedAt: iso(60) })));
  storage.seedIfEmpty(STORAGE_KEYS.SUPPLIERS, SUPPLIERS.map((s) => ({ ...s, createdAt: iso(60), updatedAt: iso(60) })));
  storage.seedIfEmpty(STORAGE_KEYS.WAREHOUSES, WAREHOUSES.map((w) => ({ ...w, createdAt: iso(60), updatedAt: iso(60) })));
  storage.seedIfEmpty(STORAGE_KEYS.CUSTOMERS, CUSTOMERS.map((c) => ({ ...c, createdAt: iso(45), updatedAt: iso(45) })));
  storage.seedIfEmpty(STORAGE_KEYS.EMPLOYEES, EMPLOYEES.map((e) => ({ ...e, createdAt: iso(90), updatedAt: iso(90) })));

  storage.seedIfEmpty(
    STORAGE_KEYS.PRODUCTS,
    PRODUCTS.map((p, i) => ({
      ...p,
      id: `prod_seed_${i + 1}`,
      stockStatus: p.stockQuantity <= 0 ? STOCK_STATUS.OUT_OF_STOCK : p.stockQuantity <= p.minStock ? STOCK_STATUS.LOW_STOCK : STOCK_STATUS.IN_STOCK,
      images: [],
      createdAt: iso(50 - i * 3),
      updatedAt: iso(2),
    })),
  );

  storage.seedIfEmpty(STORAGE_KEYS.NOTIFICATIONS, [
    { id: 'note_1', type: 'low_stock', title: 'Low stock warning', message: 'Nimbus Smartwatch Series 4 (NIM-WAT-004) has 8 units left (min 10).', severity: 'warning', read: false, createdAt: iso(0, 8), updatedAt: iso(0, 8) },
    { id: 'note_2', type: 'out_of_stock', title: 'Out of stock', message: 'Terra Ceramic Mug Set (4pc) (TER-MUG-014) is now out of stock.', severity: 'danger', read: false, createdAt: iso(0, 6), updatedAt: iso(0, 6) },
    { id: 'note_3', type: 'new_order', title: 'New online order', message: 'Order #ONL-1042 received from Ama Boateng — GHS 249.99.', severity: 'info', read: false, createdAt: iso(0, 4), updatedAt: iso(0, 4) },
    { id: 'note_4', type: 'payment_received', title: 'Payment received', message: 'Card payment of GHS 249.99 confirmed for order #POS-0912.', severity: 'success', read: true, createdAt: iso(1, 15), updatedAt: iso(1, 15) },
    { id: 'note_5', type: 'return', title: 'Return requested', message: 'Kojo Mensah requested a return for order #SALE_6_0.', severity: 'info', read: true, createdAt: iso(2, 11), updatedAt: iso(2, 11) },
    { id: 'note_6', type: 'payment_failed', title: 'Payment failed', message: 'Mobile money payment failed for order #ONL-1055 — customer notified.', severity: 'danger', read: false, createdAt: iso(3, 9), updatedAt: iso(3, 9) },
    { id: 'note_7', type: 'system_alert', title: 'Backup completed', message: 'Nightly data backup finished successfully.', severity: 'info', read: true, createdAt: iso(4, 2), updatedAt: iso(4, 2) },
    { id: 'note_8', type: 'new_order', title: 'New online order', message: 'Order #ONL-1038 received from Kojo Mensah — GHS 39.50.', severity: 'info', read: true, createdAt: iso(5, 13), updatedAt: iso(5, 13) },
  ]);

  // ---- 14-day transaction history, generated deterministically, so the
  // dashboard's sales trend and stock movement charts have something
  // realistic to plot instead of one or two flat data points. ----
  const rand = mulberry32(20260727);
  const productPrices = Object.fromEntries(PRODUCTS.map((p, i) => [`prod_seed_${i + 1}`, p.sellingPrice]));
  const productNames = Object.fromEntries(PRODUCTS.map((p, i) => [`prod_seed_${i + 1}`, p.name]));
  const productIds = Object.keys(productPrices);
  const customerIds = CUSTOMERS.map((c) => c.id);

  const sales = [];
  const onlineOrders = [];
  const inventoryLog = [];
  const activityLog = [
    { id: 'act_1', actor: 'Michael Amos', action: 'Created product', target: 'Aurora Wireless Earbuds Pro', createdAt: iso(50), updatedAt: iso(50) },
  ];

  for (let dayAgo = 13; dayAgo >= 0; dayAgo -= 1) {
    // Guarantee at least one sale per channel today, so the dashboard's
    // "Today" KPIs are never zero purely by the luck of the random seed.
    const physicalCount = dayAgo === 0 ? 1 + Math.floor(rand() * 2) : Math.floor(rand() * 3);
    const onlineCount = dayAgo === 0 ? 1 : Math.floor(rand() * 2);

    for (let i = 0; i < physicalCount; i += 1) {
      const productId = productIds[Math.floor(rand() * productIds.length)];
      const quantity = 1 + Math.floor(rand() * 2);
      const price = productPrices[productId];
      const total = Number((price * quantity).toFixed(2));
      const customerId = rand() > 0.3 ? customerIds[Math.floor(rand() * customerIds.length)] : null;
      const createdAt = iso(dayAgo, 9 + Math.floor(rand() * 9));
      const id = `sale_${dayAgo}_${i}`;

      sales.push({
        id, channel: CHANNELS.PHYSICAL, customerId, total,
        subtotal: total, discountPercent: 0, discountAmount: 0, taxPercent: 0, taxAmount: 0,
        paymentMethod: ['cash', 'card', 'mobile_money'][Math.floor(rand() * 3)],
        items: [{ productId, name: productNames[productId], quantity, price }],
        cashier: 'Efua Asante', notes: '',
        createdAt, updatedAt: createdAt,
      });
      inventoryLog.push({
        id: `invlog_${id}`, productId, type: STOCK_MOVEMENT_TYPES.SALE, channel: CHANNELS.PHYSICAL,
        delta: -quantity, reference: id, actor: 'Efua Asante',
        createdAt, updatedAt: createdAt,
      });
    }

    for (let i = 0; i < onlineCount; i += 1) {
      const productId = productIds[Math.floor(rand() * productIds.length)];
      const quantity = 1;
      const price = productPrices[productId];
      const total = Number((price * quantity).toFixed(2));
      const customerId = customerIds[Math.floor(rand() * customerIds.length)];
      const createdAt = iso(dayAgo, 10 + Math.floor(rand() * 10));
      const id = `onl_${dayAgo}_${i}`;

      onlineOrders.push({
        id, channel: CHANNELS.ONLINE, customerId, total,
        status: dayAgo === 0 ? 'processing' : 'fulfilled',
        items: [{ productId, name: productNames[productId], quantity, price }],
        createdAt, updatedAt: createdAt,
      });
      inventoryLog.push({
        id: `invlog_${id}`, productId, type: STOCK_MOVEMENT_TYPES.SALE, channel: CHANNELS.ONLINE,
        delta: -quantity, reference: id, actor: 'Online Store',
        createdAt, updatedAt: createdAt,
      });
    }

    if (dayAgo === 6) {
      const createdAt = iso(dayAgo, 8);
      inventoryLog.push({
        id: `invlog_restock_${dayAgo}`, productId: 'prod_seed_3', type: STOCK_MOVEMENT_TYPES.RESTOCK,
        channel: CHANNELS.PHYSICAL, delta: 40, reference: 'po_seed_1', actor: 'Michael Amos',
        createdAt, updatedAt: createdAt,
      });
      activityLog.push({ id: 'act_restock', actor: 'Michael Amos', action: 'Received purchase order', target: 'Terra Ceramic Mug Set (4pc) · +40 units', createdAt, updatedAt: createdAt });
    }
  }

  activityLog.push(
    ...sales.slice(-3).map((s) => ({
      id: `act_${s.id}`, actor: 'Efua Asante', action: 'Processed in-store sale', target: `Order #${s.id.toUpperCase()} · GHS ${s.total.toFixed(2)}`, createdAt: s.createdAt, updatedAt: s.createdAt,
    })),
    ...onlineOrders.slice(-2).map((o) => ({
      id: `act_${o.id}`, actor: 'Online Store', action: 'Received online order', target: `Order #${o.id.toUpperCase()} · GHS ${o.total.toFixed(2)}`, createdAt: o.createdAt, updatedAt: o.createdAt,
    })),
  );

  storage.seedIfEmpty(STORAGE_KEYS.SALES, sales);
  storage.seedIfEmpty(STORAGE_KEYS.ONLINE_ORDERS, onlineOrders);
  storage.seedIfEmpty(STORAGE_KEYS.INVENTORY_LOG, inventoryLog);
  storage.seedIfEmpty(STORAGE_KEYS.ACTIVITY_LOG, activityLog);
  storage.seedIfEmpty(STORAGE_KEYS.PURCHASE_ORDERS, []);
  storage.seedIfEmpty(STORAGE_KEYS.STOCK_TRANSFERS, []);
  storage.seedIfEmpty(STORAGE_KEYS.RETURNS, []);
}
