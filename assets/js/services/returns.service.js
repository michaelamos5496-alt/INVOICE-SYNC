/**
 * returns.service.js — processes a customer return against a past sale
 * or online order. Restocking is delegated to inventory.service.js's
 * restockFromReturn(), the same shared choke point, so a returned item
 * becomes available to both channels immediately, exactly like every
 * other stock-increasing action in this system.
 */
import { api } from './api.service.js';
import { restockFromReturn } from './inventory.service.js';

export async function listReturns() {
  return api.returns.list();
}

/**
 * @param {Object} params
 * @param {string} params.orderId          Original sale/online order id.
 * @param {string} params.orderType        'sale' | 'online_order'
 * @param {string} params.productId
 * @param {string} params.productName
 * @param {number} params.quantity
 * @param {string} params.reason
 * @param {string} params.channel          CHANNELS.PHYSICAL or CHANNELS.ONLINE — which channel the stock returns to.
 */
export async function createReturn({ orderId, orderType, productId, productName, quantity, reason, channel }, actor = 'system') {
  if (quantity <= 0) throw new Error('Return quantity must be positive');

  const record = await api.returns.create({
    orderId, orderType, productId, productName, quantity, reason, channel, status: 'completed', actor,
  });

  await restockFromReturn({ productId, quantity, returnId: record.id, channel, actor });

  await api.notifications.create({
    type: 'return', title: 'Return processed',
    message: `${quantity} × ${productName} returned from order #${orderId.slice(-6).toUpperCase()}.`,
    severity: 'info', read: false, relatedOrderId: orderId,
  });
  await api.activityLog.create({ actor, action: 'Processed return', target: `${quantity} × ${productName} · Order #${orderId.slice(-6).toUpperCase()}` });

  return record;
}
