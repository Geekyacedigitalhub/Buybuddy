import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth, optionalAuth } from '../lib/auth.js';
import { asyncHandler, bad, notFound, now, paginate, uid } from '../lib/util.js';
import { calcFees, findPromo } from '../lib/orders.js';
import { settingsAll } from '../lib/settings.js';

const router = Router();

const productRow = (p) => ({
  ...p,
  in_stock: p.stock > 0,
  store: db.prepare('SELECT id,name,area,rating_avg,is_open FROM stores WHERE id = ?').get(p.store_id) || null,
});

/* --------------------------------- home ---------------------------------- */
/** Everything the customer home screen needs in one round trip. */
router.get(
  '/home',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const categories = db.prepare('SELECT * FROM categories WHERE active = 1 AND parent_id IS NULL ORDER BY sort').all();
    const banners = db.prepare('SELECT * FROM marketing_banners WHERE active = 1 ORDER BY sort').all().map((b) => ({ ...b }));
    const popular = db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id AND p.status='active') AS product_count
         FROM stores s WHERE s.status = 'active' ORDER BY s.rating_count DESC, s.rating_avg DESC LIMIT 6`
      )
      .all();
    const recommended = db
      .prepare(
        `SELECT p.* FROM products p JOIN stores s ON s.id = p.store_id
         WHERE p.status='active' AND s.status='active' AND p.stock > 0
         ORDER BY p.rating_avg DESC, p.created_at DESC LIMIT 12`
      )
      .all()
      .map(productRow);
    const deals = db
      .prepare(
        `SELECT p.* FROM products p JOIN stores s ON s.id = p.store_id
         WHERE p.status='active' AND s.status='active' AND p.compare_at IS NOT NULL AND p.compare_at > p.price LIMIT 8`
      )
      .all()
      .map(productRow);
    const promos = db.prepare('SELECT code,description,type,value,min_subtotal FROM promos WHERE active = 1 LIMIT 4').all();

    let recent = [];
    if (req.user) {
      recent = db
        .prepare(
          `SELECT DISTINCT p.* FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           JOIN products p ON p.id = oi.product_id
           WHERE o.customer_id = ? ORDER BY o.created_at DESC LIMIT 8`
        )
        .all(req.user.id)
        .map(productRow);
    }
    res.json({ categories, banners, popular_stores: popular, recommended, deals, promos, recent });
  })
);

router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.json({ categories: db.prepare('SELECT * FROM categories WHERE active = 1 ORDER BY sort').all() });
  })
);

/* -------------------------------- search --------------------------------- */

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const { limit, offset, page } = paginate(req, 20);
    if (!q) return res.json({ products: [], stores: [], total: 0, page });

    const like = `%${q}%`;
    const products = db
      .prepare(
        `SELECT p.* FROM products p JOIN stores s ON s.id = p.store_id
         WHERE p.status='active' AND s.status='active'
           AND (p.name LIKE ? OR p.description LIKE ? OR p.tags LIKE ? OR p.category_id IN
                (SELECT id FROM categories WHERE name LIKE ?))
         ORDER BY p.stock > 0 DESC, p.rating_avg DESC LIMIT ? OFFSET ?`
      )
      .all(like, like, like, like, limit, offset)
      .map(productRow);
    const stores = db
      .prepare(
        `SELECT * FROM stores WHERE status='active' AND (name LIKE ? OR description LIKE ? OR area LIKE ?) LIMIT 8`
      )
      .all(like, like, like);
    const total = db
      .prepare(
        `SELECT COUNT(*) c FROM products p JOIN stores s ON s.id = p.store_id
         WHERE p.status='active' AND s.status='active' AND (p.name LIKE ? OR p.description LIKE ? OR p.tags LIKE ?)`
      )
      .get(like, like, like).c;
    res.json({ products, stores, total, page });
  })
);

/* -------------------------------- stores --------------------------------- */

router.get(
  '/stores',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = paginate(req, 20);
    const where = ["s.status = 'active'"];
    const params = [];
    if (req.query.category) {
      where.push('EXISTS (SELECT 1 FROM products p WHERE p.store_id = s.id AND p.category_id = ?)');
      params.push(req.query.category);
    }
    if (req.query.area) {
      where.push('s.area = ?');
      params.push(req.query.area);
    }
    if (req.query.q) {
      where.push('s.name LIKE ?');
      params.push(`%${req.query.q}%`);
    }
    const rows = db
      .prepare(`SELECT s.* FROM stores s WHERE ${where.join(' AND ')} ORDER BY s.rating_avg DESC, s.rating_count DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) c FROM stores s WHERE ${where.join(' AND ')}`).get(...params).c;
    res.json({ stores: rows, total, page });
  })
);

router.get(
  '/stores/:idOrSlug',
  asyncHandler(async (req, res) => {
    const store = db
      .prepare('SELECT * FROM stores WHERE id = ? OR slug = ?')
      .get(req.params.idOrSlug, req.params.idOrSlug);
    if (!store) throw notFound('Store not found');
    const products = db
      .prepare("SELECT * FROM products WHERE store_id = ? AND status = 'active' ORDER BY name")
      .all(store.id)
      .map(productRow);
    const categories = db
      .prepare(
        `SELECT DISTINCT c.* FROM categories c JOIN products p ON p.category_id = c.id WHERE p.store_id = ?`
      )
      .all(store.id);
    const reviews = db
      .prepare(
        `SELECT r.*, u.name AS customer_name FROM reviews r JOIN users u ON u.id = r.customer_id
         WHERE r.target_type='store' AND r.target_id = ? AND r.status='published' ORDER BY r.created_at DESC LIMIT 10`
      )
      .all(store.id);
    res.json({ store, products, categories, reviews });
  })
);

/* -------------------------------- products ------------------------------- */

router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = paginate(req, 24);
    const where = ["p.status = 'active'", "s.status = 'active'"];
    const params = [];
    if (req.query.category) {
      where.push('(p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))');
      params.push(req.query.category, req.query.category);
    }
    if (req.query.store) {
      where.push('p.store_id = ?');
      params.push(req.query.store);
    }
    if (req.query.min_price) {
      where.push('p.price >= ?');
      params.push(Number(req.query.min_price));
    }
    if (req.query.max_price) {
      where.push('p.price <= ?');
      params.push(Number(req.query.max_price));
    }
    if (req.query.in_stock === 'true') where.push('p.stock > 0');

    const sortMap = {
      price_asc: 'p.price ASC',
      price_desc: 'p.price DESC',
      rating: 'p.rating_avg DESC',
      newest: 'p.created_at DESC',
      popular: 'p.rating_count DESC',
    };
    const orderBy = sortMap[req.query.sort] || 'p.rating_avg DESC, p.created_at DESC';
    const sqlWhere = where.join(' AND ');

    const rows = db
      .prepare(`SELECT p.* FROM products p JOIN stores s ON s.id = p.store_id WHERE ${sqlWhere} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset)
      .map(productRow);
    const total = db.prepare(`SELECT COUNT(*) c FROM products p JOIN stores s ON s.id = p.store_id WHERE ${sqlWhere}`).get(...params).c;
    res.json({ products: rows, total, page, pages: Math.ceil(total / limit) });
  })
);

router.get(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw notFound('Product not found');
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(p.store_id);
    const related = db
      .prepare("SELECT * FROM products WHERE category_id = ? AND id != ? AND status='active' LIMIT 8")
      .all(p.category_id, p.id)
      .map(productRow);
    const reviews = db
      .prepare(
        `SELECT r.*, u.name AS customer_name FROM reviews r JOIN users u ON u.id = r.customer_id
         WHERE r.target_type='product' AND r.target_id = ? AND r.status='published' ORDER BY r.created_at DESC LIMIT 10`
      )
      .all(p.id);
    res.json({ product: productRow(p), store, related, reviews });
  })
);

/* ------------------------------- favourites ------------------------------ */

router.get(
  '/favourites',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT p.* FROM favourites f JOIN products p ON p.id = f.product_id
         WHERE f.user_id = ? ORDER BY f.created_at DESC`
      )
      .all(req.user.id)
      .map(productRow);
    res.json({ favourites: rows });
  })
);

router.post(
  '/favourites/:productId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = db.prepare('SELECT 1 FROM favourites WHERE user_id = ? AND product_id = ?').get(req.user.id, req.params.productId);
    if (existing) {
      db.prepare('DELETE FROM favourites WHERE user_id = ? AND product_id = ?').run(req.user.id, req.params.productId);
      return res.json({ favourite: false });
    }
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(req.params.productId)) throw notFound('Product not found');
    db.prepare('INSERT INTO favourites (user_id,product_id,created_at) VALUES (?,?,?)').run(req.user.id, req.params.productId, now());
    res.json({ favourite: true });
  })
);

/* -------------------------------- promos --------------------------------- */

router.post(
  '/promos/validate',
  asyncHandler(async (req, res) => {
    const { code, subtotal = 0, type = 'merchant' } = req.body || {};
    if (!code) throw bad('Enter a promo code.');
    const promo = findPromo(code);
    const fees = calcFees({ subtotal, type, promo });
    res.json({
      promo: { code: promo.code, description: promo.description, type: promo.type, value: promo.value },
      discount: fees.discount,
      fees,
    });
  })
);

/* ----------------------------- service info ------------------------------ */

router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const s = settingsAll();
    const areas = db
      .prepare("SELECT DISTINCT area, city FROM stores WHERE status='active' AND area IS NOT NULL")
      .all();
    res.json({
      settings: {
        platform_name: s.platform_name,
        currency: s.currency,
        service_fee_percent: s.service_fee_percent,
        service_fee_flat: s.service_fee_flat,
        shopper_fee_percent: s.shopper_fee_percent,
        shopper_fee_flat: s.shopper_fee_flat,
        delivery_fee_base: s.delivery_fee_base,
        delivery_fee_per_km: s.delivery_fee_per_km,
        express_fee: s.express_fee,
        vat_percent: s.vat_percent,
        min_order_value: s.min_order_value,
        cod_enabled: s.cod_enabled,
        wallet_enabled: s.wallet_enabled,
        paystack_enabled: s.paystack_enabled,
        supported_cities: s.supported_cities,
        support_email: s.support_email,
        support_phone: s.support_phone,
        cancellation_window_minutes: s.cancellation_window_minutes,
      },
      areas,
    });
  })
);

export default router;
