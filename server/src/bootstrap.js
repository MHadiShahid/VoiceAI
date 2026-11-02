import { config } from './config.js';
import { createApp } from './app.js';
import { createLogger } from './lib/logger.js';
import { getPool } from './db/pool.js';
import { createPatientRepository } from './repositories/patientRepository.js';
import { createAppointmentRepository } from './repositories/appointmentRepository.js';
import { createCallLogRepository } from './repositories/callLogRepository.js';

/** Production wiring: PostgreSQL repositories + JSON logger. Shared by local server and Vercel function. */
export function buildApp() {
  const logger = createLogger({ level: config.logLevel });
  // Wrap the pool so the connection is only opened on first query (the app
  // can boot — and /api/info can answer — even if DATABASE_URL is missing).
  const db = { query: (sql, params) => getPool().query(sql, params) };

  return createApp({
    config,
    logger,
    repositories: {
      patients: createPatientRepository(db),
      appointments: createAppointmentRepository(db),
      callLogs: createCallLogRepository(db),
    },
    healthCheck: () => db.query('SELECT 1'),
  });
}
