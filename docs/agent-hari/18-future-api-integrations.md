# 18. REMO Future API Integrations & Ecosystem Architecture

> **NOTICE: TELEPHONY & VOICE PIPELINE ACTIVE ARCHITECTURE**  
> Active implementation uses **Plivo** for carrier telephony and bidirectional audio streaming (`<Stream>`), **ElevenLabs** for multilingual voice synthesis (`eleven_multilingual_v2`) and Scribe speech-to-text, and **Google Gemini** for LLM reasoning and extraction.

---

## 1. System Integration Matrix

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        REMO CONVERSATIONAL CORE                        │
└─────┬──────────────┬──────────────┬──────────────┬──────────────┬──────┘
      │              │              │              │              │
      ▼              ▼              ▼              ▼              ▼
 [Telephony]       [STT]          [LLM]          [TTS]       [Backend / DB]
   (Plivo)      (ElevenLabs    (Google Gemini    (ElevenLabs    (Node.js +
                  Scribe)        3.8 Flash)      Multilingual)   MySQL/SQLite)
```

---

## 2. Component Specifications

### A. Telephony Gateway (Active: Plivo Telephony)
- **Role**: Ingest PSTN/SIP telephone calls, establish real-time two-way audio media streams via Plivo `<Stream>`, and manage call control.
- **Communication Protocol**: Secure WebSockets (`wss://`) with 8kHz 8-bit μ-law audio frames.
- **Data Exchanged**:
  - *Inbound*: `CallUUID`, `From` (Caller ID), `To` (Dialed Number), `CallStatus`, continuous inbound 8kHz μ-law audio packets.
  - *Outbound*: Continuous synthesized speech audio packets (`playAudio`), audio clear directives (`clearAudio`), call termination.

---

### B. Speech-to-Text (STT) Engine (Active: ElevenLabs Scribe STT)
- **Role**: Convert caller audio turns into high-accuracy punctuated text transcripts with automatic language detection (English, Hindi, Telugu).
- **Communication Protocol**: HTTP REST / Scribe audio processing.
- **Data Exchanged**:
  - *Input*: Telephony audio buffers (8kHz μ-law / 16-bit PCM WAV).
  - *Output*: Punctuated transcript strings, detected language codes, endpointing.

---

### C. Large Language Model (LLM) Inference (Active: Google Gemini 3.8 Flash)
- **Role**: Dialogue reasoning, intent classification, memory management, tool execution decision-making, and natural response synthesis.
- **Communication Protocol**: REST over HTTPS / JSON generation.
- **Data Exchanged**:
  - *Input*: System prompt, conversation history array, active mode context, contact details.
  - *Output*: Spoken response text, extracted structured fields, call summary, and lifecycle classification.

---

### D. Voice / Text-to-Speech (TTS) Engine (Active: ElevenLabs Multilingual v2 / Turbo)
- **Role**: Convert generated text into warm, expressive, ultra-low-latency voice audio matching REMO's persona.
- **Communication Protocol**: REST / Chunked audio stream directly in `ulaw_8000`.
- **Data Exchanged**:
  - *Input*: Spoken response text from LLM dialogue engine.
  - *Output*: Native 8kHz 8-bit μ-law audio frames streamed directly to Plivo WebSocket without transcoding lag.

---

### E. Backend Server & Dialogue Orchestrator (Future Candidates: Python/Flask/FastAPI or Node.js/Express)
- **Role**: Coordinate session lifecycles, manage in-memory state machines, enforce guardrails, and execute business logic tools.
- **Data Exchanged**: Coordinates payloads between telephony, STT, LLM, TTS, and databases.

---

### F. Relational Persistence Store (Future Candidates: PostgreSQL, MySQL)
- **Role**: Store immutable call audit records, structured candidate profiles, sales leads, support tickets, and performance metrics.
- **Data Exchanged**: Structured SQL CRUD operations with ACID guarantees.

---

### G. Transactional Email Provider (Future Candidates: SendGrid, Postmark, AWS SES, Resend)
- **Role**: Deliver instant lead alerts, candidate summaries, and ticket confirmations to human stakeholders.
- **Data Exchanged**: SMTP / REST payloads containing rendered HTML/text templates, metadata, and recipient emails.

---

### H. Enterprise CRM / ATS Systems (Future Candidates: Salesforce, HubSpot, Greenhouse, Lever)
- **Role**: Ingest qualified leads and candidates into corporate workflows.
- **Data Exchanged**: REST webhooks creating or updating Contacts, Deals, and Job Applications.

---

### I. Spreadsheet & Excel Integration Engine (Future Candidates: openpyxl, pandas, Microsoft Graph API, Google Sheets API)
- **Role**: Ingest candidate batches from `.xlsx` / `.csv` spreadsheets, match caller identity to candidate rows, update screening metrics, append recruiter notes, and update statuses without corrupting formulas, formatting, or column layouts.
- **Communication Protocol**: Local file I/O with concurrency locking (`portalocker` / `fasteners`) or OAuth2 REST over HTTPS.
- **Data Exchanged**:
  - *Input*: Candidate lookup keys (`phone_number`, `email`, `candidate_name`), verified attribute deltas.
  - *Output*: Updated spreadsheet cells, row index validation, commit status confirmation.

---

### J. Candidate Direct Confirmation Email Gateway (Future Candidates: SendGrid, Postmark, AWS SES, Resend)
- **Role**: Dispatch personalized post-call review emails directly to candidate inboxes containing all collected data, complete with a reply-to correction channel.
- **Communication Protocol**: REST HTTPS / SMTP with TLS.
- **Data Exchanged**:
  - *Input*: Verified candidate email address, screening metrics payload (name, phone, role, experience, location, notice period, salary).
  - *Output*: Unique message ID, delivery status receipt, bounce/reject telemetry.

---

## 3. Latency Budget Target (Future End-to-End Voice Loop)

To maintain a fluid, human-like cadence, the future voice loop must target a round-trip latency of **under 800 milliseconds**:

```text
[Caller Stops Speaking] ────► [Voice Activity Detection: 150ms]
                        ────► [STT Final Transcription: 150ms]
                        ────► [LLM Time to First Token: 250ms]
                        ────► [TTS Audio First Chunk:  150ms]
                        ────► [Telephony Buffer Out:    50ms]
─────────────────────────────────────────────────────────────
TOTAL LATENCY TARGET:         ~ 750 milliseconds (Human Cadence)
```
