import { db } from './db.js';
import { now, uid, money, bad } from './util.js';

/** Platform configuration is data, not code — admins can change it at runtime. */
export const DEFAULT_SETTINGS = {
  platform_name: 'BUYBUDDY',
  currency: 'NGN',
  service_fee_percent: 5,
  service_fee_flat: 150,
  shopper_fee_percent: 8,
  shopper_fee_flat: 300,
  delivery_fee_base: 700,
  delivery_fee_per_km: 120,
  express_fee: 900,
  vat_percent: 7.5,
  min_order_value: 1500,
  shopper_commission_percent: 80,
  rider_fee_base: 650,
  rider_fee_per_km: 90,
  cod_enabled: true,
  wallet_enabled: true,
  paystack_enabled: true,
  flutterwave_enabled: false,
  auto_offer_jobs: true,
  offer_radius_km: 12,
  supported_cities: 'Lagos',
  cancellation_window_minutes: 5,
  max_cart_quantity: 50,
  support_email: 'support@buybuddy.ng',
  support_phone: '+234 700 289 2899',
  // ---- growth ----
  loyalty_enabled: true,
  loyalty_points_per_1000: 5,      // points earned per ₦1,000 spent
  loyalty_naira_per_point: 1,      // value of one point when redeemed
  loyalty_min_redeem: 200,
  loyalty_max_redeem_percent: 20,  // never discount more than 20% of the basket
  referral_enabled: true,
  referral_referrer_reward: 1000,
  referral_referee_reward: 500,
  scheduling_enabled: true,
  scheduling_max_days: 7,
  scheduling_min_hours: 1,     // earliest bookable window
};

export function settingsAll() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    const def = DEFAULT_SETTINGS[r.key];
    if (typeof def === 'number') out[r.key] = Number(r.value);
    else if (typeof def === 'boolean') out[r.key] = r.value === 'true' || r.value === '1';
    else out[r.key] = r.value;
  }
  return out;
}

export function getSetting(key) {
  return settingsAll()[key];
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, typeof value === 'boolean' ? String(value) : String(value));
}

export function ensureDefaults() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k);
    if (!exists) setSetting(k, v);
  }
}

/* --------------------------- notifications ------------------------------ */

export function notify(userId, { title, body, kind = 'info', orderId = null }) {
  if (!userId) return;
  db.prepare(
    'INSERT INTO notifications (id,user_id,title,body,kind,order_id,created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(uid('ntf'), userId, title, body || '', kind, orderId, now());
}

export function event(orderId, { actorId = null, actorRole = null, type, message = '', meta = null }) {
  db.prepare(
    `INSERT INTO order_events (id,order_id,actor_id,actor_role,type,message,meta,created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(uid('evt'), orderId, actorId, actorRole, type, message, meta ? JSON.stringify(meta) : null, now());
}

export function audit(req, action, entity, entityId, meta) {
  db.prepare(
    `INSERT INTO audit_logs (id,actor_id,actor_email,action,entity,entity_id,meta,ip,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    uid('aud'),
    req.user?.id || null,
    req.user?.email || null,
    action,
    entity,
    entityId || null,
    meta ? JSON.stringify(meta) : null,
    req.ip || null,
    now()
  );
}

/* ------------------------------- wallet --------------------------------- */

export function walletBalance(userId) {
  const row = db
    .prepare('SELECT balance_after FROM wallet_entries WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(userId);
  return row ? row.balance_after : 0;
}

export function walletEntry(userId, { type, amount, orderId = null, description = '' }) {
  const amt = money(amount);
  if (amt <= 0) return null;
  const current = walletBalance(userId);
  const next = type === 'credit' ? current + amt : current - amt;
  if (next < 0) throw bad('Insufficient wallet balance');
  db.prepare(
    `INSERT INTO wallet_entries (id,user_id,order_id,type,amount,balance_after,description,created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(uid('wlt'), userId, orderId, type, amt, next, description, now());
  return next;
}
