import { db } from './db.js';
import { settingsAll, notify, walletEntry } from './settings.js';
import { bad, now, uid, slugify } from './util.js';

/* ========================================================================== *
 * LOYALTY POINTS
 * Append-only ledger, same shape as the wallet: balance is always derived from
 * the last row, so every point is reconcilable.
 * ========================================================================== */

export function pointsBalance(userId) {
  const row = db
    .prepare('SELECT balance_after FROM loyalty_entries WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(userId);
  return row ? row.balance_after : 0;
}

export function pointsEntry(userId, { type, points, orderId = null, description = '' }) {
  const amt = Math.round(Number(points));
  if (!amt) return pointsBalance(userId);
  const current = pointsBalance(userId);
  const next = current + amt;
  if (next < 0) throw bad('Not enough loyalty points for that redemption.');
  db.prepare(
    `INSERT INTO loyalty_entries (id,user_id,order_id,type,points,balance_after,description,created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(uid('loy'), userId, orderId, type, amt, next, description, now());
  return next;
}

export function loyaltyRules() {
  const s = settingsAll();
  return {
    enabled: s.loyalty_enabled,
    points_per_1000: s.loyalty_points_per_1000,
    naira_per_point: s.loyalty_naira_per_point,
    min_redeem: s.loyalty_min_redeem,
    max_redeem_percent: s.loyalty_max_redeem_percent,
  };
}

/** Converts a points request into a safe naira discount. Throws on abuse. */
export function pointsToDiscount(userId, points, subtotal) {
  const rules = loyaltyRules();
  if (!rules.enabled) throw bad('Loyalty points are currently unavailable.');
  const wanted = Math.max(0, Math.round(Number(points) || 0));
  if (!wanted) return { points: 0, discount: 0 };
  if (wanted < rules.min_redeem) throw bad(`You need at least ${rules.min_redeem} points to redeem.`);
  const balance = pointsBalance(userId);
  if (wanted > balance) throw bad(`You only have ${balance} points.`);
  const usable = Math.min(wanted, Math.floor((subtotal * rules.max_redeem_percent) / 100 / rules.naira_per_point));
  if (usable < rules.min_redeem) throw bad('That cart is too small to redeem points on.');
  return { points: usable, discount: usable * rules.naira_per_point };
}

/** Called when an order reaches `completed`. Idempotent per order. */
export function awardLoyalty(order) {
  const rules = loyaltyRules();
  if (!rules.enabled) return { points: 0 };
  const already = db.prepare("SELECT 1 FROM loyalty_entries WHERE order_id = ? AND type = 'earn'").get(order.id);
  if (already) return { points: 0, alreadyAwarded: true };
  // points are earned on the merchandise subtotal — never on delivery/service fees
  const base = order.approved_subtotal || order.subtotal || order.total;
  const points = Math.floor((base / 1000) * rules.points_per_1000);
  if (points <= 0) return { points: 0 };
  pointsEntry(order.customer_id, {
    type: 'earn',
    points,
    orderId: order.id,
    description: `Earned on order ${order.code}`,
  });
  db.prepare('UPDATE orders SET points_earned = ? WHERE id = ?').run(points, order.id);
  notify(order.customer_id, {
    title: `+${points} BUYBUDDY points`,
    body: `You earned ${points} points on ${order.code}. Redeem them at checkout.`,
    kind: 'loyalty',
    orderId: order.id,
  });
  return { points };
}

/* ========================================================================== *
 * REFERRALS
 * A customer shares a code; when the person they invited completes their very
 * first order, both sides are credited once. `referral_rewards.referee_id` is
 * UNIQUE, which makes double-crediting impossible at the database level.
 * ========================================================================== */

export function ensureReferralCode(userId) {
  const user = db.prepare('SELECT id, name, referral_code FROM users WHERE id = ?').get(userId);
  if (!user) throw bad('User not found');
  if (user.referral_code) return user.referral_code;
  let code = `${slugify(user.name.split(' ')[0] || 'buddy').slice(0, 8).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;
  while (db.prepare('SELECT 1 FROM users WHERE referral_code = ?').get(code)) {
    code = `${slugify(user.name.split(' ')[0] || 'buddy').slice(0, 8).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;
  }
  db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(code, userId);
  return code;
}

export function resolveReferrer(code) {
  if (!code) return null;
  return db
    .prepare('SELECT id, name, referral_code FROM users WHERE referral_code = ? COLLATE NOCASE OR referral_code = ?')
    .get(String(code).trim(), String(code).trim().toUpperCase()) || null;
}

export function referralSummary(userId) {
  const code = ensureReferralCode(userId);
  const invited = db
    .prepare('SELECT id, name, created_at FROM users WHERE referred_by = ? ORDER BY created_at DESC')
    .all(userId);
  const rewards = db.prepare('SELECT * FROM referral_rewards WHERE referrer_id = ? ORDER BY created_at DESC').all(userId);
  const rules = settingsAll();
  return {
    code,
    enabled: rules.referral_enabled,
    reward_referrer: rules.referral_referrer_reward,
    reward_referee: rules.referral_referee_reward,
    share_text: `Shop anything on BUYBUDDY and get ₦${rules.referral_referee_reward.toLocaleString()} off your first order with my code ${code}.`,
    invited: invited.length,
    qualified: rewards.length,
    earned: rewards.reduce((s, r) => s + r.referrer_amount, 0),
    invites: invited,
    rewards,
  };
}

export function linkReferral(newUserId, code) {
  const rules = settingsAll();
  if (!rules.referral_enabled || !code) return null;
  const referrer = resolveReferrer(code);
  if (!referrer) throw bad('That referral code is not valid.');
  if (referrer.id === newUserId) throw bad('You cannot refer yourself.');
  db.prepare('UPDATE users SET referred_by = ? WHERE id = ?').run(referrer.id, newUserId);
  notify(referrer.id, {
    title: 'Your invite joined BUYBUDDY 🎉',
    body: `${db.prepare('SELECT name FROM users WHERE id = ?').get(newUserId)?.name || 'A friend'} signed up with your code ${code}. You are credited when they complete their first order.`,
    kind: 'referral',
  });
  return referrer;
}

/** Credits both sides once, on the invitee's first completed order. */
export function rewardReferralIfEligible(order) {
  const rules = settingsAll();
  if (!rules.referral_enabled) return null;
  const customer = db.prepare('SELECT id, referred_by FROM users WHERE id = ?').get(order.customer_id);
  if (!customer?.referred_by) return null;
  if (db.prepare('SELECT 1 FROM referral_rewards WHERE referee_id = ?').get(customer.id)) return null;

  const completedBefore = db
    .prepare("SELECT COUNT(*) c FROM orders WHERE customer_id = ? AND status = 'completed' AND id != ?")
    .get(customer.id, order.id).c;
  if (completedBefore > 0) return null; // only the first completed order counts

  const referrerAmount = rules.referral_referrer_reward;
  const refereeAmount = rules.referral_referee_reward;
  db.prepare(
    'INSERT INTO referral_rewards (id,referrer_id,referee_id,order_id,referrer_amount,referee_amount,created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(uid('ref'), customer.referred_by, customer.id, order.id, referrerAmount, refereeAmount, now());

  walletEntry(customer.referred_by, {
    type: 'credit',
    amount: referrerAmount,
    orderId: order.id,
    description: 'Referral reward',
  });
  walletEntry(customer.id, {
    type: 'credit',
    amount: refereeAmount,
    orderId: order.id,
    description: 'Welcome referral bonus',
  });
  notify(customer.referred_by, {
    title: `Referral paid: ₦${referrerAmount.toLocaleString()}`,
    body: 'Your friend completed their first order. The bonus is in your wallet.',
    kind: 'referral',
  });
  notify(customer.id, {
    title: `Welcome bonus: ₦${refereeAmount.toLocaleString()}`,
    body: 'Added to your BUYBUDDY wallet. Enjoy!',
    kind: 'referral',
  });
  return { referrerAmount, refereeAmount };
}

/* ========================================================================== *
 * SCHEDULED DELIVERIES
 * ========================================================================== */

export function validateSchedule(scheduledFor) {
  if (!scheduledFor) return null;
  const s = settingsAll();
  if (!s.scheduling_enabled) throw bad('Scheduled deliveries are currently unavailable.');
  const when = new Date(scheduledFor);
  if (Number.isNaN(when.getTime())) throw bad('That delivery time is not a valid date.');
  const minHours = Number(s.scheduling_min_hours || 1);
  const minMs = minHours * 3600_000;
  const maxMs = s.scheduling_max_days * 864e5;
  const delta = when.getTime() - Date.now();
  if (delta < minMs) throw bad(`Schedule your delivery at least ${minHours} hour${minHours === 1 ? '' : 's'} from now.`);
  if (delta > maxMs) throw bad(`You can schedule up to ${s.scheduling_max_days} days ahead.`);
  return when.toISOString();
}

export const slaFor = (serviceLevel) => (serviceLevel === 'express' ? 30 : 60);
