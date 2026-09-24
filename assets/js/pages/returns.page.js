/**
 * returns.page.js — controller for pages/returns.html. A return is
 * always against a specific line item of a specific past order (sale or
 * online order), so the form is order-first: pick the order, pick which
 * item within it, pick a quantity up to what was originally bought.
 */
import { getActorName } from '../services/auth.service.js';
import { api } from '../services/api.service.js';
import { createReturn, listReturns } from '../services/returns.service.js';
import { CHANNELS } from '../config/constants.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { formatCurrency, formatDateTime } from '../utils/formatters.js';
import { escapeHTML } from '../utils/helpers.js';

let table;
let orders = []; // combined sales + online orders, tagged with orderType/channel

export async function initReturnsPage() {
  const [sales, onlineOrders] = await Promise.all([api.sales.list(), api.onlineOrders.list()]);
  orders = [
    ...sales.map((s) => ({ ...s, orderType: 'sale', channel: CHANNELS.PHYSICAL })),
    ...onlineOrders.map((o) => ({ ...o, orderType: 'online_order', channel: CHANNELS.ONLINE })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  buildTable();
  await refreshTable();

  document.getElementById('new-return-btn').addEventListener('click', () => openCreateModal());
}

function buildTable() {
  table = new DataTable(document.getElementById('returns-table'), {
    columns: [
      { key: 'orderId', label: 'Order #', render: (row) => `<span class="font-mono">#${row.orderId.slice(-6).toUpperCase()}</span>` },
      { key: 'productName', label: 'Product', render: (row) => escapeHTML(row.productName) },
      { key: 'quantity', label: 'Qty', align: 'right' },
      { key: 'channel', label: 'Channel', render: (row) => row.channel === CHANNELS.ONLINE ? 'Online' : 'In-store' },
      { key: 'reason', label: 'Reason', render: (row) => escapeHTML(row.reason) || '—' },
      { key: 'createdAt', label: 'Date', sortable: true, render: (row) => formatDateTime(row.createdAt) },
    ],
    pageSize: 8,
    searchKeys: ['productName', 'reason'],
    rowKey: (row) => row.id,
    defaultSort: { key: 'createdAt', dir: 'desc' },
    emptyState: {
      icon: 'fa-rotate-left', title: 'No returns yet',
      message: 'Process a return from a past sale or online order.',
      actionLabel: 'New Return', onAction: () => openCreateModal(),
    },
  });
}

async function refreshTable() {
  table.setLoading();
  table.setData(await listReturns());
}

function openCreateModal() {
  const el = modal.open({
    title: 'Process Return',
    size: 'md',
    bodyHTML: `
      <div class="space-y-4">
        <div>
          <label class="field-label">Original Order *</label>
          <select id="f-order" class="select">
            <option value="">— Select order —</option>
            ${orders.map((o) => `<option value="${o.id}">#${o.id.slice(-6).toUpperCase()} · ${o.orderType === 'sale' ? 'In-store' : 'Online'} · ${formatCurrency(o.total)} · ${formatDateTime(o.createdAt)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="field-label">Item *</label>
          <select id="f-item" class="select" disabled><option value="">Select an order first</option></select>
        </div>
        <div>
          <label class="field-label">Quantity to Return *</label>
          <input id="f-qty" type="number" min="1" class="input" disabled />
        </div>
        <div>
          <label class="field-label">Reason</label>
          <input id="f-reason" type="text" class="input" placeholder="e.g. Damaged, wrong size, changed mind" />
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="save-return" type="button">Process Return</button>
    `,
  });

  const orderSelect = el.querySelector('#f-order');
  const itemSelect = el.querySelector('#f-item');
  const qtyInput = el.querySelector('#f-qty');

  orderSelect.addEventListener('change', () => {
    const order = orders.find((o) => o.id === orderSelect.value);
    if (!order) {
      itemSelect.innerHTML = '<option value="">Select an order first</option>';
      itemSelect.disabled = true;
      qtyInput.disabled = true;
      return;
    }
    itemSelect.innerHTML = '<option value="">— Select item —</option>' +
      order.items.map((item, i) => `<option value="${i}">${escapeHTML(item.name)} (bought ${item.quantity})</option>`).join('');
    itemSelect.disabled = false;
  });

  itemSelect.addEventListener('change', () => {
    const order = orders.find((o) => o.id === orderSelect.value);
    const item = order?.items[Number(itemSelect.value)];
    qtyInput.disabled = !item;
    qtyInput.max = item?.quantity ?? '';
    qtyInput.value = item ? 1 : '';
  });

  el.querySelector('#save-return').addEventListener('click', async () => {
    const order = orders.find((o) => o.id === orderSelect.value);
    const item = order?.items[Number(itemSelect.value)];
    const quantity = Number(qtyInput.value);

    if (!order || !item) { toast.danger('Select an order and an item.'); return; }
    if (!quantity || quantity <= 0 || quantity > item.quantity) { toast.danger(`Enter a quantity between 1 and ${item.quantity}.`); return; }

    try {
      await createReturn({
        orderId: order.id, orderType: order.orderType, productId: item.productId, productName: item.name,
        quantity, reason: el.querySelector('#f-reason').value.trim(), channel: order.channel,
      }, getActorName());
      toast.success('Return processed — stock restored.');
      modal.close();
      refreshTable();
    } catch (err) {
      toast.danger(err.message);
    }
  });
}
