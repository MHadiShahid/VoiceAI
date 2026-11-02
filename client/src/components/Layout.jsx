import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPhone } from '../lib/format.js';
import { useApi } from '../lib/useApi.js';

export function Layout() {
  const { data: info } = useApi((signal) => api.info({ signal }));

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">✚</span>
            <span>
              Maple Grove Family Health
              <small>Patient Registry</small>
            </span>
          </NavLink>
          <nav className="nav">
            <NavLink to="/" end>Patients</NavLink>
            <NavLink to="/calls">Calls</NavLink>
            <NavLink to="/patients/new" className="btn btn-primary btn-sm">+ New patient</NavLink>
          </nav>
        </div>
      </header>

      {info?.phone_number && (
        <div className="callout">
          <span aria-hidden="true">📞</span> Register by phone with Riley, our AI intake coordinator:{' '}
          <a href={`tel:${info.phone_number}`}>{formatPhone(info.phone_number)}</a>
          <span className="muted"> · English & Español</span>
        </div>
      )}

      <main className="container">
        <Outlet />
      </main>

      <footer className="footer">Demo system — fictional data only. Not for real patient information.</footer>
    </div>
  );
}
