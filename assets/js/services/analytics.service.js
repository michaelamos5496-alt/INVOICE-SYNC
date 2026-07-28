/**
 * analytics.service.js — read-only aggregation layer for Dashboard and
 * Reports/Analytics (Phase 8). Every function here composes data already
 * flowing through api.service.js / inventory.service.js — it never writes
 * anything, so it's safe to call as often as the UI needs to re-render.
 *
 * Sales figures intentionally combine CHANNELS.PHYSICAL and CHANNELS.ONLINE
 * everywhere (`sales` + `onlineOrders`), which is the point of the whole
 * system: the dashboard reports on the business as one shop, not two.
 */
import { api } from './api.service.js';
import { STOCK_STATUS } from '../config/constants.js';

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n) {
  const d = startOfDay();
  d.setDate(d.getDate() - n);
  return d;
}

async function getAllOrders() {
  const [sales, onlineOrders] = await Promise.all([api.sales.list(), api.onlineOrders.list()]);
  return [...sales, ...onlineOrders];
}

function sumTotals(orders) {
  return orders.reduce((sum, o) => sum + (o.total ?? 0), 0);
}

function filterSince(orders, since) {
  return orders.filter((o) => new Date(o.createdAt) >= since);
}

/** Top-line KPI tiles: products, stock health, sales, inventory value. */
export async function getDashboardStats() {
  const [products, orders] = await Promise.all([api.products.list(), getAllOrders()]);

  const lowStock = products.filter((p) => p.stockStatus === STOCK_STATUS.LOW_STOCK).length;
  const outOfStock = products.filter((p) => p.stockStatus === STOCK_STATUS.OUT_OF_STOCK).length;
  const inventoryValue = products.reduce((sum, p) => sum + (p.stockQuantity ?? 0) * (p.costPrice ?? 0), 0);

  const todaysOrders = filterSince(orders, daysAgo(0));
  const weeklyOrders = filterSince(orders, daysAgo(6));
  const monthlyOrders = filterSince(orders, daysAgo(29));

  return {
    totalProducts: products.length,
    lowStock,
    outOfStock,
    inventoryValue,
    todaysSales: sumTotals(todaysOrders),
    weeklySales: sumTotals(weeklyOrders),
    monthlyRevenue: sumTotals(monthlyOrders),
    todaysOrderCount: todaysOrders.length,
  };
}

/** Daily revenue series for the last `days` days, split by channel. */
export async function getSalesTrend(days = 14) {
  const orders = await getAllOrders();
  const labels = [];
  const physical = [];
  const online = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const dayStart = daysAgo(i);
    const dayEnd = daysAgo(i - 1);
    const dayOrders = orders.filter((o) => {
      const t = new Date(o.createdAt);
      return t >= dayStart && t < dayEnd;
    });
    labels.push(dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    physical.push(Number(sumTotals(dayOrders.filter((o) => o.channel === 'physical_shop')).toFixed(2)));
    online.push(Number(sumTotals(dayOrders.filter((o) => o.channel === 'online_shop')).toFixed(2)));
  }

  return { labels, physical, online };
}

/** Daily stock units moved (in vs. out) for the last `days` days. */
export async function getStockMovementTrend(days = 14) {
  const log = await api.inventoryLog.list();
  const labels = [];
  const stockIn = [];
  const stockOut = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const dayStart = daysAgo(i);
    const dayEnd = daysAgo(i - 1);
    const dayEntries = log.filter((e) => {
      const t = new Date(e.createdAt);
      return t >= dayStart && t < dayEnd;
    });
    labels.push(dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    stockIn.push(dayEntries.filter((e) => e.delta > 0).reduce((s, e) => s + e.delta, 0));
    stockOut.push(Math.abs(dayEntries.filter((e) => e.delta < 0).reduce((s, e) => s + e.delta, 0)));
  }

  return { labels, stockIn, stockOut };
}

/** Best sellers by units moved, across both channels. */
export async function getTopProducts(limit = 5) {
  const [orders, products] = await Promise.all([getAllOrders(), api.products.list()]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const unitsSold = new Map();
  const revenue = new Map();

  for (const order of orders) {
    for (const item of order.items ?? []) {
      unitsSold.set(item.productId, (unitsSold.get(item.productId) ?? 0) + item.quantity);
      revenue.set(item.productId, (revenue.get(item.productId) ?? 0) + item.quantity * item.price);
    }
  }

  return [...unitsSold.entries()]
    .map(([productId, units]) => ({ product: productMap.get(productId), units, revenue: revenue.get(productId) ?? 0 }))
    .filter((row) => row.product)
    .sort((a, b) => b.units - a.units)
    .slice(0, limit);
}

/** Most recent orders across both channels, newest first. */
export async function getRecentOrders(limit = 6) {
  const orders = await getAllOrders();
  const customers = await api.customers.list();
  const customerMap = new Map(customers.map((c) => [c.id, c]));

  return orders
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map((o) => ({ ...o, customer: customerMap.get(o.customerId) ?? null }));
}

/** Most recent audit trail entries, newest first. */
export async function getRecentActivity(limit = 8) {
  const entries = await api.activityLog.list();
  return entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
}

/**
 * Per-product performance across the full order history: units sold,
 * revenue, gross profit (needs each product's current costPrice — a
 * simplification vs. tracking historical cost-at-time-of-sale, fine for
 * this system's scale) and margin.
 */
export async function getProductPerformance() {
  const [orders, products] = await Promise.all([getAllOrders(), api.products.list()]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const stats = new Map();

  for (const order of orders) {
    for (const item of order.items ?? []) {
      const existing = stats.get(item.productId) ?? { units: 0, revenue: 0 };
      existing.units += item.quantity;
      existing.revenue += item.quantity * item.price;
      stats.set(item.productId, existing);
    }
  }

  return products.map((product) => {
    const { units = 0, revenue = 0 } = stats.get(product.id) ?? {};
    const cost = units * (product.costPrice ?? 0);
    const profit = revenue - cost;
    return {
      product, units, revenue, profit,
      marginPercent: revenue ? (profit / revenue) * 100 : 0,
    };
  }).sort((a, b) => b.revenue - a.revenue);
}

/** Best sellers by units moved in the last `days` days — for restock prioritization. */
export async function getFastMovers(days = 14, limit = 8) {
  const orders = (await getAllOrders()).filter((o) => new Date(o.createdAt) >= daysAgo(days - 1));
  const products = await api.products.list();
  const productMap = new Map(products.map((p) => [p.id, p]));
  const unitsSold = new Map();

  for (const order of orders) {
    for (const item of order.items ?? []) {
      unitsSold.set(item.productId, (unitsSold.get(item.productId) ?? 0) + item.quantity);
    }
  }

  return [...unitsSold.entries()]
    .map(([productId, units]) => ({ product: productMap.get(productId), units }))
    .filter((row) => row.product)
    .sort((a, b) => b.units - a.units)
    .slice(0, limit);
}

/**
 * Products carrying stock but with no sales in the last `days` days —
 * capital sitting on a shelf instead of moving. Sorted by tied-up value
 * (stockQuantity × costPrice) so the biggest offenders surface first.
 */
export async function getDeadStock(days = 30) {
  const [orders, products] = await Promise.all([getAllOrders(), api.products.list()]);
  const recentlySoldIds = new Set(
    orders.filter((o) => new Date(o.createdAt) >= daysAgo(days - 1))
      .flatMap((o) => (o.items ?? []).map((i) => i.productId)),
  );

  return products
    .filter((p) => p.stockQuantity > 0 && !recentlySoldIds.has(p.id))
    .map((p) => ({ product: p, tiedUpValue: p.stockQuantity * (p.costPrice ?? 0) }))
    .sort((a, b) => b.tiedUpValue - a.tiedUpValue);
}
