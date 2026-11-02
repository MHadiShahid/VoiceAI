import { BadRequestError, ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { addDays, zonedDateString, zonedParts, zonedTimeToUtc } from '../lib/timezone.js';
import { cleanText } from '../domain/patient.js';
import { assertUuid } from './patientService.js';

// ─── Mock clinic calendar ────────────────────────────────────────────────────
// The schedule is generated, not stored: weekdays, hourly slots with a lunch
// break, two providers. Only *booked* appointments live in the database, and a
// partial unique index prevents double-booking a provider.
export const PROVIDERS = Object.freeze(['Dr. Sarah Chen', 'Dr. Marcus Rivera']);
const SLOT_HOURS = [9, 10, 11, 13, 14, 15];
const SLOT_MINUTES = 30;
const SEARCH_WINDOW_DAYS = 21;
const MAX_ADVANCE_DAYS = 90;

const TIME_OF_DAY_HOURS = {
  morning: (h) => h < 12,
  afternoon: (h) => h >= 12,
  any: () => true,
};

export function toAppointmentDto(row, timeZone) {
  if (!row) return null;
  const scheduledAt = new Date(row.scheduled_at);
  return {
    appointment_id: row.appointment_id,
    patient_id: row.patient_id,
    provider_name: row.provider_name,
    scheduled_at: scheduledAt.toISOString(),
    scheduled_label: spokenLabel(scheduledAt, timeZone),
    duration_minutes: row.duration_minutes,
    reason: row.reason ?? null,
    status: row.status,
    created_at: new Date(row.created_at).toISOString(),
  };
}

/** "Tuesday, November 4 at 10:00 AM Eastern" — written to be read aloud. */
export function spokenLabel(date, timeZone) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
  return `${day} at ${time}`;
}

export function createAppointmentService({ appointmentRepository, patientRepository, timeZone, logger, now = () => new Date() }) {
  function isOnGrid(date, providerName) {
    if (!PROVIDERS.includes(providerName)) return false;
    const p = zonedParts(date, timeZone);
    return p.weekday >= 1 && p.weekday <= 5 && SLOT_HOURS.includes(p.hour) && p.minute === 0 && p.second === 0;
  }

  return {
    providers: PROVIDERS,

    /**
     * Next open slots on or after `preferredDate` (clinic-local "YYYY-MM-DD",
     * defaults to tomorrow), optionally restricted to morning/afternoon.
     */
    async findAvailableSlots({ preferredDate, timeOfDay = 'any', limit = 4 } = {}) {
      const filter = TIME_OF_DAY_HOURS[timeOfDay] ?? TIME_OF_DAY_HOURS.any;
      const tomorrow = addDays(zonedDateString(now(), timeZone), 1);
      const startDate = preferredDate && preferredDate > tomorrow ? preferredDate : tomorrow;
      if (startDate > addDays(tomorrow, MAX_ADVANCE_DAYS)) {
        throw new BadRequestError(`Appointments can only be booked up to ${MAX_ADVANCE_DAYS} days ahead.`);
      }

      const rangeStart = zonedTimeToUtc({ ...splitDate(startDate), hour: 0 }, timeZone);
      const rangeEnd = zonedTimeToUtc({ ...splitDate(addDays(startDate, SEARCH_WINDOW_DAYS)), hour: 0 }, timeZone);
      const booked = new Set(
        (await appointmentRepository.listBookedBetween(rangeStart, rangeEnd)).map(
          (b) => `${b.provider_name}|${new Date(b.scheduled_at).toISOString()}`,
        ),
      );

      const slots = [];
      for (let offset = 0; offset < SEARCH_WINDOW_DAYS && slots.length < limit; offset += 1) {
        const date = splitDate(addDays(startDate, offset));
        const noon = zonedTimeToUtc({ ...date, hour: 12 }, timeZone);
        const weekday = zonedParts(noon, timeZone).weekday;
        if (weekday === 0 || weekday === 6) continue;

        for (const hour of SLOT_HOURS.filter(filter)) {
          // Alternate which provider is offered first so options feel varied.
          const providers = (date.day + hour) % 2 ? PROVIDERS : [...PROVIDERS].reverse();
          const start = zonedTimeToUtc({ ...date, hour }, timeZone);
          const provider = providers.find((name) => !booked.has(`${name}|${start.toISOString()}`));
          if (!provider) continue;
          slots.push({ start_time: start.toISOString(), provider_name: provider, label: spokenLabel(start, timeZone) });
          // Offer at most two slots per day to give the caller a spread of days.
          if (slots.filter((s) => s.start_time.slice(0, 10) === start.toISOString().slice(0, 10)).length >= 2) break;
          if (slots.length >= limit) break;
        }
      }
      return slots;
    },

    async book({ patient_id, start_time, provider_name, reason }) {
      assertUuid(patient_id);
      const patient = await patientRepository.findById(patient_id);
      if (!patient) throw new NotFoundError(`Patient ${patient_id} not found.`);

      const start = new Date(start_time);
      const errors = [];
      if (Number.isNaN(start.getTime())) errors.push({ field: 'start_time', message: 'start_time must be an ISO-8601 timestamp.' });
      else if (start <= now()) errors.push({ field: 'start_time', message: 'Appointment must be in the future.' });
      else if (!isOnGrid(start, provider_name)) {
        errors.push({ field: 'start_time', message: 'That is not an available clinic slot for this provider.' });
      }
      if (!PROVIDERS.includes(provider_name)) {
        errors.push({ field: 'provider_name', message: `provider_name must be one of: ${PROVIDERS.join(', ')}.` });
      }
      const cleanReason = reason ? cleanText(reason).slice(0, 200) : null;
      if (errors.length) throw new ValidationError(errors);

      try {
        const row = await appointmentRepository.create({
          patient_id,
          provider_name,
          scheduled_at: start,
          duration_minutes: SLOT_MINUTES,
          reason: cleanReason,
        });
        const appointment = toAppointmentDto(row, timeZone);
        logger.info('appointment.booked', { appointment });
        return appointment;
      } catch (error) {
        if (error.code === '23505') throw new ConflictError('That time slot was just booked. Please choose another.');
        throw error;
      }
    },

    async listForPatient(patientId) {
      assertUuid(patientId);
      const rows = await appointmentRepository.listByPatient(patientId);
      return rows.map((row) => toAppointmentDto(row, timeZone));
    },
  };
}

function splitDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}
