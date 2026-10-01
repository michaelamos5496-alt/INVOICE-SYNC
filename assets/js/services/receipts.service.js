/**
 * receipts.service.js — saved custom receipts. A custom receipt is a document you write by hand (see
 * pages/custom-receipt.js), not a sale: saving one never touches stock, Sales or Reports.
 *
 * They are kept in the invoices collection, marked `kind: 'receipt'`, so they are shared across devices without
 * needing a table of their own. invoices.service.js hides them from the invoice list and numbering.
 */
import { api } from './api.service.js';
import { getCurrency } from './settings.service.js';

export const isReceipt = (record) => record?.kind === 'receipt';

export function computeReceiptTotals({ items = [], discount = 0, taxPercent = 0, paid = null }) {
  const subtotal = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const discountAmount = Math.min(subtotal, Math.max(0, Number(discount) || 0));
  const taxAmount = (subtotal - discountAmount) * ((Number(taxPercent) || 0) / 100);
  const total = subtotal - discountAmount + taxAmount;
  const paidAmount = paid === '' || paid == null ? null : Number(paid) || 0;
  return { subtotal, discount: discountAmount, tax: taxAmount, total, paid: paidAmount, balance: paidAmount == null ? null : paidAmount - total };
}

export async function listReceipts() {
  const all = await api.invoices.list(isReceipt);
  return all.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
}

/** Next sequential number, e.g. R-0007, from the highest R- number in use so deletions never cause a repeat. */
export async function nextReceiptNumber() {
  const all = await api.invoices.list(isReceipt);
  const highest = all.reduce((max, r) => {
    const m = /^R-(\d+)$/.exec(String(r.number ?? ''));
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `R-${String(highest + 1).padStart(4, '0')}`;
}

function clean(d) {
  const items = (d.items ?? [])
    .filter((i) => String(i.name ?? '').trim())
    .map((i) => ({ name: String(i.name).trim(), qty: Number(i.qty) || 0, price: Number(i.price) || 0 }));
  if (!items.length || items.some((i) => i.qty <= 0)) throw new Error('Add at least one item with a description and a quantity above zero.');
  const totals = computeReceiptTotals({ ...d, items });
  return {
    kind: 'receipt',
    title: String(d.title ?? '').trim() || 'Receipt',
    number: String(d.number ?? '').trim(),
    date: d.date || new Date().toISOString().slice(0, 16),
    customer: String(d.customer ?? '').trim(), phone: String(d.phone ?? '').trim(), servedBy: String(d.servedBy ?? '').trim(),
    items, discount: totals.discount, taxPercent: Number(d.taxPercent) || 0,
    method: d.method, paid: totals.paid, notes: String(d.notes ?? '').trim(), footer: String(d.footer ?? ''),
    subtotal: totals.subtotal, taxAmount: totals.tax, total: totals.total,
    currency: d.currency || getCurrency(), // a receipt keeps the currency it was issued in
  };
}

/** Creates the receipt, or updates it when `d.id` is set. Returns the saved record. */
export async function saveReceipt(d, actor = 'system') {
  const data = clean(d);
  if (!data.number) data.number = await nextReceiptNumber();
  const saved = d.id ? await api.invoices.update(d.id, data) : await api.invoices.create(data);
  await api.activityLog.create({ actor, action: d.id ? 'Updated custom receipt' : 'Created custom receipt', target: `${saved.number}${saved.customer ? ` · ${saved.customer}` : ''}` });
  return saved;
}

export async function deleteReceipt(id, actor = 'system') {
  const r = await api.invoices.get(id);
  if (!isReceipt(r)) throw new Error('Receipt not found.');
  await api.invoices.remove(id);
  await api.activityLog.create({ actor, action: 'Deleted custom receipt', target: r.number });
}
