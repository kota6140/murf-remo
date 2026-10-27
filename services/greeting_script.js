/**
 * services/greeting_script.js
 *
 * The exact words of the recruitment call opening, in one place so the greeting, the quick-reply layer
 * and the tests always agree:
 *
 *   1. "Hello, am I speaking with [name]?"                     (only when a verified name is known)
 *   2. "Hi, this is Remo, an AI calling assistant from ScoreLabs Inc. Is this a good time to speak for a minute?"
 *   3. after "yes": the first screening question (never the availability question again)
 *
 * Supported Primary Languages:
 *   - English (India) - en / en-IN
 *   - Telugu - te / te-IN
 *   - Hindi - hi / hi-IN
 *   - Tamil - ta / ta-IN
 *   - Kannada - kn / kn-IN
 *   - Malayalam - ml / ml-IN
 *   - Marathi - mr / mr-IN
 */

export const COMPANY_NAME = 'ScoreLabs Inc.';

function normalizeLang(lang) {
    if (!lang) return 'en';
    const l = String(lang).toLowerCase().trim().replace('_', '-');
    if (l.startsWith('te')) return 'te';
    if (l.startsWith('hi')) return 'hi';
    if (l.startsWith('ta')) return 'ta';
    if (l.startsWith('kn')) return 'kn';
    if (l.startsWith('ml')) return 'ml';
    if (l.startsWith('mr')) return 'mr';
    return 'en';
}

/** Step 1: asks for the candidate by name in their primary language. */
export function identityQuestion(name, lang = 'en') {
    const l = normalizeLang(lang);
    switch (l) {
        case 'te':
            return `నమస్కారం, నేను ${name} గారితో మాట్లాడుతున్నానా?`;
        case 'hi':
            return `नमस्ते, क्या मैं ${name} से बात कर रहा हूँ?`;
        case 'ta':
            return `வணக்கம், நான் ${name} அவர்களிடம் பேசுகிறேனா?`;
        case 'kn':
            return `ನಮಸ್ಕಾರ, ನಾನು ${name} ಅವರೊಂದಿಗೆ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆಯೇ?`;
        case 'ml':
            return `നമസ്കാരം, ഞാൻ ${name} ആണോ സംസാരിക്കുന്നത്?`;
        case 'mr':
            return `नमस्कार, मी ${name} यांच्याशी बोलत आहे का?`;
        default:
            return `Hello, am I speaking with ${name}?`;
    }
}

/** Step 2: who Remo is, and the availability question. Spoken once, after the identity is confirmed. */
export function recruitmentIntro(lang = 'en', role = '', company = '') {
    const l = normalizeLang(lang);
    const comp = company || 'Scorelabs';
    const roleClause = role && !role.includes('open position') ? ` regarding the ${role} position` : '';

    switch (l) {
        case 'te':
            return `నమస్తే, నేను ${comp} నుండి రెమో మాట్లాడుతున్నాను${role && !role.includes('open position') ? ` ${role} ఉద్యోగం గురించి` : ''}. మాట్లాడటానికి ఇది మంచి సమయమేనా?`;
        case 'hi':
            return `नमस्ते, मैं ${comp} से रेमो बोल रहा हूँ${role && !role.includes('open position') ? ` ${role} पद के संबंध में` : ''}। क्या अभी बात करने के लिए सही समय है?`;
        case 'ta':
            return `வணக்கம், நான் ${comp} இலிருந்து ரெமோ பேசுகிறேன்${role && !role.includes('open position') ? ` ${role} வேலை தொடர்பாக` : ''}. இப்போது பேச சரியான நேரமா?`;
        case 'kn':
            return `ನಮಸ್ಕಾರ, ನಾನು ${comp} ಇಂದ ರೆಮೋ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ${role && !role.includes('open position') ? ` ${role} ಹುದ್ದೆಯ ಬಗ್ಗೆ` : ''}. ಈಗ ಮಾತನಾಡಲು ಸರಿಯಾದ ಸಮಯವೇ?`;
        case 'ml':
            return `നമസ്കാരം, ഞാൻ ${comp} ൽ നിന്ന് റെമോ ആണ് സംസാരിക്കുന്നത്${role && !role.includes('open position') ? ` ${role} ജോലിയെക്കുറിച്ച്` : ''}. സംസാരിക്കാൻ ഇപ്പോൾ സൗകര്യപ്രദമായ സമയമാണോ?`;
        case 'mr':
            return `नमस्कार, मी ${comp} कडून रेमो बोलत आहे${role && !role.includes('open position') ? ` ${role} पदाबाबत` : ''}. आता बोलण्यासाठी ही योग्य वेळ आहे का?`;
        default:
            return `Hi, this is Remo calling from ${comp}${roleClause}. Is now a good time to speak for a minute?`;
    }
}

/** A caller who asks "who is this?" gets the identity without the whole greeting again. */
export function whoIsCalling(lang = 'en') {
    const l = normalizeLang(lang);
    switch (l) {
        case 'te':
            return `నేను రెమో, ${COMPANY_NAME} AI కాలింగ్ అసిస్టెంట్‌ని. ఇప్పుడు మాట్లాడటానికి మంచి సమయమేనా?`;
        case 'hi':
            return `मैं रेमो हूँ, ${COMPANY_NAME} का AI कॉलिंग असिस्टेंट। क्या अभी बात करने का सही समय है?`;
        case 'ta':
            return `நான் ரெமோ, ${COMPANY_NAME} AI அழைப்பு உதவியாளர். இப்போது பேச நல்ல நேரமா?`;
        case 'kn':
            return `ನಾನು ರೆಮೋ, ${COMPANY_NAME} AI ಕರೆ ಸಹಾಯಕ. ಈಗ ಮಾತನಾಡಲು ಇದು ಸರಿಯಾದ ಸಮಯವೇ?`;
        case 'ml':
            return `ഞാൻ റെമോ, ${COMPANY_NAME} AI കോളിംഗ് അസിസ്റ്റൻ്റ് ആണ്. ഇപ്പോൾ സംസാരിക്കാൻ നല്ല സമയമാണോ?`;
        case 'mr':
            return `मी रेमो आहे, ${COMPANY_NAME} चा AI कॉलिंग असिस्टंट. आता बोलण्यासाठी योग्य वेळ आहे का?`;
        default:
            return `This is Remo, an AI calling assistant from ${COMPANY_NAME} Is now a good time to talk?`;
    }
}

/** The first screening question when the campaign has no question plan. */
export function firstScreeningQuestion(lang = 'en') {
    const l = normalizeLang(lang);
    switch (l) {
        case 'te':
            return 'మీ ఇటీవలి డెవలప్‌మెంట్ అనుభవం గురించి క్లుప్తంగా చెప్పగలరా?';
        case 'hi':
            return 'क्या आप अपने हाल के डेवलपमेंट अनुभव के बारे में संक्षेप में बता सकते हैं?';
        case 'ta':
            return 'உங்கள் சமீபத்திய மேம்பாட்டு அனுபவத்தைப் பற்றி சுருக்கமாகக் கூற முடியுமா?';
        case 'kn':
            return 'ನಿಮ್ಮ ಇತ್ತೀಚಿನ ಡೆವಲಪ್‌ಮೆಂಟ್ ಅನುಭವದ ಬಗ್ಗೆ ಸಂಕ್ಷಿಪ್ತವಾಗಿ ತಿಳಿಸಬಹುದೇ?';
        case 'ml':
            return 'നിങ്ങളുടെ സമീപകാല ഡെവലപ്‌മെന്റ് അനുഭവത്തെക്കുറിച്ച് ചുരുക്കമായി പറയാമോ?';
        case 'mr':
            return 'तुम्ही तुमच्या अलीकडील डेव्हलपमेंट अनुभवाबद्दल थोडक्यात सांगू शकता का?';
        default:
            return 'Could you briefly tell me about your recent development experience?';
    }
}

export default { COMPANY_NAME, identityQuestion, recruitmentIntro, whoIsCalling, firstScreeningQuestion };
