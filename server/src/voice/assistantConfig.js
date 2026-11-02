// Builds the Vapi assistant definition. Keeping it in code (instead of
// clicking around the Vapi dashboard) makes the agent reviewable and
// reproducible: `npm run vapi:setup` pushes exactly this config.

import { FIRST_MESSAGE, buildSystemPrompt } from './systemPrompt.js';
import { TOOL_DEFINITIONS, TOOL_FAILED_MESSAGE, TOOL_MESSAGES } from './toolDefinitions.js';

export const ASSISTANT_NAME = 'Riley - Patient Intake';

// Chosen by benchmark on a free-tier key (Nov 2026), using the real prompt:
//  - gemini-3.1-flash-lite: ~1.1–2.3 s to a correct tool call, no thinking tokens,
//    most generous free quota  ← default
//  - gemini-3.5-flash:      ~2.5–3.8 s (thinking adds latency on every turn)
//  - gemini-3-flash-preview: fast, but the free tier allows only 20 requests/day,
//    less than one phone call
//  - gemini-2.5-*:          no longer offered to new API keys
// Override with GEMINI_MODEL.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

/**
 * @param {{ serverUrl: string, webhookSecret: string, geminiModel?: string, timeZone?: string }} options
 */
export function buildAssistantConfig({ serverUrl, webhookSecret, geminiModel = DEFAULT_GEMINI_MODEL, timeZone = 'America/New_York' }) {
  const server = {
    url: serverUrl,
    timeoutSeconds: 20,
    headers: { 'x-vapi-secret': webhookSecret },
  };

  const functionTools = Object.entries(TOOL_DEFINITIONS).map(([name, def]) => ({
    type: 'function',
    function: { name, description: def.description, parameters: def.parameters },
    server,
    messages: [...(TOOL_MESSAGES[name] ?? []), TOOL_FAILED_MESSAGE],
  }));

  return {
    name: ASSISTANT_NAME,

    // LLM: Google Gemini, using our own API key registered as a Vapi
    // credential (BYOK) so usage is billed to the Gemini free tier.
    model: {
      provider: 'google',
      model: geminiModel,
      // Gemini 3 models are tuned for temperature 1.0 (Google warns lower values
      // can cause looping); older models get a low value for consistency.
      temperature: geminiModel.startsWith('gemini-3') ? 1.0 : 0.3,
      maxTokens: 300,
      messages: [{ role: 'system', content: buildSystemPrompt({ timeZone }) }],
      tools: [...functionTools, { type: 'endCall' }],
    },

    // Speech-to-text: Deepgram Nova-3 in multilingual mode so the caller can
    // switch to Spanish mid-call without reconfiguration.
    transcriber: {
      provider: 'deepgram',
      model: 'nova-3',
      language: 'multi',
      smartFormat: true, // renders spoken digits as numbers ("five five five" -> 555)
    },

    // Text-to-speech: ElevenLabs Flash v2.5 is low-latency and multilingual,
    // so the same voice speaks English and Spanish naturally.
    voice: {
      provider: '11labs',
      voiceId: 'sarah',
      model: 'eleven_flash_v2_5',
      stability: 0.5,
      similarityBoost: 0.75,
    },

    firstMessage: FIRST_MESSAGE,
    firstMessageMode: 'assistant-speaks-first',
    firstMessageInterruptionsEnabled: true,

    // Turn-taking. Callers read phone numbers / ZIPs in chunks, so wait a bit
    // longer after a number before assuming they're done.
    startSpeakingPlan: {
      waitSeconds: 0.4,
      transcriptionEndpointingPlan: { onPunctuationSeconds: 0.1, onNoPunctuationSeconds: 1.5, onNumberSeconds: 1.0 },
    },
    // Barge-in: stop talking as soon as the caller says a word ("actually",
    // "no", "wait" interrupt immediately; backchannels like "okay" don't).
    stopSpeakingPlan: { numWords: 1, voiceSeconds: 0.2, backoffSeconds: 1 },

    // Gentle nudge if the caller goes quiet.
    hooks: [
      {
        on: 'customer.speech.timeout',
        options: { timeoutSeconds: 10, triggerMaxCount: 2, triggerResetMode: 'onUserSpeech' },
        do: [{ type: 'say', exact: ['Are you still there?', 'Take your time — I\'m still here whenever you\'re ready.'] }],
      },
    ],

    maxDurationSeconds: 900,
    backgroundSound: 'off',
    endCallPhrases: ['have a great day', 'que tenga un buen día'],

    // MP3 keeps archived recordings small (WAV is roughly 10x larger).
    artifactPlan: { recordingEnabled: true, recordingFormat: 'mp3' },

    server,
    serverMessages: ['tool-calls', 'end-of-call-report', 'status-update'],

    metadata: { app: 'voice-ai-patient-registration' },
  };
}
