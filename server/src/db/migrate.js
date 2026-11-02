// Applies db/schema.sql. The schema is idempotent, so this is safe to re-run.
// Usage: npm run db:migrate
import { readFile } from 'node:fs/promises';
import { closePool, getPool } from './pool.js';

const schemaUrl = new URL('./schema.sql', import.meta.url);

try {
  const sql = await readFile(schemaUrl, 'utf8');
  await getPool().query(sql);
  console.log('Migration complete: patients, appointments, call_logs are up to date.');
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
