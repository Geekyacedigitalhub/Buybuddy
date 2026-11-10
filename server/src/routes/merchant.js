import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { asyncHandler, bad, forbidden, notFound, now, paginate, requireFields, slugify, uid } from '../lib/util.js';
import { notify, event, walletBalance, walletEntry, audit } from '../lib/settings.js';
import { publicOrder, transition, settleOrder, orderLabel, offerJob, isOpenForWork, whenLabel } from '../lib/orders.js';
import { refundPayment } from '../lib/payments.js';

const router = Router();
const merchantOnly = requireRole('merchant');

function myStore(userId) {
  return db.prepare('SELECT * FROM stores WHERE merchant_id = ? ORDER BY created_at LIMIT 1').get(userId);
}

function requireStore(userId) {
  const store = myStore(userId);
  if (!store) throw notFound('No store linked to this account yet.');
  return store;
}

/* --------------------------------- store --------------------------------- */

router.get(
  '/merchant/store',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const store = myStore(req.user.id);
    const profile = db.prepare('SELECT * FROM merchant_profiles WHERE user_id = ?').get(req.user.id);
    res.json({
      store,
      profile: profile ? { ...profile, verified: Boolean(profile.verified) } : null,
      wallet_balance: walletBalance(req.user.id),
    });
  })
);

router.post(
  '/merchant/store',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    requireFields(req.body || {}, ['name']);
    if (myStore(req.user.id)) throw bad('You already have a store.');
    const id = uid('str');
    const slug = `${slugify(req.body.name)}-${Math.random().toString(36).slice(2, 6)}`;
    db.prepare(
      `INSERT INTO stores (id,merchant_id,name,slug,description,logo,cover,area,city,phone,status,is_open,commission_rate,prep_minutes,min_order,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, req.user.id, req.body.name, slug, req.body.description || null, req.body.logo || null, req.body.cover || null,
      req.body.area || null, req.body.city || 'Lagos', req.body.phone || null, 'pending', 0,
      Number(req.body.commission_rate ?? 0.12), Number(req.body.prep_minutes || 20), Number(req.body.min_order || 0), now()
    );
    audit(req, 'store.create', 'store', id, { name: req.body.name });
    res.status(201).json({ store: db.prepare('SELECT * FROM stores WHERE id = ?').get(id) });
  })
);

router.patch(
  '/merchant/store',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const store = requireStore(req.user.id);
    const allowed = ['name', 'description', 'logo', 'cover', 'area', 'city', 'phone', 'opens_at', 'closes_at', 'prep_minutes', 'min_order'];
    const patch = {};
    for (const k of allowed) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    if (req.body?.is_open !== undefined) patch.is_open = req.body.is_open ? 1 : 0;
    if (Object.keys(patch).length) {
      const sets = Object.keys(patch).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE stores SET ${sets} WHERE id = @id`).run({ ...patch, id: store.id });
    }
    res.json({ store: db.prepare('SELECT * FROM stores WHERE id = ?').get(store.id) });
  })
);

router.post(
  '/merchant/store/toggle-open',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const store = requireStore(req.user.id);
    if (store.status !== 'active') throw bad('Your store must be approved before you can open it.');
    db.prepare('UPDATE stores SET is_open = ? WHERE id = ?').run(req.body?.open ? 1 : 0, store.id);
    res.json({ is_open: Boolean(req.body?.open) });
  })
);

/* -------------------------------- products ------------------------------- */

router.get(
  '/merchant/products',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const store = requireStore(req.user.id);
    const { limit, offset, page } = paginate(req, 50);
    const q = req.query.q ? `%${req.query.q}%` : null;
    const rows = q
      ? db.prepare('SELECT * FROM products WHERE store_id = ? AND name LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(store.id, q, limit, offset)
      : db.prepare('SELECT * FROM products WHERE store_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(store.id, limit, offset);
    const total = db.prepare('SELECT COUNT(*) c FROM products WHERE store_id = ?').get(store.id).c;
    res.json({ products: rows, total, page });
  })
);

router.post(
  '/merchant/products',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const store = requireStore(req.user.id);
    requireFields(req.body || {}, ['name', 'price']);
    const id = uid('prd');
    db.prepare(
      `INSERT INTO products (id,store_id,category_id,name,description,price,compare_at,image,unit,stock,status,tags,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, store.id, req.body.category_id || null, req.body.name, req.body.description || null,
      Math.round(Number(req.body.price)), req.body.compare_at ? Math.round(Number(req.body.compare_at)) : null,
      req.body.image || null, req.body.unit || 'each', Number(req.body.stock || 0),
      req.body.status === 'inactive' ? 'inactive' : 'active', req.body.tags || null, now()
    );
    audit(req, 'product.create', 'product', id, { name: req.body.name });
    res.status(201).json({ product: db.prepare('SELECT * FROM products WHERE id = ?').get(id) });
  })
);

router.patch(
  '/merchant/products/:id',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const store = requireStore(req.user.id);
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.id, store.id);
    if (!product) throw notFound('Product not found in your store');
    const allowed = ['name', 'description', 'category_id', 'image', 'unit', 'status', 'tags'];
    const patch = {};
    for (const k of allowed) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    if (req.body?.price !== undefined) patch.price = Math.round(Number(req.body.price));
    if (req.body?.compare_at !== undefined) patch.compare_at = req.body.compare_at ? Math.round(Number(req.body.compare_at)) : null;
    if (req.body?.stock !== undefined) patch.stock = Math.max(0, Number(req.body.stock));
    if (Object.keys(patch).length) {
      const sets = Object.keys(patch).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE products SET ${sets} WHERE id = @id`).run({ ...patch, id: product.id });
    }
    res.json({ product: db.prepare('SELECT * FROM products WHERE id = ?').get(product.id) });
  })
);

router.delete(
  '/merchant/products/:id',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const store = requireStore(req.user.id);
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.id, store.id);
    if (!product) throw notFound('Product not found');
    db.prepare("UPDATE products SET status = 'inactive' WHERE id = ?").run(product.id);
    res.json({ ok: true });
  })
);

/* --------------------------------- orders -------------------------------- */

router.get(
  '/merchant/orders',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const store = requireStore(req.user.id);
    const { limit, offset, page } = paginate(req, 30);
    const status = req.query.status;
    const rows = status
      ? db.prepare('SELECT * FROM orders WHERE store_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(store.id, status, limit, offset)
      : db.prepare('SELECT * FROM orders WHERE store_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(store.id, limit, offset);
    res.json({
      orders: rows.map((o) => ({
        ...o,
        status_label: orderLabel(o.status),
        address: JSON.parse(o.address_json || '{}'),
        items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id),
      })),
      page,
    });
  })
);

router.post(
  '/merchant/orders/:id/accept',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const store = requireStore(req.user.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(req.params.id, store.id);
    if (!order) throw notFound('Order not found');
    if (!isOpenForWork(order)) {
      throw bad(`Booked for ${whenLabel(order.scheduled_for)}. It opens to your kitchen about an hour before, and we will remind you.`);
    }
    const updated = transition(order.id, 'accepted', { actor: req.user, actorRole: 'merchant', note: `Accepted by ${store.name}` });
    res.json({ order: publicOrder(updated) });
  })
);

router.post(
  '/merchant/orders/:id/ready',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const store = requireStore(req.user.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(req.params.id, store.id);
    if (!order) throw notFound('Order not found');
    if (!isOpenForWork(order)) {
      throw bad(`Booked for ${whenLabel(order.scheduled_for)}. Nothing to hand over yet.`);
    }
    if (order.status === 'accepted') {
      transition(order.id, 'preparing', { actor: req.user, actorRole: 'merchant', note: 'Store is preparing your order' });
    }
    const updated = transition(order.id, 'ready_for_pickup', { actor: req.user, actorRole: 'merchant', note: 'Ready for pickup' });
    const offered = offerJob(order.id, 'rider');
    res.json({ order: publicOrder(updated), riders_offered: offered });
  })
);

router.post(
  '/merchant/orders/:id/reject',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const store = requireStore(req.user.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(req.params.id, store.id);
    if (!order) throw notFound('Order not found');
    const reason = String(req.body?.reason || '').trim() || 'Store could not fulfil this order';

    /*
     * Declining is only honest before the food is made and handed over. Without
     * this guard a shop could decline a paid order that a rider had already
     * collected, restock the items and refund — while the customer waited at the
     * gate for a delivery that had been cancelled behind their back.
     */
    if (!['paid', 'accepted', 'preparing'].includes(order.status)) {
      const when = {
        ready_for_pickup: 'the rider is on the way to collect it',
        rider_assigned: 'the rider is on the way to collect it',
        picked_up: 'the rider has collected it',
        in_transit: 'it is already out for delivery',
        delivered: 'it has been delivered',
        completed: 'it is finished',
      }[order.status];
      throw bad(
        `This order cannot be declined any more${when ? ` — ${when}` : ''}. ` +
        `Call the customer on the order instead, or ask BUYBUDDY support to step in.`
      );
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    for (const i of items) if (i.product_id) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(i.qty, i.product_id);
    transition(order.id, 'cancelled', { actor: req.user, actorRole: 'merchant', note: `Rejected by store — ${reason}` });

    /*
     * The refund goes through the same path as every other refund: back to the
     * card if Paystack actually took the money, into the wallet if it did not.
     * Crediting the wallet for a card payment left the customer's money sitting in
     * the Paystack balance while BUYBUDDY paid again out of its own pocket.
     */
    let where = 'You have not been charged.';
    if (['paid', 'paid_cash'].includes(order.payment_status)) {
      const result = await refundPayment(order.id, {
        reason: `Store declined the order — ${reason}`,
        actor: req.user,
      });
      where = result.to_card
        ? `₦${result.refunded.toLocaleString()} is on its way back to your card — banks usually take 5–10 working days.`
        : `₦${result.refunded.toLocaleString()} is back in your BUYBUDDY wallet now, ready to spend.`;
    }

    notify(order.customer_id, {
      title: `Order ${order.code} declined`,
      body: `${store.name} could not fulfil this order: ${reason}. ${where}`,
      kind: 'alert',
      orderId: order.id,
    });
    audit(req, 'order.reject', 'order', order.id, { reason });
    res.json({ ok: true, refunded: ['refunded'].includes(db.prepare('SELECT payment_status FROM orders WHERE id = ?').get(order.id).payment_status) });
  })
);

/* ------------------------------- dashboard ------------------------------- */

router.get(
  '/merchant/dashboard',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const store = requireStore(req.user.id);
    const orders = db.prepare('SELECT * FROM orders WHERE store_id = ?').all(store.id);
    const completed = orders.filter((o) => ['completed', 'delivered'].includes(o.status));
    const gmv = completed.reduce((s, o) => s + (o.approved_subtotal || o.subtotal), 0);
    const commission = Math.round(gmv * store.commission_rate);
    const productCount = db.prepare('SELECT COUNT(*) c FROM products WHERE store_id = ?').get(store.id).c;
    const lowStock = db.prepare('SELECT * FROM products WHERE store_id = ? AND stock <= 5 AND status = ? ORDER BY stock LIMIT 10').all(store.id, 'active');
    const pending = orders.filter((o) => o.status === 'paid');
    const active = orders.filter((o) => ['accepted', 'preparing', 'ready_for_pickup', 'rider_assigned', 'picked_up', 'in_transit'].includes(o.status));
    const last7 = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      const dayOrders = orders.filter((o) => o.created_at.startsWith(day));
      last7.push({ day, orders: dayOrders.length, revenue: dayOrders.reduce((s, o) => s + (o.approved_subtotal || o.subtotal), 0) });
    }
    res.json({
      store,
      metrics: {
        orders_today: orders.filter((o) => o.created_at.startsWith(new Date().toISOString().slice(0, 10))).length,
        orders_total: orders.length,
        pending_acceptance: pending.length,
        active_orders: active.length,
        gmv,
        net_earnings: gmv - commission,
        commission,
        products: productCount,
        rating: store.rating_avg,
        wallet_balance: walletBalance(req.user.id),
      },
      pending_orders: pending.map((o) => ({ ...o, items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id) })),
      active_orders: active.map((o) => ({ ...o, status_label: orderLabel(o.status) })),
      low_stock: lowStock,
      chart: last7,
    });
  })
);

/*
 * SETTLEMENTS — the merchant's money, read from the ledger itself.
 *
 * The old screen rebuilt a settlement table from orders, which drifted from the
 * wallet: it showed money for orders that were never settled, and never showed a
 * withdrawal. wallet_entries is the record of what actually moved, so the screen
 * now reads it directly and joins each settlement back to its order for the
 * gross and the commission that BUYBUDDY kept.
 */
router.get(
  '/merchant/settlements',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    requireStore(req.user.id);
    const entries = db
      .prepare('SELECT * FROM wallet_entries WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200')
      .all(req.user.id);
    const payouts = db
      .prepare('SELECT * FROM payouts WHERE worker_id = ? ORDER BY requested_at DESC LIMIT 50')
      .all(req.user.id);
    const bank = db.prepare('SELECT bank_name, bank_code, account_name, account_number FROM merchant_profiles WHERE user_id = ?').get(req.user.id) || {};

    const orderCache = new Map();
    const orderOf = (id) => {
      if (!orderCache.has(id)) {
        orderCache.set(id, db.prepare('SELECT id, code, subtotal, approved_subtotal, service_fee, delivery_fee, total, created_at FROM orders WHERE id = ?').get(id) || null);
      }
      return orderCache.get(id);
    };

    const ledger = entries.map((e) => {
      const order = e.order_id ? orderOf(e.order_id) : null;
      const isSettlement = /^Settlement/.test(e.description || '') && order;
      const gross = isSettlement ? (order.approved_subtotal || order.subtotal) : null;
      return {
        ...e,
        order_code: order?.code || null,
        gross,
        commission: gross != null ? gross - e.amount : null,
      };
    });

    const settledRows = ledger.filter((e) => e.type === 'credit' && e.gross != null);
    const open = payouts.filter((p) => p.status === 'requested' || p.status === 'approved');
    const balance = walletBalance(req.user.id);
    const held = open.reduce((s, p) => s + p.amount, 0);

    res.json({
      balance,
      held,
      available: balance,
      bank: bank.account_number ? bank : null,
      ledger,
      payouts,
      open_payout: open[0] || null,
      totals: {
        gross: settledRows.reduce((s, e) => s + e.gross, 0),
        commission: settledRows.reduce((s, e) => s + (e.commission || 0), 0),
        net: settledRows.reduce((s, e) => s + e.amount, 0),
        orders: settledRows.length,
        credited: ledger.filter((e) => e.type === 'credit').reduce((s, e) => s + e.amount, 0),
        withdrawn: payouts.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0),
      },
    });
  })
);

/* Bank details for payouts. Without an account number a withdrawal is refused,
 * so the merchant sets it here instead of phoning support. */
router.patch(
  '/merchant/bank',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const acct = String(req.body?.account_number || '').replace(/\s/g, '');
    if (acct && !/^\d{10}$/.test(acct)) throw bad('Enter the 10-digit account number from your bank.');
    const patch = {
      bank_name: req.body?.bank_name || null,
      bank_code: req.body?.bank_code || null,
      account_name: req.body?.account_name || null,
      account_number: acct || null,
    };
    if (patch.account_number && (!patch.bank_name || !patch.account_name)) {
      throw bad('Add the bank name and the account name as they appear on your bank statement.');
    }
    db.prepare('UPDATE merchant_profiles SET bank_name = ?, bank_code = ?, account_name = ?, account_number = ? WHERE user_id = ?')
      .run(patch.bank_name, patch.bank_code, patch.account_name, patch.account_number, req.user.id);
    audit(req, 'merchant.bank_updated', 'user', req.user.id);
    res.json({ bank: patch.account_number ? patch : null });
  })
);

/*
 * WITHDRAWAL — same rule as a rider's: the money leaves the wallet when the
 * request is filed, so one merchant cannot file five requests against the same
 * ₦20,000 and have every one of them look affordable.
 */
router.post(
  '/merchant/payouts',
  requireAuth,
  merchantOnly,
  asyncHandler(async (req, res) => {
    const amount = Math.round(Number(req.body?.amount || 0));
    if (!Number.isFinite(amount) || amount <= 0) throw bad('Enter the amount you want to withdraw.');
    if (amount < 1000) throw bad('The minimum withdrawal is ₦1,000.');

    const open = db
      .prepare("SELECT * FROM payouts WHERE worker_id = ? AND status IN ('requested','approved') ORDER BY requested_at DESC LIMIT 1")
      .get(req.user.id);
    if (open) {
      throw bad(
        `You already have a ₦${open.amount.toLocaleString()} withdrawal waiting (${open.status}). ` +
        'It will be paid to your bank account, then you can request another.'
      );
    }

    const balance = walletBalance(req.user.id);
    if (amount > balance) throw bad(`Your settled balance is ₦${balance.toLocaleString()}, so you can withdraw up to that.`);
    const bank = db.prepare('SELECT * FROM merchant_profiles WHERE user_id = ?').get(req.user.id);
    if (!bank?.account_number) throw bad('Add your bank account details below before requesting a withdrawal.');

    const id = uid('po');
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO payouts (id,worker_id,amount,status,note,requested_at,held) VALUES (?,?,?,?,?,?,1)')
        .run(id, req.user.id, amount, 'requested', req.body?.note || null, now());
      walletEntry(req.user.id, {
        type: 'debit',
        amount,
        description: 'Withdrawal requested (held until paid)',
      });
    });
    tx();
    notify(req.user.id, {
      title: 'Withdrawal requested',
      body: `₦${amount.toLocaleString()} is set aside and will be paid into ${bank.bank_name} ••••${String(bank.account_number).slice(-4)}.`,
      kind: 'payment',
    });
    res.status(201).json({ payout: db.prepare('SELECT * FROM payouts WHERE id = ?').get(id) });
  })
);

export default router;
