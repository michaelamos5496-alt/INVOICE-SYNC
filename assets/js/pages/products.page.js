/**
 * products.page.js — controller for pages/products.html. Wires the
 * catalog data table, filter bar, and the add/edit product modal
 * (tabs: Details, Pricing & Stock, Variants, Images).
 *
 * Kept out of the page's inline <script> because the product form is
 * the most stateful piece of UI in Phase 4 — variant rows and image
 * URLs are local, mutable lists the modal re-renders on every add/remove,
 * which reads a lot more clearly as a module than as one giant template
 * literal in an HTML file.
 */
import { getActorName } from '../services/auth.service.js';
import { api } from '../services/api.service.js';
import {
  listProducts, createProduct, updateProduct, deleteProduct, duplicateProduct,
  generateBarcode, generateSKU,
} from '../services/products.service.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { initTabs } from '../components/tabs.js';
import { initDropdown } from '../components/dropdown.js';
import { formatCurrency } from '../utils/formatters.js';
import { debounce, escapeHTML, isSafeImageUrl } from '../utils/helpers.js';

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
let imageState = [];

export async function initProductsPage() {
  const [categories, brands, suppliers, warehouses] = await Promise.all([
    api.categories.list(), api.brands.list(), api.suppliers.list(), api.warehouses.list(),
  ]);
  lookups = { categories, brands, suppliers, warehouses };

  populateFilterOptions();
  buildTable();
  await refreshTable();

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

function populateFilterOptions() {
  const categorySelect = document.getElementById('filter-category');
  categorySelect.innerHTML = '<option value="">All Categories</option>' +
    lookups.categories.map((c) => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
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
              ${row.images?.[0] && isSafeImageUrl(row.images[0]) ? `<img src="${escapeHTML(row.images[0])}" class="w-full h-full object-cover" alt="" />` : '<i class="fa-solid fa-box text-[var(--text-muted)]"></i>'}
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
  wireRowActions();
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

function renderVariantRows() {
  const container = document.getElementById('variant-rows');
  if (!container) return;
  container.innerHTML = variantState.length
    ? variantState.map((v, i) => `
        <div class="grid grid-cols-12 gap-2 items-center" data-variant-row="${i}">
          <input class="input col-span-3" placeholder="Color" value="${escapeHTML(v.color ?? '')}" data-variant-field="color" />
          <input class="input col-span-2" placeholder="Size" value="${escapeHTML(v.size ?? '')}" data-variant-field="size" />
          <input class="input col-span-3" placeholder="SKU suffix" value="${escapeHTML(v.skuSuffix ?? '')}" data-variant-field="skuSuffix" />
          <input class="input col-span-2" type="number" placeholder="Stock" value="${v.stock ?? 0}" data-variant-field="stock" />
          <input class="input col-span-1" type="number" placeholder="+/- price" value="${v.priceAdjustment ?? 0}" data-variant-field="priceAdjustment" />
          <button type="button" class="btn btn-ghost btn-icon col-span-1" data-remove-variant="${i}" aria-label="Remove variant"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('')
    : `<p class="text-sm text-[var(--text-muted)]">No variants yet. Add one for products sold by color/size (e.g. apparel).</p>`;

  container.querySelectorAll('[data-variant-field]').forEach((input) => {
    const row = input.closest('[data-variant-row]');
    const idx = Number(row.dataset.variantRow);
    input.addEventListener('input', () => {
      const field = input.dataset.variantField;
      variantState[idx][field] = ['stock', 'priceAdjustment'].includes(field) ? Number(input.value) : input.value;
    });
  });
  container.querySelectorAll('[data-remove-variant]').forEach((btn) => {
    btn.addEventListener('click', () => { variantState.splice(Number(btn.dataset.removeVariant), 1); renderVariantRows(); });
  });
}

function renderImageGrid() {
  const container = document.getElementById('image-grid');
  if (!container) return;
  container.innerHTML = imageState.map((url, i) => `
    <div class="relative group">
      <img src="${isSafeImageUrl(url) ? escapeHTML(url) : ''}" class="w-full h-20 object-cover rounded-lg border" style="border-color: var(--border-subtle)" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%23e2e8f0%22/%3E%3C/svg%3E'" />
      <button type="button" class="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger-500 text-white text-[10px] grid place-items-center" data-remove-image="${i}" aria-label="Remove image"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
  container.querySelectorAll('[data-remove-image]').forEach((btn) => {
    btn.addEventListener('click', () => { imageState.splice(Number(btn.dataset.removeImage), 1); renderImageGrid(); });
  });
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
        <div id="variant-rows" class="space-y-2"></div>
        <button type="button" id="add-variant" class="btn btn-secondary btn-sm"><i class="fa-solid fa-plus"></i> Add Variant</button>
      </div>

      <div data-tab-panel="images" class="hidden space-y-3">
        <div class="flex gap-2">
          <input id="f-image-url" class="input" placeholder="https://example.com/product.jpg" />
          <button type="button" id="add-image" class="btn btn-secondary btn-sm shrink-0"><i class="fa-solid fa-plus"></i> Add</button>
        </div>
        <div id="image-grid" class="grid grid-cols-4 gap-2"></div>
        <p class="field-hint">Phase 10 connects real object storage / file uploads here — for now, paste an image URL.</p>
      </div>
    </div>
  `;
}

export function openProductModal(product = null) {
  variantState = product?.variants ? structuredClone(product.variants) : [];
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
  el.querySelector('#add-variant').addEventListener('click', () => { variantState.push({ color: '', size: '', skuSuffix: '', stock: 0, priceAdjustment: 0 }); renderVariantRows(); });
  el.querySelector('#add-image').addEventListener('click', () => {
    const input = el.querySelector('#f-image-url');
    const url = input.value.trim();
    if (!url) return;
    if (!isSafeImageUrl(url)) { toast.danger('Enter a valid http(s) or data:image URL.'); return; }
    imageState.push(url);
    input.value = '';
    renderImageGrid();
  });

  el.querySelector('#save-product').addEventListener('click', async () => {
    const name = el.querySelector('#f-name').value.trim();
    const sku = el.querySelector('#f-sku').value.trim();
    const sellingPrice = Number(el.querySelector('#f-price').value);

    if (!name || !sku || Number.isNaN(sellingPrice)) {
      toast.danger('Product name, SKU and selling price are required.');
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
      stockQuantity: Number(el.querySelector('#f-stock').value) || 0,
      minStock: Number(el.querySelector('#f-min-stock').value) || 0,
      maxStock: Number(el.querySelector('#f-max-stock').value) || 0,
      variants: variantState,
      images: imageState,
    };

    try {
      if (product) {
        await updateProduct(product.id, formData, getActorName());
        toast.success('Product updated.');
      } else {
        await createProduct(formData, getActorName());
        toast.success('Product added to the shared catalog.');
      }
      modal.close();
      await refreshTable();
    } catch (err) {
      toast.danger(`Something went wrong: ${err.message}`);
    }
  });
}
