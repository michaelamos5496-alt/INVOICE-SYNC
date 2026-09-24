/**
 * sync-status.js — the small "Live / Saving / Offline" indicator in the top bar,
 * and the toast for problems that happen after someone has moved on (e.g. a
 * background save the database refused). Only does anything while cloud sync is on.
 */
import { CLOUD_SYNC } from '../config/supabase.config.js';
import { getSyncState, friendlyDataError } from '../services/cloud-data.service.js';
import { toast } from './toast.js';

const STATES = {
  offline: { label: 'Offline', color: 'var(--color-danger-500)', hint: 'You\'re offline. You can look around, but changes need a connection.' },
  connecting: { label: 'Connecting…', color: 'var(--color-warning-500)', hint: 'Connecting to live updates…' },
  saving: { label: 'Saving…', color: 'var(--color-info-500)', hint: 'Saving your changes…' },
  live: { label: 'Live', color: 'var(--color-success-500)', hint: 'Live — changes from your team appear as they happen.' },
};

export function initSyncStatus() {
  const chip = document.getElementById('sync-chip');
  if (!CLOUD_SYNC || !chip) return;

  const render = (detail = getSyncState()) => {
    const key = !detail.online ? 'offline' : detail.pendingWrites > 0 ? 'saving' : detail.live ? 'live' : 'connecting';
    const state = STATES[key];
    document.getElementById('sync-dot').style.background = state.color;
    document.getElementById('sync-label').textContent = state.label;
    chip.title = state.hint;
    chip.setAttribute('aria-label', `Sync status: ${state.label}`);
    chip.classList.remove('hidden');
    chip.classList.add('inline-flex');
  };
  render();
  window.addEventListener('invsync:sync-state', (event) => render(event.detail));

  // Errors from background work: at most one toast every 15 seconds, so a burst doesn't bury the screen.
  let lastToastAt = 0;
  window.addEventListener('invsync:sync-error', (event) => {
    if (Date.now() - lastToastAt < 15_000 || !navigator.onLine) return;
    lastToastAt = Date.now();
    toast.danger(friendlyDataError({ code: event.detail.code, message: event.detail.message }), { duration: 6000 });
  });
}
