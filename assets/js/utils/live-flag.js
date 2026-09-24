/**
 * live-flag.js — lets the shared table component tell a refresh caused by
 * someone ELSE's change (data arrived over the live connection) from one the
 * user just asked for.
 *
 * Live refreshes should be invisible: no loading skeleton flash, and no
 * bouncing the user back to page 1 while they're browsing page 3. A refresh the
 * user asked for (changing a filter, saving a form) keeps the old behaviour.
 */
let depth = 0;

export const isLiveRefresh = () => depth > 0;

/** Runs `fn` (a page's normal refresh function) marked as a live refresh. */
export async function runAsLiveRefresh(fn) {
  depth += 1;
  try { return await fn(); } finally { depth -= 1; }
}
