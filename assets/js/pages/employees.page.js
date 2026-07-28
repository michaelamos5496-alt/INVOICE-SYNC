/**
 * employees.page.js — controller for pages/employees.html. Staff CRUD
 * plus a role → permissions preview (display-only: there's no auth
 * system in this frontend-only phase to actually enforce them — that's
 * part of Phase 10's backend integration).
 */
import { api } from '../services/api.service.js';
import { EMPLOYEE_ROLES, ROLE_PERMISSIONS } from '../config/constants.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { initDropdown } from '../components/dropdown.js';
import { initials } from '../utils/formatters.js';
import { debounce, escapeHTML } from '../utils/helpers.js';

let table;

export async function initEmployeesPage() {
  table = new DataTable(document.getElementById('employees-table'), {
    columns: [
      {
        key: 'name', label: 'Staff Member', sortable: true,
        render: (row) => `
          <div class="flex items-center gap-2.5">
            <span class="w-8 h-8 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold grid place-items-center shrink-0">${initials(row.name)}</span>
            <span class="text-sm font-medium">${escapeHTML(row.name)}</span>
          </div>`,
      },
      { key: 'email', label: 'Email', render: (row) => escapeHTML(row.email) },
      { key: 'role', label: 'Role', sortable: true, render: (row) => `<span class="badge badge-info">${row.role}</span>` },
      {
        key: 'status', label: 'Status',
        render: (row) => `<span class="badge ${row.status === 'active' ? 'badge-success' : 'badge-neutral'}"><span class="badge-dot"></span>${row.status}</span>`,
      },
      {
        key: 'actions', label: '',
        render: (row) => `<button class="btn btn-ghost btn-sm" data-row-actions="${row.id}"><i class="fa-solid fa-ellipsis"></i></button>`,
      },
    ],
    pageSize: 8,
    searchKeys: ['name', 'email', 'role'],
    rowKey: (row) => row.id,
    defaultSort: { key: 'name', dir: 'asc' },
    emptyState: {
      icon: 'fa-id-badge', title: 'No staff accounts yet',
      message: 'Add your team so activity can be attributed to the right person.',
      actionLabel: 'Add Employee', onAction: () => openFormModal(),
    },
  });

  await refreshTable();

  document.getElementById('add-employee-btn').addEventListener('click', () => openFormModal());
  document.getElementById('employee-search').addEventListener('input', debounce((e) => table.setSearchTerm(e.target.value), 200));
}

async function refreshTable() {
  table.setLoading();
  table.setData(await api.employees.list());
  wireRowActions();
}

function wireRowActions() {
  document.querySelectorAll('[data-row-actions]').forEach((btn) => {
    const id = btn.dataset.rowActions;
    initDropdown(btn, [
      { label: 'Edit', icon: 'fa-pen', onClick: async () => openFormModal(await api.employees.get(id)) },
      {
        label: 'Toggle Status', icon: 'fa-power-off',
        onClick: async () => {
          const employee = await api.employees.get(id);
          await api.employees.update(id, { status: employee.status === 'active' ? 'inactive' : 'active' });
          toast.success(`${employee.name} is now ${employee.status === 'active' ? 'inactive' : 'active'}.`);
          refreshTable();
        },
      },
      { divider: true },
      {
        label: 'Delete', icon: 'fa-trash', danger: true,
        onClick: async () => {
          const ok = await modal.confirm({ title: 'Delete this employee?', message: 'Their name stays attached to past activity, but the account is removed.' });
          if (!ok) return;
          await api.employees.remove(id);
          toast.success('Employee deleted.');
          refreshTable();
        },
      },
    ]);
  });
}

function permissionsListHTML(role) {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms.map((p) => `<li class="flex items-start gap-2"><i class="fa-solid fa-check text-success-500 mt-0.5 text-xs"></i><span>${p}</span></li>`).join('');
}

function openFormModal(employee = null) {
  const el = modal.open({
    title: employee ? 'Edit Employee' : 'Add Employee',
    size: 'sm',
    bodyHTML: `
      <div class="space-y-4">
        <div>
          <label class="field-label">Name *</label>
          <input id="f-name" class="input" value="${escapeHTML(employee?.name ?? '')}" />
        </div>
        <div>
          <label class="field-label">Email</label>
          <input id="f-email" type="email" class="input" value="${escapeHTML(employee?.email ?? '')}" />
        </div>
        <div>
          <label class="field-label">Role</label>
          <select id="f-role" class="select">
            ${EMPLOYEE_ROLES.map((r) => `<option value="${r}" ${employee?.role === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="field-label">Status</label>
          <select id="f-status" class="select">
            <option value="active" ${employee?.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="inactive" ${employee?.status === 'inactive' ? 'selected' : ''}>Inactive</option>
          </select>
        </div>
        <div class="rounded-lg p-3" style="background: var(--surface-sunken)">
          <p class="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">This role can:</p>
          <ul id="permissions-preview" class="space-y-1.5 text-sm">${permissionsListHTML(employee?.role ?? EMPLOYEE_ROLES[0])}</ul>
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="save-employee" type="button">${employee ? 'Save Changes' : 'Add Employee'}</button>
    `,
  });

  el.querySelector('#f-role').addEventListener('change', (e) => {
    el.querySelector('#permissions-preview').innerHTML = permissionsListHTML(e.target.value);
  });

  el.querySelector('#save-employee').addEventListener('click', async () => {
    const name = el.querySelector('#f-name').value.trim();
    if (!name) { toast.danger('Name is required.'); return; }

    const formData = {
      name,
      email: el.querySelector('#f-email').value.trim(),
      role: el.querySelector('#f-role').value,
      status: el.querySelector('#f-status').value,
    };

    if (employee) await api.employees.update(employee.id, formData);
    else await api.employees.create(formData);

    toast.success(employee ? 'Employee updated.' : 'Employee added.');
    modal.close();
    refreshTable();
  });
}
