// Inserts two fictional demo patients (skipped if their phone numbers already exist).
// Usage: npm run db:seed
import { closePool, getPool } from './pool.js';
import { createPatientRepository } from '../repositories/patientRepository.js';
import { validatePatientInput } from '../domain/patient.js';

const SEED_PATIENTS = [
  {
    first_name: 'Jane',
    last_name: 'Doe',
    date_of_birth: '04/12/1988',
    sex: 'Female',
    phone_number: '4155550134',
    email: 'jane.doe@example.com',
    address_line_1: '742 Evergreen Terrace',
    address_line_2: 'Apt 3B',
    city: 'San Francisco',
    state: 'CA',
    zip_code: '94110',
    insurance_provider: 'Blue Shield of California',
    insurance_member_id: 'XEB123456789',
    preferred_language: 'English',
    emergency_contact_name: 'John Doe',
    emergency_contact_phone: '4155550199',
  },
  {
    first_name: 'Carlos',
    last_name: 'Muñoz-García',
    date_of_birth: '11/30/1975',
    sex: 'Male',
    phone_number: '3055550172',
    address_line_1: '1200 Brickell Avenue',
    city: 'Miami',
    state: 'FL',
    zip_code: '33131-3200',
    preferred_language: 'Spanish',
  },
];

try {
  const repo = createPatientRepository(getPool());
  for (const input of SEED_PATIENTS) {
    const { value, errors } = validatePatientInput(input, { mode: 'create' });
    if (errors.length) throw new Error(`Invalid seed record: ${JSON.stringify(errors)}`);
    const existing = await repo.findByPhone(value.phone_number);
    if (existing.length) {
      console.log(`Skipping ${value.first_name} ${value.last_name} (already present).`);
      continue;
    }
    const row = await repo.create(value);
    console.log(`Seeded ${row.first_name} ${row.last_name} -> ${row.patient_id}`);
  }
} catch (error) {
  console.error('Seeding failed:', error.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
