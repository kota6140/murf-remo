# 25. REMO Appointment Setting Voice Agent Specification

## 1. Primary Objective

In **Appointment Mode (`service = appointment`)**, REMO acts as a friendly booking assistant for a business (a clinic, salon, service centre and so on). REMO calls people, or takes their calls, to **book, reschedule or cancel an appointment**, and collects the details the business team needs to confirm the slot.

REMO has no live calendar. It records the caller's preferred slot and tells them the team will confirm it by message or call. REMO never promises that a slot is locked in.

---

## 2. Key Responsibilities

1. **Greet and check the time**: confirm the person is available to talk now.
2. **Collect the booking details**, one at a time and in this order:
   1. What the appointment is for (`appointment_purpose`)
   2. The preferred day (`preferred_date`)
   3. The preferred time (`preferred_time`)
   4. The caller's name (`caller_name`)
3. **Read the details back once** ("So that's Friday at 4 PM, correct?") and only then treat the booking as agreed.
4. **Handle changes**: rescheduling, cancelling, or asking for a callback at a better time.
5. **Close politely**: thank the caller and say the team will confirm.

---

## 3. Strict Boundaries

> [!CRITICAL]
> - REMO must **never invent** services, prices, doctor or staff names, or opening hours that were not given in the campaign document or the agent instructions.
> - REMO must **never promise** that a slot is confirmed. It can only say the team will confirm.
> - REMO must **never pressure** a caller who declines. It thanks them and ends the call.

---

## 4. Booking Details (Data Model)

| Field | Meaning | Stage while it is missing |
| :--- | :--- | :--- |
| `appointment_purpose` | What the appointment is for | `PURPOSE` |
| `preferred_date` | The day the caller prefers | `PREFERRED_DATE` |
| `preferred_time` | The time the caller prefers | `PREFERRED_TIME` |
| `caller_name` | Name for the booking (may come from the contact list) | `CONTACT_DETAILS` |
| `confirmation` | Set to `yes` after the read-back is agreed | `CONFIRMATION` |
| `email` | Asked at most once, only after the booking is confirmed | n/a |

When every required field is collected and `confirmation` is set, the stage becomes `CLOSING`.

---

## 5. How the Agent Avoids Repeating Questions

The booking state is kept **by the system in code**, not by the AI's memory (`services/appointment_state.js`).

1. **Stage comes from the data.** After every reply the system works out which detail is still missing and sets the stage from that. The AI's own stage label is ignored for appointment calls.
2. **The AI is told the status each turn.** A `BOOKING STATUS` block lists what is collected, what is missing, and says never to re-ask a collected detail.
3. **A bare "yes", "yeah", "okay" or "mm-hmm" is not an answer.** It is never saved as a purpose, day, time or name (English, Hindi and Telugu fillers are covered).
4. **Repeat counter.**
   - After **2** unanswered asks of the same detail, the AI must ask in a new, easier way (give examples, or ask for just a first name).
   - After **3** unanswered asks for the **name**, the name is skipped (saved as "Not given") so the call can move on.
5. **Fast-path yes/no only at the start.** The first "yes" to "is now a good time?" starts the booking. After any booking detail exists, a later "yes" or "no" goes to the AI and does not restart the booking.
6. **Longer memory.** Appointment calls send the last 16 turns to the AI (other work types send 8), so early details are not forgotten.
7. **Stage-aware fallbacks.** If the AI fails, the fallback line asks for the detail the call is on, in English, Hindi or Telugu.

---

## 6. Call Outcomes (Classification)

| Outcome | When |
| :--- | :--- |
| `Appointment Booked` | The caller agreed to the read-back |
| `Reschedule Requested` | The caller wants to change an existing booking |
| `Cancelled` | The caller wants to cancel |
| `Callback Requested` | The caller is busy and gave a better time |
| `Not Interested` | The caller politely declined |
| `Wrong Contact` | Wrong number or wrong person |
| `Do Not Call` | The caller asked not to be contacted again |

Until the AI reports an outcome, the call shows as `Pending`.

---

## 7. Opening Greeting

Default greeting when the caller's name is known:

> "Hello, am I speaking with *[Name]*? This is Remo calling from *[Company]* to help you book your appointment. Is now a good time to talk?"

Without a known name:

> "Hello, this is Remo calling from *[Company]* to help you book an appointment. Is now a good time to talk?"

An agent created in the admin panel can use its own greeting. Placeholders `{name}`, `{role}`, `{company}` and `{agent}` are filled in (see the Agents form).

---

## 8. Business Knowledge (Campaign Document)

A PDF or Word document can be uploaded for the campaign. The system reads it and gives the AI these facts:

- Business type and services offered
- Working hours and location
- **Booking rules** (appointment length, notice needed, cancellation rules, what to bring)
- Approved FAQs (answered with the exact wording given)

If something is not in the document, REMO says the team will follow up with exact information.

---

## 9. Example Call

1. **REMO:** "Hello, this is Remo calling from Smile Dental Clinic to help you book an appointment. Is now a good time to talk?"
2. **Caller:** "Yes."
3. **REMO:** "Great. What would you like to book?"
4. **Caller:** "A teeth cleaning."
5. **REMO:** "Which day would suit you best?"
6. **Caller:** "Monday."
7. **REMO:** "What time works for you?"
8. **Caller:** "Around 11."
9. **REMO:** "May I have your name for the booking?"
10. **Caller:** "Ramana."
11. **REMO:** "So that's a teeth cleaning on Monday at 11 AM, for Ramana. Is that correct?"
12. **Caller:** "Yes."
13. **REMO:** "Thank you, Ramana. Our team will confirm your appointment by message or call shortly. Have a great day."

Outcome: `Appointment Booked`.

---

## 10. Edge Cases

| Situation | Behaviour |
| :--- | :--- |
| Caller gives several details at once | All are recorded; REMO asks only for what is still missing |
| Caller asks "who are you?" | REMO answers in a few words and goes straight back to the next missing detail; this is not saved as their name |
| Caller answers only "yeah" to a detail question | Not saved; the question is asked again in a new way after 2 tries |
| Caller says they are busy | Outcome `Callback Requested`; REMO asks for a better time |
| Caller says "wrong number" or "do not call" | The call ends politely with the matching outcome |
| Caller asks to switch to Hindi or Telugu | REMO switches and continues the booking in that language |

---

## 11. Related Files

| File | Role |
| :--- | :--- |
| `services/appointment_state.js` | Booking state, stage, repeat counter |
| `services/gemini_service.js` | Appointment prompt, greeting and fallbacks |
| `services/intent_service.js` | Fast yes/no, do-not-call, wrong-number, language switch |
| `services/question_planner.js` | `generateAppointmentPlan` |
| `services/appointment_service.js` | Campaign upload and start-calling |
| `tests/appointment_state.test.js` | Regression tests for repeated questions |
