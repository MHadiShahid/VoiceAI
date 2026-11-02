import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, validPatient } from './helpers/testApp.js';

let app;
let repositories;

beforeEach(() => {
  ({ app, repositories } = buildTestApp());
});

const createPatient = (overrides = {}) => request(app).post('/api/patients').send({ ...validPatient(), ...overrides });

describe('POST /api/patients', () => {
  it('creates a patient and returns 201 with the envelope', async () => {
    const res = await createPatient();
    expect(res.status).toBe(201);
    expect(res.body.error).toBeNull();
    expect(res.body.data).toMatchObject({
      first_name: 'Jane',
      date_of_birth: '04/12/1988',
      phone_number: '4155550134',
      state: 'CA',
      preferred_language: 'English',
    });
    expect(res.body.data.patient_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.data.created_at).toMatch(/Z$/);
  });

  it('returns 422 with per-field details for invalid data', async () => {
    const res = await createPatient({ phone_number: '555', date_of_birth: '01/01/2999' });
    expect(res.status).toBe(422);
    expect(res.body.data).toBeNull();
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.map((d) => d.field)).toEqual(['date_of_birth', 'phone_number']);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app).post('/api/patients').set('Content-Type', 'application/json').send('{"first_name":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('returns 500 with a generic message when the database fails', async () => {
    repositories.patients.create = async () => {
      throw new Error('connection terminated');
    };
    const res = await createPatient();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ data: null, error: { code: 'internal_error', message: expect.any(String) } });
  });
});

describe('GET /api/patients', () => {
  beforeEach(async () => {
    await createPatient();
    await createPatient({ first_name: 'John', last_name: 'Davis', phone_number: '2125550111', date_of_birth: '01/02/1970' });
  });

  it('lists all patients', async () => {
    const res = await request(app).get('/api/patients');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('filters by last_name (case-insensitive prefix)', async () => {
    const res = await request(app).get('/api/patients?last_name=dav');
    expect(res.body.data.map((p) => p.last_name)).toEqual(['Davis']);
  });

  it('filters by date_of_birth in MM/DD/YYYY', async () => {
    const res = await request(app).get('/api/patients').query({ date_of_birth: '04/12/1988' });
    expect(res.body.data.map((p) => p.first_name)).toEqual(['Jane']);
  });

  it('filters by phone_number in any format', async () => {
    const res = await request(app).get('/api/patients').query({ phone_number: '(212) 555-0111' });
    expect(res.body.data.map((p) => p.first_name)).toEqual(['John']);
  });

  it('returns 400 for invalid filters', async () => {
    expect((await request(app).get('/api/patients?date_of_birth=nope')).status).toBe(400);
    expect((await request(app).get('/api/patients?phone_number=123')).status).toBe(400);
    expect((await request(app).get('/api/patients?limit=0')).status).toBe(400);
  });
});

describe('GET/PUT/DELETE /api/patients/:id', () => {
  let id;
  beforeEach(async () => {
    id = (await createPatient()).body.data.patient_id;
  });

  it('gets a patient by id', async () => {
    const res = await request(app).get(`/api/patients/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.patient_id).toBe(id);
  });

  it('returns 400 for a non-UUID id and 404 for an unknown one', async () => {
    expect((await request(app).get('/api/patients/not-a-uuid')).status).toBe(400);
    expect((await request(app).get('/api/patients/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('applies partial updates and bumps updated_at', async () => {
    const before = (await request(app).get(`/api/patients/${id}`)).body.data;
    const res = await request(app).put(`/api/patients/${id}`).send({ last_name: 'Davis', email: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ last_name: 'Davis', email: null, first_name: 'Jane' });
    expect(res.body.data.updated_at > before.updated_at).toBe(true);
  });

  it('rejects invalid or empty updates with 422', async () => {
    expect((await request(app).put(`/api/patients/${id}`).send({ zip_code: '1' })).status).toBe(422);
    expect((await request(app).put(`/api/patients/${id}`).send({})).status).toBe(422);
    expect((await request(app).put(`/api/patients/${id}`).send({ first_name: '' })).status).toBe(422);
  });

  it('soft-deletes: record disappears from the API but remains stored', async () => {
    const res = await request(app).delete(`/api/patients/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted_at).toBeTruthy();
    expect((await request(app).get(`/api/patients/${id}`)).status).toBe(404);
    expect((await request(app).get('/api/patients')).body.data).toHaveLength(0);
    expect((await request(app).delete(`/api/patients/${id}`)).status).toBe(404);
    expect(repositories._stores.patients.get(id).deleted_at).toBeTruthy();
  });
});

describe('misc endpoints', () => {
  it('serves health and info', async () => {
    expect((await request(app).get('/api/health')).body.data.status).toBe('ok');
    const info = (await request(app).get('/api/info')).body.data;
    expect(info.phone_number).toBe('+15555550100');
    expect(info.web_call).toEqual({ public_key: 'pub-key', assistant_id: 'asst-1' });
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
