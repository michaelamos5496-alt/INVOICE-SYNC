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
  generateBarcode, generateSKU, variantLabel,
} from '../services/products.service.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { initTabs } from '../components/tabs.js';
import { initDropdown } from '../components/dropdown.js';
import { formatCurrency } from '../utils/formatters.js';
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

/** Heading shown above each variant card — the variant's name, or a prompt while it has none. */
function variantTitleHTML(variant, index) {
  const name = variantLabel(variant);
  return `Variant ${index + 1} · ${name ? `<span class="font-medium">${escapeHTML(name)}</span>` : '<span class="font-normal text-[var(--text-muted)]">needs a name</span>'}`;
}

function renderVariantRows() {
  const container = document.getElementById('variant-rows');
  if (!container) return;

  // Every input gets a real visible <label> (placeholders vanish once you type, and a
  // bare "+/- price" doesn't say what it changes). Two columns on phones, six from sm up.
  const field = (i, key, label, { span = '', type = 'text', value, placeholder = '', min = '', hint = '' } = {}) => `
    <div class="${span}">
      <label class="field-label" for="variant-${i}-${key}">${label}</label>
      <input id="variant-${i}-${key}" class="input" type="${type}" value="${escapeHTML(value ?? '')}" placeholder="${placeholder}" ${min !== '' ? `min="${min}"` : ''} ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} data-variant-field="${key}" ${hint ? `aria-describedby="variant-${i}-${key}-hint"` : ''} />
      ${hint ? `<p id="variant-${i}-${key}-hint" class="field-hint">${hint}</p>` : ''}
    </div>`;

  container.innerHTML = variantState.length
    ? variantState.map((v, i) => `
        <fieldset class="variant-card" data-variant-row="${i}">
          <legend class="sr-only">Variant ${i + 1}</legend>
          <div class="flex items-center justify-between gap-2 mb-3">
            <p class="text-sm font-semibold" data-variant-title>${variantTitleHTML(v, i)}</p>
            <button type="button" class="btn btn-ghost btn-sm" data-remove-variant="${i}" aria-label="Remove variant ${i + 1}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> Remove</button>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-6 gap-3">
            ${field(i, 'color', 'Color', { span: 'sm:col-span-2', value: v.color, placeholder: 'e.g. Red' })}
            ${field(i, 'size', 'Size', { span: 'sm:col-span-1', value: v.size, placeholder: 'e.g. M' })}
            ${field(i, 'skuSuffix', 'SKU suffix', { span: 'sm:col-span-1', value: v.skuSuffix, placeholder: '-RED-M' })}
            ${field(i, 'stock', 'Stock', { span: 'sm:col-span-1', type: 'number', value: v.stock ?? 0, min: 0 })}
            ${field(i, 'priceAdjustment', 'Price change', { span: 'col-span-2 sm:col-span-1', type: 'number', value: v.priceAdjustment ?? 0, hint: 'Added to the price. Use − to reduce.' })}
          </div>
          <p class="field-error hidden" data-variant-error role="alert">Give this variant a color or a size so you can tell it apart.</p>
        </fieldset>`).join('')
    : `<p class="text-sm text-[var(--text-muted)]">No variants yet. Add one for products sold by color/size (e.g. apparel).</p>`;

  container.querySelectorAll('[data-variant-field]').forEach((input) => {
    const row = input.closest('[data-variant-row]');
    const idx = Number(row.dataset.variantRow);
    input.addEventListener('input', () => {
      const key = input.dataset.variantField;
      variantState[idx][key] = ['stock', 'priceAdjustment'].includes(key) ? Number(input.value) : input.value;
      if (key === 'stock') syncStockField();
      if (key === 'color' || key === 'size') {
        // Update the heading in place (a full re-render would drop focus mid-typing) and clear any error.
        row.querySelector('[data-variant-title]').innerHTML = variantTitleHTML(variantState[idx], idx);
        if (variantLabel(variantState[idx])) clearVariantError(row);
      }
    });
  });
  container.querySelectorAll('[data-remove-variant]').forEach((btn) => {
    btn.addEventListener('click', () => { variantState.splice(Number(btn.dataset.removeVariant), 1); renderVariantRows(); });
  });
  syncStockField();
}

function clearVariantError(row) {
  row.querySelectorAll('[data-variant-field="color"], [data-variant-field="size"]').forEach((input) => input.removeAttribute('aria-invalid'));
  row.querySelector('[data-variant-error]')?.classList.add('hidden');
}

/** Sends the user to the first variant with no name: opens the tab, marks the fields, and focuses one. */
function flagUnnamedVariant(modalEl, index) {
  modalEl.querySelector('[data-tab="variants"]')?.click();
  const row = modalEl.querySelector(`[data-variant-row="${index}"]`);
  if (!row) return;
  row.querySelectorAll('[data-variant-field="color"], [data-variant-field="size"]').forEach((input) => input.setAttribute('aria-invalid', 'true'));
  row.querySelector('[data-variant-error]')?.classList.remove('hidden');
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.querySelector('[data-variant-field="color"]')?.focus({ preventScroll: true });
  toast.danger(`Variant ${index + 1} needs a name — enter a color or a size.`);
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
            <label class="field-label">Cost Price</label>
            <input id="f-cost" type="number" step="0.01" min="0" class="input" value="${p.costPrice ?? ''}" />
          </div>
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
        <p class="text-sm text-[var(--text-secondary)]">Name each variant by its color, its size, or both — for example <em>Red / M</em>. Stock and price change are per variant.</p>
        <div id="variant-rows" class="space-y-3"></div>
        <button type="button" id="add-variant" class="btn btn-secondary btn-sm"><i class="fa-solid fa-plus"></i> Add Variant</button>
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
  variantState = product?.variants ? structuredClone(product.variants) : [];
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
  renderVariantRows();
  renderImageGrid();

  el.querySelector('#f-sku-gen').addEventListener('click', () => { el.querySelector('#f-sku').value = generateSKU('SKU'); });
  el.querySelector('#f-barcode-gen').addEventListener('click', () => { el.querySelector('#f-barcode').value = generateBarcode(); });
  el.querySelector('#add-variant').addEventListener('click', () => {
    variantState.push({ color: '', size: '', skuSuffix: '', stock: 0, priceAdjustment: 0 });
    renderVariantRows();
    const last = el.querySelector(`[data-variant-row="${variantState.length - 1}"]`);
    last?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    last?.querySelector('[data-variant-field="color"]')?.focus({ preventScroll: true });
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
    const unnamedAt = variantState.findIndex((variant) => !variantLabel(variant));
    if (unnamedAt !== -1) { flagUnnamedVariant(el, unnamedAt); return; }
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
      costPrice: Number(el.querySelector('#f-cost').value) || 0,
      sellingPrice,
      discount: Number(el.querySelector('#f-discount').value) || 0,
      stockQuantity: stockFromVariants(Number(el.querySelector('#f-stock').value) || 0),
      minStock: Number(el.querySelector('#f-min-stock').value) || 0,
      maxStock: Number(el.querySelector('#f-max-stock').value) || 0,
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
