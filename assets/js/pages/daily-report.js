/**
 * daily-report.js — builds a one-day sales report as a clean, print-ready
 * page (opened in a new tab; the browser's "Save as PDF" turns it into a
 * download) or as a CSV of that day's orders. Every value that came from
 * user-typed data goes through escapeHTML.
 */
import { getDailyReport } from '../services/reports.service.js';
import { getBrandName } from '../services/settings.service.js';
import { formatCurrency, formatDateTime } from '../utils/formatters.js';
import { escapeHTML, exportToCSV } from '../utils/helpers.js';
import { htmlToPdfBlob, downloadBlob, sharePdfBlob } from '../utils/pdf.js';

const label = (key) => escapeHTML(String(key).replace(/_/g, ' '));
const orderNo = (o) => `#${o.id.slice(-6).toUpperCase()}`;
const time = (o) => new Date(o.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function kv(obj) {
  const rows = Object.entries(obj);
  if (!rows.length) return '<p class="muted">No sales.</p>';
  return `<table>${rows.map(([k, v]) => `<tr><td class="cap">${label(k)}</td><td class="r">${formatCurrency(v)}</td></tr>`).join('')}</table>`;
}

function buildHTML(r) {
  const dateLong = r.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const stat = (t, v) => `<div class="stat"><div class="k">${t}</div><div class="v">${v}</div></div>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Daily Report · ${escapeHTML(dateLong)}</title>
<style>
  *{box-sizing:border-box} body{font:13px/1.45 -apple-system,Inter,Segoe UI,sans-serif;color:#1f2430;margin:0;padding:32px;max-width:900px;margin:auto}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0d9488;padding-bottom:12px;margin-bottom:20px}
  h1{font-size:22px;margin:0} h2{font-size:14px;margin:26px 0 8px;text-transform:uppercase;letter-spacing:.05em;color:#0d9488}
  .muted{color:#6b7280}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .stat{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px}.k{font-size:11px;color:#6b7280;text-transform:uppercase}.v{font-size:18px;font-weight:700;margin-top:2px}
  table{width:100%;border-collapse:collapse}th{text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #d1d5db;padding:6px 8px}
  td{padding:6px 8px;border-bottom:1px solid #f0f1f4;vertical-align:top}.r{text-align:right}th.r{text-align:right}.cap{text-transform:capitalize}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:24px} tfoot td{font-weight:700;border-top:2px solid #1f2430;border-bottom:0}
  tr{page-break-inside:avoid} footer{margin-top:28px;font-size:11px;color:#9ca3af;text-align:center}
  @media print{body{padding:0}@page{margin:14mm}}
</style></head><body>
<header><div><h1>${escapeHTML(getBrandName())}</h1><div class="muted">Daily Sales Report</div></div>
<div style="text-align:right"><strong>${escapeHTML(dateLong)}</strong><div class="muted">Generated ${escapeHTML(formatDateTime(new Date()))}</div></div></header>
<div class="stats">
  ${stat('Revenue', formatCurrency(r.revenue))}${stat('Orders', r.orderCount)}
  ${stat('Units sold', r.units)}${stat('Avg. order', formatCurrency(r.averageOrderValue))}
  ${stat('Gross profit', formatCurrency(r.grossProfit))}${stat('Discounts', formatCurrency(r.discounts))}
  ${stat('Tax collected', formatCurrency(r.tax))}${stat('Items / order', r.orderCount ? (r.units / r.orderCount).toFixed(1) : '0')}
</div>
<div class="two"><div><h2>By payment method</h2>${kv(r.byPaymentMethod)}</div><div><h2>By channel</h2>${kv(r.byChannel)}</div></div>
<h2>Products sold</h2>
${r.byProduct.length ? `<table><thead><tr><th>Product</th><th class="r">Units</th><th class="r">Revenue</th></tr></thead><tbody>
${r.byProduct.map((p) => `<tr><td>${escapeHTML(p.name)}</td><td class="r">${p.units}</td><td class="r">${formatCurrency(p.revenue)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No sales on this day.</p>'}
<h2>Transactions</h2>
${r.orders.length ? `<table><thead><tr><th>Time</th><th>Order</th><th>Cashier</th><th>Payment</th><th class="r">Total</th></tr></thead><tbody>
${r.orders.map((o) => `<tr><td>${time(o)}</td><td>${orderNo(o)}</td><td>${escapeHTML(o.cashier ?? (o.channel === 'online_shop' ? 'Online' : '—'))}</td><td class="cap">${label(o.paymentMethod ?? 'online_checkout')}</td><td class="r">${formatCurrency(o.total)}</td></tr>`).join('')}
</tbody><tfoot><tr><td colspan="4">Total</td><td class="r">${formatCurrency(r.revenue)}</td></tr></tfoot></table>` : '<p class="muted">No transactions.</p>'}
<footer>${escapeHTML(getBrandName())} · Daily Sales Report · ${escapeHTML(dateLong)}</footer>
</body></html>`;
}

/** Renders the report to a real PDF Blob. */
async function makePDF(dateStr) {
  const report = await getDailyReport(dateStr);
  const doc = new DOMParser().parseFromString(buildHTML(report), 'text/html');
  doc.querySelectorAll('script').forEach((n) => n.remove());
  return htmlToPdfBlob({ styleHTML: doc.head.querySelector('style').outerHTML, bodyHTML: doc.body.innerHTML });
}

const pdfName = (dateStr) => `daily-report-${dateStr}.pdf`;

export async function downloadDailyPDF(dateStr) {
  downloadBlob(await makePDF(dateStr), pdfName(dateStr));
}

/** Opens the system share sheet (WhatsApp, Mail, Messages/iMessage, AirDrop…) with the PDF attached. */
export async function shareDailyPDF(dateStr) {
  return sharePdfBlob(await makePDF(dateStr), pdfName(dateStr), {
    title: `Daily Report ${dateStr}`, text: `${getBrandName()} — daily sales report for ${dateStr}`,
  });
}

export async function downloadDailyCSV(dateStr) {
  const r = await getDailyReport(dateStr);
  exportToCSV(r.orders.map((o) => ({
    Date: dateStr, Time: time(o), Order: orderNo(o), Channel: o.channel, Cashier: o.cashier ?? '',
    Payment: o.paymentMethod ?? 'online_checkout', Items: (o.items ?? []).map((i) => `${i.quantity}x ${i.name}`).join('; '),
    Discount: (o.discountAmount ?? 0).toFixed(2), Tax: (o.taxAmount ?? 0).toFixed(2), Total: o.total.toFixed(2),
  })), `daily-report-${dateStr}.csv`);
}
