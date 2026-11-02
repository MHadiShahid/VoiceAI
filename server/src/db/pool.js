import pg from 'pg';
import { config } from '../config.js';

// Return DATE columns as plain "YYYY-MM-DD" strings instead of JS Dates, which
// would otherwise be shifted by the server's local timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

let pool;

/**
 * Lazily-created shared pool. On Vercel (Fluid Compute) a function instance is
 * reused across requests, so the pool is reused too; keep it small because
 * Neon's pooled endpoint (PgBouncer) does the real connection pooling.
 */
export function getPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    }
    // TLS is configured explicitly below, so drop any sslmode/channel_binding
    // query params (Neon adds them) to avoid pg's sslmode deprecation warning.
    const url = new URL(config.databaseUrl);
    url.searchParams.delete('sslmode');
    url.searchParams.delete('channel_binding');
    pool = new pg.Pool({
      connectionString: url.toString(),
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      // Neon requires TLS and presents a publicly trusted certificate.
      ssl: /localhost|127\.0\.0\.1/.test(config.databaseUrl) ? false : true,
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
