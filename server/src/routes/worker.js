import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { asyncHandler, bad, forbidden, notFound, now, requireFields, uid } from '../lib/util.js';
import { notify, event, walletBalance, walletEntry, audit } from '../lib/settings.js';
import { cashForRider } from '../lib/cash.js';
import { acceptJob, declineJob, offerJob, publicOrder, transition, settleOrder, orderLabel, acceptableFor, isOpenForWork, whenLabel } from '../lib/orders.js';

const router = Router();
const workerOnly = (req, _res, next) => {
  if (!['shopper', 'rider'].includes(req.user.role) && req.user.role !== 'admin') return next(forbidden('Worker access only'));
  next();
};

function profile(userId) {
  return db.prepare('SELECT * FROM worker_profiles WHERE user_id = ?').get(userId);
}

export function workerRole(req) {
  if (req.query.role) return req.query.role;
  const p = profile(req.user.id);
  if (!p) return 'shopper';
  const roles = String(p.roles || '').split(',');
  return roles.includes('rider') && !roles.includes('shopper') ? 'rider' : roles[0] || 'shopper';
}

/* ------------------------------- onboarding ------------------------------ */

router.get(
  '/worker/profile',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const p = profile(req.user.id);
    if (!p) throw notFound('No worker profile on this account');
    res.json({
      profile: { ...p, verified: Boolean(p.verified), available: Boolean(p.available), docs_json: p.docs_json ? JSON.parse(p.docs_json) : null },
      wallet_balance: walletBalance(req.user.id),
    });
  })
);

router.patch(
  '/worker/profile',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const p = profile(req.user.id);
    if (!p) throw notFound('No worker profile on this account');
    const allowed = ['vehicle', 'plate', 'service_city', 'service_areas', 'bank_name', 'bank_code', 'account_name', 'account_number'];
    const patch = {};
    for (const k of allowed) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    if (req.body?.roles) {
      const roles = String(req.body.roles).split(',').filter((r) => ['shopper', 'rider'].includes(r));
      if (roles.length) patch.roles = roles.join(',');
    }
    if (req.body?.docs_json) patch.docs_json = JSON.stringify(req.body.docs_json);
    if (req.body?.available !== undefined) patch.available = req.body.available ? 1 : 0;
    if (Object.keys(patch).length) {
      const sets = Object.keys(patch).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE worker_profiles SET ${sets} WHERE user_id = @user_id`).run({ ...patch, user_id: req.user.id });
    }
    const fresh = profile(req.user.id);
    res.json({ profile: { ...fresh, verified: Boolean(fresh.verified), available: Boolean(fresh.available) } });
  })
);

router.post(
  '/worker/availability',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    db.prepare('UPDATE worker_profiles SET available = ? WHERE user_id = ?').run(req.body?.available ? 1 : 0, req.user.id);
    res.json({ available: Boolean(req.body?.available) });
  })
);

/* -------------------------------- dashboard ------------------------------ */

router.get(
  '/worker/dashboard',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const p = profile(req.user.id);
    const role = workerRole(req);
    const column = role === 'rider' ? 'rider_id' : 'shopper_id';
    const active = db
      .prepare(
        `SELECT * FROM orders WHERE ${column} = ? AND status NOT IN ('completed','cancelled','refunded')
         ORDER BY created_at DESC`
      )
      .all(req.user.id);
    const completed = db
      .prepare(`SELECT * FROM orders WHERE ${column} = ? AND status IN ('completed','delivered') ORDER BY created_at DESC LIMIT 20`)
      .all(req.user.id);
    /*
     * The list of statuses a worker can act on is the same list acceptJob()
     * enforces — spelled out separately here, it drifted, and riders stopped
     * being shown the personal-shopping deliveries they were allowed to take.
     */
    const acceptable = acceptableFor(role);
    const offers = db
      .prepare(
        `SELECT j.id AS offer_id, j.created_at AS offered_at, o.* FROM job_offers j JOIN orders o ON o.id = j.order_id
         WHERE j.worker_id = ? AND j.role = ? AND j.status = 'offered'
           AND o.status IN (${acceptable.map(() => '?').join(',')})
           AND (o.scheduled_for IS NULL OR o.released_at IS NOT NULL)
         ORDER BY j.created_at DESC`
      )
      .all(req.user.id, role, ...acceptable);

    const wallet = walletBalance(req.user.id);
    const today = new Date().toISOString().slice(0, 10);
    const entries = db.prepare('SELECT * FROM wallet_entries WHERE user_id = ? AND created_at >= ?').all(req.user.id, `${today}T00:00`);
    const earningsToday = entries.filter((e) => e.type === 'credit').reduce((s, e) => s + e.amount, 0);

    res.json({
      profile: p ? { ...p, verified: Boolean(p.verified), available: Boolean(p.available) } : null,
      role,
      offers: offers.map((o) => ({
        ...o,
        address: JSON.parse(o.address_json || '{}'),
        item_count: db.prepare('SELECT COUNT(*) c FROM shopping_items WHERE order_id = ?').get(o.id).c,
        status_label: orderLabel(o.status),
      })),
      active: active.map((o) => publicOrder(o)),
      completed: completed.map((o) => publicOrder(o)),
      earnings: {
        wallet_balance: wallet,
        today: earningsToday,
        pending: active.length * 500,
        jobs_completed: completed.length,
      },
    });
  })
);

/* ---------------------------------- jobs --------------------------------- */

router.post(
  '/worker/jobs/:orderId/accept',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const role = req.body?.role || workerRole(req);
    const p = profile(req.user.id);
    if (!p?.verified) throw bad('Your account is still being verified. You cannot accept jobs yet.');
    if (!p.available) throw bad('You are offline. Go online to accept jobs.');
    const booked = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (booked && !isOpenForWork(booked)) {
      throw bad(`This one is booked for ${whenLabel(booked.scheduled_for)} — it opens about an hour before.`);
    }
    const order = acceptJob(req.params.orderId, req.user.id, role);
    audit(req, 'job.accept', 'order', order.id, { role });
    res.json({ order: publicOrder(order) });
  })
);

router.post(
  '/worker/jobs/:orderId/decline',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    declineJob(req.params.orderId, req.user.id, req.body?.role || workerRole(req));
    res.json({ ok: true });
  })
);

/** Manual "grab next job" — used when auto-offer is disabled. */
router.post(
  '/worker/jobs/pull',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const role = req.body?.role || workerRole(req);
    const targets = acceptableFor(role);
    const order = db
      .prepare(
        `SELECT * FROM orders WHERE status IN (${targets.map(() => '?').join(',')})
           AND (scheduled_for IS NULL OR released_at IS NOT NULL)
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(...targets);
    if (!order) return res.json({ order: null });
    offerJob(order.id, role);
    res.json({ offered: true });
  })
);

router.get(
  '/worker/jobs/:orderId',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? OR code = ?').get(req.params.orderId, String(req.params.orderId).toUpperCase());
    if (!order) throw notFound('Order not found');
    const assigned = [order.shopper_id, order.rider_id].includes(req.user.id);
    const offered = db.prepare('SELECT * FROM job_offers WHERE order_id = ? AND worker_id = ?').get(order.id, req.user.id);
    if (!assigned && !offered && req.user.role !== 'admin') throw forbidden();
    res.json({ order: publicOrder(order), assigned });
  })
);

/* ---------------------------- shopper: shopping --------------------------- */

router.post(
  '/worker/jobs/:orderId/start-shopping',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order || order.shopper_id !== req.user.id) throw forbidden('This task is not assigned to you.');
    if (order.status === 'shopper_assigned') {
      transition(order.id, 'shopping', { actor: req.user, actorRole: 'shopper', note: 'Shopper started shopping' });
    }
    if (req.body?.store_id) db.prepare('UPDATE orders SET store_id = ? WHERE id = ?').run(req.body.store_id, order.id);
    res.json({ order: publicOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)) });
  })
);

/** Record a found item, a substitution, or mark it unavailable. */
router.patch(
  '/worker/jobs/:orderId/items/:itemId',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order || order.shopper_id !== req.user.id) throw forbidden('This task is not assigned to you.');
    if (!['shopper_assigned', 'shopping', 'awaiting_approval'].includes(order.status)) throw bad('This order is not in a shopping state.');
    const item = db.prepare('SELECT * FROM shopping_items WHERE id = ? AND order_id = ?').get(req.params.itemId, order.id);
    if (!item) throw notFound('Item not found');

    const { proposed_name, proposed_price, proposed_qty, status, note, image } = req.body || {};
    const nextStatus = status || (proposed_price ? 'proposed' : item.status);
    db.prepare(
      `UPDATE shopping_items SET proposed_name = ?, proposed_price = ?, proposed_qty = ?, status = ?, note = ?, image = COALESCE(?, image), updated_at = ?
       WHERE id = ?`
    ).run(
      proposed_name ?? item.proposed_name,
      proposed_price != null ? Math.round(Number(proposed_price)) : item.proposed_price,
      proposed_qty != null ? Number(proposed_qty) : item.proposed_qty,
      nextStatus,
      note ?? item.note,
      image || null,
      now(),
      item.id
    );
    event(order.id, {
      actorId: req.user.id,
      actorRole: 'shopper',
      type: 'item_update',
      message: `${item.description} → ${nextStatus}${proposed_price ? ` at ₦${Number(proposed_price).toLocaleString()}` : ''}`,
    });
    res.json({ item: db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(item.id) });
  })
);

/** Shopper submits the basket for customer approval. */
router.post(
  '/worker/jobs/:orderId/submit-for-approval',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order || order.shopper_id !== req.user.id) throw forbidden('This task is not assigned to you.');
    const items = db.prepare('SELECT * FROM shopping_items WHERE order_id = ?').all(order.id);
    const proposed = items.filter((i) => ['proposed', 'unavailable', 'approved'].includes(i.status));
    if (!proposed.length) throw bad('Record at least one item price before requesting approval.');
    if (order.status === 'shopping') {
      transition(order.id, 'awaiting_approval', { actor: req.user, actorRole: 'shopper', note: 'Basket submitted for customer approval' });
    }
    res.json({ order: publicOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)) });
  })
);

/** Upload an item photo and/or purchase receipt (base64 data URL). */
router.post(
  '/worker/jobs/:orderId/receipts',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order || ![order.shopper_id, order.rider_id].includes(req.user.id)) throw forbidden('This task is not assigned to you.');
    requireFields(req.body || {}, ['data_url']);
    if (!/^data:(image|application)\//.test(req.body.data_url)) throw bad('Upload an image or PDF receipt.');
    if (req.body.data_url.length > 4_000_000) throw bad('That file is too large — keep receipts under 3 MB.');
    const id = uid('rcp');
    db.prepare('INSERT INTO receipts (id,order_id,uploaded_by,file_name,mime,data_url,amount,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
      id, order.id, req.user.id, req.body.file_name || 'receipt', req.body.data_url.slice(5, req.body.data_url.indexOf(';')),
      req.body.data_url, req.body.amount ? Math.round(Number(req.body.amount)) : null, req.body.note || null, now()
    );
    event(order.id, { actorId: req.user.id, actorRole: req.user.role, type: 'receipt', message: 'Purchase receipt uploaded' });
    notify(order.customer_id, { title: `Receipt uploaded — ${order.code}`, body: 'Your receipt is available in the order.', kind: 'order', orderId: order.id });
    res.status(201).json({ receipt: db.prepare('SELECT id,file_name,mime,amount,note,created_at FROM receipts WHERE id = ?').get(id) });
  })
);

/** Shopper: payment collected, items purchased. */
router.post(
  '/worker/jobs/:orderId/purchased',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order || order.shopper_id !== req.user.id) throw forbidden('This task is not assigned to you.');
    if (order.payment_status === 'pending') throw bad('Customer has not completed payment yet.');
    if (order.status === 'approved') {
      transition(order.id, 'purchased', { actor: req.user, actorRole: 'shopper', note: 'Items purchased — receipt uploaded' });
    }
    const afterPurchase = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    if (afterPurchase.status === 'purchased') {
      transition(order.id, 'ready_for_delivery', { actor: req.user, actorRole: 'shopper', note: 'Ready for delivery' });
      offerJob(order.id, 'rider');
    }
    res.json({ order: publicOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)) });
  })
);

/* ----------------------------- rider: delivery ---------------------------- */

router.post(
  '/worker/jobs/:orderId/pickup',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order || order.rider_id !== req.user.id) throw forbidden('This delivery is not assigned to you.');
    const updated = transition(order.id, 'picked_up', { actor: req.user, actorRole: 'rider', note: req.body?.note || 'Order picked up' });
    res.json({ order: publicOrder(updated) });
  })
);

router.post(
  '/worker/jobs/:orderId/in-transit',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order || order.rider_id !== req.user.id) throw forbidden('This delivery is not assigned to you.');
    const updated = transition(order.id, 'in_transit', { actor: req.user, actorRole: 'rider', note: req.body?.note || 'On the way to you' });
    res.json({ order: publicOrder(updated) });
  })
);

/**
 * The rider's phone reports where it is, so the customer's map shows the actual
 * bike on the actual street rather than a dot sliding along a straight line.
 *
 * Deliberately strict: only the rider assigned to this delivery can report, only
 * while the delivery is live, coordinates must be real numbers inside the valid
 * range, and one phone cannot flood the table — the newest fix is what the map
 * needs, extra ones only cost disk.
 */
const ACTIVE_DELIVERY = ['rider_assigned', 'picked_up', 'in_transit'];
const MIN_PING_GAP_MS = 1500;

router.post(
  '/worker/jobs/:orderId/location',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order || order.rider_id !== req.user.id) throw forbidden('This delivery is not assigned to you.');
    if (!ACTIVE_DELIVERY.includes(order.status)) throw bad('This delivery is not running any more.');

    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw bad('A latitude and longitude are required.');
    if (lat < -90 || lat > 90) throw bad('That latitude is not a place on Earth.');
    if (lng < -180 || lng > 180) throw bad('That longitude is not a place on Earth.');

    const accuracy = Number.isFinite(Number(req.body?.accuracy)) ? Math.max(0, Number(req.body.accuracy)) : null;
    const speed = Number.isFinite(Number(req.body?.speed)) ? Number(req.body.speed) : null;
    const heading = Number.isFinite(Number(req.body?.heading)) ? Number(req.body.heading) : null;

    const last = order.rider_updated_at ? new Date(order.rider_updated_at).getTime() : 0;
    if (last && Date.now() - last < MIN_PING_GAP_MS) {
      // not an error: the phone simply asked twice in quick succession
      return res.status(202).json({ ok: true, throttled: true, last_fix_at: order.rider_updated_at });
    }

    const at = now();
    db.prepare(
      'INSERT INTO rider_pings (id,order_id,rider_id,lat,lng,accuracy,speed,heading,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(uid('ping'), order.id, req.user.id, lat, lng, accuracy, speed, heading, at);
    db.prepare(
      'UPDATE orders SET rider_lat = ?, rider_lng = ?, rider_accuracy = ?, rider_updated_at = ?, updated_at = ? WHERE id = ?'
    ).run(lat, lng, accuracy, at, at, order.id);

    // keep a generous trail and nothing more
    db.prepare(
      `DELETE FROM rider_pings WHERE order_id = ? AND id NOT IN (
         SELECT id FROM rider_pings WHERE order_id = ? ORDER BY created_at DESC LIMIT 200
       )`
    ).run(order.id, order.id);

    res.status(201).json({ ok: true, at, lat, lng });
  })
);

/** Delivery requires the customer's PIN (or an admin override with a reason). */
router.post(
  '/worker/jobs/:orderId/deliver',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order || order.rider_id !== req.user.id) throw forbidden('This delivery is not assigned to you.');
    const pin = String(req.body?.pin || '');
    if (!pin) throw bad('Ask the customer for their 4-digit delivery PIN.');
    if (pin !== order.delivery_pin) {
      event(order.id, { actorId: req.user.id, actorRole: 'rider', type: 'pin_failed', message: 'Incorrect delivery PIN entered' });
      throw bad('That PIN does not match. Ask the customer again.');
    }
    const updated = transition(order.id, 'delivered', { actor: req.user, actorRole: 'rider', note: 'Delivered — PIN verified' });
    if (req.body?.photo) {
      db.prepare('INSERT INTO receipts (id,order_id,uploaded_by,file_name,mime,data_url,note,created_at) VALUES (?,?,?,?,?,?,?,?)').run(
        uid('rcp'), order.id, req.user.id, 'proof-of-delivery', 'image', String(req.body.photo).slice(0, 3_000_000), 'Proof of delivery', now()
      );
    }
    notify(order.customer_id, {
      title: `Delivered — ${order.code}`,
      body: 'Please confirm delivery to complete the order.',
      kind: 'action',
      orderId: order.id,
    });
    res.json({ order: publicOrder(updated) });
  })
);

/* -------------------------------- earnings -------------------------------- */

router.get(
  '/worker/earnings',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const entries = db
      .prepare("SELECT * FROM wallet_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 200")
      .all(req.user.id);
    const payouts = db.prepare('SELECT * FROM payouts WHERE worker_id = ? ORDER BY requested_at DESC').all(req.user.id);
    const nowD = new Date();
    const weekStart = new Date(nowD.getTime() - 7 * 864e5).toISOString();
    const monthStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1).toISOString();
    const sum = (from) =>
      entries.filter((e) => e.type === 'credit' && e.created_at >= from).reduce((s, e) => s + e.amount, 0);
    res.json({
      balance: walletBalance(req.user.id),
      entries,
      payouts,
      cash: req.user.role === 'rider' ? cashForRider(req.user.id) : { outstanding: 0, records: [] },
      summary: {
        today: sum(new Date().toISOString().slice(0, 10) + 'T00:00'),
        week: sum(weekStart),
        month: sum(monthStart),
        lifetime: entries.filter((e) => e.type === 'credit').reduce((s, e) => s + e.amount, 0),
      },
    });
  })
);

router.post(
  '/worker/payouts',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const amount = Math.round(Number(req.body?.amount || 0));
    if (amount < 1000) throw bad('Minimum withdrawal is ₦1,000.');

    /*
     * The money leaves the wallet here, not when the bank transfer happens.
     * Without this an earner with ₦5,000 could file five ₦5,000 requests — each
     * one looked affordable because nothing had been set aside — and the person
     * approving them had no way to see it.
     */
    const open = db
      .prepare("SELECT * FROM payouts WHERE worker_id = ? AND status IN ('requested','approved') ORDER BY requested_at DESC LIMIT 1")
      .get(req.user.id);
    if (open) {
      throw bad(
        `You already have a ₦${open.amount.toLocaleString()} withdrawal waiting (${open.status}). ` +
        'Wait for it to be paid, or ask support to cancel it.'
      );
    }

    const balance = walletBalance(req.user.id);
    /*
     * Earnings are withdrawn from the wallet, but cash-on-delivery money in a
     * rider's pocket is BUYBUDDY's, not theirs. Paying it out before it has been
     * handed over pays the same money twice, so it is held back — and the message
     * says exactly how much and why, with the number that is actually available.
     */
    const cashOwed = req.user.role === 'rider' ? cashForRider(req.user.id).outstanding : 0;
    const withdrawable = Math.max(0, balance - cashOwed);
    if (cashOwed > 0 && amount > withdrawable) {
      throw bad(
        `You are holding ₦${cashOwed.toLocaleString()} of cash from cash-on-delivery orders, so ₦${withdrawable.toLocaleString()} ` +
        `of your ₦${balance.toLocaleString()} is available to withdraw. Hand the cash over to BUYBUDDY and the full balance opens up.`
      );
    }
    if (amount > balance) throw bad(`You can withdraw up to ₦${balance.toLocaleString()}.`);
    const p = profile(req.user.id);
    if (!p?.account_number) throw bad('Add your bank account details before requesting a withdrawal.');

    const id = uid('po');
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO payouts (id,worker_id,amount,status,note,requested_at,held) VALUES (?,?,?,?,?,?,1)').run(
        id, req.user.id, amount, 'requested', req.body?.note || null, now()
      );
      walletEntry(req.user.id, {
        type: 'debit',
        amount,
        description: 'Withdrawal requested (held until paid)',
      });
    });
    tx();
    notify(req.user.id, {
      title: 'Withdrawal requested',
      body: `₦${amount.toLocaleString()} is set aside and pending approval.`,
      kind: 'payment',
    });
    res.status(201).json({ payout: db.prepare('SELECT * FROM payouts WHERE id = ?').get(id) });
  })
);

router.post(
  '/worker/jobs/:orderId/handover',
  requireAuth,
  workerOnly,
  asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order || order.shopper_id !== req.user.id) throw forbidden();
    const count = offerJob(order.id, 'rider');
    res.json({ offered_riders: count });
  })
);

export default router;
