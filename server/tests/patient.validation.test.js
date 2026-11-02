import { describe, expect, it } from 'vitest';
import { normalizeState, parseDateOfBirth, validatePatientInput } from '../src/domain/patient.js';
import { validPatient } from './helpers/testApp.js';

const fieldErrors = (input, mode) => validatePatientInput(input, { mode }).errors.map((e) => e.field);

describe('validatePatientInput (create)', () => {
  it('accepts a valid patient and normalizes formats', () => {
    const { value, errors } = validatePatientInput(validPatient());
    expect(errors).toEqual([]);
    expect(value).toMatchObject({
      date_of_birth: '1988-04-12',
      phone_number: '4155550134',
      email: 'jane.doe@example.com',
      state: 'CA',
      zip_code: '94110',
      preferred_language: 'English', // default applied
      insurance_provider: null,
    });
  });

  it('reports every missing required field', () => {
    expect(fieldErrors({}, 'create')).toEqual([
      'first_name', 'last_name', 'date_of_birth', 'sex', 'phone_number', 'address_line_1', 'city', 'state', 'zip_code',
    ]);
  });

  it('rejects unknown and read-only fields', () => {
    expect(fieldErrors({ ...validPatient(), patient_id: 'x', favorite_color: 'blue' })).toEqual(['patient_id', 'favorite_color']);
  });

  it('rejects non-object bodies', () => {
    expect(fieldErrors([], 'create')).toEqual(['_body']);
  });
});

describe('names', () => {
  it.each(["O'Brien", 'Mary-Kate', 'De La Cruz', 'José', 'Muñoz'])('accepts %s', (name) => {
    expect(fieldErrors({ ...validPatient(), last_name: name })).toEqual([]);
  });

  it.each(['J4ne', 'Jane!', '-Jane', 'a'.repeat(51)])('rejects %s', (name) => {
    expect(fieldErrors({ ...validPatient(), first_name: name })).toEqual(['first_name']);
  });

  it('normalizes curly apostrophes and whitespace', () => {
    expect(validatePatientInput({ ...validPatient(), last_name: '  O’Brien ' }).value.last_name).toBe("O'Brien");
  });
});

describe('date_of_birth', () => {
  it.each([
    ['04/12/1988', '1988-04-12'],
    ['4/2/1988', '1988-04-02'],
    ['1988-04-12', '1988-04-12'],
    ['04-12-1988', '1988-04-12'],
  ])('parses %s', (input, iso) => expect(parseDateOfBirth(input)).toBe(iso));

  it.each(['02/30/1990', '13/01/1990', 'March 3', '1990'])('rejects impossible or unparseable %s', (dob) => {
    expect(fieldErrors({ ...validPatient(), date_of_birth: dob })).toEqual(['date_of_birth']);
  });

  it('rejects a future date of birth', () => {
    const next = new Date();
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    const future = `${String(next.getUTCMonth() + 1).padStart(2, '0')}/01/${next.getUTCFullYear()}`;
    const { errors } = validatePatientInput({ ...validPatient(), date_of_birth: future });
    expect(errors).toEqual([{ field: 'date_of_birth', message: 'Date of birth cannot be in the future.' }]);
  });

  it('rejects dates before 1900', () => {
    expect(fieldErrors({ ...validPatient(), date_of_birth: '12/31/1899' })).toEqual(['date_of_birth']);
  });
});

describe('phone numbers', () => {
  it.each(['415-555-0134', '+1 (415) 555 0134', '14155550134', 4155550134])('normalizes %s', (phone) => {
    expect(validatePatientInput({ ...validPatient(), phone_number: phone }).value.phone_number).toBe('4155550134');
  });

  it('rejects a 3-digit phone number with a specific message', () => {
    const { errors } = validatePatientInput({ ...validPatient(), phone_number: '911' });
    expect(errors[0].field).toBe('phone_number');
    expect(errors[0].message).toMatch(/10-digit/);
  });

  it('rejects area codes starting with 0 or 1', () => {
    expect(fieldErrors({ ...validPatient(), phone_number: '1235550134' })).toEqual(['phone_number']);
  });

  it('validates the optional emergency contact phone too', () => {
    expect(fieldErrors({ ...validPatient(), emergency_contact_phone: '12345' })).toEqual(['emergency_contact_phone']);
  });
});

describe('address fields', () => {
  it.each([['ca', 'CA'], ['California', 'CA'], ['new york', 'NY'], ['D.C.', 'DC'], ['Washington DC', 'DC']])(
    'normalizes state %s -> %s',
    (input, abbr) => expect(normalizeState(input)).toBe(abbr),
  );

  it('rejects an unknown state', () => {
    expect(fieldErrors({ ...validPatient(), state: 'ZZ' })).toEqual(['state']);
  });

  it.each([['94110', '94110'], ['941101234', '94110-1234'], ['94110-1234', '94110-1234']])('normalizes ZIP %s', (zip, out) => {
    expect(validatePatientInput({ ...validPatient(), zip_code: zip }).value.zip_code).toBe(out);
  });

  it.each(['9411', '941101', 'ABCDE'])('rejects ZIP %s', (zip) => {
    expect(fieldErrors({ ...validPatient(), zip_code: zip })).toEqual(['zip_code']);
  });
});

describe('other fields', () => {
  it.each([['m', 'Male'], ['woman', 'Female'], ['prefer not to say', 'Decline to Answer'], ['Other', 'Other']])(
    'maps sex %s -> %s',
    (input, out) => expect(validatePatientInput({ ...validPatient(), sex: input }).value.sex).toBe(out),
  );

  it('rejects an invalid sex value', () => {
    expect(fieldErrors({ ...validPatient(), sex: 'unknown' })).toEqual(['sex']);
  });

  it('rejects invalid email', () => {
    expect(fieldErrors({ ...validPatient(), email: 'jane@' })).toEqual(['email']);
  });

  it('normalizes insurance member ids to uppercase alphanumerics', () => {
    expect(validatePatientInput({ ...validPatient(), insurance_member_id: 'xeb-123 456' }).value.insurance_member_id).toBe('XEB123456');
    expect(fieldErrors({ ...validPatient(), insurance_member_id: 'ABC#123' })).toEqual(['insurance_member_id']);
  });

  it('maps language names', () => {
    expect(validatePatientInput({ ...validPatient(), preferred_language: 'español' }).value.preferred_language).toBe('Spanish');
  });

  it('strips control characters', () => {
    expect(validatePatientInput({ ...validPatient(), city: 'San\u0000 Francisco\n' }).value.city).toBe('San Francisco');
  });

  it('rejects non-string values', () => {
    expect(fieldErrors({ ...validPatient(), city: { $ne: 1 } })).toEqual(['city']);
  });
});

describe('update and draft modes', () => {
  it('update: validates only supplied fields and forbids clearing required ones', () => {
    expect(validatePatientInput({ city: 'Oakland' }, { mode: 'update' }).errors).toEqual([]);
    expect(fieldErrors({ first_name: null }, 'update')).toEqual(['first_name']);
    expect(validatePatientInput({ email: null }, { mode: 'update' }).value).toEqual({ email: null });
  });

  it('draft: ignores blanks and missing required fields', () => {
    expect(validatePatientInput({ first_name: 'Jane', email: '' }, { mode: 'draft' })).toEqual({ value: { first_name: 'Jane' }, errors: [] });
  });
});
