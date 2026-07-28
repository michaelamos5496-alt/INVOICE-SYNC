/**
 * sales.page.js — controller for pages/sales.html: read-only history of
 * physical-shop sales (POS checkouts write here — see pos.service.js).
 * Viewing a row shows the same itemized layout as the POS receipt.
 */
import { api } from '../services/api.service.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { formatCurrency, formatDateTime } from '../utils/formatters.js';
import { escapeHTML } from '../utils/helpers.js';

let customers = [];

export async function initSalesPage() {
  customers = await api.customers.list();

  const table = new DataTable(document.getElementById('sales-table'), {
    columns: [
      { key: 'id', label: 'Order #', render: (row) => `<span class="font-mono font-medium">#${row.id.slice(-6).toUpperCase()}</span>` },
      { key: 'customerId', label: 'Customer', render: (row) => escapeHTML(customerName(row.customerId)) },
      { key: 'items', label: 'Items', align: 'right', render: (row) => row.items.reduce((s, i) => s + i.quantity, 0) },
      { key: 'paymentMethod', label: 'Payment', render: (row) => `<span class="badge badge-neutral">${row.paymentMethod.replace('_', ' ')}</span>` },
      { key: 'total', label: 'Total', align: 'right', sortable: true, render: (row) => formatCurrency(row.total) },
      { key: 'createdAt', label: 'Date', sortable: true, render: (row) => formatDateTime(row.createdAt) },
      {
        key: 'actions', label: '',
        render: (row) => `<button class="btn btn-ghost btn-sm" data-view-sale="${row.id}"><i class="fa-solid fa-eye"></i></button>`,
      },
    ],
    pageSize: 10,
    searchKeys: [],
    rowKey: (row) => row.id,
    defaultSort: { key: 'createdAt', dir: 'desc' },
    emptyState: { icon: 'fa-receipt', title: 'No sales yet', message: 'Sales made through the POS will show up here.' },
  });

  table.setLoading();
  const sales = await api.sales.list();
  table.setData(sales);

  document.getElementById('sales-search').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    table.setData(term
      ? sales.filter((s) => s.id.toLowerCase().includes(term) || customerName(s.customerId).toLowerCase().includes(term))
      : sales);
    wireViewButtons(sales);
  });

  wireViewButtons(sales);
}

function customerName(id) {
  return customers.find((c) => c.id === id)?.name ?? 'Walk-in customer';
}

function wireViewButtons(sales) {
  document.querySelectorAll('[data-view-sale]').forEach((btn) => {
    btn.addEventListener('click', () => openSaleDetail(sales.find((s) => s.id === btn.dataset.viewSale)));
  });
}

function openSaleDetail(sale) {
  const rows = sale.items.map((item) => `
    <tr>
      <td class="py-1.5 text-sm">${escapeHTML(item.name)} <span class="text-[var(--text-muted)]">× ${item.quantity}</span></td>
      <td class="py-1.5 text-sm text-right">${formatCurrency(item.price * item.quantity)}</td>
    </tr>`).join('');

  modal.open({
    title: `Order #${sale.id.slice(-6).toUpperCase()}`,
    size: 'sm',
    bodyHTML: `
      <div class="space-y-3">
        <p class="text-sm text-[var(--text-secondary)]">${escapeHTML(customerName(sale.customerId))} · ${formatDateTime(sale.createdAt)}</p>
        <table class="w-full">${rows}</table>
        <div class="border-t pt-2 space-y-1 text-sm" style="border-color: var(--border-subtle)">
          <div class="flex justify-between"><span>Subtotal</span><span>${formatCurrency(sale.subtotal)}</span></div>
          <div class="flex justify-between"><span>Discount</span><span>− ${formatCurrency(sale.discountAmount)}</span></div>
          <div class="flex justify-between"><span>Tax</span><span>${formatCurrency(sale.taxAmount)}</span></div>
          <div class="flex justify-between font-semibold text-base pt-1"><span>Total</span><span>${formatCurrency(sale.total)}</span></div>
        </div>
        ${sale.notes ? `<p class="text-sm text-[var(--text-secondary)]"><strong>Notes:</strong> ${escapeHTML(sale.notes)}</p>` : ''}
      </div>`,
    footerHTML: `<button class="btn btn-secondary" data-modal-close type="button">Close</button>`,
  });
}
