import {
  PATIENT_FIELD_NAMES,
  cleanText,
  formatDateOfBirth,
  normalizePhone,
  parseDateOfBirth,
  validatePatientInput,
} from '../domain/patient.js';
import { BadRequestError, NotFoundError, ValidationError } from '../lib/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function assertUuid(id, label = 'patient_id') {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new BadRequestError(`${label} must be a valid UUID.`);
}

/** DB row -> public API representation (dates as MM/DD/YYYY, timestamps as ISO-8601 UTC). */
export function toPatientDto(row) {
  if (!row) return null;
  const dto = { patient_id: row.patient_id };
  for (const field of PATIENT_FIELD_NAMES) dto[field] = row[field] ?? null;
  dto.date_of_birth = formatDateOfBirth(row.date_of_birth);
  dto.created_at = toIso(row.created_at);
  dto.updated_at = toIso(row.updated_at);
  return dto;
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function parsePagination(query) {
  const limit = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestError(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
  }
  if (!Number.isInteger(offset) || offset < 0) throw new BadRequestError('offset must be a non-negative integer.');
  return { limit, offset };
}

function singleQueryValue(query, key) {
  const value = query[key];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestError(`${key} must be provided once.`);
  return value;
}

/**
 * Patient use-cases. Shared by the REST API (routes/patients.js) and the voice
 * agent tools (voice/tools.js) so both paths apply identical validation.
 */
export function createPatientService({ patientRepository, logger }) {
  return {
    async list(query = {}) {
      const { limit, offset } = parsePagination(query);
      const filters = { limit, offset };

      const lastName = singleQueryValue(query, 'last_name');
      if (lastName !== undefined) {
        filters.lastName = cleanText(lastName);
        if (filters.lastName.length > 50) throw new BadRequestError('last_name filter is too long.');
      }

      const dob = singleQueryValue(query, 'date_of_birth');
      if (dob !== undefined) {
        filters.dateOfBirth = parseDateOfBirth(dob);
        if (!filters.dateOfBirth) throw new BadRequestError('date_of_birth must be a valid date (MM/DD/YYYY).');
      }

      const phone = singleQueryValue(query, 'phone_number');
      if (phone !== undefined) {
        filters.phoneNumber = normalizePhone(phone);
        if (filters.phoneNumber.length !== 10) throw new BadRequestError('phone_number must be a 10-digit U.S. number.');
      }

      const rows = await patientRepository.list(filters);
      return rows.map(toPatientDto);
    },

    async get(patientId) {
      assertUuid(patientId);
      const row = await patientRepository.findById(patientId);
      if (!row) throw new NotFoundError(`Patient ${patientId} not found.`);
      return toPatientDto(row);
    },

    /** Active patients sharing a phone number (used for duplicate detection). */
    async findByPhone(phoneNumber) {
      const normalized = normalizePhone(phoneNumber ?? '');
      if (normalized.length !== 10) return [];
      const rows = await patientRepository.findByPhone(normalized);
      return rows.map(toPatientDto);
    },

    async create(input, { source = 'api' } = {}) {
      const { value, errors } = validatePatientInput(input, { mode: 'create' });
      if (errors.length) throw new ValidationError(errors);
      const row = await patientRepository.create(value);
      const patient = toPatientDto(row);
      logger.info('patient.created', { source, patient_id: patient.patient_id, payload: patient });
      return patient;
    },

    async update(patientId, input, { source = 'api' } = {}) {
      assertUuid(patientId);
      const { value, errors } = validatePatientInput(input, { mode: 'update' });
      if (errors.length) throw new ValidationError(errors);
      if (Object.keys(value).length === 0) {
        throw new ValidationError([{ field: '_body', message: 'Provide at least one field to update.' }]);
      }
      const row = await patientRepository.update(patientId, value);
      if (!row) throw new NotFoundError(`Patient ${patientId} not found.`);
      const patient = toPatientDto(row);
      logger.info('patient.updated', { source, patient_id: patientId, changed_fields: Object.keys(value), payload: patient });
      return patient;
    },

    async remove(patientId) {
      assertUuid(patientId);
      const row = await patientRepository.softDelete(patientId);
      if (!row) throw new NotFoundError(`Patient ${patientId} not found.`);
      logger.info('patient.deleted', { patient_id: patientId });
      return { ...toPatientDto(row), deleted_at: toIso(row.deleted_at) };
    },
  };
}
