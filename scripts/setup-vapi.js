#!/usr/bin/env node
// Provisions the voice agent on Vapi. Idempotent — safe to re-run after
// changing the prompt or tools.
//
//   1. Registers GEMINI_API_KEY as a Vapi "google" credential (BYOK).
//   2. Creates or updates the assistant from server/src/voice/assistantConfig.js.
//   3. Attaches the assistant to an existing Vapi phone number, or provisions
//      a free Vapi U.S. number if the account has none.
//
// Required env (.env): VAPI_API_KEY, GEMINI_API_KEY, VAPI_WEBHOOK_SECRET, PUBLIC_BASE_URL
// Optional env:        GEMINI_MODEL, VAPI_PHONE_AREA_CODE, CLINIC_TIMEZONE
//
// Usage: npm run vapi:setup

import { config } from '../server/src/config.js';
import { ASSISTANT_NAME, DEFAULT_GEMINI_MODEL, buildAssistantConfig } from '../server/src/voice/assistantConfig.js';

const VAPI_BASE = 'https://api.vapi.ai';
const env = process.env;

function requireEnv(name) {
  const value = env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}. Add it to .env (see .env.example).`);
    process.exit(1);
  }
  return value;
}

const apiKey = requireEnv('VAPI_API_KEY');
const geminiKey = requireEnv('GEMINI_API_KEY');
const webhookSecret = requireEnv('VAPI_WEBHOOK_SECRET');
const baseUrl = requireEnv('PUBLIC_BASE_URL').replace(/\/+$/, '');

async function vapi(method, path, body) {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Vapi ${method} ${path} failed (${res.status}): ${JSON.stringify(json?.message ?? json)}`);
  }
  return json;
}

async function ensureGeminiCredential() {
  const credentials = await vapi('GET', '/credential');
  const existing = credentials.find((c) => c.provider === 'google');
  if (existing) {
    await vapi('PATCH', `/credential/${existing.id}`, { apiKey: geminiKey });
    console.log(`✓ Updated Gemini credential (${existing.id})`);
    return existing.id;
  }
  const created = await vapi('POST', '/credential', { provider: 'google', apiKey: geminiKey, name: 'Gemini (BYOK)' });
  console.log(`✓ Created Gemini credential (${created.id})`);
  return created.id;
}

async function upsertAssistant() {
  const assistantConfig = buildAssistantConfig({
    serverUrl: `${baseUrl}/api/vapi/webhook`,
    webhookSecret,
    geminiModel: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    timeZone: config.clinicTimezone,
  });
  const assistants = await vapi('GET', '/assistant?limit=100');
  const existing = assistants.find((a) => a.name === ASSISTANT_NAME);
  if (existing) {
    const updated = await vapi('PATCH', `/assistant/${existing.id}`, assistantConfig);
    console.log(`✓ Updated assistant "${ASSISTANT_NAME}" (${updated.id})`);
    return updated.id;
  }
  const created = await vapi('POST', '/assistant', assistantConfig);
  console.log(`✓ Created assistant "${ASSISTANT_NAME}" (${created.id})`);
  return created.id;
}

async function attachPhoneNumber(assistantId) {
  const numbers = await vapi('GET', '/phone-number');
  let phone = numbers.find((n) => n.assistantId === assistantId) ?? numbers[0];
  if (phone) {
    if (phone.assistantId !== assistantId) {
      phone = await vapi('PATCH', `/phone-number/${phone.id}`, { assistantId });
    }
    console.log(`✓ Phone number ${phone.number ?? phone.sipUri ?? phone.id} -> assistant`);
    return phone;
  }
  const body = { provider: 'vapi', name: 'Patient Intake Line', assistantId };
  if (env.VAPI_PHONE_AREA_CODE) body.numberDesiredAreaCode = env.VAPI_PHONE_AREA_CODE;
  phone = await vapi('POST', '/phone-number', body);
  console.log(`✓ Provisioned free Vapi number ${phone.number ?? '(activating…)'} (${phone.id})`);
  return phone;
}

try {
  console.log(`Configuring Vapi with webhook ${baseUrl}/api/vapi/webhook`);
  await ensureGeminiCredential();
  const assistantId = await upsertAssistant();
  const phone = await attachPhoneNumber(assistantId);
  console.log('\nDone.');
  console.log(`  Assistant ID : ${assistantId}`);
  console.log(`  Phone number : ${phone.number ?? 'activating — check the Vapi dashboard in a few minutes'}`);
  console.log('  Set PUBLIC_PHONE_NUMBER in Vercel to show it on the dashboard.');
} catch (error) {
  console.error(`\nSetup failed: ${error.message}`);
  process.exitCode = 1;
}
