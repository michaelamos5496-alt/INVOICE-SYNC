/**
 * notifications.page.js — controller for pages/notifications.html: the
 * full notification center (the topbar bell only shows a preview).
 * Supports filtering by type, marking individual/all notifications as
 * read, and deleting one. Because it writes through api.notifications
 * (the same collection the topbar bell subscribes to), marking things
 * read here updates the bell's unread badge live without a page reload.
 */
import { api } from '../services/api.service.js';
import { toast } from '../components/toast.js';
import { renderEmptyState } from '../components/empty-state.js';
import { timeAgo } from '../utils/formatters.js';
import { escapeHTML } from '../utils/helpers.js';

export const NOTIFICATION_TYPE_META = {
  low_stock: { label: 'Low Stock', icon: 'fa-triangle-exclamation', badge: 'badge-warning' },
  out_of_stock: { label: 'Out of Stock', icon: 'fa-circle-xmark', badge: 'badge-danger' },
  new_order: { label: 'New Orders', icon: 'fa-cart-shopping', badge: 'badge-info' },
  payment_received: { label: 'Payment Received', icon: 'fa-circle-check', badge: 'badge-success' },
  return: { label: 'Returns', icon: 'fa-rotate-left', badge: 'badge-info' },
  payment_failed: { label: 'Failed Payments', icon: 'fa-circle-exclamation', badge: 'badge-danger' },
  system_alert: { label: 'System Alerts', icon: 'fa-gear', badge: 'badge-neutral' },
};

let activeFilter = 'all';

function typeMeta(type) {
  return NOTIFICATION_TYPE_META[type] ?? { label: type, icon: 'fa-bell', badge: 'badge-neutral' };
}

function buildFilterChips() {
  const container = document.getElementById('notification-filters');
  const chips = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    ...Object.entries(NOTIFICATION_TYPE_META).map(([key, meta]) => ({ key, label: meta.label })),
  ];
  container.innerHTML = chips.map((chip) => `
    <button class="tab-btn ${chip.key === activeFilter ? 'active' : ''}" data-filter="${chip.key}" type="button">${chip.label}</button>
  `).join('');
  container.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => { activeFilter = btn.dataset.filter; renderList(); });
  });
}

async function markAsRead(id) {
  await api.notifications.update(id, { read: true });
  renderList();
}

async function markAllAsRead() {
  const all = await api.notifications.list();
  await Promise.all(all.filter((n) => !n.read).map((n) => api.notifications.update(n.id, { read: true })));
  toast.success('All notifications marked as read.');
  renderList();
}

async function deleteNotification(id) {
  await api.notifications.remove(id);
  renderList();
}

async function renderList() {
  buildFilterChips();
  const container = document.getElementById('notifications-list');
  let items = (await api.notifications.list()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (activeFilter === 'unread') items = items.filter((n) => !n.read);
  else if (activeFilter !== 'all') items = items.filter((n) => n.type === activeFilter);

  const unreadCount = (await api.notifications.list()).filter((n) => !n.read).length;
  document.getElementById('unread-count').textContent = unreadCount > 0 ? `${unreadCount} unread` : 'All caught up';

  if (items.length === 0) {
    renderEmptyState(container, {
      icon: 'fa-bell', title: 'No notifications here',
      message: activeFilter === 'all' ? "You're all caught up." : 'Nothing matches this filter yet.',
    });
    return;
  }

  container.innerHTML = items.map((n) => {
    const meta = typeMeta(n.type);
    return `
      <div class="flex items-start gap-4 p-4 rounded-lg border-b last:border-0 ${n.read ? '' : 'bg-[var(--surface-sunken)]'}" style="border-color: var(--border-subtle)" data-notification-row="${n.id}">
        <span class="badge ${meta.badge} w-9 h-9 !rounded-full !p-0 grid place-items-center shrink-0"><i class="fa-solid ${meta.icon}"></i></span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-sm font-semibold">${escapeHTML(n.title)}</p>
            ${n.read ? '' : '<span class="w-2 h-2 rounded-full bg-primary-500 shrink-0"></span>'}
          </div>
          <p class="text-sm text-[var(--text-secondary)] mt-0.5">${escapeHTML(n.message)}</p>
          <p class="text-xs text-[var(--text-muted)] mt-1">${meta.label} · ${timeAgo(n.createdAt)}</p>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          ${n.read ? '' : `<button class="btn btn-ghost btn-sm" data-mark-read="${n.id}" title="Mark as read"><i class="fa-solid fa-check"></i></button>`}
          <button class="btn btn-ghost btn-sm" data-delete="${n.id}" title="Dismiss"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('[data-mark-read]').forEach((btn) => btn.addEventListener('click', () => markAsRead(btn.dataset.markRead)));
  container.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', () => deleteNotification(btn.dataset.delete)));
}

export async function initNotificationsPage() {
  document.getElementById('mark-all-read').addEventListener('click', markAllAsRead);
  await renderList();
  api.notifications.subscribe(renderList);
}
