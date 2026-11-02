#!/usr/bin/env node
// Copies any call recordings that are still only on Vapi into our private
// Vercel Blob store (backfill for calls made before archiving existed, or
// retry after a failed background archive). Idempotent.
//
// Needs DATABASE_URL and VAPI_API_KEY (.env), and BLOB_READ_WRITE_TOKEN (.env.local, created by
// `vercel env pull` / `vercel blob create-store`).
// Usage: npm run recordings:archive

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });

const { config } = await import('../server/src/config.js');
const { createLogger } = await import('../server/src/lib/logger.js');
const { closePool, getPool } = await import('../server/src/db/pool.js');
const { createCallLogRepository } = await import('../server/src/repositories/callLogRepository.js');
const { createCallLogService } = await import('../server/src/services/callLogService.js');
const { createBlobRecordingStore, createVapiRecordingSource } = await import('../server/src/storage/recordingStore.js');

try {
  const service = createCallLogService({
    callLogRepository: createCallLogRepository(getPool()),
    recordingSource: createVapiRecordingSource({ apiKey: config.vapiApiKey }),
    recordingStore: createBlobRecordingStore({ token: config.blobToken }),
    logger: createLogger({ level: 'warn' }),
  });
  const results = await service.archivePendingRecordings({ limit: 200 });
  if (results.length === 0) console.log('Nothing to archive: every recording is already stored.');
  for (const r of results) {
    console.log(r.archived ? `✓ ${r.call_id} (${(r.size_bytes / 1024).toFixed(0)} KB)` : `✗ ${r.call_id}: ${r.error}`);
  }
  if (results.some((r) => !r.archived)) process.exitCode = 1;
} catch (error) {
  console.error(`Archiving failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
