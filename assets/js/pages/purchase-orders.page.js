/**
 * purchase-orders.page.js — controller for pages/purchase-orders.html.
 * Builds a PO against one or more products/quantities/cost prices, then
 * lets the owner receive it later — which is the only action that
 * touches stock, via purchase-orders.service.js -> inventory.service.js.
 */
import { api } from '../services/api.service.js';
import {
  listPurchaseOrders, createPurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder,
} from '../services/purchase-orders.service.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { initDropdown } from '../components/dropdown.js';
import { formatCurrency, formatDate } from '../utils/formatters.js';
import { escapeHTML } from '../utils/helpers.js';

const STATUS_BADGE = {
  pending: 'badge-warning',
  received: 'badge-success',
  cancelled: 'badge-danger',
};

let table;
let lookups = { suppliers: [], products: [] };
let lineItems = [];

export async function initPurchaseOrdersPage() {
  const [suppliers, products] = await Promise.all([api.suppliers.list(), api.products.list()]);
  lookups = { suppliers, products };

  buildTable();
  await refreshTable();

  document.getElementById('create-po-btn').addEventListener('click', () => openCreateModal());
}

function supplierName(id) {
  return lookups.suppliers.find((s) => s.id === id)?.name ?? 'Unknown supplier';
}

function buildTable() {
  table = new DataTable(document.getElementById('purchase-orders-table'), {
    columns: [
      { key: 'id', label: 'PO #', render: (row) => `<span class="font-mono font-medium">#${row.id.slice(-6).toUpperCase()}</span>` },
      { key: 'supplierId', label: 'Supplier', render: (row) => escapeHTML(supplierName(row.supplierId)) },
      { key: 'items', label: 'Items', align: 'right', render: (row) => row.items.reduce((s, i) => s + i.quantity, 0) },
      { key: 'total', label: 'Total', align: 'right', sortable: true, render: (row) => formatCurrency(row.total) },
      { key: 'expectedDate', label: 'Expected', render: (row) => row.expectedDate ? formatDate(row.expectedDate) : '—' },
      { key: 'status', label: 'Status', render: (row) => `<span class="badge ${STATUS_BADGE[row.status]}">${row.status}</span>` },
      {
        key: 'actions', label: '',
        render: (row) => `<button class="btn btn-ghost btn-sm" data-row-actions="${row.id}" aria-label="Row actions"><i class="fa-solid fa-ellipsis"></i></button>`,
      },
    ],
    pageSize: 8,
    searchKeys: [],
    rowKey: (row) => row.id,
    defaultSort: { key: 'expectedDate', dir: 'desc' },
    emptyState: {
      icon: 'fa-file-invoice', title: 'No purchase orders yet',
      message: 'Create one to restock from a supplier.',
      actionLabel: 'New Purchase Order', onAction: () => openCreateModal(),
    },
  });
}

async function refreshTable() {
  table.setLoading();
  table.setData(await listPurchaseOrders());
  wireRowActions();
}

function wireRowActions() {
  document.querySelectorAll('[data-row-actions]').forEach((btn) => {
    const id = btn.dataset.rowActions;
    initDropdown(btn, [
      { label: 'View', icon: 'fa-eye', onClick: async () => openViewModal(await api.purchaseOrders.get(id)) },
      {
        label: 'Receive', icon: 'fa-box-open',
        onClick: async () => {
          const ok = await modal.confirm({ title: 'Receive this purchase order?', message: 'This adds every line item\'s quantity to shared inventory and cannot be undone.', danger: false, confirmLabel: 'Receive' });
          if (!ok) return;
          try {
            await receivePurchaseOrder(id, 'Michael Amos');
            toast.success('Purchase order received — inventory updated.');
            refreshTable();
          } catch (err) { toast.danger(err.message); }
        },
      },
      { divider: true },
      {
        label: 'Cancel', icon: 'fa-ban', danger: true,
        onClick: async () => {
          const ok = await modal.confirm({ title: 'Cancel this purchase order?', message: 'This cannot be undone.' });
          if (!ok) return;
          try {
            await cancelPurchaseOrder(id, 'Michael Amos');
            toast.success('Purchase order cancelled.');
            refreshTable();
          } catch (err) { toast.danger(err.message); }
        },
      },
    ]);
  });
}

function openViewModal(po) {
  const rows = po.items.map((item) => {
    const product = lookups.products.find((p) => p.id === item.productId);
    return `<tr>
      <td class="py-2 pr-4 text-sm">${escapeHTML(product?.name ?? 'Unknown product')}</td>
      <td class="py-2 pr-4 text-sm text-right">${item.quantity}</td>
      <td class="py-2 pr-4 text-sm text-right">${formatCurrency(item.costPrice)}</td>
      <td class="py-2 text-sm text-right font-medium">${formatCurrency(item.quantity * item.costPrice)}</td>
    </tr>`;
  }).join('');

  modal.open({
    title: `PO #${po.id.slice(-6).toUpperCase()} — ${escapeHTML(supplierName(po.supplierId))}`,
    size: 'lg',
    bodyHTML: `
      <table class="w-full text-left mb-4">
        <thead><tr class="text-xs uppercase text-[var(--text-muted)]">
          <th class="pb-2 pr-4">Product</th><th class="pb-2 pr-4 text-right">Qty</th><th class="pb-2 pr-4 text-right">Cost</th><th class="pb-2 text-right">Line Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="flex justify-end text-sm font-semibold mb-4">Total: ${formatCurrency(po.total)}</div>
      ${po.notes ? `<p class="text-sm text-[var(--text-secondary)]"><strong>Notes:</strong> ${escapeHTML(po.notes)}</p>` : ''}
    `,
    footerHTML: `<button class="btn btn-secondary" data-modal-close type="button">Close</button>`,
  });
}

// ---------------------------------------------------------------------
// Create PO modal
// ---------------------------------------------------------------------
function renderLineItemRows(container) {
  container.innerHTML = lineItems.length
    ? lineItems.map((item, i) => `
        <div class="grid grid-cols-12 gap-2 items-center" data-line-row="${i}">
          <select class="select col-span-6" data-line-field="productId">
            <option value="">— Select product —</option>
            ${lookups.products.map((p) => `<option value="${p.id}" ${p.id === item.productId ? 'selected' : ''}>${escapeHTML(p.name)} (${escapeHTML(p.sku)})</option>`).join('')}
          </select>
          <input type="number" min="1" class="input col-span-2" placeholder="Qty" value="${item.quantity || ''}" data-line-field="quantity" />
          <input type="number" min="0" step="0.01" class="input col-span-3" placeholder="Cost/unit" value="${item.costPrice || ''}" data-line-field="costPrice" />
          <button type="button" class="btn btn-ghost btn-icon col-span-1" data-remove-line="${i}" aria-label="Remove line"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('')
    : `<p class="text-sm text-[var(--text-muted)]">Add at least one line item.</p>`;

  container.querySelectorAll('[data-line-field]').forEach((input) => {
    const row = input.closest('[data-line-row]');
    const idx = Number(row.dataset.lineRow);
    input.addEventListener('input', () => {
      const field = input.dataset.lineField;
      lineItems[idx][field] = field === 'productId' ? input.value : Number(input.value);
      updateTotal(container);
    });
  });
  container.querySelectorAll('[data-remove-line]').forEach((btn) => {
    btn.addEventListener('click', () => { lineItems.splice(Number(btn.dataset.removeLine), 1); renderLineItemRows(container); updateTotal(container); });
  });
  updateTotal(container);
}

function updateTotal(container) {
  const total = lineItems.reduce((s, i) => s + (i.quantity || 0) * (i.costPrice || 0), 0);
  const totalEl = container.parentElement.querySelector('[data-po-total]');
  if (totalEl) totalEl.textContent = formatCurrency(total);
}

function openCreateModal() {
  lineItems = [{ productId: '', quantity: 1, costPrice: 0 }];

  const el = modal.open({
    title: 'New Purchase Order',
    size: 'lg',
    bodyHTML: `
      <div class="space-y-4">
        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="field-label">Supplier *</label>
            <select id="f-supplier" class="select">
              <option value="">— Select supplier —</option>
              ${lookups.suppliers.map((s) => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="field-label">Expected Date</label>
            <input id="f-expected" type="date" class="input" />
          </div>
        </div>
        <div>
          <label class="field-label">Line Items *</label>
          <div id="line-items" class="space-y-2"></div>
          <button type="button" id="add-line" class="btn btn-secondary btn-sm mt-2"><i class="fa-solid fa-plus"></i> Add Line Item</button>
        </div>
        <div class="flex justify-end text-sm font-semibold" data-po-total>${formatCurrency(0)}</div>
        <div>
          <label class="field-label">Notes</label>
          <textarea id="f-notes" class="textarea"></textarea>
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="save-po" type="button">Create Purchase Order</button>
    `,
  });

  const lineContainer = el.querySelector('#line-items');
  renderLineItemRows(lineContainer);
  el.querySelector('#add-line').addEventListener('click', () => { lineItems.push({ productId: '', quantity: 1, costPrice: 0 }); renderLineItemRows(lineContainer); });

  el.querySelector('#save-po').addEventListener('click', async () => {
    const supplierId = el.querySelector('#f-supplier').value;
    const validItems = lineItems.filter((i) => i.productId && i.quantity > 0);

    if (!supplierId) { toast.danger('Select a supplier.'); return; }
    if (!validItems.length) { toast.danger('Add at least one valid line item.'); return; }

    try {
      await createPurchaseOrder({
        supplierId, items: validItems,
        expectedDate: el.querySelector('#f-expected').value || null,
        notes: el.querySelector('#f-notes').value.trim(),
      }, 'Michael Amos');
      toast.success('Purchase order created.');
      modal.close();
      refreshTable();
    } catch (err) {
      toast.danger(err.message);
    }
  });
}
