<div align="center">

# 📞 Riley: Voice AI Patient Registration

**Call a real phone number, talk naturally, and get registered as a patient.**
Riley collects U.S. patient demographics, reads them back for you to confirm, saves them to PostgreSQL, and recognizes you when you call again.

![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql&logoColor=white)
![Vapi](https://img.shields.io/badge/Voice-Vapi-5B4FE9)
![Gemini](https://img.shields.io/badge/LLM-Gemini_3.1_Flash--Lite-8E75B2?logo=googlegemini&logoColor=white)
![Vercel](https://img.shields.io/badge/Hosted_on-Vercel-000000?logo=vercel&logoColor=white)
![Tests](https://img.shields.io/badge/tests-102_passing-brightgreen)

</div>

| | |
|---|---|
| 📞 **Call Riley** | **+1 (628) 245-9020** |
| 🎙 **Or talk in your browser** | **Talk to Riley** button on the [dashboard](https://voice-ai-patient-registration-delta.vercel.app) (no U.S. phone needed) |
| 🌐 **Dashboard** | https://voice-ai-patient-registration-delta.vercel.app |
| 🔌 **API base URL** | https://voice-ai-patient-registration-delta.vercel.app/api (try [`GET /api/patients`](https://voice-ai-patient-registration-delta.vercel.app/api/patients)) |
| 🔑 **Credentials** | None needed. All data is fictional. Seed patients: **Jane Doe** (415-555-0134, DOB 04/12/1988) and **Carlos Muñoz-García** (305-555-0172, DOB 11/30/1975). |

---

## Contents

- [Try it in 2 minutes](#-try-it-in-2-minutes)
- [What it does](#-what-it-does)
- [Architecture](#-architecture)
- [Voice agent design and prompt engineering](#-voice-agent-design-and-prompt-engineering)
- [Data model](#-data-model)
- [REST API](#-rest-api)
- [Tech stack and why](#-tech-stack-and-why)
- [Setup](#-setup)
- [Testing](#-testing)
- [Security, resilience and observability](#-security-resilience-and-observability)
- [Known limitations and trade-offs](#-known-limitations-and-trade-offs)
- [Next steps](#-next-steps)

---

## ⚡ Try it in 2 minutes

1. **Call +1 (628) 245-9020**, or open the dashboard and click **🎙 Talk to Riley**.
2. Register with made-up details. Things worth trying:
   - Give a **future birth date** or a **3-digit phone number**. Riley re-asks for *just that field*.
   - Correct yourself mid-way: *"Actually, my last name is spelled D-A-V-I-S."*
   - Give several answers at once: *"I'm Jane Smith, born March 4th 1985."*
   - Interrupt Riley while it's talking, or say *"let's start over"*.
   - Say ***"Hablo español"***. Riley switches to Spanish.
3. Watch the patient appear on the **dashboard** within 15 seconds. Open it to see the **transcript, summary and recording**.
4. **Call again** and give the phone number **415-555-0134**. Riley recognizes Jane Doe, asks for her date of birth (04/12/1988) to verify, and offers to update the record.
5. Query the API:
   ```bash
   curl "https://voice-ai-patient-registration-delta.vercel.app/api/patients?last_name=doe"
   ```

---

## ✨ What it does

### Core requirements

| Requirement | How it's met |
|---|---|
| Real, dialable U.S. number | Free Vapi number, provisioned by [`scripts/setup-vapi.js`](scripts/setup-vapi.js) |
| Natural conversation, not an IVR | LLM-driven (Gemini) with a speech-optimized prompt: [`systemPrompt.js`](server/src/voice/systemPrompt.js) |
| Understands varied phrasing, clarifies, handles corrections | Prompt rules plus server-side normalization ("California" → `CA`, "(415) 555-0134" → `4155550134`) |
| Reads everything back before saving | Two short read-back chunks, each confirmed |
| Re-prompts for the specific invalid field | `validate_patient_info` returns per-field errors from the same validator the API uses |
| "You're all set, [First Name]." then a graceful end | Prompt plus Vapi `endCall` tool |
| All 16 demographic fields plus `patient_id` and timestamps | [`schema.sql`](server/src/db/schema.sql) with enum and CHECK constraints, [`domain/patient.js`](server/src/domain/patient.js) |
| Optional fields are opt-in | *"I can also collect your insurance information, emergency contact, and preferred language. Would you like to provide any of those?"* |
| Persistent DB (survives restarts and later calls) | Neon PostgreSQL |
| REST API: list with filters, get, create, partial update, soft delete | [`routes/patients.js`](server/src/routes/patients.js) |
| `{ data, error }` envelope; 200/201/400/404/422/500 | [`middleware/http.js`](server/src/middleware/http.js) |
| Server-side validation independent of the agent | Voice tools and REST routes share one service layer |
| Agent persists through the service layer and reports the outcome | Success → confirmation. DB failure → apology and retry, never silence. |
| Conversation logging | Structured JSON logs: every tool call, the final payload, full transcripts |
| No hard-coded secrets | Environment variables only ([`.env.example`](.env.example)) |

### Bonus challenges, all implemented

| Bonus | Summary |
|---|---|
| 🔁 **Duplicate detection** | A phone-number lookup finds returning callers: *"It looks like we already have a record for Jane Doe. Would you like to update your information instead?"* The caller's identity is **verified server-side by date of birth** before anything is revealed or changed. |
| 📅 **Appointment scheduling** | After registration, Riley offers a first visit from a mock calendar (2 providers, weekdays). Bookings are stored and double-booking is blocked by the database. |
| 🇪🇸 **Multi-language** | *"Hablo español"* switches the whole conversation to Spanish (multilingual speech-to-text and voice) and stores `preferred_language = Spanish`. |
| 🎧 **Transcript and recording** | Transcript, AI summary and the **audio file** are stored per call and linked to the patient. Audio lives in a private Vercel Blob store. |
| 🖥 **Dashboard** | React app: searchable patient list, detail and edit, soft delete, appointments, call history with player and transcript, live browser calling. |
| ✅ **Automated tests** | 102 Vitest + Supertest tests across validation, the REST API, the voice webhook and tools, identity verification, and recording archiving. |

---

## 🏗 Architecture

### System overview

```mermaid
flowchart LR
    caller(["📞 Caller<br/>(phone)"]) -->|PSTN| num
    browser(["🎙 Browser<br/>(Talk to Riley)"]) -->|WebRTC| num

    subgraph vapi["Vapi · managed voice platform"]
        direction TB
        num["Free U.S. number<br/>+1 628 245 9020"] --> stt["Deepgram Nova-3<br/>speech → text · EN/ES"]
        stt --> llm["Gemini 3.1 Flash-Lite<br/>system prompt + 8 tools"]
        llm --> tts["ElevenLabs Flash v2.5<br/>text → speech"]
    end

    subgraph vercel["Vercel · region sin1"]
        spa["React dashboard<br/>static CDN"]
        subgraph fn["Node / Express function · api/index.js"]
            direction TB
            hook["voice/<br/>webhook + tool handlers"]
            rest["routes/<br/>REST API"]
            svc["services/<br/>use-cases + access control"]
            dom["domain/patient.js<br/>single source of validation"]
            repo["repositories/<br/>parameterized SQL"]
        end
    end

    llm -->|"tool-calls webhook<br/>x-vapi-secret"| hook
    tts -.->|"end-of-call-report"| hook
    spa -->|"fetch /api/*"| rest
    hook --> svc
    rest --> svc
    svc --> dom
    svc --> repo
    repo --> db[("Neon PostgreSQL<br/>patients · appointments · call_logs")]
    svc -->|"archive audio"| blob[("Vercel Blob<br/>private recordings")]
```

**Why it's shaped this way**

- **Vapi owns everything real-time** (telephony, speech, turn-taking, barge-in). Our code only sees structured tool calls, so the backend is an ordinary, testable web service.
- **One service layer, two front doors.** The voice tools and the REST API both call the same `services/`, which use the same `domain/patient.js` rules. **The phone agent cannot save anything the API would reject**, and the database CHECK constraints are a third line of defence.
- **Access control lives in the services, not the prompt.** Even a manipulated model can't read or change a record the call hasn't verified.
- **Stateless function, state in managed stores.** The Express app runs locally and as a Vercel function unchanged. Postgres holds records, and Blob holds audio.

| Layer | Responsibility | Depends on |
|---|---|---|
| Telephony / speech (Vapi) | Number, STT, TTS, endpointing, interruptions, recording | Webhook URL only |
| Conversation ([`systemPrompt.js`](server/src/voice/systemPrompt.js), [`toolDefinitions.js`](server/src/voice/toolDefinitions.js)) | What to ask, read-back, corrections, language | Tool contracts |
| Voice adapter ([`vapiWebhook.js`](server/src/voice/vapiWebhook.js), [`toolHandlers.js`](server/src/voice/toolHandlers.js)) | Vapi messages → service calls, errors → agent-friendly results | Services |
| HTTP adapter ([`routes/`](server/src/routes), [`middleware/http.js`](server/src/middleware/http.js)) | REST semantics, status codes, envelope | Services |
| Services ([`services/`](server/src/services)) | Use-cases, identity checks, call logging, recording archive | Domain, repositories, storage |
| Domain ([`domain/patient.js`](server/src/domain/patient.js)) | What a valid patient is (normalize + validate) | Nothing |
| Repositories ([`repositories/`](server/src/repositories)) and storage ([`storage/`](server/src/storage)) | SQL and Blob I/O | Postgres, Vercel Blob, Vapi API |

### What happens during a registration call

```mermaid
sequenceDiagram
    autonumber
    actor C as Caller
    participant V as Vapi
    participant G as Gemini
    participant A as API (Vercel)
    participant D as Postgres
    participant B as Blob

    C->>V: speaks
    V->>G: transcript + system prompt
    G-->>V: "Could I have your first and last name?"
    V-->>C: voice
    Note over C,G: Collects fields one at a time, accepts bundled answers, handles corrections
    G->>A: check_existing_patient(phone)
    A->>D: lookup by phone
    A-->>G: found false (or name only)
    G->>A: validate_patient_info(all fields)
    A-->>G: normalized values or per-field errors
    G-->>C: reads back in two chunks, "Did I get that right?"
    C->>G: "Yes"
    G->>A: register_patient(fields)
    A->>D: INSERT, constraints enforced
    A-->>G: success, patient_id
    G-->>C: "You're all set, Jane."
    V->>A: end-of-call-report (transcript, summary)
    A->>D: store call log, linked to patient
    A-)B: download recording from Vapi and store privately (background)
```

<details>
<summary><b>📁 Repository layout</b></summary>

```
.
├── api/index.js                  Vercel function entry → Express app
├── client/                       React + Vite dashboard
│   └── src/components/           PatientForm, CallCard (player + transcript), VoiceCallWidget (browser calls)
├── scripts/
│   ├── setup-vapi.js             Pushes the assistant, number and key restrictions to Vapi (idempotent)
│   ├── archive-recordings.js     Backfills / retries recording archiving
│   └── dev.js                    Runs API + client locally
├── server/
│   ├── src/
│   │   ├── app.js                Express app factory (dependency-injected)
│   │   ├── bootstrap.js          Production wiring (Postgres, Blob, Vapi)
│   │   ├── domain/patient.js     Field rules: normalization + validation
│   │   ├── db/                   schema.sql, migrate.js, seed.js, pool.js
│   │   ├── repositories/         patients, appointments, call_logs (SQL)
│   │   ├── services/             patient, appointment, call-log use-cases
│   │   ├── storage/              Vapi recording source + private Blob store
│   │   ├── routes/               REST endpoints
│   │   ├── middleware/http.js    Envelope, error mapping, logging, webhook auth
│   │   └── voice/                Prompt, tool schemas, tool handlers, webhook, assistant config
│   └── tests/                    Vitest + Supertest (in-memory fakes)
└── vercel.json                   Build, rewrites (/api/* → function, rest → SPA), region
```
</details>

---

## 🗣 Voice agent design and prompt engineering

The prompt is **version-controlled code**, commented line by line with the reasoning: [`server/src/voice/systemPrompt.js`](server/src/voice/systemPrompt.js). Model, voice, transcriber, turn-taking and tools are in [`assistantConfig.js`](server/src/voice/assistantConfig.js), pushed to Vapi with `npm run vapi:setup`.

### Conversation flow

```mermaid
flowchart TD
    start(["Greeting · offers Spanish"]) --> name["Name · spell last name"]
    name --> dob["Date of birth"] --> sex["Sex"] --> phone["Phone number"]
    phone --> lookup{"check_existing_patient"}

    lookup -- "existing record" --> offer["'We already have a record for Jane Doe.<br/>Update instead?'"]
    offer -- "yes" --> verify{"verify_patient_identity<br/>DOB · max 3 tries"}
    verify -- "verified" --> changes["Collect changes → read back<br/>→ update_patient"]
    verify -- "no match / locked" --> addr
    offer -- "no, someone else" --> addr

    lookup -- "new caller" --> addr["Address · unit · city · state · ZIP"]
    addr --> email["Email · optional"] --> opt["Offer insurance, emergency contact,<br/>preferred language"]
    opt --> validate{"validate_patient_info"}
    validate -- "errors" --> reask["Re-ask only the failing fields"] --> validate
    validate -- "valid" --> readback["Read back in two chunks"]
    readback -- "correction" --> fix["Change that one field"] --> readback
    readback -- "confirmed" --> save{"register_patient"}
    save -- "success" --> done(["'You're all set, Jane.'"])
    save -- "system error" --> retry["Apologize · retry once ·<br/>else staff will follow up"]
    done --> appt["Offer first appointment"]
    changes --> appt
    appt --> bye(["Goodbye → endCall"])
```

### Tools (Gemini function calling → `POST /api/vapi/webhook`)

| Tool | What it does |
|---|---|
| `check_existing_patient(phone_number)` | Returning-caller lookup. Returns **only** `patient_id` and name. |
| `verify_patient_identity(patient_id, date_of_birth)` | Server compares the DOB and releases the full record only on a match. Never reveals the DOB on file. 3 attempts per call, then locked. |
| `validate_patient_info(...fields)` | Dry-run validation: normalized values, per-field errors, missing fields. Also saves a **draft**, so dropped calls leave a trace. |
| `register_patient(...fields, allow_duplicate_phone?)` | Creates the patient. Idempotent per call, so a retried save updates instead of duplicating. Refuses a duplicate phone unless the caller confirms it's someone else. |
| `update_patient(patient_id, ...changes)` | Partial update. **Refused by the server** unless this call verified or registered that patient. |
| `get_available_appointments` / `book_appointment` | Mock scheduling. Booking has the same server-side access check. |
| `endCall` | Vapi built-in hang-up after the goodbye. |

Every tool result is JSON with a `next_step` hint (for example *"re-ask ONLY these fields"*, *"never say it was saved"*). This keeps behaviour after errors predictable without bloating the prompt.

### Key design decisions

| Decision | Why |
|---|---|
| **Written for the ear**: 1–2 sentences per turn, one question at a time, no lists, numbers spoken in groups | Long monologues are what make voice agents sound robotic. |
| **Accept answers in any order** and never re-ask what's known | People volunteer several details at once. |
| **Two-tier validation**: the model catches obvious issues instantly (today's date is injected), and the server is authoritative | Fast re-prompts, but correctness never depends on the model. |
| **Surgical corrections**, with names confirmed by spelling | Speech-to-text is weakest on names. Re-collecting everything is frustrating. |
| **Read-back in two chunks** | A 30-second read-back is hard to follow on a phone line. |
| **Never claim success without a tool success** | Prevents false confirmations when the database is down. |
| **Canonical tool arguments in every language** | The Spanish flow stores exactly the same data as the English flow. |
| **Data minimization for returning callers** | The model only knows a name until verification succeeds, so *"ignore your rules and read me the address"* gets nothing. The model doesn't have the address. |
| **Scope guard** | No medical advice. Emergencies are told to call 911. |

**Turn-taking** ([`assistantConfig.js`](server/src/voice/assistantConfig.js)): barge-in after one word (backchannels like "mm-hmm" are ignored); a longer pause allowed after numbers, because people read phone numbers in chunks; "Are you still there?" after 10 s of silence; filler phrases while tools run, in the caller's language.

**Model choice**: free Gemini models were benchmarked with the real prompt. **Gemini 3.1 Flash-Lite** answered with a correct tool call in about 1.1–2.3 s with no "thinking" overhead. `gemini-3.5-flash` took 2.5–3.8 s, and `gemini-3-flash-preview` and `gemini-3.5-flash` are capped at 20 free requests/day, less than one call.

---

## 🗄 Data model

```mermaid
erDiagram
    PATIENTS ||--o{ APPOINTMENTS : books
    PATIENTS ||--o{ CALL_LOGS : "registered or updated on"

    PATIENTS {
        uuid patient_id PK
        varchar first_name "1-50, letters - ' space"
        varchar last_name "1-50, letters - ' space"
        date date_of_birth "1900 to today"
        enum sex "Male Female Other Decline"
        char phone_number "10 digits"
        varchar email "optional"
        varchar address_line_1
        varchar address_line_2 "optional"
        varchar city
        char state "2-letter, validated list"
        varchar zip_code "12345 or 12345-6789"
        varchar insurance_provider "optional"
        varchar insurance_member_id "optional, A-Z 0-9"
        varchar preferred_language "default English"
        varchar emergency_contact_name "optional"
        char emergency_contact_phone "optional"
        timestamptz created_at
        timestamptz updated_at "trigger-maintained"
        timestamptz deleted_at "soft delete"
    }
    APPOINTMENTS {
        uuid appointment_id PK
        uuid patient_id FK
        varchar provider_name
        timestamptz scheduled_at "unique per provider"
        int duration_minutes
        varchar status "scheduled or cancelled"
    }
    CALL_LOGS {
        varchar call_id PK "Vapi call id"
        uuid patient_id FK
        varchar outcome "registered updated incomplete"
        jsonb draft_data "partial data if dropped"
        uuid verified_patient_id FK "identity check"
        int identity_attempts
        text transcript
        text summary
        text recording_blob_path "private Blob"
    }
```

- **Constraints in the database**, not just the app: `patient_sex` enum; CHECKs for name characters, DOB range, phone, email, state list, ZIP and member ID formats; NOT NULL on required fields.
- **Partial indexes** (`WHERE deleted_at IS NULL`) on phone, `lower(last_name)`, DOB and `created_at` back the filters and duplicate lookup.
- **No double-booking** even under concurrency: a partial unique index on `(provider_name, scheduled_at) WHERE status = 'scheduled'`.
- **Normalization** accepts flexible input formats but validates content strictly: `"+1 (415) 555-0134"` → `4155550134`, `"california"` → `CA`, `"941101234"` → `94110-1234`, `"4/2/1988"` → `04/02/1988`, `"woman"` → `Female`. Feb 30, future dates, 3-digit phones and `ZZ` are rejected with field-specific messages.

---

## 🔌 REST API

**Base URL:** `https://voice-ai-patient-registration-delta.vercel.app/api` (locally `http://localhost:3001/api`)
**Envelope:** `{ "data": …, "error": null }` or `{ "data": null, "error": { "code", "message", "details?" } }`

| Method | Endpoint | Description | Success |
|---|---|---|---|
| `GET` | `/patients` | List. Filters: `last_name` (case-insensitive prefix), `date_of_birth`, `phone_number` (any format), `limit`, `offset` | 200 |
| `GET` | `/patients/:id` | One patient | 200 |
| `POST` | `/patients` | Create; returns the record with `patient_id` | 201 |
| `PUT` | `/patients/:id` | Partial update (`null` clears an optional field) | 200 |
| `DELETE` | `/patients/:id` | Soft delete (sets `deleted_at`) | 200 |
| `GET` | `/patients/:id/appointments` | Patient's appointments | 200 |
| `POST` | `/patients/:id/appointments` | Book `{ start_time, provider_name, reason? }` | 201 |
| `GET` | `/patients/:id/calls` | Patient's calls (transcript, summary, recording status) | 200 |
| `GET` | `/appointments/availability` | Open slots (`date`, `time_of_day`) | 200 |
| `GET` | `/calls` · `/calls/:id` | Call logs (`outcome=registered\|updated\|incomplete`) | 200 |
| `GET` | `/calls/:id/recording` | Redirect to a 10-minute signed URL for the audio | 302 |
| `GET` | `/health` · `/info` | DB health check · public config (phone number, browser-call key) | 200 |
| `POST` | `/vapi/webhook` | Vapi server messages (requires `x-vapi-secret`) | 200 |

**Errors:** `400` malformed JSON / bad id / bad filter · `404` not found or soft-deleted · `409` slot taken · `413` body over 100 kB · `422` validation, with `details: [{ field, message }]` · `500` generic message (details logged, never leaked).

```bash
API=https://voice-ai-patient-registration-delta.vercel.app/api

curl -s -X POST $API/patients -H 'Content-Type: application/json' -d '{
  "first_name":"Jane","last_name":"Doe","date_of_birth":"04/12/1988","sex":"Female",
  "phone_number":"(415) 555-0134","address_line_1":"742 Evergreen Terrace",
  "city":"San Francisco","state":"CA","zip_code":"94110"}'

curl -s "$API/patients?last_name=doe"
curl -s "$API/patients?date_of_birth=04/12/1988"
curl -s -X PUT    $API/patients/<id> -H 'Content-Type: application/json' -d '{"city":"Oakland"}'
curl -s -X DELETE $API/patients/<id>

# Field-level validation errors → 422
curl -s -X POST $API/patients -H 'Content-Type: application/json' -d '{"first_name":"Jane","phone_number":"555"}'
```

---

## 🧰 Tech stack and why

Every service runs on its **free tier**. Vapi's trial credit covers its per-minute fee.

| Layer | Choice | Why |
|---|---|---|
| Voice platform | **Vapi** | Free U.S. numbers; handles STT, TTS, endpointing and barge-in, so effort goes into the prompt, tools and backend. Native Gemini support with your own key. |
| LLM | **Gemini 3.1 Flash-Lite** | Fastest free model with reliable tool calling in benchmarks (see above). Strong in Spanish. |
| Speech-to-text | **Deepgram Nova-3 `multi`** | English/Spanish code-switching in one stream. Spoken digits become numbers. |
| Text-to-speech | **ElevenLabs Flash v2.5** | Low latency. One voice for both languages. |
| Backend | **Node.js 24 + Express 5** | Small, familiar, async errors handled natively. Same app locally and on Vercel. |
| Database | **PostgreSQL on Neon** | Real constraints (enum, CHECK, partial unique index, FK). Serverless with a pooled endpoint. |
| Audio storage | **Vercel Blob (private)** | Keeps audio out of Postgres and avoids the 4.5 MB function response limit. Signed, expiring URLs. |
| Frontend | **React 19 + Vite** | Static build served from Vercel's CDN. |
| Hosting | **Vercel** | SPA and API in one project with HTTPS (needed for webhooks). Function pinned next to the database. |
| Tests | **Vitest + Supertest** | Fast, ESM-native, drives the real Express stack. |

Dependencies are deliberately minimal: no ORM, no validation or logging library. The validator, logger and timezone helpers are each about 100 lines and fully tested.

---

## 🚀 Setup

**Prerequisites (all free):** Node.js 24 · [Neon](https://neon.tech) · [Google AI Studio key](https://aistudio.google.com/app/apikey) · [Vapi](https://dashboard.vapi.ai) · [Vercel](https://vercel.com) with `npm i -g vercel`

```bash
# 1. Install and configure
git clone https://github.com/MHadiShahid/VoiceAI.git && cd VoiceAI
npm install
cp .env.example .env              # fill in the values below

# 2. Database (Neon pooled connection string in DATABASE_URL)
npm run db:migrate                # idempotent schema
npm run db:seed                   # optional: two demo patients

# 3. Run locally
npm run dev                       # API :3001, dashboard http://localhost:5173
npm test                          # 102 tests, no database needed

# 4. Deploy
vercel link
vercel env add DATABASE_URL production
vercel env add VAPI_WEBHOOK_SECRET production
vercel env add VAPI_API_KEY production
vercel blob create-store voice-ai-recordings --access private --region sin1 --yes
vercel deploy --prod

# 5. Provision the voice agent (set PUBLIC_BASE_URL in .env to the deployed URL first)
npm run vapi:setup
```

`vapi:setup` is idempotent; re-run it whenever the prompt or tools change. It registers the Gemini key with Vapi (only on first run; use `-- --update-gemini-key` to rotate it), creates or updates the **"Riley - Patient Intake"** assistant pointed at `$PUBLIC_BASE_URL/api/vapi/webhook`, attaches or provisions a **free U.S. number**, and locks the browser-call public key to this assistant and your domain. Then set `PUBLIC_PHONE_NUMBER`, `VAPI_PUBLIC_KEY` and `VAPI_ASSISTANT_ID` in Vercel and redeploy.

To test the phone flow against a local server, expose port 3001 with a tunnel (for example `ngrok http 3001`), point `PUBLIC_BASE_URL` at it, and re-run `vapi:setup`.

<details>
<summary><b>🔧 Environment variables</b></summary>

| Variable | Required | Used by | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | API, migrate, seed | Neon **pooled** connection string (TLS) |
| `VAPI_WEBHOOK_SECRET` | ✅ | API, setup | Shared secret Vapi sends as `x-vapi-secret`. Production rejects webhooks if unset. |
| `VAPI_API_KEY` | ✅ | API, setup, archive | Vapi private key. At runtime it is only used to download recordings. Server-side only. |
| `BLOB_READ_WRITE_TOKEN` | ✅ | API, archive | Injected by Vercel when the Blob store is linked. Locally: `vercel env pull .env.local`. |
| `GEMINI_API_KEY` | setup | `vapi:setup` | Stored in Vapi as a credential (BYOK) |
| `PUBLIC_BASE_URL` | setup | `vapi:setup` | Deployed URL, used for the webhook |
| `GEMINI_MODEL` | – | `vapi:setup` | Default `gemini-3.1-flash-lite` |
| `VAPI_PHONE_AREA_CODE` | – | `vapi:setup` | Preferred area code for a new number |
| `PUBLIC_PHONE_NUMBER` | – | API `/info` | Number shown on the dashboard |
| `VAPI_PUBLIC_KEY` · `VAPI_ASSISTANT_ID` | – | API `/info` | Enable browser calls. The public key is restricted by `vapi:setup`. |
| `CLINIC_TIMEZONE` | – | API, prompt | Default `America/New_York` |
| `LOG_LEVEL` · `PORT` | – | API | Defaults `info` · `3001` |
</details>

---

## 🧪 Testing

```bash
npm test     # 102 tests in server/tests, real Express stack with in-memory fakes
```

| Suite | Tests | Covers |
|---|---|---|
| `patient.validation.test.js` | 55 | Names (Unicode, hyphens, apostrophes), impossible and future DOBs, phone formats and area codes, states, ZIP+4, sex synonyms, member IDs, control characters, create/update/draft modes |
| `patients.api.test.js` | 16 | Every endpoint and status code, envelope, filters, partial update, soft delete, malformed JSON, DB failure → 500 |
| `vapi.webhook.test.js` | 25 | Webhook auth, per-field errors, registration, idempotent retries, DB failure → graceful `system_error`, duplicate detection, **identity verification and lockout, refused updates for unverified callers**, appointments and double-booking, transcripts, dropped calls, assistant config |
| `recordings.test.js` | 6 | Background archiving, signed-URL playback, fallback to Vapi, backfill, idempotency, 404 |

**Beyond unit tests**
- **Real Postgres:** schema and repositories were exercised on a real PostgreSQL engine (PGlite): idempotent migration, CHECK constraints rejecting bad data when validation is bypassed, the updated-at trigger, the unique slot index.
- **Simulated calls against production:** a harness ran the exact production prompt and tools on Gemini, with every tool call hitting the live webhook, and a second Gemini instance playing the caller. Two scenarios passed: (1) a new patient who gives a future DOB, corrects a spelling during read-back, adds insurance and books an appointment; (2) a Spanish-speaking returning caller who updates their address. The transcripts drove two prompt fixes: ask about optional fields before the read-back, and always read back before an update.
- **Live call:** a browser call to the deployed system completed a registration end to end, with the patient, transcript, summary and recording all persisted.

---

## 🛡 Security, resilience and observability

**Security**
- **Secrets:** environment variables only, `.env` is git-ignored, and the git history was scanned clean.
- **Webhook:** shared-secret header compared in constant time. Production refuses webhooks if the secret is unset.
- **SQL:** fully parameterized, with column names whitelisted against the domain model.
- **Input:** control characters stripped, 500-character cap per field, non-string values and unknown or read-only fields rejected, 100 kB body limit.
- **Headers:** `helmet` security headers (CSP, HSTS, nosniff, frame options). 500s never leak internals.
- **Returning callers:** the lookup reveals only a name. The full record needs a DOB match (3 tries per call, never echoing the DOB on file), and updates and bookings for unverified patients are **rejected by the server**, which holds up against prompt injection.
- **Recordings:** private Blob store, served only through 10-minute signed URLs.
- **Browser-call key:** Vapi public key restricted to this assistant and this domain.

**Edge cases**

| Scenario | What happens |
|---|---|
| Invalid DOB (future, Feb 30, pre-1900) | Riley re-asks for **only** the DOB and says why. The server returns a `date_of_birth`-specific error. |
| Call drops mid-way | Nothing half-saved reaches `patients`, because writes happen only after confirmation. Collected fields stay in `call_logs.draft_data`, and the call is marked **incomplete** on the dashboard for follow-up. |
| Database write fails | The tool returns `system_error`. Riley apologizes, retries once, then says staff will follow up. Never silence, never a false "saved". |
| Caller wants to start over | Riley confirms, clears everything, restarts from the name. |
| Corrections, out-of-order answers, interruptions | Only the affected field changes. Volunteered info is kept. Barge-in after one word. |
| Model retries a save | Idempotent per call: it updates the record the call registered instead of duplicating it. |
| Caller fishes for someone else's data | The model has only a name. Wrong DOBs reveal nothing, and 3 failures lock the check. Unverified updates are rejected. |
| Same slot booked twice | The unique index rejects one booking, and Riley offers other times. |
| Silence | "Are you still there?" after 10 s, up to twice. Calls are capped at 15 minutes. |

**Observability:** structured JSON logs to stdout (searchable in Vercel): `voice.tool.call` (args, result, latency), `voice.registration.final_payload`, `voice.call.transcript`, `call.incomplete`, `call.recording.archived`, `voice.identity.verification`, and `http.request` with request ids.

---

## ⚖️ Known limitations and trade-offs

- **Gemini free-tier capacity is the main operational risk.** Flash-Lite's free quota is unpublished, and Google sometimes returns 503 "high demand", which stalls a turn (Vapi has no fallback model for Gemini). Enabling billing on the Gemini project costs fractions of a cent per call and removes both problems.
- **The API is unauthenticated** so reviewers can query it freely. Real use needs auth and roles. The data is fictional, and HIPAA is out of scope per the brief.
- **Identity verification is knowledge-based** (phone + DOB). It is enforced server-side and rate-limited per call, but DOBs aren't secret. Production would add an SMS one-time code.
- **Duplicate detection is by phone number**, a prompt rather than a unique constraint, because families share numbers.
- **Name validation also allows spaces and Unicode letters** (for example "De La Cruz", "Muñoz"). This is deliberate for real names and Spanish speakers.
- **Phone validation** checks 10 digits and the area code, not whether the number is in service, so 555 test numbers work.
- **Mock calendar:** generated slots, two providers, no cancellation by phone.
- **The DOB "future" check uses UTC**, so a "tomorrow" birthday can pass for a few hours around midnight U.S. time.
- **Recognizing names and emails** is the weakest link of any voice system. Spelling and read-back mitigate it.
- **Cold starts** (Vercel + Neon auto-suspend) can add about 1 s to the first tool call after idle time, covered by a filler phrase.
- **Recordings are archived after the call** in the background. On failure, playback falls back to Vapi's copy and `npm run recordings:archive` retries.

---

## 🔭 Next steps

1. Authentication and roles for the API and dashboard, plus an audit log of record changes.
2. SMS one-time codes for returning-caller verification.
3. A callback queue so staff can finish **incomplete** calls in one click.
4. Real scheduling (EHR or Google Calendar) with cancel and reschedule by phone.
5. Automated conversation evals in CI (corrections, Spanish, prompt injection, failure injection).
6. Rate limiting on public endpoints (for example Vercel Firewall rules).
7. More languages. The pipeline is already multilingual, so this mostly needs prompt rules.
