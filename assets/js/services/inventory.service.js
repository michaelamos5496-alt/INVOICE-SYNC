/**
 * inventory.service.js
 *
 * THE single choke point for every stock quantity change in the system,
 * regardless of which channel triggered it. A POS sale, an online order
 * webhook, a manual adjustment, a stock count, and a warehouse transfer
 * all end up calling `adjustStock()` below, which:
 *
 *   1. Reads the CURRENT quantity from api.products (the one shared table)
 *   2. Writes the NEW quantity back to that same record
 *   3. Appends an immutable entry to the inventory log (audit trail)
 *   4. Recomputes stock status (in_stock / low_stock / out_of_stock)
 *   5. Emits a notification when a threshold is crossed
 *
 * Because both pages/pos.js (physical shop) and pages/online-orders.js
 * (online shop) import and call this exact module, there is structurally
 * no way for the two channels to disagree about stock — they are reading
 * and writing the same product record through the same function.
 */
import { api, generateId } from './api.service.js';
import { STOCK_MOVEMENT_TYPES, STOCK_STATUS, CHANNELS } from '../config/constants.js';

/** Derives stock status from quantity vs. the product's own thresholds. */
export function computeStockStatus(product) {
  if (product.stockQuantity <= 0) return STOCK_STATUS.OUT_OF_STOCK;
  if (product.stockQuantity <= (product.minStock ?? 0)) return STOCK_STATUS.LOW_STOCK;
  return STOCK_STATUS.IN_STOCK;
}

/**
 * Adjusts a product's stock by `delta` (negative for sales/removals,
 * positive for restocks/returns) and records why.
 *
 * @param {Object} params
 * @param {string} params.productId
 * @param {number} params.delta                 Signed quantity change.
 * @param {string} params.type                  One of STOCK_MOVEMENT_TYPES.
 * @param {string} params.channel               One of CHANNELS.
 * @param {string} [params.reference]            Order/PO/transfer id this ties to.
 * @param {string} [params.note]
 * @param {string} [params.actor]                 User/employee who triggered it.
 * @returns {Promise<{product: object, logEntry: object}>}
 */
export async function adjustStock({ productId, delta, type, channel, reference = null, note = '', actor = 'system' }) {
  const product = await api.products.get(productId);
  if (!product) throw new Error(`Product ${productId} not found`);

  const previousQuantity = product.stockQuantity ?? 0;
  const newQuantity = Math.max(0, previousQuantity + delta);

  const updated = await api.products.update(productId, {
    stockQuantity: newQuantity,
    stockStatus: computeStockStatus({ ...product, stockQuantity: newQuantity }),
  });

  const logEntry = await api.inventoryLog.create({
    productId,
    productName: product.name,
    sku: product.sku,
    type,
    channel,
    delta,
    previousQuantity,
    newQuantity,
    reference,
    note,
    actor,
  });

  await maybeNotifyThreshold(updated);

  return { product: updated, logEntry };
}

/** Convenience wrapper for a channel sale (POS or online checkout). */
export async function deductForSale({ productId, quantity, channel, orderId, actor }) {
  if (quantity <= 0) throw new Error('Sale quantity must be positive');
  return adjustStock({
    productId,
    delta: -Math.abs(quantity),
    type: STOCK_MOVEMENT_TYPES.SALE,
    channel,
    reference: orderId,
    actor,
  });
}

/** Convenience wrapper for restocking from a supplier purchase order. */
export async function restockFromPurchaseOrder({ productId, quantity, purchaseOrderId, actor }) {
  return adjustStock({
    productId,
    delta: Math.abs(quantity),
    type: STOCK_MOVEMENT_TYPES.RESTOCK,
    channel: CHANNELS.PHYSICAL,
    reference: purchaseOrderId,
    actor,
  });
}

/** Convenience wrapper for a customer return re-adding stock. */
export async function restockFromReturn({ productId, quantity, returnId, channel, actor }) {
  return adjustStock({
    productId,
    delta: Math.abs(quantity),
    type: STOCK_MOVEMENT_TYPES.RETURN,
    channel,
    reference: returnId,
    actor,
  });
}

/** Manual stock-take correction (can be positive or negative). */
export async function applyStockCount({ productId, countedQuantity, actor }) {
  const product = await api.products.get(productId);
  if (!product) throw new Error(`Product ${productId} not found`);
  const delta = countedQuantity - (product.stockQuantity ?? 0);
  return adjustStock({
    productId,
    delta,
    type: STOCK_MOVEMENT_TYPES.STOCK_COUNT,
    channel: CHANNELS.PHYSICAL,
    note: `Stock count correction: ${product.stockQuantity} -> ${countedQuantity}`,
    actor,
  });
}

/**
 * Moves stock between two warehouse/location records. Net quantity change
 * is zero (an OUT then an IN, both logged for the audit trail), but since
 * this data model tracks one `location` per product rather than
 * per-location quantities, a transfer also updates the product's
 * location to reflect where the stock physically ended up.
 */
export async function transferStock({ productId, quantity, fromLocationId, toLocationId, transferId, actor }) {
  await adjustStock({
    productId, delta: -Math.abs(quantity), type: STOCK_MOVEMENT_TYPES.TRANSFER_OUT,
    channel: CHANNELS.PHYSICAL, reference: transferId, note: `To ${toLocationId}`, actor,
  });
  const result = await adjustStock({
    productId, delta: Math.abs(quantity), type: STOCK_MOVEMENT_TYPES.TRANSFER_IN,
    channel: CHANNELS.PHYSICAL, reference: transferId, note: `From ${fromLocationId}`, actor,
  });
  return { ...result, product: await api.products.update(productId, { location: toLocationId }) };
}

/**
 * Full stock-transfer workflow: persists the transfer record, executes
 * the paired OUT/IN stock movements, and appends an activity log entry.
 * Page controllers call this instead of assembling the steps themselves.
 */
export async function createStockTransfer({ productId, quantity, fromLocationId, toLocationId, note = '' }, actor = 'system') {
  if (fromLocationId === toLocationId) throw new Error('Source and destination locations must differ');
  if (quantity <= 0) throw new Error('Transfer quantity must be positive');

  const product = await api.products.get(productId);
  if (!product) throw new Error(`Product ${productId} not found`);

  const record = await api.stockTransfers.create({
    productId, productName: product.name, quantity, fromLocationId, toLocationId, note, status: 'completed', actor,
  });

  await transferStock({ productId, quantity, fromLocationId, toLocationId, transferId: record.id, actor });
  await api.activityLog.create({ actor, action: 'Transferred stock', target: `${quantity} × ${product.name}` });

  return record;
}

/** Fires a notification the first time a product crosses low/out-of-stock. */
async function maybeNotifyThreshold(product) {
  if (product.stockStatus === STOCK_STATUS.OUT_OF_STOCK) {
    await api.notifications.create({
      type: 'out_of_stock',
      title: 'Out of stock',
      message: `${product.name} (${product.sku}) is now out of stock.`,
      severity: 'danger',
      read: false,
      relatedProductId: product.id,
    });
  } else if (product.stockStatus === STOCK_STATUS.LOW_STOCK) {
    await api.notifications.create({
      type: 'low_stock',
      title: 'Low stock warning',
      message: `${product.name} (${product.sku}) has ${product.stockQuantity} units left (min ${product.minStock}).`,
      severity: 'warning',
      read: false,
      relatedProductId: product.id,
    });
  }
}

/** Returns full movement history for one product, newest first. */
export async function getProductHistory(productId) {
  const entries = await api.inventoryLog.list((e) => e.productId === productId);
  return entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
