import crypto from 'node:crypto';

/* ========================================================================== *
 * RATE LIMITING
 * Fixed-window counters in process memory. Fine for a single instance; the
 * `store` interface is intentionally tiny so a Redis implementation can drop
 * in unchanged when the API scales horizontally.
 * ========================================================================== */

const buckets = new Map();

const memoryStore = {
  hit(key, windowMs) {
    const nowMs = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= nowMs) {
      const fresh = { count: 1, resetAt: nowMs + windowMs };
      buckets.set(key, fresh);
      return fresh;
    }
    bucket.count += 1;
    return bucket;
  },
  reset(key) {
    buckets.delete(key);
  },
};

// periodic sweep so the map cannot grow without bound
const sweeper = setInterval(() => {
  const nowMs = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= nowMs) buckets.delete(key);
}, 60_000);
if (sweeper.unref) sweeper.unref();

/**
 * @param {object} opts
 * @param {number} opts.windowMs  window length
 * @param {number} opts.max       allowed requests per window
 * @param {string} opts.name      label used in headers/logs
 * @param {(req)=>string} [opts.key]  defaults to IP
 * @param {boolean} [opts.skipSuccessful] only count failed (e.g. login) attempts
 */
export function rateLimit({ windowMs, max, name, key, skipSuccessful = false }) {
  return (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === 'true') return next();
    const identity = key ? key(req) : (req.ip || req.socket?.remoteAddress || 'unknown');
    const bucketKey = `${name}:${identity}`;
    const bucket = memoryStore.hit(bucketKey, windowMs);
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - Date.now()) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `Too many requests. Please wait ${retryAfter}s and try again.`,
        code: 'rate_limited',
        retry_after: retryAfter,
      });
    }

    if (skipSuccessful) {
      res.on('finish', () => {
        // successful attempts should not burn the allowance
        if (res.statusCode < 400) {
          const b = buckets.get(bucketKey);
          if (b && b.count > 0) b.count -= 1;
        }
      });
    }
    next();
  };
}

export const limiterPresets = {
  // only *failed* sign-ins burn the allowance, so normal usage never locks out
  auth: { name: 'auth', windowMs: 15 * 60_000, max: 20, skipSuccessful: true },
  otp: { name: 'otp', windowMs: 60 * 60_000, max: 8 },
  payment: { name: 'payment', windowMs: 60_000, max: 20 },
  checkout: { name: 'checkout', windowMs: 60_000, max: 12 },
  write: { name: 'write', windowMs: 60_000, max: 80 },
  read: { name: 'read', windowMs: 60_000, max: 400 },
};

/* ========================================================================== *
 * SECURITY HEADERS
 * `frame-ancestors` / X-Frame-Options are deliberately NOT set by default so
 * the app can be embedded in the Arena preview pane. Set CSP_FRAME_ANCESTORS
 * (e.g. "'none'") in production to lock framing down.
 * ========================================================================== */

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0'); // modern browsers: rely on CSP instead
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  if (process.env.NODE_ENV === 'production' || process.env.FORCE_HSTS === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  const frameAncestors = process.env.CSP_FRAME_ANCESTORS;
  const isProd = process.env.NODE_ENV === 'production';
  const csp = [
    "default-src 'self'",
    // Vite's dev client injects inline bootstrap code; production stays strict
    isProd ? "script-src 'self'" : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'", // the SPA uses inline style attributes
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    isProd ? "connect-src 'self'" : "connect-src 'self' ws: wss: http: https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    frameAncestors ? `frame-ancestors ${frameAncestors}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  res.setHeader('Content-Security-Policy', csp);
  next();
}

/* ========================================================================== *
 * STRUCTURED REQUEST LOGGING
 * ========================================================================== */

export function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  req.id = req.header('x-request-id') || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);

  res.on('finish', () => {
    if (process.env.LOG_REQUESTS === 'false') return;
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const line = {
      ts: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      request_id: req.id,
      method: req.method,
      path: req.originalUrl?.split('?')[0],
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
      user_id: req.user?.id || null,
      role: req.user?.role || null,
      ip: req.ip,
    };
    // slow requests are worth flagging even when they succeed
    if (ms > 1000) line.slow = true;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(line));
  });
  next();
}

/* ========================================================================== *
 * ENVIRONMENT VALIDATION — fail fast instead of failing silently in prod
 * ========================================================================== */

export function validateEnv() {
  const problems = [];
  const warnings = [];
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-only-secret-change-me') {
      problems.push('JWT_SECRET must be set to a long random value in production.');
    } else if (process.env.JWT_SECRET.length < 32) {
      warnings.push('JWT_SECRET is shorter than 32 characters.');
    }
    if (!process.env.APP_URL || !/^https:\/\//.test(process.env.APP_URL)) {
      problems.push('APP_URL must be the public HTTPS URL in production (used for payment callbacks).');
    }
    if (process.env.ALLOW_DEV_OTP === 'true') {
      problems.push('ALLOW_DEV_OTP must not be true in production — it accepts 000000 as an OTP.');
    }
    if (process.env.PAYSTACK_MOCK === 'true' && !process.env.PAYSTACK_SECRET_KEY) {
      warnings.push('Paystack is in sandbox mode: no live payments will be captured.');
    }
    if (!process.env.SMS_PROVIDER) {
      warnings.push('SMS_PROVIDER is not set — OTP codes will only be written to logs.');
    } else if (!['termii', 'twilio'].includes(process.env.SMS_PROVIDER.toLowerCase())) {
      problems.push(`SMS_PROVIDER "${process.env.SMS_PROVIDER}" is not supported — use "termii" or "twilio".`);
    } else if (process.env.SMS_PROVIDER.toLowerCase() === 'termii' && !process.env.TERMII_API_KEY) {
      problems.push('SMS_PROVIDER=termii but TERMII_API_KEY is missing — no code would ever arrive.');
    } else if (
      process.env.SMS_PROVIDER.toLowerCase() === 'twilio'
      && !(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID))
    ) {
      problems.push('SMS_PROVIDER=twilio but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM are incomplete.');
    }
  } else if (!process.env.JWT_SECRET) {
    warnings.push('JWT_SECRET not set; using an insecure development default.');
  }

  for (const w of warnings) console.warn(`[env] warning: ${w}`);
  if (problems.length) {
    for (const p of problems) console.error(`[env] fatal: ${p}`);
    throw new Error(`Invalid environment: ${problems.join(' ')}`);
  }
  return { warnings };
}

/* ========================================================================== *
 * GRACEFUL SHUTDOWN
 * ========================================================================== */

export function attachGracefulShutdown(server, { onClose } = {}) {
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: `received ${signal}, draining connections` }));
    const force = setTimeout(() => {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'forced shutdown after 10s' }));
      process.exit(1);
    }, 10_000);
    if (force.unref) force.unref();

    server.close(() => {
      try {
        onClose?.();
      } catch (err) {
        console.error('[shutdown] cleanup error', err);
      }
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'shutdown complete' }));
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'unhandledRejection', reason: String(reason) }));
  });
}
