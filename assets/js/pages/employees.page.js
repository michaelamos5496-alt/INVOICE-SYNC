/**
 * employees.page.js — controller for pages/employees.html. Staff CRUD
 * plus a role → permissions preview (display-only: there's no auth
 * system in this frontend-only phase to actually enforce them — that's
 * part of Phase 10's backend integration).
 */
import { watchData } from '../services/live-data.js';
import { api } from '../services/api.service.js';
import { EMPLOYEE_ROLES, ROLE_PERMISSIONS } from '../config/constants.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { initDropdown } from '../components/dropdown.js';
import { initials } from '../utils/formatters.js';
import { getCurrentUser } from '../services/auth.service.js';
import { staffAccessSupported, listStaff, amIOwner, grantAccess, revokeAccess } from '../services/staff.service.js';
import { debounce, escapeHTML } from '../utils/helpers.js';

let table;
let staff = new Map();   // approved sign-in emails (cloud sync only): email -> { role, name }
let iAmOwner = false;    // only the Shop Owner can give or remove sign-in access

const emailKey = (email) => String(email ?? '').trim().toLowerCase();

export async function initEmployeesPage() {
  if (staffAccessSupported()) iAmOwner = await amIOwner().catch(() => false);
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
      ...(staffAccessSupported() ? [{
        key: 'signIn', label: 'Sign-in',
        render: (row) => staff.has(emailKey(row.email))
          ? '<span class="badge badge-success"><i class="fa-solid fa-key text-[10px]"></i> Can sign in</span>'
          : '<span class="text-[var(--text-muted)]">—</span>',
      }] : []),
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
    onRender: wireRowActions, // row menus must be re-attached every time the rows are redrawn (paging, sorting, live updates)
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
  watchData(['employees'], refreshTable);

  document.getElementById('add-employee-btn').addEventListener('click', () => openFormModal());
  document.getElementById('employee-search').addEventListener('input', debounce((e) => table.setSearchTerm(e.target.value), 200));
}

async function refreshTable() {
  table.setLoading();
  if (staffAccessSupported()) staff = await listStaff().catch(() => staff); // who may sign in changes rarely, so it's re-read with the table rather than watched live
  table.setData(await api.employees.list());
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
          const employee = await api.employees.get(id);
          await api.employees.remove(id);
          if (staffAccessSupported() && iAmOwner && staff.has(emailKey(employee?.email))) {
            if (emailKey(employee.email) === emailKey(getCurrentUser()?.email)) toast.warning('Deleted — but your own sign-in access was kept so you don\'t lock yourself out.');
            else await revokeAccess(employee.email).catch((err) => toast.danger(err.message));
          }
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

/** "Can sign in to the app" — only meaningful (and only shown) when people share data through sign-in. */
function signInControlHTML(employee) {
  if (!staffAccessSupported()) return '';
  if (!iAmOwner) {
    return `<p class="text-xs text-[var(--text-muted)]"><i class="fa-solid fa-lock mr-1"></i> Only the shop owner can give someone sign-in access.</p>`;
  }
  const allowed = staff.has(emailKey(employee?.email));
  return `
    <label class="flex items-start gap-3 rounded-lg p-3 border cursor-pointer" style="border-color: var(--border-subtle)">
      <input id="f-can-login" type="checkbox" class="checkbox mt-0.5" ${allowed ? 'checked' : ''} />
      <span>
        <span class="block text-sm font-medium">Can sign in to the app</span>
        <span class="block text-xs text-[var(--text-muted)]">They create their login with this email address and confirm it. Needs an email above.</span>
      </span>
    </label>`;
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
        ${signInControlHTML(employee)}
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

    // Sign-in access is separate from the employee record; a refusal (e.g. "keep one owner") shouldn't lose the edit.
    const accessBox = el.querySelector('#f-can-login');
    let accessProblem = null;
    if (accessBox && accessBox.checked && !formData.email) { toast.danger('Add an email address so they can sign in with it.'); return; }

    if (employee) await api.employees.update(employee.id, formData);
    else await api.employees.create(formData);

    if (accessBox) {
      const before = emailKey(employee?.email);
      const after = emailKey(formData.email);
      const me = emailKey(getCurrentUser()?.email);
      try {
        if (accessBox.checked) {
          await grantAccess({ email: after, role: formData.role, name: formData.name });
          if (before && before !== after && staff.has(before) && before !== me) await revokeAccess(before);
        } else if (staff.has(after) || staff.has(before)) {
          if (after === me || before === me) throw new Error('You can\'t remove your own sign-in access.');
          await revokeAccess(staff.has(after) ? after : before);
        }
      } catch (err) { accessProblem = err.message; }
    }

    toast.success(employee ? 'Employee updated.' : 'Employee added.');
    if (accessProblem) toast.danger(`Sign-in access wasn't changed: ${accessProblem}`, { duration: 7000 });
    modal.close();
    refreshTable();
  });
}
