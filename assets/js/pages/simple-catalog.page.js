/**
 * simple-catalog.page.js — factory for the three structurally-identical
 * "flat list" catalog pages: Categories, Brands, Suppliers. Each is a
 * name/description-shaped entity with plain CRUD and no special business
 * logic (unlike Products, which routes stock through inventory.service.js),
 * so one config-driven controller covers all three instead of three
 * near-duplicate files.
 *
 * Usage (see pages/categories.html, brands.html, suppliers.html):
 *   createSimpleCatalogPage({
 *     collection: api.categories,
 *     entityLabel: 'Category',
 *     fields: [{ key: 'name', label: 'Name', type: 'text', required: true }, ...],
 *   }).init();
 */
import { watchData } from '../services/live-data.js';
import { DataTable } from '../components/table.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { initDropdown } from '../components/dropdown.js';
import { debounce, escapeHTML } from '../utils/helpers.js';
import { formatDate } from '../utils/formatters.js';

function fieldInputHTML(field, value) {
  const val = value ?? '';
  if (field.type === 'textarea') {
    return `<textarea id="f-${field.key}" class="textarea" ${field.required ? 'required' : ''}>${escapeHTML(val)}</textarea>`;
  }
  if (field.type === 'select') {
    return `<select id="f-${field.key}" class="select" ${field.required ? 'required' : ''}>
      ${field.options.map((opt) => `<option value="${opt.value}" ${opt.value === val ? 'selected' : ''}>${opt.label}</option>`).join('')}
    </select>`;
  }
  return `<input id="f-${field.key}" type="${field.type ?? 'text'}" class="input" value="${escapeHTML(val)}" ${field.required ? 'required' : ''} ${field.placeholder ? `placeholder="${escapeHTML(field.placeholder)}"` : ''} />`;
}

export function createSimpleCatalogPage({
  collection, entityLabel, fields,
  entityLabelPlural = `${entityLabel}s`,
  tableSelector = `#${entityLabelPlural.toLowerCase()}-table`,
  addButtonSelector = '#add-entity-btn',
  searchSelector = '#entity-search',
}) {
  let table;

  function buildColumns() {
    return [
      ...fields.map((f) => ({
        key: f.key,
        label: f.label,
        sortable: f.type !== 'textarea',
        render: f.type === 'select' ? undefined : (row) => escapeHTML(row[f.key]),
      })),
      { key: 'createdAt', label: 'Added', render: (row) => formatDate(row.createdAt) },
      {
        key: 'actions', label: '',
        render: (row) => `<button class="btn btn-ghost btn-sm" data-row-actions="${row.id}" aria-label="Row actions"><i class="fa-solid fa-ellipsis"></i></button>`,
      },
    ];
  }

  async function refresh() {
    table.setLoading();
    const items = await collection.list();
    table.setData(items);
  }

  function wireRowActions() {
    document.querySelectorAll('[data-row-actions]').forEach((btn) => {
      const id = btn.dataset.rowActions;
      initDropdown(btn, [
        { label: 'Edit', icon: 'fa-pen', onClick: async () => openFormModal(await collection.get(id)) },
        {
          label: 'Delete', icon: 'fa-trash', danger: true,
          onClick: async () => {
            const ok = await modal.confirm({ title: `Delete this ${entityLabel.toLowerCase()}?`, message: 'This cannot be undone.' });
            if (!ok) return;
            await collection.remove(id);
            toast.success(`${entityLabel} deleted.`);
            refresh();
          },
        },
      ]);
    });
  }

  function openFormModal(entity = null) {
    const el = modal.open({
      title: entity ? `Edit ${entityLabel}` : `Add ${entityLabel}`,
      size: 'md',
      bodyHTML: `
        <div class="space-y-4">
          ${fields.map((f) => `
            <div>
              <label class="field-label">${f.label}${f.required ? ' *' : ''}</label>
              ${fieldInputHTML(f, entity?.[f.key])}
            </div>`).join('')}
        </div>`,
      footerHTML: `
        <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
        <button class="btn btn-primary" id="save-entity" type="button">${entity ? 'Save Changes' : `Add ${entityLabel}`}</button>
      `,
    });

    el.querySelector('#save-entity').addEventListener('click', async () => {
      const formData = {};
      for (const f of fields) {
        const value = el.querySelector(`#f-${f.key}`).value.trim();
        if (f.required && !value) {
          toast.danger(`${f.label} is required.`);
          return;
        }
        formData[f.key] = value;
      }

      if (entity) {
        await collection.update(entity.id, formData);
        toast.success(`${entityLabel} updated.`);
      } else {
        await collection.create(formData);
        toast.success(`${entityLabel} added.`);
      }
      modal.close();
      refresh();
    });
  }

  return {
    async init() {
      table = new DataTable(document.querySelector(tableSelector), {
        columns: buildColumns(),
        pageSize: 8,
        onRender: wireRowActions, // re-attach row menus every time the rows are redrawn
        searchKeys: fields.filter((f) => f.type !== 'textarea').map((f) => f.key),
        rowKey: (row) => row.id,
        defaultSort: { key: fields[0].key, dir: 'asc' },
        emptyState: {
          icon: 'fa-layer-group', title: `No ${entityLabelPlural.toLowerCase()} yet`,
          message: `Add your first ${entityLabel.toLowerCase()} to organize the catalog.`,
          actionLabel: `Add ${entityLabel}`, onAction: () => openFormModal(),
        },
      });

      document.querySelector(addButtonSelector).addEventListener('click', () => openFormModal());
      const searchEl = document.querySelector(searchSelector);
      if (searchEl) searchEl.addEventListener('input', debounce((e) => table.setSearchTerm(e.target.value), 200));

      await refresh();
      watchData([collection], refresh); // live: another device adds/renames/removes one
    },
  };
}
