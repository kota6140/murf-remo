/**
 * services/appointment_state.js
 *
 * Code-side bookkeeping for appointment-setting calls, so the call does not depend on the AI
 * remembering what it already asked:
 *  - which booking details are collected and which are still missing
 *  - which stage the call is in (derived from the details, never from the AI)
 *  - how many times in a row the same detail was asked without an answer
 */

/** The details a booking needs, in the order they are asked. */
export const APPOINTMENT_FIELDS = [
    { key: 'appointment_purpose', stage: 'PURPOSE', label: 'what the appointment is for' },
    { key: 'preferred_date', stage: 'PREFERRED_DATE', label: 'the preferred day' },
    { key: 'preferred_time', stage: 'PREFERRED_TIME', label: 'the preferred time' },
    { key: 'caller_name', stage: 'CONTACT_DETAILS', label: "the caller's name" }
];

/** After this many unanswered asks of the same detail, the AI must change its wording. */
export const REPHRASE_AFTER = 2;
/** After this many, the name (only) is skipped so the call can move on. */
export const GIVE_UP_AFTER = 3;

/** Answers that carry no information: a bare "yes" is not a purpose, a day, a time or a name. */
const FILLER = /^(yes|yeah|yep|yup|ya|ok|okay|sure|haan|ha|hmm+|mm+|mhm+|uh+|um+|right|correct|of course|alright|fine|accha|theek|hai|avunu|sare|हां|हाँ|हा|जी|ठीक|है|అవును|సరే)$/i;

export function isFiller(value) {
    const clean = String(value ?? '').toLowerCase().replace(/[^a-zऀ-ॿఀ-౿\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return true;
    return clean.split(' ').every(w => FILLER.test(w));
}

function has(collected, key) {
    const v = collected ? collected[key] : null;
    return v !== null && v !== undefined && String(v).trim() !== '' && !isFiller(v);
}

/** The required details not collected yet, in asking order. */
export function missingFields(collected = {}) {
    return APPOINTMENT_FIELDS.filter(f => !has(collected, f.key));
}

/** The stage the call is in, given what is collected. */
export function stageFor(collected = {}) {
    const missing = missingFields(collected);
    if (missing.length) return missing[0].stage;
    const c = collected && collected.confirmation;
    return c !== null && c !== undefined && String(c).trim() !== '' ? 'CLOSING' : 'CONFIRMATION';
}

/**
 * True once the caller has given a booking detail (purpose, day or time). The name is left out
 * because it can come from the contact list before the caller says anything.
 */
export function hasProgress(collected = {}) {
    return APPOINTMENT_FIELDS.some(f => f.key !== 'caller_name' && has(collected, f.key));
}

/**
 * Updates the "same detail asked again" counter after a reply.
 * @param {{field: string|null, count: number}} tracker previous state
 * @returns {{field: string|null, count: number}} the new state
 */
export function trackAsk(tracker, collected = {}) {
    const next = missingFields(collected)[0];
    const field = next ? next.key : null;
    if (!field) return { field: null, count: 0 };
    if (tracker && tracker.field === field) return { field, count: tracker.count + 1 };
    return { field, count: 1 };
}

/**
 * The block added to the AI prompt: what is collected, what to ask next, and what to do when
 * the caller keeps not answering.
 */
export function buildPromptBlock(collected = {}, tracker = { field: null, count: 0 }) {
    const missing = missingFields(collected);
    const got = APPOINTMENT_FIELDS.filter(f => has(collected, f.key)).map(f => `${f.key}=${JSON.stringify(collected[f.key])}`);
    const lines = ['BOOKING STATUS (kept by the system, trust it over your own memory):'];
    lines.push(`- Collected: ${got.length ? got.join(', ') : 'nothing yet'}`);
    if (!missing.length) {
        const confirmed = stageFor(collected) === 'CLOSING';
        lines.push(confirmed
            ? '- All details are collected and confirmed. Thank the caller, say the team will confirm by message or call, and end the call.'
            : '- All details are collected. Read them back ONCE in a single sentence and ask if that is correct. When they agree, set extracted_fields.confirmation to "yes".');
        return lines.join('\n');
    }
    lines.push(`- Still missing, in order: ${missing.map(f => f.key).join(', ')}`);
    lines.push(`- If the caller's latest message answers "${missing[0].key}" (${missing[0].label}), record it in extracted_fields and ask for the NEXT missing detail. Otherwise ask for "${missing[0].key}".`);
    lines.push('- A bare "yes", "yeah", "okay" or "hmm" is NOT an answer to a detail question. Do not record it as one.');
    lines.push('- Never ask for a detail listed under Collected.');
    if (tracker && tracker.field === missing[0].key && tracker.count >= REPHRASE_AFTER) {
        lines.push(`- You have already asked for "${missing[0].key}" ${tracker.count} times without getting it. Do NOT repeat your earlier wording or apologise again. Ask in a new, easier way (offer examples, or ask for just one word such as a first name).`);
    }
    return lines.join('\n');
}

export default {
    APPOINTMENT_FIELDS,
    REPHRASE_AFTER,
    GIVE_UP_AFTER,
    isFiller,
    missingFields,
    stageFor,
    hasProgress,
    trackAsk,
    buildPromptBlock
};
