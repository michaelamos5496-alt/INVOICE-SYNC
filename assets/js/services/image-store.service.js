/**
 * image-store.service.js — where uploaded product photos live.
 *
 * Product records only hold a short reference string (`idb:<uuid>`); the
 * photo itself is a Blob in IndexedDB. That's deliberate: localStorage
 * (where every other collection lives) caps out around 5 MB, which a
 * shop's worth of photos would exhaust after ~100 products, while
 * IndexedDB has room for hundreds of MB.
 *
 * A ref can also be a plain http(s) URL (pasted by the user) or a
 * `data:image/…` URL. The latter is the fallback used when IndexedDB is
 * unavailable (some private-browsing modes), so uploads keep working —
 * they just count against the smaller localStorage budget.
 *
 * Like storage.service.js, this is the single door to this storage; when
 * Phase 10 adds real object storage only this module (and the ref format
 * it returns) changes — pages keep calling saveImage()/imageTagHTML().
 */
import { escapeHTML, isSafeImageUrl } from '../utils/helpers.js';

const DB_NAME = 'invsync-images';
const STORE = 'images';
const REF_PREFIX = 'idb:';

export const isIdbRef = (ref) => typeof ref === 'string' && ref.startsWith(REF_PREFIX);

// ---------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------
let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    let request;
    try { request = indexedDB.open(DB_NAME, 1); } catch (err) { reject(err); return; }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  }).catch((err) => { dbPromise = null; throw err; });
  return dbPromise;
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
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

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------
/** Stores a photo and returns the ref to put on the product (`idb:…`, or a data URL if IndexedDB isn't available). */
export async function saveImage(blob) {
  try {
    const id = crypto.randomUUID();
    await withStore('readwrite', (store) => store.put({ id, blob, type: blob.type, savedAt: Date.now() }));
    return `${REF_PREFIX}${id}`;
  } catch (err) {
    console.warn('[images] IndexedDB unavailable, falling back to an inline data URL', err);
    return blobToDataUrl(blob);
  }
}

async function getBlob(ref) {
  const record = await withStore('readonly', (store) => store.get(ref.slice(REF_PREFIX.length)));
  return record?.blob ?? null;
}

/** Deletes any stored photos among `refs`; http and data refs are ignored. Never throws — cleanup must not block a save. */
export async function deleteImages(refs = []) {
  const ids = refs.filter(isIdbRef);
  if (!ids.length) return;
  try {
    await withStore('readwrite', (store) => { ids.forEach((ref) => store.delete(ref.slice(REF_PREFIX.length))); });
  } catch (err) {
    console.warn('[images] Could not delete stored photos', err);
  }
  ids.forEach((ref) => { const url = urlCache.get(ref); if (url) { URL.revokeObjectURL(url); urlCache.delete(ref); } });
}

/** Wipes every stored photo (used by Settings → Data → Clear). */
export async function clearAllImages() {
  try {
    await withStore('readwrite', (store) => store.clear());
  } catch { /* nothing stored, or IndexedDB unavailable — nothing to clear */ }
  urlCache.forEach((url) => URL.revokeObjectURL(url));
  urlCache.clear();
}

/** Copies a stored photo so a duplicated product doesn't share (and later lose) its original's blob. */
export async function cloneImage(ref) {
  if (!isIdbRef(ref)) return ref;
  try {
    const blob = await getBlob(ref);
    return blob ? await saveImage(blob) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
const urlCache = new Map(); // ref -> object URL, so a list re-render doesn't re-read every blob

/** Resolves a ref to something usable as an <img src>, or null if the photo is gone. */
export async function resolveImageUrl(ref) {
  if (!isIdbRef(ref)) return isSafeImageUrl(ref) ? ref : null;
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
 * Returns an <img> tag string for a product photo ref. Photos held in
 * IndexedDB have no src yet — call hydrateImages() on the container
 * after inserting the markup to fill them in. `fallbackClass` is the
 * icon shown if the photo can't be found (e.g. browser data was cleared).
 */
export function imageTagHTML(ref, { className = '', fallbackClass = 'fa-solid fa-box text-[var(--text-muted)]' } = {}) {
  const fallback = `<i class="${fallbackClass}" aria-hidden="true"></i>`;
  if (!ref) return fallback;
  if (isIdbRef(ref)) return `<img data-img-ref="${escapeHTML(ref)}" data-img-fallback="${escapeHTML(fallbackClass)}" class="${className}" alt="" />`;
  return isSafeImageUrl(ref) ? `<img src="${escapeHTML(ref)}" class="${className}" alt="" />` : fallback;
}

export async function hydrateImages(root = document) {
  const pending = [...root.querySelectorAll('img[data-img-ref]')];
  await Promise.all(pending.map(async (img) => {
    const url = await resolveImageUrl(img.dataset.imgRef);
    if (!img.isConnected) return; // the list re-rendered while we were reading the blob
    if (url) { img.src = url; return; }
    const icon = document.createElement('i');
    icon.className = img.dataset.imgFallback ?? 'fa-solid fa-box';
    icon.setAttribute('aria-hidden', 'true');
    img.replaceWith(icon);
  }));
}
