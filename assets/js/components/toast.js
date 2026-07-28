/**
 * toast.js — global toast notification system.
 * Usage: import { toast } from '.../components/toast.js'; toast.success('Saved!');
 */
const ICONS = {
  success: 'fa-circle-check text-success-500',
  danger: 'fa-circle-exclamation text-danger-500',
  warning: 'fa-triangle-exclamation text-warning-500',
  info: 'fa-circle-info text-info-500',
};

function ensureRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  // Screen readers announce anything appended here without needing focus —
  // set on both the pre-existing (static HTML) and freshly-created path.
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-atomic', 'false');
  return root;
}

/**
 * Builds the toast via DOM APIs rather than an innerHTML template so the
 * message text is never parsed as HTML, regardless of whether the caller
 * remembered to escape it — a defense-in-depth backstop, not a substitute
 * for escaping at the source.
 */
function show(message, variant = 'info', { duration = 3500 } = {}) {
  const root = ensureRoot();
  const el = document.createElement('div');
  el.className = 'glass animate-slide-up flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg min-w-[280px] max-w-sm';

  const icon = document.createElement('i');
  icon.className = `fa-solid ${ICONS[variant] ?? ICONS.info} text-lg shrink-0`;
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('p');
  text.className = 'text-sm font-medium text-[var(--text-primary)] flex-1';
  text.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'text-[var(--text-muted)] hover:text-[var(--text-primary)]';
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  closeBtn.addEventListener('click', () => dismiss(el));

  el.append(icon, text, closeBtn);
  root.appendChild(el);
  if (duration > 0) setTimeout(() => dismiss(el), duration);
  return el;
}

function dismiss(el) {
  el.style.transition = 'opacity 200ms ease, transform 200ms ease';
  el.style.opacity = '0';
  el.style.transform = 'translateX(8px)';
  setTimeout(() => el.remove(), 200);
}

export const toast = {
  success: (msg, opts) => show(msg, 'success', opts),
  danger: (msg, opts) => show(msg, 'danger', opts),
  warning: (msg, opts) => show(msg, 'warning', opts),
  info: (msg, opts) => show(msg, 'info', opts),
};
