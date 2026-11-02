// Patient domain model: field definitions, normalization and validation.
//
// This module is the single source of truth for what a valid patient looks
// like. It is used by BOTH the REST API and the voice agent's tools, so the
// phone agent can never persist something the API would reject (and vice
// versa). The database schema (db/schema.sql) mirrors these rules as CHECK
// constraints as a last line of defence.
//
// Normalizers are deliberately forgiving about *format* (callers and LLMs say
// "(555) 123-4567", "California", "march 3rd 1990" -> the LLM converts to
// 03/03/1990) while validators are strict about *content*.

export const SEX_VALUES = Object.freeze(['Male', 'Female', 'Other', 'Decline to Answer']);

export const US_STATES = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia', PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands',
  AS: 'American Samoa', MP: 'Northern Mariana Islands',
});

const STATE_BY_NAME = new Map(
  Object.entries(US_STATES).map(([abbr, name]) => [name.toLowerCase().replace(/[^a-z ]/g, ''), abbr]),
);
STATE_BY_NAME.set('washington dc', 'DC');
STATE_BY_NAME.set('virgin islands', 'VI');

// Synonyms the LLM or an API client might send for the sex enum.
const SEX_SYNONYMS = new Map([
  ['male', 'Male'], ['m', 'Male'], ['man', 'Male'], ['masculino', 'Male'], ['hombre', 'Male'],
  ['female', 'Female'], ['f', 'Female'], ['woman', 'Female'], ['femenino', 'Female'], ['mujer', 'Female'],
  ['other', 'Other'], ['otro', 'Other'], ['non-binary', 'Other'], ['nonbinary', 'Other'],
  ['decline to answer', 'Decline to Answer'], ['decline', 'Decline to Answer'],
  ['prefer not to say', 'Decline to Answer'], ['prefer not to answer', 'Decline to Answer'],
  ['prefiero no decir', 'Decline to Answer'],
]);

const LANGUAGE_SYNONYMS = new Map([
  ['en', 'English'], ['eng', 'English'], ['english', 'English'], ['ingles', 'English'], ['inglés', 'English'],
  ['es', 'Spanish'], ['spa', 'Spanish'], ['spanish', 'Spanish'], ['espanol', 'Spanish'], ['español', 'Spanish'],
]);

// Letters (any script, so "José" and "Muñoz" work), joined by single spaces,
// hyphens or apostrophes: "Mary-Kate", "O'Brien", "De La Cruz".
const NAME_RE = /^\p{L}+(?:[ '-]\p{L}+)*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ZIP_RE = /^\d{5}(?:-\d{4})?$/;
const MEMBER_ID_RE = /^[A-Z0-9]{1,50}$/;
const LANGUAGE_RE = /^\p{L}[\p{L} ()-]{0,49}$/u;
const MAX_RAW_LENGTH = 500;

// ─── Primitive normalizers ─────────────────────────────────────────────────

/** Strip control characters, trim, and collapse internal whitespace. */
export function cleanText(value) {
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  return cleanText(value).replace(/[‘’ʼ`]/g, "'");
}

/** "(555) 123-4567", "+1 555 123 4567" -> "5551234567". */
export function normalizePhone(value) {
  let digits = String(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits;
}

/**
 * Parse a date of birth into ISO "YYYY-MM-DD".
 * Accepts MM/DD/YYYY (the spec format), M/D/YYYY, MM-DD-YYYY and YYYY-MM-DD.
 * Returns null if the string is not a real calendar date.
 */
export function parseDateOfBirth(value) {
  const text = cleanText(value);
  let year, month, day;
  let match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    [, month, day, year] = match.map(Number);
  } else if ((match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    [, year, month, day] = match.map(Number);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isRealDate) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ISO "YYYY-MM-DD" (or Date) -> "MM/DD/YYYY". */
export function formatDateOfBirth(value) {
  if (!value) return value;
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const [year, month, day] = iso.split('-');
  return `${month}/${day}/${year}`;
}

function todayIsoUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeState(value) {
  const text = cleanText(value);
  const upper = text.toUpperCase().replace(/\./g, '');
  if (US_STATES[upper]) return upper;
  return STATE_BY_NAME.get(text.toLowerCase().replace(/[^a-z ]/g, '').trim()) ?? upper;
}

function normalizeZip(value) {
  const text = cleanText(value);
  const digits = text.replace(/\D/g, '');
  if (/^[\d\s-]+$/.test(text) && digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  if (/^[\d\s]+$/.test(text) && digits.length === 5) return digits;
  return text;
}

function normalizeSex(value) {
  const text = cleanText(value).toLowerCase();
  return SEX_SYNONYMS.get(text) ?? cleanText(value);
}

function normalizeLanguage(value) {
  const text = cleanText(value);
  const known = LANGUAGE_SYNONYMS.get(text.toLowerCase());
  if (known) return known;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

// ─── Field validators ──────────────────────────────────────────────────────

const nameValidator = (label, max) => (v) => {
  if (v.length < 1 || v.length > max) return `${label} must be between 1 and ${max} characters.`;
  if (!NAME_RE.test(v)) return `${label} may only contain letters, spaces, hyphens and apostrophes.`;
  return null;
};

const lengthValidator = (label, min, max) => (v) =>
  v.length < min || v.length > max ? `${label} must be between ${min} and ${max} characters.` : null;

const phoneValidator = (label) => (v) => {
  if (v.length !== 10) return `${label} must be a 10-digit U.S. phone number (received ${v.length} digits).`;
  if (!/^[2-9]/.test(v)) return `${label} has an invalid area code; U.S. area codes cannot start with 0 or 1.`;
  return null;
};

function validateDateOfBirth(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Date of birth must be a real date in MM/DD/YYYY format.';
  if (v > todayIsoUtc()) return 'Date of birth cannot be in the future.';
  if (v < '1900-01-01') return 'Date of birth must be after 01/01/1900.';
  return null;
}

/**
 * Field catalogue. Order matters: it is the order fields are reported in
 * validation errors and read back by the agent.
 *  - required:  must be present on create
 *  - normalize: string -> canonical string (never throws)
 *  - validate:  canonical string -> error message | null
 */
export const PATIENT_FIELDS = Object.freeze({
  first_name: { required: true, normalize: normalizeName, validate: nameValidator('First name', 50) },
  last_name: { required: true, normalize: normalizeName, validate: nameValidator('Last name', 50) },
  date_of_birth: {
    required: true,
    normalize: (v) => parseDateOfBirth(v) ?? cleanText(v),
    validate: validateDateOfBirth,
  },
  sex: {
    required: true,
    normalize: normalizeSex,
    validate: (v) => (SEX_VALUES.includes(v) ? null : `Sex must be one of: ${SEX_VALUES.join(', ')}.`),
  },
  phone_number: { required: true, normalize: normalizePhone, validate: phoneValidator('Phone number') },
  email: {
    required: false,
    normalize: (v) => cleanText(v).toLowerCase(),
    validate: (v) => (v.length <= 254 && EMAIL_RE.test(v) ? null : 'Email must be a valid email address.'),
  },
  address_line_1: { required: true, normalize: cleanText, validate: lengthValidator('Street address', 1, 100) },
  address_line_2: { required: false, normalize: cleanText, validate: lengthValidator('Address line 2', 1, 100) },
  city: {
    required: true,
    normalize: cleanText,
    validate: (v) => lengthValidator('City', 1, 100)(v) ?? (/\p{L}/u.test(v) ? null : 'City must contain letters.'),
  },
  state: {
    required: true,
    normalize: normalizeState,
    validate: (v) => (US_STATES[v] ? null : 'State must be a valid 2-letter U.S. state abbreviation.'),
  },
  zip_code: {
    required: true,
    normalize: normalizeZip,
    validate: (v) => (ZIP_RE.test(v) ? null : 'ZIP code must be 5 digits or ZIP+4 (12345-6789).'),
  },
  insurance_provider: { required: false, normalize: cleanText, validate: lengthValidator('Insurance provider', 1, 100) },
  insurance_member_id: {
    required: false,
    normalize: (v) => cleanText(v).toUpperCase().replace(/[\s-]/g, ''),
    validate: (v) => (MEMBER_ID_RE.test(v) ? null : 'Insurance member ID must be letters and numbers only (max 50).'),
  },
  preferred_language: {
    required: false,
    defaultValue: 'English',
    normalize: normalizeLanguage,
    validate: (v) => (LANGUAGE_RE.test(v) ? null : 'Preferred language must be a language name.'),
  },
  emergency_contact_name: {
    required: false,
    normalize: normalizeName,
    validate: nameValidator('Emergency contact name', 100),
  },
  emergency_contact_phone: {
    required: false,
    normalize: normalizePhone,
    validate: phoneValidator('Emergency contact phone'),
  },
});

export const PATIENT_FIELD_NAMES = Object.freeze(Object.keys(PATIENT_FIELDS));
export const REQUIRED_FIELD_NAMES = Object.freeze(PATIENT_FIELD_NAMES.filter((f) => PATIENT_FIELDS[f].required));
const READ_ONLY_FIELDS = new Set(['patient_id', 'created_at', 'updated_at', 'deleted_at']);

/**
 * Validate and normalize patient input.
 *
 * @param {Record<string, unknown>} input
 * @param {{ mode?: 'create' | 'update' | 'draft', rejectUnknown?: boolean }} options
 *   - create: required fields must be present; defaults applied.
 *   - update: only the supplied fields are checked (partial update); required
 *             fields cannot be cleared.
 *   - draft:  like update but blank values are simply ignored. Used by the
 *             voice agent to check a partially collected record.
 * @returns {{ value: Record<string, string|null>, errors: {field: string, message: string}[] }}
 */
export function validatePatientInput(input, { mode = 'create', rejectUnknown = true } = {}) {
  const errors = [];
  const value = {};

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { value, errors: [{ field: '_body', message: 'Request body must be a JSON object.' }] };
  }

  if (rejectUnknown) {
    for (const key of Object.keys(input)) {
      if (READ_ONLY_FIELDS.has(key)) errors.push({ field: key, message: `${key} is read-only.` });
      else if (!PATIENT_FIELDS[key]) errors.push({ field: key, message: `Unknown field "${key}".` });
    }
  }

  for (const [field, rule] of Object.entries(PATIENT_FIELDS)) {
    const present = Object.prototype.hasOwnProperty.call(input, field);
    const raw = input[field];
    const isBlank = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');

    if (isBlank) {
      if (mode === 'create') {
        if (rule.required) errors.push({ field, message: `${humanize(field)} is required.` });
        else value[field] = rule.defaultValue ?? null;
      } else if (mode === 'update' && present) {
        if (rule.required) errors.push({ field, message: `${humanize(field)} is required and cannot be cleared.` });
        else value[field] = rule.defaultValue ?? null; // clearing preferred_language resets it to English
      }
      continue;
    }

    if (typeof raw !== 'string' && typeof raw !== 'number') {
      errors.push({ field, message: `${humanize(field)} must be a string.` });
      continue;
    }
    if (String(raw).length > MAX_RAW_LENGTH) {
      errors.push({ field, message: `${humanize(field)} is too long.` });
      continue;
    }

    const normalized = rule.normalize(raw);
    const message = rule.validate(normalized);
    if (message) errors.push({ field, message });
    else value[field] = normalized;
  }

  return { value, errors };
}

export function humanize(field) {
  const text = field.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
