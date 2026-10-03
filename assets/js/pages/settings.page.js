/**
 * settings.page.js — controller for pages/settings.html: Store Profile,
 * Tax & Currency, Channel Integrations, and Preferences tabs. Each tab
 * saves independently via settings.service.js. Integrations are static
 * "Not Connected" cards — real OAuth/API-key connection flows are
 * Phase 10 (API Integration) work; this phase just gives them a home.
 */
import { getSettings, updateSettings, getCurrency, CURRENCIES } from '../services/settings.service.js';
import { formatCurrency } from '../utils/formatters.js';
import { clearAllData, loadSampleData, hasAnyData, clearCloudData, loadCloudSampleData, cloudHasData } from '../services/reset.service.js';
import { initTabs } from '../components/tabs.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';
import { STORAGE_KEYS } from '../config/constants.js';
import { CLOUD_SYNC } from '../config/supabase.config.js';
import { readLocalSummary, uploadLocalDataToCloud } from '../services/migrate.service.js';
import { INTEGRATIONS, integrationByKey } from '../config/integrations.config.js';
import { importShopifyProducts } from '../services/shopify-sync.service.js';
import { getActorName } from '../services/auth.service.js';
import { fetchShopifyLocations, registerShopifyWebhooks } from '../services/integrations.service.js';
import { integrationsSupported, loadStatuses, connect, testConnection, disconnect, sendTestSms } from '../services/integrations.service.js';
import { amIOwner } from '../services/staff.service.js';
import { escapeHTML } from '../utils/helpers.js';
import { compressImage } from '../utils/image-compress.js';

const TIMEZONES = ['Africa/Accra', 'Africa/Lagos', 'UTC', 'America/New_York', 'Europe/London'];

export async function initSettingsPage() {
  initTabs(document.getElementById('settings-tabs'));
  renderStoreProfileForm();
  renderTaxCurrencyForm();
  renderIntegrations();
  renderPreferencesForm();
  renderDataForm();
}

/** Saves settings and reports the outcome — in sync mode a save can be refused (e.g. only the owner may change settings). */
async function saveSettings(patch, successMessage) {
  try {
    await updateSettings(patch);
    toast.success(successMessage);
  } catch (err) {
    toast.danger(err.message);
  }
}

function renderStoreProfileForm() {
  const s = getSettings();
  document.getElementById('store-profile-form').innerHTML = `
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="sm:col-span-2">
        <label class="field-label" for="f-store-name">Store Name</label>
        <input id="f-store-name" class="input" maxlength="60" value="${escapeHTML(s.storeName)}" placeholder="Your business name" aria-describedby="store-name-hint" />
        <p id="store-name-hint" class="field-hint">Your business name. It appears in the sidebar and browser tab, and on POS receipts and invoices, along with the contact details below.</p>
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
    <div class="mt-6 pt-5 border-t" style="border-color: var(--border-subtle)">
      <h3 class="font-display font-semibold text-sm mb-1">Branding</h3>
      <p class="field-hint mb-4" style="margin-top:0">Upload your logo and choose the photo behind the app. Both apply for everyone on the team as soon as they're saved.</p>
      <div class="grid sm:grid-cols-2 gap-4">
        <div class="card p-4">
          <p class="text-sm font-medium mb-3">Brand logo</p>
          <div class="flex items-center gap-4">
            <img id="brand-logo-preview" src="${s.brandLogo || '/assets/img/favicon.svg'}" alt="" class="w-16 h-16 rounded-xl object-contain" style="background: var(--surface-sunken)" />
            <div class="flex flex-wrap gap-2">
              <button type="button" id="brand-logo-pick" class="btn btn-secondary btn-sm"><i class="fa-solid fa-upload"></i> Upload logo</button>
              <button type="button" id="brand-logo-reset" class="btn btn-ghost btn-sm" ${s.brandLogo ? '' : 'hidden'}>Remove</button>
            </div>
          </div>
          <p class="field-hint">Square works best. PNG with a transparent background looks cleanest. Shown in the sidebar.</p>
          <input id="brand-logo-file" type="file" accept="image/png,image/jpeg,image/webp" hidden />
        </div>
        <div class="card p-4">
          <p class="text-sm font-medium mb-3">Background image</p>
          <div class="flex items-center gap-4">
            <img id="brand-bg-preview" src="${s.backgroundImage || '/assets/img/app-bg.jpg'}" alt="" class="w-24 h-16 rounded-lg object-cover" />
            <div class="flex flex-wrap gap-2">
              <button type="button" id="brand-bg-pick" class="btn btn-secondary btn-sm"><i class="fa-solid fa-image"></i> Choose image</button>
              <button type="button" id="brand-bg-reset" class="btn btn-ghost btn-sm" ${s.backgroundImage ? '' : 'hidden'}>Use default</button>
            </div>
          </div>
          <p class="field-hint">A wide photo works best. It's darkened and softened behind the glass panels.</p>
          <input id="brand-bg-file" type="file" accept="image/png,image/jpeg,image/webp" hidden />
        </div>
      </div>
    </div>
    <button id="save-store-profile" class="btn btn-primary mt-4"><i class="fa-solid fa-check"></i> Save Store Profile</button>
  `;

  wireBrandingPickers();

  document.getElementById('save-store-profile').addEventListener('click', () => saveSettings({
    storeName: document.getElementById('f-store-name').value.replace(/\s+/g, ' ').trim(),
    storeEmail: document.getElementById('f-store-email').value.trim(),
    storePhone: document.getElementById('f-store-phone').value.trim(),
    storeAddress: document.getElementById('f-store-address').value.trim(),
    timezone: document.getElementById('f-timezone').value,
  }, 'Store profile saved.'));
}

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Couldn\'t read that image.'));
  reader.readAsDataURL(blob);
});

/** Logo and background pickers: each saves as soon as a picture is chosen (both are stored inside the shared settings, so they're kept small). */
function wireBrandingPickers() {
  const setup = ({ key, pick, file, reset, preview, defaultSrc, options, label }) => {
    const input = document.getElementById(file);
    document.getElementById(pick).addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const chosen = input.files?.[0];
      input.value = '';
      if (!chosen) return;
      try {
        const { blob } = await compressImage(chosen, options);
        const dataUrl = await blobToDataUrl(blob);
        await updateSettings({ [key]: dataUrl });
        document.getElementById(preview).src = dataUrl;
        document.getElementById(reset).hidden = false;
        toast.success(`${label} updated.`);
      } catch (err) { toast.danger(err.message); }
    });
    document.getElementById(reset).addEventListener('click', async () => {
      try {
        await updateSettings({ [key]: '' });
        document.getElementById(preview).src = defaultSrc;
        document.getElementById(reset).hidden = true;
        toast.success(`${label} reset.`);
      } catch (err) { toast.danger(err.message); }
    });
  };
  setup({ key: 'brandLogo', pick: 'brand-logo-pick', file: 'brand-logo-file', reset: 'brand-logo-reset', preview: 'brand-logo-preview',
    defaultSrc: '/assets/img/favicon.svg', options: { maxDimension: 256, quality: 0.92 }, label: 'Logo' });
  setup({ key: 'backgroundImage', pick: 'brand-bg-pick', file: 'brand-bg-file', reset: 'brand-bg-reset', preview: 'brand-bg-preview',
    defaultSrc: '/assets/img/app-bg.jpg', options: { maxDimension: 1400, quality: 0.6 }, label: 'Background' });
}

function renderTaxCurrencyForm() {
  const s = getSettings();
  document.getElementById('tax-currency-form').innerHTML = `
    <div class="grid sm:grid-cols-2 gap-4">
      <div>
        <label class="field-label" for="f-currency">Currency</label>
        <select id="f-currency" class="select" aria-describedby="currency-hint">
          ${CURRENCIES.map((c) => `<option value="${c.code}" ${getCurrency() === c.code ? 'selected' : ''}>${c.code} — ${c.name}</option>`).join('')}
        </select>
        <p id="currency-hint" class="field-hint">Shown on every price and total in the app, e.g. <strong id="currency-preview"></strong>. This relabels amounts — it doesn't convert them, and invoices you've already created keep the currency they were issued in.</p>
      </div>
      <div>
        <label class="field-label">Default Tax Rate (%)</label>
        <input id="f-tax-rate" type="number" min="0" max="100" step="0.5" class="input" value="${s.taxRate}" />
        <p class="field-hint">Pre-fills the tax field on the POS screen for every new sale.</p>
      </div>
    </div>
    <button id="save-tax-currency" class="btn btn-primary mt-4"><i class="fa-solid fa-check"></i> Save</button>
  `;

  const previewCurrency = () => {
    document.getElementById('currency-preview').textContent = formatCurrency(1234.5, document.getElementById('f-currency').value);
  };
  previewCurrency();
  document.getElementById('f-currency').addEventListener('change', previewCurrency);

  document.getElementById('save-tax-currency').addEventListener('click', () => {
    const currency = document.getElementById('f-currency').value;
    const changed = currency !== getCurrency();
    return saveSettings(
      { currency, taxRate: Number(document.getElementById('f-tax-rate').value) || 0 },
      changed ? `Currency changed to ${currency}. Prices and totals across the app now use it.` : 'Tax & currency settings saved.',
    );
  });
}

// ---------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------
/** Settings → Integrations → Shopify → Two-way sync: send stock to Shopify, and turn on live orders from Shopify. */
function openShopifyTwoWayModal() {
  const current = getSettings();
  const el = modal.open({
    title: 'Two-way Shopify sync', size: 'md',
    bodyHTML: `<div class="space-y-6">
      <section class="space-y-3">
        <h3 class="font-display font-semibold text-sm">1 · Send OneDesk stock to Shopify</h3>
        <p class="text-xs text-[var(--text-muted)]">When stock changes here (a sale at the till, a stock count, a restock), the new number is sent to the Shopify location you choose. Products with variants aren't sent — the till sells a product, not a variant, so OneDesk can't tell which variant's count to lower. Shopify → OneDesk (below) does handle variants.</p>
        <div>
          <label class="field-label" for="tw-location">Shopify location</label>
          <select id="tw-location" class="select" disabled><option>Loading locations…</option></select>
          <p id="tw-location-msg" class="field-hint"></p>
        </div>
        <label class="flex items-center gap-2 text-sm"><input id="tw-push" type="checkbox" class="checkbox" ${current.shopifyPushStock ? 'checked' : ''} /> Send OneDesk stock changes to Shopify</label>
        <button type="button" id="tw-save" class="btn btn-primary btn-sm"><i class="fa-solid fa-check"></i> Save</button>
      </section>
      <section class="space-y-3 pt-5 border-t" style="border-color: var(--border-subtle)">
        <h3 class="font-display font-semibold text-sm">2 · Live orders from Shopify</h3>
        <p class="text-xs text-[var(--text-muted)]">New Shopify orders appear under Online Orders and take their stock off OneDesk; cancelled orders put it back. Needs the <strong>shopify-webhook</strong> function deployed (README → Integrations), the API secret key saved under Update keys, and the app's <code>read_orders</code> scope. Orders only match products imported with Sync products.</p>
        <button type="button" id="tw-webhooks" class="btn btn-secondary btn-sm"><i class="fa-solid fa-bolt"></i> Turn on live orders</button>
        <p id="tw-webhooks-msg" class="text-xs" role="status"></p>
      </section>
    </div>`,
  });

  const select = el.querySelector('#tw-location');
  const message = el.querySelector('#tw-location-msg');
  fetchShopifyLocations().then((locations) => {
    select.innerHTML = `<option value="">— choose a location —</option>${locations.map((l) => `<option value="${escapeHTML(l.id)}" ${l.id === current.shopifyLocationId ? 'selected' : ''}>${escapeHTML(l.name)}</option>`).join('')}`;
    select.disabled = false;
  }).catch((err) => {
    select.innerHTML = '<option value="">Couldn\'t load locations</option>';
    message.textContent = err.message;
    message.className = 'field-hint text-danger-500';
  });

  el.querySelector('#tw-save').addEventListener('click', async () => {
    const push = el.querySelector('#tw-push').checked;
    if (push && !select.value) { toast.danger('Choose a Shopify location first.'); return; }
    await saveSettings({ shopifyLocationId: select.value, shopifyPushStock: push }, push ? 'OneDesk stock changes will now be sent to Shopify.' : 'Sending stock to Shopify is off.');
  });

  el.querySelector('#tw-webhooks').addEventListener('click', async (e) => {
    const out = el.querySelector('#tw-webhooks-msg');
    e.currentTarget.disabled = true;
    out.textContent = 'Asking Shopify…'; out.className = 'text-xs text-[var(--text-secondary)]';
    try {
      const result = await registerShopifyWebhooks();
      out.textContent = result.message; out.className = 'text-xs text-success-500';
    } catch (err) {
      out.textContent = err.message; out.className = 'text-xs text-danger-500';
    } finally { e.currentTarget.disabled = false; }
  });
}

/** Settings → Integrations → Shopify → Sync products: pull the store's products and variants into OneDesk. */
function openShopifySyncModal() {
  const el = modal.open({
    title: 'Sync products from Shopify', size: 'sm',
    bodyHTML: `<div id="shopify-sync-body" class="space-y-4">
      <p class="text-sm text-[var(--text-secondary)]">Imports every product from your Shopify store with its variants, prices, SKUs, barcodes and first photo. Running it again updates products already imported instead of duplicating them.</p>
      <label class="flex items-start gap-2 text-sm">
        <input id="shopify-update-stock" type="checkbox" class="checkbox mt-0.5" />
        <span>Also replace OneDesk's stock counts with Shopify's for products that already exist<br />
          <span class="text-xs text-[var(--text-muted)]">Off by default, so in-store sales you've recorded aren't overwritten. New products always start with Shopify's counts.</span></span>
      </label>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-secondary btn-sm" data-modal-close>Cancel</button>
        <button type="button" id="shopify-sync-start" class="btn btn-primary btn-sm"><i class="fa-solid fa-cloud-arrow-down"></i> Start sync</button>
      </div></div>`,
  });
  el.querySelector('#shopify-sync-start').addEventListener('click', async () => {
    const updateStock = el.querySelector('#shopify-update-stock').checked;
    const body = el.querySelector('#shopify-sync-body');
    body.innerHTML = `<div role="status" aria-live="polite" class="space-y-3">
      <p id="shopify-sync-phase" class="text-sm text-[var(--text-secondary)]">Starting…</p>
      <div class="h-2 rounded-full overflow-hidden" style="background: var(--surface-sunken)"><div id="shopify-sync-bar" class="h-full" style="width:8%; background: var(--color-primary-500); transition: width 200ms"></div></div>
      <p class="text-xs text-[var(--text-muted)]">Keep this window open until it finishes.</p></div>`;
    try {
      const result = await importShopifyProducts({
        updateStock, actor: getActorName(),
        onProgress: ({ phase, done, total }) => {
          const label = body.querySelector('#shopify-sync-phase');
          if (!label) return;
          label.textContent = total ? `${phase}… ${done} of ${total}` : (done ? `${phase}… ${done} found` : `${phase}…`);
          body.querySelector('#shopify-sync-bar').style.width = `${total ? Math.max(8, Math.round((done / total) * 100)) : 8}%`;
        },
      });
      body.innerHTML = `<div class="space-y-3">
        <p class="text-sm font-medium"><i class="fa-solid fa-circle-check text-success-500"></i> Sync finished</p>
        <p class="text-sm text-[var(--text-secondary)]">${result.created} new, ${result.updated} updated${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.</p>
        ${result.skipped.length ? `<ul class="text-xs text-[var(--text-muted)] list-disc pl-4 max-h-32 overflow-y-auto space-y-1">${result.skipped.map((m) => `<li>${escapeHTML(m)}</li>`).join('')}</ul>` : ''}
        <div class="flex justify-end"><a href="products.html" class="btn btn-primary btn-sm">View products</a></div></div>`;
    } catch (err) {
      body.innerHTML = `<div class="space-y-3"><p class="alert alert-danger" role="alert"><i class="fa-solid fa-circle-exclamation mt-0.5"></i><span>${escapeHTML(err.message)}</span></p>
        <div class="flex justify-end"><button type="button" class="btn btn-secondary btn-sm" data-modal-close>Close</button></div></div>`;
    }
  });
}

const STATUS_BADGES = {
  disconnected: { cls: 'badge-neutral', label: 'Not connected' },
  saved: { cls: 'badge-warning', label: 'Saved — not verified' },
  connected: { cls: 'badge-success', label: 'Connected' },
  error: { cls: 'badge-danger', label: 'Problem' },
};

async function renderIntegrations() {
  const list = document.getElementById('integrations-list');
  const supported = integrationsSupported();
  let statuses = new Map();
  let isOwner = false;

  if (supported) {
    try {
      [statuses, isOwner] = await Promise.all([loadStatuses(), amIOwner()]);
    } catch (err) {
      list.innerHTML = `<p class="alert alert-danger" role="alert"><i class="fa-solid fa-circle-exclamation mt-0.5"></i><span>${escapeHTML(err.message)}${/does not exist|schema cache|PGRST20/i.test(err.message) ? ' — run the latest supabase/schema.sql in your Supabase SQL Editor.' : ''}</span></p>`;
      return;
    }
  }

  const intro = supported
    ? (isOwner
      ? 'Keys you enter are stored securely and can\'t be viewed again — not even by you. Only the server-side checker uses them.'
      : 'Only the shop owner can connect or change integrations. You can see what\'s connected.')
    : 'Connecting a service needs live sharing switched on, because the keys must be kept safely in your database (see the README). Until then these stay off.';

  list.innerHTML = `
    <p class="text-sm text-[var(--text-secondary)] mb-1">${escapeHTML(intro)}</p>
    ${INTEGRATIONS.map((integration) => {
      const state = statuses.get(integration.key) ?? { status: 'disconnected', settings: {}, message: '' };
      const badge = STATUS_BADGES[state.status] ?? STATUS_BADGES.disconnected;
      const connected = state.status !== 'disconnected';
      const details = integration.fields.filter((f) => !f.secret && state.settings?.[f.key]).map((f) => `${f.label}: ${escapeHTML(state.settings[f.key])}`).join(' · ');
      return `
        <div class="card p-4 space-y-3" data-integration="${integration.key}">
          <div class="flex items-start gap-4">
            <span class="w-10 h-10 rounded-lg bg-[var(--surface-sunken)] grid place-items-center shrink-0">
              <i class="${integration.style} ${integration.icon} text-lg" aria-hidden="true"></i>
            </span>
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-medium">${integration.name}</p>
                <span class="badge ${badge.cls}">${badge.label}</span>
              </div>
              <p class="text-xs text-[var(--text-muted)] mt-0.5">${integration.summary}</p>
              ${details ? `<p class="text-xs text-[var(--text-secondary)] mt-1 break-words">${details}</p>` : ''}
              ${connected && state.message ? `<p class="text-xs mt-1 ${state.status === 'error' ? 'text-danger-500' : 'text-[var(--text-secondary)]'}">${escapeHTML(state.message)}</p>` : ''}
              ${connected && state.connectedBy ? `<p class="text-[11px] text-[var(--text-muted)] mt-1">Set up by ${escapeHTML(state.connectedBy)}${state.checkedAt ? ` · last checked ${escapeHTML(new Date(state.checkedAt).toLocaleString())}` : ''}</p>` : ''}
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            ${!connected
              ? `<button class="btn btn-primary btn-sm" data-action="connect" ${supported && isOwner ? '' : 'disabled'} ${supported ? '' : 'title="Turn on live sharing first"'}><i class="fa-solid fa-plug"></i> Connect</button>`
              : (isOwner ? `
                ${integration.key === 'shopify' ? '<button class="btn btn-primary btn-sm" data-action="sync-products"><i class="fa-solid fa-cloud-arrow-down"></i> Sync products</button><button class="btn btn-secondary btn-sm" data-action="two-way"><i class="fa-solid fa-arrows-rotate"></i> Two-way sync</button>' : ''}
                <button class="btn btn-secondary btn-sm" data-action="test"><i class="fa-solid fa-rotate"></i> Test connection</button>
                ${integration.smsTest ? '<button class="btn btn-secondary btn-sm" data-action="sms"><i class="fa-solid fa-message"></i> Send test SMS</button>' : ''}
                <button class="btn btn-secondary btn-sm" data-action="connect"><i class="fa-solid fa-key"></i> Update keys</button>
                <button class="btn btn-ghost btn-sm text-danger-500" data-action="disconnect"><i class="fa-solid fa-link-slash"></i> Disconnect</button>` : '')}
          </div>
        </div>`;
    }).join('')}`;

  list.querySelectorAll('[data-integration]').forEach((card) => {
    const key = card.dataset.integration;
    card.querySelector('[data-action="connect"]')?.addEventListener('click', () => openConnectModal(key, statuses.get(key)));
    card.querySelector('[data-action="test"]')?.addEventListener('click', (e) => runTest(key, e.currentTarget));
    card.querySelector('[data-action="sync-products"]')?.addEventListener('click', openShopifySyncModal);
    card.querySelector('[data-action="two-way"]')?.addEventListener('click', openShopifyTwoWayModal);
    card.querySelector('[data-action="sms"]')?.addEventListener('click', () => openSmsModal());
    card.querySelector('[data-action="disconnect"]')?.addEventListener('click', () => confirmDisconnect(key));
  });
}

function reportResult(name, result) {
  if (result.ok === true) toast.success(result.message || `${name} is connected.`, { duration: 7000 });
  else if (result.ok === null) toast.info(result.message, { duration: 9000 });
  else toast.danger(result.message || `Couldn't connect to ${name}.`, { duration: 9000 });
}

async function runTest(key, button) {
  const integration = integrationByKey(key);
  button.disabled = true;
  try {
    reportResult(integration.name, await testConnection(key));
  } catch (err) {
    toast.danger(err.message);
  }
  await renderIntegrations();
}

async function confirmDisconnect(key) {
  const integration = integrationByKey(key);
  const ok = await modal.confirm({
    title: `Disconnect ${integration.name}?`,
    message: 'The saved keys are deleted from your database. You can connect again any time by entering them again.',
    confirmLabel: 'Disconnect',
  });
  if (!ok) return;
  try {
    await disconnect(key);
    toast.success(`${integration.name} disconnected and its keys deleted.`);
  } catch (err) {
    toast.danger(err.message);
  }
  await renderIntegrations();
}

function openConnectModal(key, state) {
  const integration = integrationByKey(key);
  const saved = state && state.status !== 'disconnected';
  const savedSecrets = Object.fromEntries(integration.fields.filter((f) => f.secret).map((f) => [f.key, saved]));

  const fieldHTML = (field) => `
    <div>
      <label class="field-label" for="int-${field.key}">${field.label}${field.secret ? ' <span class="text-[var(--text-muted)] font-normal">(kept private)</span>' : ''}</label>
      <input id="int-${field.key}" class="input" ${field.secret ? 'type="password"' : 'type="text"'} autocomplete="off" autocapitalize="none" spellcheck="false"
        value="${field.secret ? '' : escapeHTML(state?.settings?.[field.key] ?? '')}"
        placeholder="${field.secret && saved ? 'Saved — leave blank to keep it' : escapeHTML(field.placeholder ?? '')}"
        aria-describedby="int-${field.key}-hint" />
      <p id="int-${field.key}-hint" class="field-hint">${escapeHTML(field.hint ?? '')}</p>
      <p class="field-error hidden" data-error-for="${field.key}" role="alert"></p>
    </div>`;

  const el = modal.open({
    title: `${saved ? 'Update' : 'Connect'} ${integration.name}`,
    size: 'md',
    bodyHTML: `
      <form id="integration-form" class="space-y-4" novalidate>
        <p class="text-sm text-[var(--text-secondary)]">Find these in: <strong>${escapeHTML(integration.where)}</strong>.
          <a class="text-primary-600 font-medium underline" href="${integration.docsUrl}" target="_blank" rel="noopener noreferrer">Open it <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i></a></p>
        ${integration.fields.map(fieldHTML).join('')}
        <p class="text-xs text-[var(--text-muted)]"><i class="fa-solid fa-lock mr-1"></i> Keys are sent over a secure connection and stored so that nobody using this app can read them back.</p>
      </form>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="save-integration" type="button"><i class="fa-solid fa-plug"></i> Save &amp; test connection</button>`,
  });

  const showErrors = (errors) => el.querySelectorAll('[data-error-for]').forEach((p) => {
    const message = errors[p.dataset.errorFor];
    p.textContent = message ?? '';
    p.classList.toggle('hidden', !message);
    el.querySelector(`#int-${p.dataset.errorFor}`)?.setAttribute('aria-invalid', message ? 'true' : 'false');
  });

  const save = async () => {
    const button = el.querySelector('#save-integration');
    const values = Object.fromEntries(integration.fields.map((f) => [f.key, el.querySelector(`#int-${f.key}`).value]));
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving…';
    try {
      const { errors, result } = await connect(key, values, { alreadySaved: savedSecrets });
      if (errors) { showErrors(errors); return; }
      // The typed keys are gone from the form the moment they're saved.
      integration.fields.forEach((f) => { if (f.secret) el.querySelector(`#int-${f.key}`).value = ''; });
      modal.close();
      reportResult(integration.name, result);
      await renderIntegrations();
    } catch (err) {
      toast.danger(err.message);
    } finally {
      if (button.isConnected) { button.disabled = false; button.innerHTML = '<i class="fa-solid fa-plug"></i> Save &amp; test connection'; }
    }
  };
  el.querySelector('#save-integration').addEventListener('click', save);
  el.querySelector('#integration-form').addEventListener('submit', (e) => { e.preventDefault(); save(); });
}

function openSmsModal() {
  const el = modal.open({
    title: 'Send a test text message',
    size: 'sm',
    bodyHTML: `
      <div class="space-y-3">
        <p class="text-sm text-[var(--text-secondary)]">Hubtel can only be confirmed by really sending a message. Enter your own phone number, with country code.</p>
        <div>
          <label class="field-label" for="sms-to">Phone number</label>
          <input id="sms-to" class="input" type="tel" inputmode="tel" placeholder="+233240000000" autocomplete="tel" />
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" data-modal-close type="button">Cancel</button>
      <button class="btn btn-primary" id="send-sms" type="button"><i class="fa-solid fa-paper-plane"></i> Send</button>`,
  });
  el.querySelector('#send-sms').addEventListener('click', async () => {
    const button = el.querySelector('#send-sms');
    button.disabled = true;
    try {
      const result = await sendTestSms(el.querySelector('#sms-to').value);
      modal.close();
      reportResult('Hubtel', result);
      await renderIntegrations();
    } catch (err) {
      toast.danger(err.message);
      button.disabled = false;
    }
  });
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
    // Raw write, not storage.set() — must match the raw read every
    // page's pre-paint <head> script does. See topbar.js's
    // initThemeToggle() for the full explanation.
    localStorage.setItem(STORAGE_KEYS.THEME, e.target.checked ? 'dark' : 'light');
  });

  document.getElementById('save-preferences').addEventListener('click', () => saveSettings({
    lowStockAlerts: document.getElementById('f-low-stock-alerts').checked,
    emailNotifications: document.getElementById('f-email-notifications').checked,
  }, 'Preferences saved.'));
}

const LOCAL_LABELS = {
  products: 'products', categories: 'categories', brands: 'brands', suppliers: 'suppliers', warehouses: 'warehouses',
  customers: 'customers', employees: 'employees', sales: 'sales', onlineOrders: 'online orders', returns: 'returns',
  purchaseOrders: 'purchase orders', stockTransfers: 'stock transfers', invoices: 'invoices',
  inventoryLog: 'stock movements', activityLog: 'activity entries', notifications: 'notifications',
};

/** Data tab while cloud sync is on: upload what this browser already holds; wiping shared data is deliberately not offered here. */
function renderCloudDataForm() {
  const local = readLocalSummary();
  const parts = Object.entries(local.counts).map(([name, n]) => `${n} ${LOCAL_LABELS[name] ?? name}`);
  if (local.photos) parts.push(`${local.photos} photo${local.photos === 1 ? '' : 's'}`);
  document.getElementById('data-form').innerHTML = `
    <div class="space-y-4">
      <div class="card p-4 space-y-3">
        <div>
          <p class="text-sm font-medium">Upload this browser's data to the shared database</p>
          <p class="text-xs text-[var(--text-muted)] mt-1">${local.total
            ? `This browser still holds ${escapeHTML(parts.join(', '))} from before sharing was turned on. Copy them up so everyone sees them. Anything that already exists in the shared database is left untouched, and this browser's own copy is kept as a backup.`
            : 'Nothing from before sharing was turned on is stored in this browser, so there is nothing to upload.'}</p>
          ${local.lastRunAt ? `<p class="text-xs text-[var(--text-muted)] mt-1">Last uploaded ${escapeHTML(new Date(local.lastRunAt).toLocaleString())}.</p>` : ''}
        </div>
        <button id="upload-local-data" class="btn btn-primary btn-sm" ${local.total ? '' : 'disabled'}><i class="fa-solid fa-cloud-arrow-up"></i> Upload to shared database</button>
      </div>
      <div id="shared-reset" class="space-y-4"></div>
    </div>`;

  renderSharedReset();

  document.getElementById('upload-local-data').addEventListener('click', async () => {
    const ok = await modal.confirm({
      title: 'Upload this browser\'s data?',
      message: `This copies ${escapeHTML(parts.join(', '))} into the shared database. Existing shared records are never overwritten, so it's safe to run more than once.`,
      confirmLabel: 'Upload',
      danger: false,
    });
    if (!ok) return;

    const el = modal.open({
      title: 'Uploading…', size: 'sm',
      bodyHTML: `<div class="space-y-3" role="status" aria-live="polite">
        <p id="upload-label" class="text-sm text-[var(--text-secondary)]">Starting…</p>
        <div class="h-2 rounded-full overflow-hidden" style="background: var(--surface-sunken)"><div id="upload-bar" class="h-full" style="width:0; background: var(--color-primary-600); transition: width 200ms"></div></div>
      </div>`,
    });
    try {
      const result = await uploadLocalDataToCloud(({ label, done, total }) => {
        el.querySelector('#upload-label').textContent = `${label}… ${done} of ${total}`;
        el.querySelector('#upload-bar').style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
      });
      modal.close();
      const added = Object.values(result.added).reduce((a, b) => a + b, 0);
      toast.success(`Uploaded ${added} record${added === 1 ? '' : 's'}${result.photos ? ` and ${result.photos} photo${result.photos === 1 ? '' : 's'}` : ''}${result.skipped ? ` (${result.skipped} already there, left as they were)` : ''}.`, { duration: 7000 });
      renderCloudDataForm();
    } catch (err) {
      modal.close();
      toast.danger(err.message, { duration: 9000 });
    }
  });
}

/** Load Sample Data / Clear All Data against the shared database. Owner-only, and both affect everyone on the team. */
async function renderSharedReset() {
  const host = document.getElementById('shared-reset');
  if (!host) return;
  let isOwner = false;
  try { isOwner = await amIOwner(); } catch { /* treated as not an owner */ }
  if (!isOwner) {
    host.innerHTML = `<div class="card p-4"><p class="text-sm font-medium">Clear All Data and Sample Data</p>
      <p class="text-xs text-[var(--text-muted)] mt-1">Only the shop owner can wipe or reload the shared data, because it affects everyone on the team.</p></div>`;
    return;
  }
  host.innerHTML = `
    <div class="card p-4 flex items-center justify-between gap-4">
      <div>
        <p class="text-sm font-medium">Load Sample Data</p>
        <p class="text-xs text-[var(--text-muted)]">Adds example products, sales and customers to the shared database, <strong>visible to everyone on the team</strong>. Only fills collections that are completely empty, so it never mixes into real records.</p>
      </div>
      <button id="load-sample-data" class="btn btn-secondary btn-sm shrink-0"><i class="fa-solid fa-flask"></i> Load Sample Data</button>
    </div>
    <div class="card p-4 flex items-center justify-between gap-4" style="border-color: color-mix(in srgb, var(--color-danger-500) 30%, transparent)">
      <div>
        <p class="text-sm font-medium">Clear All Data</p>
        <p class="text-xs text-[var(--text-muted)]">Permanently deletes every product, order, customer, supplier, employee record and invoice from the shared database <strong>for everyone on the team</strong>. Staff access, store settings, and the activity and stock-movement history are kept.</p>
      </div>
      <button id="clear-all-data" class="btn btn-danger btn-sm shrink-0"><i class="fa-solid fa-trash"></i> Clear All Data</button>
    </div>`;

  document.getElementById('load-sample-data').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const ok = await modal.confirm({
      title: 'Load sample data?',
      message: 'This adds example records to the shared database that everyone on the team will see. Collections that already hold real records are skipped.',
      confirmLabel: 'Load sample data',
      danger: false,
    });
    if (!ok) return;
    button.disabled = true;
    try {
      const added = await loadCloudSampleData();
      toast.success(added ? `Added ${added} sample records.` : 'Nothing added — every collection already has data.');
      if (added) setTimeout(() => window.location.reload(), 800);
    } catch (err) { toast.danger(err.message, { duration: 9000 }); } finally { button.disabled = false; }
  });

  document.getElementById('clear-all-data').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    let populated = true;
    try { populated = await cloudHasData(); } catch { /* let them try anyway */ }
    if (!populated) { toast.info('There is nothing to clear right now.'); return; }
    if (!(await confirmByTyping({
      title: 'Clear ALL shared data?',
      message: 'This permanently deletes every product, order, customer, supplier, employee record and invoice for <strong>everyone on the team</strong>. It cannot be undone. Staff access, store settings and the activity and stock-movement history are kept.',
      word: 'DELETE',
      confirmLabel: 'Clear Everything',
    }))) return;
    button.disabled = true;
    try {
      await clearCloudData();
      clearAllData(); // this browser's own leftover copy too
      toast.success('All shared data cleared.');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) { toast.danger(err.message, { duration: 9000 }); } finally { button.disabled = false; }
  });
}

/** A confirmation that only enables its button once the exact word has been typed. Resolves true/false. */
function confirmByTyping({ title, message, word, confirmLabel }) {
  return new Promise((resolve) => {
    const el = modal.open({
      title, size: 'sm',
      bodyHTML: `<div class="space-y-4">
        <p class="text-sm text-[var(--text-secondary)]">${message}</p>
        <div><label class="field-label" for="type-confirm">Type <strong>${word}</strong> to confirm</label>
        <input id="type-confirm" class="input" type="text" autocomplete="off" spellcheck="false" /></div>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-secondary btn-sm" data-cancel>Cancel</button>
          <button type="button" class="btn btn-danger btn-sm" data-go disabled>${confirmLabel}</button>
        </div></div>`,
    });
    const input = el.querySelector('#type-confirm');
    const go = el.querySelector('[data-go]');
    input.addEventListener('input', () => { go.disabled = input.value.trim() !== word; });
    el.querySelector('[data-cancel]').addEventListener('click', () => { modal.close(); resolve(false); });
    go.addEventListener('click', () => { if (input.value.trim() === word) { modal.close(); resolve(true); } });
    input.focus();
  });
}

function renderDataForm() {
  if (CLOUD_SYNC) { renderCloudDataForm(); return; }
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
