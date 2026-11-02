// Thin client for the REST API. Unwraps the { data, error } envelope and
// throws ApiError (with per-field details) on failure.

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details ?? [];
  }

  /** { field: message } map for form display. */
  get fieldErrors() {
    return Object.fromEntries(this.details.filter((d) => d.field).map((d) => [d.field, d.message]));
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the server. Check your connection.', { status: 0 });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    const err = json?.error ?? {};
    throw new ApiError(err.message ?? `Request failed (${res.status})`, { status: res.status, code: err.code, details: err.details });
  }
  return json.data;
}

const query = (params) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
};

export const api = {
  info: (opts) => request('/info', opts),
  listPatients: (filters = {}, opts) => request(`/patients${query(filters)}`, opts),
  getPatient: (id, opts) => request(`/patients/${id}`, opts),
  createPatient: (body) => request('/patients', { method: 'POST', body }),
  updatePatient: (id, body) => request(`/patients/${id}`, { method: 'PUT', body }),
  deletePatient: (id) => request(`/patients/${id}`, { method: 'DELETE' }),
  patientAppointments: (id, opts) => request(`/patients/${id}/appointments`, opts),
  patientCalls: (id, opts) => request(`/patients/${id}/calls`, opts),
  listCalls: (filters = {}, opts) => request(`/calls${query(filters)}`, opts),
};
