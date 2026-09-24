/**
 * analytics.page.js — controller for pages/analytics.html: trend analysis
 * that goes beyond the point-in-time Reports page — Product Performance,
 * Fast Moving Products, and Dead Stock. All three read from
 * analytics.service.js, which composes the same order/product
 * collections every other report reads.
 */
import { watchData } from '../services/live-data.js';
import {
  getProductPerformance, getFastMovers, getDeadStock,
} from '../services/analytics.service.js';
import { initTabs } from '../components/tabs.js';
import { DataTable } from '../components/table.js';
import { renderEmptyState } from '../components/empty-state.js';
import { applyChartDefaults, getChartColors } from '../utils/chart-theme.js';
import { formatCurrency } from '../utils/formatters.js';
import { escapeHTML } from '../utils/helpers.js';

const charts = {};

function renderChart(canvasId, config) {
  charts[canvasId]?.destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId), config);
}

let activeTab = 'performance';

const renderers = {
  performance: renderPerformanceTab,
  'fast-movers': renderFastMoversTab,
  'dead-stock': renderDeadStockTab,
};

export async function initAnalyticsPage() {
  applyChartDefaults(Chart);
  initTabs(document.getElementById('analytics-tabs'), { onChange: (key) => { activeTab = key; return renderers[key]?.(); } });
  // Live: redraw the tab being looked at when the numbers behind it change (slower debounce — charts are heavier).
  watchData(['products', 'sales', 'onlineOrders', 'inventoryLog'], () => renderers[activeTab]?.(), { debounceMs: 1000 });
  await renderPerformanceTab();
}

async function renderPerformanceTab() {
  const rows = await getProductPerformance();

  new DataTable(document.getElementById('performance-table'), {
    columns: [
      { key: 'name', label: 'Product', sortable: true, render: (row) => escapeHTML(row.product.name) },
      { key: 'units', label: 'Units Sold', align: 'right', sortable: true },
      { key: 'revenue', label: 'Revenue', align: 'right', sortable: true, render: (row) => formatCurrency(row.revenue) },
      { key: 'profit', label: 'Profit', align: 'right', sortable: true, render: (row) => formatCurrency(row.profit) },
      { key: 'marginPercent', label: 'Margin', align: 'right', sortable: true, render: (row) => `${row.marginPercent.toFixed(1)}%` },
    ],
    pageSize: 10, searchKeys: [], rowKey: (row) => row.product.id,
    defaultSort: { key: 'revenue', dir: 'desc' },
    emptyState: { icon: 'fa-chart-line', title: 'No sales history yet' },
  }).setData(rows);
}

async function renderFastMoversTab() {
  const rows = await getFastMovers(14, 8);
  const colors = getChartColors();
  const container = document.getElementById('fast-movers-chart-wrap');

  if (!rows.length) {
    renderEmptyState(container, { icon: 'fa-bolt', title: 'No sales in the last 14 days', message: 'Fast movers will appear once products start selling.' });
    return;
  }
  container.innerHTML = '<canvas id="fast-movers-chart"></canvas>';

  renderChart('fast-movers-chart', {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.product.name),
      datasets: [{ label: 'Units sold (14d)', data: rows.map((r) => r.units), backgroundColor: colors.success, borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { color: colors.gridLine }, beginAtZero: true }, y: { grid: { display: false } } },
      plugins: { legend: { display: false } },
    },
  });
}

async function renderDeadStockTab() {
  const rows = await getDeadStock(30);

  new DataTable(document.getElementById('dead-stock-table'), {
    columns: [
      { key: 'name', label: 'Product', sortable: true, render: (row) => escapeHTML(row.product.name) },
      { key: 'sku', label: 'SKU', render: (row) => escapeHTML(row.product.sku) },
      { key: 'stockQuantity', label: 'Units on Hand', align: 'right', sortable: true, render: (row) => row.product.stockQuantity },
      { key: 'tiedUpValue', label: 'Capital Tied Up', align: 'right', sortable: true, render: (row) => formatCurrency(row.tiedUpValue) },
    ],
    pageSize: 10, searchKeys: [], rowKey: (row) => row.product.id,
    defaultSort: { key: 'tiedUpValue', dir: 'desc' },
    emptyState: { icon: 'fa-boxes-packing', title: 'No dead stock', message: 'Everything in stock has sold within the last 30 days.' },
  }).setData(rows);
}
