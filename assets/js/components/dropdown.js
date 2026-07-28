/**
 * dropdown.js — lightweight menu attached to a trigger element.
 * Usage:
 *   import { initDropdown } from '.../components/dropdown.js';
 *   initDropdown(document.getElementById('row-menu-1'), [
 *     { label: 'Edit', icon: 'fa-pen', onClick: () => {} },
 *     { divider: true },
 *     { label: 'Delete', icon: 'fa-trash', danger: true, onClick: () => {} },
 *   ]);
 *
 * Item labels are always developer-authored strings passed in from page
 * code (never raw user input), so they're safe to interpolate directly —
 * unlike table cells/modal bodies, nothing here needs escapeHTML.
 *
 * Accessibility: exposes the standard button/menu pairing
 * (aria-haspopup, aria-expanded, role="menu"/"menuitem"), supports
 * Arrow/Home/End navigation and Escape-to-close, and returns focus to
 * the trigger when the menu closes via keyboard or outside click.
 */
export function initDropdown(triggerEl, items, { align = 'right' } = {}) {
  if (!triggerEl) return;

  let menu = null;
  triggerEl.setAttribute('aria-haspopup', 'true');
  triggerEl.setAttribute('aria-expanded', 'false');

  const close = ({ returnFocus = false } = {}) => {
    menu?.remove();
    menu = null;
    triggerEl.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick);
    document.removeEventListener('keydown', onKeydown);
    if (returnFocus) triggerEl.focus();
  };

  const onOutsideClick = (e) => {
    if (!e.target.closest('.dropdown-menu') && e.target !== triggerEl && !triggerEl.contains(e.target)) close();
  };

  const menuItems = () => [...menu.querySelectorAll('[role="menuitem"]')];

  const onKeydown = (e) => {
    if (!menu) return;
    const focusable = menuItems();
    const currentIndex = focusable.indexOf(document.activeElement);

    if (e.key === 'Escape') { e.preventDefault(); close({ returnFocus: true }); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusable[(currentIndex + 1) % focusable.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusable[(currentIndex - 1 + focusable.length) % focusable.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); focusable[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); focusable[focusable.length - 1]?.focus(); }
  };

  const open = () => {
    if (menu) { close(); return; }
    menu = document.createElement('div');
    menu.className = 'dropdown-menu animate-fade-in';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = items.map((item, i) => item.divider
      ? '<div class="dropdown-divider" role="separator"></div>'
      : `<button data-idx="${i}" role="menuitem" class="dropdown-item ${item.danger ? 'danger' : ''}">
           ${item.icon ? `<i class="fa-solid ${item.icon} w-4 text-center" aria-hidden="true"></i>` : ''}
           <span>${item.label}</span>
         </button>`).join('');

    menu.querySelectorAll('[data-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = items[Number(btn.dataset.idx)];
        close({ returnFocus: false });
        item.onClick?.();
      });
    });

    document.body.appendChild(menu);
    triggerEl.setAttribute('aria-expanded', 'true');
    const triggerRect = triggerEl.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${triggerRect.bottom + 6}px`;
    menu.style.left = align === 'right'
      ? `${Math.max(8, triggerRect.right - menuRect.width)}px`
      : `${triggerRect.left}px`;

    menuItems()[0]?.focus();
    setTimeout(() => document.addEventListener('click', onOutsideClick), 0);
    document.addEventListener('keydown', onKeydown);
  };

  triggerEl.addEventListener('click', (e) => { e.stopPropagation(); open(); });
}
