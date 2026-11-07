import 'dotenv/config';
import { startServer } from './app.js';
import { migrate, db } from './lib/db.js';
import { attachGracefulShutdown } from './lib/security.js';

const port = Number(process.env.PORT || 4000);

/**
 * Hosted platforms know their own public URL before the app does: Render exposes
 * it as RENDER_EXTERNAL_URL. Adopt it so a first deploy cannot fail the
 * production APP_URL check (payment callbacks need a real HTTPS address), and so
 * nobody has to paste the URL into a dashboard twice.
 */
if (!process.env.APP_URL) {
  const hosted = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_EXTERNAL_HOSTNAME;
  if (hosted) {
    process.env.APP_URL = /^https?:\/\//.test(hosted) ? hosted : `https://${hosted}`;
  }
}

/**
 * Hosted demo convenience: on a fresh container (no database yet) with
 * SEED_IF_EMPTY=true, build the demo marketplace before serving. Off by default
 * so production never invents data.
 */
async function bootstrapIfEmpty() {
  if (process.env.SEED_IF_EMPTY !== 'true') return;
  migrate();
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (users > 0) return;
  const { main } = await import('./seed.js');
  await main();
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'seeded empty database' }));
}

bootstrapIfEmpty()
  .catch((err) => console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'seed skipped', error: err.message })))
  .then(() => startServer(port, '0.0.0.0'))
  .then((server) => {
    attachGracefulShutdown(server, {
      onClose: () => {
        try {
          db.pragma('wal_checkpoint(TRUNCATE)');
          db.close();
        } catch {
          /* already closed */
        }
      },
    });
  })
  .catch((err) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'startup failed', error: err.message }));
    process.exit(1);
  });
