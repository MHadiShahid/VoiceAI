import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { PatientForm } from '../components/PatientForm.jsx';

export function NewPatientPage() {
  const navigate = useNavigate();

  async function handleCreate(body) {
    const patient = await api.createPatient(body);
    navigate(`/patients/${patient.patient_id}`);
  }

  return (
    <>
      <Link to="/" className="back">← All patients</Link>
      <section className="card">
        <h1>New patient</h1>
        <p className="muted">Manual entry for front-desk staff. Phone registrations appear automatically.</p>
        <PatientForm submitLabel="Create patient" onSubmit={handleCreate} onCancel={() => navigate('/')} />
      </section>
    </>
  );
}
