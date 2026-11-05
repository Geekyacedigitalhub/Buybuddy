import 'dotenv/config';
import { startServer } from './app.js';
import { attachGracefulShutdown } from './lib/security.js';
import { db } from './lib/db.js';

const port = Number(process.env.PORT || 4000);

startServer(port, '0.0.0.0')
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
