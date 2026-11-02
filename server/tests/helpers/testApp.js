import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { createMemoryRepositories } from './memoryRepositories.js';

export const WEBHOOK_SECRET = 'test-secret';

/** Fake Vapi recording source: "downloads" deterministic bytes per call. */
export function createFakeRecordingSource() {
  return {
    available: true,
    failNextDownload: false,
    async presignedUrl(callId) {
      return `https://signed.example/${callId}.mp3?sig=abc`;
    },
    async download(callId) {
      if (this.failNextDownload) {
        this.failNextDownload = false;
        throw new Error('download failed');
      }
      return { body: Buffer.from(`audio-for:${callId}`), contentType: 'audio/mpeg', format: 'mp3' };
    },
  };
}

/** In-memory stand-in for the private Blob recording store. */
export function createMemoryRecordingStore() {
  const files = new Map();
  return {
    enabled: true,
    files,
    async save(callId, { body, contentType, format }) {
      const pathname = `recordings/${callId}.${format}`;
      files.set(pathname, body);
      return { pathname, contentType, size: body.length };
    },
    async signedUrl(pathname) {
      return `https://blob.example/${pathname}?signed=1`;
    },
  };
}

export function buildTestApp({
  repositories = createMemoryRepositories(),
  now,
  recordingSource = createFakeRecordingSource(),
  recordingStore = createMemoryRecordingStore(),
} = {}) {
  // Background jobs are collected so tests can await them deterministically.
  const background = [];
  const app = createApp({
    repositories,
    logger: createLogger({ level: 'silent' }),
    config: {
      clinicTimezone: 'America/New_York',
      vapiWebhookSecret: WEBHOOK_SECRET,
      isProduction: false,
      publicPhoneNumber: '+15555550100',
      vapiPublicKey: 'pub-key',
      vapiAssistantId: 'asst-1',
    },
    now,
    recordingSource,
    recordingStore,
    runInBackground: (promise) => background.push(promise),
  });
  const flushBackground = () => Promise.all(background.splice(0));
  return { app, repositories, recordingSource, recordingStore, flushBackground };
}

export const validPatient = () => ({
  first_name: 'Jane',
  last_name: 'Doe',
  date_of_birth: '04/12/1988',
  sex: 'Female',
  phone_number: '(415) 555-0134',
  email: 'Jane.Doe@Example.com',
  address_line_1: '742 Evergreen Terrace',
  address_line_2: 'Apt 3B',
  city: 'San Francisco',
  state: 'California',
  zip_code: '94110',
});
