/**
 * app.js — per-page bootstrap. Every page's closing <script type="module">
 * imports and calls `bootstrapApp()`. It:
 *   0. Gates the page behind a Supabase session (see auth.service.js) —
 *      signed-out visitors are redirected to the login page and this
 *      function never resolves, so no page content is ever initialised
 *   1. Injects the shared sidebar/topbar partials
 *   2. Renders nav + wires theme/search/notifications + the signed-in user
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
import { renderSidebar, renderSidebarUser, initSidebarToggle } from './components/sidebar.js';
import { initTopbar } from './components/topbar.js';
import { migrateLegacyAutoSeed } from './services/reset.service.js';
import { toast } from './components/toast.js';
import { requireSession } from './services/auth.service.js';

export async function bootstrapApp() {
  const { user } = await requireSession();
  const clearedLegacyDemoData = migrateLegacyAutoSeed();

  await Promise.all([
    injectPartial('#sidebar-mount', '/components/sidebar.html'),
    injectPartial('#topbar-mount', '/components/topbar.html'),
  ]);

  renderSidebar();
  renderSidebarUser(user);
  initSidebarToggle();
  initTopbar();
  // Page shells stay hidden (see main.css) until the session is confirmed.
  document.body.classList.add('auth-ready');

  if (clearedLegacyDemoData) {
    toast.info("Cleared the old demo data this browser had cached — you're starting fresh. Load sample data anytime from Settings → Data.", { duration: 6000 });
  }

  document.dispatchEvent(new CustomEvent('invsync:ready'));
}
