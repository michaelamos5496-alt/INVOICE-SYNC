/**
 * reports.service.js — read-only aggregation for the Reports page (Sales,
 * Inventory, Profit, Customer, Employee, Purchase, Supplier reports).
 * Analytics-page-specific aggregations (product performance, fast
 * movers, dead stock) live in analytics.service.js instead, since those
 * are framed as trend analysis rather than point-in-time reports — but
 * both read the same underlying collections through api.service.js.
 *
 * Nothing here writes anything; every function is safe to call as often
 * as a report's date-range filter changes.
 */
import { api } from './api.service.js';
import { CHANNELS } from '../config/constants.js';

async function getAllOrders() {
  const [sales, onlineOrders] = await Promise.all([api.sales.list(), api.onlineOrders.list()]);
  return [...sales, ...onlineOrders];
}

function withinRange(dateStr, days) {
  if (!days) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return new Date(dateStr) >= cutoff;
}

/** Revenue over time + by channel + by payment method. */
export async function getSalesReport(days = 30) {
  const orders = (await getAllOrders()).filter((o) => withinRange(o.createdAt, days));

  const byChannel = { [CHANNELS.PHYSICAL]: 0, [CHANNELS.ONLINE]: 0 };
  const byPaymentMethod = {};
  const labels = [];
  const dailyRevenue = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const dayStart = new Date(); dayStart.setDate(dayStart.getDate() - i); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const dayOrders = orders.filter((o) => new Date(o.createdAt) >= dayStart && new Date(o.createdAt) < dayEnd);
    labels.push(dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    dailyRevenue.push(Number(dayOrders.reduce((s, o) => s + o.total, 0).toFixed(2)));
  }

  for (const order of orders) {
    byChannel[order.channel] = (byChannel[order.channel] ?? 0) + order.total;
    const method = order.paymentMethod ?? 'online_checkout';
    byPaymentMethod[method] = (byPaymentMethod[method] ?? 0) + order.total;
  }

  return {
    totalRevenue: orders.reduce((s, o) => s + o.total, 0),
    orderCount: orders.length,
    averageOrderValue: orders.length ? orders.reduce((s, o) => s + o.total, 0) / orders.length : 0,
    trend: { labels, data: dailyRevenue },
    byChannel,
    byPaymentMethod,
  };
}

/** Stock value (at selling price) and health, broken down by category. */
export async function getInventoryReport() {
  const [products, categories] = await Promise.all([api.products.list(), api.categories.list()]);
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  const byCategory = {};
  for (const p of products) {
    const name = categoryMap.get(p.categoryId) ?? 'Uncategorized';
    byCategory[name] = (byCategory[name] ?? 0) + (p.stockQuantity ?? 0) * (p.sellingPrice ?? 0);
  }

  return {
    totalValue: products.reduce((s, p) => s + (p.stockQuantity ?? 0) * (p.sellingPrice ?? 0), 0),
    totalUnits: products.reduce((s, p) => s + p.stockQuantity, 0),
    lowStockCount: products.filter((p) => p.stockStatus === 'low_stock').length,
    outOfStockCount: products.filter((p) => p.stockStatus === 'out_of_stock').length,
    byCategory,
    products,
  };
}

/** Revenue minus cost, per order item, aggregated over time and by product. */
export async function getProfitReport(days = 30) {
  const [orders, products] = await Promise.all([getAllOrders(), api.products.list()]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const filtered = orders.filter((o) => withinRange(o.createdAt, days));

  const labels = [];
  const profitTrend = [];
  let totalRevenue = 0;
  let totalCost = 0;
  const byProduct = new Map();

  for (let i = days - 1; i >= 0; i -= 1) {
    const dayStart = new Date(); dayStart.setDate(dayStart.getDate() - i); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const dayOrders = filtered.filter((o) => new Date(o.createdAt) >= dayStart && new Date(o.createdAt) < dayEnd);
    let dayProfit = 0;
    for (const order of dayOrders) {
      for (const item of order.items) {
        const cost = (productMap.get(item.productId)?.costPrice ?? 0) * item.quantity;
        dayProfit += item.price * item.quantity - cost;
      }
    }
    labels.push(dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    profitTrend.push(Number(dayProfit.toFixed(2)));
  }

  for (const order of filtered) {
    for (const item of order.items) {
      const product = productMap.get(item.productId);
      const cost = (product?.costPrice ?? 0) * item.quantity;
      const revenue = item.price * item.quantity;
      totalRevenue += revenue;
      totalCost += cost;

      const key = item.productId;
      const existing = byProduct.get(key) ?? { name: item.name, revenue: 0, cost: 0, units: 0 };
      existing.revenue += revenue;
      existing.cost += cost;
      existing.units += item.quantity;
      byProduct.set(key, existing);
    }
  }

  const totalProfit = totalRevenue - totalCost;
  return {
    totalRevenue, totalCost, totalProfit,
    marginPercent: totalRevenue ? (totalProfit / totalRevenue) * 100 : 0,
    trend: { labels, data: profitTrend },
    byProduct: [...byProduct.values()].map((p) => ({ ...p, profit: p.revenue - p.cost })).sort((a, b) => b.profit - a.profit),
  };
}

/** Spend/order distribution across the customer base. */
export async function getCustomerReport() {
  const customers = await api.customers.list();
  const sorted = [...customers].sort((a, b) => (b.totalSpent ?? 0) - (a.totalSpent ?? 0));
  return {
    totalCustomers: customers.length,
    totalRevenue: customers.reduce((s, c) => s + (c.totalSpent ?? 0), 0),
    averageSpend: customers.length ? customers.reduce((s, c) => s + (c.totalSpent ?? 0), 0) / customers.length : 0,
    topCustomers: sorted.slice(0, 10),
  };
}

/** Sales performance grouped by the staff member who processed each one. */
export async function getEmployeeReport(days = 30) {
  const [sales, employees] = await Promise.all([api.sales.list(), api.employees.list()]);
  const filtered = sales.filter((s) => withinRange(s.createdAt, days));

  const byCashier = new Map();
  for (const sale of filtered) {
    const name = sale.cashier ?? 'Unknown';
    const existing = byCashier.get(name) ?? { name, orderCount: 0, revenue: 0 };
    existing.orderCount += 1;
    existing.revenue += sale.total;
    byCashier.set(name, existing);
  }

  return {
    employees,
    performance: [...byCashier.values()].sort((a, b) => b.revenue - a.revenue),
  };
}

/** Spend and status breakdown across purchase orders. */
export async function getPurchaseReport() {
  const [purchaseOrders, suppliers] = await Promise.all([api.purchaseOrders.list(), api.suppliers.list()]);
  const supplierMap = new Map(suppliers.map((s) => [s.id, s.name]));

  const byStatus = { pending: 0, received: 0, cancelled: 0 };
  for (const po of purchaseOrders) byStatus[po.status] = (byStatus[po.status] ?? 0) + 1;

  return {
    totalSpend: purchaseOrders.filter((po) => po.status === 'received').reduce((s, po) => s + po.total, 0),
    totalOrders: purchaseOrders.length,
    byStatus,
    orders: purchaseOrders.map((po) => ({ ...po, supplierName: supplierMap.get(po.supplierId) ?? 'Unknown' })),
  };
}

/** Purchase volume and spend per supplier. */
export async function getSupplierReport() {
  const [purchaseOrders, suppliers] = await Promise.all([api.purchaseOrders.list(), api.suppliers.list()]);

  return suppliers.map((supplier) => {
    const orders = purchaseOrders.filter((po) => po.supplierId === supplier.id);
    return {
      ...supplier,
      orderCount: orders.length,
      totalSpend: orders.filter((po) => po.status === 'received').reduce((s, po) => s + po.total, 0),
    };
  }).sort((a, b) => b.totalSpend - a.totalSpend);
}
