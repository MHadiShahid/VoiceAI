import { PATIENT_FIELD_NAMES } from '../domain/patient.js';

const WRITABLE = new Set(PATIENT_FIELD_NAMES);

function assertWritable(columns) {
  for (const column of columns) {
    if (!WRITABLE.has(column)) throw new Error(`Refusing to write unknown column "${column}"`);
  }
}

/** Escape LIKE wildcards so user input is matched literally. */
function escapeLike(text) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * PostgreSQL persistence for patients. All reads exclude soft-deleted rows.
 * Column names are whitelisted against the domain model; values are always
 * passed as bind parameters.
 *
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db
 */
export function createPatientRepository(db) {
  return {
    async create(data) {
      const columns = Object.keys(data);
      assertWritable(columns);
      const placeholders = columns.map((_, i) => `$${i + 1}`);
      const { rows } = await db.query(
        `INSERT INTO patients (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
        columns.map((c) => data[c]),
      );
      return rows[0];
    },

    async findById(patientId) {
      const { rows } = await db.query('SELECT * FROM patients WHERE patient_id = $1 AND deleted_at IS NULL', [patientId]);
      return rows[0] ?? null;
    },

    async findByPhone(phoneNumber) {
      const { rows } = await db.query(
        'SELECT * FROM patients WHERE phone_number = $1 AND deleted_at IS NULL ORDER BY updated_at DESC',
        [phoneNumber],
      );
      return rows;
    },

    /**
     * @param {{ lastName?: string, dateOfBirth?: string, phoneNumber?: string, limit: number, offset: number }} filters
     *   lastName is a case-insensitive prefix match; the others are exact.
     */
    async list({ lastName, dateOfBirth, phoneNumber, limit, offset }) {
      const where = ['deleted_at IS NULL'];
      const params = [];
      if (lastName) {
        params.push(`${escapeLike(lastName.toLowerCase())}%`);
        where.push(`lower(last_name) LIKE $${params.length}`);
      }
      if (dateOfBirth) {
        params.push(dateOfBirth);
        where.push(`date_of_birth = $${params.length}`);
      }
      if (phoneNumber) {
        params.push(phoneNumber);
        where.push(`phone_number = $${params.length}`);
      }
      params.push(limit, offset);
      const { rows } = await db.query(
        `SELECT * FROM patients WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return rows;
    },

    async update(patientId, patch) {
      const columns = Object.keys(patch);
      assertWritable(columns);
      if (columns.length === 0) return this.findById(patientId);
      const sets = columns.map((c, i) => `${c} = $${i + 2}`);
      const { rows } = await db.query(
        `UPDATE patients SET ${sets.join(', ')} WHERE patient_id = $1 AND deleted_at IS NULL RETURNING *`,
        [patientId, ...columns.map((c) => patch[c])],
      );
      return rows[0] ?? null;
    },

    async softDelete(patientId) {
      const { rows } = await db.query(
        'UPDATE patients SET deleted_at = now() WHERE patient_id = $1 AND deleted_at IS NULL RETURNING *',
        [patientId],
      );
      return rows[0] ?? null;
    },
  };
}
