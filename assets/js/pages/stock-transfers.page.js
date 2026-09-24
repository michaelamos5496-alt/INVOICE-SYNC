/**
 * stock-transfers.page.js — controller for pages/stock-transfers.html.
 * Moves stock between locations (shop floor / backroom / warehouse) via
 * inventory.service.js's createStockTransfer, which nets to zero
 * quantity change but updates the product's location and logs both
 * legs of the move for the audit trail.
 */
import { getActorName } from '../services/auth.service.js';
import { api } from '../services/api.service.js';
import { createStockTransfer } from '../services/inventory.service.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { formatDateTime } from '../utils/formatters.js';
import { escapeHTML } from '../utils/helpers.js';

let table;
let lookups = { products: [], warehouses: [] };

export async function initStockTransfersPage() {
  const [products, warehouses] = await Promise.all([api.products.list(), api.warehouses.list()]);
  lookups = { products, warehouses };

  buildTable();
  await refreshTable();

  document.getElementById('create-transfer-btn').addEventListener('click', () => openCreateModal());
}

function locationName(id) {
  return lookups.warehouses.find((w) => w.id === id)?.name ?? '—';
}

function buildTable() {
  table = new DataTable(document.getElementById('transfers-table'), {
    columns: [
      { key: 'productName', label: 'Product', sortable: true, render: (row) => escapeHTML(row.productName) },
      { key: 'quantity', label: 'Qty', align: 'right', render: (row) => row.quantity },
      { key: 'fromLocationId', label: 'From', render: (row) => escapeHTML(locationName(row.fromLocationId)) },
      { key: 'toLocationId', label: 'To', render: (row) => `<i class="fa-solid fa-arrow-right text-[var(--text-muted)] mr-1.5"></i>${escapeHTML(locationName(row.toLocationId))}` },
      { key: 'actor', label: 'By', render: (row) => escapeHTML(row.actor) },
      { key: 'createdAt', label: 'Date', sortable: true, render: (row) => formatDateTime(row.createdAt) },
    ],
    pageSize: 8,
    searchKeys: ['productName'],
    rowKey: (row) => row.id,
    defaultSort: { key: 'createdAt', dir: 'desc' },
    emptyState: {
      icon: 'fa-right-left', title: 'No transfers yet',
      message: 'Move stock between the shop floor, backroom, and warehouse here.',
      actionLabel: 'New Transfer', onAction: () => openCreateModal(),
    },
  });
}

async function refreshTable() {
  table.setLoading();
  table.setData(await api.stockTransfers.list());
}

function openCreateModal() {
  const el = modal.open({
    title: 'New Stock Transfer',
    size: 'md',
    bodyHTML: `
      <div class="space-y-4">
        <div>
          <label class="field-label">Product *</label>
          <select id="f-product" class="select">
            <option value="">— Select product —</option>
            ${lookups.products.map((p) => `<option value="${p.id}">${escapeHTML(p.name)} (${p.stockQuantity} on hand)</option>`).join('')}
          </select>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="field-label">From Location *</label>
            <select id="f-from" class="select">
              <option value="">— Select —</option>
              ${lookups.warehouses.map((w) => `<option value="${w.id}">${escapeHTML(w.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="field-label">To Location *</label>
            <select id="f-to" class="select">
              <option value="">— Select —</option>
              ${lookups.warehouses.map((w) => `<option value="${w.id}">${escapeHTML(w.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <label class="field-label">Quantity *</label>
          <input id="f-qty" type="number" min="1" class="input" />
        </div>
        <div>
          <label class="field-label">Note</label>
          <input id="f-note" type="text" class="input" placeholder="Optional" />
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="save-transfer" type="button">Transfer Stock</button>
    `,
  });

  el.querySelector('#save-transfer').addEventListener('click', async () => {
    const productId = el.querySelector('#f-product').value;
    const fromLocationId = el.querySelector('#f-from').value;
    const toLocationId = el.querySelector('#f-to').value;
    const quantity = Number(el.querySelector('#f-qty').value);
    const note = el.querySelector('#f-note').value.trim();

    if (!productId || !fromLocationId || !toLocationId) { toast.danger('Select a product and both locations.'); return; }
    if (fromLocationId === toLocationId) { toast.danger('Source and destination must be different.'); return; }
    if (!quantity || quantity <= 0) { toast.danger('Enter a valid quantity.'); return; }

    try {
      await createStockTransfer({ productId, quantity, fromLocationId, toLocationId, note }, getActorName());
      toast.success('Stock transferred.');
      modal.close();
      refreshTable();
    } catch (err) {
      toast.danger(err.message);
    }
  });
}
