/**
 * activity-log.page.js — controller for pages/activity-logs.html: the
 * immutable audit trail of every action taken across the system.
 * Read-only by design — nothing here writes back to api.activityLog;
 * entries are appended elsewhere (seed data today, real user/system
 * actions once Phases 4+ finish wiring writes everywhere).
 */
import { api } from '../services/api.service.js';
import { DataTable } from '../components/table.js';
import { formatDateTime, initials } from '../utils/formatters.js';
import { debounce, escapeHTML } from '../utils/helpers.js';

export async function initActivityLogPage() {
  const table = new DataTable(document.getElementById('activity-log-table'), {
    columns: [
      {
        key: 'actor', label: 'Actor', sortable: true,
        render: (row) => `
          <div class="flex items-center gap-2.5">
            <span class="w-7 h-7 rounded-full bg-[var(--surface-sunken)] text-[var(--text-secondary)] text-[10px] font-bold grid place-items-center shrink-0">${initials(row.actor)}</span>
            <span class="text-sm font-medium">${escapeHTML(row.actor)}</span>
          </div>`,
      },
      { key: 'action', label: 'Action', sortable: true },
      { key: 'target', label: 'Target', render: (row) => escapeHTML(row.target) },
      { key: 'createdAt', label: 'Date', sortable: true, render: (row) => formatDateTime(row.createdAt) },
    ],
    pageSize: 10,
    searchKeys: ['actor', 'action', 'target'],
    rowKey: (row) => row.id,
    defaultSort: { key: 'createdAt', dir: 'desc' },
    emptyState: { icon: 'fa-clock-rotate-left', title: 'No activity yet', message: 'Actions taken across the system will show up here.' },
  });

  table.setLoading();
  const entries = await api.activityLog.list();
  table.setData(entries);

  document.getElementById('activity-search').addEventListener('input', debounce((e) => table.setSearchTerm(e.target.value), 200));
}
