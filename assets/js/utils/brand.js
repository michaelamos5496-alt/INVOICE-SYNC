/**
 * brand.js — puts the store name from Settings on the site itself.
 *
 * Anything marked `data-brand-name` gets the store name as its text, and the
 * browser tab title becomes "<Page> · <Store name>". It re-applies the moment
 * settings change (in this tab, or in another one), so renaming the shop in
 * Settings updates the sidebar and tab title immediately.
 *
 * Text is always set with textContent — a store name is user-typed.
 */
import { getBrandName } from '../services/settings.service.js';
import { storage } from '../services/storage.service.js';
import { STORAGE_KEYS } from '../config/constants.js';

const TITLE_SEP = ' · ';
let pageTitle; // the "Products" in "Products · Acme" — captured once, before we start rewriting the title

export function applyBrand({ title = true } = {}) {
  const name = getBrandName();
  document.querySelectorAll('[data-brand-name]').forEach((el) => { el.textContent = name; });
  document.querySelectorAll('[data-brand-label]').forEach((el) => { el.setAttribute('aria-label', el.dataset.brandLabel.replace('{name}', name)); });

  if (title) {
    pageTitle ??= document.title.includes(TITLE_SEP) ? document.title.slice(0, document.title.lastIndexOf(TITLE_SEP)) : '';
    document.title = pageTitle ? `${pageTitle}${TITLE_SEP}${name}` : name;
  }
}

/** Applies the brand now and keeps it current. Pass { title: false } on pages that manage their own <title>. */
export function initBrand(options = {}) {
  applyBrand(options);
  return storage.on(STORAGE_KEYS.SETTINGS, () => applyBrand(options));
}
