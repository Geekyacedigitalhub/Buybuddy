import 'dotenv/config';
import { startServer } from './app.js';

const port = Number(process.env.PORT || 4000);
startServer(port, '0.0.0.0').catch((err) => {
  console.error('Failed to start BUYBUDDY API:', err);
  process.exit(1);
});
