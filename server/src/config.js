import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load the repo-root .env for local development. On Vercel, env vars come from
// the project settings and this is a no-op.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

const env = process.env;

export const config = Object.freeze({
  nodeEnv: env.NODE_ENV ?? 'development',
  isProduction: env.NODE_ENV === 'production' || Boolean(env.VERCEL),
  port: Number(env.PORT ?? 3001),
  databaseUrl: env.DATABASE_URL ?? '',
  vapiWebhookSecret: env.VAPI_WEBHOOK_SECRET ?? '',
  publicPhoneNumber: env.PUBLIC_PHONE_NUMBER ?? '',
  // Browser calls: a Vapi *public* key is designed to be exposed to the
  // browser (it is restricted to our assistant + origins by vapi:setup).
  vapiPublicKey: env.VAPI_PUBLIC_KEY ?? '',
  vapiAssistantId: env.VAPI_ASSISTANT_ID ?? '',
  clinicTimezone: env.CLINIC_TIMEZONE || 'America/New_York',
  logLevel: env.LOG_LEVEL ?? 'info',
});
