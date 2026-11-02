/**
 * PostgreSQL persistence for appointments.
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db
 */
export function createAppointmentRepository(db) {
  return {
    /** Throws a pg error with code 23505 if the provider slot is already taken. */
    async create({ patient_id, provider_name, scheduled_at, duration_minutes, reason }) {
      const { rows } = await db.query(
        `INSERT INTO appointments (patient_id, provider_name, scheduled_at, duration_minutes, reason)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [patient_id, provider_name, scheduled_at, duration_minutes, reason ?? null],
      );
      return rows[0];
    },

    async listByPatient(patientId) {
      const { rows } = await db.query(
        'SELECT * FROM appointments WHERE patient_id = $1 ORDER BY scheduled_at ASC',
        [patientId],
      );
      return rows;
    },

    /** Scheduled (not cancelled) appointments in [from, to). */
    async listBookedBetween(from, to) {
      const { rows } = await db.query(
        `SELECT provider_name, scheduled_at FROM appointments
         WHERE status = 'scheduled' AND scheduled_at >= $1 AND scheduled_at < $2`,
        [from, to],
      );
      return rows;
    },
  };
}
