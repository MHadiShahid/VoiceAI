import { randomUUID } from 'node:crypto';

// In-memory stand-ins that honour the same contract as the PostgreSQL
// repositories (soft delete, filters, unique provider slot, upsert).

export function createMemoryRepositories() {
  const patients = new Map();
  const appointments = new Map();
  const callLogs = new Map();
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const tick = () => new Date((clock += 1000));

  const active = () => [...patients.values()].filter((p) => !p.deleted_at);

  const patientRepo = {
    async create(data) {
      const now = tick();
      const row = { patient_id: randomUUID(), ...data, created_at: now, updated_at: now, deleted_at: null };
      patients.set(row.patient_id, row);
      return { ...row };
    },
    async findById(id) {
      const row = patients.get(id);
      return row && !row.deleted_at ? { ...row } : null;
    },
    async findByPhone(phone) {
      return active().filter((p) => p.phone_number === phone).map((p) => ({ ...p }));
    },
    async list({ lastName, dateOfBirth, phoneNumber, limit, offset }) {
      return active()
        .filter((p) => !lastName || p.last_name.toLowerCase().startsWith(lastName.toLowerCase()))
        .filter((p) => !dateOfBirth || p.date_of_birth === dateOfBirth)
        .filter((p) => !phoneNumber || p.phone_number === phoneNumber)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(offset, offset + limit)
        .map((p) => ({ ...p }));
    },
    async update(id, patch) {
      const row = patients.get(id);
      if (!row || row.deleted_at) return null;
      Object.assign(row, patch, { updated_at: tick() });
      return { ...row };
    },
    async softDelete(id) {
      const row = patients.get(id);
      if (!row || row.deleted_at) return null;
      row.deleted_at = tick();
      return { ...row };
    },
  };

  const appointmentRepo = {
    async create(data) {
      const taken = [...appointments.values()].some(
        (a) => a.status === 'scheduled' && a.provider_name === data.provider_name && +new Date(a.scheduled_at) === +new Date(data.scheduled_at),
      );
      if (taken) throw Object.assign(new Error('duplicate key'), { code: '23505' });
      const now = tick();
      const row = { appointment_id: randomUUID(), status: 'scheduled', ...data, created_at: now, updated_at: now };
      appointments.set(row.appointment_id, row);
      return { ...row };
    },
    async listByPatient(patientId) {
      return [...appointments.values()].filter((a) => a.patient_id === patientId);
    },
    async listBookedBetween(from, to) {
      return [...appointments.values()].filter(
        (a) => a.status === 'scheduled' && new Date(a.scheduled_at) >= from && new Date(a.scheduled_at) < to,
      );
    },
  };

  const callLogRepo = {
    async upsert(callId, fields) {
      const existing = callLogs.get(callId) ?? { call_id: callId, outcome: 'in_progress', created_at: tick() };
      const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      const row = { ...existing, ...defined, updated_at: tick() };
      callLogs.set(callId, row);
      return { ...row };
    },
    async findById(callId) {
      const row = callLogs.get(callId);
      return row ? { ...row } : null;
    },
    async listByPatient(patientId) {
      return [...callLogs.values()].filter((c) => c.patient_id === patientId);
    },
    async listRecent({ limit, offset, outcome }) {
      return [...callLogs.values()]
        .filter((c) => !outcome || c.outcome === outcome)
        .slice(offset, offset + limit);
    },
  };

  return {
    patients: patientRepo,
    appointments: appointmentRepo,
    callLogs: callLogRepo,
    _stores: { patients, appointments, callLogs },
  };
}
