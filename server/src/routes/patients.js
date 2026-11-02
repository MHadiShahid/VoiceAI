import { Router } from 'express';
import { ok } from '../middleware/http.js';

/**
 * REST resource: /patients
 *   GET    /patients                     list (filters: last_name, date_of_birth, phone_number; limit, offset)
 *   GET    /patients/:id                 one patient
 *   POST   /patients                     create -> 201
 *   PUT    /patients/:id                 partial update
 *   DELETE /patients/:id                 soft delete (sets deleted_at)
 *   GET    /patients/:id/appointments    bonus: appointments for the patient
 *   POST   /patients/:id/appointments    bonus: book a slot
 *   GET    /patients/:id/calls           bonus: call transcripts/summaries for the patient
 */
export function patientRoutes({ patientService, appointmentService, callLogService }) {
  const router = Router();

  router.get('/', async (req, res) => ok(res, await patientService.list(req.query)));
  router.post('/', async (req, res) => ok(res, await patientService.create(req.body), 201));
  router.get('/:id', async (req, res) => ok(res, await patientService.get(req.params.id)));
  router.put('/:id', async (req, res) => ok(res, await patientService.update(req.params.id, req.body)));
  router.delete('/:id', async (req, res) => ok(res, await patientService.remove(req.params.id)));

  router.get('/:id/appointments', async (req, res) => {
    await patientService.get(req.params.id); // 404 if the patient doesn't exist
    ok(res, await appointmentService.listForPatient(req.params.id));
  });
  router.post('/:id/appointments', async (req, res) => {
    const body = req.body ?? {};
    const appointment = await appointmentService.book({
      patient_id: req.params.id,
      start_time: body.start_time,
      provider_name: body.provider_name,
      reason: body.reason,
    });
    ok(res, appointment, 201);
  });

  router.get('/:id/calls', async (req, res) => {
    await patientService.get(req.params.id);
    ok(res, await callLogService.listForPatient(req.params.id));
  });

  return router;
}
