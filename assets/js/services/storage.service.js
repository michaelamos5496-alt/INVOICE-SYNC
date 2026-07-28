/**
 * storage.service.js
 *
 * Thin localStorage wrapper acting as the offline "database" for local
 * development and demos. This is the ONLY module that touches
 * window.localStorage directly — every other module goes through
 * api.service.js, which delegates here today and will delegate to a real
 * HTTP client in Phase 10 without callers needing to change.
 *
 * Keeping a single read/write chokepoint here is what guarantees the
 * "one source of truth" requirement: the physical POS and the online
 * store both read/write the same product record through this module, so
 * there is no possibility of two divergent stock counts.
 */
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.error(`[storage] Failed to read "${key}"`, err);
      return fallback;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      // Notify same-tab listeners (native "storage" events only fire
      // cross-tab). Components subscribe via storage.on(key, handler).
      window.dispatchEvent(new CustomEvent('invsync:storage', { detail: { key, value } }));
      return true;
    } catch (err) {
      console.error(`[storage] Failed to write "${key}"`, err);
      return false;
    }
  },

  remove(key) {
    localStorage.removeItem(key);
  },

  /** Subscribe to changes on a specific key, including cross-tab updates. */
  on(key, handler) {
    const localListener = (e) => { if (e.detail.key === key) handler(e.detail.value); };
    const crossTabListener = (e) => { if (e.key === key) handler(this.get(key)); };
    window.addEventListener('invsync:storage', localListener);
    window.addEventListener('storage', crossTabListener);
    return () => {
      window.removeEventListener('invsync:storage', localListener);
      window.removeEventListener('storage', crossTabListener);
    };
  },

  /** Seed a key only if it doesn't already exist. Used on first app load. */
  seedIfEmpty(key, data) {
    if (this.get(key) === null) this.set(key, data);
  },
};
