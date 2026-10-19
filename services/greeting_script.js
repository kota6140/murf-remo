/**
 * services/greeting_script.js
 *
 * The exact words of the recruitment call opening, in one place so the greeting, the quick-reply layer
 * and the tests always agree:
 *
 *   1. "Hello, am I speaking with [name]?"                     (only when a verified name is known)
 *   2. "Hi, this is Remo, an AI calling assistant from ScoreLabs Inc. Is this a good time to speak for a minute?"
 *   3. after "yes": the first screening question (never the availability question again)
 */

export const COMPANY_NAME = 'ScoreLabs Inc.';

const pick = (en, hi, te, lang) => {
    const l = String(lang || 'en').toLowerCase();
    if (l === 'hi') return hi;
    if (l === 'te') return te;
    return en;
};

/** Step 1: asks for the candidate by name. */
export function identityQuestion(name, lang = 'en') {
    return pick(
        `Hello, am I speaking with ${name}?`,
        `नमस्ते, क्या मैं ${name} से बात कर रहा हूँ?`,
        `నమస్కారం, నేను ${name} గారితో మాట్లాడుతున్నానా?`,
        lang
    );
}

/** Step 2: who Remo is, and the availability question. Spoken once, after the identity is confirmed. */
export function recruitmentIntro(lang = 'en') {
    return pick(
        // COMPANY_NAME already ends with a full stop ("ScoreLabs Inc."), so no extra one is added after it.
        `Hi, this is Remo, an AI calling assistant from ${COMPANY_NAME} Is this a good time to speak for a minute?`,
        `नमस्ते, मैं रेमो हूँ, ${COMPANY_NAME} की ओर से एक AI कॉलिंग असिस्टेंट। क्या यह एक मिनट बात करने के लिए सही समय है?`,
        `నమస్కారం, నేను రెమో, ${COMPANY_NAME} నుండి AI కాలింగ్ అసిస్టెంట్‌ని. ఒక నిమిషం మాట్లాడటానికి ఇది మంచి సమయమేనా?`,
        lang
    );
}

/** A caller who asks "who is this?" gets the identity without the whole greeting again. */
export function whoIsCalling(lang = 'en') {
    return pick(
        `This is Remo, an AI calling assistant from ${COMPANY_NAME} Is now a good time to talk?`,
        `मैं रेमो हूँ, ${COMPANY_NAME} का AI कॉलिंग असिस्टेंट। क्या अभी बात करने का सही समय है?`,
        `నేను రెమో, ${COMPANY_NAME} AI కాలింగ్ అసిస్టెంట్‌ని. ఇప్పుడు మాట్లాడటానికి మంచి సమయమేనా?`,
        lang
    );
}

/** The first screening question when the campaign has no question plan. */
export function firstScreeningQuestion(lang = 'en') {
    return pick(
        'Could you briefly tell me about your recent development experience?',
        'क्या आप अपने हाल के डेवलपमेंट अनुभव के बारे में संक्षेप में बता सकते हैं?',
        'మీ ఇటీవలి డెవలప్‌మెంట్ అనుభవం గురించి క్లుప్తంగా చెప్పగలరా?',
        lang
    );
}

export default { COMPANY_NAME, identityQuestion, recruitmentIntro, whoIsCalling, firstScreeningQuestion };
