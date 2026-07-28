/**
 * purchase-orders.service.js — supplier purchase order lifecycle.
 * Creating a PO never touches stock (goods haven't arrived yet); only
 * `receivePurchaseOrder` moves quantities, and it does so through
 * `restockFromPurchaseOrder` in inventory.service.js — the same shared
 * choke point every other stock-increasing action uses. This is a
 * simplified full-receive model (no partial receiving) to keep the
 * workflow honest without over-building for this phase.
 */
import { api } from './api.service.js';
import { restockFromPurchaseOrder } from './inventory.service.js';

export const PO_STATUS = {
  PENDING: 'pending',
  RECEIVED: 'received',
  CANCELLED: 'cancelled',
};

export async function listPurchaseOrders() {
  return api.purchaseOrders.list();
}

function computeTotal(items) {
  return items.reduce((sum, item) => sum + item.quantity * item.costPrice, 0);
}

export async function createPurchaseOrder({ supplierId, items, expectedDate = null, notes = '' }, actor = 'system') {
  if (!items?.length) throw new Error('A purchase order needs at least one line item');

  const po = await api.purchaseOrders.create({
    supplierId, items, expectedDate, notes,
    status: PO_STATUS.PENDING,
    total: computeTotal(items),
    receivedAt: null,
  });

  await api.activityLog.create({ actor, action: 'Created purchase order', target: `PO #${po.id.slice(-6).toUpperCase()} · ${items.length} item(s)` });
  return po;
}

/** Receives every line item in full, restocking each through the shared inventory choke point. */
export async function receivePurchaseOrder(id, actor = 'system') {
  const po = await api.purchaseOrders.get(id);
  if (!po) throw new Error(`Purchase order ${id} not found`);
  if (po.status !== PO_STATUS.PENDING) throw new Error('Only pending purchase orders can be received');

  for (const item of po.items) {
    await restockFromPurchaseOrder({ productId: item.productId, quantity: item.quantity, purchaseOrderId: po.id, actor });
  }

  const updated = await api.purchaseOrders.update(id, { status: PO_STATUS.RECEIVED, receivedAt: new Date().toISOString() });
  await api.activityLog.create({ actor, action: 'Received purchase order', target: `PO #${po.id.slice(-6).toUpperCase()} · ${po.items.length} item(s)` });
  return updated;
}

export async function cancelPurchaseOrder(id, actor = 'system') {
  const po = await api.purchaseOrders.get(id);
  if (!po) throw new Error(`Purchase order ${id} not found`);
  if (po.status !== PO_STATUS.PENDING) throw new Error('Only pending purchase orders can be cancelled');

  const updated = await api.purchaseOrders.update(id, { status: PO_STATUS.CANCELLED });
  await api.activityLog.create({ actor, action: 'Cancelled purchase order', target: `PO #${po.id.slice(-6).toUpperCase()}` });
  return updated;
}
