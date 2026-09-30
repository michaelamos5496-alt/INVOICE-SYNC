/**
 * products.service.js — product-specific business logic sitting on top of
 * api.products. The one rule this module enforces: stock quantity is
 * NEVER written directly via api.products.update from page code. Even a
 * plain "edit product" form funnels quantity changes through
 * inventory.service.js, so a manually-edited product still produces an
 * audit trail entry and the same low/out-of-stock notifications a POS
 * sale would trigger. This keeps the "one shared inventory" guarantee
 * intact even for the most mundane path: someone fixing a typo in a
 * product's starting stock count.
 */
import { api } from './api.service.js';
import { adjustStock, applyStockCount, computeStockStatus } from './inventory.service.js';
import { STOCK_MOVEMENT_TYPES, CHANNELS, STOCK_STATUS } from '../config/constants.js';
import { generateSKU } from '../utils/helpers.js';
import { deleteImages, cloneImage } from './image-store.service.js';

/** Generates a plausible EAN-13-shaped barcode for demo/manual entry. */
export function generateBarcode() {
  let digits = '';
  for (let i = 0; i < 13; i += 1) digits += Math.floor(Math.random() * 10);
  return digits;
}

export { generateSKU };

export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 100;

/** A variant's display name — its option values joined like Shopify does, e.g. "Red / M". */
export function variantLabel(variant) {
  return variant?.title || [variant?.option1, variant?.option2, variant?.option3].map((v) => String(v ?? '').trim()).filter(Boolean).join(' / ');
}

/** Cleans option definitions: trims names, drops empty/duplicate values and options with no values. */
export function normalizeOptions(options = []) {
  return options
    .map((o) => ({ name: String(o.name ?? '').trim(), values: [...new Set((o.values ?? []).map((v) => String(v).trim()).filter(Boolean))] }))
    .filter((o) => o.name && o.values.length)
    .slice(0, MAX_OPTIONS);
}

/**
 * Every combination of the options' values, in Shopify's order (the first
 * option varies slowest). Rows that already exist (matched by their option
 * values) keep their price, stock, SKU and barcode; new combinations start
 * with the product's price and no stock.
 */
export function generateVariants(options, existing = [], defaultPrice = 0) {
  const opts = normalizeOptions(options);
  if (!opts.length) return [];
  const combos = opts.reduce((acc, o) => acc.flatMap((c) => o.values.map((v) => [...c, v])), [[]]);
  const key = (vals) => vals.join('\u0001');
  const byKey = new Map(existing.map((v) => [key([v.option1, v.option2, v.option3].filter((x) => x != null && x !== '')), v]));
  return combos.map((vals) => {
    const old = byKey.get(key(vals));
    return {
      title: vals.join(' / '), option1: vals[0], option2: vals[1] ?? null, option3: vals[2] ?? null,
      price: old?.price ?? defaultPrice, sku: old?.sku ?? '', barcode: old?.barcode ?? '', stock: old?.stock ?? 0,
    };
  });
}

/**
 * Upgrades variants saved in the old color/size format to Shopify-style
 * options + variants (Color and/or Size options; price = product price +
 * the old price change; SKU = product SKU + the old suffix).
 */
export function upgradeLegacyVariants(product) {
  const variants = product?.variants ?? [];
  if (!variants.length || product.options?.length || variants.every((v) => v.option1 != null)) {
    return { options: product?.options ?? [], variants };
  }
  const useColor = variants.some((v) => String(v.color ?? '').trim());
  const useSize = variants.some((v) => String(v.size ?? '').trim());
  const names = [useColor && 'Color', useSize && 'Size'].filter(Boolean);
  const upgraded = variants.map((v, i) => {
    const vals = [useColor && String(v.color ?? '').trim(), useSize && String(v.size ?? '').trim()].filter((x) => x !== false);
    const filled = vals.map((x, j) => x || (names.length > 1 ? '—' : `Variant ${i + 1}`)).map((x) => x);
    return {
      title: filled.join(' / '), option1: filled[0], option2: filled[1] ?? null, option3: null,
      price: (product.sellingPrice ?? 0) + (Number(v.priceAdjustment) || 0),
      sku: v.skuSuffix ? `${product.sku ?? ''}${v.skuSuffix}` : '', barcode: '', stock: Number(v.stock) || 0,
    };
  });
  const options = names.map((name, i) => ({ name, values: [...new Set(upgraded.map((v) => v[`option${i + 1}`]))] }));
  return { options, variants: upgraded };
}

/** Cleans a product's variants for saving: trims text and coerces numbers. */
export function normalizeVariants(variants = []) {
  if (variants.length > MAX_VARIANTS) throw new Error(`A product can have up to ${MAX_VARIANTS} variants — remove some option values.`);
  return variants.map((v) => {
    if (!variantLabel(v)) throw new Error('Every variant needs option values.');
    return {
      title: variantLabel(v),
      option1: v.option1 ?? null, option2: v.option2 ?? null, option3: v.option3 ?? null,
      price: Math.max(0, Number(v.price) || 0),
      sku: String(v.sku ?? '').trim(),
      barcode: String(v.barcode ?? '').trim(),
      stock: Math.max(0, Math.floor(Number(v.stock) || 0)),
    };
  });
}

export async function listProducts() {
  return api.products.list();
}

export async function getProduct(id) {
  return api.products.get(id);
}

/**
 * Creates a product with zero stock, then — if a starting quantity was
 * supplied — routes that quantity through adjustStock() so it's logged
 * exactly like any other stock movement.
 */
export async function createProduct(formData, actor = 'system') {
  const { stockQuantity = 0, ...rest } = formData;
  if (rest.options) rest.options = normalizeOptions(rest.options);
  if (rest.variants) rest.variants = normalizeVariants(rest.variants);
  const product = await api.products.create({
    ...rest,
    stockQuantity: 0,
    stockStatus: STOCK_STATUS.OUT_OF_STOCK,
  });

  if (stockQuantity > 0) {
    await adjustStock({
      productId: product.id,
      delta: stockQuantity,
      type: STOCK_MOVEMENT_TYPES.ADJUSTMENT,
      channel: CHANNELS.PHYSICAL,
      note: 'Initial stock on product creation',
      actor,
    });
  }

  await api.activityLog.create({ actor, action: 'Created product', target: product.name });

  return api.products.get(product.id);
}

/**
 * Updates all non-stock fields directly, then — only if the quantity
 * actually changed — applies a stock count correction so the delta is
 * captured in the inventory log.
 */
export async function updateProduct(id, formData, actor = 'system') {
  const current = await api.products.get(id);
  if (!current) throw new Error(`Product ${id} not found`);

  const { stockQuantity, ...rest } = formData;
  if (rest.options) rest.options = normalizeOptions(rest.options);
  if (rest.variants) rest.variants = normalizeVariants(rest.variants);
  await api.products.update(id, rest);

  // Photos the user removed in this edit are now unreferenced — free their storage.
  if (Array.isArray(rest.images)) await deleteImages((current.images ?? []).filter((ref) => !rest.images.includes(ref)));

  if (typeof stockQuantity === 'number' && stockQuantity !== current.stockQuantity) {
    await applyStockCount({ productId: id, countedQuantity: stockQuantity, actor });
  }

  await api.activityLog.create({ actor, action: 'Updated product', target: rest.name ?? current.name });

  return api.products.get(id);
}

export async function deleteProduct(id, actor = 'system') {
  const product = await api.products.get(id);
  await api.products.remove(id);
  if (product) await deleteImages(product.images);
  if (product) await api.activityLog.create({ actor, action: 'Deleted product', target: product.name });
  return true;
}

export async function duplicateProduct(id, actor = 'system') {
  const original = await api.products.get(id);
  if (!original) throw new Error(`Product ${id} not found`);
  const { id: _id, createdAt, updatedAt, ...rest } = original;
  // Each product owns its photos, so the copy gets its own — deleting one later must not break the other.
  const images = (await Promise.all((original.images ?? []).map(cloneImage))).filter(Boolean);
  // Variant SKUs and barcodes are unique per item, so the copy starts without them.
  const { options, variants: upgraded } = upgradeLegacyVariants(original);
  const variants = upgraded.map((v) => ({ ...v, sku: '', barcode: '' }));
  return createProduct({
    ...rest,
    options,
    variants,
    images,
    name: `${original.name} (Copy)`,
    sku: generateSKU('SKU'),
    barcode: generateBarcode(),
    stockQuantity: 0,
  }, actor);
}

/** Recomputes and persists stockStatus — used defensively after bulk edits. */
export async function refreshStockStatus(product) {
  return api.products.update(product.id, { stockStatus: computeStockStatus(product) });
}
