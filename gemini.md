# Voice AI & Telephony Architecture (ElevenLabs + Plivo)

## System Overview
Agent Hari / REMO is configured to use **Plivo Telephony** for carrier-grade inbound and outbound telephone calls, paired with **ElevenLabs Voice AI** for hyper-realistic multilingual speech synthesis, transcription, and real-time conversational processing.

The platform provides data-isolated calling workflows for three distinct business services:
1. **Recruitment**: Candidate screening, qualification, status extraction (`Accepted / Shortlisted`, `Rejected`, `On Hold`), and Excel report synchronization.
2. **Sales**: Consultative discovery, objection handling, lead scoring, and outcome tracking (`INTERESTED`, `NOT_INTERESTED`, `DEMO_REQUESTED`, `FOLLOW_UP`).
3. **Customer Support**: Ticket triage, issue categorization, step-by-step troubleshooting, resolution, and human escalation (`RESOLVED`, `ESCALATED`, `PENDING_FOLLOWUP`).

---

## Telephony & Voice Stack

```
   [ Candidate / Lead / Customer ]
                 │ (PSTN / Telephone Network)
                 ▼
         [ Plivo Telephony ]
                 │
                 │ 1. Outbound Call Trigger (POST /v1/Account/{auth_id}/Call/)
                 │ 2. Answer XML Response (<Stream bidirectional="true">)
                 ▼
     [ Plivo Audio Stream (WebSocket) ]
       - 8kHz 8-bit mu-law (<Stream contentType="audio/x-mulaw;rate=8000">)
       - Plivo Webhook Events (/api/plivo/answer, /api/plivo/status, /api/plivo/hangup)
                 │
                 ▼
   [ Voicebot Stream Bridge (voicebot_stream_service.js) ]
       ├── Energy VAD & Interruption Manager (RMS / Mu-law decoding)
       │    ├── Ignores short backchannels ("yes", "okay", "hmm", "right", "haan")
       │    └── Captures sustained speech (> 1000ms) without losing conversation state
       │
       ├── ElevenLabs Speech-to-Text (Scribe API)
       │    └── Converts caller audio into high-accuracy multilingual transcripts
       │
       ├── Intelligent LLM Dialogue Engine (GeminiService / Core Prompts)
       │    └── Enforces service-specific schemas, extraction, and turn taking
       │
       └── ElevenLabs Text-to-Speech (Multilingual v2 / Turbo)
            └── Synthesizes natural dialogue directly into 8kHz mu-law audio
```

---

## Environment Configuration

```env
# Plivo Telephony Gateway
PLIVO_AUTH_ID=your_plivo_auth_id
PLIVO_AUTH_TOKEN=your_plivo_auth_token
PLIVO_VIRTUAL_NUMBER=9180XXXXXXXX
SERVER_URL=https://takeremo.com

# ElevenLabs Voice AI
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=your_chosen_voice_id
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_WEBHOOK_SECRET=your_webhook_secret

# LLM Intelligence
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=models/gemini-3.8-flash
```

---

## Interruption & Overlapping Speech Management

1. **Backchannel Filtering**:
   - Short affirmations ("yes", "yeah", "ok", "okay", "hmm", "right", "sure", "haan", "achha", "avunu", "sare") and brief audio artifacts (< 750ms) do **NOT** terminate or interrupt the AI's speaking turn.
   - The AI continues delivering its complete sentence and question smoothly.
2. **Context Preservation on True Interruption**:
   - If the candidate speaks continuously for >= 1000ms with a substantive answer, the AI pauses gracefully (`clearAudio`).
   - The active question context is preserved. The caller's response is recognized and processed alongside the pending inquiry without repeating unnecessary text.
3. **Recovery & Anti-Drop**:
   - Audio stream WebSocket operates with `keepCallAlive="true"`.
   - Technical hiccups or pauses in packet stream do not drop the call. State remains synchronized in database records.
