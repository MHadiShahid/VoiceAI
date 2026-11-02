import { lazy, Suspense, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPhone } from '../lib/format.js';
import { useApi } from '../lib/useApi.js';

const VoiceCallWidget = lazy(() => import('./VoiceCallWidget.jsx').then((m) => ({ default: m.VoiceCallWidget })));

export function Layout() {
  const { data: info } = useApi((signal) => api.info({ signal }));
  const [callOpen, setCallOpen] = useState(false);
  const webCall = info?.web_call;

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

      {(info?.phone_number || webCall) && (
        <div className="callout">
          <span aria-hidden="true">📞</span> Register with Riley, our AI intake coordinator
          {info?.phone_number && (
            <>
              {': call '}
              <a href={`tel:${info.phone_number}`}>{formatPhone(info.phone_number)}</a>
            </>
          )}
          {webCall && (
            <>
              {info?.phone_number ? ' or ' : ': '}
              <button type="button" className="callout-btn" onClick={() => setCallOpen(true)}>
                🎙 talk in your browser
              </button>
            </>
          )}
          <span className="muted"> · English & Español</span>
        </div>
      )}

      <main className="container">
        <Outlet />
      </main>

      {webCall && !callOpen && (
        <button type="button" className="voice-fab" onClick={() => setCallOpen(true)}>
          🎙 Talk to Riley
        </button>
      )}
      {webCall && callOpen && (
        <Suspense fallback={null}>
          <VoiceCallWidget
            publicKey={webCall.public_key}
            assistantId={webCall.assistant_id}
            onClose={() => setCallOpen(false)}
          />
        </Suspense>
      )}

      <footer className="footer">Demo system with fictional data only. Not for real patient information.</footer>
    </div>
  );
}
