/**
 * cloud-data.service.js — the shared-database version of api.service.js's
 * collection interface, backed by Supabase (Postgres). Every collection exposes the
 * same methods as the local (localStorage) adapter — list / get / create / update /
 * remove / subscribe — plus `mutate`, so pages and services don't know or care which
 * one they're talking to.
 *
 * How it stays fast:
 *   • Each collection loads once and then keeps a live copy in memory. list() and get()
 *     read that copy — no network round trip — and Supabase Realtime pushes other
 *     people's changes in as they happen, which is what makes every open screen update.
 *   • Busy "history" collections (sales, logs…) only load the last N days (`windowDays`),
 *     so the amount downloaded doesn't keep growing forever.
 *   • Writes update the in-memory copy immediately, so the UI feels instant, and are
 *     rolled back if the database refuses them.
 *
 * How it stays correct with many people at once:
 *   • mutate(id, fn) is "read, compute, write only if nobody changed it meanwhile" with
 *     automatic retry. Stock changes use it, so two people selling the last unit at the same
 *     moment can't both succeed.
 *   • update(id, patch) changes only the fields in the patch (merge_doc in schema.sql), so
 *     renaming a product can't wipe out a stock change someone else just made.
 *   • This needs a connection — deliberate, because stock is shared. Without one, changes are
 *     refused with a clear message instead of being silently lost or duplicated later.
 *
 * Each collection is one table of JSON documents: id · data · version · created_at (see schema.sql).
 */
import { getSupabase } from './supabase.service.js';
import { generateId } from '../utils/ids.js';

const PAGE_SIZE = 1000;              // Supabase returns at most 1000 rows per request
const REALTIME_WAIT_MS = 5000;       // don't hold up first load forever if live updates can't connect
const MUTATE_RETRIES = 6;
const FALLBACK_POLL_MS = 30_000;     // only used while live updates are down

// ---------------------------------------------------------------------
// Sync state — drives the little "Live / Offline" indicator in the top bar
// ---------------------------------------------------------------------
let pendingWrites = 0;
const live = new Map(); // table → whether its live-update channel is connected

const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

export function getSyncState() {
  const channels = [...live.values()];
  return {
    online: navigator.onLine,
    live: channels.length > 0 && channels.every(Boolean),
    pendingWrites,
  };
}

const emitState = () => emit('invsync:sync-state', getSyncState());
window.addEventListener('online', emitState);
window.addEventListener('offline', emitState);

function trackPending(promise) {
  pendingWrites += 1;
  emitState();
  const done = () => { pendingWrites = Math.max(0, pendingWrites - 1); emitState(); };
  promise.then(done, done);
}

/** Tells the rest of the app about a failure that happened after the user had already moved on. */
export function reportSyncError(error, context = '') {
  console.error(`[sync] ${context}`, error);
  emit('invsync:sync-error', { code: error?.code ?? 'unknown', message: error?.message ?? String(error), context });
}

const isNetworkError = (error) => /failed to fetch|networkerror|load failed|network request failed/i.test(error?.message ?? '');

/** Turns database/network errors into messages a shop owner can act on. */
export function friendlyDataError(error) {
  const code = String(error?.code ?? '');
  if (isNetworkError(error) || !navigator.onLine) return 'You appear to be offline. Changes need a connection so everyone sees the same thing — try again when you\'re back online.';
  if (code === '42501' || /row-level security/i.test(error?.message ?? '')) return 'You don\'t have permission to do that. Ask the shop owner if you need access.';
  if (code === '23514' && /stock/i.test(error?.message ?? '')) return 'That would take stock below zero.';
  if (code === '23505') return 'That record already exists.';
  if (code === 'P0002' || error?.message === 'not_found') return 'That record no longer exists — someone else may have deleted it.';
  if (code === 'PGRST301' || /jwt/i.test(error?.message ?? '')) return 'Your session has expired. Please sign in again.';
  if (code === 'PGRST202') return 'The database isn\'t fully set up. Run supabase/schema.sql in the Supabase SQL Editor.';
  return error?.message || 'Something went wrong while saving.';
}

// ---------------------------------------------------------------------
// Collection factory
// ---------------------------------------------------------------------
/**
 * @param {string} path        Collection name, e.g. 'online-orders' (→ table `online_orders`).
 * @param {string} idPrefix    Prefix for generated ids.
 * @param {{ windowDays?: number }} [options]  Only load records created in the last N days (busy history collections).
 */
export function createCloudCollection(path, idPrefix, { windowDays = null } = {}) {
  const table = path.replace(/-/g, '_');
  let started = null;
  const listeners = new Set();

  const now = () => new Date().toISOString();
  const rowToRecord = (row) => ({ ...row.data, id: row.id });
  const recordToRow = ({ id, ...data }) => ({ id, data, created_at: data.createdAt ?? now() });

  function start() {
    started ??= (async () => {
      const client = await getSupabase();
      const cutoff = windowDays ? new Date(Date.now() - windowDays * 86_400_000).toISOString() : null;
      const docs = new Map();
      const notify = () => {
        const all = [...docs.values()];
        listeners.forEach((handler) => { try { handler(all); } catch (err) { console.error(err); } });
      };

      // ---- initial (and re-sync) load, paged because the API returns at most 1000 rows at a time ----
      async function loadAll() {
        const rows = [];
        for (let from = 0; ; from += PAGE_SIZE) {
          let query = client.from(table).select('id,data,created_at').order('created_at', { ascending: true }).order('id').range(from, from + PAGE_SIZE - 1);
          if (cutoff) query = query.gte('created_at', cutoff);
          const { data, error } = await query;
          if (error) throw error;
          rows.push(...data);
          if (data.length < PAGE_SIZE) break;
        }
        docs.clear();
        rows.forEach((row) => docs.set(row.id, rowToRecord(row)));
      }

      // ---- live updates: apply what other people change ----
      let loaded = false;
      let buffered = [];
      const applyChange = (payload) => {
        if (payload.eventType === 'DELETE') { docs.delete(payload.old?.id); return; }
        const row = payload.new;
        if (!row) return;
        // A change to a record older than our window (e.g. a paid-off old invoice) isn't something we hold — skip it.
        if (cutoff && !docs.has(row.id) && new Date(row.created_at) < new Date(cutoff)) return;
        docs.set(row.id, rowToRecord(row));
      };

      let everConnected = false;
      let pollTimer = null;
      const channel = client
        .channel(`live:${table}:${Math.random().toString(36).slice(2, 8)}`) // unique per collection object, so two of them can never share (and collide on) one channel
        .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
          if (!loaded) { buffered.push(payload); return; }
          applyChange(payload);
          notify();
        })
        .subscribe(async (status) => {
          const connected = status === 'SUBSCRIBED';
          live.set(table, connected);
          emitState();
          if (connected) {
            clearInterval(pollTimer); pollTimer = null;
            if (everConnected && loaded) { // reconnected after a drop — we may have missed changes, so start over from the database
              try { await loadAll(); notify(); } catch (err) { reportSyncError(err, `re-syncing ${table}`); }
            }
            everConnected = true;
          } else if (loaded && !pollTimer) {
            // Live updates are down: keep the screen roughly fresh by re-reading until they're back.
            pollTimer = setInterval(async () => {
              if (!navigator.onLine || document.hidden) return;
              try { await loadAll(); notify(); } catch { /* still offline */ }
            }, FALLBACK_POLL_MS);
          }
        });

      // Wait (briefly) for the live channel BEFORE loading, so nothing that changes in between is missed.
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, REALTIME_WAIT_MS);
        const check = setInterval(() => { if (live.get(table)) { clearTimeout(timer); clearInterval(check); resolve(); } }, 50);
        setTimeout(() => clearInterval(check), REALTIME_WAIT_MS + 100);
      });
      await loadAll();
      loaded = true;
      buffered.forEach(applyChange);
      buffered = [];

      return { client, docs, notify, loadAll, channel };
    })().catch((err) => { started = null; throw err; });
    return started;
  }

  const byCreated = (a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));

  /** Runs a database write. Failures roll back the optimistic change and throw a friendly message. */
  async function write(operation, rollback) {
    const promise = Promise.resolve().then(operation);
    trackPending(promise.catch(() => {}));
    try {
      const { data, error } = await promise;
      if (error) throw error;
      return data;
    } catch (err) {
      rollback();
      throw Object.assign(new Error(friendlyDataError(err)), { code: err?.code });
    }
  }

  return {
    async list(filterFn) {
      const s = await start();
      const all = [...s.docs.values()].sort(byCreated);
      return typeof filterFn === 'function' ? all.filter(filterFn) : all;
    },

    async get(id) {
      const s = await start();
      if (s.docs.has(id)) return s.docs.get(id);
      if (!windowDays) return null; // the whole collection is in memory, so a miss is a real miss
      const { data } = await s.client.from(table).select('id,data').eq('id', id).maybeSingle(); // older than the loaded window
      return data ? rowToRecord(data) : null;
    },

    async create(record) {
      const s = await start();
      const stamp = now();
      const newRecord = { id: generateId(idPrefix), createdAt: stamp, updatedAt: stamp, ...record };
      s.docs.set(newRecord.id, newRecord);
      s.notify();
      await write(() => s.client.from(table).insert(recordToRow(newRecord)), () => { s.docs.delete(newRecord.id); s.notify(); });
      return newRecord;
    },

    async update(id, patch) {
      const s = await start();
      const current = s.docs.get(id) ?? await this.get(id);
      if (!current) throw new Error(`Record ${id} not found in ${path}`);
      const changes = { ...patch, updatedAt: now() };
      const updated = { ...current, ...changes, id };
      s.docs.set(id, updated);
      s.notify();
      await write(
        () => s.client.rpc('merge_doc', { tbl: table, row_id: id, patch: changes }),
        () => { s.docs.set(id, current); s.notify(); },
      );
      return updated;
    },

    async remove(id) {
      const s = await start();
      const current = s.docs.get(id);
      s.docs.delete(id);
      s.notify();
      const rollback = () => { if (current) { s.docs.set(id, current); s.notify(); } };
      const deleted = await write(() => s.client.from(table).delete().eq('id', id).select('id'), rollback);
      if (!deleted?.length) {
        // Nothing was deleted: either it was already gone, or row-level security refused. Only the second is an error.
        const { data: stillThere } = await s.client.from(table).select('id').eq('id', id).maybeSingle();
        if (stillThere) { rollback(); throw Object.assign(new Error(friendlyDataError({ code: '42501' })), { code: '42501' }); }
      }
      return true;
    },

    /**
     * Atomic read-modify-write. `fn(current)` returns the fields to change (or throws to abort — e.g. "not
     * enough stock"). If somebody else changes the record between our read and our write, we read again and
     * re-run `fn`, so it must only compute from `current`. Needs a connection.
     */
    async mutate(id, fn) {
      const s = await start();
      for (let attempt = 0; attempt < MUTATE_RETRIES; attempt += 1) {
        let row;
        try {
          const { data, error } = await s.client.from(table).select('id,data,version').eq('id', id).maybeSingle();
          if (error) throw error;
          row = data;
        } catch (err) {
          throw Object.assign(new Error(friendlyDataError(err)), { code: err?.code });
        }
        if (!row) throw new Error(`Record ${id} not found in ${path}`);

        const changes = { ...fn(rowToRecord(row)), updatedAt: now() }; // may throw — our own errors pass through untouched
        let result;
        try {
          const promise = Promise.resolve(s.client.rpc('merge_doc', { tbl: table, row_id: id, patch: changes, expected_version: row.version }));
          trackPending(promise.then(() => {}, () => {}));
          const { data, error } = await promise;
          if (error) throw error;
          result = data;
        } catch (err) {
          throw Object.assign(new Error(friendlyDataError(err)), { code: err?.code });
        }

        if (result) { // saved
          const updated = rowToRecord(result);
          s.docs.set(id, updated);
          s.notify();
          return updated;
        }
        // Someone else changed it at the same moment — wait a beat (with jitter) and try again from their version.
        await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 80 * (attempt + 1)));
      }
      throw new Error('Several people are changing this at the same moment. Please try again.');
    },

    /** Calls `handler(allRecords)` whenever this collection changes — including changes made by other people. */
    subscribe(handler) {
      start().catch(() => {});
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
}
