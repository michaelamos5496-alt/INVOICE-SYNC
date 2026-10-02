/**
 * receipt-print.js — printing options shared by the POS receipt and the custom receipt maker.
 *
 * Why this exists: printing used to call window.print() on the page itself (POS) or open a pop-up after an
 * async save (custom receipts). The first printed the app's dark theme as white-on-white; the second was
 * often blocked as a pop-up. Here a receipt is printed from a hidden iframe holding a plain black-on-white
 * document, sized to the chosen paper, so it comes out the same whatever the app theme or browser.
 */
import { storage } from '../services/storage.service.js';

/** Paper sizes by the machine that prints on them. `contentMm` is the printable column (a thermal printer can't print to the paper's edge). */
export const PAPERS = Object.freeze({
  t58:  { group: 'Thermal receipt printers', label: '58 mm — Xprinter XP-58, POS-58, most mini/Bluetooth printers', pageSize: '58mm auto',  pageMm: 58,  contentMm: 48,  marginMm: 3 },
  t76:  { group: 'Thermal receipt printers', label: '76 mm — Epson TM-U220 and other dot-matrix receipt printers', pageSize: '76mm auto',  pageMm: 76,  contentMm: 66,  marginMm: 4 },
  t80:  { group: 'Thermal receipt printers', label: '80 mm — Epson TM-T20/T88, Xprinter XP-80, Star TSP100, Rongta', pageSize: '80mm auto',  pageMm: 80,  contentMm: 72,  marginMm: 4 },
  t112: { group: 'Thermal receipt printers', label: '112 mm — wide roll printers (e.g. Epson TM-H6000)',           pageSize: '112mm auto', pageMm: 112, contentMm: 100, marginMm: 6 },
  a6:   { group: 'Sheet printers',           label: 'A6 (105 × 148 mm) — label / small-sheet printers',            pageSize: 'A6',         pageMm: 105, contentMm: 90,  marginMm: 8,  format: 'a6' },
  a5:   { group: 'Sheet printers',           label: 'A5 (148 × 210 mm) — office inkjet / laser',                   pageSize: 'A5',         pageMm: 148, contentMm: 110, marginMm: 10, format: 'a5' },
  a4:   { group: 'Sheet printers',           label: 'A4 (210 × 297 mm) — office inkjet / laser',                   pageSize: 'A4',         pageMm: 210, contentMm: 110, marginMm: 14, format: 'a4' },
  letter: { group: 'Sheet printers',         label: 'US Letter (216 × 279 mm)',                                    pageSize: 'letter',     pageMm: 216, contentMm: 110, marginMm: 14, format: 'letter' },
});

export const CUSTOM_PAPER = 'custom';
const CUSTOM_MIN_MM = 30;
const CUSTOM_MAX_MM = 300;

/** The paper for a key, including "custom width" (a roll of any width, read from the saved preference). */
export function paperFor(key, customMm = getPrintPrefs().customMm) {
  if (key === CUSTOM_PAPER) {
    const w = Math.min(CUSTOM_MAX_MM, Math.max(CUSTOM_MIN_MM, Number(customMm) || 80));
    return { label: `Custom ${w} mm`, pageSize: `${w}mm auto`, pageMm: w, contentMm: Math.max(20, w - 8), marginMm: 4 };
  }
  return PAPERS[key] ?? PAPERS.t80;
}

export const RECEIPT_CSS = `<style>
  .rc{font:12px/1.45 'Courier New',ui-monospace,monospace;color:#111;padding:6px 4px;width:100%}
  .rc .c{text-align:center}.rc .r{text-align:right}.rc .m{color:#666}.rc h2{font-size:15px;margin:0 0 2px}
  .rc table{width:100%;border-collapse:collapse}.rc td{padding:2px 0;vertical-align:top}
  .rc hr{border:0;border-top:1px dashed #999;margin:8px 0}
  .rc .tot{font-size:14px;font-weight:700}.rc .row{display:flex;justify-content:space-between;gap:8px}
  .rc img.logo{display:block;margin:0 auto 6px;max-height:52px;max-width:60%;object-fit:contain}
</style>`;

const PREF_KEY = 'onedesk.print';

export function getPrintPrefs() {
  const saved = storage.get(PREF_KEY, {}) ?? {};
  return {
    paper: PAPERS[saved.paper] || saved.paper === CUSTOM_PAPER ? saved.paper : 't80',
    customMm: Number(saved.customMm) || 80,
    logo: saved.logo !== false,
  };
}
export const setPrintPrefs = (patch) => storage.set(PREF_KEY, { ...getPrintPrefs(), ...patch });

/** <option>s for the paper <select>, grouped by kind of machine. */
export function paperOptionsHTML(selected = getPrintPrefs().paper) {
  const groups = {};
  Object.entries(PAPERS).forEach(([key, p]) => { (groups[p.group] ??= []).push(`<option value="${key}" ${key === selected ? 'selected' : ''}>${p.label}</option>`); });
  return Object.entries(groups).map(([name, opts]) => `<optgroup label="${name}">${opts.join('')}</optgroup>`).join('')
    + `<optgroup label="Other"><option value="${CUSTOM_PAPER}" ${selected === CUSTOM_PAPER ? 'selected' : ''}>Custom roll width…</option></optgroup>`;
}

/** The paper controls (size picker, custom width, logo tick) for a screen's footer. `prefix` keeps element ids unique. */
export function paperControlsHTML(prefix, { hasLogo = false } = {}) {
  const prefs = getPrintPrefs();
  return `<span class="flex flex-wrap items-center gap-2 mr-auto">
    <label class="sr-only" for="${prefix}-paper">Printer paper size</label>
    <select id="${prefix}-paper" class="select input-sm w-auto max-w-[15rem]" title="Pick the paper your printer uses">${paperOptionsHTML(prefs.paper)}</select>
    <span id="${prefix}-custom-wrap" class="items-center gap-1 text-xs text-[var(--text-secondary)]" ${prefs.paper === CUSTOM_PAPER ? 'style="display:inline-flex"' : 'style="display:none"'}>
      <input id="${prefix}-custom" class="input input-sm w-20" type="number" min="${CUSTOM_MIN_MM}" max="${CUSTOM_MAX_MM}" step="1" value="${prefs.customMm}" aria-label="Roll width in millimetres" /> mm wide
    </span>
    ${hasLogo ? `<label class="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"><input id="${prefix}-logo" type="checkbox" class="checkbox" ${prefs.logo ? 'checked' : ''} /> Logo</label>` : ''}
  </span>`;
}

/** Wires the controls above. Returns getters; `onLogoChange` fires when the Logo tick changes (to redraw a preview). */
export function bindPaperControls(root, prefix, { onLogoChange } = {}) {
  const select = root.querySelector(`#${prefix}-paper`);
  const wrap = root.querySelector(`#${prefix}-custom-wrap`);
  const custom = root.querySelector(`#${prefix}-custom`);
  const logo = root.querySelector(`#${prefix}-logo`);
  select.addEventListener('change', () => { setPrintPrefs({ paper: select.value }); wrap.style.display = select.value === CUSTOM_PAPER ? 'inline-flex' : 'none'; });
  custom.addEventListener('change', () => setPrintPrefs({ customMm: Number(custom.value) || 80 }));
  logo?.addEventListener('change', () => { setPrintPrefs({ logo: logo.checked }); onLogoChange?.(); });
  return {
    paper: () => select.value,
    customMm: () => Number(custom.value) || 80,
    logo: () => Boolean(logo?.checked),
  };
}

/** The logo block for the top of a receipt ('' when no logo is set or the option is off). */
export const receiptLogoHTML = (logo) =>
  typeof logo === 'string' && logo.startsWith('data:image/') ? `<img class="logo" src="${logo}" alt="" />` : '';

/** Wraps receipt HTML in a column the width of the chosen paper (sheets get a centred receipt-width column). */
export const sizedBody = (bodyHTML, paperKey) => {
  const p = paperFor(paperKey);
  return `<div style="width:${p.contentMm}mm;margin:0 auto">${bodyHTML}</div>`;
};

/** Options for htmlToPdfBlob() so a PDF matches the chosen paper. */
export function pdfOptions(paperKey) {
  const p = paperFor(paperKey);
  return p.format ? { format: p.format, marginMm: p.marginMm } : { widthMm: p.pageMm, marginMm: p.marginMm };
}

/**
 * Prints receipt HTML on the chosen paper through a hidden iframe (no pop-up, so nothing to allow).
 * Resolves once the print dialog has been requested.
 */
export async function printReceipt({ bodyHTML, title = 'Receipt', paper = 't80' }) {
  const p = paperFor(paper);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title.replace(/[<>&]/g, '')}</title>${RECEIPT_CSS}
    <style>@page{size:${p.pageSize};margin:${p.marginMm}mm}
    html,body{margin:0;padding:0;background:#fff;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
    </head><body>${sizedBody(bodyHTML, paper)}</body></html>`);
  doc.close();

  // Let the logo finish decoding, or it prints as a blank box.
  await Promise.all([...doc.images].map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60_000); // long enough for any print dialog to have read the document
}
