// Supabase Edge Function: shopify-webhook
//
// Receives Shopify's live order notifications and keeps OneDesk's stock in step:
//   orders/create    → records the order under Online Orders and takes the stock off the matching products
//   orders/cancelled → puts that stock back and marks the order cancelled
// Shopify calls this URL directly, with no signed-in person, so it is deployed WITHOUT login checks and instead
// proves each request is genuine: Shopify signs the body with the app's API secret key (saved in Settings →
// Integrations → Shopify) and a request whose signature doesn't match is refused.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name it exactly `shopify-webhook`, paste this
// file, turn OFF "Verify JWT" (Shopify can't send one), deploy. (CLI: `supabase functions deploy shopify-webhook --no-verify-jwt`.)
// Then: Settings → Integrations → Shopify → "Turn on live orders" registers the notifications with Shopify.
//
// Matching: an order line is matched to a OneDesk product by the Shopify product id saved when products were synced
// (Settings → Integrations → Shopify → Sync products). Lines that match nothing are noted on the order, not guessed at.
// Safe to receive twice: Shopify retries, so an order that was already recorded is ignored.

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const MAX_RETRIES = 6;

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

async function validSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  if (expected.length !== header.length) return false;
  let diff = 0;                                   // constant-time compare
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
const stockStatus = (qty, min) => (qty <= 0 ? 'out_of_stock' : qty <= (min ?? 0) ? 'low_stock' : 'in_stock');
const nowIso = () => new Date().toISOString();

/** Reads one record from a table of JSON documents. */
async function getDoc(server, table, shopId, id) {
  const { data } = await server.from(table).select('id,data,version').eq('shop_id', shopId).eq('id', id).maybeSingle();
  return data;
}

async function addDoc(server, table, shopId, prefix, data) {
  const id = data.id ?? newId(prefix);
  const createdAt = data.createdAt ?? nowIso();
  const { error } = await server.from(table).insert({ id, shop_id: shopId, data: { ...data, id, createdAt, updatedAt: createdAt }, created_at: createdAt });
  if (error) throw error;
  return id;
}

/**
 * Changes one product's stock by `delta` (never below zero), and the stock of one of its variants when a Shopify variant id is
 * given. Read–compute–write only if nobody changed the product meanwhile (its version), retrying — the same guarantee the app
 * gives, so a sale in the shop at the same moment can't be lost.
 */
async function adjustProduct(server, shopId, productId, delta, variantId) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const row = await getDoc(server, 'products', shopId, productId);
    if (!row) return null;
    const product = row.data;
    const previous = Number(product.stockQuantity) || 0;
    const next = Math.max(0, previous + delta);
    const patch = { stockQuantity: next, stockStatus: stockStatus(next, product.minStock), updatedAt: nowIso() };
    if (variantId && Array.isArray(product.variants)) {
      patch.variants = product.variants.map((v) => (v.shopifyId === String(variantId) ? { ...v, stock: Math.max(0, (Number(v.stock) || 0) + delta) } : v));
    }
    const { data, error } = await server.from('products').update({ data: { ...product, ...patch } })
      .eq('shop_id', shopId).eq('id', productId).eq('version', row.version).select('id');
    if (error) throw error;
    if (data?.length) return { product: { ...product, ...patch }, previous, next };
    await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 80 * (attempt + 1)));
  }
  throw new Error('Several people are changing this product at the same moment.');
}

async function findProductByShopifyId(server, shopId, shopifyProductId) {
  const { data } = await server.from('products').select('id,data').eq('shop_id', shopId).filter('data->shopify->>productId', 'eq', String(shopifyProductId)).limit(1);
  return data?.[0] ?? null;
}

async function findOrder(server, shopId, shopifyOrderId) {
  const { data } = await server.from('online_orders').select('id,data,version').eq('shop_id', shopId).filter('data->>shopifyOrderId', 'eq', String(shopifyOrderId)).limit(1);
  return data?.[0] ?? null;
}

async function logMovement(server, shopId, { product, productId, type, delta, previous, next, reference, note }) {
  await addDoc(server, 'inventory_log', shopId, 'invlog', {
    productId, productName: product.name, sku: product.sku, type, channel: 'online_shop', delta, previousQuantity: previous, newQuantity: next,
    reference, note, actor: 'Shopify',
  });
  if (next <= 0 || next <= (product.minStock ?? 0)) {
    await addDoc(server, 'notifications', shopId, 'note', next <= 0
      ? { type: 'out_of_stock', title: 'Out of stock', message: `${product.name} (${product.sku}) is now out of stock.`, severity: 'danger', read: false, relatedProductId: productId }
      : { type: 'low_stock', title: 'Low stock warning', message: `${product.name} (${product.sku}) has ${next} units left (min ${product.minStock}).`, severity: 'warning', read: false, relatedProductId: productId });
  }
}

async function onOrderCreated(server, shopId, order) {
  if (await findOrder(server, shopId, order.id)) return { handled: 'duplicate' };

  const orderId = newId('onl');
  const items = [];
  const unmatched = [];
  for (const line of order.line_items ?? []) {
    const quantity = Math.max(0, Number(line.quantity) || 0);
    if (!quantity) continue;
    const match = line.product_id ? await findProductByShopifyId(server, shopId, line.product_id) : null;
    if (!match) { unmatched.push(line.title ?? 'item'); continue; }
    const result = await adjustProduct(server, shopId, match.id, -quantity, line.variant_id);
    if (!result) { unmatched.push(line.title ?? 'item'); continue; }
    await logMovement(server, shopId, { product: result.product, productId: match.id, type: 'sale', delta: -quantity, previous: result.previous, next: result.next, reference: orderId, note: `Shopify order ${order.name ?? order.id}` });
    items.push({ productId: match.id, name: line.title, quantity, price: Number(line.price) || 0, shopifyVariantId: line.variant_id ? String(line.variant_id) : null });
  }

  const customer = order.customer ? `${order.customer.first_name ?? ''} ${order.customer.last_name ?? ''}`.trim() : '';
  const total = Number(order.total_price) || items.reduce((s, i) => s + i.price * i.quantity, 0);
  await addDoc(server, 'online_orders', shopId, 'onl', {
    id: orderId, channel: 'online_shop', customerId: null, customer: customer ? { name: customer } : null, items, total,
    status: 'processing', shopifyOrderId: String(order.id), shopifyOrderName: order.name ?? '',
    notes: `Shopify order ${order.name ?? order.id}${unmatched.length ? ` — not matched to a OneDesk product, stock not changed: ${unmatched.join(', ')}` : ''}`,
    createdAt: order.created_at ?? nowIso(),
  });
  await addDoc(server, 'notifications', shopId, 'note', {
    type: 'new_order', title: 'New Shopify order', message: `Order ${order.name ?? ''} received${customer ? ` from ${customer}` : ''} — ${total.toFixed(2)}.`,
    severity: 'info', read: false, relatedOrderId: orderId,
  });
  await addDoc(server, 'activity_log', shopId, 'act', { actor: 'Shopify', action: 'Received Shopify order', target: `${order.name ?? order.id} · ${total.toFixed(2)}` });
  return { handled: 'created', matched: items.length, unmatched: unmatched.length };
}

async function onOrderCancelled(server, shopId, order) {
  const row = await findOrder(server, shopId, order.id);
  if (!row) return { handled: 'unknown-order' };
  if (row.data.status === 'cancelled') return { handled: 'duplicate' };

  for (const item of row.data.items ?? []) {
    const result = await adjustProduct(server, shopId, item.productId, item.quantity, item.shopifyVariantId);
    if (result) await logMovement(server, shopId, { product: result.product, productId: item.productId, type: 'return', delta: item.quantity, previous: result.previous, next: result.next, reference: row.id, note: `Shopify order ${order.name ?? order.id} cancelled` });
  }
  await server.from('online_orders').update({ data: { ...row.data, status: 'cancelled', updatedAt: nowIso() } }).eq('shop_id', shopId).eq('id', row.id);
  await addDoc(server, 'activity_log', shopId, 'act', { actor: 'Shopify', action: 'Shopify order cancelled', target: `${order.name ?? order.id} — stock put back` });
  return { handled: 'cancelled' };
}

/**
 * @param req   the incoming Request from Shopify
 * @param deps  { createClient, env } — injected so this file can be tested without Supabase.
 */
export async function handle(req, deps) {
  if (req.method !== 'POST') return json(405, { ok: false });

  const rawBody = await req.text();
  const domain = String(req.headers.get('x-shopify-shop-domain') ?? '').toLowerCase();
  const topic = req.headers.get('x-shopify-topic') ?? '';
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) return json(401, { ok: false });

  const server = deps.createClient(deps.env.SUPABASE_URL, deps.env.SUPABASE_SERVICE_ROLE_KEY);

  // Which OneDesk shop is connected to this Shopify store?
  const { data: rows } = await server.from('integrations').select('shop_id,settings,status').eq('provider', 'shopify').filter('settings->>shopDomain', 'eq', domain);
  const connection = rows?.find((r) => r.status !== 'disconnected');
  if (!connection) return json(401, { ok: false });
  const { data: secretRow } = await server.from('integration_secrets').select('secrets').eq('shop_id', connection.shop_id).eq('provider', 'shopify').maybeSingle();

  // Refuse anything Shopify didn't sign with our saved secret.
  if (!(await validSignature(rawBody, req.headers.get('x-shopify-hmac-sha256'), secretRow?.secrets?.apiSecret))) return json(401, { ok: false });

  let order;
  try { order = JSON.parse(rawBody); } catch { return json(400, { ok: false }); }

  try {
    const result = topic === 'orders/create' ? await onOrderCreated(server, connection.shop_id, order)
      : topic === 'orders/cancelled' ? await onOrderCancelled(server, connection.shop_id, order)
      : { handled: 'ignored' };
    return json(200, { ok: true, ...result });
  } catch (err) {
    console.error('[shopify-webhook]', topic, err);
    return json(500, { ok: false }); // Shopify retries a failed delivery, and a retry is safe (duplicates are ignored)
  }
}

// Entry point when running on Supabase (Deno). Skipped when the file is imported by a test.
if (typeof Deno !== 'undefined' && Deno.serve) {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  Deno.serve((req) => handle(req, { createClient, env: {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  } }));
}
