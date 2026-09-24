/**
 * image-store.service.js — where uploaded product photos live.
 *
 * Product records only hold a short reference string; the photo itself is stored
 * elsewhere. Which "elsewhere" depends on the mode:
 *
 *   CLOUD_SYNC on  → `sb:<file>`  a file in your Supabase Storage bucket, so every device
 *                    sees it. Downloaded photos are cached in this browser (IndexedDB) so a
 *                    list of products doesn't re-download the same pictures every visit.
 *   CLOUD_SYNC off → `idb:<uuid>` a Blob in this browser's IndexedDB. That's deliberate:
 *                    localStorage (where every other collection lives) caps out around 5 MB,
 *                    which a shop's worth of photos would exhaust after ~100 products.
 *
 * A ref can also be a plain http(s) URL (pasted by the user) or a `data:image/…` URL. The
 * latter is the fallback used in local mode when IndexedDB is unavailable (some
 * private-browsing modes), so uploads keep working — they just count against the smaller
 * localStorage budget.
 *
 * Like storage.service.js, this is the single door to this storage — pages just call
 * saveImage() / imageTagHTML() / hydrateImages().
 */
import { escapeHTML, isSafeImageUrl } from '../utils/helpers.js';
import { CLOUD_SYNC, IMAGE_BUCKET } from '../config/supabase.config.js';
import { getSupabase } from './supabase.service.js';

const DB_NAME = 'invsync-images';
const LOCAL_STORE = 'images';          // local mode: the photos themselves
const CACHE_STORE = 'cloud-cache';     // sync mode: copies of photos downloaded from the shared bucket
const LOCAL_PREFIX = 'idb:';
const CLOUD_PREFIX = 'sb:';

export const isIdbRef = (ref) => typeof ref === 'string' && ref.startsWith(LOCAL_PREFIX);
export const isCloudRef = (ref) => typeof ref === 'string' && ref.startsWith(CLOUD_PREFIX);
/** A photo kept by this service (as opposed to a pasted URL or an inline data URL). */
export const isStoredRef = (ref) => isIdbRef(ref) || isCloudRef(ref);

// ---------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------
let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    let request;
    try { request = indexedDB.open(DB_NAME, 2); } catch (err) { reject(err); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_STORE)) db.createObjectStore(LOCAL_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  }).catch((err) => { dbPromise = null; throw err; });
  return dbPromise;
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'));
  });
}

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const extensionFor = (type) => ({ 'image/webp': 'webp', 'image/png': 'png', 'image/gif': 'gif' })[type] ?? 'jpg';
const cloudPath = (ref) => ref.slice(CLOUD_PREFIX.length);

// ---------------------------------------------------------------------
// Shared bucket (sync mode)
// ---------------------------------------------------------------------
async function cloudSave(blob) {
  const client = await getSupabase();
  const path = `${crypto.randomUUID()}.${extensionFor(blob.type)}`;
  const { error } = await client.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
  if (error) throw new Error(/row-level security|not authorized|403/i.test(error.message)
    ? 'You don\'t have permission to upload photos. Ask the shop owner if you need access.'
    : 'Couldn\'t upload the photo — check your connection and try again.');
  withStore(CACHE_STORE, 'readwrite', (store) => store.put({ id: path, blob })).catch(() => {}); // we already have the bytes: no need to download them back
  return `${CLOUD_PREFIX}${path}`;
}

async function cloudBlob(ref) {
  const path = cloudPath(ref);
  try {
    const cached = await withStore(CACHE_STORE, 'readonly', (store) => store.get(path));
    if (cached?.blob) return cached.blob;
  } catch { /* no cache available — fall through to a download */ }
  const client = await getSupabase();
  const { data, error } = await client.storage.from(IMAGE_BUCKET).download(path);
  if (error || !data) return null;
  withStore(CACHE_STORE, 'readwrite', (store) => store.put({ id: path, blob: data })).catch(() => {});
  return data;
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------
/**
 * Stores a photo and returns the ref to put on the product. In sync mode a failure THROWS (a product must never point
 * at a photo only one browser has); in local mode it falls back to an inline data URL if IndexedDB is unavailable.
 */
export async function saveImage(blob) {
  if (CLOUD_SYNC) return cloudSave(blob);
  try {
    const id = crypto.randomUUID();
    await withStore(LOCAL_STORE, 'readwrite', (store) => store.put({ id, blob, type: blob.type, savedAt: Date.now() }));
    return `${LOCAL_PREFIX}${id}`;
  } catch (err) {
    console.warn('[images] IndexedDB unavailable, falling back to an inline data URL', err);
    return blobToDataUrl(blob);
  }
}

async function getBlob(ref) {
  if (isCloudRef(ref)) return cloudBlob(ref);
  const record = await withStore(LOCAL_STORE, 'readonly', (store) => store.get(ref.slice(LOCAL_PREFIX.length)));
  return record?.blob ?? null;
}

/** Deletes any stored photos among `refs`; URLs and data refs are ignored. Never throws — cleanup must not block a save. */
export async function deleteImages(refs = []) {
  const local = refs.filter(isIdbRef);
  const cloud = refs.filter(isCloudRef);
  if (local.length) {
    try {
      await withStore(LOCAL_STORE, 'readwrite', (store) => { local.forEach((ref) => store.delete(ref.slice(LOCAL_PREFIX.length))); });
    } catch (err) { console.warn('[images] Could not delete stored photos', err); }
  }
  if (cloud.length) {
    try {
      const client = await getSupabase();
      await client.storage.from(IMAGE_BUCKET).remove(cloud.map(cloudPath));
      await withStore(CACHE_STORE, 'readwrite', (store) => { cloud.forEach((ref) => store.delete(cloudPath(ref))); }).catch(() => {});
    } catch (err) { console.warn('[images] Could not delete shared photos', err); }
  }
  [...local, ...cloud].forEach((ref) => { const url = urlCache.get(ref); if (url) { URL.revokeObjectURL(url); urlCache.delete(ref); } });
}

/** Wipes every photo stored in this browser (local mode: Settings → Data → Clear). Never touches the shared bucket. */
export async function clearAllImages() {
  try {
    await withStore(LOCAL_STORE, 'readwrite', (store) => store.clear());
  } catch { /* nothing stored, or IndexedDB unavailable — nothing to clear */ }
  urlCache.forEach((url) => URL.revokeObjectURL(url));
  urlCache.clear();
}

/** Removes the downloaded copies of shared photos from this browser (done at sign-out so a shared computer keeps nothing). */
export async function clearCloudImageCache() {
  try { await withStore(CACHE_STORE, 'readwrite', (store) => store.clear()); } catch { /* nothing cached */ }
  for (const [ref, url] of urlCache) if (isCloudRef(ref)) { URL.revokeObjectURL(url); urlCache.delete(ref); }
}

/** Copies a stored photo so a duplicated product doesn't share (and later lose) its original's file. */
export async function cloneImage(ref) {
  if (!isStoredRef(ref)) return ref;
  try {
    const blob = await getBlob(ref);
    return blob ? await saveImage(blob) : null;
  } catch {
    return null;
  }
}

/** Reads a stored photo's bytes (used by the local→cloud upload tool). */
export async function readLocalImage(ref) {
  return isIdbRef(ref) ? getBlob(ref) : null;
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
const urlCache = new Map(); // ref -> object URL, so a list re-render doesn't re-read every photo

/** Resolves a ref to something usable as an <img src>, or null if the photo is gone. */
export async function resolveImageUrl(ref) {
  if (!isStoredRef(ref)) return isSafeImageUrl(ref) ? ref : null;
  if (urlCache.has(ref)) return urlCache.get(ref);
  try {
    const blob = await getBlob(ref);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(ref, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Returns an <img> tag string for a product photo ref. Photos held in storage have
 * no src yet — call hydrateImages() on the container after inserting the markup to
 * fill them in. `fallbackClass` is the icon shown if the photo can't be found
 * (e.g. browser data was cleared).
 */
export function imageTagHTML(ref, { className = '', fallbackClass = 'fa-solid fa-box text-[var(--text-muted)]' } = {}) {
  const fallback = `<i class="${fallbackClass}" aria-hidden="true"></i>`;
  if (!ref) return fallback;
  if (isStoredRef(ref)) return `<img data-img-ref="${escapeHTML(ref)}" data-img-fallback="${escapeHTML(fallbackClass)}" class="${className}" alt="" />`;
  return isSafeImageUrl(ref) ? `<img src="${escapeHTML(ref)}" class="${className}" alt="" />` : fallback;
}

export async function hydrateImages(root = document) {
  const pending = [...root.querySelectorAll('img[data-img-ref]')];
  await Promise.all(pending.map(async (img) => {
    const url = await resolveImageUrl(img.dataset.imgRef);
    if (!img.isConnected) return; // the list re-rendered while we were reading the photo
    if (url) { img.src = url; return; }
    const icon = document.createElement('i');
    icon.className = img.dataset.imgFallback ?? 'fa-solid fa-box';
    icon.setAttribute('aria-hidden', 'true');
    img.replaceWith(icon);
  }));
}
