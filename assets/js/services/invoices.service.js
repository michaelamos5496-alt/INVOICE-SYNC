/**
 * invoices.service.js — customer invoice lifecycle: draft → sent → paid,
 * or void. An invoice is a billing document, not a stock movement, so
 * nothing here touches inventory: an invoice raised from an existing
 * sale or online order bills for goods whose stock was already deducted
 * at checkout, and a standalone invoice (services, custom lines, or a
 * pay-later order) is just a request for payment.
 *
 * The bill-to details are snapshotted onto the invoice when it's saved,
 * so editing or deleting a customer later never rewrites an invoice
 * that's already gone out. "Overdue" isn't stored — it's derived from a
 * sent invoice whose due date has passed (see `effectiveStatus`).
 */
import { api } from './api.service.js';

export const INVOICE_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  PAID: 'paid',
  VOID: 'void',
  OVERDUE: 'overdue', // derived only, never persisted
};

export const DEFAULT_DUE_DAYS = 14;

/** Pure math so the editor can preview totals without hitting storage. */
export function computeInvoiceTotals(items, { discountPercent = 0, taxPercent = 0 } = {}) {
  const subtotal = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.price) || 0), 0);
  const discountAmount = subtotal * ((Number(discountPercent) || 0) / 100);
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = taxableAmount * ((Number(taxPercent) || 0) / 100);
  const total = taxableAmount + taxAmount;
  return { subtotal, discountAmount, taxAmount, total };
}

export function effectiveStatus(invoice, now = new Date()) {
  if (invoice.status !== INVOICE_STATUS.SENT || !invoice.dueDate) return invoice.status;
  const endOfDueDate = new Date(`${invoice.dueDate}T23:59:59`);
  return endOfDueDate < now ? INVOICE_STATUS.OVERDUE : INVOICE_STATUS.SENT;
}

export async function listInvoices() {
  return api.invoices.list();
}

/** Next sequential number, e.g. INV-0007. Based on the highest existing number, so deletions never cause reuse collisions with later invoices. */
async function nextInvoiceNumber() {
  const all = await api.invoices.list();
  const highest = all.reduce((max, inv) => Math.max(max, Number(String(inv.number ?? '').replace(/\D/g, '')) || 0), 0);
  return `INV-${String(highest + 1).padStart(4, '0')}`;
}

function normalize({ customerId = null, billTo, items, issueDate, dueDate, discountPercent = 0, taxPercent = 0, notes = '', source = null }) {
  const cleanItems = (items ?? [])
    .filter((i) => String(i.description ?? '').trim() && Number(i.quantity) > 0)
    .map((i) => ({
      productId: i.productId || null,
      description: String(i.description).trim(),
      quantity: Number(i.quantity),
      price: Number(i.price) || 0,
    }));

  if (!String(billTo?.name ?? '').trim()) throw new Error('An invoice needs a customer name to bill.');
  if (!cleanItems.length) throw new Error('An invoice needs at least one line item.');
  if (dueDate && issueDate && dueDate < issueDate) throw new Error('The due date can\'t be before the issue date.');

  const totals = computeInvoiceTotals(cleanItems, { discountPercent, taxPercent });
  return {
    customerId: customerId || null,
    billTo: {
      name: String(billTo.name).trim(),
      email: String(billTo.email ?? '').trim(),
      phone: String(billTo.phone ?? '').trim(),
      address: String(billTo.address ?? '').trim(),
    },
    items: cleanItems,
    issueDate, dueDate,
    discountPercent: Number(discountPercent) || 0,
    taxPercent: Number(taxPercent) || 0,
    ...totals,
    notes: String(notes ?? '').trim(),
    source,
  };
}

export async function createInvoice(data, { markSent = false } = {}, actor = 'system') {
  const invoice = await api.invoices.create({
    ...normalize(data),
    number: await nextInvoiceNumber(),
    status: markSent ? INVOICE_STATUS.SENT : INVOICE_STATUS.DRAFT,
    sentAt: markSent ? new Date().toISOString() : null,
    paidAt: null,
    paymentMethod: null,
  });
  await api.activityLog.create({ actor, action: 'Created invoice', target: `${invoice.number} · ${invoice.billTo.name}` });
  return invoice;
}

/** Only drafts and unpaid sent invoices can be edited — a paid or void invoice is a closed record. */
export async function updateInvoice(id, data, { markSent = false } = {}, actor = 'system') {
  const existing = await api.invoices.get(id);
  if (!existing) throw new Error(`Invoice ${id} not found`);
  if (![INVOICE_STATUS.DRAFT, INVOICE_STATUS.SENT].includes(existing.status)) throw new Error('Paid or void invoices can\'t be edited.');

  const patch = normalize({ ...data, source: existing.source });
  if (markSent && existing.status === INVOICE_STATUS.DRAFT) Object.assign(patch, { status: INVOICE_STATUS.SENT, sentAt: new Date().toISOString() });

  const updated = await api.invoices.update(id, patch);
  await api.activityLog.create({ actor, action: 'Updated invoice', target: `${updated.number} · ${updated.billTo.name}` });
  return updated;
}

export async function markInvoiceSent(id, actor = 'system') {
  const invoice = await api.invoices.get(id);
  if (!invoice) throw new Error(`Invoice ${id} not found`);
  if (invoice.status !== INVOICE_STATUS.DRAFT) throw new Error('Only draft invoices can be marked as sent.');

  const updated = await api.invoices.update(id, { status: INVOICE_STATUS.SENT, sentAt: new Date().toISOString() });
  await api.activityLog.create({ actor, action: 'Sent invoice', target: `${invoice.number} · ${invoice.billTo.name}` });
  return updated;
}

export async function markInvoicePaid(id, paymentMethod, actor = 'system') {
  const invoice = await api.invoices.get(id);
  if (!invoice) throw new Error(`Invoice ${id} not found`);
  if (![INVOICE_STATUS.DRAFT, INVOICE_STATUS.SENT].includes(invoice.status)) throw new Error('This invoice is already closed.');

  const updated = await api.invoices.update(id, {
    status: INVOICE_STATUS.PAID,
    paidAt: new Date().toISOString(),
    sentAt: invoice.sentAt ?? new Date().toISOString(),
    paymentMethod: paymentMethod || null,
  });
  await api.notifications.create({
    type: 'payment_received', title: 'Invoice paid',
    message: `${invoice.number} from ${invoice.billTo.name} was marked as paid.`,
    severity: 'success', read: false,
  });
  await api.activityLog.create({ actor, action: 'Marked invoice paid', target: `${invoice.number} · ${invoice.billTo.name}` });
  return updated;
}

export async function voidInvoice(id, actor = 'system') {
  const invoice = await api.invoices.get(id);
  if (!invoice) throw new Error(`Invoice ${id} not found`);
  if (invoice.status === INVOICE_STATUS.PAID) throw new Error('A paid invoice can\'t be voided.');
  if (invoice.status === INVOICE_STATUS.VOID) throw new Error('This invoice is already void.');

  const updated = await api.invoices.update(id, { status: INVOICE_STATUS.VOID });
  await api.activityLog.create({ actor, action: 'Voided invoice', target: invoice.number });
  return updated;
}

/** Drafts were never issued, so they can be deleted outright; anything sent must be voided to keep the paper trail. */
export async function deleteDraftInvoice(id, actor = 'system') {
  const invoice = await api.invoices.get(id);
  if (!invoice) throw new Error(`Invoice ${id} not found`);
  if (invoice.status !== INVOICE_STATUS.DRAFT) throw new Error('Only drafts can be deleted — void a sent invoice instead.');

  await api.invoices.remove(id);
  await api.activityLog.create({ actor, action: 'Deleted draft invoice', target: invoice.number });
  return true;
}

/**
 * Builds (but doesn't save) invoice data from a POS sale or online
 * order, so the editor can open prefilled and the owner can adjust
 * dates/notes before saving. `kind` is 'sale' or 'online'.
 */
export async function draftFromOrder(kind, orderId) {
  const order = kind === 'sale' ? await api.sales.get(orderId) : await api.onlineOrders.get(orderId);
  if (!order) throw new Error('That order no longer exists.');

  const customer = order.customerId ? await api.customers.get(order.customerId) : null;
  return {
    customerId: customer?.id ?? null,
    billTo: {
      name: customer?.name ?? '',
      email: customer?.email ?? '',
      phone: customer?.phone ?? '',
      address: customer?.address ?? '',
    },
    items: order.items.map((i) => ({ productId: i.productId, description: i.name, quantity: i.quantity, price: i.price })),
    discountPercent: order.discountPercent ?? 0,
    taxPercent: order.taxPercent ?? 0,
    notes: order.notes ?? '',
    source: { kind, orderId: order.id },
  };
}
