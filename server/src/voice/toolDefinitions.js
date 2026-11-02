// JSON-schema tool definitions exposed to the LLM (Gemini via Vapi).
//
// Kept intentionally flat and string-typed: Gemini's function calling is most
// reliable with simple schemas, and the server normalizes/validates every value
// anyway (see domain/patient.js). Descriptions double as instructions to the
// model, so they state formats explicitly.

const patientFieldProperties = {
  first_name: { type: 'string', description: "Patient's first name, correctly spelled." },
  last_name: { type: 'string', description: "Patient's last name, correctly spelled." },
  date_of_birth: { type: 'string', description: 'Date of birth in MM/DD/YYYY format, e.g. 03/04/1985.' },
  sex: { type: 'string', description: 'Exactly one of: Male, Female, Other, Decline to Answer.' },
  phone_number: { type: 'string', description: '10-digit U.S. phone number, digits only, e.g. 5552345678.' },
  email: { type: 'string', description: 'Email address (optional).' },
  address_line_1: { type: 'string', description: 'Street address, e.g. 123 Main Street.' },
  address_line_2: { type: 'string', description: 'Apartment, suite or unit (optional).' },
  city: { type: 'string', description: 'City.' },
  state: { type: 'string', description: '2-letter U.S. state abbreviation, e.g. CA.' },
  zip_code: { type: 'string', description: '5-digit ZIP or ZIP+4, e.g. 94110 or 94110-1234.' },
  insurance_provider: { type: 'string', description: 'Insurance company name (optional).' },
  insurance_member_id: { type: 'string', description: 'Insurance member/subscriber ID, letters and numbers (optional).' },
  preferred_language: { type: 'string', description: 'Preferred language in English, e.g. English or Spanish (optional).' },
  emergency_contact_name: { type: 'string', description: 'Emergency contact full name (optional).' },
  emergency_contact_phone: { type: 'string', description: 'Emergency contact 10-digit U.S. phone number (optional).' },
};

const REQUIRED_FOR_CREATE = [
  'first_name', 'last_name', 'date_of_birth', 'sex', 'phone_number',
  'address_line_1', 'city', 'state', 'zip_code',
];

/** @type {Record<string, { description: string, parameters: object }>} */
export const TOOL_DEFINITIONS = {
  check_existing_patient: {
    description:
      'Look up whether a patient record already exists for a phone number. Call this as soon as the caller gives their phone number.',
    parameters: {
      type: 'object',
      properties: { phone_number: patientFieldProperties.phone_number },
      required: ['phone_number'],
    },
  },

  validate_patient_info: {
    description:
      'Check collected patient information against the registration rules WITHOUT saving it. Pass every field collected so far. ' +
      'Returns normalized values, per-field errors to re-ask, and which required fields are still missing.',
    parameters: { type: 'object', properties: patientFieldProperties },
  },

  register_patient: {
    description:
      'Save a NEW patient record. Only call after reading the information back and the caller confirming it is correct.',
    parameters: {
      type: 'object',
      properties: {
        ...patientFieldProperties,
        allow_duplicate_phone: {
          type: 'boolean',
          description: 'Set true only if the caller confirmed an existing record with this phone number belongs to someone else.',
        },
      },
      required: REQUIRED_FOR_CREATE,
    },
  },

  update_patient: {
    description:
      "Update an EXISTING patient's record (returning caller). Pass the patient_id and only the fields that changed, after the caller confirms them.",
    parameters: {
      type: 'object',
      properties: {
        patient_id: { type: 'string', description: 'patient_id returned by check_existing_patient or register_patient.' },
        ...patientFieldProperties,
      },
      required: ['patient_id'],
    },
  },

  get_available_appointments: {
    description: 'Get open first-appointment slots at the clinic. Call after a successful registration if the caller wants an appointment.',
    parameters: {
      type: 'object',
      properties: {
        preferred_date: { type: 'string', description: 'Earliest date the caller wants, MM/DD/YYYY (optional).' },
        time_of_day: { type: 'string', enum: ['morning', 'afternoon', 'any'], description: 'Preferred time of day.' },
      },
    },
  },

  book_appointment: {
    description: 'Book one of the slots returned by get_available_appointments for the registered patient.',
    parameters: {
      type: 'object',
      properties: {
        patient_id: { type: 'string', description: 'The patient_id of the registered patient.' },
        start_time: { type: 'string', description: 'The exact start_time of the chosen slot.' },
        provider_name: { type: 'string', description: 'The exact provider_name of the chosen slot.' },
        reason: { type: 'string', description: 'Short reason for the visit, if mentioned (optional).' },
      },
      required: ['patient_id', 'start_time', 'provider_name'],
    },
  },
};

// Filler lines spoken while a slow tool runs, per language, so a Spanish call
// doesn't suddenly hear English. Fast lookups get no filler.
const say = (en, es) => [
  { type: 'text', language: 'en', text: en },
  { type: 'text', language: 'es', text: es },
];

export const TOOL_MESSAGES = {
  register_patient: [
    { type: 'request-start', contents: say('Perfect, let me get that saved for you.', 'Perfecto, déjeme guardar su información.') },
    { type: 'request-response-delayed', timingMilliseconds: 4000, contents: say('Still working on it, thanks for your patience.', 'Sigo en ello, gracias por su paciencia.') },
  ],
  update_patient: [
    { type: 'request-start', contents: say('Okay, updating that now.', 'Muy bien, lo actualizo ahora.') },
    { type: 'request-response-delayed', timingMilliseconds: 4000, contents: say('Almost done, thanks for waiting.', 'Ya casi termino, gracias por esperar.') },
  ],
  get_available_appointments: [
    { type: 'request-start', contents: say('Let me check the schedule.', 'Déjeme revisar la agenda.') },
  ],
  book_appointment: [
    { type: 'request-start', contents: say('Booking that for you now.', 'Le reservo la cita ahora.') },
  ],
};

// If the webhook is unreachable or times out, let the model craft the apology
// (in the caller's language) instead of a canned English line.
export const TOOL_FAILED_MESSAGE = {
  type: 'request-failed',
  role: 'system',
  content:
    'The tool request failed because the clinic system could not be reached. Apologize briefly in the caller\'s language. ' +
    'Do NOT say anything was saved. Offer to try once more; if it fails again, explain the registration could not be completed right now and the clinic team will follow up.',
};
