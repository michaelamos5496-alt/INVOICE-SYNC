/**
 * online-orders.page.js — controller for pages/online-orders.html.
 * Two ways to add an order here: build one manually (as a stand-in admin
 * tool), or click "Simulate Incoming Order" to fire the same code path a
 * real Shopify/WooCommerce webhook would hit in Phase 10. Either way,
 * stock deducts immediately through online-orders.service.js, proving
 * the online channel draws from the identical pool the POS just sold
 * from in Phase 6.
 */
import { watchData } from '../services/live-data.js';
import { getActorName } from '../services/auth.service.js';
import { api } from '../services/api.service.js';
import {
  listOnlineOrders, createOnlineOrder, fulfillOnlineOrder, cancelOnlineOrder, simulateIncomingOrder,
} from '../services/online-orders.service.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { initDropdown } from '../components/dropdown.js';
import { formatCurrency, formatDateTime } from '../utils/formatters.js';
import { escapeHTML } from '../utils/helpers.js';

const STATUS_BADGE = {
  processing: 'badge-warning',
  fulfilled: 'badge-success',
  cancelled: 'badge-danger',
};

let table;
let lookups = { customers: [], products: [] };
let lineItems = [];

export async function initOnlineOrdersPage() {
  await reloadLookups();

  buildTable();
  await refreshTable();

  watchData(['onlineOrders'], refreshTable);
  watchData(['customers', 'products'], async () => { await reloadLookups(); await refreshTable(); });

  document.getElementById('new-order-btn').addEventListener('click', () => openCreateModal());
  document.getElementById('simulate-order-btn').addEventListener('click', async () => {
    try {
      const order = await simulateIncomingOrder();
      toast.success(`Simulated order #${order.id.slice(-6).toUpperCase()} received.`);
      refreshTable();
    } catch (err) {
      toast.danger(err.message);
    }
  });
}

function customerName(id) {
  return lookups.customers.find((c) => c.id === id)?.name ?? 'Guest checkout';
}

function buildTable() {
  table = new DataTable(document.getElementById('online-orders-table'), {
    columns: [
      { key: 'id', label: 'Order #', render: (row) => `<span class="font-mono font-medium">#${row.id.slice(-6).toUpperCase()}</span>` },
      { key: 'customerId', label: 'Customer', render: (row) => escapeHTML(customerName(row.customerId)) },
      { key: 'items', label: 'Items', align: 'right', render: (row) => row.items.reduce((s, i) => s + i.quantity, 0) },
      { key: 'total', label: 'Total', align: 'right', sortable: true, render: (row) => formatCurrency(row.total) },
      { key: 'status', label: 'Status', render: (row) => `<span class="badge ${STATUS_BADGE[row.status]}">${row.status}</span>` },
      { key: 'createdAt', label: 'Date', sortable: true, render: (row) => formatDateTime(row.createdAt) },
      {
        key: 'actions', label: '',
        render: (row) => `<button class="btn btn-ghost btn-sm" data-row-actions="${row.id}"><i class="fa-solid fa-ellipsis"></i></button>`,
      },
    ],
    pageSize: 10,
    onRender: wireRowActions, // row menus must be re-attached every time the rows are redrawn (paging, sorting, live updates)
    searchKeys: [],
    rowKey: (row) => row.id,
    defaultSort: { key: 'createdAt', dir: 'desc' },
    emptyState: {
      icon: 'fa-cart-shopping', title: 'No online orders yet',
      message: 'Orders from your connected online store will sync in here automatically. Try simulating one.',
      actionLabel: 'Simulate Incoming Order', onAction: () => document.getElementById('simulate-order-btn').click(),
    },
  });
}

async function reloadLookups() {
  const [customers, products] = await Promise.all([api.customers.list(), api.products.list()]);
  lookups = { customers, products };
}

async function refreshTable() {
  table.setLoading();
  table.setData(await listOnlineOrders());
}

function wireRowActions() {
  document.querySelectorAll('[data-row-actions]').forEach((btn) => {
    const id = btn.dataset.rowActions;
    initDropdown(btn, [
      { label: 'View', icon: 'fa-eye', onClick: async () => openViewModal(await api.onlineOrders.get(id)) },
      {
        label: 'Mark Fulfilled', icon: 'fa-box-open',
        onClick: async () => {
          try { await fulfillOnlineOrder(id, getActorName()); toast.success('Order marked as fulfilled.'); refreshTable(); }
          catch (err) { toast.danger(err.message); }
        },
      },
      { divider: true },
      {
        label: 'Cancel Order', icon: 'fa-ban', danger: true,
        onClick: async () => {
          const ok = await modal.confirm({ title: 'Cancel this order?', message: 'This restocks every item back into shared inventory.' });
          if (!ok) return;
          try { await cancelOnlineOrder(id, getActorName()); toast.success('Order cancelled — stock restored.'); refreshTable(); }
          catch (err) { toast.danger(err.message); }
        },
      },
    ]);
  });
}

function openViewModal(order) {
  const rows = order.items.map((item) => `
    <tr><td class="py-1.5 text-sm">${escapeHTML(item.name)} <span class="text-[var(--text-muted)]">× ${item.quantity}</span></td>
      <td class="py-1.5 text-sm text-right">${formatCurrency(item.price * item.quantity)}</td></tr>`).join('');

  modal.open({
    title: `Order #${order.id.slice(-6).toUpperCase()}`,
    size: 'sm',
    bodyHTML: `
      <div class="space-y-3">
        <p class="text-sm text-[var(--text-secondary)]">${escapeHTML(customerName(order.customerId))} · ${formatDateTime(order.createdAt)}</p>
        <table class="w-full">${rows}</table>
        <div class="flex justify-between font-semibold text-base border-t pt-2" style="border-color: var(--border-subtle)"><span>Total</span><span>${formatCurrency(order.total)}</span></div>
        ${order.notes ? `<p class="text-sm text-[var(--text-secondary)]"><strong>Notes:</strong> ${escapeHTML(order.notes)}</p>` : ''}
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Close</button>
      <a class="btn btn-primary" href="invoices.html?fromOnline=${encodeURIComponent(order.id)}"><i class="fa-solid fa-file-invoice-dollar"></i> Create Invoice</a>`,
  });
}

// ---------------------------------------------------------------------
// Create order modal
// ---------------------------------------------------------------------
function renderLineItemRows(container) {
  container.innerHTML = lineItems.length
    ? lineItems.map((item, i) => `
        <div class="grid grid-cols-12 gap-2 items-center" data-line-row="${i}">
          <select class="select col-span-7" data-line-field="productId">
            <option value="">— Select product —</option>
            ${lookups.products.map((p) => `<option value="${p.id}" ${p.id === item.productId ? 'selected' : ''}>${escapeHTML(p.name)} (${p.stockQuantity} on hand)</option>`).join('')}
          </select>
          <input type="number" min="1" class="input col-span-4" placeholder="Qty" value="${item.quantity || ''}" data-line-field="quantity" />
          <button type="button" class="btn btn-ghost btn-icon col-span-1" data-remove-line="${i}"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('')
    : `<p class="text-sm text-[var(--text-muted)]">Add at least one item.</p>`;

  container.querySelectorAll('[data-line-field]').forEach((input) => {
    const row = input.closest('[data-line-row]');
    const idx = Number(row.dataset.lineRow);
    input.addEventListener('input', () => {
      const field = input.dataset.lineField;
      lineItems[idx][field] = field === 'quantity' ? Number(input.value) : input.value;
      if (field === 'productId') {
        const product = lookups.products.find((p) => p.id === input.value);
        lineItems[idx].price = product ? product.sellingPrice * (1 - (product.discount ?? 0) / 100) : 0;
        lineItems[idx].name = product?.name ?? '';
      }
    });
  });
  container.querySelectorAll('[data-remove-line]').forEach((btn) => {
    btn.addEventListener('click', () => { lineItems.splice(Number(btn.dataset.removeLine), 1); renderLineItemRows(container); });
  });
}

function openCreateModal() {
  lineItems = [{ productId: '', quantity: 1, price: 0, name: '' }];

  const el = modal.open({
    title: 'New Online Order',
    size: 'lg',
    bodyHTML: `
      <div class="space-y-4">
        <div>
          <label class="field-label">Customer</label>
          <select id="f-customer" class="select">
            <option value="">Guest checkout</option>
            ${lookups.customers.map((c) => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="field-label">Line Items *</label>
          <div id="line-items" class="space-y-2"></div>
          <button type="button" id="add-line" class="btn btn-secondary btn-sm mt-2"><i class="fa-solid fa-plus"></i> Add Item</button>
        </div>
        <div>
          <label class="field-label">Order Notes</label>
          <textarea id="f-notes" class="textarea"></textarea>
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="save-order" type="button">Create Order</button>
    `,
  });

  const lineContainer = el.querySelector('#line-items');
  renderLineItemRows(lineContainer);
  el.querySelector('#add-line').addEventListener('click', () => { lineItems.push({ productId: '', quantity: 1, price: 0, name: '' }); renderLineItemRows(lineContainer); });

  el.querySelector('#save-order').addEventListener('click', async () => {
    const validItems = lineItems.filter((i) => i.productId && i.quantity > 0);
    if (!validItems.length) { toast.danger('Add at least one valid item.'); return; }

    try {
      const order = await createOnlineOrder({
        customerId: el.querySelector('#f-customer').value,
        items: validItems,
        notes: el.querySelector('#f-notes').value.trim(),
      }, getActorName());
      toast.success(`Order #${order.id.slice(-6).toUpperCase()} created — inventory updated.`);
      modal.close();
      refreshTable();
    } catch (err) {
      toast.danger(err.message);
    }
  });
}
