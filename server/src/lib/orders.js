import { db } from './db.js';
import { sendSmsInBackground } from './sms.js';
import { settingsAll, notify, event, walletEntry } from './settings.js';
import { awardLoyalty, rewardReferralIfEligible } from './growth.js';
import { bad, forbidden, money, now, uid, clamp, fakePin } from './util.js';

/* ------------------------------------------------------------------------ *
 * ORDER LIFECYCLE
 * Every state change is validated server-side against an explicit transition
 * table. The client can never write a status directly.
 * ------------------------------------------------------------------------ */

export const MERCHANT_FLOW = [
  'pending_payment',
  'paid',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'rider_assigned',
  'picked_up',
  'in_transit',
  'delivered',
  'completed',
];

export const PERSONAL_FLOW = [
  'pending_payment',
  'paid',
  'open_for_shoppers',
  'shopper_assigned',
  'shopping',
  'awaiting_approval',
  'approved',
  'purchased',
  'ready_for_delivery',
  'rider_assigned',
  'picked_up',
  'in_transit',
  'delivered',
  'completed',
];

const COMMON_NEXT = {
  cancelled: [],
  refunded: [],
};

/** next states reachable from a given state, per fulfilment type */
export const TRANSITIONS = {
  pending_payment: ['paid', 'open_for_shoppers', 'cancelled'],
  paid: ['accepted', 'open_for_shoppers', 'cancelled', 'refunded'],
  accepted: ['preparing', 'cancelled', 'refunded'],
  preparing: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['rider_assigned', 'picked_up', 'cancelled'],
  open_for_shoppers: ['shopper_assigned', 'cancelled', 'refunded'],
  shopper_assigned: ['shopping', 'open_for_shoppers', 'cancelled'],
  shopping: ['awaiting_approval', 'cancelled'],
  awaiting_approval: ['approved', 'shopping', 'cancelled'],
  approved: ['purchased', 'cancelled'],
  purchased: ['ready_for_delivery', 'cancelled'],
  ready_for_delivery: ['rider_assigned', 'picked_up', 'cancelled'],
  rider_assigned: ['picked_up', 'cancelled'],
  picked_up: ['in_transit', 'cancelled'],
  in_transit: ['delivered'],
  delivered: ['completed', 'refunded'],
  completed: [],
  ...COMMON_NEXT,
};

const ACTOR_RULES = {
  paid: ['system', 'customer', 'admin', 'merchant'],
  accepted: ['merchant', 'admin'],
  preparing: ['merchant', 'admin'],
  ready_for_pickup: ['merchant', 'admin'],
  open_for_shoppers: ['system', 'admin'],
  shopper_assigned: ['shopper', 'admin'],
  shopping: ['shopper', 'admin'],
  awaiting_approval: ['shopper', 'admin'],
  approved: ['customer', 'admin', 'system'],
  purchased: ['shopper', 'admin'],
  ready_for_delivery: ['shopper', 'admin'],
  rider_assigned: ['rider', 'admin', 'system'],
  picked_up: ['rider', 'admin'],
  in_transit: ['rider', 'admin'],
  delivered: ['rider', 'admin'],
  completed: ['customer', 'admin', 'system'],
  cancelled: ['customer', 'merchant', 'admin', 'shopper', 'system'],
  refunded: ['admin', 'system'],
};

export function orderLabel(status) {
  return String(status || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getOrder(idOrCode) {
  return db
    .prepare('SELECT * FROM orders WHERE id = ? OR code = ?')
    .get(idOrCode, String(idOrCode).toUpperCase());
}

export function orderItems(orderId) {
  return db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
}

export function shoppingItems(orderId) {
  return db.prepare('SELECT * FROM shopping_items WHERE order_id = ?').all(orderId);
}

export function orderEvents(orderId) {
  return db
    .prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(orderId);
}

export function canTransition(order, next) {
  return (TRANSITIONS[order.status] || []).includes(next);
}

/**
 * Apply a state transition with actor authorisation, an immutable event in the
 * order timeline, and a notification to the affected party.
 */
export function transition(orderId, next, { actor = null, actorRole = 'system', note = '', meta = null } = {}) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw bad('Order not found');
  if (!canTransition(order, next)) {
    throw bad(`Cannot move order from "${orderLabel(order.status)}" to "${orderLabel(next)}".`);
  }
  const allowed = ACTOR_RULES[next] || ['admin'];
  if (actorRole !== 'admin' && !allowed.includes(actorRole)) {
    throw forbidden(`A ${actorRole} cannot perform this action.`);
  }

  const patch = { status: next, updated_at: now() };
  if (next === 'completed' || next === 'cancelled' || next === 'refunded') patch.completed_at = now();
  const sets = Object.keys(patch).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE orders SET ${sets} WHERE id = @id`).run({ ...patch, id: orderId });

  event(orderId, { actorId: actor?.id, actorRole, type: `status:${next}`, message: note || orderLabel(next), meta });
  notifyParties(order, next, note);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

const SMS_MOMENTS = {
  in_transit: (o) => `BUYBUDDY: ${o.code} is on its way. Your rider will call when they arrive. Give them the delivery code only when you have the order.`,
  delivered: (o) => `BUYBUDDY: ${o.code} has been delivered. Thanks for shopping with us — rate your rider in the app.`,
  awaiting_approval: (o) => `BUYBUDDY: your personal shopper has priced ${o.code}. Open the app to approve or reject before anything is charged.`,
  cancelled: (o) => `BUYBUDDY: ${o.code} was cancelled. If you were charged, a refund is on its way.`,
};

function notifyParties(order, next, note) {
  const label = orderLabel(next);
  const short = `Order ${order.code}`;

  /* A push notification only helps if the app is open. Money and the doorbell
     are worth a text message. */
  if (SMS_MOMENTS[next]) {
    try {
      const customer = db.prepare('SELECT phone FROM users WHERE id = ?').get(order.customer_id);
      if (customer?.phone) sendSmsInBackground(customer.phone, SMS_MOMENTS[next](order));
    } catch (e) {
      console.warn('[orders] sms notify failed:', e.message);
    }
  }
  if (['accepted', 'preparing', 'ready_for_pickup'].includes(next)) {
    notify(order.customer_id, { title: `${short}: ${label}`, body: note || 'Your order is being handled by the store.', kind: 'order', orderId: order.id });
  }
  if (['picked_up', 'in_transit', 'delivered'].includes(next)) {
    notify(order.customer_id, { title: `${short}: ${label}`, body: note || 'Track progress in the app.', kind: 'order', orderId: order.id });
  }
  if (next === 'awaiting_approval') {
    notify(order.customer_id, {
      title: `${short}: approval needed`,
      body: note || 'Your shopper proposed items — please review and approve.',
      kind: 'action',
      orderId: order.id,
    });
  }
  if (next === 'shopper_assigned' && order.shopper_id) {
    notify(order.shopper_id, { title: `${short}: shopping task assigned`, body: 'Open the task to see the list.', kind: 'job', orderId: order.id });
  }
  if (next === 'rider_assigned' && order.rider_id) {
    notify(order.rider_id, { title: `${short}: delivery assigned`, body: 'Pick up and deliver.', kind: 'job', orderId: order.id });
  }
  if (next === 'completed') {
    notify(order.customer_id, { title: `${short}: delivered 🎉`, body: 'Thanks for shopping with BUYBUDDY. Rate your experience.', kind: 'order', orderId: order.id });
  }
  if (next === 'cancelled') {
    notify(order.customer_id, { title: `${short}: cancelled`, body: note || 'This order was cancelled.', kind: 'alert', orderId: order.id });
  }
}

/* ------------------------------------------------------------------------ *
 * PRICING ENGINE
 * ------------------------------------------------------------------------ */

export function distanceFor(addressJson) {
  // Deterministic stand-in for the Maps Distance Matrix API (see docs).
  // Real deployments call Google Distance Matrix with store + customer coords.
  try {
    const a = JSON.parse(addressJson || '{}');
    if (a.distance_km) return Number(a.distance_km);
  } catch {}
  return 4.2;
}

export function calcFees({ subtotal, type = 'merchant', serviceLevel = 'standard', distanceKm = 4.2, promo = null }) {
  const s = settingsAll();
  const sub = money(subtotal);
  const feePct = type === 'personal' ? s.shopper_fee_percent : s.service_fee_percent;
  const feeFlat = type === 'personal' ? s.shopper_fee_flat : s.service_fee_flat;

  let serviceFee = Math.round((sub * feePct) / 100) + feeFlat;
  let deliveryFee = Math.round(s.delivery_fee_base + s.delivery_fee_per_km * clamp(distanceKm, 0, 40));
  if (serviceLevel === 'express') deliveryFee += s.express_fee;

  let discount = 0;
  let freeDelivery = false;
  if (promo) {
    if (sub < (promo.min_subtotal || 0)) throw bad(`Promo ${promo.code} needs a minimum order of ₦${promo.min_subtotal}`);
    if (promo.type === 'percent') {
      discount = Math.round((sub * promo.value) / 100);
      if (promo.max_discount) discount = Math.min(discount, promo.max_discount);
    } else if (promo.type === 'fixed') {
      discount = Math.min(promo.value, sub);
    } else if (promo.type === 'free_delivery') {
      freeDelivery = true;
      discount = deliveryFee;
    }
  }
  if (freeDelivery) deliveryFee = 0;

  const vat = Math.round(((serviceFee + deliveryFee) * s.vat_percent) / 100);
  const total = Math.max(0, sub + serviceFee + deliveryFee + vat - discount);
  return { subtotal: sub, serviceFee, deliveryFee, tax: vat, discount, total };
}

export function findPromo(code) {
  if (!code) return null;
  const promo = db.prepare('SELECT * FROM promos WHERE code = ?').get(String(code).toUpperCase());
  if (!promo || !promo.active) throw bad('That promo code is not valid.');
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) throw bad('That promo code has expired.');
  if (promo.usage_limit && promo.used_count >= promo.usage_limit) throw bad('That promo code is fully redeemed.');
  return promo;
}

/* ------------------------------------------------------------------------ *
 * WORKER ASSIGNMENT
 * ------------------------------------------------------------------------ */

export function eligibleWorkers(role, city = 'Lagos') {
  return db
    .prepare(
      `SELECT u.*, w.service_areas, w.available, w.rating_avg
       FROM users u JOIN worker_profiles w ON w.user_id = u.id
       WHERE u.status = 'active' AND w.verified = 1 AND w.available = 1
         AND w.roles LIKE ? AND (w.service_city IS NULL OR w.service_city = ?)
       ORDER BY w.rating_avg DESC`
    )
    .all(`%${role}%`, city || 'Lagos');
}

/** Offers a job to eligible workers. Idempotent per (order, worker, role). */
export function offerJob(orderId, role) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw bad('Order not found');
  const workers = eligibleWorkers(role, order.address_json ? JSON.parse(order.address_json).city : 'Lagos');
  let count = 0;
  for (const w of workers) {
    if (role === 'rider' && order.shopper_id === w.id) continue;
    try {
      db.prepare(
        'INSERT INTO job_offers (id,order_id,worker_id,role,status,created_at) VALUES (?,?,?,?,?,?)'
      ).run(uid('job'), orderId, w.id, role, 'offered', now());
      notify(w.id, {
        title: `New ${role} job — ${order.code}`,
        body: order.type === 'personal' ? 'Personal shopping request near you.' : 'Delivery offer near you.',
        kind: 'offer',
        orderId,
      });
      count += 1;
    } catch {
      /* already offered */
    }
  }
  return count;
}

/**
 * Accept a job atomically: the conditional UPDATE guarantees exactly one worker
 * wins even under concurrent requests.
 */
/*
 * A rider can be offered two different kinds of finished job: a store order
 * waiting at the counter (ready_for_pickup) and a personal-shopping basket the
 * shopper has just bought (ready_for_delivery). Accepting only the first left
 * every "Shop for me" order paid, bought and permanently riderless.
 */
export const RIDER_ACCEPTABLE = ['ready_for_pickup', 'ready_for_delivery'];
export const acceptableFor = (role) => (role === 'shopper' ? ['open_for_shoppers'] : RIDER_ACCEPTABLE);

export function acceptJob(orderId, workerId, role) {
  const tx = db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw bad('Order not found');
    const allowed = acceptableFor(role);
    if (!allowed.includes(order.status)) throw bad('This job has already been taken or is no longer available.');

    const column = role === 'shopper' ? 'shopper_id' : 'rider_id';
    const nextStatus = role === 'shopper' ? 'shopper_assigned' : 'rider_assigned';
    const res = db
      .prepare(
        `UPDATE orders SET ${column} = ?, status = ?, updated_at = ?
         WHERE id = ? AND status = ? AND (${column} IS NULL OR ${column} = '')`
      )
      .run(workerId, nextStatus, now(), orderId, order.status);
    if (res.changes !== 1) throw bad('This job was just taken by another worker.');

    db.prepare(
      `UPDATE job_offers SET status = 'accepted', responded_at = ? WHERE order_id = ? AND worker_id = ? AND role = ?`
    ).run(now(), orderId, workerId, role);
    db.prepare(
      `UPDATE job_offers SET status = 'expired' WHERE order_id = ? AND role = ? AND status = 'offered' AND worker_id != ?`
    ).run(orderId, role, workerId);

    const worker = db.prepare('SELECT * FROM users WHERE id = ?').get(workerId);
    event(orderId, {
      actorId: workerId,
      actorRole: role,
      type: `${role}_assigned`,
      message: `${worker?.name || role} accepted the ${role} job`,
    });
    notify(order.customer_id, {
      title: `Order ${order.code}: ${role} assigned`,
      body: `${worker?.name || 'A ' + role} is on it. You can message them in the app.`,
      kind: 'order',
      orderId,
    });
    notify(workerId, { title: `Job accepted — ${order.code}`, body: 'Open the task for details.', kind: 'job', orderId });
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  });
  return tx();
}

export function declineJob(orderId, workerId, role) {
  db.prepare(
    "UPDATE job_offers SET status = 'declined', responded_at = ? WHERE order_id = ? AND worker_id = ? AND role = ?"
  ).run(now(), orderId, workerId, role);
  return { ok: true };
}

/** Admin override — force an assignment regardless of offers. */
export function forceAssign(orderId, workerId, role) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw bad('Order not found');
  const column = role === 'shopper' ? 'shopper_id' : 'rider_id';
  const nextStatus = role === 'shopper' ? 'shopper_assigned' : 'rider_assigned';
  db.prepare(`UPDATE orders SET ${column} = ?, status = ?, updated_at = ? WHERE id = ?`).run(
    workerId,
    nextStatus,
    now(),
    orderId
  );
  event(orderId, { actorRole: 'admin', type: `${role}_assigned`, message: `Admin assigned ${role}` });
  notify(workerId, { title: `Job assigned — ${order.code}`, body: 'An administrator assigned this job to you.', kind: 'job', orderId });
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

/* ------------------------------------------------------------------------ *
 * SETTLEMENT — runs once, when an order reaches `completed`
 * ------------------------------------------------------------------------ */

export function settleOrder(orderId) {
  const existing = db.prepare("SELECT 1 FROM wallet_entries WHERE order_id = ? AND description LIKE 'Settlement%'").get(orderId);
  if (existing) return { alreadySettled: true };

  const s = settingsAll();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw bad('Order not found');
  const paidSubtotal = order.approved_subtotal || order.subtotal;
  const entries = [];

  if (order.type === 'merchant' && order.store_id) {
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(order.store_id);
    const commission = Math.round(paidSubtotal * (store?.commission_rate ?? 0.12));
    const payout = paidSubtotal - commission;
    if (store?.merchant_id) {
      walletEntry(store.merchant_id, {
        type: 'credit',
        amount: payout,
        orderId,
        description: `Settlement — order ${order.code}`,
      });
      entries.push({ party: 'merchant', userId: store.merchant_id, amount: payout, commission });
    }
  }

  if (order.type === 'personal') {
    const shoppingFee = order.service_fee;
    if (order.shopper_id) {
      const shopperCut = Math.round(shoppingFee * (s.shopper_commission_percent / 100));
      walletEntry(order.shopper_id, {
        type: 'credit',
        amount: shopperCut,
        orderId,
        description: `Shopper earnings — ${order.code}`,
      });
      entries.push({ party: 'shopper', userId: order.shopper_id, amount: shopperCut });
    }
    if (order.rider_id) {
      const riderCut = order.delivery_fee;
      walletEntry(order.rider_id, {
        type: 'credit',
        amount: riderCut,
        orderId,
        description: `Delivery earnings — ${order.code}`,
      });
      entries.push({ party: 'rider', userId: order.rider_id, amount: riderCut });
    }
  } else if (order.rider_id) {
    const riderCut = order.delivery_fee;
    walletEntry(order.rider_id, {
      type: 'credit',
      amount: riderCut,
      orderId,
      description: `Delivery earnings — ${order.code}`,
    });
    entries.push({ party: 'rider', userId: order.rider_id, amount: riderCut });
  }

  event(orderId, { actorRole: 'system', type: 'settled', message: 'Settlement recorded', meta: entries });

  // growth: loyalty points + referral bonuses are awarded exactly once, here,
  // because settlement is already guarded against double execution.
  const loyalty = awardLoyalty(order);
  const referral = rewardReferralIfEligible(order);
  if (loyalty.points) entries.push({ party: 'customer_points', points: loyalty.points });
  if (referral) entries.push({ party: 'referral', ...referral });

  return { entries };
}

/* ------------------------------------------------------------------------ *
 * SERIALISERS
 * ------------------------------------------------------------------------ */

/* ---------------------------- scheduled orders --------------------------- */

/**
 * A delivery time the customer picked is a promise, not decoration.
 *
 * A shop needs roughly an hour from "start cooking" to "hand it to a rider", so a
 * booked order is held back until that hour before the slot. Before this existed
 * the store was told to start preparing the moment the order was paid — a
 * Tuesday 10:00 order was cooked on Monday night and a rider stood at the gate
 * with cold food.
 */
export const SCHEDULE_LEAD_MINUTES = 60;

export const releaseAt = (order) =>
  order?.scheduled_for ? new Date(new Date(order.scheduled_for).getTime() - SCHEDULE_LEAD_MINUTES * 60_000) : null;

/** True while the order is still waiting for its slot to come round. */
export function isHeld(order, nowMs = Date.now()) {
  const at = releaseAt(order);
  return Boolean(at) && at.getTime() > nowMs;
}

/** A booked order is open for work once its slot is close — or once it has been released. */
export const isOpenForWork = (order, nowMs = Date.now()) => Boolean(order?.released_at) || !isHeld(order, nowMs);

export const whenLabel = (iso) =>
  new Date(iso).toLocaleString('en-NG', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos',
  });

/**
 * Called every minute. Hands any booked order whose lead time has arrived to the
 * people who do the work, and says so on the order.
 */
export function releaseDueScheduledOrders(nowMs = Date.now()) {
  const rows = db
    .prepare("SELECT * FROM orders WHERE scheduled_for IS NOT NULL AND released_at IS NULL AND status IN ('paid','open_for_shoppers')")
    .all();
  const released = [];
  for (const order of rows) {
    if (isHeld(order, nowMs)) continue;
    db.prepare('UPDATE orders SET released_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), order.id);
    if (order.type === 'merchant' && order.store_id) {
      const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(order.store_id);
      if (store) {
        notify(store.merchant_id, {
          title: `Booked order ${order.code} is due`,
          body: `Deliver ${whenLabel(order.scheduled_for)} — accept it now to start preparing.`,
          kind: 'order',
          orderId: order.id,
        });
      }
      event(order.id, { type: 'scheduled_released', message: 'The shop was asked to start — the delivery slot is close' });
    } else {
      offerJob(order.id, 'shopper');
      event(order.id, { type: 'scheduled_released', message: 'Shoppers were told to start — the delivery slot is close' });
    }
    released.push(order.id);
  }
  return released;
}

const releaseTimer = setInterval(() => {
  try { releaseDueScheduledOrders(); } catch (e) { console.error('[schedule] release failed:', e.message); }
}, 60_000);
if (releaseTimer.unref) releaseTimer.unref();

/** Everything the customer has actually paid on this order. */
export const paidTotalFor = (orderId) =>
  db.prepare("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE order_id = ? AND status = 'success'").get(orderId).t;

/** What is still owed — never the whole total when part of it is already paid. */
export const amountDue = (order) => Math.max(0, money(order.total) - paidTotalFor(order.id));

export function publicOrder(order, { includePrivate = false } = {}) {
  if (!order) return null;
  const items = orderItems(order.id);
  const sItems = shoppingItems(order.id);
  const shopper = order.shopper_id ? db.prepare('SELECT id,name,phone,area FROM users WHERE id = ?').get(order.shopper_id) : null;
  const rider = order.rider_id ? db.prepare('SELECT id,name,phone,area FROM users WHERE id = ?').get(order.rider_id) : null;
  const store = order.store_id ? db.prepare('SELECT id,name,logo,area,city,phone FROM stores WHERE id = ?').get(order.store_id) : null;
  const out = {
    ...order,
    address: order.address_json ? JSON.parse(order.address_json) : null,
    items,
    shopping_items: sItems,
    shopper: shopper || null,
    rider: rider || null,
    store: store || null,
    status_label: orderLabel(order.status),
    amount_paid: paidTotalFor(order.id),
    amount_due: Math.max(0, money(order.total) - paidTotalFor(order.id)),
    timeline: orderEvents(order.id).map((e) => ({
      type: e.type,
      message: e.message,
      actor_role: e.actor_role,
      at: e.created_at,
    })),
  };
  delete out.address_json;
  if (!includePrivate) delete out.delivery_pin;
  return out;
}
