/**
 * reports.page.js — controller for pages/reports.html: seven report tabs
 * (Sales, Inventory, Profit, Customer, Employee, Purchase, Supplier).
 * Charts are created lazily the first time a tab is opened and destroyed
 * before being rebuilt on re-render (Chart.js throws if you re-init a
 * canvas that already has a chart attached to it) — `charts` below
 * tracks the live instance per canvas id.
 */
import {
  getSalesReport, getInventoryReport, getProfitReport, getCustomerReport,
  getEmployeeReport, getPurchaseReport, getSupplierReport,
} from '../services/reports.service.js';
import { initTabs } from '../components/tabs.js';
import { renderStatCards } from '../components/stat-card.js';
import { DataTable } from '../components/table.js';
import { applyChartDefaults, getChartColors } from '../utils/chart-theme.js';
import { formatCurrency, formatDate } from '../utils/formatters.js';
import { escapeHTML } from '../utils/helpers.js';

const charts = {};

function renderChart(canvasId, config) {
  charts[canvasId]?.destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId), config);
}

const renderers = {
  sales: renderSalesTab,
  inventory: renderInventoryTab,
  profit: renderProfitTab,
  customers: renderCustomerTab,
  employees: renderEmployeeTab,
  purchases: renderPurchaseTab,
  suppliers: renderSupplierTab,
};

export async function initReportsPage() {
  applyChartDefaults(Chart);
  initTabs(document.getElementById('reports-tabs'), { onChange: (key) => renderers[key]?.() });
  await renderSalesTab();
}

async function renderSalesTab() {
  const report = await getSalesReport(30);
  const colors = getChartColors();

  renderStatCards(document.getElementById('sales-report-stats'), [
    { label: 'Total Revenue (30d)', value: formatCurrency(report.totalRevenue), icon: 'fa-sack-dollar', tone: 'success' },
    { label: 'Orders', value: report.orderCount, icon: 'fa-receipt', tone: 'primary' },
    { label: 'Avg. Order Value', value: formatCurrency(report.averageOrderValue), icon: 'fa-calculator', tone: 'info' },
  ]);

  renderChart('sales-report-chart', {
    type: 'line',
    data: {
      labels: report.trend.labels,
      datasets: [{ label: 'Revenue', data: report.trend.data, borderColor: colors.primary, backgroundColor: colors.primaryFaint, fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { display: false } }, y: { grid: { color: colors.gridLine }, beginAtZero: true } },
      plugins: { legend: { display: false } },
    },
  });

  const container = document.getElementById('sales-report-breakdown');
  container.innerHTML = `
    <div>
      <h3 class="font-display font-semibold text-sm mb-2">By Channel</h3>
      <div class="space-y-1.5">
        <div class="flex justify-between text-sm"><span class="text-[var(--text-secondary)]">In-store</span><span class="font-medium">${formatCurrency(report.byChannel.physical_shop ?? 0)}</span></div>
        <div class="flex justify-between text-sm"><span class="text-[var(--text-secondary)]">Online</span><span class="font-medium">${formatCurrency(report.byChannel.online_shop ?? 0)}</span></div>
      </div>
    </div>
    <div>
      <h3 class="font-display font-semibold text-sm mb-2">By Payment Method</h3>
      <div class="space-y-1.5">
        ${Object.entries(report.byPaymentMethod).map(([method, total]) => `
          <div class="flex justify-between text-sm"><span class="text-[var(--text-secondary)] capitalize">${method.replace('_', ' ')}</span><span class="font-medium">${formatCurrency(total)}</span></div>
        `).join('')}
      </div>
    </div>`;
}

async function renderInventoryTab() {
  const report = await getInventoryReport();
  const colors = getChartColors();

  renderStatCards(document.getElementById('inventory-report-stats'), [
    { label: 'Inventory Value', value: formatCurrency(report.totalValue), icon: 'fa-warehouse', tone: 'primary' },
    { label: 'Total Units', value: report.totalUnits, icon: 'fa-cubes', tone: 'info' },
    { label: 'Low Stock', value: report.lowStockCount, icon: 'fa-triangle-exclamation', tone: 'warning' },
    { label: 'Out of Stock', value: report.outOfStockCount, icon: 'fa-circle-xmark', tone: 'danger' },
  ]);

  const categories = Object.keys(report.byCategory);
  renderChart('inventory-report-chart', {
    type: 'bar',
    data: {
      labels: categories,
      datasets: [{ label: 'Stock Value', data: categories.map((c) => Number(report.byCategory[c].toFixed(2))), backgroundColor: colors.primary, borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { display: false } }, y: { grid: { color: colors.gridLine }, beginAtZero: true } },
      plugins: { legend: { display: false } },
    },
  });

  new DataTable(document.getElementById('inventory-report-table'), {
    columns: [
      { key: 'name', label: 'Product', sortable: true, render: (row) => escapeHTML(row.name) },
      { key: 'stockQuantity', label: 'Units', align: 'right', sortable: true },
      { key: 'costPrice', label: 'Unit Cost', align: 'right', render: (row) => formatCurrency(row.costPrice) },
      { key: 'value', label: 'Stock Value', align: 'right', sortable: true, render: (row) => formatCurrency(row.stockQuantity * row.costPrice) },
    ],
    pageSize: 6, searchKeys: ['name'], rowKey: (row) => row.id,
    defaultSort: { key: 'value', dir: 'desc' },
    emptyState: { icon: 'fa-warehouse', title: 'No products yet' },
  }).setData(report.products);
}

async function renderProfitTab() {
  const report = await getProfitReport(30);
  const colors = getChartColors();

  renderStatCards(document.getElementById('profit-report-stats'), [
    { label: 'Revenue (30d)', value: formatCurrency(report.totalRevenue), icon: 'fa-sack-dollar', tone: 'primary' },
    { label: 'Cost of Goods', value: formatCurrency(report.totalCost), icon: 'fa-receipt', tone: 'warning' },
    { label: 'Gross Profit', value: formatCurrency(report.totalProfit), icon: 'fa-chart-line', tone: 'success' },
    { label: 'Margin', value: `${report.marginPercent.toFixed(1)}%`, icon: 'fa-percent', tone: 'info' },
  ]);

  renderChart('profit-report-chart', {
    type: 'bar',
    data: {
      labels: report.trend.labels,
      datasets: [{ label: 'Daily Profit', data: report.trend.data, backgroundColor: colors.success, borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { display: false } }, y: { grid: { color: colors.gridLine }, beginAtZero: true } },
      plugins: { legend: { display: false } },
    },
  });

  new DataTable(document.getElementById('profit-report-table'), {
    columns: [
      { key: 'name', label: 'Product', sortable: true, render: (row) => escapeHTML(row.name) },
      { key: 'units', label: 'Units Sold', align: 'right', sortable: true },
      { key: 'revenue', label: 'Revenue', align: 'right', sortable: true, render: (row) => formatCurrency(row.revenue) },
      { key: 'profit', label: 'Profit', align: 'right', sortable: true, render: (row) => formatCurrency(row.profit) },
    ],
    pageSize: 6, searchKeys: ['name'], rowKey: (row) => row.name,
    defaultSort: { key: 'profit', dir: 'desc' },
    emptyState: { icon: 'fa-chart-line', title: 'No sales in this period yet' },
  }).setData(report.byProduct);
}

async function renderCustomerTab() {
  const report = await getCustomerReport();

  renderStatCards(document.getElementById('customer-report-stats'), [
    { label: 'Total Customers', value: report.totalCustomers, icon: 'fa-users', tone: 'primary' },
    { label: 'Lifetime Revenue', value: formatCurrency(report.totalRevenue), icon: 'fa-sack-dollar', tone: 'success' },
    { label: 'Avg. Spend / Customer', value: formatCurrency(report.averageSpend), icon: 'fa-calculator', tone: 'info' },
  ]);

  new DataTable(document.getElementById('customer-report-table'), {
    columns: [
      { key: 'name', label: 'Customer', sortable: true, render: (row) => escapeHTML(row.name) },
      { key: 'totalOrders', label: 'Orders', align: 'right', sortable: true },
      { key: 'totalSpent', label: 'Total Spent', align: 'right', sortable: true, render: (row) => formatCurrency(row.totalSpent ?? 0) },
    ],
    pageSize: 8, searchKeys: ['name'], rowKey: (row) => row.id,
    defaultSort: { key: 'totalSpent', dir: 'desc' },
    emptyState: { icon: 'fa-users', title: 'No customers yet' },
  }).setData(report.topCustomers);
}

async function renderEmployeeTab() {
  const report = await getEmployeeReport(30);
  const colors = getChartColors();

  renderChart('employee-report-chart', {
    type: 'bar',
    data: {
      labels: report.performance.map((p) => p.name),
      datasets: [{ label: 'Revenue (30d)', data: report.performance.map((p) => Number(p.revenue.toFixed(2))), backgroundColor: colors.primary, borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { color: colors.gridLine }, beginAtZero: true }, y: { grid: { display: false } } },
      plugins: { legend: { display: false } },
    },
  });

  new DataTable(document.getElementById('employee-report-table'), {
    columns: [
      { key: 'name', label: 'Staff Member', sortable: true, render: (row) => escapeHTML(row.name) },
      { key: 'orderCount', label: 'Sales Processed', align: 'right', sortable: true },
      { key: 'revenue', label: 'Revenue (30d)', align: 'right', sortable: true, render: (row) => formatCurrency(row.revenue) },
    ],
    pageSize: 8, searchKeys: ['name'], rowKey: (row) => row.name,
    defaultSort: { key: 'revenue', dir: 'desc' },
    emptyState: { icon: 'fa-id-badge', title: 'No sales processed in this period yet' },
  }).setData(report.performance);
}

async function renderPurchaseTab() {
  const report = await getPurchaseReport();

  renderStatCards(document.getElementById('purchase-report-stats'), [
    { label: 'Total Spend (Received)', value: formatCurrency(report.totalSpend), icon: 'fa-sack-dollar', tone: 'primary' },
    { label: 'Total Purchase Orders', value: report.totalOrders, icon: 'fa-file-invoice', tone: 'info' },
    { label: 'Pending', value: report.byStatus.pending ?? 0, icon: 'fa-clock', tone: 'warning' },
    { label: 'Received', value: report.byStatus.received ?? 0, icon: 'fa-box-open', tone: 'success' },
  ]);

  new DataTable(document.getElementById('purchase-report-table'), {
    columns: [
      { key: 'id', label: 'PO #', render: (row) => `#${row.id.slice(-6).toUpperCase()}` },
      { key: 'supplierName', label: 'Supplier', sortable: true, render: (row) => escapeHTML(row.supplierName) },
      { key: 'total', label: 'Total', align: 'right', sortable: true, render: (row) => formatCurrency(row.total) },
      { key: 'status', label: 'Status', render: (row) => `<span class="badge badge-neutral">${row.status}</span>` },
      { key: 'createdAt', label: 'Date', sortable: true, render: (row) => formatDate(row.createdAt) },
    ],
    pageSize: 8, searchKeys: ['supplierName'], rowKey: (row) => row.id,
    defaultSort: { key: 'createdAt', dir: 'desc' },
    emptyState: { icon: 'fa-file-invoice', title: 'No purchase orders yet' },
  }).setData(report.orders);
}

async function renderSupplierTab() {
  const report = await getSupplierReport();
  const colors = getChartColors();

  renderChart('supplier-report-chart', {
    type: 'bar',
    data: {
      labels: report.map((s) => s.name),
      datasets: [{ label: 'Total Spend', data: report.map((s) => Number(s.totalSpend.toFixed(2))), backgroundColor: colors.info, borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { display: false } }, y: { grid: { color: colors.gridLine }, beginAtZero: true } },
      plugins: { legend: { display: false } },
    },
  });

  new DataTable(document.getElementById('supplier-report-table'), {
    columns: [
      { key: 'name', label: 'Supplier', sortable: true, render: (row) => escapeHTML(row.name) },
      { key: 'leadTimeDays', label: 'Lead Time', align: 'right', render: (row) => `${row.leadTimeDays ?? '—'} days` },
      { key: 'orderCount', label: 'Purchase Orders', align: 'right', sortable: true },
      { key: 'totalSpend', label: 'Total Spend', align: 'right', sortable: true, render: (row) => formatCurrency(row.totalSpend) },
    ],
    pageSize: 8, searchKeys: ['name'], rowKey: (row) => row.id,
    defaultSort: { key: 'totalSpend', dir: 'desc' },
    emptyState: { icon: 'fa-truck-field', title: 'No suppliers yet' },
  }).setData(report);
}
