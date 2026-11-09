import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth, requireRole, revokeTokens, hashPassword } from '../lib/auth.js';
import { asyncHandler, bad, notFound, now, paginate, requireFields, uid, slugify, forbidden } from '../lib/util.js';
import { notify, event, settingsAll, setSetting, DEFAULT_SETTINGS, walletBalance, walletEntry, audit } from '../lib/settings.js';
import { publicOrder, transition, forceAssign, orderLabel, eligibleWorkers, settleOrder } from '../lib/orders.js';
import { refundPayment, paymentModes, paystackReachability } from '../lib/payments.js';
import { sendSms, smsStatus } from '../lib/sms.js';
import { issueResetCode } from './accounts.js';
import { dumpDatabase, restoreDatabase, tableOrder } from '../lib/backup.js';

const router = Router();
// Scope the admin guard to /admin/* so this router cannot swallow (and 403)
// unrelated routes mounted after it under /api.
router.use('/admin', requireAuth, requireRole('admin'));

/* ------------------------------- overview -------------------------------- */

router.get(
  '/admin/overview',
  asyncHandler(async (req, res) => {
    const days = Math.max(1, Number(req.query.days || 7));
    const since = new Date(Date.now() - days * 864e5).toISOString();

    const count = (sql, ...p) => db.prepare(sql).get(...p).c;
    const customers = count("SELECT COUNT(*) c FROM users WHERE role='customer'");
    const merchants = count("SELECT COUNT(*) c FROM users WHERE role='merchant'");
    const merchantsPending = count("SELECT COUNT(*) c FROM stores WHERE status='pending'");
    const shoppers = count("SELECT COUNT(*) c FROM users WHERE role='shopper'");
    const riders = count("SELECT COUNT(*) c FROM users WHERE role='rider'");
    const workersPending = count('SELECT COUNT(*) c FROM worker_profiles WHERE verified = 0');
    const orders = db.prepare('SELECT * FROM orders').all();
    const byStatus = orders.reduce((acc, o) => ({ ...acc, [o.status]: (acc[o.status] || 0) + 1 }), {});
    const paid = orders.filter((o) => ['paid', 'paid_cash'].includes(o.payment_status));
    const gmv = paid.reduce((s, o) => s + o.total, 0);
    const completed = orders.filter((o) => ['completed', 'delivered'].includes(o.status));
    const completedGmv = completed.reduce((s, o) => s + (o.approved_subtotal || o.subtotal), 0);
    const serviceRevenue = paid.reduce((s, o) => s + o.service_fee, 0);
    const deliveryRevenue = paid.reduce((s, o) => s + o.delivery_fee, 0);
    const merchantCommission = completed.reduce((s, o) => {
      const store = o.store_id ? db.prepare('SELECT commission_rate FROM stores WHERE id = ?').get(o.store_id) : null;
      return s + Math.round((o.approved_subtotal || o.subtotal) * (store?.commission_rate ?? 0.12));
    }, 0);
    const platformRevenue = serviceRevenue + merchantCommission;

    const chart = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      const dayOrders = orders.filter((o) => o.created_at.startsWith(day));
      chart.push({
        day,
        orders: dayOrders.length,
        gmv: dayOrders.filter((o) => ['paid', 'paid_cash'].includes(o.payment_status)).reduce((s, o) => s + o.total, 0),
      });
    }

    const recentOrders = db
      .prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8')
      .all()
      .map((o) => ({
        ...o,
        status_label: orderLabel(o.status),
        customer: db.prepare('SELECT name FROM users WHERE id = ?').get(o.customer_id)?.name,
      }));

    res.json({
      kpis: {
        customers, merchants, merchants_pending: merchantsPending, shoppers, riders, workers_pending: workersPending,
        orders_total: orders.length,
        orders_active: orders.filter((o) => !['completed', 'cancelled', 'refunded'].includes(o.status)).length,
        orders_completed: completed.length,
        orders_cancelled: orders.filter((o) => o.status === 'cancelled').length,
        orders_disputed: count("SELECT COUNT(*) c FROM support_tickets WHERE status != 'resolved'"),
        gmv, completed_gmv: completedGmv, service_revenue: serviceRevenue,
        delivery_revenue: deliveryRevenue, merchant_commission: merchantCommission,
        platform_revenue: platformRevenue,
        payouts_pending: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payouts WHERE status='requested'").get().s,
        open_tickets: count("SELECT COUNT(*) c FROM support_tickets WHERE status = 'open'"),
      },
      by_status: byStatus,
      chart,
      recent_orders: recentOrders,
      alerts: [
        merchantsPending ? `${merchantsPending} merchant application(s) awaiting approval` : null,
        workersPending ? `${workersPending} shopper/rider application(s) awaiting verification` : null,
        count("SELECT COUNT(*) c FROM payouts WHERE status='requested'") ? 'Withdrawal requests awaiting review' : null,
        count("SELECT COUNT(*) c FROM orders WHERE type='personal' AND status='awaiting_approval'") ? 'Personal shopping baskets awaiting customer approval' : null,
      ].filter(Boolean),
    });
  })
);

/* --------------------------------- orders -------------------------------- */

router.get(
  '/admin/orders',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = paginate(req, 30);
    const where = ['1=1'];
    const params = [];
    if (req.query.status) {
      where.push('status = ?');
      params.push(req.query.status);
    }
    if (req.query.type) {
      where.push('type = ?');
      params.push(req.query.type);
    }
    if (req.query.q) {
      where.push('(code LIKE ? OR id IN (SELECT id FROM orders WHERE address_json LIKE ?))');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    if (req.query.payment_status) {
      where.push('payment_status = ?');
      params.push(req.query.payment_status);
    }
    const sql = where.join(' AND ');
    const rows = db.prepare(`SELECT * FROM orders WHERE ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) c FROM orders WHERE ${sql}`).get(...params).c;
    res.json({
      orders: rows.map((o) => ({
        ...o,
        status_label: orderLabel(o.status),
        customer: db.prepare('SELECT name, phone FROM users WHERE id = ?').get(o.customer_id),
        store: o.store_id ? db.prepare('SELECT name FROM stores WHERE id = ?').get(o.store_id) : null,
        shopper: o.shopper_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(o.shopper_id)?.name : null,
        rider: o.rider_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(o.rider_id)?.name : null,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  })
);

router.get(
  '/admin/orders/:id',
  asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? OR code = ?').get(req.params.id, String(req.params.id).toUpperCase());
    if (!order) throw notFound('Order not found');
    res.json({
      order: publicOrder(order, { includePrivate: true }),
      payments: db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC').all(order.id),
      receipts: db.prepare('SELECT id,file_name,amount,note,created_at,uploaded_by FROM receipts WHERE order_id = ?').all(order.id),
      messages: db.prepare('SELECT * FROM messages WHERE order_id = ? ORDER BY created_at').all(order.id),
      events: db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at').all(order.id),
      eligible_shoppers: eligibleWorkers('shopper'),
      eligible_riders: eligibleWorkers('rider'),
    });
  })
);

router.post(
  '/admin/orders/:id/assign',
  asyncHandler(async (req, res) => {
    const { worker_id, role } = req.body || {};
    if (!worker_id || !['shopper', 'rider'].includes(role)) throw bad('Provide worker_id and role (shopper|rider).');
    const order = forceAssign(req.params.id, worker_id, role);
    audit(req, 'order.assign', 'order', order.id, { worker_id, role });
    res.json({ order: publicOrder(order) });
  })
);

router.post(
  '/admin/orders/:id/status',
  asyncHandler(async (req, res) => {
    const { status, note } = req.body || {};
    if (!status) throw bad('Provide the target status.');
    const order = transition(req.params.id, status, { actor: req.user, actorRole: 'admin', note: note || 'Updated by admin' });
    // an admin forcing `completed` must settle + award loyalty exactly like the normal path
    if (status === 'completed') settleOrder(order.id);
    audit(req, 'order.status', 'order', order.id, { status });
    res.json({ order: publicOrder(order) });
  })
);

router.post(
  '/admin/orders/:id/refund',
  asyncHandler(async (req, res) => {
    // async: a card refund is sent to Paystack before anything is marked refunded
    const result = await refundPayment(req.params.id, {
      amount: req.body?.amount,
      reason: req.body?.reason,
      actor: req.user,
    });
    audit(req, 'order.refund', 'order', req.params.id, result);
    res.json(result);
  })
);

/* --------------------------------- users --------------------------------- */

router.get(
  '/admin/users',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = paginate(req, 30);
    const where = ['1=1'];
    const params = [];
    if (req.query.role) {
      where.push('role = ?');
      params.push(req.query.role);
    }
    if (req.query.status) {
      where.push('status = ?');
      params.push(req.query.status);
    }
    if (req.query.q) {
      where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
    }
    const sql = where.join(' AND ');
    const rows = db
      .prepare(`SELECT id,role,name,email,phone,status,city,area,phone_verified,created_at FROM users WHERE ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset)
      .map((u) => ({
        ...u,
        orders: db.prepare('SELECT COUNT(*) c FROM orders WHERE customer_id = ?').get(u.id).c,
        wallet_balance: walletBalance(u.id),
      }));
    const total = db.prepare(`SELECT COUNT(*) c FROM users WHERE ${sql}`).get(...params).c;
    res.json({ users: rows, total, page });
  })
);

/*
 * Support needs this and so does app review: a real account with a password only
 * we know, instead of handing out the shared demo login. Nothing here can create
 * another admin, and the password is never returned to the caller.
 */
router.post(
  '/admin/users',
  asyncHandler(async (req, res) => {
    const { name, email, phone, role = 'customer', password, area, city = 'Lagos' } = req.body || {};
    requireFields(req.body, ['name', 'email', 'password']);
    if (!['customer', 'shopper', 'rider', 'merchant'].includes(role)) throw bad('That role cannot be created here.');
    if (String(password).length < 10) throw bad('Use a password of at least 10 characters.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('That email is already registered.');
    const id = uid('usr');
    db.prepare(
      `INSERT INTO users (id,role,name,email,phone,password_hash,status,avatar,city,area,phone_verified,email_verified,created_at)
       VALUES (?,?,?,?,?,?,'active',NULL,?,?,1,1,?)`
    ).run(id, role, name, email, phone || null, hashPassword(String(password)), city, area || null, now());
    audit(req, 'user.create', 'user', id, { role, email });
    res.status(201).json({ user: { id, role, name, email } });
  })
);

router.post(
  '/admin/users/:id/status',
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body || {};
    if (!['active', 'suspended', 'restricted', 'pending'].includes(status)) throw bad('Invalid status.');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) throw notFound('User not found');
    if (user.role === 'admin') throw forbidden('Admin accounts cannot be modified here.');
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, user.id);
    if (status !== 'active') revokeTokens(user.id);
    audit(req, 'user.status', 'user', user.id, { status, reason });
    notify(user.id, {
      title: `Account ${status}`,
      body: reason || (status === 'active' ? 'Your account has been reactivated.' : 'Contact support for details.'),
      kind: 'alert',
    });
    res.json({ ok: true });
  })
);

router.post(
  '/admin/users/:id/password-reset-code',
  asyncHandler(async (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) throw notFound('User not found');
    const { code, expiresAt } = issueResetCode(user.id);
    const delivery = await sendSms(
      user.phone,
      `BUYBUDDY: your password reset code is ${code}. It works for 15 minutes.`
    );
    audit(req, 'user.password_reset_code', 'user', user.id, { sms: Boolean(delivery.ok) });
    res.json({
      code,
      expires_at: expiresAt,
      sms: Boolean(delivery.ok),
      phone: user.phone || null,
      message: delivery.ok
        ? `Sent by SMS to ${user.phone}.`
        : 'SMS is not switched on yet — read this code to the user yourself.',
    });
  })
);

/* -------------------------------- products -------------------------------- */

/**
 * Moderation. A merchant can list anything, and until now the only lever was to
 * suspend the whole store — which punishes a shop with 200 good products because
 * of one bad one. Admin can now hide a single product, say why, and the merchant
 * is told in their notifications. Nothing is deleted: the row stays for the
 * audit trail and can be put back.
 */
router.get(
  '/admin/products',
  asyncHandler(async (req, res) => {
    const { limit, offset } = paginate(req, 40);
    const where = [];
    const params = {};
    if (req.query.q) { where.push('(p.name LIKE @q OR s.name LIKE @q)'); params.q = `%${req.query.q}%`; }
    if (req.query.store_id) { where.push('p.store_id = @store_id'); params.store_id = req.query.store_id; }
    if (req.query.status) { where.push('p.status = @status'); params.status = req.query.status; }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT p.*, s.name AS store_name, s.status AS store_status, u.name AS owner_name, u.email AS owner_email
         FROM products p JOIN stores s ON s.id = p.store_id JOIN users u ON u.id = s.merchant_id
         ${clause} ORDER BY p.created_at DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit, offset });
    const total = db
      .prepare(`SELECT COUNT(*) c FROM products p JOIN stores s ON s.id = p.store_id ${clause}`)
      .get(params).c;
    res.json({ products: rows, total, limit, offset });
  })
);

router.patch(
  '/admin/products/:id',
  asyncHandler(async (req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) throw notFound('Product not found');
    const status = req.body?.status;
    if (!['active', 'inactive'].includes(status)) throw bad('Choose active or inactive.');
    const reason = String(req.body?.reason || '').slice(0, 300);
    db.prepare('UPDATE products SET status = ? WHERE id = ?').run(status, product.id);
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(product.store_id);
    audit(req, 'product.moderate', 'product', product.id, { status, reason, store_id: product.store_id });
    if (store) {
      notify(store.merchant_id, {
        title: status === 'active' ? `Listing restored: ${product.name}` : `Listing hidden: ${product.name}`,
        body: status === 'active'
          ? 'BUYBUDDY has put your product back on the marketplace.'
          : `BUYBUDDY took this listing down${reason ? ` — ${reason}` : ''}. Fix it and turn it back on in Products.`,
        kind: 'alert',
      });
    }
    res.json({ ok: true, product: db.prepare('SELECT * FROM products WHERE id = ?').get(product.id) });
  })
);

/* ------------------------------- merchants ------------------------------- */

router.get(
  '/admin/merchants',
  asyncHandler(async (req, res) => {
    const stores = db
      .prepare(
        `SELECT s.*, u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone, u.status AS owner_status,
                m.business_name, m.cac_number, m.verified
         FROM stores s JOIN users u ON u.id = s.merchant_id
         LEFT JOIN merchant_profiles m ON m.user_id = s.merchant_id
         ORDER BY (s.status = 'pending') DESC, s.created_at DESC`
      )
      .all()
      .map((s) => ({
        ...s,
        products: db.prepare('SELECT COUNT(*) c FROM products WHERE store_id = ?').get(s.id).c,
        orders: db.prepare('SELECT COUNT(*) c FROM orders WHERE store_id = ?').get(s.id).c,
      }));
    res.json({ merchants: stores });
  })
);

router.post(
  '/admin/merchants/:storeId/decision',
  asyncHandler(async (req, res) => {
    const { decision, reason } = req.body || {};
    if (!['approve', 'reject', 'suspend', 'reactivate'].includes(decision)) throw bad('Invalid decision.');
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.storeId);
    if (!store) throw notFound('Store not found');
    const map = { approve: 'active', reject: 'rejected', suspend: 'suspended', reactivate: 'active' };
    const status = map[decision];
    db.prepare('UPDATE stores SET status = ?, is_open = ?, suspended_reason = ? WHERE id = ?').run(
      status, status === 'active' ? 1 : 0, decision === 'reject' || decision === 'suspend' ? reason || null : null, store.id
    );
    if (decision === 'approve') db.prepare('UPDATE merchant_profiles SET verified = 1 WHERE user_id = ?').run(store.merchant_id);
    audit(req, `merchant.${decision}`, 'store', store.id, { reason });
    notify(store.merchant_id, {
      title: decision === 'approve' ? 'Store approved 🎉' : `Store ${status}`,
      body: decision === 'approve' ? 'You can now open your store and start receiving orders.' : reason || 'Contact support for details.',
      kind: 'alert',
    });
    res.json({ store: db.prepare('SELECT * FROM stores WHERE id = ?').get(store.id) });
  })
);

/* -------------------------------- workers -------------------------------- */

router.get(
  '/admin/workers',
  asyncHandler(async (req, res) => {
    const workers = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.phone, u.status, u.area, u.created_at, w.*
         FROM users u JOIN worker_profiles w ON w.user_id = u.id
         WHERE u.role IN ('shopper','rider')
         ORDER BY w.verified ASC, u.created_at DESC`
      )
      .all()
      .map((w) => ({
        ...w,
        docs_json: w.docs_json ? JSON.parse(w.docs_json) : null,
        jobs: db.prepare('SELECT COUNT(*) c FROM orders WHERE shopper_id = ? OR rider_id = ?').get(w.id, w.id).c,
        wallet_balance: walletBalance(w.id),
      }));
    res.json({ workers });
  })
);

router.post(
  '/admin/workers/:id/decision',
  asyncHandler(async (req, res) => {
    const { decision, reason } = req.body || {};
    if (!['approve', 'reject', 'suspend'].includes(decision)) throw bad('Invalid decision.');
    const worker = db.prepare('SELECT * FROM worker_profiles WHERE user_id = ?').get(req.params.id);
    if (!worker) throw notFound('Worker not found');
    if (decision === 'approve') {
      db.prepare('UPDATE worker_profiles SET verified = 1, rejection_reason = NULL WHERE user_id = ?').run(worker.user_id);
      db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(worker.user_id);
    } else if (decision === 'reject') {
      db.prepare('UPDATE worker_profiles SET verified = 0, rejection_reason = ? WHERE user_id = ?').run(reason || 'Documents not accepted', worker.user_id);
    } else {
      db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(worker.user_id);
      revokeTokens(worker.user_id);
    }
    audit(req, `worker.${decision}`, 'worker', worker.user_id, { reason });
    notify(worker.user_id, {
      title: decision === 'approve' ? 'You are verified ✅' : `Verification ${decision}`,
      body: reason || (decision === 'approve' ? 'You can now go online and accept jobs.' : 'Contact support for details.'),
      kind: 'alert',
    });
    res.json({ ok: true });
  })
);

/* -------------------------------- finance -------------------------------- */

router.get(
  '/admin/finance',
  asyncHandler(async (req, res) => {
    const payments = db
      .prepare(
        `SELECT p.*, o.code AS order_code, u.name AS customer_name FROM payments p
         LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN users u ON u.id = o.customer_id
         ORDER BY p.created_at DESC LIMIT 100`
      )
      .all();
    const payouts = db
      .prepare(
        `SELECT p.*, u.name AS worker_name, u.role, w.account_number, w.bank_name, w.account_name
         FROM payouts p JOIN users u ON u.id = p.worker_id
         LEFT JOIN worker_profiles w ON w.user_id = p.worker_id
         ORDER BY p.requested_at DESC LIMIT 100`
      )
      .all();
    res.json({
      payments,
      payouts,
      totals: {
        captured: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='success'").get().s,
        pending: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='pending'").get().s,
        refunded: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='refunded'").get().s,
        payouts_requested: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payouts WHERE status='requested'").get().s,
        payouts_paid: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payouts WHERE status='paid'").get().s,
      },
    });
  })
);

router.post(
  '/admin/payouts/:id/decision',
  asyncHandler(async (req, res) => {
    const { decision } = req.body || {};
    if (!['approve', 'reject', 'pay'].includes(decision)) throw bad('Invalid decision.');
    const payout = db.prepare('SELECT * FROM payouts WHERE id = ?').get(req.params.id);
    if (!payout) throw notFound('Payout not found');
    if (decision === 'reject') {
      const why = String(req.body?.reason || '').slice(0, 300);
      /*
       * The money was taken out of their wallet when they asked, so a rejection
       * has to put it back — otherwise "rejected" quietly keeps the cash.
       */
      if (payout.held) {
        walletEntry(payout.worker_id, {
          type: 'credit',
          amount: payout.amount,
          description: 'Withdrawal rejected — money returned',
        });
        db.prepare('UPDATE payouts SET held = 0 WHERE id = ?').run(payout.id);
      }
      db.prepare("UPDATE payouts SET status = 'rejected', processed_at = ? WHERE id = ?").run(now(), payout.id);
      notify(payout.worker_id, {
        title: 'Withdrawal rejected',
        body: why
          ? `${why} — ₦${payout.amount.toLocaleString()} is back in your wallet.`
          : `₦${payout.amount.toLocaleString()} is back in your wallet. Contact support for details.`,
        kind: 'payment',
      });
    } else if (decision === 'approve') {
      db.prepare("UPDATE payouts SET status = 'approved', processed_at = ? WHERE id = ?").run(now(), payout.id);
      notify(payout.worker_id, { title: 'Withdrawal approved', body: 'Your money is on the way.', kind: 'payment' });
    } else {
      if (!payout.held) {
        // a request made before money was held at request time
        const bal = walletBalance(payout.worker_id);
        if (bal < payout.amount) throw bad('Worker balance is too low to complete this payout.');
        walletEntry(payout.worker_id, { type: 'debit', amount: payout.amount, description: 'Withdrawal paid out' });
        db.prepare('UPDATE payouts SET held = 0 WHERE id = ?').run(payout.id);
      }
      db.prepare("UPDATE payouts SET status = 'paid', processed_at = ? WHERE id = ?").run(now(), payout.id);
      notify(payout.worker_id, { title: 'Withdrawal paid', body: `₦${payout.amount.toLocaleString()} sent to your bank.`, kind: 'payment' });
    }
    audit(req, `payout.${decision}`, 'payout', payout.id, { amount: payout.amount });
    res.json({ ok: true });
  })
);

/* ------------------------------- marketing ------------------------------- */

router.get(
  '/admin/promos',
  asyncHandler(async (_req, res) => {
    res.json({ promos: db.prepare('SELECT * FROM promos ORDER BY created_at DESC').all() });
  })
);

router.post(
  '/admin/promos',
  asyncHandler(async (req, res) => {
    requireFields(req.body || {}, ['code', 'type', 'value']);
    if (!['percent', 'fixed', 'free_delivery'].includes(req.body.type)) throw bad('Invalid promo type.');
    const code = String(req.body.code).toUpperCase().replace(/\s+/g, '');
    if (db.prepare('SELECT 1 FROM promos WHERE code = ?').get(code)) throw bad('That code already exists.');
    db.prepare(
      `INSERT INTO promos (code,description,type,value,min_subtotal,max_discount,usage_limit,used_count,active,expires_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      code, req.body.description || null, req.body.type, Number(req.body.value), Number(req.body.min_subtotal || 0),
      req.body.max_discount ? Number(req.body.max_discount) : null, req.body.usage_limit ? Number(req.body.usage_limit) : null,
      0, req.body.active === false ? 0 : 1, req.body.expires_at || null, now()
    );
    audit(req, 'promo.create', 'promo', code, req.body);
    res.status(201).json({ promo: db.prepare('SELECT * FROM promos WHERE code = ?').get(code) });
  })
);

router.patch(
  '/admin/promos/:code',
  asyncHandler(async (req, res) => {
    const promo = db.prepare('SELECT * FROM promos WHERE code = ?').get(req.params.code);
    if (!promo) throw notFound('Promo not found');
    if (req.body?.active !== undefined) db.prepare('UPDATE promos SET active = ? WHERE code = ?').run(req.body.active ? 1 : 0, promo.code);
    res.json({ promo: db.prepare('SELECT * FROM promos WHERE code = ?').get(promo.code) });
  })
);

router.get(
  '/admin/banners',
  asyncHandler(async (_req, res) => {
    res.json({ banners: db.prepare('SELECT * FROM marketing_banners ORDER BY sort').all() });
  })
);

router.post(
  '/admin/banners',
  asyncHandler(async (req, res) => {
    requireFields(req.body || {}, ['title']);
    const id = uid('bnr');
    db.prepare(
      'INSERT INTO marketing_banners (id,title,subtitle,image,cta_label,cta_link,bg_color,active,sort,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(
      id, req.body.title, req.body.subtitle || null, req.body.image || null, req.body.cta_label || 'Shop now',
      req.body.cta_link || '/', req.body.bg_color || '#176B55', req.body.active === false ? 0 : 1, Number(req.body.sort || 0), now()
    );
    audit(req, 'banner.create', 'banner', id, { title: req.body.title });
    res.status(201).json({ banner: db.prepare('SELECT * FROM marketing_banners WHERE id = ?').get(id) });
  })
);

router.patch(
  '/admin/banners/:id',
  asyncHandler(async (req, res) => {
    const b = db.prepare('SELECT * FROM marketing_banners WHERE id = ?').get(req.params.id);
    if (!b) throw notFound('Banner not found');
    const allowed = ['title', 'subtitle', 'image', 'cta_label', 'cta_link', 'bg_color', 'sort'];
    const patch = {};
    for (const k of allowed) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    if (req.body?.active !== undefined) patch.active = req.body.active ? 1 : 0;
    if (Object.keys(patch).length) {
      const sets = Object.keys(patch).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE marketing_banners SET ${sets} WHERE id = @id`).run({ ...patch, id: b.id });
    }
    res.json({ banner: db.prepare('SELECT * FROM marketing_banners WHERE id = ?').get(b.id) });
  })
);

/** Broadcast notification — the only place admins can push to a whole segment. */
router.post(
  '/admin/notifications/broadcast',
  asyncHandler(async (req, res) => {
    const { title, body, role = 'customer' } = req.body || {};
    requireFields(req.body || {}, ['title', 'body']);
    const users = db.prepare('SELECT id FROM users WHERE role = ? AND status = ?').all(role, 'active');
    for (const u of users) notify(u.id, { title, body, kind: 'broadcast' });
    db.prepare('INSERT INTO campaigns (id,name,kind,payload,status,sent_count,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(
      uid('cmp'), title, 'push', JSON.stringify({ title, body, role }), 'sent', users.length, req.user.id, now()
    );
    audit(req, 'notification.broadcast', 'campaign', null, { title, role, count: users.length });
    res.json({ sent: users.length });
  })
);

/* ---------------------------- settings & support -------------------------- */

router.get(
  '/admin/settings',
  asyncHandler(async (_req, res) => {
    res.json({ settings: settingsAll(), defaults: DEFAULT_SETTINGS });
  })
);

router.put(
  '/admin/settings',
  asyncHandler(async (req, res) => {
    const updates = req.body?.settings || req.body || {};
    const applied = {};
    for (const [k, v] of Object.entries(updates)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      setSetting(k, v);
      applied[k] = v;
    }
    audit(req, 'settings.update', 'settings', null, applied);
    res.json({ settings: settingsAll() });
  })
);

router.get(
  '/admin/tickets',
  asyncHandler(async (req, res) => {
    const tickets = db
      .prepare(
        `SELECT t.*, u.name AS customer_name, u.phone AS customer_phone FROM support_tickets t
         JOIN users u ON u.id = t.customer_id ORDER BY (t.status = 'open') DESC, t.created_at DESC LIMIT 100`
      )
      .all();
    for (const t of tickets) t.messages = db.prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at').all(t.id);
    res.json({ tickets });
  })
);

router.post(
  '/admin/tickets/:id/reply',
  asyncHandler(async (req, res) => {
    requireFields(req.body || {}, ['body']);
    const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
    if (!ticket) throw notFound('Ticket not found');
    db.prepare('INSERT INTO support_messages (id,ticket_id,sender_id,sender_role,body,created_at) VALUES (?,?,?,?,?,?)').run(
      uid('msg'), ticket.id, req.user.id, 'admin', req.body.body, now()
    );
    db.prepare("UPDATE support_tickets SET status = 'pending', updated_at = ? WHERE id = ?").run(now(), ticket.id);
    notify(ticket.customer_id, { title: `Support replied — ${ticket.subject}`, body: String(req.body.body).slice(0, 120), kind: 'support', orderId: ticket.order_id });
    res.json({ ok: true });
  })
);

router.post(
  '/admin/tickets/:id/resolve',
  asyncHandler(async (req, res) => {
    const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
    if (!ticket) throw notFound('Ticket not found');
    db.prepare("UPDATE support_tickets SET status = 'resolved', resolution = ?, updated_at = ? WHERE id = ?").run(
      req.body?.resolution || 'Resolved', now(), ticket.id
    );
    audit(req, 'ticket.resolve', 'ticket', ticket.id, { resolution: req.body?.resolution });
    res.json({ ok: true });
  })
);

router.get(
  '/admin/audit-logs',
  asyncHandler(async (req, res) => {
    const { limit, offset } = paginate(req, 100);
    res.json({
      logs: db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset),
      total: db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c,
    });
  })
);

/* ------------------------------- categories ------------------------------ */

router.post(
  '/admin/categories',
  asyncHandler(async (req, res) => {
    requireFields(req.body || {}, ['name']);
    const id = uid('cat');
    db.prepare('INSERT INTO categories (id,name,slug,icon,parent_id,sort,active) VALUES (?,?,?,?,?,?,?)').run(
      id, req.body.name, slugify(req.body.name), req.body.icon || '🛍️', req.body.parent_id || null, Number(req.body.sort || 0), 1
    );
    audit(req, 'category.create', 'category', id, { name: req.body.name });
    res.status(201).json({ category: db.prepare('SELECT * FROM categories WHERE id = ?').get(id) });
  })
);

/* ------------------------------ integrations ----------------------------- */
/**
 * One honest view of what is real and what is still simulated. This is the
 * screen to check the day keys arrive: anything amber here means customers are
 * seeing a demo behaviour.
 */
router.get(
  '/admin/integrations',
  asyncHandler(async (_req, res) => {
    const pay = paymentModes();
    const sms = smsStatus();
    // "keys are set" is not the same as "keys work" — ask Paystack directly.
    const payDot = pay.paystack ? await paystackReachability() : { ok: false, detail: '' };
    const checks = [
      {
        key: 'payments',
        label: 'Card payments',
        live: pay.paystack && payDot.ok !== false,
        detail: pay.paystack
          ? payDot.detail || 'Paystack keys are set — real cards are being charged.'
          : 'Running in sandbox. Orders are marked paid without money moving.',
        fix: pay.paystack && payDot.ok === false
          ? 'Paystack refused the configured key. Mint a fresh restricted key with Transactions (read+write), Refunds (write) and Balance (read).'
          : 'Set PAYSTACK_SECRET_KEY on the server, then restart.',
      },
      {
        key: 'sms',
        label: 'Text messages (OTP and order updates)',
        live: sms.live,
        detail: sms.live
          ? `${sms.provider} is configured; ${sms.sent} message(s) delivered, ${sms.failed} failed.`
          : 'No SMS provider yet — codes only appear in the server log.',
        fix: 'Set SMS_PROVIDER=termii with TERMII_API_KEY, then restart.',
      },
      {
        key: 'https',
        label: 'Public HTTPS address',
        live: /^https:\/\//.test(process.env.APP_URL || ''),
        detail: process.env.APP_URL || 'APP_URL is not set.',
        fix: 'Set APP_URL to the public https address of this server.',
      },
      {
        key: 'domain',
        label: 'Custom domain',
        live: Boolean(process.env.APP_URL && !/onrender\.com/.test(process.env.APP_URL)),
        detail: process.env.APP_URL && !/onrender\.com/.test(process.env.APP_URL)
          ? 'Running on your own domain.'
          : 'Still on the free hosting address; set APP_URL once a domain is attached.',
        fix: 'Buy a domain, point it at the host, then set APP_URL.',
      },
      {
        key: 'maps',
        label: 'Live map tracking',
        live: true,
        detail: 'OpenStreetMap with Leaflet — real streets, no API key, no bill.',
        fix: '',
      },
    ];
    res.json({
      checks,
      live_count: checks.filter((c) => c.live).length,
      total: checks.length,
      payments: pay,
      sms,
      recentSms: db.prepare('SELECT phone,status,provider,error,created_at FROM sms_log ORDER BY created_at DESC LIMIT 12').all(),
    });
  })
);

/* --------------------------- backup and restore --------------------------- */

/*
 * A free host keeps no disk: every deploy starts from an empty container. That
 * makes a portable, human-readable backup the difference between "we lost the
 * day" and "we restored in a minute". Admin-only, and the dump carries password
 * hashes, so it is never exposed to any other role.
 */
router.get(
  '/admin/backup',
  asyncHandler(async (req, res) => {
    const dump = dumpDatabase();
    audit(req, 'backup.download', 'database', null, { rows: Object.values(dump.counts).reduce((a, b) => a + b, 0) });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="buybuddy-backup-${stamp}.json"`);
    res.send(JSON.stringify(dump, null, 1));
  })
);

router.post(
  '/admin/restore',
  asyncHandler(async (req, res) => {
    const confirm = String(req.body?.confirm || '');
    if (confirm !== 'REPLACE ALL DATA') throw bad('Type REPLACE ALL DATA to confirm a restore.');
    const dump = req.body?.backup;
    if (!dump) throw bad('No backup supplied.');
    let result;
    try {
      result = restoreDatabase(typeof dump === 'string' ? JSON.parse(dump) : dump);
    } catch (e) {
      // a wrong file is the customer's mistake, not a server fault
      throw bad(e.message);
    }
    audit(req, 'backup.restore', 'database', null, result.restored);
    res.json({ restored: true, ...result, tables: tableOrder().length });
  })
);

export default router;
