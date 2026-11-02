// Local development entry point. On Vercel, api/index.js exports the same app.
import { config } from './config.js';
import { buildApp } from './bootstrap.js';
import { closePool } from './db/pool.js';

const app = buildApp();

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}/api`);
});

const shutdown = async () => {
  server.close();
  await closePool();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
