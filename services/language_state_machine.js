/**
 * services/language_state_machine.js
 *
 * Intelligent multilingual state machine for Remo AI voice calling agent.
 * Supports English, Hindi, and Telugu naturally.
 *
 * Non-negotiable rules:
 * 1. Never switch language because of one short word or conversational filler
 *    (e.g., "haan", "achha", "ji", "nahi", "ha", "avunu", "sare", "ledu", "yes", "okay", "hmm", "uh-huh").
 * 2. Short acknowledgments carry real meaning in context without triggering a language change.
 * 3. English conversations with Hindi or Telugu technical words / proper nouns remain English.
 * 4. Genuine language switch occurs only when the caller speaks complete sentences in another language
 *    with consistent evidence or explicitly requests a language switch ("speak in Telugu", "Hindi mein baat kijiye").
 * 5. State machine tracks confidence, consecutive evidence, and preserves captured answers and conversation history.
 */

const ACKNOWLEDGMENT_AND_FILLERS = new Set([
    // English
    'yes', 'yeah', 'yep', 'yup', 'uh', 'um', 'hmm', 'huh', 'okay', 'ok', 'right', 'ah', 'uh-huh', 'uhhuh', 'mhm', 'sure', 'fine', 'alright',
    // Hindi
    'haan', 'ha', 'haa', 'achha', 'acha', 'accha', 'ji', 'nahi', 'nahin', 'theek', 'theek hai', 'sahi', 'sahi hai', 'hmm', 'bolo', 'boliye',
    // Telugu
    'ha', 'avunu', 'sare', 'ledu', 'kadu', 'alaage', 'alage', 'parvaledu', 'paravaledu', 'hmm', 'cheppandi', 'matladandi'
]);

const HINDI_INDICATOR_WORDS = new Set([
    'kya', 'kyun', 'kaise', 'kahan', 'kab', 'mera', 'meri', 'mere', 'aap', 'aapka', 'aapki', 'aapke',
    'hum', 'hamara', 'hamari', 'mujhe', 'humein', 'chahiye', 'karna', 'karta', 'karti', 'karte',
    'hoga', 'hogi', 'honge', 'tha', 'thi', 'the', 'baat', 'kijiye', 'bataiye', 'samajh', 'aaya',
    'naukri', 'kaam', 'anubhav', 'vetan', 'kripya', 'dhanyawad', 'shukriya', 'namaste', 'namaskar',
    'yeh', 'woh', 'aur', 'teen', 'chaar', 'paanch', 'saal', 'ka', 'ke', 'ki', 'ko', 'se', 'hai', 'hain',
    'mein', 'me', 'par', 'bhi', 'kuch', 'accha', 'achha', 'bahut', 'zaroorat', 'pasand'
]);

const TELUGU_INDICATOR_WORDS = new Set([
    'enti', 'enduku', 'ela', 'ekkada', 'eppudu', 'naa', 'naaku', 'meeru', 'meeku', 'mee', 'manamu',
    'kavali', 'cheyali', 'chestunnanu', 'chestamu', 'untundi', 'undi', 'ledu', 'unde', 'undi',
    'matladandi', 'cheppandi', 'artham', 'aindi', 'udyogam', 'pani', 'anubhavam', 'jeetham',
    'dayachesi', 'dhanyavadalu', 'namaskaram', 'namaskaralu', 'chudandi', 'moodu', 'nalugu', 'aidu',
    'samvatsarala', 'samvatsaram', 'mariyu', 'lo', 'tho', 'meeda', 'gurinchi', 'chala'
]);

const COMMON_ENGLISH_WORDS = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with',
    'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if',
    'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him',
    'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than',
    'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how',
    'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
    'experience', 'years', 'developer', 'react', 'node', 'python', 'java', 'services', 'cloud', 'looking', 'project', 'company'
]);

export default class LanguageStateMachine {
    constructor(initialLanguage = 'en') {
        this.currentLanguage = initialLanguage;
        this.preferredLanguage = initialLanguage;
        this.candidateLanguage = null;
        this.candidateLanguageConfidence = 0.0;
        this.consecutiveLanguageEvidence = 0;
        this.lastConfirmedLanguageSwitchAt = Date.now();
        this.languageSwitchPending = false;
        this.CONFIDENCE_THRESHOLD = 0.80;
        this.MIN_CONSECUTIVE_EVIDENCE = 2; // complete utterances needed to confirm switch without explicit request
    }

    /**
     * Evaluates caller utterance and determines whether a language switch should be applied,
     * deferred, or rejected.
     *
     * @param {string} transcript - Punctuated transcript from caller turn
     * @param {string} sttLanguage - Language code reported by STT provider (e.g. en, eng, hi, hin, te, tel)
     * @returns {{ shouldSwitch: boolean, targetLanguage: string, reason: string, isExplicitRequest: boolean }}
     */
    evaluateTurn(transcript = '', sttLanguage = null) {
        if (!transcript || typeof transcript !== 'string') {
            return { shouldSwitch: false, targetLanguage: this.currentLanguage, reason: 'empty_transcript', isExplicitRequest: false };
        }

        const clean = transcript.toLowerCase().replace(/[^a-z0-9\u0900-\u097F\u0C00-\u0C7F\s]/g, ' ').trim();
        const words = clean.split(/\s+/).filter(Boolean);

        if (words.length === 0) {
            return { shouldSwitch: false, targetLanguage: this.currentLanguage, reason: 'no_words', isExplicitRequest: false };
        }

        // -------------------------------------------------------------
        // RULE 1: EXPLICIT LANGUAGE CHANGE REQUESTS
        // -------------------------------------------------------------
        const explicitRequest = this._checkExplicitRequest(clean);
        if (explicitRequest) {
            this.currentLanguage = explicitRequest.target;
            this.preferredLanguage = explicitRequest.target;
            this.candidateLanguage = null;
            this.candidateLanguageConfidence = 1.0;
            this.consecutiveLanguageEvidence = 0;
            this.lastConfirmedLanguageSwitchAt = Date.now();
            return {
                shouldSwitch: true,
                targetLanguage: explicitRequest.target,
                reason: explicitRequest.reason,
                isExplicitRequest: true
            };
        }

        // -------------------------------------------------------------
        // RULE 2: NEVER SWITCH ON SHORT ACKNOWLEDGMENTS OR FILLERS
        // e.g. "haan", "achha", "sare", "avunu", "okay", "yes", "no", "nahi", "ledu"
        // -------------------------------------------------------------
        if (words.length <= 2 && words.every(w => ACKNOWLEDGMENT_AND_FILLERS.has(w))) {
            return {
                shouldSwitch: false,
                targetLanguage: this.currentLanguage,
                reason: 'short_acknowledgment_preserved',
                isExplicitRequest: false
            };
        }

        // -------------------------------------------------------------
        // RULE 3: DETECT DOMINANT SCRIPT AND LANGUAGE INDICATORS
        // -------------------------------------------------------------
        const hasTeluguScript = /[\u0C00-\u0C7F]/.test(transcript);
        const hasHindiScript = /[\u0900-\u097F]/.test(transcript);

        let hindiWordCount = 0;
        let teluguWordCount = 0;
        let englishWordCount = 0;

        for (const w of words) {
            if (HINDI_INDICATOR_WORDS.has(w)) hindiWordCount++;
            else if (TELUGU_INDICATOR_WORDS.has(w)) teluguWordCount++;
            else if (COMMON_ENGLISH_WORDS.has(w)) englishWordCount++;
        }

        let detectedDominant = null;
        let confidence = 0.0;

        // Native script presence carries high weight
        if (hasTeluguScript || teluguWordCount >= 2) {
            detectedDominant = 'te';
            confidence = hasTeluguScript ? 0.95 : Math.min(0.85, 0.5 + (teluguWordCount * 0.15));
        } else if (hasHindiScript || hindiWordCount >= 2) {
            detectedDominant = 'hi';
            confidence = hasHindiScript ? 0.95 : Math.min(0.85, 0.5 + (hindiWordCount * 0.15));
        } else {
            // STT metadata hint only if substantial utterance (>= 4 words)
            const normStt = this._normalizeCode(sttLanguage);
            if (normStt && normStt !== 'en' && words.length >= 4) {
                if (normStt === 'te' && teluguWordCount >= 1) {
                    detectedDominant = 'te';
                    confidence = 0.82;
                } else if (normStt === 'hi' && hindiWordCount >= 1) {
                    detectedDominant = 'hi';
                    confidence = 0.82;
                }
            }
        }

        // -------------------------------------------------------------
        // RULE 4: CODE-SWITCHING & ISOLATED TERM PROTECTION
        // An English sentence with an isolated Hindi/Telugu noun or technical term remains English
        // -------------------------------------------------------------
        if (this.currentLanguage === 'en' && detectedDominant && detectedDominant !== 'en') {
            // If English words dominate, do not switch
            if (englishWordCount > (hindiWordCount + teluguWordCount)) {
                return {
                    shouldSwitch: false,
                    targetLanguage: this.currentLanguage,
                    reason: 'code_switching_dominant_english',
                    isExplicitRequest: false
                };
            }
        }

        // If caller continues speaking the current language
        if (!detectedDominant || detectedDominant === this.currentLanguage) {
            this.candidateLanguage = null;
            this.candidateLanguageConfidence = 0.0;
            this.consecutiveLanguageEvidence = 0;
            return {
                shouldSwitch: false,
                targetLanguage: this.currentLanguage,
                reason: 'current_language_retained',
                isExplicitRequest: false
            };
        }

        // -------------------------------------------------------------
        // RULE 5: STATE MACHINE THRESHOLDS & MULTI-TURN CONFIRMATION
        // Complete sentences with high confidence (>= 0.85) or 2 consecutive turns
        // -------------------------------------------------------------
        if (detectedDominant === this.candidateLanguage) {
            this.consecutiveLanguageEvidence++;
            this.candidateLanguageConfidence = Math.max(this.candidateLanguageConfidence, confidence);
        } else {
            this.candidateLanguage = detectedDominant;
            this.candidateLanguageConfidence = confidence;
            this.consecutiveLanguageEvidence = 1;
        }

        const isCompleteSentence = words.length >= 3 && confidence >= this.CONFIDENCE_THRESHOLD;
        const hasSufficientEvidence = isCompleteSentence || this.consecutiveLanguageEvidence >= this.MIN_CONSECUTIVE_EVIDENCE;

        if (hasSufficientEvidence) {
            const previousLang = this.currentLanguage;
            this.currentLanguage = detectedDominant;
            this.preferredLanguage = detectedDominant;
            this.candidateLanguage = null;
            this.consecutiveLanguageEvidence = 0;
            this.lastConfirmedLanguageSwitchAt = Date.now();

            return {
                shouldSwitch: true,
                targetLanguage: detectedDominant,
                reason: `genuine_multilingual_switch_from_${previousLang}`,
                isExplicitRequest: false
            };
        }

        return {
            shouldSwitch: false,
            targetLanguage: this.currentLanguage,
            reason: 'insufficient_evidence_pending_confirmation',
            isExplicitRequest: false
        };
    }

    _checkExplicitRequest(clean = '') {
        // Telugu explicit requests
        if (clean.includes('speak in telugu') || clean.includes('telugu lo matladandi') || clean.includes('telugulo matladandi') ||
            clean.includes('telugu lo cheppandi') || clean.includes('telugu please') || clean.includes('telugulo') ||
            clean.includes('can you speak in telugu') || clean.includes('talk in telugu')) {
            return { target: 'te', reason: 'explicit_request_telugu' };
        }

        // Hindi explicit requests
        if (clean.includes('speak in hindi') || clean.includes('hindi mein baat kijiye') || clean.includes('hindi me baat karo') ||
            clean.includes('hindi mein bolo') || clean.includes('hindi me boliye') || clean.includes('hindi please') ||
            clean.includes('can you speak in hindi') || clean.includes('talk in hindi') || clean.includes('hindi me')) {
            return { target: 'hi', reason: 'explicit_request_hindi' };
        }

        // English explicit requests
        if (clean.includes('speak in english') || clean.includes('english please') || clean.includes('talk in english') ||
            clean.includes('can you speak english') || clean.includes('english mein baat kijiye') || clean.includes('continue in english')) {
            return { target: 'en', reason: 'explicit_request_english' };
        }

        return null;
    }

    _normalizeCode(code = '') {
        const c = String(code || '').toLowerCase().trim();
        if (c === 'te' || c === 'tel') return 'te';
        if (c === 'hi' || c === 'hin') return 'hi';
        if (c === 'en' || c === 'eng') return 'en';
        return null;
    }
}
