import { Router } from 'express';
import { ok } from '../middleware/http.js';
import { BadRequestError } from '../lib/errors.js';
import { parseDateOfBirth } from '../domain/patient.js';

/** /calls — call logs (transcripts, summaries, incomplete-call drafts). */
export function callRoutes({ callLogService }) {
  const router = Router();
  router.get('/', async (req, res) => ok(res, await callLogService.listRecent(req.query)));
  router.get('/:id', async (req, res) => ok(res, await callLogService.get(req.params.id)));
  return router;
}

/** /appointments/availability — open slots in the mock clinic calendar. */
export function appointmentRoutes({ appointmentService }) {
  const router = Router();
  router.get('/availability', async (req, res) => {
    const { date, time_of_day: timeOfDay = 'any' } = req.query;
    if (!['morning', 'afternoon', 'any'].includes(timeOfDay)) {
      throw new BadRequestError('time_of_day must be morning, afternoon or any.');
    }
    const preferredDate = date ? parseDateOfBirth(date) : undefined;
    if (date && !preferredDate) throw new BadRequestError('date must be a valid date (MM/DD/YYYY).');
    ok(res, await appointmentService.findAvailableSlots({ preferredDate, timeOfDay, limit: 10 }));
  });
  return router;
}

/** /health and /info — liveness (with DB ping) and public metadata for the dashboard. */
export function systemRoutes({ healthCheck, publicInfo }) {
  const router = Router();
  router.get('/health', async (req, res) => {
    try {
      await healthCheck();
      ok(res, { status: 'ok', database: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ data: { status: 'degraded', database: 'unreachable' }, error: { code: 'unavailable', message: 'Database unreachable.' } });
    }
  });
  router.get('/info', (req, res) => ok(res, publicInfo));
  return router;
}
