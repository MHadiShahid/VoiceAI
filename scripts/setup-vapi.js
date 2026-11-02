#!/usr/bin/env node
// Provisions the voice agent on Vapi. Idempotent — safe to re-run after
// changing the prompt or tools.
//
//   1. Registers GEMINI_API_KEY as a Vapi "google" credential (BYOK).
//   2. Creates or updates the assistant from server/src/voice/assistantConfig.js.
//   3. Attaches the assistant to an existing Vapi phone number, or provisions
//      a free Vapi U.S. number if the account has none.
//   4. If VAPI_PUBLIC_KEY is set (browser calls from the dashboard), restricts
//      that public key to this assistant and to our own origins, so the key
//      embedded in the web page can't be used for anything else.
//
// Required env (.env): VAPI_API_KEY, GEMINI_API_KEY, VAPI_WEBHOOK_SECRET, PUBLIC_BASE_URL
// Optional env:        GEMINI_MODEL, VAPI_PHONE_AREA_CODE, CLINIC_TIMEZONE, VAPI_PUBLIC_KEY
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
    // Vapi re-validates the key against Gemini on every update, which fails
    // whenever Gemini is overloaded (503). Only re-send it when rotating keys.
    if (!process.argv.includes('--update-gemini-key')) {
      console.log(`✓ Gemini credential exists (${existing.id}); pass --update-gemini-key to replace it`);
      return existing.id;
    }
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
  // Free Vapi numbers require an area code and availability varies, so fall
  // back through a list of common U.S. area codes.
  const areaCodes = env.VAPI_PHONE_AREA_CODE ? [env.VAPI_PHONE_AREA_CODE] : FALLBACK_AREA_CODES;
  let lastError;
  for (const areaCode of areaCodes) {
    try {
      phone = await vapi('POST', '/phone-number', {
        provider: 'vapi',
        name: 'Patient Intake Line',
        assistantId,
        numberDesiredAreaCode: areaCode,
      });
      console.log(`✓ Provisioned free Vapi number ${phone.number ?? '(activating…)'} in area code ${areaCode} (${phone.id})`);
      return phone;
    } catch (error) {
      lastError = error;
      console.log(`  area code ${areaCode} unavailable: ${error.message}`);
    }
  }
  throw lastError;
}

async function restrictPublicKey(assistantId) {
  const publicKey = env.VAPI_PUBLIC_KEY?.trim();
  if (!publicKey) return;
  const tokens = await vapi('GET', '/token');
  const token = tokens.find((t) => t.value === publicKey && t.tag === 'public');
  if (!token) {
    console.log("! VAPI_PUBLIC_KEY not found among this org's public keys; skipping restriction.");
    return;
  }
  const allowedOrigins = [new URL(baseUrl).origin, 'http://localhost:5173'];
  await vapi('PATCH', `/token/${token.id}`, {
    restrictions: { enabled: true, allowedAssistantIds: [assistantId], allowTransientAssistant: false, allowedOrigins },
  });
  console.log(`✓ Public key restricted to this assistant and ${allowedOrigins.join(', ')}`);
}

const FALLBACK_AREA_CODES = ['415', '628', '650', '510', '408', '312', '646', '213', '617', '206', '512', '305'];

try {
  console.log(`Configuring Vapi with webhook ${baseUrl}/api/vapi/webhook`);
  await ensureGeminiCredential();
  const assistantId = await upsertAssistant();
  const phone = await attachPhoneNumber(assistantId);
  await restrictPublicKey(assistantId);
  console.log('\nDone.');
  console.log(`  Assistant ID : ${assistantId}`);
  console.log(`  Phone number : ${phone.number ?? 'activating — check the Vapi dashboard in a few minutes'}`);
  console.log('  Set PUBLIC_PHONE_NUMBER (and VAPI_PUBLIC_KEY + VAPI_ASSISTANT_ID for browser calls) in Vercel.');
} catch (error) {
  console.error(`\nSetup failed: ${error.message}`);
  process.exitCode = 1;
}
