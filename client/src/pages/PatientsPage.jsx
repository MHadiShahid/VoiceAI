import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { age, formatPhone, timeAgo } from '../lib/format.js';
import { EmptyState, ErrorBanner, Spinner } from '../components/ui.jsx';

const REFRESH_MS = 15_000; // pick up registrations made over the phone

export function PatientsPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState({ last_name: '', date_of_birth: '', phone_number: '' });
  const [filters, setFilters] = useState({});

  const patients = useApi((signal) => api.listPatients({ ...filters, limit: 500 }, { signal }), [JSON.stringify(filters)], {
    refreshMs: REFRESH_MS,
  });
  const calls = useApi((signal) => api.listCalls({ limit: 200 }, { signal }), [], { refreshMs: REFRESH_MS });

  const applySearch = (e) => {
    e.preventDefault();
    const next = {};
    if (draft.last_name.trim()) next.last_name = draft.last_name.trim();
    if (draft.date_of_birth) {
      const [y, m, d] = draft.date_of_birth.split('-');
      next.date_of_birth = `${m}/${d}/${y}`;
    }
    if (draft.phone_number.trim()) next.phone_number = draft.phone_number.trim();
    setFilters(next);
  };
  const clearSearch = () => {
    setDraft({ last_name: '', date_of_birth: '', phone_number: '' });
    setFilters({});
  };
  const filtering = Object.keys(filters).length > 0;

  const list = patients.data ?? [];
  const callList = calls.data ?? [];
  const today = new Date().toDateString();
  const stats = [
    { label: filtering ? 'Matching patients' : 'Registered patients', value: list.length },
    { label: 'Registered today', value: list.filter((p) => new Date(p.created_at).toDateString() === today).length },
    { label: 'Calls handled', value: callList.length },
    { label: 'Incomplete calls', value: callList.filter((c) => c.outcome === 'incomplete').length, tone: 'warning' },
  ];

  return (
    <>
      <section className="stats">
        {stats.map((s) => (
          <div key={s.label} className={`stat ${s.tone ? `stat-${s.tone}` : ''}`}>
            <span className="stat-value">{patients.loading && !patients.data ? '…' : s.value}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <h1>Patients</h1>
          <span className="muted small">Auto-refreshes every 15 seconds</span>
        </div>

        <form className="search" onSubmit={applySearch}>
          <label>
            <span>Last name</span>
            <input value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} placeholder="e.g. Doe" />
          </label>
          <label>
            <span>Date of birth</span>
            <input type="date" value={draft.date_of_birth} onChange={(e) => setDraft({ ...draft, date_of_birth: e.target.value })} />
          </label>
          <label>
            <span>Phone</span>
            <input value={draft.phone_number} onChange={(e) => setDraft({ ...draft, phone_number: e.target.value })} placeholder="(415) 555-0134" />
          </label>
          <div className="search-actions">
            <button type="submit" className="btn btn-primary">Search</button>
            {filtering && (
              <button type="button" className="btn" onClick={clearSearch}>Clear</button>
            )}
          </div>
        </form>

        <ErrorBanner error={patients.error} onRetry={patients.reload} />

        {patients.loading && !patients.data ? (
          <Spinner />
        ) : list.length === 0 ? (
          <EmptyState title={filtering ? 'No patients match your search.' : 'No patients yet.'}>
            {!filtering && 'Call the number above to register the first patient by voice.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Date of birth</th>
                  <th>Sex</th>
                  <th>Phone</th>
                  <th>Location</th>
                  <th>Language</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.patient_id} onClick={() => navigate(`/patients/${p.patient_id}`)} className="clickable">
                    <td>
                      <Link to={`/patients/${p.patient_id}`} onClick={(e) => e.stopPropagation()}>
                        {p.last_name}, {p.first_name}
                      </Link>
                    </td>
                    <td>
                      {p.date_of_birth} <span className="muted">({age(p.date_of_birth)})</span>
                    </td>
                    <td>{p.sex}</td>
                    <td className="nowrap">{formatPhone(p.phone_number)}</td>
                    <td>{p.city}, {p.state}</td>
                    <td>{p.preferred_language}</td>
                    <td className="nowrap muted">{timeAgo(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
