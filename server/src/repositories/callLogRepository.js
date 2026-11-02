const WRITABLE = new Set([
  'patient_id', 'caller_number', 'outcome', 'draft_data', 'ended_reason', 'summary',
  'transcript', 'recording_url', 'started_at', 'ended_at', 'duration_seconds',
]);

/**
 * PostgreSQL persistence for per-call logs (transcripts, summaries, drafts).
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db
 */
export function createCallLogRepository(db) {
  return {
    /**
     * Insert the call row or update only the supplied columns. Vapi can deliver
     * tool calls and the end-of-call report in any order, so every write is an
     * upsert keyed on the Vapi call id.
     */
    async upsert(callId, fields) {
      const columns = Object.keys(fields).filter((c) => fields[c] !== undefined);
      for (const column of columns) {
        if (!WRITABLE.has(column)) throw new Error(`Refusing to write unknown column "${column}"`);
      }
      const values = columns.map((c) => (c === 'draft_data' && fields[c] !== null ? JSON.stringify(fields[c]) : fields[c]));
      const insertCols = ['call_id', ...columns];
      const placeholders = insertCols.map((_, i) => `$${i + 1}`);
      const updates = columns.map((c) => `${c} = EXCLUDED.${c}`);
      const { rows } = await db.query(
        `INSERT INTO call_logs (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')})
         ON CONFLICT (call_id) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}
         RETURNING *`,
        [callId, ...values],
      );
      return rows[0] ?? this.findById(callId);
    },

    async findById(callId) {
      const { rows } = await db.query('SELECT * FROM call_logs WHERE call_id = $1', [callId]);
      return rows[0] ?? null;
    },

    async listByPatient(patientId) {
      const { rows } = await db.query(
        'SELECT * FROM call_logs WHERE patient_id = $1 ORDER BY created_at DESC',
        [patientId],
      );
      return rows;
    },

    async listRecent({ limit, offset, outcome }) {
      const params = [];
      let where = '';
      if (outcome) {
        params.push(outcome);
        where = 'WHERE c.outcome = $1';
      }
      params.push(limit, offset);
      const { rows } = await db.query(
        `SELECT c.*, p.first_name, p.last_name
         FROM call_logs c LEFT JOIN patients p ON p.patient_id = c.patient_id
         ${where}
         ORDER BY c.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return rows;
    },
  };
}
