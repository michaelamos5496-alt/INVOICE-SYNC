/**
 * topbar.js — theme toggle, global search, and notification bell wiring
 * for the shared topbar partial (components/topbar.html).
 */
import { STORAGE_KEYS } from '../config/constants.js';
import { api } from '../services/api.service.js';
import { NAV_ITEMS_FLAT } from '../config/nav.config.js';
import { debounce, escapeHTML } from '../utils/helpers.js';
import { timeAgo } from '../utils/formatters.js';
import { initSyncStatus } from './sync-status.js';

/** Applies the persisted theme before first paint is handled inline in
 *  each page's <head> (see the tiny inline script in pages/*.html) to
 *  avoid a flash of the wrong theme. This function only wires the toggle
 *  control once the DOM/topbar partial is ready.
 *
 *  The theme is written with a plain `localStorage.setItem` — NOT
 *  `storage.set()` — on purpose. `storage.set()` JSON-encodes its value
 *  (so 'dark' becomes the 5-character string `"dark"` on disk), but
 *  every page's pre-paint script does a raw, un-parsed
 *  `localStorage.getItem('invsync.theme') === 'dark'` check for speed
 *  (it runs before any module has loaded). Writing through storage.set()
 *  here would make that comparison silently fail on every subsequent
 *  page load — the toggle would appear to work on the current page,
 *  then revert on the next navigation. Read and write must use the same
 *  raw-string format. */
export function initThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;

  const applyIcon = () => {
    const isDark = document.documentElement.classList.contains('dark');
    toggle.innerHTML = `<i class="fa-solid ${isDark ? 'fa-sun' : 'fa-moon'}"></i>`;
  };

  applyIcon();
  toggle.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem(STORAGE_KEYS.THEME, isDark ? 'dark' : 'light');
    applyIcon();
  });
}

export function initGlobalSearch() {
  const input = document.getElementById('global-search');
  const results = document.getElementById('global-search-results');
  if (!input || !results) return;

  const search = debounce(async (term) => {
    if (!term.trim()) { results.classList.add('hidden'); return; }
    const lower = term.toLowerCase();

    const navMatches = NAV_ITEMS_FLAT
      .filter((item) => item.label.toLowerCase().includes(lower))
      .map((item) => ({ label: item.label, href: item.href, group: 'Go to page', icon: item.icon }));

    const products = await api.products.list((p) => p.name?.toLowerCase().includes(lower) || p.sku?.toLowerCase().includes(lower));
    const productMatches = products.slice(0, 5).map((p) => ({
      label: p.name, sub: p.sku, group: 'Products', icon: 'fa-box', href: `products.html?id=${p.id}`,
    }));

    const all = [...navMatches, ...productMatches];
    results.innerHTML = all.length
      ? all.map((r) => `
          <a href="${escapeHTML(r.href)}" class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--surface-sunken)] text-sm">
            <i class="fa-solid ${r.icon} text-[var(--text-muted)] w-4 text-center"></i>
            <span class="flex-1">${escapeHTML(r.label)}${r.sub ? ` <span class="text-[var(--text-muted)]">· ${escapeHTML(r.sub)}</span>` : ''}</span>
            <span class="text-xs text-[var(--text-muted)]">${r.group}</span>
          </a>`).join('')
      : `<p class="px-3 py-6 text-center text-sm text-[var(--text-muted)]">No results for "${escapeHTML(term)}"</p>`;
    results.classList.remove('hidden');
  }, 200);

  input.addEventListener('input', (e) => search(e.target.value));
  input.addEventListener('focus', (e) => { if (e.target.value) results.classList.remove('hidden'); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#global-search-wrap')) results.classList.add('hidden');
  });
}

export async function initNotificationBell() {
  const bell = document.getElementById('notif-bell');
  const badge = document.getElementById('notif-badge');
  const panel = document.getElementById('notif-panel');
  const list = panel?.querySelector('.max-h-96');
  if (!bell || !panel || !list) return;

  const render = async () => {
    const notifications = (await api.notifications.list())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 8);
    const unread = notifications.filter((n) => !n.read).length;

    if (badge) {
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.classList.toggle('hidden', unread === 0);
    }

    list.innerHTML = notifications.length
      ? notifications.map((n) => `
          <div class="flex items-start gap-3 px-4 py-3 border-b last:border-0" style="border-color: var(--border-subtle)">
            <span class="mt-1 w-2 h-2 rounded-full shrink-0 ${n.read ? 'bg-transparent' : 'bg-primary-500'}"></span>
            <div>
              <p class="text-sm font-medium">${escapeHTML(n.title)}</p>
              <p class="text-xs text-[var(--text-secondary)]">${escapeHTML(n.message)}</p>
              <p class="text-[11px] text-[var(--text-muted)] mt-1">${timeAgo(n.createdAt)}</p>
            </div>
          </div>`).join('')
      : `<p class="px-4 py-8 text-center text-sm text-[var(--text-muted)]">You're all caught up.</p>`;
  };

  await render();
  api.notifications.subscribe(render);

  bell.addEventListener('click', () => panel.classList.toggle('hidden'));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#notif-wrap')) panel.classList.add('hidden');
  });
}

export function initTopbar() {
  initThemeToggle();
  initGlobalSearch();
  initNotificationBell();
  initSyncStatus();
}
