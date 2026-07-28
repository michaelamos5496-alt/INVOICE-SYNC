/**
 * helpers.js — small generic utilities shared across pages/components.
 */

const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapes a value for safe interpolation into an innerHTML template
 * literal. Every page in this app builds table rows, modal bodies, and
 * list items via `container.innerHTML = \`...${userValue}...\``, which
 * is fast to write but executes any HTML/script a user types into a
 * name, note, or reason field. Wrap every such value in escapeHTML()
 * before interpolating it. Values that are only ever set by this app
 * itself (ids, enum statuses, numbers already run through formatCurrency)
 * don't need it — only text a user could have typed.
 */
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

/**
 * Guards against `javascript:`/`data:text/html` URLs someone could paste
 * into an image-URL field and have rendered straight into an <img src>.
 * Only http(s) and data:image/* are allowed through.
 */
export function isSafeImageUrl(url) {
  return /^(https?:\/\/|data:image\/)/i.test(String(url ?? '').trim());
}

/** Debounce for search inputs / resize handlers. */
export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Reads the current page's active nav key from a data attribute on <body>. */
export function getActivePage() {
  return document.body.dataset.page ?? '';
}

/** Fetches and injects an HTML partial (sidebar/topbar) into a container. */
export async function injectPartial(containerSelector, partialPath) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  const res = await fetch(partialPath);
  container.innerHTML = await res.text();
}

/** Simple query-param helper for deep-linkable filters/pagination. */
export function getQueryParam(name, fallback = null) {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

export function setQueryParam(name, value) {
  const url = new URL(window.location.href);
  if (value === null || value === undefined || value === '') {
    url.searchParams.delete(name);
  } else {
    url.searchParams.set(name, value);
  }
  window.history.replaceState({}, '', url);
}

/** Paginates an array client-side. */
export function paginate(items, page = 1, pageSize = 10) {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
    page,
  };
}

/** Exports an array of objects as a downloadable CSV file. */
export function exportToCSV(rows, filename = 'export.csv') {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Parses CSV text (as produced by exportToCSV, Excel, or Google Sheets)
 * into an array of plain objects keyed by the header row. Handles quoted
 * fields containing commas — enough for the Bulk Import flow without
 * pulling in a parsing library.
 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') inQuotes = false;
      else field += char;
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      if (field.length > 0 || row.length > 0) pushRow();
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  const [headers, ...dataRows] = rows;
  if (!headers) return [];
  return dataRows.filter((r) => r.some((v) => v !== '')).map((r) =>
    Object.fromEntries(headers.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** Generates a scannable barcode-safe SKU, e.g. for new products. */
export function generateSKU(prefix = 'SKU') {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${Date.now().toString().slice(-6)}-${rand}`;
}

export function classNames(...args) {
  return args.filter(Boolean).join(' ');
}
