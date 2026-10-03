/**
 * shopify-sync.service.js — one-way import of the connected Shopify store's products and variants into OneDesk.
 *
 * The catalogue is read server-side (the "integrations" Edge Function holds the key); this module maps it onto
 * OneDesk's product model, which is already Shopify-shaped (options + variants). Each imported product and variant
 * remembers its Shopify id, so running the import again updates what is already there instead of duplicating it.
 *
 * Stock is the sensitive part: OneDesk's counts are shared with the physical shop. By default an existing product
 * keeps OneDesk's stock and only its details (name, price, variants…) are refreshed; the caller can opt in to
 * replacing OneDesk's counts with Shopify's. New products always start with Shopify's counts. Every stock change
 * goes through inventory.service.js, so it appears in the stock-movement history.
 */
import { api } from './api.service.js';
import { fetchShopifyProductsPage } from './integrations.service.js';
import { normalizeOptions, normalizeVariants, MAX_VARIANTS } from './products.service.js';
import { adjustStock, applyStockCount, computeStockStatus } from './inventory.service.js';
import { STOCK_MOVEMENT_TYPES, CHANNELS, PRODUCT_STATUS } from '../config/constants.js';
import { generateSKU } from '../utils/helpers.js';

const slug = (text) => String(text ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const keyOf = (variant) => [variant.option1, variant.option2, variant.option3].filter((v) => v != null && v !== '').join('\u0001');
const randomBarcode = () => Array.from({ length: 13 }, () => Math.floor(Math.random() * 10)).join('');

/** Reads every page of the Shopify catalogue. */
export async function fetchAllShopifyProducts(onPage) {
  const all = [];
  let cursor = null;
  do {
    const page = await fetchShopifyProductsPage(cursor);
    all.push(...page.products);
    onPage?.(all.length);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

/**
 * @param {{ updateStock?: boolean, actor?: string, onProgress?: (p: { phase: string, done: number, total: number }) => void }} [options]
 * @returns {Promise<{ created: number, updated: number, skipped: string[] }>}
 */
export async function importShopifyProducts({ updateStock = false, actor = 'Shopify import', onProgress } = {}) {
  onProgress?.({ phase: 'Reading your Shopify store', done: 0, total: 0 });
  const remote = await fetchAllShopifyProducts((n) => onProgress?.({ phase: 'Reading your Shopify store', done: n, total: 0 }));

  const [products, categories, brands] = await Promise.all([api.products.list(), api.categories.list(), api.brands.list()]);
  const byShopifyId = new Map(products.filter((p) => p.shopify?.productId).map((p) => [p.shopify.productId, p]));
  const bySku = new Map();
  products.forEach((p) => { if (p.sku) bySku.set(p.sku, p); (p.variants ?? []).forEach((v) => { if (v.sku) bySku.set(v.sku, p); }); });
  const byHandle = new Map(products.map((p) => [slug(p.name), p]));
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const brandByName = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]));

  const ensure = async (name, map, create) => {
    const clean = String(name ?? '').trim();
    if (!clean) return null;
    if (!map.has(clean.toLowerCase())) map.set(clean.toLowerCase(), (await create(clean)).id);
    return map.get(clean.toLowerCase());
  };

  let created = 0; let updated = 0;
  const skipped = [];

  for (let index = 0; index < remote.length; index += 1) {
    const sp = remote[index];
    onProgress?.({ phase: 'Importing products', done: index, total: remote.length });
    try {
      if (sp.variants.length > MAX_VARIANTS) throw new Error(`has ${sp.variants.length} variants (OneDesk allows ${MAX_VARIANTS})`);

      const isDefault = sp.variants.length <= 1 && (sp.options.length === 0 || (sp.options.length === 1 && sp.options[0].name === 'Title'));
      const first = sp.variants[0] ?? {};
      const existing = byShopifyId.get(sp.id)
        ?? sp.variants.map((v) => v.sku && bySku.get(v.sku)).find(Boolean)
        ?? byHandle.get(slug(sp.title));

      // Options/variants (a single "Default Title" variant means the product has none).
      const options = isDefault ? [] : normalizeOptions(sp.options);
      const oldByShopifyId = new Map((existing?.variants ?? []).filter((v) => v.shopifyId).map((v) => [v.shopifyId, v]));
      const oldByKey = new Map((existing?.variants ?? []).map((v) => [keyOf(v), v]));
      const variants = isDefault ? [] : normalizeVariants(sp.variants.map((v) => {
        const old = oldByShopifyId.get(v.id) ?? oldByKey.get(keyOf(v));
        return {
          title: v.title, option1: v.option1, option2: v.option2, option3: v.option3,
          price: Number(v.price) || 0, sku: v.sku, barcode: v.barcode,
          stock: updateStock || !existing ? v.stock : (old?.stock ?? 0),
          shopifyId: v.id, inventoryItemId: v.inventoryItemId,
        };
      }));

      const shopifyStock = isDefault ? (Number(first.stock) || 0) : sp.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
      const status = sp.status === 'draft' ? PRODUCT_STATUS.DRAFT : sp.status === 'archived' ? PRODUCT_STATUS.ARCHIVED : PRODUCT_STATUS.ACTIVE;
      const categoryId = await ensure(sp.type, catByName, (name) => api.categories.create({ name, description: 'Imported from Shopify' }));
      const brandId = await ensure(sp.vendor, brandByName, (name) => api.brands.create({ name, country: '' }));

      const fields = {
        name: sp.title, description: sp.description, status,
        categoryId: categoryId ?? existing?.categoryId ?? null,
        brandId: brandId ?? existing?.brandId ?? null,
        sellingPrice: (isDefault ? Number(first.price) : variants[0]?.price) || existing?.sellingPrice || 0,
        options, variants,
        shopify: { productId: sp.id, handle: sp.handle, inventoryItemId: isDefault ? (first.inventoryItemId ?? '') : '', syncedAt: new Date().toISOString() },
      };

      if (existing) {
        // A photo you added in OneDesk is kept; Shopify's is only used when the product has none.
        if (!(existing.images ?? []).length && sp.image) fields.images = [sp.image];
        await api.products.update(existing.id, fields);
        if (updateStock && shopifyStock !== existing.stockQuantity) {
          await applyStockCount({ productId: existing.id, countedQuantity: shopifyStock, actor, pushToShopify: false });
        }
        updated += 1;
      } else {
        const sku = (isDefault ? first.sku : variants.find((v) => v.sku)?.sku) || generateSKU('SKU');
        const product = await api.products.create({
          ...fields, sku, barcode: (isDefault ? first.barcode : '') || randomBarcode(),
          supplierId: null, costPrice: 0, discount: 0, stockQuantity: 0, minStock: 5, maxStock: 100,
          images: sp.image ? [sp.image] : [],
        });
        if (shopifyStock > 0) {
          await adjustStock({ productId: product.id, delta: shopifyStock, type: STOCK_MOVEMENT_TYPES.ADJUSTMENT, channel: CHANNELS.ONLINE, note: 'Imported from Shopify', actor, pushToShopify: false });
        } else {
          await api.products.update(product.id, { stockStatus: computeStockStatus({ ...product, stockQuantity: 0 }) });
        }
        created += 1;
      }
    } catch (err) {
      skipped.push(`${sp.title}: ${err.message}`);
    }
  }
  onProgress?.({ phase: 'Finishing up', done: remote.length, total: remote.length });

  await api.activityLog.create({
    actor, action: 'Imported products from Shopify',
    target: `${created} new, ${updated} updated${skipped.length ? `, ${skipped.length} skipped` : ''}`,
  });
  return { created, updated, skipped };
}
