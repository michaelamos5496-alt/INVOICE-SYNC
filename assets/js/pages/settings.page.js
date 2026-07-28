/**
 * settings.page.js — controller for pages/settings.html: Store Profile,
 * Tax & Currency, Channel Integrations, and Preferences tabs. Each tab
 * saves independently via settings.service.js. Integrations are static
 * "Not Connected" cards — real OAuth/API-key connection flows are
 * Phase 10 (API Integration) work; this phase just gives them a home.
 */
import { getSettings, updateSettings } from '../services/settings.service.js';
import { clearAllData, loadSampleData, hasAnyData } from '../services/reset.service.js';
import { initTabs } from '../components/tabs.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';
import { STORAGE_KEYS } from '../config/constants.js';
import { storage } from '../services/storage.service.js';
import { escapeHTML } from '../utils/helpers.js';

const CURRENCIES = ['GHS', 'USD', 'NGN', 'EUR', 'GBP'];
const TIMEZONES = ['Africa/Accra', 'Africa/Lagos', 'UTC', 'America/New_York', 'Europe/London'];
const INTEGRATIONS = [
  { key: 'shopify', name: 'Shopify', icon: 'fa-shopify', style: 'fa-brands' },
  { key: 'woocommerce', name: 'WooCommerce', icon: 'fa-wordpress', style: 'fa-brands' },
  { key: 'stripe', name: 'Stripe', icon: 'fa-stripe', style: 'fa-brands' },
  { key: 'paystack', name: 'Paystack', icon: 'fa-credit-card', style: 'fa-solid' },
  { key: 'hubtel', name: 'Hubtel', icon: 'fa-mobile-screen', style: 'fa-solid' },
];

export async function initSettingsPage() {
  initTabs(document.getElementById('settings-tabs'));
  renderStoreProfileForm();
  renderTaxCurrencyForm();
  renderIntegrations();
  renderPreferencesForm();
  renderDataForm();
}

function renderStoreProfileForm() {
  const s = getSettings();
  document.getElementById('store-profile-form').innerHTML = `
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="sm:col-span-2">
        <label class="field-label">Store Name</label>
        <input id="f-store-name" class="input" value="${escapeHTML(s.storeName)}" />
      </div>
      <div>
        <label class="field-label">Store Email</label>
        <input id="f-store-email" type="email" class="input" value="${escapeHTML(s.storeEmail)}" />
      </div>
      <div>
        <label class="field-label">Store Phone</label>
        <input id="f-store-phone" type="tel" class="input" value="${escapeHTML(s.storePhone)}" />
      </div>
      <div class="sm:col-span-2">
        <label class="field-label">Store Address</label>
        <input id="f-store-address" class="input" value="${escapeHTML(s.storeAddress)}" />
      </div>
      <div>
        <label class="field-label">Timezone</label>
        <select id="f-timezone" class="select">
          ${TIMEZONES.map((tz) => `<option value="${tz}" ${s.timezone === tz ? 'selected' : ''}>${tz}</option>`).join('')}
        </select>
      </div>
    </div>
    <button id="save-store-profile" class="btn btn-primary mt-4"><i class="fa-solid fa-check"></i> Save Store Profile</button>
  `;

  document.getElementById('save-store-profile').addEventListener('click', () => {
    updateSettings({
      storeName: document.getElementById('f-store-name').value.trim(),
      storeEmail: document.getElementById('f-store-email').value.trim(),
      storePhone: document.getElementById('f-store-phone').value.trim(),
      storeAddress: document.getElementById('f-store-address').value.trim(),
      timezone: document.getElementById('f-timezone').value,
    });
    toast.success('Store profile saved.');
  });
}

function renderTaxCurrencyForm() {
  const s = getSettings();
  document.getElementById('tax-currency-form').innerHTML = `
    <div class="grid sm:grid-cols-2 gap-4">
      <div>
        <label class="field-label">Currency</label>
        <select id="f-currency" class="select">
          ${CURRENCIES.map((c) => `<option value="${c}" ${s.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="field-label">Default Tax Rate (%)</label>
        <input id="f-tax-rate" type="number" min="0" max="100" step="0.5" class="input" value="${s.taxRate}" />
        <p class="field-hint">Pre-fills the tax field on the POS screen for every new sale.</p>
      </div>
    </div>
    <button id="save-tax-currency" class="btn btn-primary mt-4"><i class="fa-solid fa-check"></i> Save</button>
  `;

  document.getElementById('save-tax-currency').addEventListener('click', () => {
    updateSettings({
      currency: document.getElementById('f-currency').value,
      taxRate: Number(document.getElementById('f-tax-rate').value) || 0,
    });
    toast.success('Tax & currency settings saved.');
  });
}

function renderIntegrations() {
  document.getElementById('integrations-list').innerHTML = INTEGRATIONS.map((integration) => `
    <div class="card p-4 flex items-center gap-4">
      <span class="w-10 h-10 rounded-lg bg-[var(--surface-sunken)] grid place-items-center shrink-0">
        <i class="${integration.style} ${integration.icon} text-lg"></i>
      </span>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium">${integration.name}</p>
        <span class="badge badge-neutral mt-1">Not Connected</span>
      </div>
      <button class="btn btn-secondary btn-sm" disabled title="Live connections arrive with Phase 10 API Integration">Connect</button>
    </div>
  `).join('');
}

function renderPreferencesForm() {
  const s = getSettings();
  const isDark = document.documentElement.classList.contains('dark');

  document.getElementById('preferences-form').innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">Dark Mode</p>
          <p class="text-xs text-[var(--text-muted)]">Matches the toggle in the top bar.</p>
        </div>
        <label class="toggle"><input id="f-dark-mode" type="checkbox" ${isDark ? 'checked' : ''} /><span class="toggle-track"></span></label>
      </div>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">Low Stock Alerts</p>
          <p class="text-xs text-[var(--text-muted)]">Show a notification when a product crosses its minimum stock threshold.</p>
        </div>
        <label class="toggle"><input id="f-low-stock-alerts" type="checkbox" ${s.lowStockAlerts ? 'checked' : ''} /><span class="toggle-track"></span></label>
      </div>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">Email Notifications</p>
          <p class="text-xs text-[var(--text-muted)]">Send a copy of low-stock and new-order alerts by email (requires Phase 10 backend).</p>
        </div>
        <label class="toggle"><input id="f-email-notifications" type="checkbox" ${s.emailNotifications ? 'checked' : ''} /><span class="toggle-track"></span></label>
      </div>
    </div>
    <button id="save-preferences" class="btn btn-primary mt-4"><i class="fa-solid fa-check"></i> Save Preferences</button>
  `;

  document.getElementById('f-dark-mode').addEventListener('change', (e) => {
    document.documentElement.classList.toggle('dark', e.target.checked);
    storage.set(STORAGE_KEYS.THEME, e.target.checked ? 'dark' : 'light');
  });

  document.getElementById('save-preferences').addEventListener('click', () => {
    updateSettings({
      lowStockAlerts: document.getElementById('f-low-stock-alerts').checked,
      emailNotifications: document.getElementById('f-email-notifications').checked,
    });
    toast.success('Preferences saved.');
  });
}

function renderDataForm() {
  const populated = hasAnyData();
  document.getElementById('data-form').innerHTML = `
    <div class="space-y-4">
      <div class="card p-4 flex items-center justify-between gap-4">
        <div>
          <p class="text-sm font-medium">Load Sample Data</p>
          <p class="text-xs text-[var(--text-muted)]">Populate the store with example products, sales and customers to explore the app. Never overwrites data you've already entered.</p>
        </div>
        <button id="load-sample-data" class="btn btn-secondary btn-sm shrink-0"><i class="fa-solid fa-flask"></i> Load Sample Data</button>
      </div>
      <div class="card p-4 flex items-center justify-between gap-4" style="border-color: color-mix(in srgb, var(--color-danger-500) 30%, transparent)">
        <div>
          <p class="text-sm font-medium">Clear All Data</p>
          <p class="text-xs text-[var(--text-muted)]">Permanently deletes every product, order, customer and log entry${populated ? '' : " — there's nothing to clear right now"}. Store profile and preferences are kept.</p>
        </div>
        <button id="clear-all-data" class="btn btn-danger btn-sm shrink-0" ${populated ? '' : 'disabled'}><i class="fa-solid fa-trash"></i> Clear All Data</button>
      </div>
    </div>
  `;

  document.getElementById('load-sample-data').addEventListener('click', async () => {
    await loadSampleData();
    toast.success('Sample data loaded.');
    setTimeout(() => window.location.reload(), 600);
  });

  document.getElementById('clear-all-data').addEventListener('click', async () => {
    const ok = await modal.confirm({
      title: 'Clear all data?',
      message: 'This permanently deletes every product, order, customer, and log entry. Your store profile and preferences are kept. This cannot be undone.',
      confirmLabel: 'Clear Everything',
    });
    if (!ok) return;
    clearAllData();
    toast.success('All data cleared.');
    setTimeout(() => window.location.reload(), 600);
  });
}
