import { issueSignedToken, presignUrl, put } from '@vercel/blob';

// Call recordings: Vapi (source) → our PRIVATE Vercel Blob store (archive).
//
// Vapi keeps recordings in a private bucket; the raw URLs in the end-of-call
// report are not downloadable. Its API hands out short-lived presigned URLs
// instead. When a call ends we copy the audio into our own store so the
// recording lives alongside the patient record under our control. Archived
// files are private: GET /api/calls/:id/recording answers with a redirect to a
// short-lived, read-only signed URL for that one file. (Redirecting rather than
// proxying avoids Vercel's 4.5 MB function response limit and lets the browser
// seek within the audio.)

const MAX_RECORDING_BYTES = 100 * 1024 * 1024; // safety cap: ~100 MB
const SIGNED_URL_TTL_MS = 10 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 25_000;
const CONTENT_TYPES = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', webm: 'audio/webm' };

function detectFormat(url, contentType) {
  const fromPath = new URL(url).pathname.split('.').pop()?.toLowerCase();
  if (fromPath && CONTENT_TYPES[fromPath]) return fromPath;
  const fromType = Object.entries(CONTENT_TYPES).find(([, type]) => contentType?.startsWith(type));
  return fromType?.[0] ?? 'wav';
}

/**
 * Reads recordings from Vapi using the private API key.
 * @param {{ apiKey?: string, fetchImpl?: typeof fetch }} options
 */
export function createVapiRecordingSource({ apiKey, fetchImpl = fetch }) {
  async function presignedUrl(callId) {
    // Vapi answers with a 302 to a short-lived presigned URL. Follow it manually
    // so our Authorization header is never sent to the storage host.
    const res = await fetchImpl(`https://api.vapi.ai/call/${encodeURIComponent(callId)}/mono-recording`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) return location;
    if (res.status === 404) return null;
    throw new Error(`Vapi recording lookup failed with HTTP ${res.status}`);
  }

  return {
    available: Boolean(apiKey),
    presignedUrl,

    /** @returns {Promise<{ body: Buffer, contentType: string, format: string }>} */
    async download(callId) {
      const url = await presignedUrl(callId);
      if (!url) throw new Error('Vapi has no recording for this call');
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Recording download failed with HTTP ${res.status}`);
      if (Number(res.headers.get('content-length') ?? 0) > MAX_RECORDING_BYTES) throw new Error('Recording too large');
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAX_RECORDING_BYTES) throw new Error('Recording too large');
      const format = detectFormat(url, res.headers.get('content-type'));
      return { body, contentType: CONTENT_TYPES[format], format };
    },
  };
}

/** Blob pathnames are derived from Vapi call ids; keep them filesystem-safe. */
const safeId = (callId) => String(callId).replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * Private Vercel Blob storage for recordings.
 * @param {{ token?: string }} options token: BLOB_READ_WRITE_TOKEN (injected when the store is linked to the project)
 */
export function createBlobRecordingStore({ token }) {
  return {
    enabled: Boolean(token),

    async save(callId, { body, contentType, format }) {
      const blob = await put(`recordings/${safeId(callId)}.${format}`, body, {
        access: 'private',
        contentType,
        allowOverwrite: true, // re-archiving the same call replaces the file
        token,
      });
      return { pathname: blob.pathname, contentType, size: body.length };
    },

    /** Short-lived, read-only URL scoped to a single stored recording. */
    async signedUrl(pathname) {
      const validUntil = Date.now() + SIGNED_URL_TTL_MS;
      const signed = await issueSignedToken({ pathname, operations: ['get'], validUntil, token });
      const { presignedUrl } = await presignUrl(signed, { operation: 'get', pathname, access: 'private', validUntil });
      return presignedUrl;
    },
  };
}
