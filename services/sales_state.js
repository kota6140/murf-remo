/**
 * services/sales_state.js
 *
 * Code-side deterministic state tracking for Remo AI Sales calling agent (Scorelabs Inc.).
 * Enforces the 7-step natural conversation discovery flow:
 *   1. GREETING: Confirm customer identity ("Hi, am I speaking with [Name]?")
 *   2. PERMISSION_CHECK: Permission to speak ("Hi [Name], this is Remo calling from Scorelabs Inc. Is this a good time to talk for a minute?")
 *   3. SERVICE_DISCOVERY: Discover service needed ("I just wanted to check if there's any service or project you're currently looking for help with.")
 *   4. PROJECT_DESCRIPTION: One brief follow-up ("Sure, could you tell me a little more about what you're looking for?") - skipped if already answered
 *   5. TECH_PREFERENCE: Optional tech stack question ("Do you have any specific technical preferences, or would you like our team to recommend the best approach?")
 *   6. ADDITIONAL_INFO: Final discovery ("Is there anything else you'd like us to know about your requirements?")
 *   7. FOLLOWUP_OFFER: Follow-up offer ("Would you like us to send you some information about Scorelabs Inc. or discuss your requirements with our team?")
 *   8. CLOSING: Polite closing ("Thank you for your time. We appreciate your interest. Have a great day!")
 *
 * Strict anti-repetition rules:
 *   - Tracks collected customer facts code-side so questions are never repeated.
 *   - Prevents re-asking requirements if the customer already explained them in earlier turns.
 *   - Non-technical customers are never grilled about programming languages or databases.
 *   - Handles "I already told you" by acknowledging and continuing without repeating.
 *   - Handles unusual answers (e.g. launch in 1000 years) gracefully without getting stuck.
 */

export const SALES_FIELDS = [
    { key: 'service_needed', stage: 'SERVICE_DISCOVERY', label: 'the service or project you are looking for help with' },
    { key: 'project_description', stage: 'PROJECT_DESCRIPTION', label: 'a brief description of what you need the project to do' },
    { key: 'tech_preference', stage: 'TECH_PREFERENCE', label: 'any specific technical preferences or team recommendation' },
    { key: 'additional_info', stage: 'ADDITIONAL_INFO', label: 'any additional requirements or notes' },
    { key: 'followup_preference', stage: 'FOLLOWUP_OFFER', label: 'whether you would like follow-up information or a team discussion' }
];

export const REPHRASE_AFTER = 2;

const FILLER = /^(yes|yeah|yep|yup|ya|ok|okay|sure|haan|ha|hmm+|mm+|mhm+|uh+|um+|right|correct|of course|alright|fine|accha|theek|hai|avunu|sare|हां|हाँ|हा|जी|ठीक|है|అవును|సరే)$/i;

export function isFiller(value) {
    const clean = String(value ?? '').toLowerCase().replace(/[^a-zऀ-ॿఀ-౿\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return true;
    return clean.split(' ').every(w => FILLER.test(w));
}

export function has(collected, key) {
    const v = collected ? collected[key] : null;
    return v !== null && v !== undefined && String(v).trim() !== '' && !isFiller(v);
}

/**
 * Returns missing fields required for the discovery flow.
 * Note: tech_preference is optional, and project_description is skipped if service_needed already contains rich details.
 */
export function missingFields(collected = {}) {
    const missing = [];
    if (!has(collected, 'service_needed')) {
        missing.push(SALES_FIELDS[0]); // SERVICE_DISCOVERY
    }
    if (!has(collected, 'project_description') && !collected.skip_project_description) {
        missing.push(SALES_FIELDS[1]); // PROJECT_DESCRIPTION
    }
    if (!has(collected, 'tech_preference') && !collected.skip_tech_preference) {
        missing.push(SALES_FIELDS[2]); // TECH_PREFERENCE
    }
    if (!has(collected, 'additional_info') && !collected.skip_additional_info) {
        missing.push(SALES_FIELDS[3]); // ADDITIONAL_INFO
    }
    if (!has(collected, 'followup_preference')) {
        missing.push(SALES_FIELDS[4]); // FOLLOWUP_OFFER
    }
    return missing;
}

/**
 * Computes current stage based on conversation state and collected details.
 */
export function stageFor(collected = {}, currentStage = 'GREETING') {
    if (collected.call_completed || collected.call_outcome === 'Not Interested' || collected.call_outcome === 'Wrong Contact' || collected.call_outcome === 'Do Not Call') {
        return 'CLOSING';
    }

    if (currentStage === 'GREETING' && !collected.greeting_confirmed) {
        return 'GREETING';
    }

    if ((currentStage === 'GREETING' && collected.greeting_confirmed) || currentStage === 'PERMISSION_CHECK') {
        if (!collected.permission_granted) {
            return 'PERMISSION_CHECK';
        }
    }

    if (!has(collected, 'service_needed')) {
        return 'SERVICE_DISCOVERY';
    }

    if (!has(collected, 'project_description') && !collected.skip_project_description) {
        return 'PROJECT_DESCRIPTION';
    }

    if (!has(collected, 'tech_preference') && !collected.skip_tech_preference) {
        return 'TECH_PREFERENCE';
    }

    if (!has(collected, 'additional_info') && !collected.skip_additional_info) {
        return 'ADDITIONAL_INFO';
    }

    if (!has(collected, 'followup_preference')) {
        return 'FOLLOWUP_OFFER';
    }

    return 'CLOSING';
}

/**
 * Checks if customer already expressed any service need or project requirements.
 */
export function hasServiceProgress(collected = {}) {
    return has(collected, 'service_needed') || has(collected, 'project_description');
}

/**
 * Tracks repeated asks for the same detail to prevent circular loops.
 */
export function trackAsk(tracker, collected = {}) {
    const missing = missingFields(collected);
    const next = missing[0];
    const field = next ? next.key : null;
    if (!field) return { field: null, count: 0 };
    if (tracker && tracker.field === field) return { field, count: tracker.count + 1 };
    return { field, count: 1 };
}

/** Stages before the discovery questions begin; asks are not counted while the call is still in them. */
const PRE_DISCOVERY_STAGES = ['GREETING', 'PERMISSION_CHECK', 'CALLBACK_TIME', 'CLOSING'];

/**
 * trackAsk for a live call: the counter only runs once the call is in the discovery questions,
 * so "is this a good time?" turns are never counted as repeats of the service question.
 */
export function trackTurn(tracker, collected = {}, currentStage = 'GREETING') {
    if (PRE_DISCOVERY_STAGES.includes(String(currentStage || '').toUpperCase())) return { field: null, count: 0 };
    return trackAsk(tracker, collected);
}

/**
 * Builds the strict code-grounded instructions block injected into the LLM system prompt.
 */
export function buildPromptBlock(collected = {}, tracker = { field: null, count: 0 }) {
    const got = [];
    if (has(collected, 'service_needed')) got.push(`service_needed: "${collected.service_needed}"`);
    if (has(collected, 'project_description')) got.push(`project_description: "${collected.project_description}"`);
    if (has(collected, 'tech_preference')) got.push(`tech_preference: "${collected.tech_preference}"`);
    if (has(collected, 'timeline')) got.push(`timeline: "${collected.timeline}"`);
    if (has(collected, 'additional_info')) got.push(`additional_info: "${collected.additional_info}"`);
    if (has(collected, 'followup_preference')) got.push(`followup_preference: "${collected.followup_preference}"`);

    const lines = [
        '### SCORELABS INC. SALES STATE & ANTI-REPETITION STATUS:',
        `- Information Already Collected (STRICTLY DO NOT ASK AGAIN): ${got.length ? got.join(', ') : 'None yet.'}`
    ];

    if (collected.service_needed) {
        lines.push(`- The customer has already identified their service: "${collected.service_needed}". Do NOT ask what service they need.`);
    }
    if (collected.project_description) {
        lines.push(`- The customer has already described their project: "${collected.project_description}". Do NOT ask what they are looking for or to explain their requirements again.`);
    }
    if (collected.tech_preference) {
        lines.push(`- Technical preference recorded: "${collected.tech_preference}". Do NOT ask about technologies, stacks, frameworks, or databases.`);
    }
    if (collected.additional_info) {
        lines.push(`- Additional requirements recorded: "${collected.additional_info}". Do NOT ask if they have anything else to add.`);
    }
    if (collected.followup_preference) {
        lines.push(`- Follow-up preference recorded: "${collected.followup_preference}". Close the call politely.`);
    }

    if (collected.customer_called_out_repetition) {
        lines.push('- The customer said they already told you something. Apologise in a few words, do NOT repeat any earlier question, and move on to the next topic.');
    }

    if (tracker && tracker.field && tracker.count >= REPHRASE_AFTER) {
        lines.push(`- Note: The customer did not give a detailed answer to "${tracker.field}". DO NOT repeat the question. Accept what they said and move immediately to the next stage.`);
    }

    return lines.join('\n');
}

export default {
    SALES_FIELDS,
    REPHRASE_AFTER,
    isFiller,
    has,
    missingFields,
    stageFor,
    hasServiceProgress,
    trackAsk,
    trackTurn,
    buildPromptBlock
};
