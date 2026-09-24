/**
 * pos.service.js — checkout logic for the in-store Point of Sale.
 * Cart state itself lives in pos.page.js (it's ephemeral UI state, not
 * a persisted entity); this module only handles the math and the
 * transactional write: deduct each line item's stock through
 * inventory.service.js's shared choke point, then persist the sale.
 *
 * If any line item can't be deducted (e.g. someone else already sold
 * the last unit in another tab), checkout() throws before writing the
 * sales record — so we never record a sale for stock we didn't
 * actually have.
 */
import { api, generateId } from './api.service.js';
import { deductForSale, putStockBack } from './inventory.service.js';
import { CHANNELS } from '../config/constants.js';
import { formatCurrency } from '../utils/formatters.js';

/** Pure math so the cart UI can preview totals without hitting storage. */
export function computeCartTotals(cart, { discountPercent = 0, taxPercent = 0 } = {}) {
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const discountAmount = subtotal * (discountPercent / 100);
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = taxableAmount * (taxPercent / 100);
  const total = taxableAmount + taxAmount;
  return { subtotal, discountAmount, taxAmount, total };
}

/**
 * Validates stock availability for the whole cart before touching
 * anything — avoids partially deducting a cart that fails halfway.
 */
async function assertStockAvailable(cart) {
  for (const item of cart) {
    const product = await api.products.get(item.productId);
    if (!product) throw new Error(`${item.name} is no longer in the catalog.`);
    if (product.stockQuantity < item.quantity) {
      throw new Error(`Only ${product.stockQuantity} of ${item.name} left in stock.`);
    }
  }
}

export async function checkout({ cart, customerId, paymentMethod, payments, notes, discountPercent, taxPercent }, actor = 'system') {
  if (!cart.length) throw new Error('Cart is empty.');
  await assertStockAvailable(cart);

  const { subtotal, discountAmount, taxAmount, total } = computeCartTotals(cart, { discountPercent, taxPercent });

  // Take the stock first, atomically, one line at a time. If any line fails (someone else just sold the
  // last unit, connection lost…) everything already taken is put back and no sale is recorded.
  const saleId = generateId('sale');
  const taken = [];
  let sale;
  try {
    for (const item of cart) {
      await deductForSale({ productId: item.productId, quantity: item.quantity, channel: CHANNELS.PHYSICAL, orderId: saleId, actor });
      taken.push(item);
    }
    sale = await api.sales.create({
      id: saleId,
      channel: CHANNELS.PHYSICAL,
      customerId: customerId || null,
      items: cart.map((item) => ({ productId: item.productId, name: item.name, quantity: item.quantity, price: item.unitPrice })),
      subtotal, discountPercent, discountAmount, taxPercent, taxAmount, total,
      paymentMethod, payments: payments ?? null,
      notes: notes || '',
      cashier: actor,
    });
  } catch (err) {
    await putStockBack(taken, CHANNELS.PHYSICAL, saleId, actor);
    throw err;
  }

  await api.activityLog.create({ actor, action: 'Processed in-store sale', target: `Order #${sale.id.slice(-6).toUpperCase()} · ${formatCurrency(total)}` });

  if (customerId) {
    // Atomic, so two cashiers serving the same customer can't lose each other's update.
    await api.customers.mutate(customerId, (customer) => ({
      totalOrders: (customer.totalOrders ?? 0) + 1,
      totalSpent: (customer.totalSpent ?? 0) + total,
    })).catch(() => { /* the customer was deleted meanwhile — the sale itself is already safe */ });
  }

  return sale;
}
