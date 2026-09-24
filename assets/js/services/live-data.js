/**
 * live-data.js — one line per page to make it update by itself when data
 * changes, including changes made on someone else's device.
 *
 *   watchData(['products', 'categories'], refreshTable);
 *
 * `names` are api.service.js collection names (or collection objects). Bursts of
 * changes (a checkout touches stock, a log entry, a notification…) are merged into
 * one refresh. The refresh runs as a "live refresh", so tables update quietly —
 * see live-flag.js.
 *
 * Works the same in local mode (a change in another tab of the same browser) and
 * with cloud sync on (a change on any device). Returns a function that stops watching.
 */
import { api } from './api.service.js';
import { runAsLiveRefresh } from '../utils/live-flag.js';

export function watchData(names, refresh, { debounceMs = 300 } = {}) {
  let timer = null;
  let running = false;
  let again = false;

  const run = async () => {
    if (running) { again = true; return; }   // a refresh is mid-flight — go once more when it finishes
    running = true;
    try { await runAsLiveRefresh(refresh); } catch (err) { console.error('[live] refresh failed', err); }
    running = false;
    if (again) { again = false; trigger(); }
  };
  const trigger = () => { clearTimeout(timer); timer = setTimeout(run, debounceMs); };

  const stops = names.map((name) => (typeof name === 'string' ? api[name] : name).subscribe(trigger));
  return () => { clearTimeout(timer); stops.forEach((stop) => stop?.()); };
}
