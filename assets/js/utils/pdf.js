/**
 * pdf.js — turns a piece of HTML into a real PDF file in the browser (html2pdf.js, loaded from cdnjs on first
 * use) and hands it to the user: as a download, or through the system share sheet (WhatsApp, Mail, iMessage…).
 */
const PDF_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js';
let pdfLibPromise;

function loadPdfLib() {
  if (window.html2pdf) return Promise.resolve();
  pdfLibPromise ??= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = PDF_LIB; el.onload = resolve;
    el.onerror = () => { pdfLibPromise = null; reject(new Error('Could not load the PDF tool — check your connection.')); };
    document.head.appendChild(el);
  });
  return pdfLibPromise;
}

/**
 * Renders `styleHTML` + `bodyHTML` to a PDF Blob. `widthMm` with no `heightMm` makes a single tall page that
 * fits the content (a till-roll receipt); pass `format: 'a4'` for normal paged documents.
 */
export async function htmlToPdfBlob({ styleHTML = '', bodyHTML, widthMm = null, format = 'a4', marginMm = 10 }) {
  await loadPdfLib();
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;background:#fff;width:${widthMm ? `${widthMm}mm` : '794px'}`;
  host.innerHTML = `${styleHTML}<div>${bodyHTML}</div>`;
  document.body.appendChild(host);
  try {
    const jsPDF = widthMm
      ? { unit: 'mm', format: [widthMm, Math.max(60, Math.ceil(host.offsetHeight * 0.2646) + marginMm * 2)], orientation: 'portrait' }
      : { unit: 'mm', format, orientation: 'portrait' };
    return await window.html2pdf().set({
      margin: marginMm, image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true }, jsPDF,
      pagebreak: { mode: widthMm ? ['avoid-all'] : ['css', 'legacy'] },
    }).from(host).outputPdf('blob');
  } finally { host.remove(); }
}

export function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Opens the share sheet with the PDF attached; where the browser can't share files, downloads it instead. */
export async function sharePdfBlob(blob, filename, { title, text }) {
  const file = new File([blob], filename, { type: 'application/pdf' });
  const data = { files: [file], title, text };
  if (navigator.canShare?.(data)) {
    try { await navigator.share(data); } catch (err) { if (err.name !== 'AbortError') throw err; }
    return 'shared';
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}
