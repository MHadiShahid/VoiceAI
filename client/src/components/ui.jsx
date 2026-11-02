import { OUTCOME_LABELS } from '../lib/format.js';

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const OUTCOME_TONES = { registered: 'success', updated: 'info', incomplete: 'warning', in_progress: 'neutral' };

export function OutcomeBadge({ outcome }) {
  return <Badge tone={OUTCOME_TONES[outcome] ?? 'neutral'}>{OUTCOME_LABELS[outcome] ?? outcome}</Badge>;
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <span>{error.message}</span>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" aria-hidden="true" /> {label}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Field({ label, value }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === '' ? <span className="muted">—</span> : value}</dd>
    </div>
  );
}
