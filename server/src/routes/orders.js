import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { asyncHandler, bad, fakePin, notFound, now, orderCode, paginate, requireFields, uid, forbidden } from '../lib/util.js';
import { notify, event, settingsAll, walletEntry, audit } from '../lib/settings.js';
import {
  calcFees,
  findPromo,
  offerJob,
  orderLabel,
  publicOrder,
  settleOrder,
  transition,
  eligibleWorkers,
  whenLabel,
  amountDue,
} from '../lib/orders.js';
import { initPayment, verifyPayment, refundPayment, verifyWalletTopup } from '../lib/payments.js';
import { pointsEntry, pointsToDiscount, validateSchedule } from '../lib/growth.js';
import { orderEvents } from '../lib/orders.js';

const router = Router();

/** Straight-line distance in kilometres — good enough for an ETA from GPS. */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Central authorisation check for a single order. */
export function canAccessOrder(user, order) {
  if (!user || !order) return false;
  if (user.role === 'admin') return true;
  if (order.customer_id === user.id) return true;
  if (order.shopper_id === user.id || order.rider_id === user.id) return true;
  if (user.role === 'merchant') {
    const store = db.prepare('SELECT merchant_id FROM stores WHERE id = ?').get(order.store_id);
    return store?.merchant_id === user.id;
  }
  return false;
}

function loadOrderForUser(req) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? OR code = ?').get(req.params.id, String(req.params.id).toUpperCase());
  if (!order) throw notFound('Order not found');
  if (!canAccessOrder(req.user, order)) throw forbidden();
  return order;
}

/* ------------------------------------------------------------------------ *
 * CHECKOUT — merchant cart
 * ------------------------------------------------------------------------ */

router.post(
  '/orders/checkout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const idempotencyKey = req.header('Idempotency-Key') || body.idempotency_key || null;
    if (idempotencyKey) {
      const dupe = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(idempotencyKey);
      if (dupe) {
        if (dupe.customer_id !== req.user.id) throw forbidden();
        return res.json({ order: publicOrder(dupe), replay: true });
      }
    }
    requireFields(body, ['address_id', 'payment_method']);

    const address = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(body.address_id, req.user.id);
    if (!address) throw bad('Choose a saved delivery address.');

    const cart = db
      .prepare(
        `SELECT ci.id, ci.qty, p.* FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = ?`
      )
      .all(req.user.id);
    if (!cart.length) throw bad('Your cart is empty.');
    const storeIds = [...new Set(cart.map((c) => c.store_id))];
    if (storeIds.length > 1) throw bad('Your cart contains items from more than one store.');
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(storeIds[0]);
    if (!store || store.status !== 'active') throw bad('This store is not accepting orders right now.');
    if (!store.is_open) throw bad(`${store.name} is closed right now. Try again during opening hours.`);

    for (const c of cart) {
      if (c.stock < c.qty) throw bad(`${c.name} only has ${c.stock} left in stock.`);
    }

    const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
    const settings = settingsAll();
    if (subtotal < settings.min_order_value) throw bad(`Minimum order value is ₦${settings.min_order_value.toLocaleString()}.`);
    if (subtotal < store.min_order) throw bad(`Minimum order for ${store.name} is ₦${store.min_order.toLocaleString()}.`);

    const promo = body.promo_code ? findPromo(body.promo_code) : null;
    const scheduledFor = validateSchedule(body.scheduled_for);
    const fees = calcFees({
      subtotal,
      type: 'merchant',
      serviceLevel: body.service_level || 'standard',
      distanceKm: 4.2,
      promo,
    });

    // loyalty redemption — validated against balance, minimum and % cap
    const loyalty = body.loyalty_points ? pointsToDiscount(req.user.id, body.loyalty_points, fees.subtotal) : { points: 0, discount: 0 };
    const discountTotal = fees.discount + loyalty.discount;
    const total = Math.max(0, fees.total - loyalty.discount);

    const id = uid('ord');
    const code = orderCode();
    const pin = fakePin();

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO orders (id,code,customer_id,type,store_id,status,subtotal,service_fee,delivery_fee,tax,discount,total,
          payment_method,payment_status,promo_code,address_json,notes,scheduled_for,service_level,delivery_pin,
          idempotency_key,distance_km,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        id, code, req.user.id, 'merchant', store.id, 'pending_payment',
        fees.subtotal, fees.serviceFee, fees.deliveryFee, fees.tax, discountTotal, total,
        body.payment_method, 'pending', promo?.code || null,
        JSON.stringify({
          label: address.label, line1: address.line1, area: address.area, city: address.city,
          recipient: address.recipient, phone: address.phone, notes: address.notes,
          lat: address.lat, lng: address.lng,
        }),
        body.notes || null, scheduledFor, body.service_level || 'standard', pin,
        idempotencyKey, 4.2, now(), now()
      );
      for (const c of cart) {
        db.prepare('INSERT INTO order_items (id,order_id,product_id,name,price,qty,image,status) VALUES (?,?,?,?,?,?,?,?)').run(
          uid('oit'), id, c.id, c.name, c.price, c.qty, c.image, 'active'
        );
        db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?').run(c.qty, c.id);
      }
      db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
      if (promo) {
        db.prepare('UPDATE promos SET used_count = used_count + 1 WHERE code = ?').run(promo.code);
      }
      if (loyalty.points) {
        pointsEntry(req.user.id, {
          type: 'redeem', points: -loyalty.points, orderId: id,
          description: `Redeemed ${loyalty.points} points on order ${code}`,
        });
        db.prepare('UPDATE orders SET points_redeemed = ? WHERE id = ?').run(loyalty.points, id);
        event(id, { actorId: req.user.id, actorRole: 'customer', type: 'loyalty_redeemed', message: `${loyalty.points} points = ₦${loyalty.discount.toLocaleString()} off` });
      }
      event(id, { actorId: req.user.id, actorRole: 'customer', type: 'created', message: `Order placed with ${store.name}` });
      notify(store.merchant_id, {
        title: scheduledFor ? `Booked order ${code}` : `New order ${code}`,
        body: scheduledFor
          ? `${cart.length} item(s) — ₦${fees.total.toLocaleString()}, delivery ${whenLabel(scheduledFor)}. We will nudge you about an hour before so it arrives hot.`
          : `${cart.length} item(s) — ₦${fees.total.toLocaleString()}. Accept to start preparing.`,
        kind: 'order',
        orderId: id,
      });
    });
    tx();

    let order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    order.__email = req.user.email;
    const payment = await initPayment(order, { method: body.payment_method });
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);

    res.status(201).json({ order: publicOrder(order), payment });
  })
);

/* ------------------------------------------------------------------------ *
 * PERSONAL SHOPPING REQUEST ("Shop for me")
 * ------------------------------------------------------------------------ */

router.post(
  '/shopping/requests',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const idempotencyKey = req.header('Idempotency-Key') || body.idempotency_key || null;
    if (idempotencyKey) {
      const dupe = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(idempotencyKey);
      if (dupe) return res.json({ order: publicOrder(dupe), replay: true });
    }
    requireFields(body, ['address_id', 'payment_method']);
    const items = Array.isArray(body.items) ? body.items.filter((i) => String(i.description || '').trim()) : [];
    if (!items.length) throw bad('Add at least one item you would like us to buy.');
    if (items.length > 40) throw bad('Please split lists larger than 40 items into separate requests.');

    const address = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(body.address_id, req.user.id);
    if (!address) throw bad('Choose a saved delivery address.');

    const estimated = items.reduce(
      (sum, i) => sum + Math.round(Number(i.target_price || 0)) * Math.max(1, Number(i.qty || 1)),
      0
    );
    const budget = Math.round(Number(body.budget || estimated || 0));
    if (budget < 1000) throw bad('Set a budget of at least ₦1,000 so your shopper knows the limit.');
    const subtotal = estimated || budget;

    const settings = settingsAll();
    const promo = body.promo_code ? findPromo(body.promo_code) : null;
    const scheduledFor = validateSchedule(body.scheduled_for);
    const fees = calcFees({
      subtotal,
      type: 'personal',
      serviceLevel: body.service_level || 'standard',
      distanceKm: 4.6,
      promo,
    });
    settings.min_order_value;

    const id = uid('ord');
    const code = orderCode();
    const pin = fakePin();

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO orders (id,code,customer_id,type,store_id,status,subtotal,service_fee,delivery_fee,tax,discount,total,
          payment_method,payment_status,promo_code,address_json,notes,instructions,budget,service_level,delivery_pin,
          idempotency_key,distance_km,created_at,updated_at,scheduled_for)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        id, code, req.user.id, 'personal', body.store_id || null, 'pending_payment',
        fees.subtotal, fees.serviceFee, fees.deliveryFee, fees.tax, fees.discount, fees.total,
        body.payment_method, 'pending', promo?.code || null,
        JSON.stringify({
          label: address.label, line1: address.line1, area: address.area, city: address.city,
          recipient: address.recipient, phone: address.phone, notes: address.notes, lat: address.lat, lng: address.lng,
        }),
        body.notes || null, body.instructions || null, budget, body.service_level || 'standard', pin,
        idempotencyKey, 4.6, now(), now(), scheduledFor
      );
      for (const i of items) {
        db.prepare(
          `INSERT INTO shopping_items (id,order_id,description,qty,target_price,image,status,note,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).run(
          uid('sit'), id, String(i.description).trim(), Math.max(1, Number(i.qty || 1)),
          i.target_price ? Math.round(Number(i.target_price)) : null, i.image || null, 'requested', i.note || null, now()
        );
      }
      if (promo) db.prepare('UPDATE promos SET used_count = used_count + 1 WHERE code = ?').run(promo.code);
      event(id, { actorId: req.user.id, actorRole: 'customer', type: 'created', message: `Shopping request created — ${items.length} item(s)` });
    });
    tx();

    let order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    order.__email = req.user.email;
    const payment = await initPayment(order, { method: body.payment_method });
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);

    res.status(201).json({ order: publicOrder(order), payment });
  })
);

/** Customer reviews the shopper's proposals and approves / rejects each item. */
router.post(
  '/orders/:id/approvals',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(req);
    if (order.customer_id !== req.user.id) throw forbidden('Only the customer can approve items.');
    if (order.status !== 'awaiting_approval') throw bad('There is nothing to approve on this order.');
    const decisions = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!decisions.length) throw bad('Choose at least one item to approve or reject.');

    const tx = db.transaction(() => {
      for (const d of decisions) {
        const item = db.prepare('SELECT * FROM shopping_items WHERE id = ? AND order_id = ?').get(d.id, order.id);
        if (!item) continue;
        if (item.status !== 'proposed') continue;
        const status = d.action === 'approve' ? 'approved' : 'rejected';
        db.prepare('UPDATE shopping_items SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), item.id);
      }
      const rows = db.prepare('SELECT * FROM shopping_items WHERE order_id = ?').all(order.id);
      const approvedSubtotal = rows
        .filter((r) => r.status === 'approved')
        .reduce((s, r) => s + (r.proposed_price || r.target_price || 0) * (r.proposed_qty || r.qty), 0);
      const pending = rows.filter((r) => r.status === 'proposed').length;
      db.prepare('UPDATE orders SET approved_subtotal = ?, subtotal = ?, updated_at = ? WHERE id = ?').run(
        approvedSubtotal, approvedSubtotal, now(), order.id
      );
      event(order.id, {
        actorId: req.user.id, actorRole: 'customer', type: 'items_approved',
        message: `${decisions.length} item(s) reviewed — approved total ₦${approvedSubtotal.toLocaleString()}`,
      });

      if (!pending) {
        const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
        const fees = calcFees({ subtotal: approvedSubtotal, type: 'personal', serviceLevel: fresh.service_level, distanceKm: fresh.distance_km || 4.6 });
        const delta = fees.total - fresh.total;
        db.prepare(
          'UPDATE orders SET service_fee = ?, delivery_fee = ?, tax = ?, total = ?, updated_at = ? WHERE id = ?'
        ).run(fees.serviceFee, fees.deliveryFee, fees.tax, fees.total, now(), order.id);
        if (delta > 0) {
          db.prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?').run('pending', now(), order.id);
          event(order.id, { actorRole: 'system', type: 'adjustment_due', message: `Additional ₦${delta.toLocaleString()} authorisation required` });
          notify(order.customer_id, {
            title: `Extra payment needed — ${order.code}`,
            body: `Your approved basket costs ₦${delta.toLocaleString()} more. Complete payment so shopping can continue.`,
            kind: 'action', orderId: order.id,
          });
          return;
        }
        if (delta < 0) {
          walletEntry(order.customer_id, { type: 'credit', amount: -delta, orderId: order.id, description: `Price difference refund — ${order.code}` });
        }
        transition(order.id, 'approved', { actor: req.user, actorRole: 'customer', note: 'Customer approved the basket' });
        notify(fresh.shopper_id, { title: `Basket approved — ${order.code}`, body: 'You can buy the approved items now.', kind: 'job', orderId: order.id });
      } else {
        event(order.id, { actorId: req.user.id, actorRole: 'customer', type: 'approval_partial', message: `${pending} item(s) still awaiting your decision` });
      }
    });
    tx();
    res.json({ order: publicOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)) });
  })
);

/** Extra authorisation for a personal-shopping price increase. */
router.post(
  '/orders/:id/adjustment-payment',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(req);
    if (order.customer_id !== req.user.id) throw forbidden();
    const paid = db
      .prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE order_id = ? AND status = 'success'")
      .get(order.id).total;
    const due = order.total - paid;
    if (due <= 0) throw bad('Nothing left to pay on this order.');
    const payment = await initPayment({ ...order, total: due, __email: req.user.email }, { method: req.body?.payment_method || 'paystack' });
    res.json({ payment, due });
  })
);

/* ------------------------------------------------------------------------ *
 * READ
 * ------------------------------------------------------------------------ */

router.get(
  '/orders',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = paginate(req, 20);
    const { status, type } = req.query;
    const where = ['customer_id = ?'];
    const params = [req.user.id];
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (type) {
      where.push('type = ?');
      params.push(type);
    }
    const rows = db
      .prepare(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) c FROM orders WHERE ${where.join(' AND ')}`).get(...params).c;
    res.json({
      orders: rows.map((o) => {
        const store = o.store_id ? db.prepare('SELECT id,name,logo,area FROM stores WHERE id = ?').get(o.store_id) : null;
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
        const sItems = db.prepare('SELECT * FROM shopping_items WHERE order_id = ?').all(o.id);
        return {
          ...o,
          store,
          items,
          shopping_items: sItems,
          status_label: orderLabel(o.status),
          item_count: items.reduce((n, i) => n + i.qty, 0) || sItems.length,
        };
      }),
      total,
      page,
    });
  })
);

router.get(
  '/orders/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(req);
    const messages = db
      .prepare(
        `SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.order_id = ? ORDER BY m.created_at`
      )
      .all(order.id);
    const receipts = db.prepare('SELECT * FROM receipts WHERE order_id = ? ORDER BY created_at').all(order.id);
    const payment = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(order.id);
    res.json({
      order: publicOrder(order, { includePrivate: order.customer_id === req.user.id }),
      messages,
      receipts,
      payment,
      delivery_pin: order.customer_id === req.user.id ? order.delivery_pin : undefined,
    });
  })
);

/** Tracking feed for the live map. */
router.get(
  '/orders/:id/tracking',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(req);
    const active = ['rider_assigned', 'picked_up', 'in_transit'].includes(order.status);
    const rider = order.rider_id ? db.prepare('SELECT id,name,phone FROM users WHERE id = ?').get(order.rider_id) : null;
    const address = order.address_json ? JSON.parse(order.address_json) : {};
    // Simulated progressive position; a live deployment streams the rider GPS.
    const progress = { rider_assigned: 0, picked_up: 0.25, in_transit: 0.65, delivered: 1 }[order.status] ?? 0;
    // Real coordinates where we have them: the shop's location, the customer's
    // saved address, and the rider's live GPS once the rider app reports it.
    const store = order.store_id ? db.prepare('SELECT id,name,lat,lng FROM stores WHERE id = ?').get(order.store_id) : null;
    const from = store?.lat
      ? { lat: store.lat, lng: store.lng }
      : { lat: 6.4478, lng: 3.4723 };
    const to = address.lat && address.lng
      ? { lat: address.lat, lng: address.lng }
      : { lat: 6.6018, lng: 3.3515 };
    const estimated = { lat: from.lat + (to.lat - from.lat) * progress, lng: from.lng + (to.lng - from.lng) * progress };

    /**
     * A GPS fix is only worth showing while it is fresh. If the rider's phone
     * went quiet two minutes ago, a confident dot in the wrong place is worse
     * than an honest estimate — so the map falls back and says so.
     */
    const GPS_FRESH_MS = 120_000;
    const fixAge = order.rider_updated_at ? Date.now() - new Date(order.rider_updated_at).getTime() : null;
    const gpsLive = active && order.rider_lat != null && order.rider_lng != null && fixAge != null && fixAge <= GPS_FRESH_MS;

    const trail = gpsLive
      ? db
          .prepare('SELECT lat,lng,created_at FROM rider_pings WHERE order_id = ? ORDER BY created_at ASC LIMIT 200')
          .all(order.id)
      : [];

    const rider_position = !active
      ? null
      : gpsLive
        ? { lat: order.rider_lat, lng: order.rider_lng }
        : estimated;

    // With a real fix we can quote a distance-based ETA; without one, fall back
    // to the progress estimate.
    let eta = active ? Math.max(2, Math.round(18 * (1 - progress))) : null;
    if (gpsLive) {
      const km = haversineKm(order.rider_lat, order.rider_lng, to.lat, to.lng);
      const minutes = Math.round((km / 18) * 60) + 2; // 18 km/h through Lagos traffic, plus handover time
      eta = Math.max(1, Math.min(minutes, 120));
    }

    res.json({
      active,
      status: order.status,
      progress: gpsLive ? Math.max(0, Math.min(1, 1 - haversineKm(order.rider_lat, order.rider_lng, to.lat, to.lng) / Math.max(0.2, haversineKm(from.lat, from.lng, to.lat, to.lng)))) : progress,
      rider,
      rider_position,
      position_source: gpsLive ? 'gps' : 'estimated',
      accuracy_m: gpsLive ? order.rider_accuracy : null,
      last_fix_seconds_ago: fixAge != null && gpsLive ? Math.round(fixAge / 1000) : null,
      trail: trail.map((t) => ({ lat: t.lat, lng: t.lng, at: t.created_at })),
      pickup: { lat: from.lat, lng: from.lng, label: store?.name || 'Store' },
      destination: { lat: to.lat, lng: to.lng, label: address.line1 || 'Delivery address' },
      eta_minutes: eta,
      distance_km: gpsLive ? Number(haversineKm(order.rider_lat, order.rider_lng, to.lat, to.lng).toFixed(2)) : null,
    });
  })
);

router.get(
  '/orders/:id/events',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(req);
    res.json({ events: orderEvents(order.id) });
  })
);

/* ------------------------------------------------------------------------ *
 * CUSTOMER ACTIONS
 * ------------------------------------------------------------------------ */

router.post(
  '/orders/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(req);
    if (order.customer_id !== req.user.id) throw forbidden();
    const cancellable = [
      'pending_payment', 'paid', 'open_for_shoppers', 'accepted', 'shopper_assigned',
      'shopping', 'awaiting_approval', 'ready_for_pickup',
    ];
    if (!cancellable.includes(order.status)) throw bad('This order can no longer be cancelled. Contact support for help.');

    const tx = db.transaction(() => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      for (const i of items) if (i.product_id) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(i.qty, i.product_id);
      db.prepare('UPDATE orders SET cancel_reason = ?, updated_at = ? WHERE id = ?').run(req.body?.reason || 'Cancelled by customer', now(), order.id);
      transition(order.id, 'cancelled', { actor: req.user, actorRole: 'customer', note: req.body?.reason || 'Cancelled by customer' });
      if (order.points_redeemed) {
        pointsEntry(req.user.id, {
          type: 'adjust', points: order.points_redeemed, orderId: order.id,
          description: `Points returned — ${order.code} cancelled`,
        });
      }
      if (['paid', 'paid_cash'].includes(order.payment_status)) {
        refundPayment(order.id, { amount: order.total, reason: 'Order cancelled by customer', actor: req.user, returnPoints: false });
      }
    });
    tx();
    audit(req, 'order.cancel', 'order', order.id, { code: order.code });
    res.json({ order: publicOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)) });
  })
);

router.post(
  '/orders/:id/confirm-delivery',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(req);
    if (order.customer_id !== req.user.id) throw forbidden();
    if (order.status !== 'delivered') throw bad('This order has not been marked delivered yet.');
    transition(order.id, 'completed', { actor: req.user, actorRole: 'customer', note: 'Delivery confirmed by customer' });
    settleOrder(order.id);
    res.json({ order: publicOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)) });
  })
);

router.post(
  '/orders/:id/review',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(req);
    if (order.customer_id !== req.user.id) throw forbidden();
    if (!['delivered', 'completed'].includes(order.status)) throw bad('You can rate an order after delivery.');
    const rating = Math.max(1, Math.min(5, Number(req.body?.rating || 5)));
    const { comment } = req.body || {};
    const targets = [];
    if (order.store_id) targets.push({ type: 'store', id: order.store_id });
    if (order.shopper_id) targets.push({ type: 'shopper', id: order.shopper_id });
    if (order.rider_id) targets.push({ type: 'rider', id: order.rider_id });

    const tx = db.transaction(() => {
      for (const t of targets) {
        const exists = db.prepare("SELECT 1 FROM reviews WHERE order_id = ? AND target_type = ?").get(order.id, t.type);
        if (exists) continue;
        db.prepare(
          'INSERT INTO reviews (id,order_id,customer_id,target_type,target_id,rating,comment,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
        ).run(uid('rev'), order.id, req.user.id, t.type, t.id, rating, comment || null, 'published', now());

        if (t.type === 'store') {
          const agg = db.prepare("SELECT AVG(rating) a, COUNT(*) c FROM reviews WHERE target_type='store' AND target_id = ? AND status='published'").get(t.id);
          db.prepare('UPDATE stores SET rating_avg = ?, rating_count = ? WHERE id = ?').run(Number(agg.a.toFixed(2)), agg.c, t.id);
        } else {
          const agg = db.prepare("SELECT AVG(rating) a, COUNT(*) c FROM reviews WHERE target_type = ? AND target_id = ? AND status='published'").get(t.type, t.id);
          db.prepare('UPDATE worker_profiles SET rating_avg = ?, rating_count = ? WHERE user_id = ?').run(Number(agg.a.toFixed(2)), agg.c, t.id);
        }
      }
      event(order.id, { actorId: req.user.id, actorRole: 'customer', type: 'rated', message: `Rated ${rating}★` });
    });
    tx();
    res.json({ ok: true, rating });
  })
);

/* ------------------------------ messaging -------------------------------- */

router.get(
  '/orders/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(req);
    const messages = db
      .prepare(
        `SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.order_id = ? ORDER BY m.created_at`
      )
      .all(order.id);
    res.json({ messages });
  })
);

router.post(
  '/orders/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(req);
    requireFields(req.body || {}, ['body']);
    const id = uid('msg');
    db.prepare('INSERT INTO messages (id,order_id,sender_id,sender_role,body,created_at) VALUES (?,?,?,?,?,?)').run(
      id, order.id, req.user.id, req.user.role, String(req.body.body).slice(0, 2000), now()
    );
    const recipients = new Set([order.customer_id, order.shopper_id, order.rider_id].filter(Boolean));
    if (order.store_id) {
      const store = db.prepare('SELECT merchant_id FROM stores WHERE id = ?').get(order.store_id);
      if (store) recipients.add(store.merchant_id);
    }
    recipients.delete(req.user.id);
    for (const r of recipients) {
      notify(r, { title: `New message — ${order.code}`, body: String(req.body.body).slice(0, 120), kind: 'message', orderId: order.id });
    }
    res.status(201).json({ message: db.prepare('SELECT * FROM messages WHERE id = ?').get(id) });
  })
);

/* ------------------------------------------------------------------------ *
 * PAYMENTS
 * ------------------------------------------------------------------------ */

router.post(
  '/orders/:id/pay',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(req);
    if (order.customer_id !== req.user.id) throw forbidden();
    /*
     * Charge what is still owed, not the whole total again. A "shop for me"
     * basket that grew after approval has already been paid in part — sending the
     * full price would take the customer's money twice for one order.
     */
    const due = amountDue(order);
    if (due <= 0 || ['paid', 'paid_cash'].includes(order.payment_status)) throw bad('This order is already paid.');
    const payment = await initPayment(
      { ...order, total: due, __email: req.user.email },
      { method: req.body?.payment_method || order.payment_method }
    );
    res.json({ payment, order: publicOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)) });
  })
);

router.post(
  '/payments/:reference/verify',
  requireAuth,
  asyncHandler(async (req, res) => {
    const topup = await verifyWalletTopup(req.params.reference);
    if (topup) return res.json({ ...topup, topup: true, order: null });
    const result = await verifyPayment(req.params.reference);
    const payment = db.prepare('SELECT * FROM payments WHERE reference = ?').get(req.params.reference);
    const order = payment ? db.prepare('SELECT * FROM orders WHERE id = ?').get(payment.order_id) : null;
    if (order && !canAccessOrder(req.user, order)) throw forbidden();
    res.json({ ...result, order: order ? publicOrder(order) : null });
  })
);

/* ------------------------------ reorder ---------------------------------- */

router.post(
  '/orders/:id/reorder',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(req);
    if (order.customer_id !== req.user.id) throw forbidden();
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    if (!items.length) throw bad('This order has no products to reorder.');
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
    let added = 0;
    for (const i of items) {
      const p = i.product_id ? db.prepare('SELECT * FROM products WHERE id = ? AND status = ?').get(i.product_id, 'active') : null;
      if (!p || p.stock < 1) continue;
      db.prepare('INSERT INTO cart_items (id,user_id,product_id,qty,created_at) VALUES (?,?,?,?,?)').run(
        uid('crt'), req.user.id, p.id, Math.min(i.qty, p.stock), now()
      );
      added += 1;
    }
    if (!added) throw bad('None of these items are available right now.');
    res.json({ added });
  })
);

/* ----------------------- jobs offered to this worker --------------------- */

router.get(
  '/offers',
  requireAuth,
  asyncHandler(async (req, res) => {
    const role = req.query.role || (req.user.role === 'rider' ? 'rider' : 'shopper');
    const offers = db
      .prepare(
        `SELECT j.*, o.code, o.type, o.total, o.subtotal, o.budget, o.delivery_fee, o.service_fee, o.status AS order_status,
                o.address_json, o.created_at AS order_created_at, o.service_level
         FROM job_offers j JOIN orders o ON o.id = j.order_id
         WHERE j.worker_id = ? AND j.role = ? AND j.status = 'offered' AND o.status IN ('open_for_shoppers','ready_for_pickup')
         ORDER BY j.created_at DESC`
      )
      .all(req.user.id, role);
    res.json({
      offers: offers.map((o) => ({
        ...o,
        address: JSON.parse(o.address_json || '{}'),
        address_json: undefined,
        items: db.prepare('SELECT * FROM shopping_items WHERE order_id = ?').all(o.order_id),
      })),
    });
  })
);

export default router;
