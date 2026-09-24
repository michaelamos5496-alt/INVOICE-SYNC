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

/** A variant's display name — its color and/or size, e.g. "Red / M". Empty when it has neither. */
export function variantLabel(variant) {
  return [variant?.color, variant?.size].map((part) => String(part ?? '').trim()).filter(Boolean).join(' / ');
}

/**
 * Cleans up a product's variants for saving: trims text and coerces the
 * numbers. Every variant must be named (a color, a size, or both) —
 * otherwise nothing tells you which one is which later, in the product
 * form, on inventory screens, or in reports — so an unnamed one throws
 * instead of being saved.
 */
export function normalizeVariants(variants = []) {
  return variants.map((variant, index) => {
    if (!variantLabel(variant)) throw new Error(`Variant ${index + 1} needs a name — enter a color or a size.`);
    return {
      color: String(variant.color ?? '').trim(),
      size: String(variant.size ?? '').trim(),
      skuSuffix: String(variant.skuSuffix ?? '').trim(),
      stock: Number(variant.stock) || 0,
      priceAdjustment: Number(variant.priceAdjustment) || 0,
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
  // Variants saved before names were required get a placeholder name so the copy can be saved.
  const variants = (original.variants ?? []).map((v, i) => (variantLabel(v) ? v : { ...v, color: `Variant ${i + 1}` }));
  return createProduct({
    ...rest,
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
