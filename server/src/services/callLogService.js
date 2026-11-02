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
    // Archived copy in our private Blob store, streamed via /api/calls/:id/recording.
    recording_stored: Boolean(row.recording_blob_path),
    recording_size_bytes: row.recording_size_bytes === null || row.recording_size_bytes === undefined ? null : Number(row.recording_size_bytes),
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
export function createCallLogService({ callLogRepository, recordingSource, recordingStore, logger }) {
  const archivingEnabled = () => Boolean(recordingStore?.enabled && recordingSource?.available);

  async function archiveRow(row) {
    const file = await recordingSource.download(row.call_id);
    const saved = await recordingStore.save(row.call_id, file);
    await callLogRepository.upsert(row.call_id, {
      recording_blob_path: saved.pathname,
      recording_content_type: saved.contentType,
      recording_size_bytes: saved.size,
      recording_archived_at: new Date(),
    });
    logger.info('call.recording.archived', { call_id: row.call_id, pathname: saved.pathname, size_bytes: saved.size });
    return saved;
  }

  return {
    /**
     * Copy the call's recording from Vapi into our private Blob store.
     * Runs in the background after the end-of-call report; never throws
     * (a failure is logged and can be retried with `npm run recordings:archive`).
     */
    async archiveRecording(callId) {
      if (!archivingEnabled()) return { archived: false, reason: 'storage_disabled' };
      try {
        const row = await callLogRepository.findById(callId);
        if (!row?.recording_url) return { archived: false, reason: 'no_recording' };
        if (row.recording_blob_path) return { archived: false, reason: 'already_archived' };
        await archiveRow(row);
        return { archived: true };
      } catch (error) {
        logger.error('call.recording.archive_failed', { call_id: callId, error });
        return { archived: false, reason: 'error' };
      }
    },

    /** Archive every recording not yet copied (backfill / retry). */
    async archivePendingRecordings({ limit = 50 } = {}) {
      if (!archivingEnabled()) throw new Error('Recording archiving needs BLOB_READ_WRITE_TOKEN and VAPI_API_KEY.');
      const rows = await callLogRepository.listUnarchivedRecordings(limit);
      const results = [];
      for (const row of rows) {
        try {
          const saved = await archiveRow(row);
          results.push({ call_id: row.call_id, archived: true, size_bytes: saved.size });
        } catch (error) {
          logger.error('call.recording.archive_failed', { call_id: row.call_id, error });
          results.push({ call_id: row.call_id, archived: false, error: error.message });
        }
      }
      return results;
    },

    /**
     * Short-lived URL for a call's audio: our archived copy if present,
     * otherwise Vapi's presigned URL while archiving is still pending.
     * @returns {Promise<{ url: string, source: 'archive' | 'vapi' }>}
     */
    async recordingUrl(callId) {
      const row = await callLogRepository.findById(callId);
      if (!row) throw new NotFoundError(`Call ${callId} not found.`);
      if (row.recording_blob_path && recordingStore?.enabled) {
        return { url: await recordingStore.signedUrl(row.recording_blob_path), source: 'archive' };
      }
      if (row.recording_url && recordingSource?.available) {
        const url = await recordingSource.presignedUrl(callId);
        if (url) return { url, source: 'vapi' };
      }
      throw new NotFoundError('This call has no recording.');
    },

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

    /** Patient this call created with register_patient (used to make retries idempotent). */
    async getRegisteredPatientIdForCall(callId) {
      if (!callId) return null;
      const existing = await callLogRepository.findById(callId);
      return existing?.outcome === 'registered' ? existing.patient_id : null;
    },

    /**
     * Which existing patient record this call may read or change: the one it
     * registered itself, or the one it verified by date of birth.
     */
    async getCallAccess(callId) {
      const row = callId ? await callLogRepository.findById(callId) : null;
      return {
        registeredPatientId: row?.outcome === 'registered' ? row.patient_id : null,
        verifiedPatientId: row?.verified_patient_id ?? null,
        identityAttempts: row?.identity_attempts ?? 0,
      };
    },

    async recordIdentityAttempt(callId, { callerNumber, verifiedPatientId, attempts }) {
      if (!callId) return null;
      return callLogRepository.upsert(callId, {
        caller_number: callerNumber ?? undefined,
        identity_attempts: attempts,
        verified_patient_id: verifiedPatientId ?? undefined,
      });
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
