import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { asyncHandler, bad, notFound, now, uid } from '../lib/util.js';
import { calcFees, findPromo, distanceFor } from '../lib/orders.js';
import { settingsAll } from '../lib/settings.js';

const router = Router();

function cartPayload(userId) {
  const rows = db
    .prepare(
      `SELECT ci.id, ci.qty, ci.created_at, p.id AS product_id, p.name, p.price, p.image, p.unit, p.stock,
              p.compare_at, s.id AS store_id, s.name AS store_name, s.is_open, s.min_order, s.status AS store_status
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       JOIN stores s ON s.id = p.store_id
       WHERE ci.user_id = ? ORDER BY ci.created_at`
    )
    .all(userId);
  const subtotal = rows.reduce((sum, r) => sum + r.price * r.qty, 0);
  const store = rows[0] ? { id: rows[0].store_id, name: rows[0].store_name, is_open: Boolean(rows[0].is_open), min_order: rows[0].min_order, status: rows[0].store_status } : null;
  const issues = [];
  for (const r of rows) {
    if (r.stock < r.qty) issues.push({ product_id: r.product_id, type: 'stock', message: `Only ${r.stock} left of ${r.name}` });
  }
  if (store && !store.is_open) issues.push({ type: 'store_closed', message: `${store.name} is currently closed` });
  if (store && subtotal < store.min_order) issues.push({ type: 'min_order', message: `Minimum order for ${store.name} is ₦${store.min_order.toLocaleString()}` });
  const settings = settingsAll();
  if (subtotal > 0 && subtotal < settings.min_order_value) {
    issues.push({ type: 'platform_min_order', message: `Minimum order value is ₦${settings.min_order_value.toLocaleString()}` });
  }
  return { items: rows, subtotal, store, issues, count: rows.reduce((n, r) => n + r.qty, 0) };
}

router.get(
  '/cart',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(cartPayload(req.user.id));
  })
);

router.post(
  '/cart',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { product_id, qty = 1 } = req.body || {};
    if (!product_id) throw bad('Choose a product first.');
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND status = ?').get(product_id, 'active');
    if (!product) throw notFound('This product is no longer available.');
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(product.store_id);
    if (!store || store.status !== 'active') throw bad('This store is not accepting orders right now.');
    if (product.stock < 1) throw bad(`${product.name} is out of stock.`);

    const existingStore = db
      .prepare('SELECT DISTINCT p.store_id FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = ?')
      .get(req.user.id);
    if (existingStore && existingStore.store_id !== product.store_id) {
      return res.status(409).json({
        error: 'Your cart has items from another store. Clear it to add this item?',
        code: 'store_conflict',
        current_store: db.prepare('SELECT id,name FROM stores WHERE id = ?').get(existingStore.store_id),
      });
    }

    const settings = settingsAll();
    const existing = db.prepare('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.user.id, product_id);
    const wanted = (existing?.qty || 0) + Number(qty);
    const capped = Math.min(wanted, settings.max_cart_quantity, product.stock);
    if (capped < 1) throw bad('You cannot add more of this item.');

    if (existing) db.prepare('UPDATE cart_items SET qty = ? WHERE id = ?').run(capped, existing.id);
    else db.prepare('INSERT INTO cart_items (id,user_id,product_id,qty,created_at) VALUES (?,?,?,?,?)').run(uid('crt'), req.user.id, product_id, capped, now());

    res.status(201).json(cartPayload(req.user.id));
  })
);

router.patch(
  '/cart/:itemId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const item = db.prepare('SELECT * FROM cart_items WHERE id = ? AND user_id = ?').get(req.params.itemId, req.user.id);
    if (!item) throw notFound('Cart item not found');
    const qty = Number(req.body?.qty ?? 1);
    if (qty <= 0) {
      db.prepare('DELETE FROM cart_items WHERE id = ?').run(item.id);
    } else {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
      db.prepare('UPDATE cart_items SET qty = ? WHERE id = ?').run(Math.min(qty, product?.stock || 1, 50), item.id);
    }
    res.json(cartPayload(req.user.id));
  })
);

router.delete(
  '/cart/:itemId',
  requireAuth,
  asyncHandler(async (req, res) => {
    db.prepare('DELETE FROM cart_items WHERE id = ? AND user_id = ?').run(req.params.itemId, req.user.id);
    res.json(cartPayload(req.user.id));
  })
);

router.delete(
  '/cart',
  requireAuth,
  asyncHandler(async (req, res) => {
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
    res.json(cartPayload(req.user.id));
  })
);

/** Live pricing preview for the checkout screen. */
router.post(
  '/cart/quote',
  requireAuth,
  asyncHandler(async (req, res) => {
    const cart = cartPayload(req.user.id);
    const { promo_code, service_level = 'standard', address_id, type = 'merchant' } = req.body || {};
    let promo = null;
    if (promo_code) promo = findPromo(promo_code);
    const address = address_id ? db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(address_id, req.user.id) : null;
    const distanceKm = address ? distanceFor(JSON.stringify({ ...address, distance_km: 3.8 })) : 4.2;
    const fees = calcFees({ subtotal: cart.subtotal, type, serviceLevel: service_level, distanceKm, promo });
    res.json({
      ...fees,
      distance_km: distanceKm,
      item_count: cart.count,
      issues: cart.issues,
      payment_methods: {
        card: true,
        transfer: true,
        wallet: settingsAll().wallet_enabled,
        cash: settingsAll().cod_enabled,
      },
    });
  })
);

export default router;
