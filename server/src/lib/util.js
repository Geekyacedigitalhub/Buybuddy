import crypto from 'node:crypto';

export const now = () => new Date().toISOString();
export const naira = (koboOrNaira) => Number(koboOrNaira || 0);

/** All money is stored as an integer number of Naira (no kobo floats). */
export const money = (v) => Math.round(Number(v || 0));

export function uid(prefix = '') {
  const raw = crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, '').slice(0, 12);
  return prefix ? `${prefix}_${raw}` : raw;
}

export function orderCode() {
  const n = crypto.randomInt(100000, 999999);
  return `BB-${new Date().getFullYear().toString().slice(2)}${String(n)}`;
}

export class ApiError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code || 'error';
    this.details = details;
  }
}

export const bad = (msg, details) => new ApiError(400, msg, 'bad_request', details);
export const unauth = (msg = 'Sign in to continue') => new ApiError(401, msg, 'unauthorized');
export const forbidden = (msg = 'You do not have access to this resource') => new ApiError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found') => new ApiError(404, msg, 'not_found');

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function paginate(req, defaultLimit = 20, max = 100) {
  const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(req.query.limit || String(defaultLimit), 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw bad(`Missing required field(s): ${missing.join(', ')}`, { missing });
}

export function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, token_version, ...rest } = u;
  return rest;
}

/** Nigerian phone numbers -> normalised +2347XXXXXXXXX. Accepts 0703..., +234..., 234... */
export function normalisePhone(input) {
  if (!input) return null;
  const digits = String(input).replace(/[^\d+]/g, '');
  let local = digits.replace(/^\+/, '');
  if (local.startsWith('234')) local = local.slice(3);
  else if (local.startsWith('0')) local = local.slice(1);
  if (!/^[789][01]\d{8}$/.test(local)) return null;
  return `+234${local}`;
}

export const fakePin = () => String(crypto.randomInt(1000, 9999));

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function maskEmail(email) {
  if (!email) return '';
  const [a, b] = email.split('@');
  return `${a.slice(0, 2)}${'*'.repeat(Math.max(1, a.length - 2))}@${b}`;
}

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function hmacSha512(secret, payload) {
  return crypto.createHmac('sha512', secret).update(payload).digest('hex');
}
