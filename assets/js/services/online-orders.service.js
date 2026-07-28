/**
 * online-orders.service.js — the other half of the "one shared inventory"
 * promise: an order placed through the online store deducts stock via the
 * exact same `deductForSale()` choke point a POS sale uses (just tagged
 * CHANNELS.ONLINE instead of CHANNELS.PHYSICAL). There is no separate
 * "online stock" number anywhere in this codebase — there's one
 * `product.stockQuantity`, and both channels write to it.
 *
 * This demo has no real Shopify/WooCommerce webhook to listen to (that's
 * the Phase 10 API Integration), so `simulateIncomingOrder()` stands in
 * for "a customer just checked out on the website" — everything after
 * that point (stock deduction, notification, activity log) is exactly
 * what a real webhook handler would do with the payload it received.
 */
import { api } from './api.service.js';
import { deductForSale, restockFromReturn } from './inventory.service.js';
import { CHANNELS, ORDER_STATUS } from '../config/constants.js';

async function assertStockAvailable(items) {
  for (const item of items) {
    const product = await api.products.get(item.productId);
    if (!product) throw new Error('One of the selected products no longer exists.');
    if (product.stockQuantity < item.quantity) throw new Error(`Only ${product.stockQuantity} of ${product.name} left in stock.`);
  }
}

export async function listOnlineOrders() {
  return api.onlineOrders.list();
}

/**
 * Creates the order, deducts stock for every line item, notifies, and
 * logs the activity — the same sequence a real webhook handler runs.
 */
export async function createOnlineOrder({ customerId, items, notes = '' }, actor = 'Online Store') {
  if (!items?.length) throw new Error('An order needs at least one item.');
  await assertStockAvailable(items);

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const order = await api.onlineOrders.create({
    channel: CHANNELS.ONLINE, customerId: customerId || null, items, total,
    status: ORDER_STATUS.PROCESSING, notes,
  });

  for (const item of items) {
    await deductForSale({ productId: item.productId, quantity: item.quantity, channel: CHANNELS.ONLINE, orderId: order.id, actor });
  }

  const customer = customerId ? await api.customers.get(customerId) : null;
  await api.notifications.create({
    type: 'new_order', title: 'New online order',
    message: `Order #${order.id.slice(-6).toUpperCase()} received${customer ? ` from ${customer.name}` : ''} — GHS ${total.toFixed(2)}.`,
    severity: 'info', read: false, relatedOrderId: order.id,
  });
  await api.activityLog.create({ actor, action: 'Received online order', target: `Order #${order.id.slice(-6).toUpperCase()} · GHS ${total.toFixed(2)}` });

  if (customer) {
    await api.customers.update(customerId, { totalOrders: (customer.totalOrders ?? 0) + 1, totalSpent: (customer.totalSpent ?? 0) + total });
  }

  return order;
}

export async function fulfillOnlineOrder(id, actor = 'system') {
  const order = await api.onlineOrders.get(id);
  if (!order) throw new Error('Order not found');
  if (order.status !== ORDER_STATUS.PROCESSING) throw new Error('Only processing orders can be fulfilled');

  const updated = await api.onlineOrders.update(id, { status: ORDER_STATUS.FULFILLED });
  await api.activityLog.create({ actor, action: 'Fulfilled online order', target: `Order #${order.id.slice(-6).toUpperCase()}` });
  return updated;
}

/** Cancelling an unfulfilled order restocks every line item it had deducted. */
export async function cancelOnlineOrder(id, actor = 'system') {
  const order = await api.onlineOrders.get(id);
  if (!order) throw new Error('Order not found');
  if (order.status !== ORDER_STATUS.PROCESSING) throw new Error('Only processing orders can be cancelled');

  for (const item of order.items) {
    await restockFromReturn({ productId: item.productId, quantity: item.quantity, returnId: order.id, channel: CHANNELS.ONLINE, actor });
  }

  const updated = await api.onlineOrders.update(id, { status: ORDER_STATUS.CANCELLED });
  await api.activityLog.create({ actor, action: 'Cancelled online order', target: `Order #${order.id.slice(-6).toUpperCase()}` });
  return updated;
}

/** Stands in for a webhook delivering a real checkout from the online store. */
export async function simulateIncomingOrder() {
  const products = (await api.products.list()).filter((p) => p.status === 'active' && p.stockQuantity > 0);
  if (!products.length) throw new Error('No in-stock products available to simulate an order with.');

  const customers = await api.customers.list();
  const product = products[Math.floor(Math.random() * products.length)];
  const quantity = 1 + Math.floor(Math.random() * Math.min(2, product.stockQuantity));
  const customer = customers.length && Math.random() > 0.2 ? customers[Math.floor(Math.random() * customers.length)] : null;

  return createOnlineOrder({
    customerId: customer?.id ?? null,
    items: [{ productId: product.id, name: product.name, quantity, price: product.sellingPrice * (1 - (product.discount ?? 0) / 100) }],
  }, 'Online Store');
}
