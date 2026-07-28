/**
 * app.js — per-page bootstrap. Every page's closing <script type="module">
 * imports and calls `bootstrapApp()`. It:
 *   1. Injects the shared sidebar/topbar partials
 *   2. Renders nav + wires theme/search/notifications
 *
 * The app starts with genuinely empty data — every collection is backed
 * by `storage.get(key, [])`, so an absent key just reads as an empty
 * list, no seeding required. Sample data is opt-in from Settings → Data
 * (see reset.service.js) rather than something every fresh load injects.
 *
 * Keeping this orchestration in one file means adding a 21st page is
 * "copy the shell, set data-page, write content" — no new wiring required.
 */
import { injectPartial } from './utils/helpers.js';
import { renderSidebar, initSidebarToggle } from './components/sidebar.js';
import { initTopbar } from './components/topbar.js';
import { migrateLegacyAutoSeed } from './services/reset.service.js';
import { toast } from './components/toast.js';

export async function bootstrapApp() {
  const clearedLegacyDemoData = migrateLegacyAutoSeed();

  await Promise.all([
    injectPartial('#sidebar-mount', '/components/sidebar.html'),
    injectPartial('#topbar-mount', '/components/topbar.html'),
  ]);

  renderSidebar();
  initSidebarToggle();
  initTopbar();

  if (clearedLegacyDemoData) {
    toast.info("Cleared the old demo data this browser had cached — you're starting fresh. Load sample data anytime from Settings → Data.", { duration: 6000 });
  }

  document.dispatchEvent(new CustomEvent('invsync:ready'));
}
