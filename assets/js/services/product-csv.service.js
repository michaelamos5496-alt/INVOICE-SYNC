/**
 * product-csv.service.js — Shopify-format product CSV: one row per variant,
 * grouped by Handle, with Option1–3 Name/Value columns. A file exported from
 * here opens cleanly in Excel / Google Sheets, and a Shopify product export
 * imports here. A product with no variants is one row with the Shopify
 * convention Option1 Name "Title" / Value "Default Title".
 */
import { api } from './api.service.js';
import { adjustStock, applyStockCount, computeStockStatus } from './inventory.service.js';
import { STOCK_MOVEMENT_TYPES, CHANNELS } from '../config/constants.js';
import { normalizeOptions, normalizeVariants, upgradeLegacyVariants, MAX_VARIANTS } from './products.service.js';
import { slugify } from '../utils/formatters.js';
import { generateSKU } from '../utils/helpers.js';
import { isStoredRef } from './image-store.service.js';

export const SHOPIFY_COLUMNS = [
  'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Published',
  'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
  'Variant SKU', 'Variant Inventory Qty', 'Variant Price', 'Variant Barcode', 'Cost per item', 'Image Src', 'Status',
];

/** True when the parsed CSV uses the Shopify layout rather than the older flat one. */
export const isShopifyCSV = (rows) => rows.length > 0 && 'Handle' in rows[0] && 'Title' in rows[0];

/** CSV text (with a BOM so Excel reads UTF-8 correctly) for all products, one row per variant. */
export async function buildShopifyCSV() {
  const [products, categories, brands] = await Promise.all([api.products.list(), api.categories.list(), api.brands.list()]);
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const brand = new Map(brands.map((b) => [b.id, b.name]));
  const usedHandles = new Set();
  const out = [];

  for (const p of products) {
    let handle = slugify(p.name) || 'product';
    for (let n = 2; usedHandles.has(handle); n += 1) handle = `${slugify(p.name) || 'product'}-${n}`;
    usedHandles.add(handle);

    const { options, variants } = upgradeLegacyVariants(p);
    const image = (p.images ?? []).find((ref) => typeof ref === 'string' && !isStoredRef(ref) && /^https?:/i.test(ref)) ?? '';
    const productCols = {
      Handle: handle, Title: p.name, 'Body (HTML)': p.description ?? '', Vendor: brand.get(p.brandId) ?? '',
      Type: cat.get(p.categoryId) ?? '', Published: p.status === 'active' ? 'TRUE' : 'FALSE',
      'Cost per item': p.costPrice ?? '', 'Image Src': image, Status: p.status ?? 'active',
    };
    const rows = variants.length
      ? variants.map((v) => ({
        'Option1 Name': options[0]?.name ?? '', 'Option1 Value': v.option1 ?? '',
        'Option2 Name': options[1]?.name ?? '', 'Option2 Value': v.option2 ?? '',
        'Option3 Name': options[2]?.name ?? '', 'Option3 Value': v.option3 ?? '',
        'Variant SKU': v.sku ?? '', 'Variant Inventory Qty': v.stock ?? 0, 'Variant Price': v.price ?? p.sellingPrice, 'Variant Barcode': v.barcode ?? '',
      }))
      : [{
        'Option1 Name': 'Title', 'Option1 Value': 'Default Title',
        'Variant SKU': p.sku, 'Variant Inventory Qty': p.stockQuantity ?? 0, 'Variant Price': p.sellingPrice, 'Variant Barcode': p.barcode ?? '',
      }];
    rows.forEach((row, i) => out.push({
      ...(i === 0 ? productCols : { Handle: handle }), ...row,
    }));
  }

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return `﻿${[SHOPIFY_COLUMNS.join(','), ...out.map((r) => SHOPIFY_COLUMNS.map((c) => esc(r[c])).join(','))].join('\r\n')}`;
}

export function downloadCSV(text, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/**
 * Imports Shopify-format rows: rows sharing a Handle are one product, the
 * first row carrying its details. Existing products are matched by handle
 * (slug of the name) or SKU and updated; others are created.
 * Returns { created, updated, skipped[] }.
 */
export async function importShopifyRows(rows, actor = 'Bulk Import') {
  const [products, categories, brands] = await Promise.all([api.products.list(), api.categories.list(), api.brands.list()]);
  const byHandle = new Map(products.map((p) => [slugify(p.name), p]));
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const brandByName = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]));

  const groups = new Map();
  let lastHandle = '';
  for (const row of rows) {
    const handle = (row.Handle || lastHandle).trim();
    if (!handle) continue;
    lastHandle = handle;
    if (!groups.has(handle)) groups.set(handle, []);
    groups.get(handle).push(row);
  }

  let created = 0; let updated = 0; const skipped = [];
  for (const [handle, group] of groups) {
    const head = group.find((r) => r.Title) ?? group[0];
    if (!head.Title) { skipped.push(`${handle}: no Title`); continue; }
    try {
      const names = [1, 2, 3].map((n) => head[`Option${n} Name`]).filter((n) => n && n !== 'Title');
      const isDefault = !names.length;
      const optionsRaw = names.map((name, k) => ({ name, values: group.map((r) => r[`Option${k + 1} Value`]).filter(Boolean) }));
      const options = normalizeOptions(optionsRaw);
      const variants = isDefault ? [] : normalizeVariants(group.map((r) => {
        const vals = options.map((_, k) => r[`Option${k + 1} Value`] || null);
        return {
          title: vals.filter(Boolean).join(' / '), option1: vals[0], option2: vals[1] ?? null, option3: vals[2] ?? null,
          price: Number(r['Variant Price']) || 0, sku: r['Variant SKU'], barcode: r['Variant Barcode'], stock: Number(r['Variant Inventory Qty']) || 0,
        };
      }));
      if (variants.length > MAX_VARIANTS) throw new Error(`more than ${MAX_VARIANTS} variants`);

      const first = group[0];
      const stock = isDefault ? Number(first['Variant Inventory Qty']) || 0 : variants.reduce((s, v) => s + v.stock, 0);
      const sku = (isDefault ? first['Variant SKU'] : variants.find((v) => v.sku)?.sku) || generateSKU('SKU');
      const existing = byHandle.get(handle) ?? bySku.get(sku);
      const status = ['active', 'draft', 'archived'].includes(String(head.Status).toLowerCase())
        ? head.Status.toLowerCase() : (String(head.Published).toUpperCase() === 'FALSE' ? 'draft' : 'active');
      const fields = {
        name: head.Title, description: head['Body (HTML)'] ?? '', status,
        categoryId: catByName.get((head.Type ?? '').toLowerCase()) ?? existing?.categoryId ?? null,
        brandId: brandByName.get((head.Vendor ?? '').toLowerCase()) ?? existing?.brandId ?? null,
        sellingPrice: (isDefault ? Number(first['Variant Price']) : variants[0]?.price) || existing?.sellingPrice || 0,
        costPrice: Number(head['Cost per item']) || existing?.costPrice || 0,
        options, variants,
      };

      if (existing) {
        await api.products.update(existing.id, fields);
        if (stock !== existing.stockQuantity) await applyStockCount({ productId: existing.id, countedQuantity: stock, actor });
        updated += 1;
      } else {
        const product = await api.products.create({
          ...fields, sku, barcode: (isDefault ? first['Variant Barcode'] : '') || generateSKU('BC'), supplierId: null, discount: 0,
          stockQuantity: 0, minStock: 5, maxStock: 100,
          images: /^https?:/i.test(head['Image Src'] ?? '') ? [head['Image Src']] : [],
        });
        if (stock > 0) await adjustStock({ productId: product.id, delta: stock, type: STOCK_MOVEMENT_TYPES.ADJUSTMENT, channel: CHANNELS.PHYSICAL, note: 'Bulk import', actor });
        else await api.products.update(product.id, { stockStatus: computeStockStatus({ ...product, stockQuantity: 0 }) });
        created += 1;
      }
    } catch (err) {
      skipped.push(`${head.Title}: ${err.message}`);
    }
  }
  return { created, updated, skipped };
}
