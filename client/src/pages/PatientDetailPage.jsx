import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { age, formatDateTime, formatPhone } from '../lib/format.js';
import { Badge, EmptyState, ErrorBanner, Field, Spinner } from '../components/ui.jsx';
import { PatientForm } from '../components/PatientForm.jsx';
import { CallCard } from '../components/CallCard.jsx';

export function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const patient = useApi((signal) => api.getPatient(id, { signal }), [id]);
  const appointments = useApi((signal) => api.patientAppointments(id, { signal }), [id]);
  const calls = useApi((signal) => api.patientCalls(id, { signal }), [id]);

  if (patient.loading && !patient.data) return <Spinner />;
  if (patient.error) {
    return (
      <section className="card">
        <ErrorBanner error={patient.error} onRetry={patient.error.status === 404 ? undefined : patient.reload} />
        <Link to="/">← Back to patients</Link>
      </section>
    );
  }

  const p = patient.data;

  async function handleDelete() {
    if (!window.confirm(`Remove ${p.first_name} ${p.last_name}? The record is soft-deleted and kept for audit.`)) return;
    try {
      await api.deletePatient(id);
      navigate('/');
    } catch (error) {
      setDeleteError(error);
    }
  }

  async function handleUpdate(body) {
    await api.updatePatient(id, body);
    setEditing(false);
    patient.reload();
  }

  return (
    <>
      <Link to="/" className="back">← All patients</Link>

      <section className="card">
        <div className="card-head">
          <div>
            <h1>
              {p.first_name} {p.last_name}
            </h1>
            <p className="muted">
              {p.date_of_birth} · {age(p.date_of_birth)} years · {p.sex} · <Badge>{p.preferred_language}</Badge>
            </p>
          </div>
          {!editing && (
            <div className="row-actions">
              <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
              <button type="button" className="btn btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          )}
        </div>
        <ErrorBanner error={deleteError} />

        {editing ? (
          <PatientForm initial={p} partial submitLabel="Save changes" onSubmit={handleUpdate} onCancel={() => setEditing(false)} />
        ) : (
          <div className="detail-grid">
            {[
              ['Contact', [['Phone', formatPhone(p.phone_number)], ['Email', p.email]]],
              ['Address', [
                ['Street', [p.address_line_1, p.address_line_2].filter(Boolean).join(', ')],
                ['City / State / ZIP', `${p.city}, ${p.state} ${p.zip_code}`],
              ]],
              ['Insurance', [['Provider', p.insurance_provider], ['Member ID', p.insurance_member_id]]],
              ['Emergency contact', [
                ['Name', p.emergency_contact_name],
                ['Phone', p.emergency_contact_phone && formatPhone(p.emergency_contact_phone)],
              ]],
              ['Record', [
                ['Patient ID', <code key="id">{p.patient_id}</code>],
                ['Created', formatDateTime(p.created_at)],
                ['Updated', formatDateTime(p.updated_at)],
              ]],
            ].map(([title, fields]) => (
              <div key={title}>
                <h2>{title}</h2>
                <dl>
                  {fields.map(([label, value]) => (
                    <Field key={label} label={label} value={value} />
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Appointments</h2>
        <ErrorBanner error={appointments.error} onRetry={appointments.reload} />
        {appointments.loading && !appointments.data ? (
          <Spinner />
        ) : appointments.data?.length ? (
          <ul className="appointments">
            {appointments.data.map((a) => (
              <li key={a.appointment_id}>
                <strong>{a.scheduled_label}</strong> with {a.provider_name}
                {a.reason && <span className="muted"> — {a.reason}</span>}
                <Badge tone={a.status === 'scheduled' ? 'success' : 'neutral'}>{a.status}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No appointments booked." />
        )}
      </section>

      <section className="card">
        <h2>Call history</h2>
        <ErrorBanner error={calls.error} onRetry={calls.reload} />
        {calls.loading && !calls.data ? (
          <Spinner />
        ) : calls.data?.length ? (
          calls.data.map((c) => <CallCard key={c.call_id} call={c} />)
        ) : (
          <EmptyState title="No phone calls linked to this patient.">Patients created from the dashboard or API have no call history.</EmptyState>
        )}
      </section>
    </>
  );
}
