# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

**TakeRemo / Agent Hari (REMO)**: an AI voice-calling platform. Businesses upload contacts, and the REMO agent phones them (or answers incoming calls) in English, Hindi and Telugu. Work types: `recruitment`, `sales`, `support`, `appointment`, `receptionist`.

One Node.js process serves the website, the REST APIs, the Plivo webhooks and the live-call WebSocket.

## Commands

```
npm install        # install dependencies
npm run dev        # node --watch server.js (local, auto-reload)
npm start          # node server.js (production uses PM2: ecosystem.config.cjs)
node tests/<file>.test.js    # run one test file (no test runner; each file exits 0/1)
```

- Default port is 8080 (`PORT` in `.env`). Health check: `GET /api/health`.
- `better-sqlite3` is optional and may not be installed locally. Tests that need the database then fail with "Database connection failed". This is a known local-setup issue, not a code bug. Tests that stub the database or LLM still run.

## Stack

- Node.js >= 18, ESM (`"type": "module"`), Express, `ws`.
- Telephony: **Plivo** (webhooks `/api/plivo/*`, audio WebSocket `/voicebot`). Speech in/out: **ElevenLabs**. LLM: Claude Haiku first, Gemini as fallback (`services/llm_service.js`). Exotel and Sarvam are old providers kept for compatibility; do not build on them.
- Database: MySQL in production, SQLite locally (`services/db.js`). Some older JSON stores write to `data/`.
- Frontend: plain HTML/CSS/JS served from the project root. There is no build step and no framework.

## Layout

```
server.js                       app wiring, static pages, route mounting, WebSocket upgrade
routes/                         admin.js, auth.js, owner.js, owner_agents.js, owner_calls.js, user.js, demo.js
middleware/auth.js              JWT auth
services/
  voicebot_stream_service.js    CallSession: the live call (VAD → STT → intent/LLM → TTS)
  gemini_service.js             prompts, greetings, fallbacks per work type
  intent_service.js             fast-path replies (yes/no, do-not-call, language switch)
  question_planner.js           question plan per work type
  appointment_state.js          code-side booking state (see below)
  question_tracker.js           what was asked / answered, duplicate-question guard (see below)
  greeting_script.js            the exact recruitment opening words (English, Hindi, Telugu)
  agent_service.js              multi-agent: own number, greeting, instructions, voice
  *_service.js                  campaign, call queue, documents, excel, email, etc.
docs/agent-hari/                agent specification docs (numbered .md files)
tests/                          *.test.js, plain Node + assert
dashboard.html, admin.html, user-dashboard.html   the three logged-in apps
```

## How a call flows

Caller audio → VAD (silence detection) → ElevenLabs STT → `IntentService.matchIntent` (short replies) → otherwise `GeminiService.generateReply` (LLM returns JSON: `spoken_response`, `extracted_fields`, `classification`, `should_end_call`) → ElevenLabs TTS → audio back to Plivo.

Key rules to keep in mind:
- Keep the pipeline fast. Do not add slow work before the greeting or between a caller finishing and the reply.
- The LLM must return valid JSON; every work type has a language-specific fallback line (`getUniversalFallback`).
- `ConversationStates` and `scheduleSpeechEnd()` handle turn-taking. Be careful when changing them; the recruitment tests cover them.
- `RECRUITMENT_VAD_SILENCE_MS` (default 1400, valid 500–5000) sets the silence wait for recruitment calls.
  Right after the greeting ("is this a good time?") a short answer is answered sooner: `RECRUITMENT_VAD_BRIEF_SILENCE_MS` (default 700, valid 400–1400).
- Reply lifecycle: every caller turn has one response (`beginResponse`). Speech is queued so sentences play in order (`playAiAudio`), a barge-in or a newer response cancels the rest (`cancelActiveResponse`), and the state goes back to `LISTENING` only when the audio has really finished (`completePlayback`, ended by Plivo's `playedStream` checkpoint or by the audio-length timer). Never set `LISTENING` right after `playAiAudio`; use `finishTurn`.
- `TTS_TIMEOUT_MS` (default 8000) gives up on a text-to-speech request. `PLIVO_PLAYBACK_CHECKPOINTS=off` turns off the Plivo playback checkpoints.
- Missing latency measurements are `null`, never `0` (`latency_tracker.js`).

## Recruitment opening and repeated questions

- Opening: "Hello, am I speaking with <name>?" (only with a verified name) → after "yes": "Hi, this is Remo, an AI calling assistant from ScoreLabs Inc. Is this a good time to speak for a minute?" → after "yes": the first screening question, never the availability question again. The words live in `services/greeting_script.js`. An agent's own greeting (admin panel) or a campaign document's opening line still wins.
- `services/question_tracker.js` is the source of truth for what was asked and answered. A question is "asked" when its audio starts, "answered" by a real answer (not "yeah", "what do you mean?" or "and then?"). Questions are compared by topic (`topicOf`), not wording, so a reworded question is the same question. Every recruitment reply goes through `guardReply` before it is spoken (repeated question → next planned question; repeated opener dropped; a bare "Sure." gets the next question). Other work types only log duplicates.
- A speech-to-text language label is only a hint: the language changes through `LanguageStateMachine` (sustained sentences or an explicit request), never because of "ha", "hmm" or "okay".
- Tests: `node tests/call_flow_regression.test.js` (mocked speech, AI, voice and phone; set `SKIP_TTS_PRECACHE=1` so loading the call code never calls the paid voice service).

## Appointment calls: state lives in code

Do not rely on the AI to remember what it already asked. `services/appointment_state.js` keeps the collected details (`appointment_purpose`, `preferred_date`, `preferred_time`, `caller_name`), derives the stage from them, counts repeated asks, and builds the `BOOKING STATUS` block put in the prompt. A bare "yes"/"yeah"/"mm-hmm" is never saved as a detail. Regression tests: `node tests/appointment_state.test.js`.

## Data scoping

Conversations, batches and contacts carry `owner_user_id`. Admins see their own rows (plus unowned ones); the owner panel (`/admin`) manages admins and agents. Keep this scoping in mind for any new query or endpoint.

## Conventions

- Match the surrounding code: naming, comment density, plain JavaScript.
- User-facing speech must work in English, Hindi and Telugu. Add all three when you add a spoken line.
- Add or update a test in `tests/` for call-flow changes. Tests are plain `node:assert` scripts.
- Agent docs in `docs/agent-hari/` are numbered; add new ones with the next number.

## Working rules (from the project owner)

- **Edit code with the Edit/Write tools only.** Never use `sed`, `awk` or ad-hoc scripts to change source files.
- **Do not change code when the user asks a question** ("tell me here", "explain"). Answer first and wait until they ask for changes.
- **No code changes to the per-admin agents proposal** until the user says so.
- Telephony is **Plivo + ElevenLabs**, not Exotel.
- Rate limiting is deliberately deferred. Do not bring it up unless deployment preparation comes up.
- Work on `main` (the team has agreed to work on `main` only). Pull and merge before pushing, and never overwrite a co-worker's pushed changes.
- Commit or push only when asked.

## Secrets

`.env` is git-ignored and holds provider keys (Plivo, ElevenLabs, Claude, Gemini, database, SMTP). Never print it in full, never copy values into code, docs, tests or commits, and never commit it. If a key is shown by accident, tell the user to rotate it.
