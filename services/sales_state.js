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
 *   7. FOLLOWUP_OFFER: Meeting preference, asked once ("Would you prefer to schedule a call with our team, or would you be more comfortable meeting with us in person?")
 *      The answer (phone_call, in_person, either, undecided, declined) is read from the caller's words by code and goes into the call summary.
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

/* ------------------------------------------------------------------ *
 * Meeting preference: phone call or in person (asked once, near the end of the call).
 * The answer is read from the caller's own words by code; the AI never sets it.
 * ------------------------------------------------------------------ */

export const MEETING_PREFERENCES = ['phone_call', 'in_person', 'either', 'undecided', 'declined', 'not_specified'];

const MEETING_LABELS = {
    phone_call: 'Phone call',
    in_person: 'In-person meeting',
    either: 'Either a phone call or an in-person meeting',
    undecided: 'Undecided',
    declined: 'Declined a meeting',
    not_specified: 'Not specified'
};

const pick = (table, lang) => table[lang] || table.en;

const MEETING_QUESTION = {
    en: 'Would you prefer to schedule a call with our team, or would you be more comfortable meeting with us in person?',
    hi: 'क्या आप हमारी टीम के साथ फ़ोन कॉल तय करना पसंद करेंगे, या आमने-सामने मिलना आपके लिए ज़्यादा सुविधाजनक रहेगा?',
    te: 'మా బృందంతో ఫోన్ కాల్ షెడ్యూల్ చేసుకోవడం మీకు ఇష్టమా, లేక నేరుగా కలవడం మీకు సౌకర్యంగా ఉంటుందా?'
};

const MEETING_CLARIFICATION = {
    en: 'Just to confirm, would a phone call or an in-person meeting suit you better?',
    hi: 'बस पुष्टि के लिए, फ़ोन कॉल या आमने-सामने की मुलाकात, आपके लिए कौन सा बेहतर रहेगा?',
    te: 'నిర్ధారించుకోవడానికి, ఫోన్ కాల్ లేదా నేరుగా కలవడం, మీకు ఏది మంచిది?'
};

const MEETING_CLOSING = {
    en: 'Thank you for your time. Have a great day!',
    hi: 'आपके समय के लिए धन्यवाद। आपका दिन शुभ हो!',
    te: 'మీ సమయానికి ధన్యవాదాలు. మంచి రోజవుగాక!'
};

const MEETING_ACKS = {
    phone_call: {
        en: 'Perfect. Our team will reach out to coordinate the call and share the details with you.',
        hi: 'बहुत बढ़िया। हमारी टीम कॉल तय करने के लिए आपसे संपर्क करेगी और आपको विवरण साझा करेगी।',
        te: 'చాలా బాగుంది. మా బృందం కాల్ సమన్వయం చేయడానికి మిమ్మల్ని సంప్రదించి వివరాలను మీతో పంచుకుంటుంది.'
    },
    in_person: {
        en: 'Absolutely. Our team will reach out to coordinate the meeting and share the details with you.',
        hi: 'बिल्कुल। हमारी टीम मुलाकात तय करने के लिए आपसे संपर्क करेगी और आपको विवरण साझा करेगी।',
        te: 'తప్పకుండా. మా బృందం సమావేశాన్ని సమన్వయం చేయడానికి మిమ్మల్ని సంప్రదించి వివరాలను మీతో పంచుకుంటుంది.'
    },
    either: {
        en: 'Sounds good. Our team will reach out to coordinate the next steps and share the details with you.',
        hi: 'ठीक है। हमारी टीम अगले कदम तय करने के लिए आपसे संपर्क करेगी और आपको विवरण साझा करेगी।',
        te: 'సరే. మా బృందం తదుపరి చర్యలను సమన్వయం చేయడానికి మిమ్మల్ని సంప్రదించి వివరాలను మీతో పంచుకుంటుంది.'
    },
    undecided: {
        en: 'No problem, take your time. Our team will follow up with the details so you can decide.',
        hi: 'कोई बात नहीं, आप आराम से सोचिए। हमारी टीम विवरण के साथ संपर्क करेगी ताकि आप तय कर सकें।',
        te: 'ఏమీ పర్వాలేదు, నిదానంగా ఆలోచించండి. మీరు నిర్ణయించుకునేలా మా బృందం వివరాలతో సంప్రదిస్తుంది.'
    },
    declined: {
        en: "No problem. Thank you for your time. Our team can reconnect if you'd like to explore this in the future.",
        hi: 'कोई बात नहीं। आपके समय के लिए धन्यवाद। यदि आप भविष्य में इस पर विचार करना चाहें तो हमारी टीम दोबारा संपर्क कर सकती है।',
        te: 'ఏమీ పర్వాలేదు. మీ సమయానికి ధన్యవాదాలు. భవిష్యత్తులో దీనిని పరిశీలించాలనుకుంటే మా బృందం మళ్లీ సంప్రదించగలదు.'
    },
    not_specified: {
        en: 'No problem. Our team will follow up with the next steps.',
        hi: 'कोई बात नहीं। हमारी टीम अगले कदमों के साथ आपसे संपर्क करेगी।',
        te: 'ఏమీ పర్వాలేదు. మా బృందం తదుపరి చర్యలతో మిమ్మల్ని సంప్రదిస్తుంది.'
    }
};

const FOLLOW_UP_ACTIONS = {
    phone_call: 'Sales team to contact the prospect to coordinate a call and share the details.',
    in_person: 'Sales team to contact the prospect to coordinate an in-person meeting and share the details.',
    either: 'Sales team to contact the prospect to coordinate the next steps (call or in-person meeting) and share the details.',
    undecided: 'Sales team to follow up with the prospect and help them choose between a call and an in-person meeting.',
    declined: 'No meeting requested. Sales team may reconnect if the prospect wants to explore this in the future.',
    not_specified: 'Sales team to follow up with the prospect to confirm their preferred meeting format.'
};

export function meetingQuestion(lang = 'en') {
    return pick(MEETING_QUESTION, lang);
}

export function meetingClarification(lang = 'en') {
    return pick(MEETING_CLARIFICATION, lang);
}

/** The spoken answer to a meeting preference, ending with the usual closing line. */
export function meetingReply(preference, lang = 'en') {
    const ack = pick(MEETING_ACKS[preference] || MEETING_ACKS.not_specified, lang);
    return preference === 'declined' ? ack : `${ack} ${pick(MEETING_CLOSING, lang)}`;
}

/** True when the text is the call-or-in-person question (any of the three languages, reworded or not). */
export function isMeetingQuestion(text) {
    const t = String(text ?? '').toLowerCase();
    return /\b(call|phone)\b.{0,70}\bin[- ]person\b|\bin[- ]person\b.{0,70}\b(call|phone)\b|\bcall\b.{0,70}face[- ]to[- ]face/.test(t)
        || /(फ़ोन|फोन|कॉल).{0,80}आमने-सामने|आमने-सामने.{0,80}(फ़ोन|फोन|कॉल)/.test(t)
        || /(ఫోన్|కాల్).{0,80}నేరుగా|నేరుగా.{0,80}(ఫోన్|కాల్)/.test(t);
}

const PHONE_TERMS = '\\b(?:phone|telephone|call|calls|calling|ring|dial)\\b|फ़ोन|फोन|कॉल|ఫోన్|కాల్';
const PERSON_TERMS = '\\b(?:in person|person|face to face|meet|meeting|meetings|visit|office|physically|physical|onsite|on site)\\b|आमने सामने|मिलना|मिलें|मुलाकात|నేరుగా|కలవ|కలుద్దాం';
const NEGATORS = '(?:not|no|dont|never|without|neither|rather than|instead of|anything but)';
const negated = terms => new RegExp(`\\b${NEGATORS}\\s+(?:\\w+\\s+){0,2}(?:${terms})`, 'g');
const mention = terms => new RegExp(`(?:${terms})`);

const EITHER_RE = /\b(either|both|whichever|whatever|anything|any of|any one|anyone|no preference|dont mind|do not mind|doesnt matter|does not matter|up to you|your choice|you decide|you choose|as you wish|any is fine|any works|any will do)\b|कोई भी|दोनों|ఏదైనా|రెండూ/;
const UNDECIDED_RE = /\b(not sure|unsure|undecided|dont know|do not know|maybe|let me think|think about it|not decided|havent decided|will let you know|need to check|get back to you|discuss internally)\b/;
const DECLINED_RE = /\b(not interested|no thanks|no thank you|not right now|not now|not at the moment|not at this time|no need|dont need|dont want|do not want|not required|not looking|neither|nope|pass)\b|नहीं|नही|వద్దు|లేదు/;
const BARE_NO_RE = /^(no|nah|nahi|nahin|ledu|vaddu|kadu)\b/;

/**
 * Reads a preference from the caller's words: phone_call, in_person, either, undecided, declined, or null
 * when the answer does not say (then nothing is recorded; a preference is never guessed).
 */
export function detectMeetingPreference(text) {
    let t = String(text ?? '').toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[,.;!?]/g, ' | ')
        .replace(/[^a-z0-9ऀ-ॿఀ-౿\s|]/g, ' ')
        .replace(/\bin a meeting\b/g, ' busy ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!t) return null;
    if (/\bneither\b/.test(t)) return 'declined';

    t = t.replace(negated(PHONE_TERMS), ' ').replace(negated(PERSON_TERMS), ' ');
    const phone = mention(PHONE_TERMS).test(t);
    const person = mention(PERSON_TERMS).test(t);
    if (phone && person) return EITHER_RE.test(t) ? 'either' : null;
    if (phone) return 'phone_call';
    if (person) return 'in_person';
    if (EITHER_RE.test(t)) return 'either';
    if (UNDECIDED_RE.test(t)) return 'undecided';
    if (DECLINED_RE.test(t) || BARE_NO_RE.test(t)) return 'declined';
    return null;
}

export function followUpAction(preference) {
    return FOLLOW_UP_ACTIONS[preference] || FOLLOW_UP_ACTIONS.not_specified;
}

/** The fields stored once the caller has answered. */
export function meetingFields(preference, rawText) {
    return {
        meeting_preference: preference,
        meeting_preference_raw: String(rawText ?? '').trim(),
        meeting_preference_confirmed: true,
        follow_up_action: followUpAction(preference),
        followup_preference: preference === 'declined' ? 'declined' : (preference === 'undecided' ? 'undecided' : 'meeting')
    };
}

/** The question has been asked and the caller has not answered it yet. */
export function awaitingMeetingAnswer(collected = {}) {
    return Boolean(collected.meeting_question_asked) && !collected.meeting_preference_confirmed;
}

/**
 * Looks at the caller's turn while the meeting question is open.
 * Returns { captured, preference, fields } for a clear answer, { clarify, fields } for a bare "yes"/"okay"
 * (one clarification only), otherwise { captured: false, clarify: false } and nothing changes.
 */
export function captureMeetingAnswer(collected = {}, text = '') {
    if (!awaitingMeetingAnswer(collected)) return { captured: false, clarify: false };
    const preference = detectMeetingPreference(text);
    if (preference) return { captured: true, clarify: false, preference, fields: meetingFields(preference, text) };
    const words = String(text).trim().split(/\s+/).filter(Boolean).length;
    if (!collected.meeting_clarification_asked && (isFiller(text) || words <= 2)) {
        return { captured: false, clarify: true, fields: { meeting_clarification_asked: true } };
    }
    return { captured: false, clarify: false };
}

/** After Remo speaks: remembers that the meeting question went out (and whether its one clarification did). */
export function noteSpokenReply(collected = {}, spoken = '') {
    if (!isMeetingQuestion(spoken)) return null;
    if (!collected.meeting_question_asked) return { meeting_question_asked: true };
    if (!collected.meeting_clarification_asked && !collected.meeting_preference_confirmed) return { meeting_clarification_asked: true };
    return null;
}

/** The question (or its one clarification) would be said again: it must be held back. */
export function wouldRepeatMeetingQuestion(collected = {}, spoken = '') {
    return Boolean(collected.meeting_question_asked) && isMeetingQuestion(spoken)
        && Boolean(collected.meeting_clarification_asked || collected.meeting_preference_confirmed);
}

/** Time to ask the meeting question: discovery is done, it was never asked, and the call is not ending. */
export function needsMeetingQuestion(collected = {}) {
    if (collected.meeting_question_asked || collected.meeting_preference) return false;
    if (collected.call_completed || ['Not Interested', 'Wrong Contact', 'Do Not Call'].includes(collected.call_outcome)) return false;
    if (!has(collected, 'service_needed')) return false;
    return (has(collected, 'project_description') || collected.skip_project_description)
        && (has(collected, 'tech_preference') || collected.skip_tech_preference)
        && (has(collected, 'additional_info') || collected.skip_additional_info);
}

/** What the AI may write into extracted_fields: the meeting fields belong to code, and an answer already given is final. */
export function filterAiFields(collected = {}, fields = {}) {
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) {
        if (/^meeting_|^follow_up_action$/.test(k)) continue;
        if (k === 'followup_preference' && collected.meeting_preference_confirmed) continue;
        out[k] = v;
    }
    return out;
}

/** Fields to store when the call ends: a preference nobody expressed is "not_specified". */
export function finalizeMeetingFields(collected = {}) {
    const preference = MEETING_PREFERENCES.includes(collected.meeting_preference) ? collected.meeting_preference : 'not_specified';
    return {
        meeting_preference: preference,
        meeting_preference_raw: collected.meeting_preference_raw || null,
        meeting_preference_confirmed: preference !== 'not_specified' && Boolean(collected.meeting_preference_confirmed),
        follow_up_action: collected.follow_up_action || followUpAction(preference)
    };
}

/** The call summary: the AI's own summary kept as is, with the Sales Lead Summary after it. */
export function composeSalesSummary(collected = {}, { classification = '', summary = '' } = {}) {
    const f = { ...collected, ...finalizeMeetingFields(collected) };
    const interest = has(f, 'service_needed') ? `Interested in ${f.service_needed}.` : (classification ? `${classification}.` : 'Not recorded.');
    const lines = [
        'Sales Lead Summary',
        `Interest: ${interest}`,
        `Meeting Preference: ${MEETING_LABELS[f.meeting_preference]}.`
    ];
    if (f.meeting_preference_raw) lines.push(`Original Response: "${f.meeting_preference_raw}"`);
    lines.push(
        `Preference Confirmed: ${f.meeting_preference_confirmed ? 'Yes' : 'No'}.`,
        `Follow-up Action: ${f.follow_up_action}`
    );
    return [String(summary || '').trim(), lines.join('\n')].filter(Boolean).join('\n\n');
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

    if (needsMeetingQuestion(collected)) {
        lines.push(`- NEXT QUESTION: ask the meeting-preference question once, in the caller's language, and nothing else this turn: "${MEETING_QUESTION.en}"`);
    } else if (awaitingMeetingAnswer(collected)) {
        lines.push('- The meeting-preference question (call or in person) was just asked. The system records the answer, so never put meeting_preference in extracted_fields. If they answered, say in one short sentence that our team will reach out to coordinate and share the details, thank them and set should_end_call: true. If they declined, say no problem and that the team can reconnect in the future. NEVER ask the call-or-in-person question again.');
    } else if (collected.meeting_preference) {
        lines.push(`- Meeting preference recorded: ${collected.meeting_preference}. Do NOT ask about a call or an in-person meeting again.`);
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
    buildPromptBlock,
    MEETING_PREFERENCES,
    meetingQuestion,
    meetingClarification,
    meetingReply,
    isMeetingQuestion,
    detectMeetingPreference,
    followUpAction,
    meetingFields,
    awaitingMeetingAnswer,
    captureMeetingAnswer,
    noteSpokenReply,
    wouldRepeatMeetingQuestion,
    needsMeetingQuestion,
    filterAiFields,
    finalizeMeetingFields,
    composeSalesSummary
};
