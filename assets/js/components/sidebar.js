/**
 * sidebar.js — renders the primary navigation from nav.config.js into the
 * `#sidebar-nav` mount point defined in components/sidebar.html, and wires
 * up the active-link state plus the mobile drawer toggle.
 */
import { NAV_GROUPS } from '../config/nav.config.js';
import { getActivePage } from '../utils/helpers.js';

function renderGroup(group, activeKey) {
  const links = group.items.map((item) => `
    <a href="${item.href}"
       class="nav-link flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] ${item.key === activeKey ? 'active' : ''}"
       data-nav-key="${item.key}">
      <i class="fa-solid ${item.icon} w-4 text-center"></i>
      <span>${item.label}</span>
    </a>
  `).join('');

  return `
    <div class="mb-5">
      <p class="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">${group.label}</p>
      <div class="flex flex-col gap-0.5">${links}</div>
    </div>
  `;
}

export function renderSidebar() {
  const mount = document.getElementById('sidebar-nav');
  if (!mount) return;
  const activeKey = getActivePage();
  mount.innerHTML = NAV_GROUPS.map((g) => renderGroup(g, activeKey)).join('');
}

export function initSidebarToggle() {
  const drawer = document.getElementById('sidebar');
  const openBtn = document.getElementById('sidebar-open');
  const closeBtn = document.getElementById('sidebar-close');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!drawer) return;

  const open = () => {
    drawer.classList.remove('-translate-x-full');
    backdrop?.classList.remove('hidden');
  };
  const close = () => {
    drawer.classList.add('-translate-x-full');
    backdrop?.classList.add('hidden');
  };

  openBtn?.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);

  // Always visible on large screens regardless of drawer state classes.
  const mq = window.matchMedia('(min-width: 1024px)');
  const syncForViewport = () => { if (mq.matches) drawer.classList.remove('-translate-x-full'); };
  mq.addEventListener('change', syncForViewport);
  syncForViewport();
}
