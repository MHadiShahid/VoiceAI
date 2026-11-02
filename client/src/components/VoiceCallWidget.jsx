import { useEffect, useRef, useState } from 'react';

// In-browser voice call to the same Vapi assistant that answers the phone
// line (same prompt, tools and backend). Useful for anyone who can't dial a
// U.S. number. The Vapi Web SDK (WebRTC via Daily) is ~200 kB, so it is only
// downloaded when a call is started.

const STATUS_LABEL = {
  idle: 'Ready',
  connecting: 'Connecting…',
  live: 'Live',
  ending: 'Ending…',
  ended: 'Call ended',
  error: 'Something went wrong',
};

async function loadVapi() {
  const mod = await import('@vapi-ai/web');
  return mod.default?.default ?? mod.default; // CJS/ESM interop
}

function micErrorMessage(error) {
  const text = String(error?.error?.message ?? error?.errorMsg ?? error?.message ?? error ?? '');
  if (/permission|denied|notallowed/i.test(text)) return 'Microphone access was blocked. Allow it in your browser and try again.';
  return text ? `Call failed: ${text.slice(0, 160)}` : 'The call could not be started. Please try again.';
}

/** @param {{ publicKey: string, assistantId: string, onClose: () => void, onCallEnded?: () => void }} props */
export function VoiceCallWidget({ publicKey, assistantId, onClose, onCallEnded }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const [lines, setLines] = useState([]); // { role, text, final }
  const vapiRef = useRef(null);
  const scrollRef = useRef(null);

  // Stop any active call when the widget unmounts.
  useEffect(() => () => void vapiRef.current?.stop(), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  function handleTranscript(message) {
    if (message.type !== 'transcript') return;
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const final = message.transcriptType === 'final';
    setLines((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      // Partial transcripts replace the in-progress line for the same speaker.
      if (last && !last.final && last.role === role) next[next.length - 1] = { role, text: message.transcript, final };
      else next.push({ role, text: message.transcript, final });
      return next;
    });
  }

  async function startCall() {
    setError(null);
    setLines([]);
    setStatus('connecting');
    try {
      if (!vapiRef.current) {
        const Vapi = await loadVapi();
        const vapi = new Vapi(publicKey);
        vapi.on('call-start', () => setStatus('live'));
        vapi.on('call-end', () => {
          setStatus('ended');
          setSpeaking(false);
          setVolume(0);
          onCallEnded?.();
        });
        vapi.on('speech-start', () => setSpeaking(true));
        vapi.on('speech-end', () => setSpeaking(false));
        vapi.on('volume-level', (level) => setVolume(level));
        vapi.on('message', handleTranscript);
        vapi.on('error', (err) => {
          // When Riley hangs up, the SDK can report the room closing as an
          // "error"; that's a normal end, not a failure.
          if (/meeting (has )?ended|ejected|ejection/i.test(JSON.stringify(err ?? ''))) return;
          setError(micErrorMessage(err));
          setStatus('error');
        });
        vapiRef.current = vapi;
      }
      await vapiRef.current.start(assistantId);
    } catch (err) {
      setError(micErrorMessage(err));
      setStatus('error');
    }
  }

  async function endCall() {
    setStatus('ending');
    await vapiRef.current?.stop();
  }

  function toggleMute() {
    const next = !muted;
    vapiRef.current?.setMuted(next);
    setMuted(next);
  }

  const inCall = status === 'connecting' || status === 'live' || status === 'ending';

  return (
    <aside className="voice-widget" role="dialog" aria-label="Talk to Riley in your browser">
      <header className="voice-head">
        <div>
          <strong>Talk to Riley</strong>
          <span className={`voice-status voice-status-${status}`}>
            <span className="voice-dot" aria-hidden="true" /> {STATUS_LABEL[status]}
          </span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} disabled={inCall} aria-label="Close">
          ×
        </button>
      </header>

      <div className="voice-orb-wrap" aria-hidden="true">
        <div
          className={`voice-orb ${status === 'live' ? 'is-live' : ''} ${speaking ? 'is-speaking' : ''}`}
          style={{ transform: `scale(${1 + Math.min(volume, 1) * 0.35})` }}
        />
      </div>

      <div className="voice-transcript" ref={scrollRef} aria-live="polite">
        {lines.length === 0 ? (
          <p className="muted small voice-hint">
            {status === 'ended'
              ? 'Thanks for calling! New registrations appear in the patient list within a few seconds.'
              : 'Riley will greet you and register you as a new patient. Speak naturally. You can interrupt, correct anything, or say "Hablo español".'}
          </p>
        ) : (
          lines.map((line, i) => (
            <p key={i} className={`voice-line ${line.role} ${line.final ? '' : 'partial'}`}>
              <span className="speaker">{line.role === 'assistant' ? 'Riley' : 'You'}</span>
              {line.text}
            </p>
          ))
        )}
      </div>

      {error && <div className="alert alert-error small" role="alert">{error}</div>}

      <footer className="voice-actions">
        {inCall ? (
          <>
            <button type="button" className="btn" onClick={toggleMute} disabled={status !== 'live'} aria-pressed={muted}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" className="btn btn-danger-solid" onClick={endCall} disabled={status === 'ending'}>
              End call
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary voice-start" onClick={startCall}>
            🎙 {status === 'ended' || status === 'error' ? 'Call again' : 'Start call'}
          </button>
        )}
      </footer>
      <p className="muted voice-note">Uses your microphone. Demo only, so please use fictional details.</p>
    </aside>
  );
}
