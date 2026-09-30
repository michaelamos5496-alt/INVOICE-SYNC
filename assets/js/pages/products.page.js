/**
 * products.page.js — controller for pages/products.html. Wires the
 * catalog data table, filter bar, and the add/edit product modal
 * (tabs: Details, Pricing & Stock, Variants, Images).
 *
 * Kept out of the page's inline <script> because the product form is
 * the most stateful piece of UI in Phase 4 — variant rows and product
 * photos are local, mutable lists the modal re-renders on every add/remove,
 * which reads a lot more clearly as a module than as one giant template
 * literal in an HTML file.
 */
import { watchData } from '../services/live-data.js';
import { getActorName } from '../services/auth.service.js';
import { api } from '../services/api.service.js';
import {
  listProducts, createProduct, updateProduct, deleteProduct, duplicateProduct,
  generateBarcode, generateSKU, variantLabel, generateVariants, upgradeLegacyVariants, MAX_OPTIONS, MAX_VARIANTS,
} from '../services/products.service.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { initTabs } from '../components/tabs.js';
import { initDropdown } from '../components/dropdown.js';
import { formatCurrency } from '../utils/formatters.js';
import { getCurrency } from '../services/settings.service.js';
import { debounce, escapeHTML, isSafeImageUrl } from '../utils/helpers.js';
import { compressImage } from '../utils/image-compress.js';
import { saveImage, deleteImages, isStoredRef, imageTagHTML, hydrateImages } from '../services/image-store.service.js';

const STATUS_BADGE = {
  active: 'badge-success',
  draft: 'badge-neutral',
  archived: 'badge-danger',
};

const STOCK_BADGE = {
  in_stock: { cls: 'badge-success', label: 'In Stock' },
  low_stock: { cls: 'badge-warning', label: 'Low Stock' },
  out_of_stock: { cls: 'badge-danger', label: 'Out of Stock' },
};

let table;
let lookups = { categories: [], brands: [], suppliers: [], warehouses: [] };
let variantState = [];
let openGroups = new Set(); // option-1 values whose group is expanded in the variant table
let groupByIdx = 0;
let selectedVariants = new Set(); // indexes ticked for bulk edit
let optionsState = []; // [{ name, values[], editing }] — Shopify-style options; variantState is generated from them
let editingProduct = null; // the product open in the form (null when adding), so stock can follow its variants

const variantUnits = (variants) => variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);

/**
 * The stock quantity a product should have given its variant rows. Variants own the stock split: with none,
 * the typed quantity stands; the first time variants are added, their total becomes the stock; after that,
 * edits to variant stock move the product's stock by the same amount (so sales made since don't get overwritten).
 */
function stockFromVariants(typedQuantity) {
  if (!variantState.length) return typedQuantity;
  const before = editingProduct?.variants ?? [];
  if (!before.length) return variantUnits(variantState);
  return Math.max(0, (editingProduct.stockQuantity ?? 0) + variantUnits(variantState) - variantUnits(before));
}

/** With variants, the Stock Quantity field is derived from them, so it's shown read-only and kept in step. */
function syncStockField() {
  const input = document.getElementById('f-stock');
  if (!input) return;
  const hasVariants = variantState.length > 0;
  input.readOnly = hasVariants;
  if (hasVariants) input.value = stockFromVariants(0);
  const hint = document.getElementById('f-stock-hint');
  if (hint) hint.hidden = !hasVariants;
}
let imageState = [];

export async function initProductsPage() {
  await reloadLookups();

  populateFilterOptions();
  buildTable();
  await refreshTable();

  // Live: another device adds/changes products or the lists they belong to.
  watchData(['products'], refreshTable);
  watchData(['categories', 'brands', 'suppliers', 'warehouses'], async () => { await reloadLookups(); populateFilterOptions(); await refreshTable(); });

  document.getElementById('add-product-btn').addEventListener('click', () => openProductModal());
  document.getElementById('product-search').addEventListener('input', debounce((e) => table.setSearchTerm(e.target.value), 200));
  document.getElementById('filter-category').addEventListener('change', refreshTable);
  document.getElementById('filter-status').addEventListener('change', refreshTable);
  document.getElementById('clear-filters').addEventListener('click', () => {
    document.getElementById('product-search').value = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-status').value = '';
    table.setSearchTerm('');
    refreshTable();
  });
}

async function reloadLookups() {
  const [categories, brands, suppliers, warehouses] = await Promise.all([
    api.categories.list(), api.brands.list(), api.suppliers.list(), api.warehouses.list(),
  ]);
  lookups = { categories, brands, suppliers, warehouses };
}

function populateFilterOptions() {
  const categorySelect = document.getElementById('filter-category');
  const selected = categorySelect.value; // a live refresh must not reset what the user picked
  categorySelect.innerHTML = '<option value="">All Categories</option>' +
    lookups.categories.map((c) => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
  categorySelect.value = selected;
}

function lookupName(list, id) {
  return escapeHTML(list.find((item) => item.id === id)?.name ?? '—');
}

function buildTable() {
  table = new DataTable(document.getElementById('products-table'), {
    columns: [
      {
        key: 'name', label: 'Product', sortable: true,
        render: (row) => `
          <div class="flex items-center gap-3">
            <span class="w-10 h-10 rounded-lg bg-[var(--surface-sunken)] grid place-items-center shrink-0 overflow-hidden">
              ${imageTagHTML(row.images?.[0], { className: 'w-full h-full object-cover' })}
            </span>
            <div class="min-w-0">
              <p class="text-sm font-medium truncate max-w-[14rem]">${escapeHTML(row.name)}</p>
              <p class="text-xs text-[var(--text-muted)] font-mono">${escapeHTML(row.sku)}</p>
            </div>
          </div>`,
      },
      { key: 'categoryId', label: 'Category', render: (row) => lookupName(lookups.categories, row.categoryId) },
      { key: 'brandId', label: 'Brand', render: (row) => lookupName(lookups.brands, row.brandId) },
      {
        key: 'stockQuantity', label: 'Stock', sortable: true, align: 'right',
        render: (row) => {
          const badge = STOCK_BADGE[row.stockStatus] ?? STOCK_BADGE.in_stock;
          return `<div class="text-right"><span class="font-medium">${row.stockQuantity}</span><br/><span class="badge ${badge.cls} mt-1"><span class="badge-dot"></span>${badge.label}</span></div>`;
        },
      },
      {
        key: 'sellingPrice', label: 'Price', sortable: true, align: 'right',
        render: (row) => row.discount
          ? `<span class="font-medium">${formatCurrency(row.sellingPrice * (1 - row.discount / 100))}</span> <span class="text-xs text-[var(--text-muted)] line-through">${formatCurrency(row.sellingPrice)}</span>`
          : `<span class="font-medium">${formatCurrency(row.sellingPrice)}</span>`,
      },
      {
        key: 'status', label: 'Status',
        render: (row) => `<span class="badge ${STATUS_BADGE[row.status] ?? 'badge-neutral'}">${row.status}</span>`,
      },
      {
        key: 'actions', label: '',
        render: (row) => `<button class="btn btn-ghost btn-sm" data-row-actions="${row.id}" aria-label="Row actions"><i class="fa-solid fa-ellipsis"></i></button>`,
      },
    ],
    pageSize: 8,
    onRender: (tbody) => { hydrateImages(tbody); wireRowActions(); }, // row menus must be re-attached every time the rows are redrawn (paging, sorting, live updates)
    searchKeys: ['name', 'sku', 'barcode'],
    rowKey: (row) => row.id,
    defaultSort: { key: 'name', dir: 'asc' },
    emptyState: {
      icon: 'fa-box-open', title: 'No products yet',
      message: 'Add your first product to start tracking inventory across both channels.',
      actionLabel: 'Add Product', onAction: () => openProductModal(),
    },
  });
}

async function refreshTable() {
  table.setLoading();
  const categoryFilter = document.getElementById('filter-category').value;
  const statusFilter = document.getElementById('filter-status').value;

  let products = await listProducts();
  if (categoryFilter) products = products.filter((p) => p.categoryId === categoryFilter);
  if (statusFilter) products = products.filter((p) => p.status === statusFilter);

  table.setData(products);
}

function wireRowActions() {
  document.querySelectorAll('[data-row-actions]').forEach((btn) => {
    const productId = btn.dataset.rowActions;
    initDropdown(btn, [
      { label: 'Edit', icon: 'fa-pen', onClick: async () => openProductModal(await api.products.get(productId)) },
      { label: 'Duplicate', icon: 'fa-copy', onClick: async () => { await duplicateProduct(productId, getActorName()); toast.success('Product duplicated.'); refreshTable(); } },
      { divider: true },
      {
        label: 'Delete', icon: 'fa-trash', danger: true,
        onClick: async () => {
          const ok = await modal.confirm({ title: 'Delete product?', message: 'This removes it from the shared catalog permanently. This cannot be undone.' });
          if (!ok) return;
          await deleteProduct(productId, getActorName());
          toast.success('Product deleted.');
          refreshTable();
        },
      },
    ]);
  });
}

// ---------------------------------------------------------------------
// Add / Edit modal
// ---------------------------------------------------------------------
function selectOptions(list, selectedId) {
  return '<option value="">— None —</option>' +
    list.map((item) => `<option value="${item.id}" ${item.id === selectedId ? 'selected' : ''}>${escapeHTML(item.name)}</option>`).join('');
}

// One-tap value sets for a fashion store, offered under the option they belong to.
const SIZE_PRESETS = [
  { label: 'Clothing XS–XXL', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { label: 'Clothing S–3XL', values: ['S', 'M', 'L', 'XL', 'XXL', '3XL'] },
  { label: 'Numeric 6–18', values: ['6', '8', '10', '12', '14', '16', '18'] },
  { label: 'Waist 28–40', values: ['28', '30', '32', '34', '36', '38', '40'] },
  { label: 'Shoes EU 36–46', values: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'] },
  { label: 'Shoes UK 3–12', values: ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] },
  { label: 'Kids 2–14', values: ['2', '3', '4', '5', '6', '7', '8', '10', '12', '14'] },
  { label: 'Baby 0–24m', values: ['0-3M', '3-6M', '6-12M', '12-18M', '18-24M'] },
  { label: 'One size', values: ['One Size'] },
];
const COLOR_PRESETS = ['Black', 'White', 'Navy', 'Grey', 'Beige', 'Brown', 'Red', 'Pink', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Cream', 'Gold', 'Multicolor'];
const MATERIAL_PRESETS = ['Cotton', 'Linen', 'Denim', 'Silk', 'Wool', 'Polyester', 'Leather', 'Ankara', 'Kente'];
const FIT_PRESETS = ['Slim', 'Regular', 'Relaxed', 'Oversized'];

function presetsFor(name) {
  const n = name.trim().toLowerCase();
  if (n === 'size') return SIZE_PRESETS.map((p) => ({ label: p.label, values: p.values, set: true }));
  const list = n === 'color' || n === 'colour' ? COLOR_PRESETS : n === 'material' ? MATERIAL_PRESETS : n === 'fit' ? FIT_PRESETS : [];
  return list.map((v) => ({ label: v, values: [v] }));
}

/** Rebuilds the variant list from the options, keeping what was already typed for combinations that still exist. */
function regenerateVariants() {
  const price = Number(document.getElementById('f-price')?.value) || 0;
  variantState = generateVariants(optionsState.map((o) => ({ name: o.name, values: o.values })), variantState, price);
  selectedVariants = new Set();
  syncStockField();
}

function renderVariantEditor() {
  renderOptionsEditor();
  renderVariantTable();
}

const OPTION_NAMES = ['Size', 'Color', 'Material', 'Style', 'Title'];

function renderOptionsEditor() {
  const box = document.getElementById('variant-options');
  if (!box) return;
  const nameTaken = (name, except) => optionsState.some((o, k) => k !== except && o.name.trim().toLowerCase() === name.trim().toLowerCase());

  box.innerHTML = optionsState.map((o, i) => {
    if (!o.editing) {
      return `<div class="variant-card"><button type="button" class="w-full text-left" data-edit-option="${i}" aria-label="Edit option ${escapeHTML(o.name)}">
        <p class="text-sm font-semibold">${escapeHTML(o.name)}</p>
        <div class="flex flex-wrap gap-1.5 mt-1.5">${o.values.map((v) => `<span class="badge badge-neutral">${escapeHTML(v)}</span>`).join('')}</div></button></div>`;
    }
    const isCustom = o.custom || (o.name && !OPTION_NAMES.includes(o.name));
    const choices = OPTION_NAMES.filter((n) => n === o.name || !nameTaken(n, i));
    const rows = [...o.values.map((v) => v), ''];
    return `
      <fieldset class="variant-card space-y-3" data-option="${i}">
        <legend class="sr-only">Option ${i + 1}</legend>
        <div>
          <label class="field-label" for="opt-${i}-name">Option name</label>
          <select id="opt-${i}-name" class="input" data-opt-select>
            ${choices.map((n) => `<option value="${n}" ${!isCustom && n === o.name ? 'selected' : ''}>${n}</option>`).join('')}
            <option value="__custom" ${isCustom ? 'selected' : ''}>Create your own</option>
          </select>
          ${isCustom ? `<input class="input mt-2" value="${escapeHTML(o.name)}" placeholder="Option name, e.g. Length" aria-label="Custom option name" data-opt-custom />` : ''}
        </div>
        <div>
          <p class="field-label">Option values</p>
          <div class="space-y-1.5" data-values>
            ${rows.map((v, j) => `
              <div class="flex items-center gap-2" data-value-row="${j}" ${j < o.values.length ? 'draggable="true"' : ''}>
                <span class="text-[var(--text-muted)] w-4 text-center ${j < o.values.length ? 'cursor-grab' : 'opacity-0'}" aria-hidden="true"><i class="fa-solid fa-grip-vertical"></i></span>
                <input class="input flex-1" value="${escapeHTML(v)}" placeholder="${j < o.values.length ? '' : 'Add another value'}" aria-label="Option value ${j + 1}" data-opt-value="${j}" />
                ${j < o.values.length ? `<button type="button" class="btn btn-ghost btn-sm" data-del-value="${j}" aria-label="Delete ${escapeHTML(v)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>` : '<span class="w-9"></span>'}
              </div>`).join('')}
          </div>
        </div>
        ${presetsFor(o.name).length ? `<div>
          <p class="field-hint mb-1.5">Quick add</p>
          <div class="flex flex-wrap gap-1.5">${presetsFor(o.name).map((pr, k) => `<button type="button" class="btn btn-secondary btn-sm" data-preset="${k}">${pr.set ? '<i class="fa-solid fa-plus" aria-hidden="true"></i> ' : ''}${escapeHTML(pr.label)}</button>`).join('')}</div>
        </div>` : ''}
        <div class="flex items-center justify-between">
          <button type="button" class="btn btn-secondary btn-sm text-[var(--color-danger-600)]" data-del-option="${i}">Delete</button>
          <button type="button" class="btn btn-primary btn-sm" data-done-option="${i}">Done</button>
        </div>
      </fieldset>`;
  }).join('');

  const addBtn = document.getElementById('add-option');
  addBtn.hidden = optionsState.length >= MAX_OPTIONS;
  addBtn.disabled = optionsState.some((o) => o.editing);
  addBtn.innerHTML = optionsState.length
    ? '<i class="fa-solid fa-circle-plus"></i> Add another option'
    : '<i class="fa-solid fa-circle-plus"></i> Add options like size or color';

  box.querySelectorAll('[data-edit-option]').forEach((btn) => btn.addEventListener('click', () => {
    optionsState.forEach((o) => { o.editing = false; });
    optionsState[Number(btn.dataset.editOption)].editing = true;
    renderOptionsEditor();
  }));

  box.querySelectorAll('[data-option]').forEach((fs) => {
    const i = Number(fs.dataset.option);
    const o = optionsState[i];
    const redrawKeeping = (selector) => { renderOptionsEditor(); document.querySelector(`[data-option="${i}"] ${selector}`)?.focus(); };

    fs.querySelector('[data-opt-select]').addEventListener('change', (e) => {
      if (e.target.value === '__custom') { o.custom = true; o.name = ''; redrawKeeping('[data-opt-custom]'); }
      else { o.custom = false; o.name = e.target.value; renderOptionsEditor(); }
    });
    fs.querySelector('[data-opt-custom]')?.addEventListener('input', (e) => { o.name = e.target.value; });
    fs.querySelector('[data-opt-custom]')?.addEventListener('change', () => renderOptionsEditor());

    // One field per value. Typing in the last (empty) row adds the next empty row, like Shopify.
    fs.querySelectorAll('[data-opt-value]').forEach((input) => {
      const j = Number(input.dataset.optValue);
      input.addEventListener('input', () => {
        const isNew = j >= o.values.length;
        if (isNew) {
          if (!input.value.trim()) return;
          o.values.push(input.value);
          renderOptionsEditor();
          const el = document.querySelector(`[data-option="${i}"] [data-opt-value="${j}"]`);
          el?.focus(); el?.setSelectionRange(el.value.length, el.value.length);
        } else o.values[j] = input.value;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); document.querySelector(`[data-option="${i}"] [data-opt-value="${j + 1}"]`)?.focus(); }
      });
    });
    fs.querySelectorAll('[data-del-value]').forEach((btn) => btn.addEventListener('click', () => {
      o.values.splice(Number(btn.dataset.delValue), 1);
      renderOptionsEditor();
    }));
    // Drag to reorder the values.
    let dragFrom = null;
    fs.querySelectorAll('[data-value-row][draggable]').forEach((row) => {
      row.addEventListener('dragstart', () => { dragFrom = Number(row.dataset.valueRow); });
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const to = Number(row.dataset.valueRow);
        if (dragFrom === null || dragFrom === to) return;
        const [moved] = o.values.splice(dragFrom, 1);
        o.values.splice(to, 0, moved);
        renderOptionsEditor();
      });
    });
    fs.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click', () => {
      const preset = presetsFor(o.name)[Number(btn.dataset.preset)];
      if (preset.set) o.values = [...preset.values];
      else preset.values.forEach((v) => { if (!o.values.some((x) => x.toLowerCase() === v.toLowerCase())) o.values.push(v); });
      renderOptionsEditor();
    }));
    fs.querySelector('[data-del-option]').addEventListener('click', () => {
      optionsState.splice(i, 1);
      regenerateVariants();
      renderVariantEditor();
    });
    fs.querySelector('[data-done-option]').addEventListener('click', () => {
      o.name = o.name.trim();
      o.values = [...new Map(o.values.map((v) => v.trim()).filter(Boolean).map((v) => [v.toLowerCase(), v])).values()];
      if (!o.name) { toast.danger('Give this option a name.'); return; }
      if (nameTaken(o.name, i)) { toast.danger('Two options can\'t have the same name.'); return; }
      if (!o.values.length) { toast.danger('Add at least one option value.'); return; }
      const before = variantState;
      o.editing = false;
      regenerateVariants();
      if (variantState.length > MAX_VARIANTS) {
        variantState = before; o.editing = true;
        toast.danger(`That would make more than ${MAX_VARIANTS} variants. Remove some values.`);
        renderOptionsEditor(); return;
      }
      openGroups = new Set();
      renderVariantEditor();
    });
  });
}

function renderVariantTable() {
  const container = document.getElementById('variant-rows');
  if (!container) return;
  const committed = optionsState.filter((o) => !o.editing);
  if (!variantState.length) { container.innerHTML = ''; syncStockField(); return; }

  const cur = getCurrency();
  const grouped = committed.length > 1;
  groupByIdx = Math.min(groupByIdx, committed.length - 1);
  const gk = `option${groupByIdx + 1}`;
  const money = (n) => formatCurrency(n);
  const priceRange = (list) => {
    const ps = list.map((v) => Number(v.price) || 0);
    const lo = Math.min(...ps); const hi = Math.max(...ps);
    return lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`;
  };
  const cell = (i, key, label, extra = '') =>
    `<input class="input input-sm ${extra}" ${['price', 'stock'].includes(key) ? 'type="number" step="any" inputmode="decimal" min="0"' : 'type="text"'} value="${escapeHTML(variantState[i][key] ?? '')}" data-vfield="${key}" data-vidx="${i}" aria-label="${label} for ${escapeHTML(variantState[i].title)}" />`;
  const variantRow = (v, i, name, indent) => `<tr data-vrow="${i}">
      <td class="pl-3 py-2 w-8"><input type="checkbox" data-vselect="${i}" ${selectedVariants.has(i) ? 'checked' : ''} aria-label="Select ${escapeHTML(v.title)}" /></td>
      <td class="py-2 pr-3 text-sm font-medium whitespace-nowrap ${indent ? 'pl-6' : ''}">${escapeHTML(name)}</td>
      <td class="px-2 py-1.5 w-32"><div class="relative"><span class="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] pointer-events-none">${escapeHTML(cur)}</span>${cell(i, 'price', 'Price', 'pl-10')}</div></td>
      <td class="px-2 py-1.5 w-28">${cell(i, 'stock', 'Available')}</td>
      <td class="px-2 py-1.5 w-40">${cell(i, 'sku', 'SKU', 'font-mono')}</td>
      <td class="px-2 py-1.5 w-44">${cell(i, 'barcode', 'Barcode', 'font-mono')}</td>
    </tr>`;

  const rows = [];
  if (grouped) {
    const groups = new Map();
    variantState.forEach((v, i) => { if (!groups.has(v[gk])) groups.set(v[gk], []); groups.get(v[gk]).push(i); });
    for (const [label, idxs] of groups) {
      const list = idxs.map((i) => variantState[i]);
      const open = openGroups.has(label);
      const allSel = idxs.every((i) => selectedVariants.has(i));
      const some = idxs.some((i) => selectedVariants.has(i));
      rows.push(`<tr class="bg-[var(--surface-sunken)]">
        <td class="pl-3 py-2 w-8"><input type="checkbox" data-gselect="${escapeHTML(label)}" ${allSel ? 'checked' : ''} ${some && !allSel ? 'data-indeterminate="1"' : ''} aria-label="Select all ${escapeHTML(label)} variants" /></td>
        <td class="py-2 pr-3 text-sm"><button type="button" class="flex items-center gap-2 text-left" data-gtoggle="${escapeHTML(label)}" aria-expanded="${open}"><i class="fa-solid fa-chevron-${open ? 'down' : 'right'} text-xs text-[var(--text-muted)]" aria-hidden="true"></i><span class="font-semibold">${escapeHTML(label)}</span><span class="text-[var(--text-muted)]">${list.length} variant${list.length === 1 ? '' : 's'}</span></button></td>
        <td class="px-2 py-2 text-sm">${priceRange(list)}</td>
        <td class="px-2 py-2 text-sm">${list.reduce((s, v) => s + (Number(v.stock) || 0), 0)} available</td>
        <td colspan="2"></td></tr>`);
      if (open) idxs.forEach((i) => rows.push(variantRow(variantState[i], i, ['option1', 'option2', 'option3'].filter((k) => k !== gk).map((k) => variantState[i][k]).filter(Boolean).join(' / '), true)));
    }
  } else {
    variantState.forEach((v, i) => rows.push(variantRow(v, i, v.title, false)));
  }

  const nSel = selectedVariants.size;
  const allChecked = nSel === variantState.length;
  container.innerHTML = `
    <div class="border rounded-[var(--radius-md)] overflow-hidden" style="border-color: var(--border-subtle)">
      <div class="flex flex-wrap items-center gap-2 px-3 py-2 border-b" style="border-color: var(--border-subtle)">
        ${nSel ? `
          <span class="text-sm font-semibold">${nSel} selected</span>
          <select id="bulk-field" class="input input-sm w-auto" aria-label="Bulk edit action">
            <option value="price">Edit prices — set to</option>
            <option value="priceChange">Edit prices — change by %</option>
            <option value="stock">Edit quantities — set to</option>
            <option value="addStock">Edit quantities — add / remove</option>
            <option value="sku">Set SKU prefix</option>
          </select>
          <input id="bulk-value" class="input input-sm w-28" inputmode="decimal" placeholder="Value" aria-label="Bulk edit value" />
          <button type="button" class="btn btn-secondary btn-sm" id="bulk-apply">Apply</button>
          <button type="button" class="btn btn-secondary btn-sm text-[var(--color-danger-600)]" id="bulk-delete">Delete variants</button>
        ` : `
          <span class="text-sm font-semibold mr-auto">${variantState.length} variant${variantState.length === 1 ? '' : 's'}</span>
          ${grouped ? `<label class="text-sm flex items-center gap-2">Group by <select id="group-by" class="input input-sm w-auto">${committed.map((o, k) => `<option value="${k}" ${k === groupByIdx ? 'selected' : ''}>${escapeHTML(o.name)}</option>`).join('')}</select></label>` : ''}
        `}
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead><tr class="text-xs text-[var(--text-muted)]">
            <th class="pl-3 py-2 w-8"><input type="checkbox" id="vselect-all" ${allChecked ? 'checked' : ''} aria-label="Select all variants" /></th>
            <th class="px-3 py-2 font-medium">Variant</th><th class="px-2 py-2 font-medium">Price</th><th class="px-2 py-2 font-medium">Available</th><th class="px-2 py-2 font-medium">SKU</th><th class="px-2 py-2 font-medium">Barcode</th>
          </tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    </div>`;

  container.querySelectorAll('[data-indeterminate]').forEach((el) => { el.indeterminate = true; });
  container.querySelectorAll('[data-vfield]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.vfield;
      variantState[Number(input.dataset.vidx)][key] = ['price', 'stock'].includes(key) ? Number(input.value) : input.value;
      if (key === 'stock') syncStockField();
    });
    if (input.dataset.vfield === 'stock') input.addEventListener('change', renderVariantTable); // refresh group totals
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      container.querySelector(`[data-vfield="${input.dataset.vfield}"][data-vidx="${Number(input.dataset.vidx) + 1}"]`)?.focus();
    });
  });
  container.querySelectorAll('[data-vselect]').forEach((box) => box.addEventListener('change', () => {
    const i = Number(box.dataset.vselect);
    if (box.checked) selectedVariants.add(i); else selectedVariants.delete(i);
    renderVariantTable();
  }));
  container.querySelectorAll('[data-gselect]').forEach((box) => box.addEventListener('change', () => {
    variantState.forEach((v, i) => { if (v[gk] === box.dataset.gselect) { if (box.checked) selectedVariants.add(i); else selectedVariants.delete(i); } });
    renderVariantTable();
  }));
  container.querySelectorAll('[data-gtoggle]').forEach((btn) => btn.addEventListener('click', () => {
    const label = btn.dataset.gtoggle;
    if (openGroups.has(label)) openGroups.delete(label); else openGroups.add(label);
    renderVariantTable();
  }));
  container.querySelector('#vselect-all').addEventListener('change', (e) => {
    selectedVariants = e.target.checked ? new Set(variantState.map((_, i) => i)) : new Set();
    renderVariantTable();
  });
  container.querySelector('#group-by')?.addEventListener('change', (e) => { groupByIdx = Number(e.target.value); openGroups = new Set(); renderVariantTable(); });

  container.querySelector('#bulk-apply')?.addEventListener('click', () => {
    const field = container.querySelector('#bulk-field').value;
    const raw = container.querySelector('#bulk-value').value.trim();
    const num = Number(raw);
    if (raw === '' || (field !== 'sku' && Number.isNaN(num))) { toast.danger('Enter a value to apply.'); return; }
    if (['price', 'stock'].includes(field) && num < 0) { toast.danger('That can\'t be negative.'); return; }
    for (const i of selectedVariants) {
      const v = variantState[i];
      if (field === 'price') v.price = num;
      else if (field === 'stock') v.stock = Math.floor(num);
      else if (field === 'addStock') v.stock = Math.max(0, (Number(v.stock) || 0) + Math.floor(num));
      else if (field === 'priceChange') v.price = Math.max(0, Number(((Number(v.price) || 0) * (1 + num / 100)).toFixed(2)));
      else if (field === 'sku') v.sku = `${raw}-${[v.option1, v.option2, v.option3].filter(Boolean).join('-').replace(/[^A-Za-z0-9]+/g, '').toUpperCase()}`;
    }
    toast.success(`Updated ${selectedVariants.size} variant${selectedVariants.size === 1 ? '' : 's'}.`);
    renderVariantTable();
  });
  container.querySelector('#bulk-delete')?.addEventListener('click', () => {
    if (!window.confirm(`Delete ${selectedVariants.size} variant${selectedVariants.size === 1 ? '' : 's'}?`)) return;
    variantState = variantState.filter((_, i) => !selectedVariants.has(i));
    selectedVariants = new Set();
    // Drop option values that no variant uses any more; an option with no values goes too.
    optionsState = optionsState
      .map((o, k) => ({ ...o, values: o.values.filter((val) => variantState.some((v) => v[`option${k + 1}`] === val)) }))
      .filter((o) => o.values.length);
    if (!variantState.length) optionsState = [];
    renderVariantEditor();
  });
  syncStockField();
}

const MAX_IMAGES = 6;

/**
 * imageState holds one entry per photo, in display order (index 0 is the
 * "main" photo shown in the catalog and POS):
 *   - string                      an existing photo ref (idb:…, http(s) URL, or data URL)
 *   - { blob, previewUrl, name }  a photo picked in this form, compressed but not saved yet —
 *                                 it only reaches storage when the product is saved, so
 *                                 cancelling the form leaves nothing behind
 *   - { processing, name, file }  a placeholder while a picked photo is being resized
 */
const revokePreview = (entry) => { if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl); };

function buildImageTile(entry, index) {
  const tile = document.createElement('div');
  tile.className = 'image-tile';

  if (entry.processing) {
    tile.classList.add('image-tile--busy');
    tile.setAttribute('aria-busy', 'true');
    tile.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-[var(--text-muted)]" aria-hidden="true"></i><span class="sr-only">Processing photo</span>';
    return tile;
  }

  const img = document.createElement('img');
  img.className = 'image-tile__img';
  img.alt = `Product photo ${index + 1}`;
  if (typeof entry !== 'string') img.src = entry.previewUrl;
  else if (isStoredRef(entry)) { img.dataset.imgRef = entry; img.dataset.imgFallback = 'fa-solid fa-image text-[var(--text-muted)]'; }
  else if (isSafeImageUrl(entry)) img.src = entry;
  img.addEventListener('error', () => { img.removeAttribute('src'); tile.classList.add('image-tile--broken'); });
  tile.append(img);

  const button = (className, label, icon, onClick) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `image-tile__btn ${className}`;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`;
    btn.addEventListener('click', onClick);
    return btn;
  };

  tile.append(button('image-tile__remove', `Remove photo ${index + 1}`, 'fa-xmark', () => {
    revokePreview(entry);
    imageState.splice(index, 1);
    renderImageGrid();
  }));

  if (index === 0) {
    const badge = document.createElement('span');
    badge.className = 'image-tile__badge';
    badge.textContent = 'Main';
    tile.append(badge);
  } else {
    tile.append(button('image-tile__star', `Make photo ${index + 1} the main photo`, 'fa-star', () => {
      imageState.unshift(...imageState.splice(index, 1));
      renderImageGrid();
    }));
  }
  return tile;
}

function renderImageGrid() {
  const container = document.getElementById('image-grid');
  if (!container) return;
  container.replaceChildren(...imageState.map(buildImageTile));
  hydrateImages(container);

  const counter = document.getElementById('image-counter');
  if (counter) counter.textContent = imageState.length ? `${imageState.length} of ${MAX_IMAGES} photos` : '';
  document.getElementById('image-dropzone')?.classList.toggle('is-disabled', imageState.length >= MAX_IMAGES);
}

/** Validates, then resizes photos one at a time (a batch of 12-megapixel phone shots decoded together can exhaust a phone's memory). */
async function addImageFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  const room = MAX_IMAGES - imageState.length;
  if (room <= 0) { toast.warning(`A product can have up to ${MAX_IMAGES} photos. Remove one to add another.`); return; }
  if (files.length > room) toast.warning(`Only the first ${room} photo${room === 1 ? ' was' : 's were'} added — the limit is ${MAX_IMAGES} per product.`);

  const jobs = files.slice(0, room).map((file) => ({ processing: true, name: file.name, file }));
  imageState.push(...jobs);
  renderImageGrid();

  for (const job of jobs) {
    let result = null;
    try {
      result = await compressImage(job.file);
    } catch (err) {
      toast.danger(`${job.name || 'Photo'}: ${err.message}`);
    }
    // The form may have been closed/reopened meanwhile; imageState is then a different array and the job is gone.
    const at = imageState.indexOf(job);
    if (at !== -1) {
      if (result) imageState[at] = { blob: result.blob, previewUrl: URL.createObjectURL(result.blob), name: job.name };
      else imageState.splice(at, 1);
      renderImageGrid();
    }
  }
}

function buildFormHTML(product) {
  const p = product ?? {};
  return `
    <div id="product-tabs">
      <div class="tabs-list mb-5">
        <button class="tab-btn active" data-tab="details" type="button">Details</button>
        <button class="tab-btn" data-tab="pricing" type="button">Pricing &amp; Stock</button>
        <button class="tab-btn" data-tab="variants" type="button">Variants</button>
        <button class="tab-btn" data-tab="images" type="button">Images</button>
      </div>

      <div data-tab-panel="details" class="space-y-4">
        <div class="grid sm:grid-cols-2 gap-4">
          <div class="sm:col-span-2">
            <label class="field-label">Product Name *</label>
            <input id="f-name" class="input" value="${escapeHTML(p.name ?? '')}" required />
          </div>
          <div>
            <label class="field-label">SKU *</label>
            <div class="flex gap-2">
              <input id="f-sku" class="input font-mono" value="${escapeHTML(p.sku ?? '')}" required />
              <button type="button" id="f-sku-gen" class="btn btn-secondary btn-sm shrink-0">Generate</button>
            </div>
          </div>
          <div>
            <label class="field-label">Barcode</label>
            <div class="flex gap-2">
              <input id="f-barcode" class="input font-mono" value="${escapeHTML(p.barcode ?? '')}" />
              <button type="button" id="f-barcode-gen" class="btn btn-secondary btn-sm shrink-0">Generate</button>
            </div>
          </div>
          <div>
            <label class="field-label">Category</label>
            <select id="f-category" class="select">${selectOptions(lookups.categories, p.categoryId)}</select>
          </div>
          <div>
            <label class="field-label">Brand</label>
            <select id="f-brand" class="select">${selectOptions(lookups.brands, p.brandId)}</select>
          </div>
          <div>
            <label class="field-label">Supplier</label>
            <select id="f-supplier" class="select">${selectOptions(lookups.suppliers, p.supplierId)}</select>
          </div>
          <div>
            <label class="field-label">Status</label>
            <select id="f-status" class="select">
              ${['active', 'draft', 'archived'].map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s[0].toUpperCase()}${s.slice(1)}</option>`).join('')}
            </select>
          </div>
          <div class="sm:col-span-2">
            <label class="field-label">Description</label>
            <textarea id="f-description" class="textarea">${escapeHTML(p.description ?? '')}</textarea>
          </div>
          <div>
            <label class="field-label">Color</label>
            <input id="f-color" class="input" value="${escapeHTML(p.color ?? '')}" />
          </div>
          <div>
            <label class="field-label">Size</label>
            <input id="f-size" class="input" value="${escapeHTML(p.size ?? '')}" />
          </div>
          <div>
            <label class="field-label">Weight</label>
            <input id="f-weight" class="input" value="${escapeHTML(p.weight ?? '')}" placeholder="e.g. 250g" />
          </div>
          <div>
            <label class="field-label">Location</label>
            <select id="f-location" class="select">${selectOptions(lookups.warehouses, p.location)}</select>
          </div>
          <div>
            <label class="field-label">Batch Number</label>
            <input id="f-batch" class="input" value="${escapeHTML(p.batchNumber ?? '')}" />
          </div>
          <div>
            <label class="field-label">Expiration Date <span class="text-[var(--text-muted)] font-normal">(optional)</span></label>
            <input id="f-expiry" type="date" class="input" value="${p.expirationDate ?? ''}" />
          </div>
        </div>
      </div>

      <div data-tab-panel="pricing" class="hidden space-y-4">
        <div class="grid sm:grid-cols-3 gap-4">
          <div>
            <label class="field-label">Selling Price *</label>
            <input id="f-price" type="number" step="0.01" min="0" class="input" value="${p.sellingPrice ?? ''}" required />
          </div>
          <div>
            <label class="field-label">Discount %</label>
            <input id="f-discount" type="number" step="1" min="0" max="100" class="input" value="${p.discount ?? 0}" />
          </div>
          <div>
            <label class="field-label">Stock Quantity</label>
            <input id="f-stock" type="number" min="0" class="input" value="${p.stockQuantity ?? 0}" />
            <p class="field-hint">${product ? 'Changing this logs a stock count adjustment.' : 'Sets the starting quantity on creation.'}</p>
            <p id="f-stock-hint" class="field-hint" hidden>Worked out from your variants' stock — change it on the Variants tab.</p>
          </div>
          <div>
            <label class="field-label">Minimum Stock</label>
            <input id="f-min-stock" type="number" min="0" class="input" value="${p.minStock ?? 5}" />
          </div>
          <div>
            <label class="field-label">Maximum Stock</label>
            <input id="f-max-stock" type="number" min="0" class="input" value="${p.maxStock ?? 100}" />
          </div>
        </div>
      </div>

      <div data-tab-panel="variants" class="hidden space-y-3">
        <p class="text-sm text-[var(--text-secondary)]">Add options like size or color if this product comes in more than one version.</p>
        <div id="variant-options" class="space-y-3"></div>
        <button type="button" id="add-option" class="btn btn-secondary btn-sm"><i class="fa-solid fa-circle-plus"></i> Add options like size or color</button>
        <div id="variant-rows"></div>
      </div>

      <div data-tab-panel="images" class="hidden space-y-4">
        <label id="image-dropzone" class="dropzone" for="f-image-files">
          <input id="f-image-files" type="file" accept="image/*" multiple class="sr-only" />
          <span class="dropzone__icon"><i class="fa-solid fa-camera" aria-hidden="true"></i></span>
          <span class="font-semibold text-sm text-[var(--text-primary)]">Choose photos</span>
          <span class="text-xs">Take a picture or pick from your gallery — or drag and drop here</span>
          <span class="text-xs text-[var(--text-muted)]">JPG, PNG or WebP · up to ${MAX_IMAGES} photos</span>
        </label>

        <div class="flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
          <span>The first photo is the main one shown in the catalog and at the POS. Tap <i class="fa-solid fa-star" aria-hidden="true"></i> to change it.</span>
          <span id="image-counter" class="shrink-0 font-medium" aria-live="polite"></span>
        </div>

        <div id="image-grid" class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3"></div>

        <details class="text-sm">
          <summary class="cursor-pointer font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Add a photo from a web link instead</summary>
          <div class="flex gap-2 mt-3">
            <input id="f-image-url" class="input" type="url" inputmode="url" placeholder="https://example.com/product.jpg" aria-label="Photo web address" />
            <button type="button" id="add-image" class="btn btn-secondary btn-sm shrink-0"><i class="fa-solid fa-plus"></i> Add</button>
          </div>
        </details>
        <p class="field-hint">Photos are resized and kept in this browser for now; Phase 10 moves them to cloud storage.</p>
      </div>
    </div>
  `;
}

export function openProductModal(product = null) {
  imageState.forEach(revokePreview);
  const upgraded = upgradeLegacyVariants(product);
  variantState = structuredClone(upgraded.variants);
  optionsState = structuredClone(upgraded.options).map((o) => ({ ...o, editing: false }));
  editingProduct = product;
  imageState = product?.images ? structuredClone(product.images) : [];

  const el = modal.open({
    title: product ? 'Edit Product' : 'Add Product',
    size: 'xl',
    bodyHTML: buildFormHTML(product),
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="save-product" type="button">${product ? 'Save Changes' : 'Add Product'}</button>
    `,
  });

  initTabs(el.querySelector('#product-tabs'));
  renderVariantEditor();
  renderImageGrid();

  el.querySelector('#f-sku-gen').addEventListener('click', () => { el.querySelector('#f-sku').value = generateSKU('SKU'); });
  el.querySelector('#f-barcode-gen').addEventListener('click', () => { el.querySelector('#f-barcode').value = generateBarcode(); });
  el.querySelector('#add-option').addEventListener('click', () => {
    optionsState.forEach((o) => { o.editing = false; });
    optionsState.push({ name: ['Size', 'Color', 'Material'].find((n) => !optionsState.some((o) => o.name.toLowerCase() === n.toLowerCase())) ?? '', values: [], editing: true });
    renderOptionsEditor();
    el.querySelector(`#opt-${optionsState.length - 1}-name`)?.focus();
  });
  // A new product's variants start at the product's price, so keep untouched ones in step with it.
  el.querySelector('#f-price').addEventListener('change', () => {
    const price = Number(el.querySelector('#f-price').value) || 0;
    if (!variantState.length) return;
    if (!product && variantState.length && !variantState.some((v) => v.sku || v.barcode || v.stock)) { variantState.forEach((v) => { v.price = price; }); renderVariantTable(); }
  });
  // ---- photos ----
  const fileInput = el.querySelector('#f-image-files');
  fileInput.addEventListener('change', () => { addImageFiles(fileInput.files); fileInput.value = ''; });

  const dropzone = el.querySelector('#image-dropzone');
  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.add('is-dragover'); }));
  ['dragleave', 'dragend'].forEach((type) => dropzone.addEventListener(type, () => dropzone.classList.remove('is-dragover')));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    addImageFiles(e.dataTransfer?.files ?? []);
  });

  el.querySelector('#add-image').addEventListener('click', () => {
    const input = el.querySelector('#f-image-url');
    const url = input.value.trim();
    if (!url) return;
    if (!isSafeImageUrl(url)) { toast.danger('Enter a valid http(s) or data:image URL.'); return; }
    if (imageState.length >= MAX_IMAGES) { toast.warning(`A product can have up to ${MAX_IMAGES} photos.`); return; }
    imageState.push(url);
    input.value = '';
    renderImageGrid();
  });

  const saveBtn = el.querySelector('#save-product');
  saveBtn.addEventListener('click', async () => {
    const name = el.querySelector('#f-name').value.trim();
    const sku = el.querySelector('#f-sku').value.trim();
    const sellingPrice = Number(el.querySelector('#f-price').value);

    if (!name || !sku || Number.isNaN(sellingPrice)) {
      toast.danger('Product name, SKU and selling price are required.');
      return;
    }
    if (optionsState.some((o) => o.editing)) {
      el.querySelector('[data-tab="variants"]')?.click();
      toast.danger('Finish the option you are editing — press Done on the Variants tab.');
      return;
    }
    if (imageState.some((entry) => entry.processing)) {
      toast.info('Your photos are still being processed — try again in a moment.');
      return;
    }

    const formData = {
      name, sku,
      barcode: el.querySelector('#f-barcode').value.trim(),
      categoryId: el.querySelector('#f-category').value || null,
      brandId: el.querySelector('#f-brand').value || null,
      supplierId: el.querySelector('#f-supplier').value || null,
      status: el.querySelector('#f-status').value,
      description: el.querySelector('#f-description').value.trim(),
      color: el.querySelector('#f-color').value.trim() || null,
      size: el.querySelector('#f-size').value.trim() || null,
      weight: el.querySelector('#f-weight').value.trim() || null,
      location: el.querySelector('#f-location').value || null,
      batchNumber: el.querySelector('#f-batch').value.trim() || null,
      expirationDate: el.querySelector('#f-expiry').value || null,
      sellingPrice,
      discount: Number(el.querySelector('#f-discount').value) || 0,
      stockQuantity: stockFromVariants(Number(el.querySelector('#f-stock').value) || 0),
      minStock: Number(el.querySelector('#f-min-stock').value) || 0,
      maxStock: Number(el.querySelector('#f-max-stock').value) || 0,
      options: optionsState.map(({ name, values }) => ({ name, values })),
      variants: variantState,
    };

    saveBtn.disabled = true;
    const newlyStored = [];
    try {
      // Photos are only written to storage now, on Save — so cancelling the form never leaves orphans.
      formData.images = [];
      for (const entry of imageState) {
        if (typeof entry === 'string') { formData.images.push(entry); continue; }
        const ref = await saveImage(entry.blob);
        newlyStored.push(ref);
        formData.images.push(ref);
      }

      if (product) {
        await updateProduct(product.id, formData, getActorName());
        toast.success('Product updated.');
      } else {
        await createProduct(formData, getActorName());
        toast.success('Product added to the shared catalog.');
      }
      imageState.forEach(revokePreview);
      modal.close();
      await refreshTable();
    } catch (err) {
      await deleteImages(newlyStored); // the product wasn't saved, so don't keep photos nothing points at
      saveBtn.disabled = false;
      toast.danger(`Something went wrong: ${err.message}`);
    }
  });
}
