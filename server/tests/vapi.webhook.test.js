import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { WEBHOOK_SECRET, buildTestApp, validPatient } from './helpers/testApp.js';
import { buildAssistantConfig } from '../src/voice/assistantConfig.js';

// Fixed clock: Monday 2 Nov 2026, 10:00 ET.
const NOW = new Date('2026-11-02T15:00:00Z');
let app;
let repositories;

beforeEach(() => {
  ({ app, repositories } = buildTestApp({ now: () => NOW }));
});

const CALL = { id: 'call-123', customer: { number: '+14155550134' } };
let toolCallSeq = 0;

/** Send a Vapi tool-calls message and return the parsed tool result. */
async function callTool(name, args, { call = CALL, secret = WEBHOOK_SECRET } = {}) {
  const id = `tc-${++toolCallSeq}`;
  const res = await request(app)
    .post('/api/vapi/webhook')
    .set('x-vapi-secret', secret)
    .send({ message: { type: 'tool-calls', call, toolCallList: [{ id, type: 'function', function: { name, arguments: args } }] } });
  expect(res.status).toBe(200);
  expect(res.body.results[0].toolCallId).toBe(id);
  return JSON.parse(res.body.results[0].result);
}

describe('webhook authentication', () => {
  it('rejects requests without the shared secret', async () => {
    const res = await request(app).post('/api/vapi/webhook').send({ message: { type: 'tool-calls', toolCallList: [] } });
    expect(res.status).toBe(401);
  });

  it('rejects a non-Vapi body', async () => {
    const res = await request(app).post('/api/vapi/webhook').set('x-vapi-secret', WEBHOOK_SECRET).send({ hello: 'world' });
    expect(res.status).toBe(400);
  });
});

describe('validate_patient_info', () => {
  it('returns per-field errors so the agent can re-prompt specifically', async () => {
    const result = await callTool('validate_patient_info', { first_name: 'Jane', phone_number: '555', date_of_birth: '01/01/2999' });
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.field)).toEqual(['date_of_birth', 'phone_number']);
    expect(result.missing_required_fields).toEqual(['last_name', 'sex', 'address_line_1', 'city', 'state', 'zip_code']);
  });

  it('returns normalized values and stores a draft for the call', async () => {
    const result = await callTool('validate_patient_info', { ...validPatient(), date_of_birth: '1988-04-12' });
    expect(result.valid).toBe(true);
    expect(result.normalized).toMatchObject({ date_of_birth: '04/12/1988', state: 'CA', phone_number: '4155550134' });
    const log = repositories._stores.callLogs.get('call-123');
    expect(log.draft_data.first_name).toBe('Jane');
    expect(log.caller_number).toBe('+14155550134');
  });

  it('accepts arguments delivered as a JSON string', async () => {
    const result = await callTool('validate_patient_info', JSON.stringify({ first_name: 'Jane' }));
    expect(result.normalized.first_name).toBe('Jane');
  });
});

describe('register_patient', () => {
  it('creates the patient through the service layer and links the call', async () => {
    const result = await callTool('register_patient', validPatient());
    expect(result).toMatchObject({ success: true, first_name: 'Jane' });
    const res = await request(app).get(`/api/patients/${result.patient_id}`);
    expect(res.body.data.last_name).toBe('Doe');
    expect(repositories._stores.callLogs.get('call-123')).toMatchObject({ patient_id: result.patient_id, outcome: 'registered' });
  });

  it('is idempotent within a call (a retry updates instead of duplicating)', async () => {
    const first = await callTool('register_patient', validPatient());
    const second = await callTool('register_patient', { ...validPatient(), last_name: 'Davis' });
    expect(second.patient_id).toBe(first.patient_id);
    const all = (await request(app).get('/api/patients')).body.data;
    expect(all).toHaveLength(1);
    expect(all[0].last_name).toBe('Davis');
  });

  it('returns validation errors instead of saving bad data', async () => {
    const result = await callTool('register_patient', { ...validPatient(), zip_code: '123' });
    expect(result).toMatchObject({ success: false, error_type: 'validation' });
    expect(result.errors).toEqual([{ field: 'zip_code', message: expect.stringMatching(/ZIP/) }]);
  });

  it('turns a database failure into a graceful system_error result (no silence)', async () => {
    repositories.patients.create = async () => {
      throw new Error('ECONNRESET');
    };
    const result = await callTool('register_patient', validPatient());
    expect(result).toMatchObject({ success: false, error_type: 'system_error' });
    expect(result.next_step).toMatch(/Never say it was saved/);
  });
});

describe('duplicate detection', () => {
  beforeEach(async () => {
    await request(app).post('/api/patients').send(validPatient());
  });

  it('check_existing_patient recognizes a returning caller by phone number', async () => {
    const result = await callTool('check_existing_patient', { phone_number: '415 555 0134' }, { call: { id: 'call-2' } });
    expect(result.found).toBe(true);
    expect(result.patient).toMatchObject({ first_name: 'Jane', last_name: 'Doe' });
    expect(result.next_step).toMatch(/already have a record/);
  });

  it('check_existing_patient reveals only the name until identity is verified', async () => {
    const { patient } = await callTool('check_existing_patient', { phone_number: '4155550134' }, { call: { id: 'call-min' } });
    expect(Object.keys(patient).sort()).toEqual(['first_name', 'last_name', 'patient_id']);
  });

  it('check_existing_patient returns found=false for new numbers', async () => {
    expect(await callTool('check_existing_patient', { phone_number: '2125550111' }, { call: { id: 'call-3' } })).toEqual({ found: false });
  });

  it('register_patient refuses a duplicate phone unless explicitly allowed', async () => {
    const call = { id: 'call-4' };
    const blocked = await callTool('register_patient', { ...validPatient(), first_name: 'Jim' }, { call });
    expect(blocked).toMatchObject({ success: false, error_type: 'duplicate_phone', existing_patient: { first_name: 'Jane' } });

    const allowed = await callTool('register_patient', { ...validPatient(), first_name: 'Jim', allow_duplicate_phone: true }, { call });
    expect(allowed.success).toBe(true);
  });

  it('verify_patient_identity releases the record only for the correct DOB, without leaking it', async () => {
    const call = { id: 'call-v' };
    const { patient } = await callTool('check_existing_patient', { phone_number: '4155550134' }, { call });

    const wrong = await callTool('verify_patient_identity', { patient_id: patient.patient_id, date_of_birth: '01/01/1990' }, { call });
    expect(wrong).toMatchObject({ verified: false, attempts_remaining: 2 });
    expect(JSON.stringify(wrong)).not.toMatch(/1988|Evergreen|04\/12/); // nothing from the record

    const right = await callTool('verify_patient_identity', { patient_id: patient.patient_id, date_of_birth: '1988-04-12' }, { call });
    expect(right.verified).toBe(true);
    expect(right.patient).toMatchObject({ address_line_1: '742 Evergreen Terrace', date_of_birth: '04/12/1988' });
    expect(repositories._stores.callLogs.get('call-v')).toMatchObject({ verified_patient_id: patient.patient_id, identity_attempts: 2 });
  });

  it('locks verification after 3 failed attempts in a call', async () => {
    const call = { id: 'call-lock' };
    const { patient } = await callTool('check_existing_patient', { phone_number: '4155550134' }, { call });
    for (const dob of ['01/01/1990', '02/02/1991', '03/03/1992']) {
      await callTool('verify_patient_identity', { patient_id: patient.patient_id, date_of_birth: dob }, { call });
    }
    // Even the correct DOB is refused once locked.
    const locked = await callTool('verify_patient_identity', { patient_id: patient.patient_id, date_of_birth: '04/12/1988' }, { call });
    expect(locked).toMatchObject({ verified: false, locked: true });
    expect(locked.patient).toBeUndefined();
  });

  it('server refuses updates and bookings for an unverified patient (prompt-injection guard)', async () => {
    const call = { id: 'call-inject' };
    const { patient } = await callTool('check_existing_patient', { phone_number: '4155550134' }, { call });
    const update = await callTool('update_patient', { patient_id: patient.patient_id, city: 'Hacked' }, { call });
    expect(update).toMatchObject({ success: false, error_type: 'not_verified' });
    const booking = await callTool(
      'book_appointment',
      { patient_id: patient.patient_id, start_time: '2026-11-03T14:00:00.000Z', provider_name: 'Dr. Sarah Chen' },
      { call },
    );
    expect(booking).toMatchObject({ success: false, error_type: 'not_verified' });
    expect((await request(app).get(`/api/patients/${patient.patient_id}`)).body.data.city).toBe('San Francisco');

    // Verification on a *different* call doesn't carry over.
    await callTool('verify_patient_identity', { patient_id: patient.patient_id, date_of_birth: '04/12/1988' }, { call: { id: 'other-call' } });
    expect(await callTool('update_patient', { patient_id: patient.patient_id, city: 'Hacked' }, { call })).toMatchObject({ error_type: 'not_verified' });
  });

  it('a call that updated its caller and then registers someone else creates a new record', async () => {
    const call = { id: 'call-family' };
    const { patient } = await callTool('check_existing_patient', { phone_number: '4155550134' }, { call });
    await callTool('verify_patient_identity', { patient_id: patient.patient_id, date_of_birth: '04/12/1988' }, { call });
    await callTool('update_patient', { patient_id: patient.patient_id, city: 'Oakland' }, { call });

    const child = await callTool('register_patient', { ...validPatient(), first_name: 'Jimmy', allow_duplicate_phone: true }, { call });
    expect(child.success).toBe(true);
    expect(child.patient_id).not.toBe(patient.patient_id);
    expect((await request(app).get(`/api/patients/${patient.patient_id}`)).body.data.first_name).toBe('Jane');
  });

  it('update_patient applies only the changed fields after verification', async () => {
    const { patient } = await callTool('check_existing_patient', { phone_number: '4155550134' }, { call: { id: 'call-5' } });
    await callTool('verify_patient_identity', { patient_id: patient.patient_id, date_of_birth: '04/12/1988' }, { call: { id: 'call-5' } });
    const result = await callTool('update_patient', { patient_id: patient.patient_id, city: 'Oakland', zip_code: '94612' }, { call: { id: 'call-5' } });
    expect(result).toMatchObject({ success: true, updated_fields: ['city', 'zip_code'] });
    const updated = (await request(app).get(`/api/patients/${patient.patient_id}`)).body.data;
    expect(updated).toMatchObject({ city: 'Oakland', zip_code: '94612', first_name: 'Jane' });
    expect(repositories._stores.callLogs.get('call-5').outcome).toBe('updated');
  });

  it('verify_patient_identity reports not_found for an unknown patient', async () => {
    const result = await callTool('verify_patient_identity', { patient_id: '00000000-0000-4000-8000-000000000000', date_of_birth: '04/12/1988' });
    expect(result).toMatchObject({ success: false, error_type: 'not_found' });
  });
});

describe('appointments', () => {
  it('lists open slots and books one', async () => {
    const { patient_id } = await callTool('register_patient', validPatient());
    const { slots } = await callTool('get_available_appointments', { time_of_day: 'morning' });
    expect(slots).toHaveLength(3);
    expect(slots[0].label).toMatch(/^Tuesday, November 3 at 9:00/);

    const booked = await callTool('book_appointment', { patient_id, start_time: slots[0].start_time, provider_name: slots[0].provider_name });
    expect(booked).toMatchObject({ success: true, provider_name: slots[0].provider_name });

    // The booked slot is no longer offered for that provider and cannot be double-booked.
    const again = await callTool('book_appointment', { patient_id, start_time: slots[0].start_time, provider_name: slots[0].provider_name });
    expect(again).toMatchObject({ success: false, error_type: 'conflict' });

    const res = await request(app).get(`/api/patients/${patient_id}/appointments`);
    expect(res.body.data).toHaveLength(1);
  });

  it('rejects times that are not real clinic slots', async () => {
    const { patient_id } = await callTool('register_patient', validPatient());
    const result = await callTool('book_appointment', { patient_id, start_time: '2026-11-08T15:00:00Z', provider_name: 'Dr. Sarah Chen' });
    expect(result).toMatchObject({ success: false, error_type: 'validation' });
  });
});

describe('end-of-call-report', () => {
  const report = (call, extra = {}) =>
    request(app)
      .post('/api/vapi/webhook')
      .set('x-vapi-secret', WEBHOOK_SECRET)
      .send({
        message: {
          type: 'end-of-call-report',
          call,
          endedReason: 'customer-ended-call',
          startedAt: '2026-11-02T15:00:00Z',
          endedAt: '2026-11-02T15:03:30Z',
          artifact: { transcript: 'AI: Hi\nUser: Hello', recording: { stereoUrl: 'https://example.com/rec.wav' } },
          analysis: { summary: 'Caller registered.' },
          ...extra,
        },
      });

  it('stores the transcript and summary linked to the registered patient', async () => {
    const { patient_id } = await callTool('register_patient', validPatient());
    expect((await report(CALL)).status).toBe(200);

    const calls = (await request(app).get(`/api/patients/${patient_id}/calls`)).body.data;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      outcome: 'registered',
      summary: 'Caller registered.',
      transcript: 'AI: Hi\nUser: Hello',
      recording_url: 'https://example.com/rec.wav',
      duration_seconds: 210,
    });
  });

  it('marks a dropped call as incomplete and keeps the partial data', async () => {
    const call = { id: 'dropped-1', customer: { number: '+12125550111' } };
    await callTool('validate_patient_info', { first_name: 'Sam', last_name: 'Lee' }, { call });
    await report(call, { endedReason: 'customer-ended-call' });

    const log = (await request(app).get('/api/calls/dropped-1')).body.data;
    expect(log).toMatchObject({ outcome: 'incomplete', draft_data: { first_name: 'Sam', last_name: 'Lee' }, patient_id: null });
    expect((await request(app).get('/api/calls?outcome=incomplete')).body.data).toHaveLength(1);
  });

  it('acknowledges even if persisting the report fails', async () => {
    repositories.callLogs.upsert = async () => {
      throw new Error('db down');
    };
    expect((await report({ id: 'x' })).body).toEqual({ ok: false });
  });
});

describe('assistant config', () => {
  it('builds a Vapi assistant using Gemini, all tools, and the authenticated webhook', () => {
    const cfg = buildAssistantConfig({ serverUrl: 'https://example.com/api/vapi/webhook', webhookSecret: 's3cret' });
    expect(cfg.model.provider).toBe('google');
    expect(cfg.model.tools.map((t) => t.function?.name ?? t.type)).toEqual([
      'check_existing_patient', 'verify_patient_identity', 'validate_patient_info', 'register_patient', 'update_patient',
      'get_available_appointments', 'book_appointment', 'endCall',
    ]);
    expect(cfg.server.headers['x-vapi-secret']).toBe('s3cret');
    expect(cfg.transcriber.language).toBe('multi');
    expect(cfg.model.messages[0].content).toContain('Would you like to provide any of those?');
  });
});
