/**
 * inventory.page.js — controller for pages/inventory.html, the operational
 * hub for stock levels: add stock, remove stock, stock counts, per-product
 * movement history, bulk CSV import/export, and a barcode-scan search box.
 *
 * Every quantity change funnels through inventory.service.js's adjustStock
 * / applyStockCount — this page never writes stockQuantity itself, for the
 * same "one shared inventory" reason products.service.js doesn't either.
 */
import { api } from '../services/api.service.js';
import { adjustStock, applyStockCount, getProductHistory, computeStockStatus } from '../services/inventory.service.js';
import { STOCK_MOVEMENT_TYPES, CHANNELS } from '../config/constants.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { initDropdown } from '../components/dropdown.js';
import { formatDateTime } from '../utils/formatters.js';
import { debounce, exportToCSV, parseCSV, generateSKU, escapeHTML } from '../utils/helpers.js';

const STOCK_BADGE = {
  in_stock: { cls: 'badge-success', label: 'In Stock' },
  low_stock: { cls: 'badge-warning', label: 'Low Stock' },
  out_of_stock: { cls: 'badge-danger', label: 'Out of Stock' },
};

const MOVEMENT_LABEL = {
  sale: 'Sale', return: 'Return', adjustment: 'Adjustment', restock: 'Restock',
  transfer_in: 'Transfer In', transfer_out: 'Transfer Out', stock_count: 'Stock Count',
};

let table;
let lookups = { categories: [], warehouses: [] };

export async function initInventoryPage() {
  const [categories, warehouses] = await Promise.all([api.categories.list(), api.warehouses.list()]);
  lookups = { categories, warehouses };

  document.getElementById('filter-category').innerHTML = '<option value="">All Categories</option>' +
    categories.map((c) => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');

  buildTable();
  await refreshTable();

  document.getElementById('inventory-search').addEventListener('input', debounce((e) => table.setSearchTerm(e.target.value), 200));
  document.getElementById('filter-category').addEventListener('change', refreshTable);
  document.getElementById('filter-status').addEventListener('change', refreshTable);

  document.getElementById('barcode-scan').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const code = e.target.value.trim();
    if (!code) return;
    const match = (await api.products.list()).find((p) => p.barcode === code || p.sku === code);
    if (match) {
      table.setSearchTerm(match.name);
      document.getElementById('inventory-search').value = match.name;
      toast.success(`Found: ${match.name}`);
    } else {
      toast.danger(`No product matches "${code}".`);
    }
    e.target.value = '';
  });

  document.getElementById('export-csv').addEventListener('click', async () => {
    const products = await api.products.list();
    exportToCSV(products.map((p) => ({
      name: p.name, sku: p.sku, barcode: p.barcode ?? '', category: lookupName(lookups.categories, p.categoryId),
      costPrice: p.costPrice, sellingPrice: p.sellingPrice, stockQuantity: p.stockQuantity,
      minStock: p.minStock, maxStock: p.maxStock, status: p.status,
    })), 'inventory-export.csv');
    toast.success('Inventory exported.');
  });

  document.getElementById('import-csv-input').addEventListener('change', handleImportFile);
}

function lookupName(list, id) {
  return list.find((item) => item.id === id)?.name ?? '';
}

function buildTable() {
  table = new DataTable(document.getElementById('inventory-table'), {
    columns: [
      {
        key: 'name', label: 'Product', sortable: true,
        render: (row) => `
          <div>
            <p class="text-sm font-medium">${escapeHTML(row.name)}</p>
            <p class="text-xs text-[var(--text-muted)] font-mono">${escapeHTML(row.sku)}${row.barcode ? ` · ${escapeHTML(row.barcode)}` : ''}</p>
          </div>`,
      },
      { key: 'categoryId', label: 'Category', render: (row) => lookupName(lookups.categories, row.categoryId) || '—' },
      { key: 'location', label: 'Location', render: (row) => lookupName(lookups.warehouses, row.location) || '—' },
      {
        key: 'stockQuantity', label: 'On Hand', sortable: true, align: 'right',
        render: (row) => `<span class="font-semibold">${row.stockQuantity}</span> <span class="text-xs text-[var(--text-muted)]">/ min ${row.minStock}</span>`,
      },
      {
        key: 'stockStatus', label: 'Status',
        render: (row) => {
          const badge = STOCK_BADGE[row.stockStatus] ?? STOCK_BADGE.in_stock;
          return `<span class="badge ${badge.cls}"><span class="badge-dot"></span>${badge.label}</span>`;
        },
      },
      {
        key: 'actions', label: '',
        render: (row) => `<button class="btn btn-ghost btn-sm" data-row-actions="${row.id}" aria-label="Row actions"><i class="fa-solid fa-ellipsis"></i></button>`,
      },
    ],
    pageSize: 8,
    searchKeys: ['name', 'sku', 'barcode'],
    rowKey: (row) => row.id,
    defaultSort: { key: 'name', dir: 'asc' },
    emptyState: { icon: 'fa-warehouse', title: 'No products to track yet', message: 'Add products from the Products page first.' },
  });
}

async function refreshTable() {
  table.setLoading();
  const categoryFilter = document.getElementById('filter-category').value;
  const statusFilter = document.getElementById('filter-status').value;

  let products = await api.products.list();
  if (categoryFilter) products = products.filter((p) => p.categoryId === categoryFilter);
  if (statusFilter) products = products.filter((p) => p.stockStatus === statusFilter);

  table.setData(products);
  wireRowActions();
}

function wireRowActions() {
  document.querySelectorAll('[data-row-actions]').forEach((btn) => {
    const productId = btn.dataset.rowActions;
    initDropdown(btn, [
      { label: 'Add Stock', icon: 'fa-plus', onClick: async () => openStockModal(await api.products.get(productId), 'add') },
      { label: 'Remove Stock', icon: 'fa-minus', onClick: async () => openStockModal(await api.products.get(productId), 'remove') },
      { label: 'Stock Count', icon: 'fa-clipboard-check', onClick: async () => openStockModal(await api.products.get(productId), 'count') },
      { divider: true },
      { label: 'View History', icon: 'fa-clock-rotate-left', onClick: async () => openHistoryModal(await api.products.get(productId)) },
    ]);
  });
}

// ---------------------------------------------------------------------
// Add / Remove / Count modal
// ---------------------------------------------------------------------
const MODAL_COPY = {
  add: { title: 'Add Stock', confirmLabel: 'Add Stock', qtyLabel: 'Quantity to add' },
  remove: { title: 'Remove Stock', confirmLabel: 'Remove Stock', qtyLabel: 'Quantity to remove' },
  count: { title: 'Stock Count', confirmLabel: 'Save Count', qtyLabel: 'Counted quantity (actual on-hand)' },
};

function openStockModal(product, mode) {
  const copy = MODAL_COPY[mode];
  const el = modal.open({
    title: `${copy.title} — ${escapeHTML(product.name)}`,
    size: 'sm',
    bodyHTML: `
      <div class="space-y-4">
        <p class="text-sm text-[var(--text-secondary)]">Currently <strong>${product.stockQuantity}</strong> units on hand.</p>
        <div>
          <label class="field-label">${copy.qtyLabel}</label>
          <input id="f-qty" type="number" min="0" class="input" value="${mode === 'count' ? product.stockQuantity : ''}" autofocus />
        </div>
        <div>
          <label class="field-label">Note ${mode === 'remove' ? '(reason)' : '(optional)'}</label>
          <input id="f-note" type="text" class="input" placeholder="${mode === 'remove' ? 'e.g. Damaged, expired, theft' : ''}" />
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="confirm-stock" type="button">${copy.confirmLabel}</button>
    `,
  });

  el.querySelector('#confirm-stock').addEventListener('click', async () => {
    const qty = Number(el.querySelector('#f-qty').value);
    const note = el.querySelector('#f-note').value.trim();
    if (Number.isNaN(qty) || qty < 0) { toast.danger('Enter a valid quantity.'); return; }

    try {
      if (mode === 'add') {
        await adjustStock({ productId: product.id, delta: qty, type: STOCK_MOVEMENT_TYPES.RESTOCK, channel: CHANNELS.PHYSICAL, note, actor: 'Michael Amos' });
      } else if (mode === 'remove') {
        await adjustStock({ productId: product.id, delta: -qty, type: STOCK_MOVEMENT_TYPES.ADJUSTMENT, channel: CHANNELS.PHYSICAL, note, actor: 'Michael Amos' });
      } else {
        await applyStockCount({ productId: product.id, countedQuantity: qty, actor: 'Michael Amos' });
      }
      toast.success(`${copy.title} recorded.`);
      modal.close();
      refreshTable();
    } catch (err) {
      toast.danger(err.message);
    }
  });
}

// ---------------------------------------------------------------------
// History modal
// ---------------------------------------------------------------------
async function openHistoryModal(product) {
  const entries = await getProductHistory(product.id);
  const rows = entries.length
    ? entries.map((e) => `
        <tr>
          <td class="py-2 pr-4 text-xs text-[var(--text-muted)]">${formatDateTime(e.createdAt)}</td>
          <td class="py-2 pr-4 text-sm">${MOVEMENT_LABEL[e.type] ?? e.type}</td>
          <td class="py-2 pr-4 text-sm font-medium ${e.delta > 0 ? 'text-success-500' : 'text-danger-500'}">${e.delta > 0 ? '+' : ''}${e.delta}</td>
          <td class="py-2 pr-4 text-sm text-[var(--text-secondary)]">${escapeHTML(e.note || e.reference || '—')}</td>
          <td class="py-2 text-sm text-[var(--text-muted)]">${escapeHTML(e.actor)}</td>
        </tr>`).join('')
    : `<tr><td colspan="5" class="py-8 text-center text-sm text-[var(--text-muted)]">No movement recorded yet.</td></tr>`;

  modal.open({
    title: `Inventory History — ${escapeHTML(product.name)}`,
    size: 'lg',
    bodyHTML: `
      <table class="w-full text-left">
        <thead><tr class="text-xs uppercase text-[var(--text-muted)]">
          <th class="pb-2 pr-4">Date</th><th class="pb-2 pr-4">Type</th><th class="pb-2 pr-4">Change</th><th class="pb-2 pr-4">Note / Ref</th><th class="pb-2">Actor</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
    footerHTML: `<button class="btn btn-secondary" data-modal-close type="button">Close</button>`,
  });
}

// ---------------------------------------------------------------------
// Bulk CSV import
// ---------------------------------------------------------------------
async function handleImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';

  const text = await file.text();
  const rows = parseCSV(text);
  if (!rows.length) { toast.danger('That CSV had no rows to import.'); return; }

  const [products, categories] = await Promise.all([api.products.list(), api.categories.list()]);
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    if (!row.name || !row.sku) continue;
    const categoryId = row.category ? categoryByName.get(row.category.toLowerCase()) ?? null : null;
    const stockQuantity = Number(row.stockQuantity) || 0;
    const existing = bySku.get(row.sku);

    if (existing) {
      await api.products.update(existing.id, {
        name: row.name, categoryId,
        costPrice: Number(row.costPrice) || existing.costPrice,
        sellingPrice: Number(row.sellingPrice) || existing.sellingPrice,
        minStock: Number(row.minStock) || existing.minStock,
        maxStock: Number(row.maxStock) || existing.maxStock,
      });
      if (stockQuantity !== existing.stockQuantity) {
        await applyStockCount({ productId: existing.id, countedQuantity: stockQuantity, actor: 'Bulk Import' });
      }
      updated += 1;
    } else {
      const created_ = await api.products.create({
        name: row.name, sku: row.sku, barcode: row.barcode || generateSKU('BC'),
        categoryId, brandId: null, supplierId: null, status: 'active',
        costPrice: Number(row.costPrice) || 0, sellingPrice: Number(row.sellingPrice) || 0, discount: 0,
        stockQuantity: 0, minStock: Number(row.minStock) || 5, maxStock: Number(row.maxStock) || 100,
        images: [], variants: [],
      });
      if (stockQuantity > 0) {
        await adjustStock({ productId: created_.id, delta: stockQuantity, type: STOCK_MOVEMENT_TYPES.ADJUSTMENT, channel: CHANNELS.PHYSICAL, note: 'Bulk import', actor: 'Bulk Import' });
      } else {
        await api.products.update(created_.id, { stockStatus: computeStockStatus({ ...created_, stockQuantity: 0 }) });
      }
      created += 1;
    }
  }

  await api.activityLog.create({ actor: 'Michael Amos', action: 'Bulk imported inventory', target: `${created} created, ${updated} updated` });
  toast.success(`Import complete: ${created} product(s) created, ${updated} updated.`);
  refreshTable();
}
