import { useState } from 'react';
import { SEX_OPTIONS, STATES, dobToInput } from '../lib/format.js';

// Mirrors the API data model. Validation happens server-side; the form shows
// the API's per-field messages next to each input.
const SECTIONS = [
  {
    title: 'Personal',
    fields: [
      { name: 'first_name', label: 'First name', required: true, maxLength: 50 },
      { name: 'last_name', label: 'Last name', required: true, maxLength: 50 },
      { name: 'date_of_birth', label: 'Date of birth', required: true, type: 'date' },
      { name: 'sex', label: 'Sex', required: true, options: SEX_OPTIONS },
      { name: 'preferred_language', label: 'Preferred language', placeholder: 'English' },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { name: 'phone_number', label: 'Phone number', required: true, type: 'tel', placeholder: '(415) 555-0134' },
      { name: 'email', label: 'Email', type: 'email' },
    ],
  },
  {
    title: 'Address',
    fields: [
      { name: 'address_line_1', label: 'Street address', required: true, wide: true },
      { name: 'address_line_2', label: 'Apt / Suite / Unit', wide: true },
      { name: 'city', label: 'City', required: true },
      { name: 'state', label: 'State', required: true, options: STATES },
      { name: 'zip_code', label: 'ZIP code', required: true, placeholder: '94110 or 94110-1234' },
    ],
  },
  {
    title: 'Insurance & emergency contact',
    fields: [
      { name: 'insurance_provider', label: 'Insurance provider' },
      { name: 'insurance_member_id', label: 'Member ID' },
      { name: 'emergency_contact_name', label: 'Emergency contact name' },
      { name: 'emergency_contact_phone', label: 'Emergency contact phone', type: 'tel' },
    ],
  },
];

const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);

function toFormState(patient) {
  const state = {};
  for (const { name } of ALL_FIELDS) state[name] = patient?.[name] ?? '';
  state.date_of_birth = dobToInput(patient?.date_of_birth);
  return state;
}

/**
 * @param {{ initial?: object, submitLabel: string, onSubmit: (body: object) => Promise<void>, onCancel?: () => void, partial?: boolean }} props
 *   partial: send only changed fields (PUT semantics); empty optional fields are sent as null to clear them.
 */
export function PatientForm({ initial, submitLabel, onSubmit, onCancel, partial = false }) {
  const [values, setValues] = useState(() => toFormState(initial));
  const [original] = useState(() => toFormState(initial));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (name) => (e) => setValues((v) => ({ ...v, [name]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    const body = {};
    for (const { name } of ALL_FIELDS) {
      if (partial && values[name] === original[name]) continue;
      const value = values[name].trim();
      if (value === '' && !partial) continue;
      body[name] = value === '' ? null : value;
    }
    if (partial && Object.keys(body).length === 0) {
      setFormError('No changes to save.');
      return;
    }
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await onSubmit(body);
    } catch (error) {
      setErrors(error.fieldErrors ?? {});
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      {formError && <div className="alert alert-error" role="alert">{formError}</div>}
      {SECTIONS.map((section) => (
        <fieldset key={section.title}>
          <legend>{section.title}</legend>
          <div className="form-grid">
            {section.fields.map((f) => (
              <label key={f.name} className={f.wide ? 'wide' : undefined}>
                <span>
                  {f.label}
                  {f.required && <em aria-hidden="true"> *</em>}
                </span>
                {f.options ? (
                  <select value={values[f.name]} onChange={set(f.name)} required={f.required} aria-invalid={Boolean(errors[f.name])}>
                    <option value="">Select…</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type ?? 'text'}
                    value={values[f.name]}
                    onChange={set(f.name)}
                    required={f.required}
                    maxLength={f.maxLength}
                    placeholder={f.placeholder}
                    aria-invalid={Boolean(errors[f.name])}
                  />
                )}
                {errors[f.name] && <small className="field-error">{errors[f.name]}</small>}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
