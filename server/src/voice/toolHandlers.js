// Voice-agent tool handlers.
//
// Each handler receives the LLM's arguments plus call context and returns a
// plain object that is JSON-serialized back to the model. Handlers NEVER throw
// to the caller: every failure is converted into a structured result with an
// `error_type` and a `next_step` hint so the agent can say something useful
// instead of going silent.
//
// Persistence goes through the same service layer as the REST API, so
// validation is identical on both paths.

import {
  PATIENT_FIELD_NAMES,
  REQUIRED_FIELD_NAMES,
  formatDateOfBirth,
  parseDateOfBirth,
  validatePatientInput,
} from '../domain/patient.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';

const pickPatientFields = (args) =>
  Object.fromEntries(PATIENT_FIELD_NAMES.filter((f) => args[f] !== undefined).map((f) => [f, args[f]]));

/** Normalized draft values in caller-friendly form (dates back to MM/DD/YYYY). */
function presentable(value) {
  const out = { ...value };
  if (out.date_of_birth) out.date_of_birth = formatDateOfBirth(out.date_of_birth);
  return out;
}

const validationResult = (errors) => ({
  success: false,
  error_type: 'validation',
  errors,
  next_step: 'Apologize briefly, explain each problem in plain words, and re-ask the caller ONLY for these fields.',
});

const MAX_IDENTITY_ATTEMPTS = 3;

const NOT_VERIFIED_RESULT = {
  success: false,
  error_type: 'not_verified',
  message: "This call has not verified the patient's identity.",
  next_step:
    'Do not share or change anything on this record. Ask for the date of birth and call verify_patient_identity first.',
};

const SYSTEM_ERROR_RESULT = {
  success: false,
  error_type: 'system_error',
  message: 'The clinic system is temporarily unavailable.',
  next_step:
    'Apologize, try the same tool once more. If it fails again, tell the caller the registration could not be completed right now and the clinic team will follow up, then end the call politely. Never say it was saved.',
};

export function createToolHandlers({ patientService, appointmentService, callLogService, logger }) {
  /** Run `fn`; map known errors to agent-friendly results. */
  async function guarded(toolName, fn) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ValidationError) return validationResult(error.errors);
      if (error instanceof NotFoundError) return { success: false, error_type: 'not_found', message: error.message };
      if (error instanceof ConflictError) return { success: false, error_type: 'conflict', message: error.message };
      if (error instanceof AppError && error.status < 500) return { success: false, error_type: 'invalid_request', message: error.message };
      logger.error('voice.tool.failed', { tool: toolName, error });
      return SYSTEM_ERROR_RESULT;
    }
  }

  /**
   * Server-side access control for existing records. A call may only read or
   * change a patient it registered itself or verified by date of birth, so a
   * manipulated model (prompt injection) still can't touch other records.
   */
  async function mayAccess(ctx, patientId) {
    if (!ctx.callId || !patientId) return false;
    const access = await callLogService.getCallAccess(ctx.callId);
    return patientId === access.registeredPatientId || patientId === access.verifiedPatientId;
  }

  /** Best-effort call-log write: bookkeeping must never break the conversation. */
  async function safely(label, fn) {
    try {
      await fn();
    } catch (error) {
      logger.warn('voice.calllog.write_failed', { label, error });
    }
  }

  return {
    async check_existing_patient(args, ctx) {
      return guarded('check_existing_patient', async () => {
        const { value, errors } = validatePatientInput({ phone_number: args.phone_number }, { mode: 'draft' });
        if (errors.length) return { found: false, ...validationResult(errors) };

        await safely('draft', () => callLogService.saveDraft(ctx.callId, { callerNumber: ctx.callerNumber, fields: value }));
        const matches = await patientService.findByPhone(value.phone_number);
        if (matches.length === 0) return { found: false };

        // Data minimization: only enough to ask "is this you?". The rest of the
        // record is released by verify_patient_identity after a DOB match.
        const [match] = matches;
        return {
          found: true,
          patient: { patient_id: match.patient_id, first_name: match.first_name, last_name: match.last_name },
          other_patients_with_this_phone: matches.slice(1).map((p) => ({ patient_id: p.patient_id, first_name: p.first_name, last_name: p.last_name })),
          next_step:
            'Ask: "It looks like we already have a record for [first name] [last name]. Would you like to update your information instead?" ' +
            'If yes, ask for their date of birth and call verify_patient_identity. You do not have any other details of this record yet.',
        };
      });
    },

    async verify_patient_identity(args, ctx) {
      return guarded('verify_patient_identity', async () => {
        const access = await callLogService.getCallAccess(ctx.callId);
        if (access.verifiedPatientId && access.verifiedPatientId === args.patient_id) {
          return { verified: true, patient: await patientService.get(args.patient_id) };
        }
        if (access.identityAttempts >= MAX_IDENTITY_ATTEMPTS) {
          return {
            verified: false,
            locked: true,
            next_step:
              'Too many attempts. Do not reveal or change this record. Offer to register them as a new patient, or say the clinic team can help them with their existing record.',
          };
        }

        const attempts = access.identityAttempts + 1;
        const given = parseDateOfBirth(args.date_of_birth ?? '');
        const patient = await patientService.get(args.patient_id);
        const matches = Boolean(given) && formatDateOfBirth(given) === patient.date_of_birth;

        await callLogService.recordIdentityAttempt(ctx.callId, {
          callerNumber: ctx.callerNumber,
          attempts,
          verifiedPatientId: matches ? patient.patient_id : undefined,
        });
        logger.info('voice.identity.verification', { call_id: ctx.callId, patient_id: patient.patient_id, verified: matches, attempts });

        if (matches) {
          return {
            verified: true,
            patient,
            next_step: 'Identity confirmed. Ask what they would like to update; you may now read back details from this record.',
          };
        }
        // Never reveal the DOB on file or which part was wrong.
        return {
          verified: false,
          attempts_remaining: MAX_IDENTITY_ATTEMPTS - attempts,
          next_step:
            'The date of birth does not match. Do not reveal anything from the record. Ask them to double-check it, or offer to register as a new patient.',
        };
      });
    },

    async validate_patient_info(args, ctx) {
      return guarded('validate_patient_info', async () => {
        const { value, errors } = validatePatientInput(pickPatientFields(args), { mode: 'draft' });
        await safely('draft', () => callLogService.saveDraft(ctx.callId, { callerNumber: ctx.callerNumber, fields: value }));
        const missing = REQUIRED_FIELD_NAMES.filter((f) => !(f in value) && !errors.some((e) => e.field === f));
        return {
          valid: errors.length === 0,
          normalized: presentable(value),
          errors,
          missing_required_fields: missing,
          next_step: errors.length
            ? 'Re-ask the caller ONLY for the fields in errors, explaining what was wrong.'
            : missing.length
              ? 'Collect the missing required fields.'
              : 'Read the information back to the caller in two short chunks and get confirmation before saving.',
        };
      });
    },

    async register_patient(args, ctx) {
      return guarded('register_patient', async () => {
        const fields = pickPatientFields(args);
        const { value, errors } = validatePatientInput(fields, { mode: 'create' });
        if (errors.length) return validationResult(errors);

        // Idempotency: if this call already created a patient (e.g. the model
        // retried after a timeout), update that record instead of duplicating it.
        const alreadyCreatedId = await callLogService.getRegisteredPatientIdForCall(ctx.callId).catch(() => null);
        if (alreadyCreatedId) {
          const patient = await patientService.update(alreadyCreatedId, fields, { source: 'voice' });
          return { success: true, patient_id: patient.patient_id, first_name: patient.first_name, note: 'Record was already saved on this call; it has been updated.' };
        }

        if (args.allow_duplicate_phone !== true) {
          const existing = await patientService.findByPhone(value.phone_number);
          if (existing.length) {
            const [match] = existing;
            return {
              success: false,
              error_type: 'duplicate_phone',
              existing_patient: { patient_id: match.patient_id, first_name: match.first_name, last_name: match.last_name },
              next_step:
                `Ask: "It looks like we already have a record for ${match.first_name} ${match.last_name}. Would you like to update your information instead?" ` +
                'If the record belongs to someone else, call register_patient again with allow_duplicate_phone true.',
            };
          }
        }

        const patient = await patientService.create(fields, { source: 'voice' });
        logger.info('voice.registration.final_payload', { call_id: ctx.callId, payload: patient });
        await safely('link', () =>
          callLogService.linkPatient(ctx.callId, { patientId: patient.patient_id, outcome: 'registered', callerNumber: ctx.callerNumber, fields: value }),
        );
        return {
          success: true,
          patient_id: patient.patient_id,
          first_name: patient.first_name,
          next_step: `Say "You're all set, ${patient.first_name}." then offer to schedule a first appointment.`,
        };
      });
    },

    async update_patient(args, ctx) {
      return guarded('update_patient', async () => {
        if (!(await mayAccess(ctx, args.patient_id))) return NOT_VERIFIED_RESULT;
        const fields = pickPatientFields(args);
        const patient = await patientService.update(args.patient_id, fields, { source: 'voice' });
        logger.info('voice.update.final_payload', { call_id: ctx.callId, changed_fields: Object.keys(fields), payload: patient });
        await safely('link', () =>
          callLogService.linkPatient(ctx.callId, { patientId: patient.patient_id, outcome: 'updated', callerNumber: ctx.callerNumber }),
        );
        return { success: true, patient_id: patient.patient_id, first_name: patient.first_name, updated_fields: Object.keys(fields) };
      });
    },

    async get_available_appointments(args) {
      return guarded('get_available_appointments', async () => {
        const preferredDate = args.preferred_date ? parseDateOfBirth(args.preferred_date) : undefined;
        const slots = await appointmentService.findAvailableSlots({
          preferredDate: preferredDate ?? undefined,
          timeOfDay: args.time_of_day ?? 'any',
          limit: 3,
        });
        if (slots.length === 0) return { slots: [], next_step: 'Tell the caller no slots are open then and ask for another day.' };
        return { slots, next_step: 'Offer these options using the label and provider_name.' };
      });
    },

    async book_appointment(args, ctx) {
      return guarded('book_appointment', async () => {
        if (!(await mayAccess(ctx, args.patient_id))) return NOT_VERIFIED_RESULT;
        const appointment = await appointmentService.book({
          patient_id: args.patient_id,
          start_time: args.start_time,
          provider_name: args.provider_name,
          reason: args.reason,
        });
        logger.info('voice.appointment.booked', { call_id: ctx.callId, appointment });
        return {
          success: true,
          appointment_id: appointment.appointment_id,
          when: appointment.scheduled_label,
          provider_name: appointment.provider_name,
          next_step: 'Confirm the day, time and provider, then ask if there is anything else.',
        };
      });
    },
  };
}
