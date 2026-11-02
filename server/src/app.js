import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createPatientService } from './services/patientService.js';
import { createAppointmentService } from './services/appointmentService.js';
import { createCallLogService } from './services/callLogService.js';
import { createToolHandlers } from './voice/toolHandlers.js';
import { createVapiWebhookHandler } from './voice/vapiWebhook.js';
import { patientRoutes } from './routes/patients.js';
import { appointmentRoutes, callRoutes, systemRoutes } from './routes/misc.js';
import { errorHandler, notFoundHandler, requestLogger, vapiAuth } from './middleware/http.js';

/**
 * Express app factory. Dependencies (repositories, logger, config) are
 * injected so tests can run the full HTTP stack against in-memory stores.
 *
 * Layering:
 *   routes/ (HTTP)  ─┐
 *                    ├─> services/ (use-cases + validation) ─> repositories/ (SQL)
 *   voice/ (Vapi)  ──┘
 */
/**
 * @param {object} deps
 * @param {{ available: boolean, download: Function, presignedUrl: Function }} [deps.recordingSource] Vapi recordings
 * @param {{ enabled: boolean, save: Function, open: Function }} [deps.recordingStore] archived call audio
 * @param {(promise: Promise<unknown>) => void} [deps.runInBackground] keeps work alive after the
 *   response is sent (Vercel's waitUntil in production)
 */
export function createApp({
  repositories,
  logger,
  config,
  healthCheck = async () => {},
  now,
  recordingSource = { available: false },
  recordingStore = { enabled: false },
  runInBackground = (promise) => void promise.catch(() => {}),
}) {
  const patientService = createPatientService({ patientRepository: repositories.patients, logger });
  const appointmentService = createAppointmentService({
    appointmentRepository: repositories.appointments,
    patientRepository: repositories.patients,
    timeZone: config.clinicTimezone,
    logger,
    now,
  });
  const callLogService = createCallLogService({
    callLogRepository: repositories.callLogs,
    recordingSource,
    recordingStore,
    logger,
  });
  const toolHandlers = createToolHandlers({ patientService, appointmentService, callLogService, logger });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(helmet());
  app.use(cors());
  app.use(requestLogger(logger));

  const api = express.Router();

  // Vapi webhook: end-of-call reports include the full transcript, so allow a larger body.
  api.post(
    '/vapi/webhook',
    express.json({ limit: '2mb' }),
    vapiAuth({ secret: config.vapiWebhookSecret, isProduction: config.isProduction, logger }),
    createVapiWebhookHandler({ toolHandlers, callLogService, logger, runInBackground }),
  );

  api.use(express.json({ limit: '100kb' }));
  api.use('/patients', patientRoutes({ patientService, appointmentService, callLogService }));
  api.use('/calls', callRoutes({ callLogService }));
  api.use('/appointments', appointmentRoutes({ appointmentService }));
  api.use(
    systemRoutes({
      healthCheck,
      publicInfo: {
        phone_number: config.publicPhoneNumber || null,
        clinic_timezone: config.clinicTimezone,
        web_call:
          config.vapiPublicKey && config.vapiAssistantId
            ? { public_key: config.vapiPublicKey, assistant_id: config.vapiAssistantId }
            : null,
      },
    }),
  );

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
