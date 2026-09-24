/**
 * pos.page.js — controller for pages/pos.html, the in-store checkout
 * screen. Cart state is plain in-memory JS (page-local, not persisted —
 * a POS session is meant to end in a completed or abandoned sale, not
 * survive a refresh). Every finalized sale goes through pos.service.js's
 * checkout(), which is the only thing allowed to deduct stock here.
 */
import { getActorName } from '../services/auth.service.js';
import { imageTagHTML, hydrateImages } from '../services/image-store.service.js';
import { api } from '../services/api.service.js';
import { checkout, computeCartTotals } from '../services/pos.service.js';
import { getSettings } from '../services/settings.service.js';
import { PAYMENT_METHODS } from '../config/constants.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { initTabs } from '../components/tabs.js';
import { renderEmptyState } from '../components/empty-state.js';
import { formatCurrency, formatDateTime } from '../utils/formatters.js';
import { debounce, escapeHTML } from '../utils/helpers.js';

let products = [];
let categories = [];
let customers = [];
let cart = [];
let categoryFilter = '';
let searchTerm = '';

export async function initPOSPage() {
  [products, categories, customers] = await Promise.all([api.products.list(), api.categories.list(), api.customers.list()]);

  document.getElementById('pos-tax').value = getSettings().taxRate;

  renderCategoryChips();
  renderProductGrid();
  renderCart();
  populateCustomerSelect();

  document.getElementById('pos-search').addEventListener('input', debounce((e) => { searchTerm = e.target.value.toLowerCase(); renderProductGrid(); }, 150));

  document.getElementById('pos-barcode').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const code = e.target.value.trim();
    if (!code) return;
    const match = products.find((p) => p.barcode === code || p.sku === code);
    if (match) { addToCart(match); toast.success(`Added: ${match.name}`); }
    else toast.danger(`No product matches "${code}".`);
    e.target.value = '';
  });

  document.getElementById('pos-discount').addEventListener('input', renderCart);
  document.getElementById('pos-tax').addEventListener('input', renderCart);
  document.getElementById('charge-btn').addEventListener('click', openPaymentModal);
  document.getElementById('pos-mobile-bar-btn').addEventListener('click', () => {
    document.getElementById('pos-cart').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // Once the real Charge button is on screen the shortcut bar is redundant (and would cover it).
  new IntersectionObserver(([entry]) => {
    document.getElementById('pos-mobile-bar').classList.toggle('invisible', entry.isIntersecting);
  }).observe(document.getElementById('charge-btn'));
  document.getElementById('clear-cart-btn').addEventListener('click', () => {
    if (!cart.length) return;
    cart = [];
    renderCart();
  });
}

// ---------------------------------------------------------------------
// Product grid
// ---------------------------------------------------------------------
function renderCategoryChips() {
  const container = document.getElementById('pos-category-chips');
  const chips = [{ id: '', name: 'All' }, ...categories];
  container.innerHTML = chips.map((c) => `
    <button class="tab-btn ${c.id === categoryFilter ? 'active' : ''}" data-category="${c.id}" type="button">${escapeHTML(c.name)}</button>
  `).join('');
  container.querySelectorAll('[data-category]').forEach((btn) => {
    btn.addEventListener('click', () => { categoryFilter = btn.dataset.category; renderCategoryChips(); renderProductGrid(); });
  });
}

function renderProductGrid() {
  const grid = document.getElementById('pos-product-grid');
  let list = products.filter((p) => p.status === 'active');
  if (categoryFilter) list = list.filter((p) => p.categoryId === categoryFilter);
  if (searchTerm) list = list.filter((p) => p.name.toLowerCase().includes(searchTerm) || p.sku.toLowerCase().includes(searchTerm) || p.barcode?.includes(searchTerm));

  if (!list.length) {
    renderEmptyState(grid, { icon: 'fa-box', title: 'No products found', message: 'Try a different search or category.' });
    return;
  }

  grid.innerHTML = list.map((p) => {
    const outOfStock = p.stockQuantity <= 0;
    return `
      <button type="button" data-add-product="${p.id}" ${outOfStock ? 'disabled' : ''}
        class="card p-3 text-left transition-transform ${outOfStock ? 'opacity-40 cursor-not-allowed' : 'card-hover active:scale-[0.98]'}">
        <div class="w-full aspect-square rounded-lg bg-[var(--surface-sunken)] grid place-items-center mb-2 overflow-hidden">
          ${imageTagHTML(p.images?.[0], { className: 'w-full h-full object-cover', fallbackClass: 'fa-solid fa-box text-2xl text-[var(--text-muted)]' })}
        </div>
        <p class="text-sm font-medium truncate">${escapeHTML(p.name)}</p>
        <div class="flex items-center justify-between mt-1">
          <span class="text-sm font-semibold text-primary-600">${formatCurrency(p.sellingPrice * (1 - (p.discount ?? 0) / 100))}</span>
          <span class="text-[11px] text-[var(--text-muted)]">${outOfStock ? 'Out of stock' : `${p.stockQuantity} left`}</span>
        </div>
      </button>`;
  }).join('');

  grid.querySelectorAll('[data-add-product]').forEach((btn) => {
    btn.addEventListener('click', () => addToCart(products.find((p) => p.id === btn.dataset.addProduct)));
  });
  hydrateImages(grid);
}

// ---------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------
function addToCart(product) {
  if (!product || product.stockQuantity <= 0) return;
  const existing = cart.find((item) => item.productId === product.id);
  if (existing) {
    if (existing.quantity >= product.stockQuantity) { toast.danger(`Only ${product.stockQuantity} in stock.`); return; }
    existing.quantity += 1;
  } else {
    cart.push({
      productId: product.id, name: product.name, sku: product.sku,
      unitPrice: product.sellingPrice * (1 - (product.discount ?? 0) / 100),
      quantity: 1, maxQuantity: product.stockQuantity,
    });
  }
  renderCart();
}

function updateQuantity(productId, newQty) {
  const item = cart.find((i) => i.productId === productId);
  if (!item) return;
  if (newQty <= 0) { cart = cart.filter((i) => i.productId !== productId); }
  else if (newQty > item.maxQuantity) { toast.danger(`Only ${item.maxQuantity} in stock.`); }
  else { item.quantity = newQty; }
  renderCart();
}

function getDiscountPercent() { return Number(document.getElementById('pos-discount').value) || 0; }
function getTaxPercent() { return Number(document.getElementById('pos-tax').value) || 0; }

function renderCart() {
  const container = document.getElementById('pos-cart-items');
  const chargeBtn = document.getElementById('charge-btn');

  if (!cart.length) {
    renderEmptyState(container, { icon: 'fa-cart-shopping', title: 'Cart is empty', message: 'Tap a product to add it.' });
  } else {
    container.innerHTML = cart.map((item) => `
      <div class="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 py-2.5 border-b last:border-0" style="border-color: var(--border-subtle)">
        <div class="basis-full sm:basis-0 flex-1 min-w-0">
          <p class="text-sm font-medium truncate">${escapeHTML(item.name)}</p>
          <p class="text-xs text-[var(--text-muted)]">${formatCurrency(item.unitPrice)} each</p>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" aria-label="Decrease quantity" class="w-9 h-9 sm:w-7 sm:h-7 rounded-lg grid place-items-center bg-[var(--surface-sunken)] sm:bg-transparent hover:bg-[var(--surface-sunken)]" data-qty-minus="${item.productId}"><i class="fa-solid fa-minus text-xs"></i></button>
          <span class="w-6 text-center text-sm font-medium">${item.quantity}</span>
          <button type="button" aria-label="Increase quantity" class="w-9 h-9 sm:w-7 sm:h-7 rounded-lg grid place-items-center bg-[var(--surface-sunken)] sm:bg-transparent hover:bg-[var(--surface-sunken)]" data-qty-plus="${item.productId}"><i class="fa-solid fa-plus text-xs"></i></button>
        </div>
        <span class="text-sm font-semibold min-w-[4.5rem] text-right shrink-0 ml-auto sm:ml-0">${formatCurrency(item.unitPrice * item.quantity)}</span>
        <button type="button" aria-label="Remove item" class="w-9 h-9 sm:w-7 sm:h-7 rounded-lg grid place-items-center text-danger-500 hover:bg-[var(--surface-sunken)] shrink-0" data-remove="${item.productId}"><i class="fa-solid fa-trash text-xs"></i></button>
      </div>`).join('');

    container.querySelectorAll('[data-qty-minus]').forEach((btn) => btn.addEventListener('click', () => {
      const item = cart.find((i) => i.productId === btn.dataset.qtyMinus);
      updateQuantity(btn.dataset.qtyMinus, item.quantity - 1);
    }));
    container.querySelectorAll('[data-qty-plus]').forEach((btn) => btn.addEventListener('click', () => {
      const item = cart.find((i) => i.productId === btn.dataset.qtyPlus);
      updateQuantity(btn.dataset.qtyPlus, item.quantity + 1);
    }));
    container.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', () => updateQuantity(btn.dataset.remove, 0)));
  }

  const totals = computeCartTotals(cart, { discountPercent: getDiscountPercent(), taxPercent: getTaxPercent() });
  document.getElementById('pos-subtotal').textContent = formatCurrency(totals.subtotal);
  document.getElementById('pos-discount-amount').textContent = `− ${formatCurrency(totals.discountAmount)}`;
  document.getElementById('pos-tax-amount').textContent = formatCurrency(totals.taxAmount);
  document.getElementById('pos-total').textContent = formatCurrency(totals.total);
  chargeBtn.disabled = cart.length === 0;

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  document.getElementById('pos-mobile-bar').classList.toggle('hidden', !cart.length);
  document.getElementById('pos-mobile-count').textContent = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
  document.getElementById('pos-mobile-total').textContent = formatCurrency(totals.total);
  document.getElementById('main-content').classList.toggle('pb-28', cart.length > 0);
}

function populateCustomerSelect() {
  const select = document.getElementById('pos-customer');
  select.innerHTML = '<option value="">Walk-in customer</option>' + customers.map((c) => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
}

// ---------------------------------------------------------------------
// Payment modal
// ---------------------------------------------------------------------
function openPaymentModal() {
  const totals = computeCartTotals(cart, { discountPercent: getDiscountPercent(), taxPercent: getTaxPercent() });

  const el = modal.open({
    title: 'Take Payment',
    size: 'md',
    bodyHTML: `
      <div class="space-y-5">
        <div class="text-center py-4 rounded-xl" style="background: var(--surface-sunken)">
          <p class="text-sm text-[var(--text-secondary)]">Amount Due</p>
          <p class="font-display text-3xl font-bold mt-1">${formatCurrency(totals.total)}</p>
        </div>

        <div id="payment-tabs">
          <div class="tabs-list">
            <button class="tab-btn active" data-tab="cash" type="button">Cash</button>
            <button class="tab-btn" data-tab="card" type="button">Card</button>
            <button class="tab-btn" data-tab="mobile_money" type="button">Mobile Money</button>
            <button class="tab-btn" data-tab="split" type="button">Split</button>
          </div>

          <div data-tab-panel="cash" class="pt-4 space-y-3">
            <label class="field-label">Amount Tendered</label>
            <input id="f-tendered" type="number" step="0.01" min="0" class="input text-lg font-semibold" placeholder="${totals.total.toFixed(2)}" />
            <p class="text-sm text-[var(--text-secondary)]">Change due: <span id="change-due" class="font-semibold">${formatCurrency(0)}</span></p>
          </div>
          <div data-tab-panel="card" class="hidden pt-4">
            <p class="text-sm text-[var(--text-secondary)]">Confirm once the card terminal approves the charge.</p>
          </div>
          <div data-tab-panel="mobile_money" class="hidden pt-4">
            <p class="text-sm text-[var(--text-secondary)]">Confirm once the mobile money prompt is approved by the customer.</p>
          </div>
          <div data-tab-panel="split" class="hidden pt-4 space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="field-label">Cash Amount</label>
                <input id="f-split-cash" type="number" step="0.01" min="0" class="input" value="0" />
              </div>
              <div>
                <label class="field-label">Card Amount</label>
                <input id="f-split-card" type="number" step="0.01" min="0" class="input" value="0" />
              </div>
            </div>
            <p class="text-sm text-[var(--text-secondary)]">Remaining: <span id="split-remaining" class="font-semibold">${formatCurrency(totals.total)}</span></p>
          </div>
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="confirm-payment" type="button">Confirm Payment</button>
    `,
  });

  let activeMethod = 'cash';
  initTabs(el.querySelector('#payment-tabs'), { onChange: (key) => { activeMethod = key; } });

  const tenderedInput = el.querySelector('#f-tendered');
  tenderedInput.addEventListener('input', () => {
    const change = Math.max(0, Number(tenderedInput.value || 0) - totals.total);
    el.querySelector('#change-due').textContent = formatCurrency(change);
  });

  const splitCash = el.querySelector('#f-split-cash');
  const splitCard = el.querySelector('#f-split-card');
  const updateSplitRemaining = () => {
    const remaining = totals.total - (Number(splitCash.value || 0) + Number(splitCard.value || 0));
    el.querySelector('#split-remaining').textContent = formatCurrency(Math.max(0, remaining));
  };
  splitCash.addEventListener('input', updateSplitRemaining);
  splitCard.addEventListener('input', updateSplitRemaining);

  el.querySelector('#confirm-payment').addEventListener('click', async () => {
    let payments = null;
    if (activeMethod === 'cash') {
      const tendered = Number(tenderedInput.value || 0);
      if (tendered < totals.total) { toast.danger('Amount tendered is less than the total due.'); return; }
    } else if (activeMethod === 'split') {
      const cashAmt = Number(splitCash.value || 0);
      const cardAmt = Number(splitCard.value || 0);
      if (Math.abs(cashAmt + cardAmt - totals.total) > 0.01) { toast.danger('Split amounts must add up to the total.'); return; }
      payments = { cash: cashAmt, card: cardAmt };
    }

    try {
      const sale = await checkout({
        cart, customerId: document.getElementById('pos-customer').value,
        paymentMethod: PAYMENT_METHODS[activeMethod.toUpperCase()] ?? activeMethod,
        payments, notes: document.getElementById('pos-notes').value.trim(),
        discountPercent: getDiscountPercent(), taxPercent: getTaxPercent(),
      }, getActorName());

      modal.close();
      openReceiptModal(sale);
      cart = [];
      document.getElementById('pos-notes').value = '';
      products = await api.products.list();
      renderProductGrid();
      renderCart();
    } catch (err) {
      toast.danger(err.message);
    }
  });
}

// ---------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------
function openReceiptModal(sale) {
  const customer = customers.find((c) => c.id === sale.customerId);
  const rows = sale.items.map((item) => `
    <tr>
      <td class="py-1 text-sm">${escapeHTML(item.name)} <span class="text-[var(--text-muted)]">× ${item.quantity}</span></td>
      <td class="py-1 text-sm text-right">${formatCurrency(item.price * item.quantity)}</td>
    </tr>`).join('');

  modal.open({
    title: 'Sale Complete',
    size: 'sm',
    bodyHTML: `
      <div id="receipt-print-area" class="space-y-3 font-mono text-sm">
        <div class="text-center">
          <p class="font-display font-bold text-base">InvSync</p>
          <p class="text-xs text-[var(--text-muted)]">${formatDateTime(sale.createdAt)}</p>
          <p class="text-xs text-[var(--text-muted)]">Order #${sale.id.slice(-6).toUpperCase()} · ${escapeHTML(customer?.name ?? 'Walk-in customer')}</p>
        </div>
        <table class="w-full">${rows}</table>
        <div class="border-t pt-2 space-y-1" style="border-color: var(--border-subtle)">
          <div class="flex justify-between text-xs"><span>Subtotal</span><span>${formatCurrency(sale.subtotal)}</span></div>
          <div class="flex justify-between text-xs"><span>Discount</span><span>− ${formatCurrency(sale.discountAmount)}</span></div>
          <div class="flex justify-between text-xs"><span>Tax</span><span>${formatCurrency(sale.taxAmount)}</span></div>
          <div class="flex justify-between font-semibold text-base pt-1"><span>Total</span><span>${formatCurrency(sale.total)}</span></div>
        </div>
        <p class="text-center text-xs text-[var(--text-muted)]">Paid via ${sale.paymentMethod.replace('_', ' ')}</p>
        <p class="text-center text-xs">Thank you for shopping with us!</p>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Close</button>
      <button class="btn btn-primary" id="print-receipt" type="button"><i class="fa-solid fa-print"></i> Print Receipt</button>
    `,
  }).querySelector('#print-receipt').addEventListener('click', () => window.print());

  toast.success('Sale completed — inventory updated.');
}
