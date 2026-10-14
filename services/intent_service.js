/**
 * services/intent_service.js
 * 
 * Lightweight, deterministic intent-handling layer for real-time telephone dialogue.
 * Evaluates short caller utterances ("yes", "no", "okay", "repeat that", "can you hear me",
 * "speak in Hindi", etc.) in context of the active service, current question, and interview stage.
 * 
 * Key Benefits:
 * - Ultra-low latency: generates response in < 1ms without calling LLM.
 * - Saves conversational turns: combines acknowledgment + next question in a single turn.
 * - Context-aware: "no" to availability reschedules, never rejects candidate.
 * - Multilingual: supports English, Hindi, and Telugu.
 * - Safe fallback: ambiguous or detailed answers return matched: false to route to Gemini.
 */

const AFFIRMATIVE_TERMS = new Set([
    'yes', 'yeah', 'yep', 'yup', 'sure', 'correct', 'right', 'ok', 'okay', 'fine',
    'definitely', 'absolutely', 'alright', 'all right', 'agree', 'haan', 'ha', 'haa',
    'achha', 'acha', 'theek hai', 'theek', 'sahi', 'sahi hai', 'avunu', 'sare', 'alage', 'alaage', 'correcte'
]);

const NEGATIVE_TERMS = new Set([
    'no', 'nope', 'nah', 'not really', 'not right now', 'never', 'negative',
    'nahi', 'na', 'nahin', 'nahi hai', 'ledu', 'kadu', 'vaddu', 'lekapothe',
    'no not right now', 'not now', 'no not now'
]);

const REPEAT_TERMS = new Set([
    'repeat', 'repeat that', 'pardon', 'come again', 'say that again',
    'what did you say', 'could you repeat', 'can you repeat', 'phir se bolo',
    'phir se kahiye', 'ek aur baar', 'malli cheppandi', 'inkosari cheppandi'
]);

const AUDIBILITY_TERMS = new Set([
    'can you hear me', 'am i audible', 'hello', 'are you there', 'hello hello',
    'awaz aa rahi hai', 'sun rahe ho', 'vinipistunda', 'vinapadutunda', 'can u hear me'
]);

const DONT_KNOW_TERMS = new Set([
    'i dont know', "i don't know", 'not sure', 'no idea', 'pata nahi',
    'maloom nahi', 'teliyadu', 'idea ledu'
]);

const DECLINE_INTEREST_TERMS = [
    'not interested', 'stop calling', "don't call me", 'remove my number',
    'wrong number', 'wrong person', 'dont call', 'phone rakho', 'cut the call', 'call cut karo'
];

export default class IntentService {
    /**
     * Determines if a caller's utterance can be handled by fast-path deterministic logic.
     * @param {string} text - Caller speech transcript
     * @param {object} context - Current conversation context
     * @returns {{ matched: boolean, spoken_response?: string, detected_language?: string, extracted_fields?: object, classification?: string, should_end_call?: boolean, next_stage?: string, reason?: string }}
     */
    static matchIntent(text, context = {}) {
        if (!text || typeof text !== 'string') {
            return { matched: false };
        }

        const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const words = clean.split(/\s+/).filter(Boolean);
        if (words.length === 0) return { matched: false };

        const service = (context.service || 'recruitment').toLowerCase();
        const lastQuestion = String(context.lastQuestion || '').trim();
        const currentLang = (context.language || 'en').toLowerCase();
        const stage = context.stage || this.inferStageFromQuestion(lastQuestion);
        const contact = context.contact || {};
        const role = contact.job_role || contact.role || 'the open position';
        const company = contact.company || 'Score Labs';

        // 1. Explicit Disconnect / Decline Interest
        for (const term of DECLINE_INTEREST_TERMS) {
            if (clean.includes(term)) {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        "Understood, thank you for letting me know. I have updated our records. Have a wonderful day!",
                        "समझ गया, जानकारी देने के लिए धन्यवाद। आपका दिन शुभ हो!",
                        "అర్థమైంది, వివరాలు తెలిపినందుకు ధన్యవాదాలు. మీ దినం శుభప్రదం కాగాక!",
                        currentLang
                    ),
                    detected_language: currentLang,
                    should_end_call: true,
                    classification: service === 'recruitment' ? 'Rejected' : (service === 'sales' ? 'NOT_INTERESTED' : 'RESOLVED'),
                    extracted_fields: { candidate_interest: 'Declined' },
                    reason: 'explicit_decline'
                };
            }
        }

        // 2. Language Switch Requests
        if (words.length <= 6) {
            if (clean.includes('hindi') || clean.includes('hindi me') || clean.includes('hindi mein')) {
                return {
                    matched: true,
                    spoken_response: service === 'recruitment'
                        ? `ज़रूर, मैं हिंदी में बातचीत जारी रखते हैं। मैं स्कोर लैब्स से ${role} पद के लिए कॉल कर रहा हूँ। क्या आपके पास बात करने के लिए दो मिनट का समय है?`
                        : (service === 'sales'
                            ? `ज़रूर, हम हिंदी में बातचीत जारी रखते हैं। क्या आपकी टीम अभी वॉयस ऑटोमेशन का उपयोग कर रही है?`
                            : `ज़रूर, हम हिंदी में सहायता करेंगे। कृपया अपनी समस्या संक्षेप में बताएं।`),
                    detected_language: 'hi',
                    should_end_call: false,
                    next_stage: 'AVAILABILITY_CONFIRMED',
                    reason: 'language_switch_hindi'
                };
            }

            if (clean.includes('telugu') || clean.includes('telugulo') || clean.includes('telugu lo')) {
                return {
                    matched: true,
                    spoken_response: service === 'recruitment'
                        ? `ఖచ్చితంగా, మనం తెలుగులోనే మాట్లాడగలను. నేను స్కోర్ ల్యాబ్స్ నుండి ${role} రోల్ గురించి మాట్లాడుతున్నాను. మాట్లాడటానికి రెండు నిమిషాలు సమయం ఉందా?`
                        : (service === 'sales'
                            ? `ఖచ్చితంగా, మనం తెలుగులోనే మాట్లాడగలను. మీ టీమ్ ప్రస్తుతం వాయిస్ ఆటోమేషన్ వాడుతోందా?`
                            : `ఖచ్చితంగా, మనం తెలుగులోనే మాట్లాడగలను. మీ సమస్య ఏమిటో కాస్త వివరించగలరా?`),
                    detected_language: 'te',
                    should_end_call: false,
                    next_stage: 'AVAILABILITY_CONFIRMED',
                    reason: 'language_switch_telugu'
                };
            }

            if (clean.includes('english')) {
                return {
                    matched: true,
                    spoken_response: "Certainly! I'm speaking in English now. Let's continue with our conversation.",
                    detected_language: 'en',
                    should_end_call: false,
                    reason: 'language_switch_english'
                };
            }
        }

        // 3. Audibility / Line Check ("Can you hear me?", "Hello?")
        if (words.length <= 6 && (clean.includes('hear me') || clean.includes('audible') || clean.includes('awaz') || clean.includes('vinipistunda') || clean === 'hello' || clean === 'hello hello')) {
            const resumeQuestion = lastQuestion || (service === 'recruitment' ? "Are you available for a brief chat?" : "How can I help you today?");
            return {
                matched: true,
                spoken_response: this.localize(
                    `Yes, I can hear you clearly! Let's continue—${resumeQuestion}`,
                    `हाँ, मुझे आपकी आवाज़ बिल्कुल साफ़ सुनाई दे रही है! चलिए जारी रखते हैं—${resumeQuestion}`,
                    `అవును, మీ మాట నాకు స్పష్టంగా వినిపిస్తోంది! కొనసాగిద్దాం—${resumeQuestion}`,
                    currentLang
                ),
                detected_language: currentLang,
                should_end_call: false,
                reason: 'audibility_check'
            };
        }

        // 4. Repeat That / Pardon
        if (words.length <= 6 && (clean.includes('repeat') || clean.includes('pardon') || clean.includes('say that again') || clean.includes('phir se') || clean.includes('malli cheppandi'))) {
            const repeatContent = lastQuestion || "Are you available for a brief conversation?";
            return {
                matched: true,
                spoken_response: this.localize(
                    `Sure, no problem! I was asking: ${repeatContent}`,
                    `ज़रूर, कोई बात नहीं! मैं पूछ रहा था: ${repeatContent}`,
                    `ఖచ్చితంగా, ఏమీ పర్వాలేదు! నేను అడుగుతున్నాను: ${repeatContent}`,
                    currentLang
                ),
                detected_language: currentLang,
                should_end_call: false,
                reason: 'repeat_request'
            };
        }

        // 5. "I don't know" / "Not sure"
        if (words.length <= 5 && (DONT_KNOW_TERMS.has(clean) || clean.includes('dont know') || clean.includes('not sure'))) {
            if (service === 'recruitment') {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        "No worries at all! Could you tell me about the key technologies or projects you've enjoyed working on most recently?",
                        "कोई बात नहीं! क्या आप हाल ही में किए गए अपने पसंदीदा प्रोजेक्ट या तकनीकों के बारे में बता सकते हैं?",
                        "ఏమీ పర్వాలేదు! ఇటీవల మీరు చేసిన ముఖ్యమైన ప్రాజెక్ట్‌లు లేదా టెక్నాలజీల గురించి చెప్పగలరా?",
                        currentLang
                    ),
                    detected_language: currentLang,
                    should_end_call: false,
                    next_stage: 'PROJECTS',
                    reason: 'dont_know_followup'
                };
            }
        }

        // Only process short responses (<= 5 words) for deterministic YES / NO / OKAY matching
        if (words.length > 5) {
            return { matched: false };
        }

        const isYes = AFFIRMATIVE_TERMS.has(clean) || clean.startsWith('yes ') || words.every(w => AFFIRMATIVE_TERMS.has(w));
        const isNo = NEGATIVE_TERMS.has(clean) || clean.startsWith('no ') || clean.includes('not right now') || clean.includes('not now') || words.every(w => NEGATIVE_TERMS.has(w));

        // 6. Handle Context-Aware YES
        if (isYes) {
            return this.handleYes(service, stage, currentLang, role, company);
        }

        // 7. Handle Context-Aware NO
        if (isNo) {
            return this.handleNo(service, stage, currentLang, role);
        }

        return { matched: false };
    }

    /**
     * Context-aware handling for affirmative answers ("yes", "sure", "okay", "correct")
     */
    static handleYes(service, stage, lang, role, company) {
        if (service === 'recruitment') {
            switch (stage) {
                case 'AVAILABILITY':
                case 'GREETING':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            `Great, thank you! I'm calling about the ${role} position. Could you briefly share your total years of hands-on experience in this field?`,
                            `बहुत बढ़िया, धन्यवाद! मैं ${role} पद के संबंध में बात कर रहा हूँ। क्या आप इस क्षेत्र में अपने कुल वर्षों के अनुभव के बारे में बता सकते हैं?`,
                            `చాలా సంతోషం, ధన్యవాదాలు! నేను ${role} రోల్ గురించి మాట్లాడుతున్నాను. ఈ ఫీల్డ్‌లో మీ మొత్తం అనుభవం ఎన్ని సంవత్సరాలు?`,
                            lang
                        ),
                        detected_language: lang,
                        extracted_fields: { available_to_talk: 'Yes', candidate_interest: 'Interested' },
                        classification: 'On Hold',
                        next_stage: 'EXPERIENCE',
                        should_end_call: false,
                        reason: 'recruitment_availability_yes'
                    };

                case 'EXPERIENCE':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Got it! What are your primary technical skills or frameworks that you specialize in?",
                            "समझ गया! आपके मुख्य तकनीकी कौशल या फ्रेमवर्क कौन से हैं जिनमें आपकी विशेषज्ञता है?",
                            "అర్థమైంది! మీ ప్రాథమిక సాంకేతిక నైపుణ్యాలు లేదా ఫ్రేమ్‌వర్క్‌లు ఏమిటి?",
                            lang
                        ),
                        detected_language: lang,
                        next_stage: 'SKILLS',
                        should_end_call: false,
                        reason: 'recruitment_experience_yes'
                    };

                case 'RELOCATION':
                case 'LOCATION':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Noted! And what is your official notice period or earliest available joining date?",
                            "नोट कर लिया! और आपका ऑफिशियल नोटिस पीरियड या जल्द से जल्द जॉइनिंग की तारीख क्या होगी?",
                            "నోట్ చేసుకున్నాను! మీ అధికారిక నోటీస్ పీరియడ్ లేదా చేరగల తేదీ ఏమిటి?",
                            lang
                        ),
                        detected_language: lang,
                        extracted_fields: { willing_to_relocate: 'Yes', location_preference: 'Comfortable' },
                        next_stage: 'NOTICE_PERIOD',
                        should_end_call: false,
                        reason: 'recruitment_relocation_yes'
                    };

                default:
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Great, thank you. Could you also tell me about your current notice period and earliest availability?",
                            "बहुत बढ़िया, धन्यवाद। क्या आप अपने नोटिस पीरियड और जॉइनिंग उपलब्धता के बारे में भी बता सकते हैं?",
                            "చాలా మంచిది, ధన్యవాదాలు. మీ ప్రస్తుత నోటీస్ పీరియడ్ మరియు లభ్యత గురించి కూడా చెప్పగలరా?",
                            lang
                        ),
                        detected_language: lang,
                        next_stage: 'NOTICE_PERIOD',
                        should_end_call: false,
                        reason: 'recruitment_generic_yes'
                    };
            }
        }

        if (service === 'sales') {
            return {
                matched: true,
                spoken_response: this.localize(
                    "Excellent! How many calls does your team currently handle each week, and what is your primary automation goal?",
                    "बहुत अच्छा! आपकी टीम प्रति सप्ताह लगभग कितने कॉल्स संभालती है, और आपका मुख्य ऑटोमेशन लक्ष्य क्या है?",
                    "చాలా మంచిది! మీ బృందం వారానికి దాదాపు ఎన్ని కాల్స్‌ని నిర్వహిస్తుంది, మరియు మీ ప్రధాన ఆటోమేషన్ లక్ష్యం ఏమిటి?",
                    lang
                ),
                detected_language: lang,
                extracted_fields: { sales_interest: 'High' },
                classification: 'INTERESTED',
                should_end_call: false,
                reason: 'sales_yes'
            };
        }

        if (service === 'support') {
            return {
                matched: true,
                spoken_response: this.localize(
                    "Thank you for confirming. Could you please describe the specific error or issue you are experiencing?",
                    "पुष्टि करने के लिए धन्यवाद। कृपया उस विशिष्ट त्रुटि या समस्या का वर्णन करें जिसका आप सामना कर रहे हैं?",
                    "ధృవీకరించినందుకు ధన్యవాదాలు. మీరు ఎదుర్కొంటున్న సమస్య లేదా ఎర్రర్ గురించి కాస్త వివరిస్తారా?",
                    lang
                ),
                detected_language: lang,
                classification: 'PENDING_INFO',
                should_end_call: false,
                reason: 'support_yes'
            };
        }

        return { matched: false };
    }

    /**
     * Context-aware handling for negative answers ("no", "nope", "not right now")
     */
    static handleNo(service, stage, lang, role) {
        if (service === 'recruitment') {
            switch (stage) {
                case 'AVAILABILITY':
                case 'GREETING':
                    // CRITICAL: DO NOT REJECT! Candidate is merely busy right now; politely offer to reschedule
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "No problem at all! When would be a better time for our recruiting team to connect briefly?",
                            "कोई बात नहीं! हमारी भर्ती टीम आपको वापस कॉल करने के लिए किस समय संपर्क कर सकती है?",
                            "ఏమీ పర్వాలేదు! మా రిక్రూట్‌మెంట్ టీమ్ మీకు తిరిగి కాల్ చేయడానికి అనువైన సమయం ఎప్పుడు?",
                            lang
                        ),
                        detected_language: lang,
                        extracted_fields: { available_to_talk: 'Busy right now', candidate_interest: 'Reschedule Requested' },
                        classification: 'On Hold',
                        next_stage: 'CALLBACK_TIME',
                        should_end_call: false,
                        reason: 'recruitment_availability_no'
                    };

                case 'LOCATION':
                case 'RELOCATION':
                    // Candidate cannot relocate; continue without rejecting
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Understood, no problem at all. What is your current city and your official notice period?",
                            "समझ गया, कोई समस्या नहीं। आपका वर्तमान शहर और आधिकारिक नोटिस पीरियड क्या है?",
                            "అర్థమైంది, ఏమీ సమస్య లేదు. మీ ప్రస్తుత నగరం మరియు అధికారిక నోటీస్ పీరియడ్ ఏమిటి?",
                            lang
                        ),
                        detected_language: lang,
                        extracted_fields: { willing_to_relocate: 'No' },
                        classification: 'On Hold',
                        next_stage: 'NOTICE_PERIOD',
                        should_end_call: false,
                        reason: 'recruitment_relocation_no'
                    };

                default:
                    // Generic negative: acknowledge without rejecting, pivot to strengths
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Got it, thanks for letting me know. What core technologies or tools do you work with most comfortably?",
                            "समझ गया, बताने के लिए धन्यवाद। आप किन मुख्य तकनीकों या टूल्स के साथ सबसे सहजता से काम करते हैं?",
                            "సరే, తెలిపినందుకు ధన్యవాదాలు. మీరు ఏ సాంకేతిక పరిజ్ఞానం లేదా టూల్స్‌తో ఎక్కువగా పనిచేస్తుంటారు?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'On Hold',
                        next_stage: 'SKILLS',
                        should_end_call: false,
                        reason: 'recruitment_generic_no'
                    };
            }
        }

        if (service === 'sales') {
            return {
                matched: true,
                spoken_response: this.localize(
                    "No problem at all. If you'd like, I can have our team email you our overview deck for future reference. Would that be helpful?",
                    "कोई बात नहीं। यदि आप चाहें, तो हमारी टीम आपको भविष्य के संदर्भ के लिए विवरण ईमेल कर सकती है। क्या यह सही रहेगा?",
                    "ఏమీ సమస్య లేదు. మీకు కావాలంటే, భవిష్యత్ సూచన కోసం మా బృందం మీకు వివరాలను ఇమెయిల్ చేయవచ్చు. అది ఉపయోగకరంగా ఉంటుందా?",
                    lang
                ),
                detected_language: lang,
                classification: 'FOLLOW_UP',
                should_end_call: false,
                reason: 'sales_no'
            };
        }

        return { matched: false };
    }

    static inferStageFromQuestion(question) {
        if (!question) return 'AVAILABILITY';
        const q = question.toLowerCase();
        if (q.includes('minute') || q.includes('time to speak') || q.includes('talk') || q.includes('available')) return 'AVAILABILITY';
        if (q.includes('year') || q.includes('experience') || q.includes('background')) return 'EXPERIENCE';
        if (q.includes('skill') || q.includes('framework') || q.includes('technolog') || q.includes('language')) return 'SKILLS';
        if (q.includes('relocat') || q.includes('location') || q.includes('hybrid') || q.includes('city')) return 'LOCATION';
        if (q.includes('notice') || q.includes('joining') || q.includes('join')) return 'NOTICE_PERIOD';
        if (q.includes('salary') || q.includes('ctc') || q.includes('compensation')) return 'SALARY';
        return 'GENERAL';
    }

    static localize(en, hi, te, lang = 'en') {
        const l = (lang || 'en').toLowerCase();
        if (l === 'hi') return hi;
        if (l === 'te') return te;
        return en;
    }
}
