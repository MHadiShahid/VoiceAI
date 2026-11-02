import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { WEBHOOK_SECRET, buildTestApp } from './helpers/testApp.js';

let ctx;
beforeEach(() => {
  ctx = buildTestApp();
});

const endOfCall = (callId, recording = { mono: { combinedUrl: 'https://storage.vapi.ai/rec-1.mp3' } }) =>
  request(ctx.app)
    .post('/api/vapi/webhook')
    .set('x-vapi-secret', WEBHOOK_SECRET)
    .send({ message: { type: 'end-of-call-report', call: { id: callId }, endedReason: 'customer-ended-call', artifact: { transcript: 'hi', recording } } });

describe('call recording archive', () => {
  it('archives the recording into private storage after the end-of-call report', async () => {
    expect((await endOfCall('call-a')).status).toBe(200);
    await ctx.flushBackground();

    const call = (await request(ctx.app).get('/api/calls/call-a')).body.data;
    expect(call).toMatchObject({ recording_stored: true, recording_url: 'https://storage.vapi.ai/rec-1.mp3' });
    expect(call.recording_size_bytes).toBeGreaterThan(0);
    expect(ctx.recordingStore.files.has('recordings/call-a.mp3')).toBe(true);
  });

  it('serves the archived audio via a short-lived signed URL', async () => {
    await endOfCall('call-b');
    await ctx.flushBackground();
    expect(ctx.recordingStore.files.get('recordings/call-b.mp3').toString()).toBe('audio-for:call-b');

    const res = await request(ctx.app).get('/api/calls/call-b/recording');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://blob.example/recordings/call-b.mp3?signed=1');
    expect(res.headers['x-recording-source']).toBe('archive');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('falls back to a presigned Vapi URL while the recording is not archived', async () => {
    ctx.recordingSource.failNextDownload = true;
    await endOfCall('call-c');
    await ctx.flushBackground(); // failure is logged, not thrown

    expect((await request(ctx.app).get('/api/calls/call-c')).body.data.recording_stored).toBe(false);
    const res = await request(ctx.app).get('/api/calls/call-c/recording');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://signed.example/call-c.mp3?sig=abc');
    expect(res.headers['x-recording-source']).toBe('vapi');
  });

  it('backfill archives recordings that were missed', async () => {
    ctx.recordingSource.failNextDownload = true;
    await endOfCall('call-d');
    await ctx.flushBackground();

    const { createCallLogService } = await import('../src/services/callLogService.js');
    const { createLogger } = await import('../src/lib/logger.js');
    const service = createCallLogService({
      callLogRepository: ctx.repositories.callLogs,
      recordingSource: ctx.recordingSource,
      recordingStore: ctx.recordingStore,
      logger: createLogger({ level: 'silent' }),
    });
    expect(await service.archivePendingRecordings()).toEqual([{ call_id: 'call-d', archived: true, size_bytes: expect.any(Number) }]);
    expect(await service.archivePendingRecordings()).toEqual([]); // idempotent
  });

  it('does not archive twice and skips calls without a recording', async () => {
    await endOfCall('call-e');
    await ctx.flushBackground();
    await endOfCall('call-e'); // Vapi re-delivers the report
    await ctx.flushBackground();
    expect(ctx.recordingStore.files.size).toBe(1);

    await endOfCall('call-f', null);
    await ctx.flushBackground();
    expect((await request(ctx.app).get('/api/calls/call-f/recording')).status).toBe(404);
  });

  it('returns 404 for an unknown call', async () => {
    expect((await request(ctx.app).get('/api/calls/nope/recording')).status).toBe(404);
  });
});
