/**
 * invoices.page.js — controller for pages/invoices.html: the invoice
 * generator. Builds invoices from scratch (catalog products or custom
 * lines) or prefilled from an existing POS sale / online order, then
 * renders a print-ready invoice document that can be printed or saved
 * as PDF via the browser's print dialog.
 *
 * Deep links: `?fromSale=<id>` / `?fromOnline=<id>` open the editor
 * prefilled from that order (used by the Sales and Online Orders
 * detail modals), and `?view=<id>` opens an existing invoice.
 */
import { api } from '../services/api.service.js';
import {
  INVOICE_STATUS, DEFAULT_DUE_DAYS, listInvoices, computeInvoiceTotals, effectiveStatus,
  createInvoice, updateInvoice, markInvoiceSent, markInvoicePaid, voidInvoice, deleteDraftInvoice, draftFromOrder,
} from '../services/invoices.service.js';
import { getSettings } from '../services/settings.service.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { initDropdown } from '../components/dropdown.js';
import { renderStatCards } from '../components/stat-card.js';
import { formatCurrency, formatDate } from '../utils/formatters.js';
import { escapeHTML, getQueryParam, setQueryParam } from '../utils/helpers.js';

const ACTOR = 'Michael Amos';

const STATUS_BADGE = {
  draft: 'badge-neutral',
  sent: 'badge-info',
  overdue: 'badge-danger',
  paid: 'badge-success',
  void: 'badge-neutral',
};

const PAYMENT_METHOD_LABELS = {
  cash: 'Cash', card: 'Card', mobile_money: 'Mobile Money', bank_transfer: 'Bank Transfer', cheque: 'Cheque',
};

let table;
let invoices = [];
let lookups = { customers: [], products: [] };
let lineItems = [];

const money = (amount) => formatCurrency(amount, getSettings().currency);

export async function initInvoicesPage() {
  const [customers, products] = await Promise.all([api.customers.list(), api.products.list()]);
  lookups = { customers, products };

  buildTable();
  await refresh();

  document.getElementById('create-invoice-btn').addEventListener('click', () => openEditor());
  document.getElementById('from-order-btn').addEventListener('click', () => openFromOrderPicker());
  document.getElementById('invoice-search').addEventListener('input', applyFilters);
  document.getElementById('invoice-status-filter').addEventListener('change', applyFilters);

  await handleDeepLinks();
}

async function handleDeepLinks() {
  const fromSale = getQueryParam('fromSale');
  const fromOnline = getQueryParam('fromOnline');
  const viewId = getQueryParam('view');

  try {
    if (fromSale || fromOnline) {
      const draft = await draftFromOrder(fromSale ? 'sale' : 'online', fromSale || fromOnline);
      setQueryParam(fromSale ? 'fromSale' : 'fromOnline', null);
      openEditor(null, draft);
    } else if (viewId) {
      const invoice = invoices.find((i) => i.id === viewId);
      if (invoice) openViewModal(invoice);
    }
  } catch (err) {
    toast.danger(err.message);
  }
}

// ---------------------------------------------------------------------
// List + stats
// ---------------------------------------------------------------------
function buildTable() {
  table = new DataTable(document.getElementById('invoices-table'), {
    columns: [
      { key: 'number', label: 'Invoice #', sortable: true, render: (row) => `<span class="font-mono font-medium">${escapeHTML(row.number)}</span>` },
      { key: 'customerName', label: 'Customer', sortable: true, render: (row) => escapeHTML(row.billTo.name) },
      { key: 'issueDate', label: 'Issued', sortable: true, render: (row) => row.issueDate ? formatDate(`${row.issueDate}T00:00:00`) : '—' },
      { key: 'dueDate', label: 'Due', sortable: true, render: (row) => row.dueDate ? formatDate(`${row.dueDate}T00:00:00`) : '—' },
      { key: 'total', label: 'Total', align: 'right', sortable: true, render: (row) => money(row.total) },
      { key: 'displayStatus', label: 'Status', render: (row) => `<span class="badge ${STATUS_BADGE[row.displayStatus]}">${row.displayStatus}</span>` },
      {
        key: 'actions', label: '',
        render: (row) => `<button class="btn btn-ghost btn-sm" data-row-actions="${row.id}" aria-label="Row actions"><i class="fa-solid fa-ellipsis"></i></button>`,
      },
    ],
    pageSize: 10,
    searchKeys: [],
    rowKey: (row) => row.id,
    defaultSort: { key: 'number', dir: 'desc' },
    emptyState: {
      icon: 'fa-file-invoice-dollar', title: 'No invoices yet',
      message: 'Create one from scratch, or generate one from an existing sale or online order.',
      actionLabel: 'New Invoice', onAction: () => openEditor(),
    },
  });
}

async function refresh() {
  table.setLoading();
  invoices = (await listInvoices()).map((inv) => ({ ...inv, customerName: inv.billTo.name, displayStatus: effectiveStatus(inv) }));
  renderStats();
  applyFilters();
}

function renderStats() {
  const open = invoices.filter((i) => i.displayStatus === INVOICE_STATUS.SENT || i.displayStatus === INVOICE_STATUS.OVERDUE);
  const overdue = invoices.filter((i) => i.displayStatus === INVOICE_STATUS.OVERDUE);
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const paidRecently = invoices.filter((i) => i.status === INVOICE_STATUS.PAID && new Date(i.paidAt).getTime() >= thirtyDaysAgo);
  const drafts = invoices.filter((i) => i.status === INVOICE_STATUS.DRAFT);
  const sum = (list) => list.reduce((s, i) => s + i.total, 0);

  renderStatCards(document.getElementById('invoice-stats'), [
    { label: `Outstanding · ${open.length}`, value: money(sum(open)), icon: 'fa-hourglass-half', tone: 'info' },
    { label: `Overdue · ${overdue.length}`, value: money(sum(overdue)), icon: 'fa-triangle-exclamation', tone: 'danger' },
    { label: `Paid (30 days) · ${paidRecently.length}`, value: money(sum(paidRecently)), icon: 'fa-circle-check', tone: 'success' },
    { label: 'Drafts', value: drafts.length, icon: 'fa-pen-to-square', tone: 'warning' },
  ]);
}

function applyFilters() {
  const term = document.getElementById('invoice-search').value.trim().toLowerCase();
  const status = document.getElementById('invoice-status-filter').value;

  table.setData(invoices.filter((inv) => {
    if (status && inv.displayStatus !== status) return false;
    if (!term) return true;
    return inv.number.toLowerCase().includes(term)
      || inv.billTo.name.toLowerCase().includes(term)
      || inv.billTo.email.toLowerCase().includes(term);
  }));
  wireRowActions();
}

function wireRowActions() {
  document.querySelectorAll('[data-row-actions]').forEach((btn) => {
    const invoice = invoices.find((i) => i.id === btn.dataset.rowActions);
    initDropdown(btn, rowActionItems(invoice));
  });
}

function rowActionItems(invoice) {
  const isOpen = invoice.status === INVOICE_STATUS.DRAFT || invoice.status === INVOICE_STATUS.SENT;
  const items = [
    { label: 'View / Print', icon: 'fa-eye', onClick: () => openViewModal(invoice) },
    { label: 'Duplicate', icon: 'fa-copy', onClick: () => openEditor(null, duplicateOf(invoice)) },
  ];
  if (isOpen) items.push({ label: 'Edit', icon: 'fa-pen', onClick: () => openEditor(invoice) });
  if (invoice.status === INVOICE_STATUS.DRAFT) items.push({ label: 'Mark as Sent', icon: 'fa-paper-plane', onClick: () => runAction(() => markInvoiceSent(invoice.id, ACTOR), 'Invoice marked as sent.') });
  if (isOpen) items.push({ label: 'Record Payment', icon: 'fa-money-bill-wave', onClick: () => openPaymentModal(invoice) });

  if (invoice.status === INVOICE_STATUS.SENT) {
    items.push({ divider: true }, {
      label: 'Void', icon: 'fa-ban', danger: true,
      onClick: async () => {
        const ok = await modal.confirm({ title: `Void ${invoice.number}?`, message: 'The invoice stays on record but is marked void and can no longer be paid or edited.', confirmLabel: 'Void Invoice' });
        if (ok) runAction(() => voidInvoice(invoice.id, ACTOR), 'Invoice voided.');
      },
    });
  }
  if (invoice.status === INVOICE_STATUS.DRAFT) {
    items.push({ divider: true }, {
      label: 'Delete Draft', icon: 'fa-trash', danger: true,
      onClick: async () => {
        const ok = await modal.confirm({ title: `Delete ${invoice.number}?`, message: 'This draft was never sent, so it will be removed permanently.', confirmLabel: 'Delete' });
        if (ok) runAction(() => deleteDraftInvoice(invoice.id, ACTOR), 'Draft deleted.');
      },
    });
  }
  return items;
}

async function runAction(fn, successMessage) {
  try {
    await fn();
    toast.success(successMessage);
    modal.close();
    await refresh();
  } catch (err) {
    toast.danger(err.message);
  }
}

function duplicateOf(invoice) {
  return {
    customerId: invoice.customerId,
    billTo: { ...invoice.billTo },
    items: invoice.items.map((i) => ({ ...i })),
    discountPercent: invoice.discountPercent,
    taxPercent: invoice.taxPercent,
    notes: invoice.notes,
  };
}

// ---------------------------------------------------------------------
// Editor (create / edit)
// ---------------------------------------------------------------------
function isoDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(isoDateString, days) {
  const d = new Date(`${isoDateString}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

function blankLine() {
  return { productId: '', description: '', quantity: 1, price: 0 };
}

/**
 * @param existing  an invoice being edited, or null for a new one
 * @param prefill   data for a new invoice (from an order or a duplicate)
 */
function openEditor(existing = null, prefill = null) {
  const settings = getSettings();
  const base = existing ?? prefill ?? {};
  const issueDate = existing?.issueDate ?? isoDate(new Date());
  const dueDate = existing?.dueDate ?? addDays(issueDate, DEFAULT_DUE_DAYS);
  const billTo = base.billTo ?? { name: '', email: '', phone: '', address: '' };
  lineItems = base.items?.length ? base.items.map((i) => ({ ...i, productId: i.productId ?? '' })) : [blankLine()];

  const sourceNote = prefill?.source
    ? `<div class="card p-3 text-sm text-[var(--text-secondary)]" style="background: var(--surface-sunken)">
         <i class="fa-solid fa-link mr-1"></i> Prefilled from ${prefill.source.kind === 'sale' ? 'in-store sale' : 'online order'}
         <span class="font-mono">#${escapeHTML(prefill.source.orderId.slice(-6).toUpperCase())}</span>. Stock was already deducted at checkout — invoicing it won't change inventory.
       </div>`
    : '';

  const el = modal.open({
    title: existing ? `Edit ${escapeHTML(existing.number)}` : 'New Invoice',
    size: 'xl',
    bodyHTML: `
      <div class="space-y-5">
        ${sourceNote}
        <div class="grid sm:grid-cols-2 gap-4">
          <div class="space-y-3">
            <div>
              <label class="field-label" for="f-customer">Customer</label>
              <select id="f-customer" class="select">
                <option value="">— One-off customer (enter details) —</option>
                ${lookups.customers.map((c) => `<option value="${c.id}" ${c.id === base.customerId ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="field-label" for="f-bill-name">Bill To — Name *</label>
              <input id="f-bill-name" class="input" value="${escapeHTML(billTo.name)}" placeholder="Customer or company name" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="field-label" for="f-bill-email">Email</label>
                <input id="f-bill-email" type="email" class="input" value="${escapeHTML(billTo.email)}" />
              </div>
              <div>
                <label class="field-label" for="f-bill-phone">Phone</label>
                <input id="f-bill-phone" class="input" value="${escapeHTML(billTo.phone)}" />
              </div>
            </div>
            <div>
              <label class="field-label" for="f-bill-address">Address</label>
              <textarea id="f-bill-address" class="textarea" rows="2">${escapeHTML(billTo.address)}</textarea>
            </div>
          </div>
          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="field-label" for="f-issue">Issue Date *</label>
                <input id="f-issue" type="date" class="input" value="${issueDate}" />
              </div>
              <div>
                <label class="field-label" for="f-due">Due Date *</label>
                <input id="f-due" type="date" class="input" value="${dueDate}" />
              </div>
            </div>
            <div class="flex flex-wrap gap-2" id="due-presets">
              ${[['On receipt', 0], ['Net 7', 7], ['Net 14', 14], ['Net 30', 30]].map(([label, days]) => `<button type="button" class="btn btn-secondary btn-sm" data-due-days="${days}">${label}</button>`).join('')}
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="field-label" for="f-discount">Discount %</label>
                <input id="f-discount" type="number" min="0" max="100" step="0.01" class="input" value="${base.discountPercent ?? 0}" />
              </div>
              <div>
                <label class="field-label" for="f-tax">Tax %</label>
                <input id="f-tax" type="number" min="0" step="0.01" class="input" value="${base.taxPercent ?? settings.taxRate ?? 0}" />
              </div>
            </div>
            <div>
              <label class="field-label" for="f-notes">Notes / Payment Terms</label>
              <textarea id="f-notes" class="textarea" rows="3" placeholder="e.g. Pay via Mobile Money to 024 000 0000. Thank you for your business!">${escapeHTML(base.notes ?? '')}</textarea>
            </div>
          </div>
        </div>

        <div>
          <label class="field-label">Line Items *</label>
          <div class="hidden sm:grid grid-cols-12 gap-2 text-xs uppercase text-[var(--text-muted)] px-1 pb-1">
            <span class="col-span-3">Product</span><span class="col-span-4">Description</span><span class="col-span-1 text-right">Qty</span><span class="col-span-2 text-right">Unit Price</span><span class="col-span-2 text-right">Amount</span>
          </div>
          <div id="line-items" class="space-y-2"></div>
          <button type="button" id="add-line" class="btn btn-secondary btn-sm mt-2"><i class="fa-solid fa-plus"></i> Add Line Item</button>
        </div>

        <div class="flex justify-end">
          <dl class="w-full sm:w-72 space-y-1 text-sm" id="invoice-totals"></dl>
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-secondary" id="save-draft" type="button">${existing && existing.status !== INVOICE_STATUS.DRAFT ? 'Save Changes' : 'Save Draft'}</button>
      ${!existing || existing.status === INVOICE_STATUS.DRAFT ? '<button class="btn btn-primary" id="save-send" type="button"><i class="fa-solid fa-paper-plane"></i> Save &amp; Mark Sent</button>' : ''}
    `,
  });

  const lineContainer = el.querySelector('#line-items');
  const recalc = () => renderTotals(el);
  renderLineItems(lineContainer, recalc);

  el.querySelector('#add-line').addEventListener('click', () => { lineItems.push(blankLine()); renderLineItems(lineContainer, recalc); });
  el.querySelector('#f-discount').addEventListener('input', recalc);
  el.querySelector('#f-tax').addEventListener('input', recalc);

  el.querySelector('#f-customer').addEventListener('change', (e) => {
    const customer = lookups.customers.find((c) => c.id === e.target.value);
    if (!customer) return;
    el.querySelector('#f-bill-name').value = customer.name ?? '';
    el.querySelector('#f-bill-email').value = customer.email ?? '';
    el.querySelector('#f-bill-phone').value = customer.phone ?? '';
    el.querySelector('#f-bill-address').value = customer.address ?? '';
  });

  el.querySelectorAll('[data-due-days]').forEach((btn) => btn.addEventListener('click', () => {
    const issue = el.querySelector('#f-issue').value || isoDate(new Date());
    el.querySelector('#f-due').value = addDays(issue, Number(btn.dataset.dueDays));
  }));

  const save = async (markSent) => {
    const data = {
      customerId: el.querySelector('#f-customer').value || null,
      billTo: {
        name: el.querySelector('#f-bill-name').value,
        email: el.querySelector('#f-bill-email').value,
        phone: el.querySelector('#f-bill-phone').value,
        address: el.querySelector('#f-bill-address').value,
      },
      items: lineItems,
      issueDate: el.querySelector('#f-issue').value,
      dueDate: el.querySelector('#f-due').value,
      discountPercent: el.querySelector('#f-discount').value,
      taxPercent: el.querySelector('#f-tax').value,
      notes: el.querySelector('#f-notes').value,
      source: prefill?.source ?? null,
    };
    if (!data.issueDate || !data.dueDate) { toast.danger('Set both an issue date and a due date.'); return; }

    try {
      const saved = existing
        ? await updateInvoice(existing.id, data, { markSent }, ACTOR)
        : await createInvoice(data, { markSent }, ACTOR);
      toast.success(existing ? `${saved.number} updated.` : `${saved.number} created.`);
      modal.close();
      await refresh();
      openViewModal(invoices.find((i) => i.id === saved.id));
    } catch (err) {
      toast.danger(err.message);
    }
  };
  el.querySelector('#save-draft').addEventListener('click', () => save(false));
  el.querySelector('#save-send')?.addEventListener('click', () => save(true));
}

function renderLineItems(container, onChange) {
  container.innerHTML = lineItems.map((item, i) => `
    <div class="grid grid-cols-12 gap-2 items-center" data-line-row="${i}">
      <select class="select col-span-12 sm:col-span-3" data-line-field="productId" aria-label="Product">
        <option value="">Custom item</option>
        ${lookups.products.map((p) => `<option value="${p.id}" ${p.id === item.productId ? 'selected' : ''}>${escapeHTML(p.name)}</option>`).join('')}
      </select>
      <input class="input col-span-12 sm:col-span-4" placeholder="Description" value="${escapeHTML(item.description)}" data-line-field="description" aria-label="Description" />
      <input type="number" min="1" step="1" class="input col-span-3 sm:col-span-1 text-right" value="${item.quantity || ''}" data-line-field="quantity" aria-label="Quantity" />
      <input type="number" min="0" step="0.01" class="input col-span-4 sm:col-span-2 text-right" value="${item.price ?? ''}" data-line-field="price" aria-label="Unit price" />
      <span class="col-span-3 sm:col-span-1 text-right text-sm font-medium" data-line-amount>${money((item.quantity || 0) * (item.price || 0))}</span>
      <button type="button" class="btn btn-ghost btn-icon col-span-2 sm:col-span-1 justify-self-end" data-remove-line="${i}" aria-label="Remove line" ${lineItems.length === 1 ? 'disabled' : ''}><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');

  container.querySelectorAll('[data-line-field]').forEach((input) => {
    const row = input.closest('[data-line-row]');
    const item = lineItems[Number(row.dataset.lineRow)];
    const eventName = input.tagName === 'SELECT' ? 'change' : 'input';

    input.addEventListener(eventName, () => {
      const field = input.dataset.lineField;
      if (field === 'productId') {
        item.productId = input.value;
        const product = lookups.products.find((p) => p.id === input.value);
        if (product) {
          item.description = product.name;
          item.price = Number(product.sellingPrice) || 0;
          row.querySelector('[data-line-field="description"]').value = item.description;
          row.querySelector('[data-line-field="price"]').value = item.price;
        }
      } else if (field === 'description') {
        item.description = input.value;
      } else {
        item[field] = Number(input.value);
      }
      row.querySelector('[data-line-amount]').textContent = money((item.quantity || 0) * (item.price || 0));
      onChange();
    });
  });

  container.querySelectorAll('[data-remove-line]').forEach((btn) => {
    btn.addEventListener('click', () => {
      lineItems.splice(Number(btn.dataset.removeLine), 1);
      renderLineItems(container, onChange);
    });
  });
  onChange();
}

function renderTotals(el) {
  const discountPercent = Number(el.querySelector('#f-discount').value) || 0;
  const taxPercent = Number(el.querySelector('#f-tax').value) || 0;
  const t = computeInvoiceTotals(lineItems, { discountPercent, taxPercent });
  el.querySelector('#invoice-totals').innerHTML = `
    <div class="flex justify-between"><dt class="text-[var(--text-secondary)]">Subtotal</dt><dd>${money(t.subtotal)}</dd></div>
    ${discountPercent ? `<div class="flex justify-between"><dt class="text-[var(--text-secondary)]">Discount (${discountPercent}%)</dt><dd>− ${money(t.discountAmount)}</dd></div>` : ''}
    ${taxPercent ? `<div class="flex justify-between"><dt class="text-[var(--text-secondary)]">Tax (${taxPercent}%)</dt><dd>${money(t.taxAmount)}</dd></div>` : ''}
    <div class="flex justify-between font-semibold text-base border-t pt-2" style="border-color: var(--border-subtle)"><dt>Total</dt><dd>${money(t.total)}</dd></div>
  `;
}

// ---------------------------------------------------------------------
// Generate from an existing order
// ---------------------------------------------------------------------
async function openFromOrderPicker() {
  const [sales, onlineOrders] = await Promise.all([api.sales.list(), api.onlineOrders.list()]);
  const invoicedBy = new Map(invoices.filter((i) => i.source?.orderId && i.status !== INVOICE_STATUS.VOID).map((i) => [i.source.orderId, i.number]));
  const customerName = (id) => lookups.customers.find((c) => c.id === id)?.name ?? 'Walk-in customer';
  const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt);

  const option = (kind, order) => {
    const already = invoicedBy.get(order.id);
    return `<option value="${kind}:${order.id}">#${order.id.slice(-6).toUpperCase()} · ${escapeHTML(customerName(order.customerId))} · ${money(order.total)} · ${formatDate(order.createdAt)}${already ? ` — already on ${escapeHTML(already)}` : ''}</option>`;
  };

  if (!sales.length && !onlineOrders.length) {
    toast.info('There are no sales or online orders to invoice yet.');
    return;
  }

  const el = modal.open({
    title: 'Generate Invoice from Order',
    size: 'md',
    bodyHTML: `
      <div class="space-y-3">
        <p class="text-sm text-[var(--text-secondary)]">Pick a sale or online order. Its customer and line items are copied into a new invoice you can adjust before saving.</p>
        <label class="field-label" for="f-order">Order</label>
        <select id="f-order" class="select">
          ${sales.length ? `<optgroup label="In-store sales">${[...sales].sort(byNewest).map((s) => option('sale', s)).join('')}</optgroup>` : ''}
          ${onlineOrders.length ? `<optgroup label="Online orders">${[...onlineOrders].sort(byNewest).map((o) => option('online', o)).join('')}</optgroup>` : ''}
        </select>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="use-order" type="button">Continue</button>
    `,
  });

  el.querySelector('#use-order').addEventListener('click', async () => {
    const [kind, orderId] = el.querySelector('#f-order').value.split(':');
    try {
      openEditor(null, await draftFromOrder(kind, orderId));
    } catch (err) {
      toast.danger(err.message);
    }
  });
}

// ---------------------------------------------------------------------
// Record payment
// ---------------------------------------------------------------------
function openPaymentModal(invoice) {
  const el = modal.open({
    title: `Record Payment — ${escapeHTML(invoice.number)}`,
    size: 'sm',
    bodyHTML: `
      <div class="space-y-3">
        <p class="text-sm text-[var(--text-secondary)]">Marks the full amount of <strong>${money(invoice.total)}</strong> as received from ${escapeHTML(invoice.billTo.name)}.</p>
        <div>
          <label class="field-label" for="f-method">Payment Method</label>
          <select id="f-method" class="select">
            ${Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
          </select>
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="confirm-paid" type="button"><i class="fa-solid fa-check"></i> Mark as Paid</button>
    `,
  });
  el.querySelector('#confirm-paid').addEventListener('click', () =>
    runAction(() => markInvoicePaid(invoice.id, el.querySelector('#f-method').value, ACTOR), `${invoice.number} marked as paid.`));
}

// ---------------------------------------------------------------------
// Invoice document (view / print / email)
// ---------------------------------------------------------------------
function invoiceDocumentHTML(invoice) {
  const s = getSettings();
  const status = effectiveStatus(invoice);
  const cur = (n) => formatCurrency(n, s.currency);
  const multiline = (text) => escapeHTML(text).replace(/\n/g, '<br>');

  const rows = invoice.items.map((item) => `
    <tr>
      <td>${escapeHTML(item.description)}</td>
      <td class="num">${item.quantity}</td>
      <td class="num">${cur(item.price)}</td>
      <td class="num">${cur(item.quantity * item.price)}</td>
    </tr>`).join('');

  return `
    <article class="invoice-doc">
      <header class="invoice-doc__head">
        <div>
          <p class="invoice-doc__store">${escapeHTML(s.storeName)}</p>
          ${s.storeAddress ? `<p>${multiline(s.storeAddress)}</p>` : ''}
          ${s.storePhone ? `<p>${escapeHTML(s.storePhone)}</p>` : ''}
          ${s.storeEmail ? `<p>${escapeHTML(s.storeEmail)}</p>` : ''}
        </div>
        <div class="invoice-doc__title">
          <h2>INVOICE</h2>
          <p class="invoice-doc__number">${escapeHTML(invoice.number)}</p>
          <span class="invoice-doc__stamp invoice-doc__stamp--${status}">${status}</span>
        </div>
      </header>

      <section class="invoice-doc__meta">
        <div>
          <p class="invoice-doc__label">Bill To</p>
          <p class="invoice-doc__strong">${escapeHTML(invoice.billTo.name)}</p>
          ${invoice.billTo.address ? `<p>${multiline(invoice.billTo.address)}</p>` : ''}
          ${invoice.billTo.phone ? `<p>${escapeHTML(invoice.billTo.phone)}</p>` : ''}
          ${invoice.billTo.email ? `<p>${escapeHTML(invoice.billTo.email)}</p>` : ''}
        </div>
        <dl>
          <div><dt>Issue date</dt><dd>${formatDate(`${invoice.issueDate}T00:00:00`)}</dd></div>
          <div><dt>Due date</dt><dd>${formatDate(`${invoice.dueDate}T00:00:00`)}</dd></div>
          ${invoice.source?.orderId ? `<div><dt>Order ref</dt><dd>#${escapeHTML(invoice.source.orderId.slice(-6).toUpperCase())}</dd></div>` : ''}
          ${invoice.paidAt ? `<div><dt>Paid</dt><dd>${formatDate(invoice.paidAt)}${invoice.paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[invoice.paymentMethod] ?? escapeHTML(invoice.paymentMethod)}` : ''}</dd></div>` : ''}
        </dl>
      </section>

      <table class="invoice-doc__items">
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <section class="invoice-doc__totals">
        <dl>
          <div><dt>Subtotal</dt><dd>${cur(invoice.subtotal)}</dd></div>
          ${invoice.discountAmount ? `<div><dt>Discount (${invoice.discountPercent}%)</dt><dd>− ${cur(invoice.discountAmount)}</dd></div>` : ''}
          ${invoice.taxAmount ? `<div><dt>Tax (${invoice.taxPercent}%)</dt><dd>${cur(invoice.taxAmount)}</dd></div>` : ''}
          <div class="invoice-doc__grand"><dt>${status === INVOICE_STATUS.PAID ? 'Total Paid' : 'Amount Due'}</dt><dd>${cur(invoice.total)}</dd></div>
        </dl>
      </section>

      ${invoice.notes ? `<section class="invoice-doc__notes"><p class="invoice-doc__label">Notes</p><p>${multiline(invoice.notes)}</p></section>` : ''}
      <footer class="invoice-doc__foot">Thank you for your business.</footer>
    </article>`;
}

function printInvoice(invoice) {
  const root = document.getElementById('invoice-print-root');
  root.innerHTML = invoiceDocumentHTML(invoice);

  // The print dialog's "Save as PDF" uses document.title as the default filename.
  const previousTitle = document.title;
  document.title = `${invoice.number} - ${invoice.billTo.name}`;
  window.addEventListener('afterprint', () => { document.title = previousTitle; root.innerHTML = ''; }, { once: true });
  window.print();
}

function emailInvoice(invoice) {
  const s = getSettings();
  const subject = `Invoice ${invoice.number} from ${s.storeName}`;
  const lines = [
    `Hi ${invoice.billTo.name},`,
    '',
    `Please find invoice ${invoice.number} for ${formatCurrency(invoice.total, s.currency)}, due ${formatDate(`${invoice.dueDate}T00:00:00`)}.`,
    '',
    ...invoice.items.map((i) => `- ${i.description} × ${i.quantity}: ${formatCurrency(i.quantity * i.price, s.currency)}`),
    '',
    `Total: ${formatCurrency(invoice.total, s.currency)}`,
    ...(invoice.notes ? ['', invoice.notes] : []),
    '',
    'Thank you for your business.',
    s.storeName,
  ];
  window.location.href = `mailto:${encodeURIComponent(invoice.billTo.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

function openViewModal(invoice) {
  const isOpen = invoice.status === INVOICE_STATUS.DRAFT || invoice.status === INVOICE_STATUS.SENT;
  const el = modal.open({
    title: escapeHTML(invoice.number),
    size: 'xl',
    bodyHTML: `<div class="invoice-preview">${invoiceDocumentHTML(invoice)}</div>`,
    footerHTML: `
      ${isOpen ? '<button class="btn btn-secondary" id="inv-edit" type="button"><i class="fa-solid fa-pen"></i> Edit</button>' : ''}
      ${invoice.billTo.email ? '<button class="btn btn-secondary" id="inv-email" type="button"><i class="fa-solid fa-envelope"></i> Email</button>' : ''}
      ${isOpen ? '<button class="btn btn-secondary" id="inv-paid" type="button"><i class="fa-solid fa-money-bill-wave"></i> Record Payment</button>' : ''}
      <button class="btn btn-primary" id="inv-print" type="button"><i class="fa-solid fa-print"></i> Print / PDF</button>
    `,
  });

  el.querySelector('#inv-print').addEventListener('click', () => printInvoice(invoice));
  el.querySelector('#inv-edit')?.addEventListener('click', () => openEditor(invoice));
  el.querySelector('#inv-paid')?.addEventListener('click', () => openPaymentModal(invoice));
  el.querySelector('#inv-email')?.addEventListener('click', async () => {
    emailInvoice(invoice);
    if (invoice.status === INVOICE_STATUS.DRAFT) {
      const ok = await modal.confirm({ title: 'Mark as sent?', message: `Your email app should have opened with ${escapeHTML(invoice.number)}. Mark it as sent so its due date is tracked?`, confirmLabel: 'Mark as Sent', danger: false });
      if (ok) runAction(() => markInvoiceSent(invoice.id, ACTOR), 'Invoice marked as sent.');
    }
  });
}
