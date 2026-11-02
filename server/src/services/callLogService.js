import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { assertUuid } from './patientService.js';

export const CALL_OUTCOMES = Object.freeze(['in_progress', 'registered', 'updated', 'incomplete']);

export function toCallLogDto(row) {
  if (!row) return null;
  return {
    call_id: row.call_id,
    patient_id: row.patient_id ?? null,
    patient_name: row.first_name ? `${row.first_name} ${row.last_name}` : undefined,
    caller_number: row.caller_number ?? null,
    outcome: row.outcome,
    draft_data: row.draft_data ?? null,
    ended_reason: row.ended_reason ?? null,
    summary: row.summary ?? null,
    transcript: row.transcript ?? null,
    recording_url: row.recording_url ?? null,
    started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
    ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    duration_seconds: row.duration_seconds === null || row.duration_seconds === undefined ? null : Number(row.duration_seconds),
    created_at: new Date(row.created_at).toISOString(),
  };
}

/**
 * Call bookkeeping: partial drafts while a call is in flight, the patient a
 * call produced, and the transcript/summary once Vapi reports the call ended.
 */
export function createCallLogService({ callLogRepository, logger }) {
  return {
    /** Merge newly collected (validated) fields into the call's draft. */
    async saveDraft(callId, { callerNumber, fields }) {
      if (!callId) return null;
      const existing = await callLogRepository.findById(callId);
      const draft = { ...(existing?.draft_data ?? {}), ...fields };
      return callLogRepository.upsert(callId, { caller_number: callerNumber ?? undefined, draft_data: draft });
    },

    async linkPatient(callId, { patientId, outcome, callerNumber, fields }) {
      if (!callId) return null;
      return callLogRepository.upsert(callId, {
        patient_id: patientId,
        outcome,
        caller_number: callerNumber ?? undefined,
        draft_data: fields ?? undefined,
      });
    },

    async getPatientIdForCall(callId) {
      if (!callId) return null;
      const existing = await callLogRepository.findById(callId);
      return existing?.patient_id ?? null;
    },

    /** Persist Vapi's end-of-call-report. A call that never saved a patient is marked incomplete. */
    async recordEndOfCall(callId, report) {
      const existing = await callLogRepository.findById(callId);
      const outcome = existing?.patient_id ? existing.outcome : 'incomplete';
      const row = await callLogRepository.upsert(callId, { ...report, outcome });
      logger.info('call.ended', {
        call_id: callId,
        outcome,
        ended_reason: report.ended_reason,
        patient_id: row?.patient_id ?? null,
        duration_seconds: report.duration_seconds,
        collected_data: row?.draft_data ?? null,
        summary: report.summary,
      });
      if (outcome === 'incomplete') {
        logger.warn('call.incomplete', {
          call_id: callId,
          ended_reason: report.ended_reason,
          partial_data: row?.draft_data ?? null,
        });
      }
      return toCallLogDto(row);
    },

    async listRecent(query = {}) {
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      const offset = query.offset === undefined ? 0 : Number(query.offset);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new BadRequestError('limit must be an integer between 1 and 200.');
      if (!Number.isInteger(offset) || offset < 0) throw new BadRequestError('offset must be a non-negative integer.');
      if (query.outcome !== undefined && !CALL_OUTCOMES.includes(query.outcome)) {
        throw new BadRequestError(`outcome must be one of: ${CALL_OUTCOMES.join(', ')}.`);
      }
      const rows = await callLogRepository.listRecent({ limit, offset, outcome: query.outcome });
      return rows.map(toCallLogDto);
    },

    async get(callId) {
      if (typeof callId !== 'string' || callId.length > 100) throw new BadRequestError('Invalid call id.');
      const row = await callLogRepository.findById(callId);
      if (!row) throw new NotFoundError(`Call ${callId} not found.`);
      return toCallLogDto(row);
    },

    async listForPatient(patientId) {
      assertUuid(patientId);
      const rows = await callLogRepository.listByPatient(patientId);
      return rows.map(toCallLogDto);
    },
  };
}
