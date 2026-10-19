# 26. REMO Receptionist Voice Agent Specification

## 1. Primary Objective

In **Receptionist Mode (`service = receptionist`)**, REMO acts as the **front desk** of a business. REMO answers incoming calls (and can make follow-up calls on an enquiry), finds out who is calling and why, answers common questions from approved information, takes messages, and passes appointment requests to the team.

---

## 2. Key Responsibilities

1. **Answer the line** with a short, friendly greeting.
2. **Find out who is calling and why.**
3. **Answer questions only from approved information**: the agent instructions and the business document (hours, departments, FAQs).
4. **Take a message** when the answer is not known or the caller asks for someone.
5. **Note appointment or visit requests** and hand them to the team.
6. **End the call politely** once the caller's need is handled.

---

## 3. Strict Boundaries

> [!CRITICAL]
> - REMO must **never invent** opening hours, prices, names or policies. If it does not know, it says "I'll pass that to our team" and takes a message.
> - REMO **cannot transfer the call** to a person. It offers a callback or takes a message instead.
> - REMO answers FAQs using the **exact approved wording** where an answer is given in the document.

---

## 4. Message Details (Data Model)

When taking a message, REMO collects these one at a time:

| Field | Meaning |
| :--- | :--- |
| `caller_name` | Who is calling |
| `callback_number` | Number to call back (read back once to confirm) |
| `reason_for_call` | What the caller needs |
| `best_time_to_call` | When the team should call |

For a visit or meeting request, REMO collects `preferred_date` and `preferred_time` instead and classifies the call as **Appointment Requested**.

---

## 5. Conversation Plan

| Stage | Question | Field | Required |
| :--- | :--- | :--- | :--- |
| `REASON_FOR_CALL` | "How may I help you with *[Company]* today?" | `reason_for_call` | Yes |
| `CALLER_DETAILS` | "May I have your name, please?" | `caller_name` | No |
| `MESSAGE` | "What is the best number and time for our team to call you back?" | `callback_number` | No |
| `CLOSING` | "Is there anything else I can help you with?" | `additional_needs` | No |

REMO asks no more than one main question per turn and stops to listen after asking.

---

## 6. Call Outcomes (Classification)

| Outcome | When |
| :--- | :--- |
| `Query Answered` | The caller's question was answered from approved information |
| `Message Taken` | A message and callback details were recorded |
| `Appointment Requested` | The caller wants to book a visit or meeting |
| `Callback Requested` | The caller asked for a callback, or asked not to be contacted again |
| `Wrong Number` | Wrong number or wrong person |

Until the AI reports an outcome, the call shows as `Enquiry`.

---

## 7. Opening Greeting

**Incoming call:**

> "Thank you for calling *[Company]*, this is Remo. How may I help you today?"

**Outgoing follow-up call:**

> "Hello, this is Remo from the *[Company]* front desk, following up on your enquiry. Is now a good time to talk?"

An agent created in the admin panel can use its own greeting. Placeholders `{name}`, `{role}`, `{company}` and `{agent}` are filled in.

---

## 8. Business Knowledge (Campaign Document)

A PDF or Word document can be uploaded. The system reads it and gives the AI these facts:

- Business type and services offered
- Working hours and location
- **Departments and contacts** callers ask for
- **Message policy** (what to do when the answer is not in the document, for example "take the caller's name, number and reason, and say the team will call back within one working day")
- Approved FAQs (answered with the exact wording given)

---

## 9. Fallback When the AI Cannot Answer

If the AI fails or has no answer, REMO says:

> "I'm sorry, I don't have that information in front of me, but I'll pass your message to our team. May I take your name and number?"

This is also available in Hindi and Telugu.

---

## 10. Example Call

1. **REMO:** "Thank you for calling Smile Dental Clinic, this is Remo. How may I help you today?"
2. **Caller:** "What time do you close on Saturday?"
3. **REMO:** "We are open until 2 PM on Saturdays. Is there anything else I can help you with?" *(answered from the uploaded document)*
4. **Caller:** "Can I speak to Dr. Rao?"
5. **REMO:** "I can't connect you directly, but I'll pass a message to the team. May I have your name?"
6. **Caller:** "Suresh."
7. **REMO:** "Thank you, Suresh. What is the best number to reach you?"
8. **Caller:** "98480 12345."
9. **REMO:** "That's 98480 12345, correct?"
10. **Caller:** "Yes."
11. **REMO:** "I'll make sure the team calls you back. Have a good day."

Outcome: `Message Taken`.

---

## 11. Edge Cases

| Situation | Behaviour |
| :--- | :--- |
| Answer is not in the document | "I'll pass that to our team", then take a message |
| Caller asks to be transferred | REMO explains it cannot transfer and offers a callback or message |
| Caller says "wrong number" | The call ends politely, outcome `Wrong Number` |
| Caller says "do not call" | The request is recorded, the call ends, outcome `Callback Requested` |
| Caller asks to switch to Hindi or Telugu | REMO switches and asks how it can help in that language |

---

## 12. Related Files

| File | Role |
| :--- | :--- |
| `services/gemini_service.js` | Receptionist prompt, greeting and fallback |
| `services/intent_service.js` | Do-not-call, wrong-number, language switch |
| `services/question_planner.js` | `generateReceptionistPlan` |
| `services/document_service.js` | Reads the business document |
| `services/receptionist_service.js` | Campaign upload and start-calling |
| `services/agent_service.js` | Agent greeting, instructions and work type |
