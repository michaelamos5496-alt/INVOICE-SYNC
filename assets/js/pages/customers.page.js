/**
 * customers.page.js — controller for pages/customers.html. Plain CRUD
 * for contact details, but `totalOrders`/`totalSpent` are read-only here
 * — they're maintained by pos.service.js and online-orders.service.js
 * whenever that customer completes a purchase, not editable by hand.
 * "View Orders" pulls their combined in-store + online history.
 */
import { api } from '../services/api.service.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { initDropdown } from '../components/dropdown.js';
import { formatCurrency, formatDateTime, initials } from '../utils/formatters.js';
import { debounce, escapeHTML } from '../utils/helpers.js';

let table;

export async function initCustomersPage() {
  table = new DataTable(document.getElementById('customers-table'), {
    columns: [
      {
        key: 'name', label: 'Customer', sortable: true,
        render: (row) => `
          <div class="flex items-center gap-2.5">
            <span class="w-8 h-8 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold grid place-items-center shrink-0">${initials(row.name)}</span>
            <span class="text-sm font-medium">${escapeHTML(row.name)}</span>
          </div>`,
      },
      { key: 'email', label: 'Email', render: (row) => escapeHTML(row.email) },
      { key: 'phone', label: 'Phone', render: (row) => escapeHTML(row.phone) },
      { key: 'totalOrders', label: 'Orders', align: 'right', sortable: true, render: (row) => row.totalOrders ?? 0 },
      { key: 'totalSpent', label: 'Total Spent', align: 'right', sortable: true, render: (row) => formatCurrency(row.totalSpent ?? 0) },
      {
        key: 'actions', label: '',
        render: (row) => `<button class="btn btn-ghost btn-sm" data-row-actions="${row.id}"><i class="fa-solid fa-ellipsis"></i></button>`,
      },
    ],
    pageSize: 8,
    searchKeys: ['name', 'email', 'phone'],
    rowKey: (row) => row.id,
    defaultSort: { key: 'totalSpent', dir: 'desc' },
    emptyState: {
      icon: 'fa-users', title: 'No customers yet',
      message: 'Add a customer, or they\'ll be created automatically from their first sale.',
      actionLabel: 'Add Customer', onAction: () => openFormModal(),
    },
  });

  await refreshTable();

  document.getElementById('add-customer-btn').addEventListener('click', () => openFormModal());
  document.getElementById('customer-search').addEventListener('input', debounce((e) => table.setSearchTerm(e.target.value), 200));
}

async function refreshTable() {
  table.setLoading();
  table.setData(await api.customers.list());
  wireRowActions();
}

function wireRowActions() {
  document.querySelectorAll('[data-row-actions]').forEach((btn) => {
    const id = btn.dataset.rowActions;
    initDropdown(btn, [
      { label: 'Edit', icon: 'fa-pen', onClick: async () => openFormModal(await api.customers.get(id)) },
      { label: 'View Orders', icon: 'fa-receipt', onClick: async () => openOrderHistoryModal(await api.customers.get(id)) },
      { divider: true },
      {
        label: 'Delete', icon: 'fa-trash', danger: true,
        onClick: async () => {
          const ok = await modal.confirm({ title: 'Delete this customer?', message: 'Their past orders are kept, but they\'ll no longer be linked to an account.' });
          if (!ok) return;
          await api.customers.remove(id);
          toast.success('Customer deleted.');
          refreshTable();
        },
      },
    ]);
  });
}

function openFormModal(customer = null) {
  const el = modal.open({
    title: customer ? 'Edit Customer' : 'Add Customer',
    size: 'sm',
    bodyHTML: `
      <div class="space-y-4">
        <div>
          <label class="field-label">Name *</label>
          <input id="f-name" class="input" value="${escapeHTML(customer?.name ?? '')}" />
        </div>
        <div>
          <label class="field-label">Email</label>
          <input id="f-email" type="email" class="input" value="${escapeHTML(customer?.email ?? '')}" />
        </div>
        <div>
          <label class="field-label">Phone</label>
          <input id="f-phone" type="tel" class="input" value="${escapeHTML(customer?.phone ?? '')}" />
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="save-customer" type="button">${customer ? 'Save Changes' : 'Add Customer'}</button>
    `,
  });

  el.querySelector('#save-customer').addEventListener('click', async () => {
    const name = el.querySelector('#f-name').value.trim();
    if (!name) { toast.danger('Name is required.'); return; }

    const formData = {
      name,
      email: el.querySelector('#f-email').value.trim(),
      phone: el.querySelector('#f-phone').value.trim(),
    };

    if (customer) await api.customers.update(customer.id, formData);
    else await api.customers.create({ ...formData, totalOrders: 0, totalSpent: 0 });

    toast.success(customer ? 'Customer updated.' : 'Customer added.');
    modal.close();
    refreshTable();
  });
}

async function openOrderHistoryModal(customer) {
  const [sales, onlineOrders] = await Promise.all([
    api.sales.list((s) => s.customerId === customer.id),
    api.onlineOrders.list((o) => o.customerId === customer.id),
  ]);
  const combined = [...sales.map((s) => ({ ...s, source: 'In-store' })), ...onlineOrders.map((o) => ({ ...o, source: 'Online' }))]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const rows = combined.length
    ? combined.map((o) => `
        <tr>
          <td class="py-1.5 text-sm font-mono">#${o.id.slice(-6).toUpperCase()}</td>
          <td class="py-1.5 text-sm">${o.source}</td>
          <td class="py-1.5 text-sm text-right">${formatCurrency(o.total)}</td>
          <td class="py-1.5 text-sm text-right text-[var(--text-muted)]">${formatDateTime(o.createdAt)}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" class="py-8 text-center text-sm text-[var(--text-muted)]">No orders yet.</td></tr>`;

  modal.open({
    title: `${escapeHTML(customer.name)} — Order History`,
    size: 'md',
    bodyHTML: `
      <table class="w-full text-left">
        <thead><tr class="text-xs uppercase text-[var(--text-muted)]">
          <th class="pb-2">Order</th><th class="pb-2">Channel</th><th class="pb-2 text-right">Total</th><th class="pb-2 text-right">Date</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
    footerHTML: `<button class="btn btn-secondary" data-modal-close type="button">Close</button>`,
  });
}
