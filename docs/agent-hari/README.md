# REMO (Voice AI Agent) — Documentation & Specification System

Welcome to the definitive architectural specification for **REMO**, an enterprise-grade, human-like voice AI agent built for business voice automation across three foundational domains:
1. **Recruitment**
2. **Sales**
3. **Customer Support**

---

## 📌 Voice & Telephony Architecture (ElevenLabs + Plivo)

> **CURRENT STATUS: ACTIVE IMPLEMENTATION**  
> Telephony calling is handled via **Plivo** carrier integration (outbound calling, DID virtual numbers, bidirectional audio streaming).  
> Voice AI synthesis and transcription are handled via **ElevenLabs** (multilingual TTS in 8kHz mu-law and high-accuracy Scribe STT).  
> Conversational dialogue and turn-taking management are powered by **Gemini / LLM** with intelligent backchannel filtering to prevent premature interruptions.

---

## 📂 Documentation Directory & Reading Order

Every specification document in this directory serves as a single source of truth for upcoming implementation phases. Read and implement them in the following order:

| File | Title | Description |
| :--- | :--- | :--- |
| **[01-agent-hari-overview.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/01-agent-hari-overview.md)** | Agent Overview & Architecture | Purpose, target businesses, unified single-core multi-mode model, current stage restrictions. |
| **[02-agent-personality.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/02-agent-personality.md)** | Core Personality & Voice Tone | Conversational traits, speaking style, anti-robotic rules, silence, pacing, and interruption guidelines. |
| **[03-core-system-prompt.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/03-core-system-prompt.md)** | Master System Prompt | Complete, drop-in master LLM system prompt governing identity, mode switches, guardrails, and tools. |
| **[04-conversation-principles.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/04-conversation-principles.md)** | Conversation Principles | 10-step conversation lifecycle, question limits, active listening, and topic management. |
| **[05-recruitment-agent.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/05-recruitment-agent.md)** | Recruitment Mode Spec | Candidate screening, qualification, status tracking, Excel sheet candidate intake, candidate confirmation email, and recruiter handoff. |
| **[06-sales-agent.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/06-sales-agent.md)** | Sales Mode Spec | Consultative discovery, objection handling, lead scoring, non-aggressive sales principles. |
| **[07-customer-support-agent.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/07-customer-support-agent.md)** | Customer Support Mode Spec | Troubleshooting, tier categorization (Low to Critical), resolution workflows, emergency human routing. |
| **[08-call-flow.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/08-call-flow.md)** | Standard & Mode Call Flows | Visual diagrams and state transitions for generic, recruitment, sales, and support calls. |
| **[09-information-collection.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/09-information-collection.md)** | Information Collection | Spoken normalization rules for phone, email, names, dates, salaries, Excel sheet column validation, and confirmation email verification. |
| **[10-error-handling.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/10-error-handling.md)** | Comprehensive Error Handling | Exact scripts and recovery logic for 19 real-world failure scenarios (including Excel locks and confirmation email failures). |
| **[11-unknown-information.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/11-unknown-information.md)** | Unknown Information Protocol | "Never guess when you don't know" rules, anti-hallucination scripts across all 3 domains. |
| **[12-human-escalation.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/12-human-escalation.md)** | Human Escalation Protocol | Triggers for human transfer, 3-step warm handoff, context payloads, and transfer failure fallback. |
| **[13-safety-and-guardrails.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/13-safety-and-guardrails.md)** | Safety, Security & Guardrails | Prompt injection defense, PII protection, non-impersonation, legal/financial guardrails. |
| **[14-phone-number-handling.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/14-phone-number-handling.md)** | Spoken Phone Number Handling | Grouped digits, spoken natural words, international codes, correction parsing, confirmation. |
| **[15-data-handling.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/15-data-handling.md)** | Data Handling & Schemas | Field specifications for Common, Recruitment, Sales, and Support datasets; Excel spreadsheet column mapping; compliance guidelines. |
| **[16-email-notification.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/16-email-notification.md)** | Email Notification Specs | Email delivery formats, `REMO_NOTIFICATION_EMAIL` variable, lead & ticket summaries, and candidate confirmation email protocol. |
| **[17-future-tools.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/17-future-tools.md)** | Future Tool Definitions | 16 tool contracts (`readCandidateExcel`, `updateCandidateExcel`, `sendCandidateConfirmationEmail`, etc.) with input/output schemas. |
| **[18-future-api-integrations.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/18-future-api-integrations.md)** | Future API Integrations | Architecture mapping for Telephony, STT, LLM, TTS, Excel/Spreadsheet engines, DB, CRM, and Candidate Email gateway. |
| **[19-future-database-design.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/19-future-database-design.md)** | Future Database Design | Relational ER entity schema (calls, candidates, leads, tickets, transcripts) with field types. |
| **[20-conversation-examples.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/20-conversation-examples.md)** | Realistic Conversation Dialogues | 16 full dialogues (6 recruitment with Excel sync & email confirmation, 5 sales, 5 support) plus 10 challenging edge dialogues. |
| **[21-edge-case-scenarios.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/21-edge-case-scenarios.md)** | 30+ Edge Case Scenarios | Matrix of 30+ voice edge scenarios with trigger, response, and recovery actions. |
| **[22-testing-checklist.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/22-testing-checklist.md)** | Testing & QA Checklist | Comprehensive test cases covering accuracy, interruptions, speech quality, and security. |
| **[23-agent-evaluation.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/23-agent-evaluation.md)** | Evaluation & Scoring Rubric | 11-dimension 1–5 scoring rubric with criteria for Level 1, Level 3, and Level 5 performance. |
| **[24-future-implementation-roadmap.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/24-future-implementation-roadmap.md)** | 13-Phase Implementation Roadmap | Step-by-step technical progression from Phase 1 (Docs) to Phase 13 (Production deployment). |

---

## 🎯 How the Three Operating Modes Work

REMO is **not three separate bots**. REMO is **one coherent personality** that operates under a runtime mode switch:

```
MODE = RECRUITMENT | SALES | CUSTOMER_SUPPORT
```

Regardless of mode, REMO maintains the exact same voice, empathy, conversational pacing, and safety principles. The active mode simply focuses REMO's domain knowledge, required information fields, and goal actions.

---

## 🧭 Next Implementation Steps

Once this documentation foundation is validated, proceed to **Phase 2 (LLM Selection & Prompt Testing)** and **Phase 3 (STT/TTS Latency Benchmarking)** as outlined in **[24-future-implementation-roadmap.md](file:///c:/Users/HP/Desktop/AgentHari/docs/agent-hari/24-future-implementation-roadmap.md)**.
