/**
 * CASH ON DELIVERY — where the money actually is.
 *
 * A cash order is money the rider is holding, not money BUYBUDDY has. Settlement
 * still credits the shop and the rider from the wallet, so without a record of
 * the notes in the rider's pocket the platform quietly pays everyone out of
 * nothing and has no way to ask for the cash back.
 *
 * The rider keeps their delivery fee. Everything else they collected — the shop's
 * money, the service fee, tax — has to come back to BUYBUDDY, so that is the
 * number this ledger tracks: `total - delivery_fee`.
 *
 * A refund on a cash order is already in the customer's wallet by the time we
 * get here, so the amount the rider owes drops by exactly that much.
 */
import { db } from './db.js';
import { notify } from './settings.js';
import { money, now, uid } from './util.js';

const TABLE = `
CREATE TABLE IF NOT EXISTS cod_cash (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  rider_id TEXT,
  collected INTEGER NOT NULL DEFAULT 0,
  refunded INTEGER NOT NULL DEFAULT 0,
  remitted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cleared')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cleared_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cod_rider ON cod_cash(rider_id);
`;

let ready = false;
function ensure() {
  if (ready) return;
  db.exec(TABLE);
  ready = true;
}

/**
 * A restore replaces orders with the backup's orders, which leaves cash records
 * pointing at orders that no longer exist — phantom money somebody would be
 * chased for. Drop those before anything reads the ledger.
 */
function purgeOrphans() {
  try {
    db.prepare('DELETE FROM cod_cash WHERE order_id NOT IN (SELECT id FROM orders)').run();
  } catch (e) {
    console.warn('[cash] orphan purge failed:', e.message);
  }
}

const outstandingOf = (r) => Math.max(0, r.collected - r.refunded - r.remitted);

/**
 * Called the moment a cash order is delivered. Idempotent: one record per order,
 * because a double delivery tap must not double what the rider owes.
 */
export function openCashRecord(orderId) {
  ensure();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.payment_status !== 'paid_cash') return null;

  const existing = db.prepare('SELECT * FROM cod_cash WHERE order_id = ?').get(orderId);
  if (existing) return existing;

  const collected = Math.max(0, money(order.total) - money(order.delivery_fee));
  const id = uid('cod');
  const ts = now();
  db.prepare(
    'INSERT INTO cod_cash (id,order_id,rider_id,collected,refunded,remitted,status,created_at,updated_at) VALUES (?,?,?,?,0,0,?,?,?)'
  ).run(id, orderId, order.rider_id || null, collected, 'open', ts, ts);

  if (order.rider_id) {
    notify(order.rider_id, {
      title: `Cash to hand over — ${order.code}`,
      body: `You collected ₦${collected.toLocaleString()} in cash. Your ₦${money(order.delivery_fee).toLocaleString()} delivery fee stays with you; hand the rest to BUYBUDDY.`,
      kind: 'payment',
      orderId,
    });
  }
  return db.prepare('SELECT * FROM cod_cash WHERE id = ?').get(id);
}

/** Refunds on cash orders reduce what the rider still owes us. */
export function applyRefundToCash(orderId, amount) {
  ensure();
  const row = db.prepare('SELECT * FROM cod_cash WHERE order_id = ?').get(orderId);
  if (!row) return 0;
  const applied = Math.min(outstandingOf(row), Math.max(0, money(amount)));
  if (applied <= 0) return numeric(row.refunded);
  db.prepare('UPDATE cod_cash SET refunded = refunded + ?, updated_at = ? WHERE id = ?').run(applied, now(), row.id);
  db.prepare('UPDATE cod_cash SET status = ? WHERE id = ?').run(outstandingOf(db.prepare('SELECT * FROM cod_cash WHERE id = ?').get(row.id)) <= 0 ? 'cleared' : 'open', row.id);
  return applied;
}

const numeric = (v) => Number(v || 0);

export function cashForRider(riderId) {
  ensure();
  const rows = db
    .prepare('SELECT * FROM cod_cash WHERE rider_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(riderId)
    .map((r) => {
      const order = db.prepare('SELECT code FROM orders WHERE id = ?').get(r.order_id);
      return {
        id: r.id,
        order_id: r.order_id,
        code: order?.code || null,
        collected: numeric(r.collected),
        refunded: numeric(r.refunded),
        remitted: numeric(r.remitted),
        outstanding: outstandingOf(r),
        status: r.status,
        created_at: r.created_at,
        cleared_at: r.cleared_at,
      };
    });
  const outstanding = rows.reduce((s, r) => s + (r.status === 'open' ? r.outstanding : 0), 0);
  purgeOrphans();
  return { outstanding, records: rows };
}

export function listCash() {
  ensure();
  purgeOrphans();
  const rows = db
    .prepare(
      `SELECT c.*, o.code, u.name AS rider_name, u.phone AS rider_phone
       FROM cod_cash c
       LEFT JOIN orders o ON o.id = c.order_id
       LEFT JOIN users u ON u.id = c.rider_id
       ORDER BY (c.status = 'open') DESC, c.created_at DESC`
    )
    .all()
    .map((r) => ({ ...r, outstanding: outstandingOf(r), collected: numeric(r.collected), refunded: numeric(r.refunded), remitted: numeric(r.remitted) }));
  return { outstanding_total: rows.filter((r) => r.status === 'open').reduce((s, r) => s + r.outstanding, 0), records: rows };
}

/** Admin confirms the cash reached BUYBUDDY. */
export function clearCash(id, { note = '' } = {}) {
  ensure();
  const row = db.prepare('SELECT * FROM cod_cash WHERE id = ?').get(id);
  if (!row) return null;
  if (row.status === 'cleared') return { alreadyCleared: true, record: row };
  const amount = outstandingOf(row);
  db.prepare(
    "UPDATE cod_cash SET remitted = remitted + ?, status = 'cleared', note = ?, cleared_at = ?, updated_at = ? WHERE id = ?"
  ).run(amount, String(note || '').slice(0, 300), now(), now(), row.id);
  if (row.rider_id) {
    const order = db.prepare('SELECT code FROM orders WHERE id = ?').get(row.order_id);
    notify(row.rider_id, {
      title: 'Cash received — thank you',
      body: `BUYBUDDY has marked ₦${amount.toLocaleString()} for ${order?.code || 'your delivery'} as handed over. Nothing left to settle on that order.`,
      kind: 'payment',
      orderId: row.order_id,
    });
  }
  return { cleared: amount, record: db.prepare('SELECT * FROM cod_cash WHERE id = ?').get(id) };
}
