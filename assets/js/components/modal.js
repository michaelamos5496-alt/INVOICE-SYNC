/**
 * modal.js — reusable modal/dialog primitive.
 * Usage:
 *   import { modal } from '.../components/modal.js';
 *   modal.open({ title: 'Add Product', bodyHTML: '<form>...</form>' });
 *   modal.confirm({ title: 'Delete product?', message: '...' }).then(ok => ...);
 *
 * Accessibility: traps Tab/Shift+Tab focus inside the dialog while open,
 * moves focus to the first focusable element (or the dialog itself) on
 * open, and restores focus to whatever triggered the modal when it
 * closes — screen reader and keyboard-only users otherwise lose their
 * place entirely once a modal appears over the page.
 */
let activeModal = null;
let previouslyFocused = null;

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function buildShell({ title, bodyHTML, size = 'md', footerHTML = '' }) {
  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  const wrapper = document.createElement('div');
  wrapper.className = 'fixed inset-0 z-[90] flex items-center justify-center p-4 animate-fade-in';
  wrapper.innerHTML = `
    <div class="absolute inset-0" style="background: var(--surface-overlay);" data-modal-backdrop></div>
    <div class="relative w-full ${sizes[size] ?? sizes.md} card animate-slide-up p-0 overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
      <div class="flex items-center justify-between px-6 py-4 border-b" style="border-color: var(--border-subtle)">
        <h3 id="modal-title" class="font-display text-lg font-semibold">${title ?? ''}</h3>
        <button data-modal-close class="w-8 h-8 rounded-full grid place-items-center hover:bg-[var(--surface-sunken)] transition-colors" aria-label="Close dialog">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <div class="px-6 py-5 max-h-[70vh] overflow-y-auto">${bodyHTML ?? ''}</div>
      ${footerHTML ? `<div class="flex items-center justify-end gap-3 px-6 py-4 border-t" style="border-color: var(--border-subtle)">${footerHTML}</div>` : ''}
    </div>
  `;
  return wrapper;
}

function close() {
  if (!activeModal) return;
  activeModal.remove();
  activeModal = null;
  document.removeEventListener('keydown', onKeydown);
  if (previouslyFocused?.isConnected) previouslyFocused.focus();
  previouslyFocused = null;
}

function onKeydown(e) {
  if (e.key === 'Escape') { close(); return; }
  if (e.key !== 'Tab' || !activeModal) return;

  const dialog = activeModal.querySelector('[role="dialog"]');
  const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter((el) => el.offsetParent !== null);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function open(options) {
  close();
  previouslyFocused = document.activeElement;
  const el = buildShell(options);
  el.addEventListener('click', (e) => {
    if (e.target.dataset.modalBackdrop !== undefined || e.target.closest('[data-modal-close]')) close();
  });
  document.body.appendChild(el);
  activeModal = el;
  document.addEventListener('keydown', onKeydown);

  const dialog = el.querySelector('[role="dialog"]');
  const firstFocusable = dialog.querySelector(FOCUSABLE_SELECTOR);
  (firstFocusable ?? dialog).focus();

  return el;
}

function confirm({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = true }) {
  return new Promise((resolve) => {
    const footerHTML = `
      <button data-cancel class="px-4 py-2 rounded-lg text-sm font-medium hover:bg-[var(--surface-sunken)] transition-colors">Cancel</button>
      <button data-confirm class="px-4 py-2 rounded-lg text-sm font-semibold text-white ${danger ? 'bg-danger-500 hover:bg-red-600' : 'bg-primary-600 hover:bg-primary-700'} transition-colors">${confirmLabel}</button>
    `;
    const el = open({ title, bodyHTML: `<p class="text-sm text-[var(--text-secondary)]">${message}</p>`, footerHTML, size: 'sm' });
    el.querySelector('[data-cancel]').addEventListener('click', () => { close(); resolve(false); });
    el.querySelector('[data-confirm]').addEventListener('click', () => { close(); resolve(true); });
  });
}

export const modal = { open, close, confirm };
