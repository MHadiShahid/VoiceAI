-- Patient registration schema (PostgreSQL 14+ / Neon).
--
-- Idempotent: safe to run repeatedly (`npm run db:migrate`).
-- The CHECK constraints mirror server/src/domain/patient.js so that bad data
-- cannot enter the table even if a client bypasses the API.

-- ─── Enum types ────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE patient_sex AS ENUM ('Male', 'Female', 'Other', 'Decline to Answer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Shared trigger: keep updated_at current ───────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Patients ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  patient_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name              VARCHAR(50)  NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 50 AND first_name !~ '[0-9]'),
  last_name               VARCHAR(50)  NOT NULL CHECK (char_length(last_name)  BETWEEN 1 AND 50 AND last_name  !~ '[0-9]'),
  date_of_birth           DATE         NOT NULL CHECK (date_of_birth >= DATE '1900-01-01' AND date_of_birth <= (now() AT TIME ZONE 'UTC')::date + 1),
  sex                     patient_sex  NOT NULL,
  phone_number            CHAR(10)     NOT NULL CHECK (phone_number ~ '^[2-9][0-9]{9}$'),
  email                   VARCHAR(254)          CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  address_line_1          VARCHAR(100) NOT NULL CHECK (char_length(address_line_1) >= 1),
  address_line_2          VARCHAR(100),
  city                    VARCHAR(100) NOT NULL CHECK (char_length(city) >= 1),
  state                   CHAR(2)      NOT NULL CHECK (state IN (
                            'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
                            'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
                            'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
                            'DC','PR','GU','VI','AS','MP')),
  zip_code                VARCHAR(10)  NOT NULL CHECK (zip_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  insurance_provider      VARCHAR(100),
  insurance_member_id     VARCHAR(50)           CHECK (insurance_member_id ~ '^[A-Z0-9]+$'),
  preferred_language      VARCHAR(50)  NOT NULL DEFAULT 'English',
  emergency_contact_name  VARCHAR(100),
  emergency_contact_phone CHAR(10)              CHECK (emergency_contact_phone ~ '^[2-9][0-9]{9}$'),
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);

-- Lookups used by GET /patients filters and duplicate detection. Partial
-- indexes skip soft-deleted rows, which every query excludes anyway.
CREATE INDEX IF NOT EXISTS patients_phone_idx     ON patients (phone_number)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS patients_last_name_idx ON patients (lower(last_name))  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS patients_dob_idx       ON patients (date_of_birth)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS patients_created_idx   ON patients (created_at DESC)   WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS patients_set_updated_at ON patients;
CREATE TRIGGER patients_set_updated_at BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Appointments (bonus: scheduling against a mock provider calendar) ─────
CREATE TABLE IF NOT EXISTS appointments (
  appointment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID         NOT NULL REFERENCES patients (patient_id),
  provider_name    VARCHAR(100) NOT NULL,
  scheduled_at     TIMESTAMPTZ  NOT NULL,
  duration_minutes INTEGER      NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 240),
  reason           VARCHAR(200),
  status           VARCHAR(20)  NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- A provider cannot be double-booked.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_provider_slot_uniq
  ON appointments (provider_name, scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS appointments_patient_idx ON appointments (patient_id);

DROP TRIGGER IF EXISTS appointments_set_updated_at ON appointments;
CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Call logs (bonus: transcript / summary linked to the patient) ─────────
-- One row per Vapi call. Created on the first tool call (so a dropped call
-- still leaves a trace of what was collected) and completed by Vapi's
-- end-of-call-report webhook.
CREATE TABLE IF NOT EXISTS call_logs (
  call_id          VARCHAR(100) PRIMARY KEY,
  patient_id       UUID REFERENCES patients (patient_id),
  caller_number    VARCHAR(20),
  outcome          VARCHAR(20)  NOT NULL DEFAULT 'in_progress'
                     CHECK (outcome IN ('in_progress', 'registered', 'updated', 'incomplete')),
  draft_data       JSONB,
  ended_reason     VARCHAR(200),
  summary          TEXT,
  transcript       TEXT,
  recording_url    TEXT,
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  duration_seconds NUMERIC(10, 2),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_logs_patient_idx ON call_logs (patient_id);
CREATE INDEX IF NOT EXISTS call_logs_created_idx ON call_logs (created_at DESC);

DROP TRIGGER IF EXISTS call_logs_set_updated_at ON call_logs;
CREATE TRIGGER call_logs_set_updated_at BEFORE UPDATE ON call_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
