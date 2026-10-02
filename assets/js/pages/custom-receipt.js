/**
 * custom-receipt.js — a receipt you fill in by hand: any customer, items, prices, date and notes. It is NOT a
 * sale — stock isn't touched and it never appears in Sales or Reports. Use it for a receipt for an off-system
 * payment, or re-issuing one to a customer. Receipts are saved with a running number (R-0001…), shared across
 * devices, and can be reopened, edited, duplicated or deleted from the history. Print one, download it as a PDF,
 * or share it (WhatsApp, email, iMessage). Printing or sharing an unsaved receipt saves it first.
 */
import { api } from '../services/api.service.js';
import { getSettings, getBrandName } from '../services/settings.service.js';
import { getActorName } from '../services/auth.service.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { formatCurrency } from '../utils/formatters.js';
import { escapeHTML } from '../utils/helpers.js';
import { listReceipts, nextReceiptNumber, saveReceipt, deleteReceipt, computeReceiptTotals } from '../services/receipts.service.js';
import { htmlToPdfBlob, downloadBlob, sharePdfBlob } from '../utils/pdf.js';
import { RECEIPT_CSS, paperControlsHTML, bindPaperControls, receiptLogoHTML, sizedBody, pdfOptions, printReceipt } from '../utils/receipt-print.js';

const PAYMENT_METHODS = ['Cash', 'Card', 'Mobile Money', 'Bank Transfer', 'Other'];



const pad = (n) => String(n).padStart(2, '0');
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const totals = (d) => computeReceiptTotals(d);

/** The receipt itself — used for the live preview, printing and the PDF. Everything typed is escaped. */
function receiptHTML(d, { logo = false } = {}) {
  const s = getSettings();
  const t = totals(d);
  const cur = (n) => formatCurrency(n, d.currency || undefined);
  const items = d.items.filter((i) => i.name.trim() || Number(i.price));
  const when = d.date ? new Date(d.date) : new Date();
  const line = (a, b, cls = '') => `<div class="row ${cls}"><span>${a}</span><span>${b}</span></div>`;
  return `<div class="rc">
    <div class="c">${logo ? receiptLogoHTML(s.brandLogo) : ''}<h2>${escapeHTML(getBrandName())}</h2>
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
    <table>${items.length ? items.map((i) => `<tr><td>${escapeHTML(i.name || 'Item')}<div class="m">${Number(i.qty) || 0} × ${cur(Number(i.price) || 0)}</div></td><td class="r">${cur((Number(i.qty) || 0) * (Number(i.price) || 0))}</td></tr>`).join('') : '<tr><td class="m">No items yet</td><td></td></tr>'}</table>
    <hr />
    ${line('Subtotal', cur(t.subtotal))}
    ${t.discount ? line('Discount', `− ${cur(t.discount)}`) : ''}
    ${t.tax ? line(`Tax (${Number(d.taxPercent)}%)`, cur(t.tax)) : ''}
    ${line('TOTAL', cur(t.total), 'tot')}
    <hr />
    ${line('Paid via', escapeHTML(d.method))}
    ${t.paid != null ? line('Amount paid', cur(t.paid)) : ''}
    ${t.paid != null && t.balance > 0 ? line('Change', cur(t.balance)) : ''}
    ${t.paid != null && t.balance < 0 ? line('Balance due', cur(-t.balance)) : ''}
    ${d.notes.trim() ? `<hr /><div class="m">${escapeHTML(d.notes.trim()).replace(/\n/g, '<br>')}</div>` : ''}
    <hr /><div class="c">${escapeHTML(d.footer || '')}</div>
  </div>`;
}

/** Opens the receipt maker — blank, or loaded from a saved receipt (`existing`) to view, edit or reprint it. */
export async function openCustomReceipt(existing = null) {
  const [customers, products, nextNumber] = await Promise.all([api.customers.list(), api.products.list(), existing ? null : nextReceiptNumber()]);
  const d = existing ? {
    ...existing, date: existing.date ?? localInput(new Date()),
    items: existing.items.map((i) => ({ ...i })), discount: existing.discount || '', taxPercent: existing.taxPercent || '', paid: existing.paid ?? '',
  } : {
    id: null, title: 'Receipt', number: nextNumber, date: localInput(new Date()), customer: '', phone: '', servedBy: getActorName?.() ?? '',
    items: [{ name: '', qty: 1, price: '' }], discount: '', taxPercent: '', method: 'Cash', paid: '', notes: '',
    footer: 'Thank you for shopping with us!',
  };
  const field = (label, html, cls = '') => `<div class="${cls}"><label class="field-label">${label}</label>${html}</div>`;
  const inp = (key, attrs = '') => `<input class="input" data-k="${key}" value="${escapeHTML(d[key] ?? '')}" ${attrs} />`;

  const el = modal.open({
    title: d.id ? `Receipt ${escapeHTML(d.number)}` : 'Custom Receipt',
    size: 'xl',
    bodyHTML: `
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p class="text-sm text-[var(--text-secondary)]">Receipts are saved with their own number. They are not sales — stock and reports are not affected.</p>
        <button type="button" id="cr-history" class="btn btn-secondary btn-sm"><i class="fa-solid fa-clock-rotate-left"></i> Saved receipts</button>
      </div>
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
            ${field('Payment method', `<select class="input" data-k="method">${PAYMENT_METHODS.map((m) => `<option ${m === d.method ? 'selected' : ''}>${m}</option>`).join('')}</select>`)}
            ${field('Amount paid (optional)', inp('paid', 'type="number" min="0" step="any" inputmode="decimal"'), 'sm:col-span-3')}
          </div>
          ${field('Notes', `<textarea class="input" rows="2" data-k="notes" placeholder="Optional — shown on the receipt">${escapeHTML(d.notes ?? '')}</textarea>`)}
          ${field('Footer message', inp('footer'))}
        </div>

        <div class="lg:col-span-2">
          <p class="field-label">Preview</p>
          <div id="cr-preview" class="border rounded-[var(--radius-md)] p-3 bg-white text-black overflow-x-auto" style="border-color: var(--border-subtle); max-width: 22rem"></div>
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Close</button>
      <button class="btn btn-secondary" id="cr-save" type="button"><i class="fa-solid fa-floppy-disk"></i> ${d.id ? 'Save changes' : 'Save'}</button>
      ${paperControlsHTML('cr', { hasLogo: Boolean(getSettings().brandLogo) })}
      <button class="btn btn-secondary" id="cr-print" type="button"><i class="fa-solid fa-print"></i> Print</button>
      <button class="btn btn-secondary" id="cr-pdf" type="button"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
      <button class="btn btn-primary" id="cr-share" type="button"><i class="fa-solid fa-share-nodes"></i> Share</button>`,
  });

  const preview = el.querySelector('#cr-preview');
  const controls = bindPaperControls(el, 'cr', { onLogoChange: () => draw() });
  const logoOn = () => controls.logo();
  const paper = () => controls.paper();
  const draw = () => { preview.innerHTML = receiptHTML(d, { logo: logoOn() }); };

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

  const fileName = () => `${(d.title || 'receipt').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${d.number}.pdf`;
  const makePdf = () => htmlToPdfBlob({ styleHTML: RECEIPT_CSS, bodyHTML: sizedBody(receiptHTML(d, { logo: logoOn() }), paper()), ...pdfOptions(paper()) });

  /** Saves (creates or updates) and keeps the form on the saved record. */
  const persist = async () => {
    const saved = await saveReceipt(d, getActorName());
    d.id = saved.id; d.number = saved.number; d.currency = saved.currency;
    el.querySelector('[data-k="number"]').value = d.number;
    el.querySelector('#modal-title').textContent = `Receipt ${d.number}`;
    return saved;
  };
  const busy = async (btn, fn, { save = false } = {}) => {
    btn.disabled = true;
    try {
      if (save) await persist(); // issuing a receipt records it
      return await fn();
    } catch (err) { toast.danger(err.message); } finally { btn.disabled = false; }
  };

  el.querySelector('#cr-save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const wasNew = !d.id;
    await persist();
    toast.success(wasNew ? `Saved as ${d.number}.` : `${d.number} updated.`);
  }));
  el.querySelector('#cr-history').addEventListener('click', () => openReceiptHistory());
  el.querySelector('#cr-print').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    await printReceipt({ bodyHTML: receiptHTML(d, { logo: logoOn() }), title: d.title || 'Receipt', paper: paper() });
  }, { save: true }));
  el.querySelector('#cr-pdf').addEventListener('click', (e) => busy(e.currentTarget, async () => downloadBlob(await makePdf(), fileName()), { save: true }));
  el.querySelector('#cr-share').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const r = await sharePdfBlob(await makePdf(), fileName(), { title: `${d.title || 'Receipt'} ${d.number}`, text: `${getBrandName()} — ${d.title || 'receipt'} ${d.number}` });
    if (r === 'downloaded') toast.info('Sharing isn\'t supported here, so the PDF was downloaded — attach it in WhatsApp or email.');
  }, { save: true }));

  drawItems();
  draw();
}

// ---------------------------------------------------------------------
// Saved receipts
// ---------------------------------------------------------------------
export async function openReceiptHistory() {
  const receipts = await listReceipts();
  const rowHTML = (r) => `
    <tr data-rid="${r.id}">
      <td class="py-2 pr-3 font-mono font-medium whitespace-nowrap">${escapeHTML(r.number)}</td>
      <td class="py-2 pr-3">${escapeHTML(r.customer || 'Walk-in customer')}<div class="text-xs text-[var(--text-muted)]">${escapeHTML(r.title)}</div></td>
      <td class="py-2 pr-3 whitespace-nowrap text-sm">${escapeHTML(new Date(r.date).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</td>
      <td class="py-2 pr-3 text-right whitespace-nowrap font-medium">${formatCurrency(r.total, r.currency)}</td>
      <td class="py-2 text-right whitespace-nowrap">
        <button type="button" class="btn btn-ghost btn-sm" data-open="${r.id}" aria-label="Open ${escapeHTML(r.number)}"><i class="fa-solid fa-eye"></i></button>
        <button type="button" class="btn btn-ghost btn-sm" data-dup="${r.id}" aria-label="Duplicate ${escapeHTML(r.number)}"><i class="fa-solid fa-copy"></i></button>
        <button type="button" class="btn btn-ghost btn-sm" data-del="${r.id}" aria-label="Delete ${escapeHTML(r.number)}"><i class="fa-solid fa-trash-can"></i></button>
      </td>
    </tr>`;

  const el = modal.open({
    title: 'Saved Receipts',
    size: 'lg',
    bodyHTML: `
      <div class="flex flex-wrap items-center gap-3 mb-3">
        <input id="rh-search" class="input flex-1 min-w-[12rem]" placeholder="Search by number, customer or title…" aria-label="Search receipts" />
        <button type="button" id="rh-new" class="btn btn-primary btn-sm"><i class="fa-solid fa-plus"></i> New receipt</button>
      </div>
      <div class="overflow-x-auto"><table class="w-full text-left"><tbody id="rh-rows"></tbody></table></div>
      <p id="rh-empty" class="text-sm text-[var(--text-muted)] py-6 text-center" hidden>No saved receipts yet. Make one and press Save.</p>`,
    footerHTML: '<button class="btn btn-secondary" data-modal-close type="button">Close</button>',
  });

  let list = receipts;
  const draw = () => {
    const q = el.querySelector('#rh-search').value.trim().toLowerCase();
    const shown = list.filter((r) => !q || `${r.number} ${r.customer} ${r.title}`.toLowerCase().includes(q));
    el.querySelector('#rh-rows').innerHTML = shown.map(rowHTML).join('');
    const empty = el.querySelector('#rh-empty');
    empty.hidden = shown.length > 0;
    empty.textContent = list.length ? 'No receipts match that search.' : 'No saved receipts yet. Make one and press Save.';
  };
  draw();
  el.querySelector('#rh-search').addEventListener('input', draw);
  el.querySelector('#rh-new').addEventListener('click', () => { modal.close(); openCustomReceipt(); });
  el.querySelector('#rh-rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const find = (id) => list.find((r) => r.id === id);
    if (btn.dataset.open) { modal.close(); openCustomReceipt(find(btn.dataset.open)); }
    if (btn.dataset.dup) {
      const { id, number, createdAt, updatedAt, ...rest } = find(btn.dataset.dup);
      modal.close();
      openCustomReceipt({ ...rest, id: null, number: await nextReceiptNumber(), date: localInput(new Date()) });
    }
    if (btn.dataset.del) {
      const r = find(btn.dataset.del);
      const ok = await modal.confirm({ title: `Delete ${r.number}?`, message: 'This removes the saved receipt. It can\'t be undone.', confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      try { await deleteReceipt(r.id, getActorName()); toast.success(`${r.number} deleted.`); } catch (err) { toast.danger(err.message); return; }
      openReceiptHistory();
    }
  });
}
