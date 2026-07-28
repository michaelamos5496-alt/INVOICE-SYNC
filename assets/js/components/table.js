/**
 * table.js — DataTable: a reusable sortable / searchable / paginated table
 * bound to a plain array of row objects. Every list page (Products,
 * Inventory, Sales, Customers, Suppliers, Purchase Orders...) instantiates
 * one of these against its own column config instead of hand-rolling
 * table markup and pagination math per page.
 *
 * Usage:
 *   const table = new DataTable(document.querySelector('#products-table'), {
 *     columns: [
 *       { key: 'name', label: 'Product', sortable: true },
 *       { key: 'sku', label: 'SKU', sortable: true },
 *       { key: 'stockQuantity', label: 'Stock', sortable: true, align: 'right' },
 *       { key: 'actions', label: '', render: (row) => `<button>...</button>` },
 *     ],
 *     pageSize: 10,
 *     rowKey: (row) => row.id,
 *     emptyState: { icon: 'fa-box', title: 'No products yet', message: 'Add your first product to get started.' },
 *   });
 *   table.setData(products);
 */
import { renderEmptyState } from './empty-state.js';
import { renderSkeletonRows } from './skeleton.js';

export class DataTable {
  constructor(container, options) {
    this.container = container;
    this.options = options;
    this.data = [];
    this.filtered = [];
    this.page = 1;
    this.pageSize = options.pageSize ?? 10;
    this.sortKey = options.defaultSort?.key ?? null;
    this.sortDir = options.defaultSort?.dir ?? 'asc';
    this.searchTerm = '';

    this.container.innerHTML = `
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead><tr></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="flex items-center justify-between px-1 py-3 text-sm text-[var(--text-secondary)]" data-table-footer></div>
    `;
    this.theadRow = this.container.querySelector('thead tr');
    this.tbody = this.container.querySelector('tbody');
    this.footer = this.container.querySelector('[data-table-footer]');

    this._renderHead();
  }

  setLoading(rows = this.pageSize) {
    renderSkeletonRows(this.tbody, { rows, columns: this.options.columns.length });
    this.footer.innerHTML = '';
  }

  setData(data) {
    this.data = data;
    this.page = 1;
    this._applyFilterAndSort();
  }

  setSearchTerm(term) {
    this.searchTerm = term.toLowerCase();
    this.page = 1;
    this._applyFilterAndSort();
  }

  goToPage(page) {
    this.page = page;
    this._render();
  }

  _applyFilterAndSort() {
    const { searchKeys } = this.options;
    this.filtered = this.searchTerm && searchKeys?.length
      ? this.data.filter((row) => searchKeys.some((key) => String(row[key] ?? '').toLowerCase().includes(this.searchTerm)))
      : [...this.data];

    if (this.sortKey) {
      this.filtered.sort((a, b) => {
        const av = a[this.sortKey];
        const bv = b[this.sortKey];
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
        return this.sortDir === 'asc' ? cmp : -cmp;
      });
    }
    this._render();
  }

  _renderHead() {
    this.theadRow.innerHTML = this.options.columns.map((col) => `
      <th class="${col.sortable ? 'sortable' : ''} ${col.align === 'right' ? 'text-right' : ''}" data-key="${col.key}">
        ${col.label}
        ${col.sortable ? `<i class="fa-solid fa-sort ml-1 text-[10px] opacity-50"></i>` : ''}
      </th>
    `).join('');

    this.theadRow.querySelectorAll('th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        this.sortDir = this.sortKey === key && this.sortDir === 'asc' ? 'desc' : 'asc';
        this.sortKey = key;
        this._applyFilterAndSort();
      });
    });
  }

  _render() {
    const total = this.filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
    this.page = Math.min(this.page, totalPages);
    const start = (this.page - 1) * this.pageSize;
    const pageRows = this.filtered.slice(start, start + this.pageSize);

    if (total === 0) {
      this.tbody.innerHTML = `<tr><td colspan="${this.options.columns.length}"></td></tr>`;
      renderEmptyState(this.tbody.querySelector('td'), this.options.emptyState ?? { title: 'No results' });
      this.footer.innerHTML = '';
      return;
    }

    this.tbody.innerHTML = pageRows.map((row) => `
      <tr data-row-key="${this.options.rowKey ? this.options.rowKey(row) : ''}">
        ${this.options.columns.map((col) => `
          <td class="${col.align === 'right' ? 'text-right' : ''}">${col.render ? col.render(row) : row[col.key] ?? ''}</td>
        `).join('')}
      </tr>
    `).join('');

    this._renderFooter(start, pageRows.length, total, totalPages);
  }

  _renderFooter(start, count, total, totalPages) {
    const rangeLabel = `Showing ${count === 0 ? 0 : start + 1}–${start + count} of ${total}`;

    const pageButtons = Array.from({ length: totalPages }, (_, i) => i + 1)
      .filter((p) => p === 1 || p === totalPages || Math.abs(p - this.page) <= 1)
      .reduce((acc, p, i, arr) => {
        if (i > 0 && p - arr[i - 1] > 1) acc.push('…');
        acc.push(p);
        return acc;
      }, []);

    this.footer.innerHTML = `
      <span>${rangeLabel}</span>
      <div class="flex items-center gap-1">
        <button class="page-btn" data-page="prev" ${this.page === 1 ? 'disabled' : ''} aria-label="Previous page"><i class="fa-solid fa-chevron-left text-xs"></i></button>
        ${pageButtons.map((p) => p === '…'
          ? `<span class="page-btn" style="cursor:default">…</span>`
          : `<button class="page-btn ${p === this.page ? 'active' : ''}" data-page="${p}">${p}</button>`).join('')}
        <button class="page-btn" data-page="next" ${this.page === totalPages ? 'disabled' : ''} aria-label="Next page"><i class="fa-solid fa-chevron-right text-xs"></i></button>
      </div>
    `;

    this.footer.querySelectorAll('[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.page;
        if (val === 'prev') this.goToPage(this.page - 1);
        else if (val === 'next') this.goToPage(this.page + 1);
        else this.goToPage(Number(val));
      });
    });
  }
}
