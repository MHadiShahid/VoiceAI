import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fetch data with loading/error state. `fetcher` receives an AbortSignal.
 * Optional `refreshMs` polls in the background (used so new phone
 * registrations appear on the dashboard without a manual refresh).
 */
export function useApi(fetcher, deps = [], { refreshMs } = {}) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async (signal, { background = false } = {}) => {
    if (!background) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetcherRef.current(signal);
      setState({ data, error: null, loading: false });
    } catch (error) {
      if (error.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = refreshMs ? setInterval(() => load(controller.signal, { background: true }), refreshMs) : null;
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => load(undefined), [load]);
  return { ...state, reload };
}
