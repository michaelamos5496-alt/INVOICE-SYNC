/**
 * custom-receipt.js — a receipt you fill in by hand: any customer, items, prices, date and notes. It is NOT a
 * sale — nothing is saved, stock isn't touched and it never appears in Sales or Reports. Use it for a quote
 * copy, a receipt for an off-system payment, or re-issuing one to a customer. Print it, save it as a PDF, or
 * share it (WhatsApp, email, iMessage).
 */
import { api } from '../services/api.service.js';
import { getSettings, getBrandName } from '../services/settings.service.js';
import { getActorName } from '../services/auth.service.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { formatCurrency } from '../utils/formatters.js';
import { escapeHTML } from '../utils/helpers.js';
import { htmlToPdfBlob, downloadBlob, sharePdfBlob } from '../utils/pdf.js';

const PAYMENT_METHODS = ['Cash', 'Card', 'Mobile Money', 'Bank Transfer', 'Other'];

const RECEIPT_CSS = `<style>
  .rc{font:12px/1.45 'Courier New',ui-monospace,monospace;color:#111;padding:6px 4px;width:100%}
  .rc .c{text-align:center}.rc .r{text-align:right}.rc .m{color:#666}.rc h2{font-size:15px;margin:0 0 2px}
  .rc table{width:100%;border-collapse:collapse}.rc td{padding:2px 0;vertical-align:top}
  .rc hr{border:0;border-top:1px dashed #999;margin:8px 0}
  .rc .tot{font-size:14px;font-weight:700}.rc .row{display:flex;justify-content:space-between;gap:8px}
</style>`;

const pad = (n) => String(n).padStart(2, '0');
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const newNumber = () => { const d = new Date(); return `R-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Math.floor(1000 + Math.random() * 9000)}`; };

function totals(d) {
  const subtotal = d.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const discount = Math.min(subtotal, Math.max(0, Number(d.discount) || 0));
  const tax = (subtotal - discount) * ((Number(d.taxPercent) || 0) / 100);
  const total = subtotal - discount + tax;
  const paid = d.paid === '' || d.paid == null ? null : Number(d.paid) || 0;
  return { subtotal, discount, tax, total, paid, balance: paid == null ? null : paid - total };
}

/** The receipt itself — used for the live preview, printing and the PDF. Everything typed is escaped. */
function receiptHTML(d) {
  const s = getSettings();
  const t = totals(d);
  const items = d.items.filter((i) => i.name.trim() || Number(i.price));
  const when = d.date ? new Date(d.date) : new Date();
  const line = (a, b, cls = '') => `<div class="row ${cls}"><span>${a}</span><span>${b}</span></div>`;
  return `<div class="rc">
    <div class="c"><h2>${escapeHTML(getBrandName())}</h2>
      ${s.storeAddress ? `<div class="m">${escapeHTML(s.storeAddress)}</div>` : ''}
      ${s.storePhone ? `<div class="m">${escapeHTML(s.storePhone)}</div>` : ''}
      <div style="margin-top:6px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${escapeHTML(d.title || 'Receipt')}</div>
    </div>
    <hr />
    ${line('No.', escapeHTML(d.number))}
    ${line('Date', escapeHTML(when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })))}
    ${d.customer.trim() ? line('Customer', escapeHTML(d.customer.trim())) : ''}
    ${d.phone.trim() ? line('Phone', escapeHTML(d.phone.trim())) : ''}
    ${d.servedBy.trim() ? line('Served by', escapeHTML(d.servedBy.trim())) : ''}
    <hr />
    <table>${items.length ? items.map((i) => `<tr><td>${escapeHTML(i.name || 'Item')}<div class="m">${Number(i.qty) || 0} × ${formatCurrency(Number(i.price) || 0)}</div></td><td class="r">${formatCurrency((Number(i.qty) || 0) * (Number(i.price) || 0))}</td></tr>`).join('') : '<tr><td class="m">No items yet</td><td></td></tr>'}</table>
    <hr />
    ${line('Subtotal', formatCurrency(t.subtotal))}
    ${t.discount ? line('Discount', `− ${formatCurrency(t.discount)}`) : ''}
    ${t.tax ? line(`Tax (${Number(d.taxPercent)}%)`, formatCurrency(t.tax)) : ''}
    ${line('TOTAL', formatCurrency(t.total), 'tot')}
    <hr />
    ${line('Paid via', escapeHTML(d.method))}
    ${t.paid != null ? line('Amount paid', formatCurrency(t.paid)) : ''}
    ${t.paid != null && t.balance > 0 ? line('Change', formatCurrency(t.balance)) : ''}
    ${t.paid != null && t.balance < 0 ? line('Balance due', formatCurrency(-t.balance)) : ''}
    ${d.notes.trim() ? `<hr /><div class="m">${escapeHTML(d.notes.trim()).replace(/\n/g, '<br>')}</div>` : ''}
    <hr /><div class="c">${escapeHTML(d.footer || '')}</div>
  </div>`;
}

export async function openCustomReceipt() {
  const [customers, products] = await Promise.all([api.customers.list(), api.products.list()]);
  const d = {
    title: 'Receipt', number: newNumber(), date: localInput(new Date()), customer: '', phone: '', servedBy: getActorName?.() ?? '',
    items: [{ name: '', qty: 1, price: '' }], discount: '', taxPercent: '', method: 'Cash', paid: '', notes: '',
    footer: 'Thank you for shopping with us!',
  };
  const field = (label, html, cls = '') => `<div class="${cls}"><label class="field-label">${label}</label>${html}</div>`;
  const inp = (key, attrs = '') => `<input class="input" data-k="${key}" value="${escapeHTML(d[key] ?? '')}" ${attrs} />`;

  const el = modal.open({
    title: 'Custom Receipt',
    size: 'xl',
    bodyHTML: `
      <p class="text-sm text-[var(--text-secondary)] mb-4">Make a receipt without recording a sale — nothing is saved, and stock and reports are not affected.</p>
      <div class="grid lg:grid-cols-5 gap-6">
        <div class="lg:col-span-3 space-y-4">
          <div class="grid sm:grid-cols-2 gap-3">
            ${field('Document title', inp('title', 'placeholder="Receipt"'))}
            ${field('Receipt number', inp('number'))}
            ${field('Date & time', inp('date', 'type="datetime-local"'))}
            ${field('Served by', inp('servedBy'))}
            ${field('Customer name', inp('customer', 'list="cr-customers" placeholder="Walk-in customer"'))}
            ${field('Customer phone', inp('phone', 'type="tel" inputmode="tel"'))}
          </div>
          <datalist id="cr-customers">${customers.map((c) => `<option value="${escapeHTML(c.name)}"></option>`).join('')}</datalist>

          <div>
            <div class="flex items-center justify-between mb-2">
              <p class="field-label !mb-0">Items</p>
              <select id="cr-pick" class="input input-sm w-auto max-w-[14rem]" aria-label="Add from products">
                <option value="">Add from products…</option>
                ${products.map((p) => `<option value="${p.id}">${escapeHTML(p.name)} — ${formatCurrency(p.sellingPrice)}</option>`).join('')}
              </select>
            </div>
            <div id="cr-items" class="space-y-2"></div>
            <button type="button" id="cr-add" class="btn btn-secondary btn-sm mt-2"><i class="fa-solid fa-plus"></i> Add item</button>
          </div>

          <div class="grid sm:grid-cols-3 gap-3">
            ${field('Discount (amount)', inp('discount', 'type="number" min="0" step="any" inputmode="decimal"'))}
            ${field('Tax %', inp('taxPercent', 'type="number" min="0" max="100" step="any" inputmode="decimal"'))}
            ${field('Payment method', `<select class="input" data-k="method">${PAYMENT_METHODS.map((m) => `<option>${m}</option>`).join('')}</select>`)}
            ${field('Amount paid (optional)', inp('paid', 'type="number" min="0" step="any" inputmode="decimal"'), 'sm:col-span-3')}
          </div>
          ${field('Notes', '<textarea class="input" rows="2" data-k="notes" placeholder="Optional — shown on the receipt"></textarea>')}
          ${field('Footer message', inp('footer'))}
        </div>

        <div class="lg:col-span-2">
          <p class="field-label">Preview</p>
          <div id="cr-preview" class="border rounded-[var(--radius-md)] p-3 bg-white text-black overflow-x-auto" style="border-color: var(--border-subtle); max-width: 22rem"></div>
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Close</button>
      <button class="btn btn-secondary" id="cr-print" type="button"><i class="fa-solid fa-print"></i> Print</button>
      <button class="btn btn-secondary" id="cr-pdf" type="button"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
      <button class="btn btn-primary" id="cr-share" type="button"><i class="fa-solid fa-share-nodes"></i> Share</button>`,
  });

  const preview = el.querySelector('#cr-preview');
  const draw = () => { preview.innerHTML = receiptHTML(d); };

  const drawItems = () => {
    el.querySelector('#cr-items').innerHTML = d.items.map((it, i) => `
      <div class="grid grid-cols-12 gap-2 items-center">
        <input class="input col-span-6" placeholder="Item description" aria-label="Item ${i + 1} description" value="${escapeHTML(it.name)}" data-i="${i}" data-f="name" />
        <input class="input col-span-2" type="number" min="0" step="any" inputmode="decimal" placeholder="Qty" aria-label="Item ${i + 1} quantity" value="${escapeHTML(it.qty)}" data-i="${i}" data-f="qty" />
        <input class="input col-span-3" type="number" min="0" step="any" inputmode="decimal" placeholder="Price" aria-label="Item ${i + 1} price" value="${escapeHTML(it.price)}" data-i="${i}" data-f="price" />
        <button type="button" class="btn btn-ghost btn-sm col-span-1" data-rm="${i}" aria-label="Remove item ${i + 1}"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join('');
    el.querySelectorAll('[data-f]').forEach((input) => input.addEventListener('input', () => { d.items[Number(input.dataset.i)][input.dataset.f] = input.value; draw(); }));
    el.querySelectorAll('[data-rm]').forEach((btn) => btn.addEventListener('click', () => {
      d.items.splice(Number(btn.dataset.rm), 1);
      if (!d.items.length) d.items.push({ name: '', qty: 1, price: '' });
      drawItems(); draw();
    }));
  };

  el.querySelectorAll('[data-k]').forEach((input) => input.addEventListener('input', () => { d[input.dataset.k] = input.value; draw(); }));
  el.querySelector('#cr-add').addEventListener('click', () => { d.items.push({ name: '', qty: 1, price: '' }); drawItems(); draw(); el.querySelector(`[data-i="${d.items.length - 1}"][data-f="name"]`)?.focus(); });
  el.querySelector('#cr-pick').addEventListener('change', (e) => {
    const p = products.find((x) => x.id === e.target.value);
    e.target.value = '';
    if (!p) return;
    const blank = d.items.length === 1 && !d.items[0].name && !d.items[0].price;
    const entry = { name: p.name, qty: 1, price: p.sellingPrice };
    if (blank) d.items[0] = entry; else d.items.push(entry);
    drawItems(); draw();
  });

  const guard = () => {
    if (!d.items.some((i) => i.name.trim() && Number(i.price) >= 0 && Number(i.qty) > 0)) { toast.danger('Add at least one item with a description and quantity.'); return false; }
    return true;
  };
  const fileName = () => `${(d.title || 'receipt').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${d.number}.pdf`;
  const busy = async (btn, fn) => {
    if (!guard()) return;
    btn.disabled = true;
    try { return await fn(); } catch (err) { toast.danger(err.message); } finally { btn.disabled = false; }
  };
  const makePdf = () => htmlToPdfBlob({ styleHTML: RECEIPT_CSS, bodyHTML: receiptHTML(d), widthMm: 80, marginMm: 4 });

  el.querySelector('#cr-print').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const win = window.open('', '_blank');
    if (!win) throw new Error('Allow pop-ups for this site to print.');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHTML(d.title || 'Receipt')}</title>${RECEIPT_CSS}<style>body{margin:0;max-width:80mm}@page{margin:4mm}</style></head><body>${receiptHTML(d)}<script>onload=()=>setTimeout(()=>print(),200)<\/script></body></html>`);
    win.document.close();
  }));
  el.querySelector('#cr-pdf').addEventListener('click', (e) => busy(e.currentTarget, async () => downloadBlob(await makePdf(), fileName())));
  el.querySelector('#cr-share').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const r = await sharePdfBlob(await makePdf(), fileName(), { title: `${d.title || 'Receipt'} ${d.number}`, text: `${getBrandName()} — ${d.title || 'receipt'} ${d.number}` });
    if (r === 'downloaded') toast.info('Sharing isn\'t supported here, so the PDF was downloaded — attach it in WhatsApp or email.');
  }));

  drawItems();
  draw();
}
