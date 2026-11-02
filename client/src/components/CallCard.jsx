import { useState } from 'react';
import { Link } from 'react-router-dom';
import { OutcomeBadge } from './ui.jsx';
import { formatDateTime, formatDuration, formatPhone } from '../lib/format.js';

/** One phone call: outcome, summary, and an expandable transcript. */
export function CallCard({ call, showPatient = false }) {
  const [open, setOpen] = useState(false);
  const draftEntries = call.outcome === 'incomplete' && call.draft_data ? Object.entries(call.draft_data) : [];

  return (
    <article className="call-card">
      <header className="call-head">
        <div>
          <OutcomeBadge outcome={call.outcome} />
          <span className="call-meta">
            {formatDateTime(call.started_at ?? call.created_at)} · {formatDuration(call.duration_seconds)} · from{' '}
            {formatPhone(call.caller_number)}
          </span>
        </div>
        {showPatient && call.patient_id && (
          <Link to={`/patients/${call.patient_id}`}>{call.patient_name ?? 'View patient'} →</Link>
        )}
      </header>

      {call.summary && <p className="call-summary">{call.summary}</p>}
      {call.ended_reason && <p className="muted small">Ended: {call.ended_reason.replace(/-/g, ' ')}</p>}

      {draftEntries.length > 0 && (
        <div className="draft">
          <strong className="small">Partial data captured before the call ended</strong>
          <ul>
            {draftEntries.map(([k, v]) => (
              <li key={k}>
                <span className="muted">{k.replace(/_/g, ' ')}:</span> {String(v)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="call-actions">
        {call.transcript && (
          <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Hide transcript' : 'Show transcript'}
          </button>
        )}
        {call.recording_url && (
          <a className="btn btn-sm" href={call.recording_url} target="_blank" rel="noreferrer">
            Recording ↗
          </a>
        )}
      </div>

      {open && call.transcript && (
        <div className="transcript">
          {call.transcript.split('\n').filter(Boolean).map((line, i) => {
            const [speaker, ...rest] = line.split(':');
            const isAgent = /^(AI|bot|assistant)$/i.test(speaker.trim());
            return (
              <p key={i} className={isAgent ? 'line agent' : 'line caller'}>
                <span className="speaker">{isAgent ? 'Riley' : 'Caller'}</span>
                {rest.join(':').trim()}
              </p>
            );
          })}
        </div>
      )}
    </article>
  );
}
