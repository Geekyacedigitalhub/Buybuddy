import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { asyncHandler, bad, notFound, now, requireFields, uid } from '../lib/util.js';
import {
  ensureReferralCode,
  loyaltyRules,
  pointsBalance,
  pointsToDiscount,
  referralSummary,
  resolveReferrer,
} from '../lib/growth.js';

const router = Router();

/* -------------------------------- loyalty -------------------------------- */

router.get(
  '/loyalty',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare('SELECT * FROM loyalty_entries WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100')
      .all(req.user.id);
    const earned = rows.filter((r) => r.type === 'earn').reduce((s, r) => s + r.points, 0);
    const redeemed = rows.filter((r) => r.type === 'redeem').reduce((s, r) => s + Math.abs(r.points), 0);
    res.json({
      balance: pointsBalance(req.user.id),
      rules: loyaltyRules(),
      lifetime_earned: earned,
      lifetime_redeemed: redeemed,
      entries: rows,
    });
  })
);

router.post(
  '/loyalty/preview',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { points, subtotal = 0 } = req.body || {};
    const result = pointsToDiscount(req.user.id, points, Number(subtotal));
    res.json({ ...result, balance: pointsBalance(req.user.id) });
  })
);

/* -------------------------------- referrals ------------------------------- */

router.get(
  '/referrals',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(referralSummary(req.user.id));
  })
);

/** Public: lets the signup form confirm a code before submitting. */
router.post(
  '/referrals/validate',
  asyncHandler(async (req, res) => {
    const referrer = resolveReferrer(req.body?.code);
    if (!referrer) {
      // a friendly 200 keeps the signup form simple — an unknown code is not an error
      return res.json({ valid: false, message: 'That code does not look right — double-check it with your friend.' });
    }
    const first = referrer.name.split(' ')[0];
    res.json({ valid: true, referrer: first, message: `Invited by ${first} — you both get a reward after your first order.` });
  })
);

/* ------------------------------- saved lists ------------------------------ */

router.get(
  '/saved-lists',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = db.prepare('SELECT * FROM saved_lists WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
    res.json({
      lists: rows.map((r) => ({ ...r, items: JSON.parse(r.items_json), items_json: undefined })),
    });
  })
);

router.post(
  '/saved-lists',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireFields(req.body || {}, ['name']);
    const items = Array.isArray(req.body.items) ? req.body.items.filter((i) => String(i.description || '').trim()) : [];
    if (!items.length) throw bad('Add at least one item to save a list.');
    if (items.length > 40) throw bad('A saved list can contain up to 40 items.');
    const count = db.prepare('SELECT COUNT(*) c FROM saved_lists WHERE user_id = ?').get(req.user.id).c;
    if (count >= 20) throw bad('You can keep up to 20 saved lists. Delete one first.');

    const id = uid('lst');
    db.prepare('INSERT INTO saved_lists (id,user_id,name,items_json,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(
      id, req.user.id, String(req.body.name).slice(0, 60),
      JSON.stringify(items.map((i) => ({
        description: String(i.description).slice(0, 200),
        qty: Math.max(1, Number(i.qty || 1)),
        target_price: i.target_price ? Math.round(Number(i.target_price)) : null,
        note: i.note ? String(i.note).slice(0, 200) : null,
      }))),
      now(), now()
    );
    const row = db.prepare('SELECT * FROM saved_lists WHERE id = ?').get(id);
    res.status(201).json({ list: { ...row, items: JSON.parse(row.items_json) } });
  })
);

router.delete(
  '/saved-lists/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = db.prepare('DELETE FROM saved_lists WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!result.changes) throw notFound('Saved list not found');
    res.json({ ok: true });
  })
);

/* --------------------------- account snapshot ----------------------------- */

/** One call for the account screen: wallet, points, referral code. */
router.get(
  '/me/rewards',
  requireAuth,
  asyncHandler(async (req, res) => {
    const wallet = db
      .prepare('SELECT balance_after FROM wallet_entries WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(req.user.id);
    res.json({
      wallet_balance: wallet?.balance_after || 0,
      points: pointsBalance(req.user.id),
      loyalty: loyaltyRules(),
      referral_code: ensureReferralCode(req.user.id),
      referral: referralSummary(req.user.id),
    });
  })
);

export default router;
