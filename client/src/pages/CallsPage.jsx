import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { OUTCOME_LABELS } from '../lib/format.js';
import { CallCard } from '../components/CallCard.jsx';
import { EmptyState, ErrorBanner, Spinner } from '../components/ui.jsx';

const FILTERS = ['', 'registered', 'updated', 'incomplete'];

export function CallsPage() {
  const [outcome, setOutcome] = useState('');
  const calls = useApi((signal) => api.listCalls({ outcome, limit: 100 }, { signal }), [outcome], { refreshMs: 15_000 });

  return (
    <section className="card">
      <div className="card-head">
        <h1>Calls</h1>
        <div className="segmented" role="group" aria-label="Filter by outcome">
          {FILTERS.map((f) => (
            <button key={f || 'all'} type="button" className={outcome === f ? 'active' : ''} onClick={() => setOutcome(f)}>
              {f ? OUTCOME_LABELS[f] : 'All'}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">
        Every call to the intake line is logged with Vapi&apos;s summary, transcript and recording. Calls that drop before the
        caller confirms are marked <em>incomplete</em> with the partial data collected, so staff can follow up.
      </p>

      <ErrorBanner error={calls.error} onRetry={calls.reload} />
      {calls.loading && !calls.data ? (
        <Spinner />
      ) : calls.data?.length ? (
        calls.data.map((c) => <CallCard key={c.call_id} call={c} showPatient />)
      ) : (
        <EmptyState title="No calls yet." />
      )}
    </section>
  );
}
