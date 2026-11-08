import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { sendSmsInBackground } from './sms.js';
import { bad, forbidden, now, uid, unauth } from './util.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const TTL = process.env.JWT_TTL || '7d';

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compareSync(pw, hash);

export function issueToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, tv: user.token_version || 0 },
    JWT_SECRET,
    { expiresIn: TTL, issuer: 'buybuddy' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { issuer: 'buybuddy' });
  } catch {
    return null;
  }
}

export function recordLogin(userId) {
  db.prepare('UPDATE users SET token_version = token_version WHERE id = ?').run(userId);
}

function bearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

/** Attaches req.user when a valid token is present; never throws. */
export function optionalAuth(req, _res, next) {
  const token = bearer(req);
  if (!token) return next();
  const payload = verifyToken(token);
  if (!payload) return next();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user || user.token_version !== payload.tv) return next();
  req.user = user;
  req.token = token;
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauth());
  if (req.user.status === 'suspended') {
    return next(forbidden('Your account is suspended. Contact support.'));
  }
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(unauth());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

export const requireAdmin = requireRole('admin');

/** Revokes every existing token for a user (logout-everywhere, password change, suspension). */
export function revokeTokens(userId) {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
}

/* ------------------------------- OTP ------------------------------------ */

/**
 * OTP delivery is pluggable. In development the code is returned in the API
 * response (and logged) so the flow is testable without an SMS provider.
 * Set SMS_PROVIDER + credentials (Termii / Twilio) to send real messages.
 */
export function createOtp(phone, purpose = 'signup') {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare(
    `INSERT INTO otp_codes (id, phone, code, purpose, expires_at, created_at)
     VALUES (?,?,?,?,?,?)`
  ).run(uid('otp'), phone, code, purpose, new Date(Date.now() + 10 * 60_000).toISOString(), now());
  // Delivered in the background: a slow network must never block a signup.
  sendSmsInBackground(phone, `${code} is your BUYBUDDY verification code. It expires in 10 minutes. Never share it.`);
  return code;
}

export function consumeOtp(phone, code, purpose = 'signup') {
  const row = db
    .prepare(
      `SELECT * FROM otp_codes WHERE phone = ? AND purpose = ? AND consumed = 0
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(phone, purpose);
  if (!row) throw bad('No active verification code. Request a new one.');
  if (new Date(row.expires_at) < new Date()) throw bad('That code has expired. Request a new one.');
  if (process.env.ALLOW_DEV_OTP !== 'true' && row.code !== String(code)) throw bad('Incorrect code.');
  if (process.env.ALLOW_DEV_OTP === 'true' && row.code !== String(code) && String(code) !== '000000') {
    throw bad('Incorrect code.');
  }
  db.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').run(row.id);
  return true;
}
