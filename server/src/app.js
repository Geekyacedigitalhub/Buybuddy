import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, migrate, DATA_DIR } from './lib/db.js';
import { optionalAuth, requireAuth } from './lib/auth.js';
import { ApiError, now, uid } from './lib/util.js';
import { ensureDefaults, audit } from './lib/settings.js';
import { handlePaystackWebhook, paymentModes } from './lib/payments.js';
import { securityHeaders, requestLogger, rateLimit, limiterPresets, validateEnv } from './lib/security.js';
import { verifyPayment } from './lib/payments.js';

import accountRoutes from './routes/accounts.js';
import catalogRoutes from './routes/catalog.js';
import cartRoutes from './routes/cart.js';
import orderRoutes from './routes/orders.js';
import workerRoutes from './routes/worker.js';
import merchantRoutes from './routes/merchant.js';
import adminRoutes from './routes/admin.js';
import growthRoutes from './routes/growth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
export function createApp() {
  validateEnv();
  migrate();
  ensureDefaults();

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(requestLogger);
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true, credentials: true }));

  /* Per-route rate limits. Cheap in memory today; swap the store for Redis
     when the API runs on more than one instance (see docs/DEPLOYMENT.md). */
  app.use('/api/auth/login', rateLimit(limiterPresets.auth));
  app.use('/api/auth/register', rateLimit(limiterPresets.auth));
  app.use('/api/auth/password', rateLimit(limiterPresets.auth));
  app.use('/api/auth/otp', rateLimit(limiterPresets.otp));
  app.use('/api/orders/checkout', rateLimit(limiterPresets.checkout));
  app.use('/api/shopping/requests', rateLimit(limiterPresets.checkout));
  app.use('/api/payments', rateLimit(limiterPresets.payment));
  app.use('/api/dev/payments', rateLimit(limiterPresets.payment));

  /* The raw body is required to validate Paystack's HMAC signature. */
  app.post('/api/webhooks/paystack', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => {
    try {
      const result = handlePaystackWebhook(req.body.toString('utf8'), req.header('x-paystack-signature'));
      res.json({ received: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.use(express.json({ limit: '6mb' }));
  app.use(express.urlencoded({ extended: true }));

  /* Readiness probe: distinguishes "process is up" from "can serve traffic". */
  app.get('/api/ready', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ready: true, db: 'ok', time: now() });
    } catch (err) {
      res.status(503).json({ ready: false, db: 'error', error: err.message });
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'buybuddy-api',
      version: '1.0.0',
      time: now(),
      payments: paymentModes(),
      env: process.env.NODE_ENV || 'development',
    });
  });

  app.use(optionalAuth);
  app.use('/api', accountRoutes);
  app.use('/api', catalogRoutes);
  app.use('/api', cartRoutes);
  app.use('/api', orderRoutes);
  app.use('/api', workerRoutes);
  app.use('/api', merchantRoutes);
  app.use('/api', growthRoutes);
  app.use('/api', adminRoutes);

  /* Sandbox checkout endpoint — mirrors what Paystack's inline UI returns. */
  app.post('/api/dev/payments/:reference/approve', requireAuth, async (req, res, next) => {
    try {
      if (!paymentModes().mock) return res.status(403).json({ error: 'Sandbox payments are disabled.' });
      const result = await verifyPayment(req.params.reference);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  /* Simple upload endpoint: accepts a data URL, stores it on disk, returns a URL. */
  app.post('/api/uploads', requireAuth, (req, res, next) => {
    try {
      const { data_url, file_name } = req.body || {};
      if (!data_url || !/^data:/.test(data_url)) return res.status(400).json({ error: 'Expected a base64 data URL.' });
      const m = /^data:(.+?);base64,(.*)$/.exec(data_url);
      if (!m) return res.status(400).json({ error: 'Malformed data URL.' });
      if (Buffer.byteLength(m[2], 'base64') > 5 * 1024 * 1024) return res.status(413).json({ error: 'File too large (max 5 MB).' });
      const ext = (m[1].split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
      const name = `${uid('img')}.${ext}`;
      fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), Buffer.from(m[2], 'base64'));
      res.status(201).json({ url: `/uploads/${name}`, file_name: file_name || name });
    } catch (e) {
      next(e);
    }
  });

  /* Static: uploaded files + the built web app (single-origin deployment). */
  app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads'), { maxAge: '7d' }));
  const webDist = path.join(ROOT, '..', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    /* PWA files must never be served stale: a cached service worker or manifest
       pins users to an old build. Hashed assets, by contrast, are immutable. */
    const noStore = (file) => (req, res, next) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Service-Worker-Allowed', '/');
      if (file.endsWith('-sw') || file.endsWith('webmanifest')) {
        res.setHeader('Content-Type', file.endsWith('webmanifest')
          ? 'application/manifest+json; charset=utf-8'
          : 'application/javascript; charset=utf-8');
      }
      next();
    };

    app.get('/sw.js', noStore('sw'), (_req, res) => res.sendFile(path.join(webDist, 'sw.js')));
    app.get('/service-worker.js', noStore('sw'), (_req, res) => res.sendFile(path.join(webDist, 'sw.js')));
    app.get('/manifest.webmanifest', noStore('webmanifest'), (_req, res) => res.sendFile(path.join(webDist, 'manifest.webmanifest')));

    app.use(express.static(webDist, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`) || filePath.includes(`${path.sep}icons${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // content-hashed names
        } else if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }));
    app.get(/^\/(?!api|uploads).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}`, code: 'not_found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || (err instanceof ApiError ? err.status : 500);
    if (status >= 500) console.error('[error]', err);
    if (status >= 400) {
      try {
        audit(req, `error.${status}`, 'request', null, { path: req.path, message: err.message });
      } catch {}
    }
    res.status(status).json({
      error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message,
      code: err.code || 'error',
      details: err.details,
      request_id: req.id,
    });
  });

  return app;
}

export function startServer(port = process.env.PORT || 4000, host = '0.0.0.0') {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        msg: 'BUYBUDDY API listening',
        url: `http://${host}:${port}`,
        env: process.env.NODE_ENV || 'development',
        payments: paymentModes(),
      }));
      resolve(server);
    });
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 70_000;
  });
}
