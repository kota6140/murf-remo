/**
 * services/intent_service.js
 * 
 * Lightweight, deterministic intent-handling layer for real-time telephone dialogue.
 * Evaluates short caller utterances ("yes", "no", "okay", "repeat that", "can you hear me",
 * "speak in Hindi", objection scripts, etc.) in context of the active service:
 * - Recruitment (candidate screening for job roles)
 * - Sales / Business Development (Scorelabs Inc. IT solutions & 15-minute meeting booking)
 * - Customer Support (issue diagnosis & technical assistance)
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
        const company = contact.company || 'your team';

        // -------------------------------------------------------------
        // 1. DO NOT CALL / HARD SUPPRESSION REQUESTS (ALL SERVICES)
        // -------------------------------------------------------------
        if (clean.includes('do not call') || clean.includes('dont call') || clean.includes('remove my number') || clean.includes('stop calling') || clean.includes('delete my number')) {
            return {
                matched: true,
                spoken_response: this.localize(
                    "Understood, I have recorded your request not to be contacted again. Have a great day.",
                    "समझ गया, मैंने दोबारा संपर्क न करने का आपका अनुरोध दर्ज कर लिया है। आपका दिन शुभ हो।",
                    "అర్థమైంది, మళ్లీ సంప్రదించవద్దని మీ అభ్యర్థనను నమోదు చేసాను. మీ దినం శుభప్రదం కాగాక.",
                    currentLang
                ),
                detected_language: currentLang,
                should_end_call: true,
                classification: service === 'sales' ? 'Do Not Call' : 'Rejected',
                extracted_fields: { preferred_next_step: 'none', call_outcome: 'Do Not Call' },
                reason: 'do_not_call'
            };
        }

        // -------------------------------------------------------------
        // 2. WRONG NUMBER / WRONG PERSON (ALL SERVICES)
        // -------------------------------------------------------------
        if (clean.includes('wrong number') || clean.includes('wrong person')) {
            return {
                matched: true,
                spoken_response: this.localize(
                    "I apologize for the mix-up. Thank you for letting me know, and have a good day.",
                    "असुविधा के लिए माफ़ी चाहता हूँ। मुझे बताने के लिए धन्यवाद, आपका दिन शुभ हो।",
                    "పొరపాటుకు క్షమించండి. తెలిపినందుకు ధన్యవాదాలు, మంచి రోజవుగాక.",
                    currentLang
                ),
                detected_language: currentLang,
                should_end_call: true,
                classification: service === 'sales' ? 'Wrong Contact' : 'Rejected',
                extracted_fields: { preferred_next_step: 'none', call_outcome: 'Wrong Contact' },
                reason: 'wrong_contact'
            };
        }

        // -------------------------------------------------------------
        // 3. EXPLICIT DECLINE / NOT INTERESTED
        // -------------------------------------------------------------
        if (clean.includes('not interested') || clean.includes('no interest') || clean.includes('not looking') || clean.includes('phone rakho') || clean.includes('cut the call')) {
            return {
                matched: true,
                spoken_response: this.localize(
                    "I understand. Thank you for your time. Have a great day.",
                    "मैं समझता हूँ। आपके समय के लिए धन्यवाद। आपका दिन शुभ हो।",
                    "నేను అర్థం చేసుకోగలను. మీ సమయానికి ధన్యవాదాలు. మంచి రోజవుగాక.",
                    currentLang
                ),
                detected_language: currentLang,
                should_end_call: true,
                classification: service === 'sales' ? 'Not Interested' : (service === 'recruitment' ? 'Rejected' : 'RESOLVED'),
                extracted_fields: { preferred_next_step: 'none', call_outcome: 'Not Interested', candidate_interest: 'Declined' },
                reason: 'not_interested'
            };
        }

        // -------------------------------------------------------------
        // 4. SALES SPECIFIC OBJECTIONS & PROMPTS (Scorelabs Inc.)
        // -------------------------------------------------------------
        if (service === 'sales') {
            // A. "We already have an IT vendor"
            if (clean.includes('vendor') || clean.includes('already have') || clean.includes('existing partner')) {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        "Understood. We would be glad to be considered for future projects or additional support if a need comes up. Would it be okay to share our company profile for your reference?",
                        "समझ गया। यदि भविष्य में कोई आवश्यकता हो तो हम अतिरिक्त सहायता के लिए विचार किए जाने पर प्रसन्न होंगे। क्या आपके संदर्भ के लिए हमारी कंपनी प्रोफ़ाइल साझा करना ठीक रहेगा?",
                        "అర్థమైంది. భవిష్యత్తులో ఏదైనా అవసరం వచ్చినప్పుడు మేము పరిశీలించబడటానికి సంతోషిస్తాము. మీ సూచన కోసం మా కంపెనీ ప్రొఫైల్‌ను షేర్ చేయడం సరిపోతుందా?",
                        currentLang
                    ),
                    detected_language: currentLang,
                    next_stage: 'EMAIL_PERMISSION',
                    classification: 'Interested',
                    should_end_call: false,
                    reason: 'sales_objection_vendor'
                };
            }

            // B. "We don't have any requirements right now"
            if (clean.includes('no requirement') || clean.includes('no requirements') || clean.includes('dont have any requirement') || clean.includes('no project')) {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        "No problem. Would you be comfortable receiving our company information so you have our details if a requirement comes up later?",
                        "कोई समस्या नहीं। क्या आप हमारी कंपनी की जानकारी प्राप्त करना चाहेंगे ताकि बाद में आवश्यकता होने पर आपके पास हमारा विवरण हो?",
                        "ఏమీ సమస్య లేదు. తర్వాత ఎప్పుడైనా అవసరం వచ్చినప్పుడు మీ వద్ద మా వివరాలు ఉండేలా మా కంపెనీ సమాచారాన్ని అందుకోవడానికి మీకు సౌకర్యంగా ఉంటుందా?",
                        currentLang
                    ),
                    detected_language: currentLang,
                    next_stage: 'EMAIL_PERMISSION',
                    classification: 'Interested',
                    should_end_call: false,
                    reason: 'sales_objection_no_req'
                };
            }

            // C. "Send me an email"
            if ((clean.includes('send') && (clean.includes('email') || clean.includes('mail'))) || clean.includes('email me') || clean.includes('mail me') || clean.includes('share on email')) {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        "Certainly. May I confirm your business email address and which service would be most relevant to you?",
                        "बिल्कुल। क्या मैं आपके व्यावसायिक ईमेल पते की पुष्टि कर सकता हूँ और कौन सी सेवा आपके लिए सबसे अधिक प्रासंगिक होगी?",
                        "ఖచ్చితంగా. నేను మీ వ్యాపార ఇమెయిల్ చిరునామాను నిర్ధారించవచ్చా మరియు ఏ సేవ మీకు అత్యంత సందర్భోచితంగా ఉంటుంది?",
                        currentLang
                    ),
                    detected_language: currentLang,
                    next_stage: 'EMAIL_CAPTURE',
                    classification: 'Email Requested',
                    extracted_fields: { preferred_next_step: 'email', call_outcome: 'Email Requested' },
                    should_end_call: false,
                    reason: 'sales_email_request'
                };
            }

            // D. "What is your pricing?"
            if (clean.includes('pricing') || clean.includes('price') || clean.includes('charges') || clean.includes('cost') || clean.includes('rate') || clean.includes('how much')) {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        "Pricing depends on the project scope, technical requirements, and timeline. Our team can review your requirement and provide a suitable quotation.",
                        "मूल्य निर्धारण परियोजना के दायरे, तकनीकी आवश्यकताओं और समय सीमा पर निर्भर करता है। हमारी टीम आपकी आवश्यकता की समीक्षा कर सकती है और एक उपयुक्त कोटेशन प्रदान कर सकती है।",
                        "ధర అనేది ప్రాజెక్ట్ పరిధి, సాంకేతిక అవసరాలు మరియు కాలక్రమంపై ఆధారపడి ఉంటుంది. మా బృందం మీ అవసరాన్ని సమీక్షించి తగిన కొటేషన్‌ను అందించగలదు.",
                        currentLang
                    ),
                    detected_language: currentLang,
                    next_stage: 'QUALIFICATION',
                    should_end_call: false,
                    reason: 'sales_pricing_inquiry'
                };
            }

            // E. "Where did you get my number?"
            if (clean.includes('get my number') || clean.includes('got my number') || clean.includes('where did you get')) {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        "I'm calling using business contact information available to our team. If you prefer not to receive further calls, I can record that request.",
                        "मैं हमारी टीम के पास उपलब्ध व्यावसायिक संपर्क जानकारी का उपयोग करके कॉल कर रहा हूँ। यदि आप आगे कॉल प्राप्त नहीं करना चाहते हैं, तो मैं उस अनुरोध को दर्ज कर सकता हूँ।",
                        "నేను మా బృందానికి అందుబాటులో ఉన్న వ్యాపార సంప్రదింపు సమాచారాన్ని ఉపయోగించి కాల్ చేస్తున్నాను. మీరు ఇకపై కాల్స్ స్వీకరించకూడదనుకుంటే, నేను ఆ అభ్యర్థనను నమోదు చేయగలను.",
                        currentLang
                    ),
                    detected_language: currentLang,
                    next_stage: 'CONSENT_CHECK',
                    should_end_call: false,
                    reason: 'sales_number_origin'
                };
            }

            // F. "I'm busy" / Meeting / Driving
            if (clean.includes('busy') || clean.includes('in a meeting') || clean.includes('driving') || clean.includes('call later')) {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        "Of course. Would you prefer a callback at a more convenient time, or would you rather not receive another call?",
                        "बिल्कुल। क्या आप अधिक सुविधाजनक समय पर कॉलबैक पसंद करेंगे, या आप दूसरा कॉल प्राप्त नहीं करना चाहेंगे?",
                        "తప్పకుండా. మీకు మరింత అనుకూలమైన సమయంలో కాల్‌బ్యాక్ చేయమంటారా, లేదా మళ్లీ కాల్ చేయకూడదని కోరుకుంటున్నారా?",
                        currentLang
                    ),
                    detected_language: currentLang,
                    next_stage: 'CALLBACK_TIME',
                    classification: 'Callback Requested',
                    extracted_fields: { preferred_next_step: 'callback', call_outcome: 'Callback Requested' },
                    should_end_call: false,
                    reason: 'sales_busy_callback'
                };
            }
        }

        // -------------------------------------------------------------
        // 5. LANGUAGE SWITCH REQUESTS
        // -------------------------------------------------------------
        if (words.length <= 6) {
            if (clean.includes('hindi') || clean.includes('hindi me') || clean.includes('hindi mein')) {
                return {
                    matched: true,
                    spoken_response: service === 'recruitment'
                        ? `ज़रूर, मैं हिंदी में बातचीत जारी रखते हैं। मैं स्कोर लैब्स से ${role} पद के लिए कॉल कर रहा हूँ। क्या आपके पास बात करने के लिए दो मिनट का समय है?`
                        : (service === 'sales'
                            ? `ज़रूर, हम हिंदी में बातचीत जारी रखते हैं। मैं स्कोरलैब्स इंक से कॉल कर रहा हूँ। क्या आपकी कंपनी किसी नए सॉफ्टवेयर प्रोजेक्ट या आईटी समाधान पर विचार कर रही है?`
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
                            ? `ఖచ్చితంగా, మనం తెలుగులోనే మాట్లాడగలను. నేను స్కోర్‌ల్యాబ్స్ ఇంక్ నుండి మాట్లాడుతున్నాను. మీ సంస్థ ఏదైనా కొత్త సాఫ్ట్‌వేర్ ప్రాజెక్ట్ లేదా ఐటీ భాగస్వామి కోసం చూస్తోందా?`
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

        // -------------------------------------------------------------
        // 6. AUDIBILITY / LINE CHECK ("Can you hear me?", "Hello?")
        // -------------------------------------------------------------
        if (words.length <= 6 && (clean.includes('hear me') || clean.includes('audible') || clean.includes('awaz') || clean.includes('vinipistunda') || clean === 'hello' || clean === 'hello hello')) {
            let resumeQuestion = String(lastQuestion || '')
                .replace(/^Yes,\s*I can hear you clearly!\s*Let's continue[—\-\s]*/gi, '')
                .replace(/^हाँ,\s*मुझे आपकी आवाज़ बिल्कुल साफ़ सुनाई दे रही है!\s*चलिए जारी रखते हैं[—\-\s]*/gi, '')
                .replace(/^అవును,\s*మీ మాట నాకు స్పష్టంగా వినిపిస్తోంది!\s*కొనసాగిద్దాం[—\-\s]*/gi, '')
                .replace(/^క్షమించండి,\s*కాల్ కట్ అయినట్లుంది[—\-\s]*/gi, '')
                .trim();
            if (!resumeQuestion) {
                resumeQuestion = (service === 'sales' ? "Is now a convenient time for a quick conversation?" : "Are you available for a brief chat?");
            }
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

        // -------------------------------------------------------------
        // 7. REPEAT THAT / PARDON
        // -------------------------------------------------------------
        if (words.length <= 6 && (clean.includes('repeat') || clean.includes('pardon') || clean.includes('say that again') || clean.includes('phir se') || clean.includes('malli cheppandi'))) {
            const repeatContent = lastQuestion || (service === 'sales' ? "Is your company planning any new software projects or looking for an IT partner?" : "Are you available for a brief conversation?");
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

        // -------------------------------------------------------------
        // 8. "I DON'T KNOW" / "NOT SURE"
        // -------------------------------------------------------------
        if (words.length <= 5 && (DONT_KNOW_TERMS.has(clean) || clean.includes('dont know') || clean.includes('not sure'))) {
            if (service === 'sales') {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        "No problem at all! Would you like me to connect you with someone from our technology team, or would you prefer an email with our services overview?",
                        "कोई बात नहीं! क्या आप चाहेंगे कि मैं आपको हमारी तकनीकी टीम के किसी सदस्य से जोड़ूँ, या आप हमारी सेवाओं के विवरण वाला एक ईमेल पसंद करेंगे?",
                        "ఏమీ సమస్య లేదు! మా సాంకేతిక బృందంలోని ఎవరితోనైనా మిమ్మల్ని కనెక్ట్ చేయమంటారా, లేదా మా సేవల వివరాలతో కూడిన ఇమెయిల్‌ను మీరు కోరుకుంటున్నారా?",
                        currentLang
                    ),
                    detected_language: currentLang,
                    next_stage: 'NEXT_STEP_PREFERENCE',
                    should_end_call: false,
                    reason: 'sales_dont_know'
                };
            }

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

        // Only process short responses (<= 5 words) for deterministic YES / NO matching
        if (words.length > 5) {
            return { matched: false };
        }

        const isYes = AFFIRMATIVE_TERMS.has(clean) || clean.startsWith('yes ') || words.every(w => AFFIRMATIVE_TERMS.has(w));
        const isNo = NEGATIVE_TERMS.has(clean) || clean.startsWith('no ') || clean.includes('not right now') || clean.includes('not now') || words.every(w => NEGATIVE_TERMS.has(w));

        // -------------------------------------------------------------
        // 9. CONTEXT-AWARE YES
        // -------------------------------------------------------------
        if (isYes) {
            return this.handleYes(service, stage, currentLang, role, company, context.questionPlan, context.memory);
        }

        // -------------------------------------------------------------
        // 10. CONTEXT-AWARE NO
        // -------------------------------------------------------------
        if (isNo) {
            return this.handleNo(service, stage, currentLang, role);
        }

        return { matched: false };
    }

    /**
     * Context-aware handling for affirmative answers ("yes", "sure", "okay", "correct")
     */
    static handleYes(service, stage, lang, role, company, questionPlan = null, memory = null) {
        if (service === 'sales') {
            switch (stage) {
                case 'AVAILABILITY':
                case 'GREETING':
                    // User says yes to initial opening
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Thank you. To understand whether we may be able to help, could I ask what type of IT project or service your company is currently considering?",
                            "धन्यवाद। यह समझने के लिए कि क्या हम आपकी मदद कर सकते हैं, क्या मैं पूछ सकता हूँ कि आपकी कंपनी वर्तमान में किस प्रकार के आईटी प्रोजेक्ट या सेवा पर विचार कर रही है?",
                            "ధన్యవాదాలు. మేము మీకు సహాయం చేయగలమా అని అర్థం చేసుకోవడానికి, మీ సంస్థ ప్రస్తుతం ఏ రకమైన ఐటీ ప్రాజెక్ట్ లేదా సేవను పరిశీలిస్తోందో అడగవచ్చా?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Interested',
                        next_stage: 'SERVICE_INTEREST',
                        extracted_fields: { call_outcome: 'Interested' },
                        should_end_call: false,
                        reason: 'sales_availability_yes'
                    };

                case 'EMAIL_PERMISSION':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Certainly. May I confirm your business email address and which service would be most relevant to you?",
                            "बिल्कुल। क्या मैं आपके व्यावसायिक ईमेल पते की पुष्टि कर सकता हूँ और कौन सी सेवा आपके लिए सबसे अधिक प्रासंगिक होगी?",
                            "ఖచ్చితంగా. నేను మీ వ్యాపార ఇమెయిల్ చిరునామాను నిర్ధారించవచ్చా మరియు ఏ సేవ మీకు అత్యంత సందర్భోచితంగా ఉంటుంది?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Email Requested',
                        next_stage: 'EMAIL_CAPTURE',
                        extracted_fields: { preferred_next_step: 'email', call_outcome: 'Email Requested' },
                        should_end_call: false,
                        reason: 'sales_email_permission_yes'
                    };

                case 'MEETING_REQUEST':
                case 'CLOSING':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Wonderful! What day and time next week would be convenient for a quick 15-minute introductory call with our business development team?",
                            "बहुत बढ़िया! हमारी बिजनेस डेवलपमेंट टीम के साथ 15 मिनट की त्वरित परिचयात्मक बातचीत के लिए अगले सप्ताह कौन सा दिन और समय सुविधाजनक होगा?",
                            "చాలా మంచిది! మా బిజినెస్ డెవలప్‌మెంట్ బృందంతో 15 నిమిషాల పరిచయ కాల్ కోసం వచ్చే వారం ఏ రోజు మరియు సమయం మీకు అనుకూలంగా ఉంటుంది?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Meeting Requested',
                        next_stage: 'MEETING_CONFIRMATION',
                        extracted_fields: { preferred_next_step: 'meeting', call_outcome: 'Meeting Requested' },
                        should_end_call: false,
                        reason: 'sales_meeting_yes'
                    };

                default:
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Great. Are you looking for support with a new project or an existing system?",
                            "बहुत अच्छा। क्या आप किसी नए प्रोजेक्ट या मौजूदा सिस्टम के लिए सहायता तलाश रहे हैं?",
                            "చాలా మంచిది. మీరు కొత్త ప్రాజెక్ట్ లేదా ఉన్న సిస్టమ్ కోసం సహాయం కోసం చూస్తున్నారా?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Interested',
                        next_stage: 'PROJECT_TYPE',
                        extracted_fields: { call_outcome: 'Interested' },
                        should_end_call: false,
                        reason: 'sales_generic_yes'
                    };
            }
        }

        if (service === 'recruitment') {
            // Check if there is a tailored question plan from the campaign
            let plannedNext = null;
            if (memory && typeof memory.getNextPlannedQuestion === 'function' && Array.isArray(questionPlan)) {
                plannedNext = memory.getNextPlannedQuestion(questionPlan);
            }

            switch (stage) {
                case 'AVAILABILITY':
                case 'GREETING':
                    const nextQText = (plannedNext && plannedNext.text)
                        ? plannedNext.text
                        : `Great, thank you! I'm calling about the ${role} position. Could you briefly share your total years of hands-on experience in this field?`;
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            nextQText,
                            `बहुत बढ़िया, धन्यवाद! मैं ${role} पद के संबंध में बात कर रहा हूँ। क्या आप इस क्षेत्र में अपने कुल वर्षों के अनुभव के बारे में बता सकते हैं?`,
                            `చాలా సంతోషం, ధన్యవాదాలు! నేను ${role} రోల్ గురించి మాట్లాడుతున్నాను. ఈ ఫీల్డ్‌లో మీ మొత్తం అనుభవం ఎన్ని సంవత్సరాలు?`,
                            lang
                        ),
                        detected_language: lang,
                        extracted_fields: { available_to_talk: 'Yes', candidate_interest: 'Interested' },
                        classification: 'On Hold',
                        next_stage: plannedNext ? (plannedNext.stage || 'EXPERIENCE') : 'EXPERIENCE',
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
        if (service === 'sales') {
            switch (stage) {
                case 'AVAILABILITY':
                case 'GREETING':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Of course. Would you prefer a callback at a more convenient time, or would you rather not receive another call?",
                            "बिल्कुल। क्या आप अधिक सुविधाजनक समय पर कॉलबैक पसंद करेंगे, या आप दूसरा कॉल प्राप्त नहीं करना चाहेंगे?",
                            "తప్పకుండా. మీకు మరింత అనుకూలమైన సమయంలో కాల్‌బ్యాక్ చేయమంటారా, లేదా మళ్లీ కాల్ చేయకూడదని కోరుకుంటున్నారా?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Callback Requested',
                        next_stage: 'CALLBACK_TIME',
                        extracted_fields: { preferred_next_step: 'callback', call_outcome: 'Callback Requested' },
                        should_end_call: false,
                        reason: 'sales_availability_no'
                    };

                case 'MEETING_REQUEST':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "No problem. Would you be comfortable receiving our company information so you have our details if a requirement comes up later?",
                            "कोई समस्या नहीं। क्या आप हमारी कंपनी की जानकारी प्राप्त करना चाहेंगे ताकि बाद में आवश्यकता होने पर आपके पास हमारा विवरण हो?",
                            "ఏమీ సమస్య లేదు. తర్వాత ఎప్పుడైనా అవసరం వచ్చినప్పుడు మీ వద్ద మా వివరాలు ఉండేలా మా కంపెనీ సమాచారాన్ని అందుకోవడానికి మీకు సౌకర్యంగా ఉంటుందా?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Interested',
                        next_stage: 'EMAIL_PERMISSION',
                        extracted_fields: { preferred_next_step: 'email' },
                        should_end_call: false,
                        reason: 'sales_meeting_no_email_fallback'
                    };

                default:
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Understood. We would be glad to be considered for future projects or additional support if a need comes up. Would it be okay to share our company profile for your reference?",
                            "समझ गया। यदि भविष्य में कोई आवश्यकता हो तो हम अतिरिक्त सहायता के लिए विचार किए जाने पर प्रसन्न होंगे। क्या आपके संदर्भ के लिए हमारी कंपनी प्रोफ़ाइल साझा करना ठीक रहेगा?",
                            "అర్థమైంది. భవిష్యత్తులో ఏదైనా అవసరం వచ్చినప్పుడు మేము పరిశీలించబడటానికి సంతోషిస్తాము. మీ సూచన కోసం మా కంపెనీ ప్రొఫైల్‌ను షేర్ చేయడం సరిపోతుందా?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Interested',
                        next_stage: 'EMAIL_PERMISSION',
                        should_end_call: false,
                        reason: 'sales_generic_no'
                    };
            }
        }

        if (service === 'recruitment') {
            switch (stage) {
                case 'AVAILABILITY':
                case 'GREETING':
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

        return { matched: false };
    }

    static inferStageFromQuestion(question) {
        if (!question) return 'AVAILABILITY';
        const q = question.toLowerCase();
        if (q.includes('convenient time') || q.includes('quick conversation') || q.includes('minute') || q.includes('time to speak') || q.includes('talk') || q.includes('available')) return 'AVAILABILITY';
        if (q.includes('meeting') || q.includes('15-minute') || q.includes('calendar')) return 'MEETING_REQUEST';
        if (q.includes('email') || q.includes('company information') || q.includes('company profile')) return 'EMAIL_PERMISSION';
        if (q.includes('year') || q.includes('experience') || q.includes('background')) return 'EXPERIENCE';
        if (q.includes('service') || q.includes('project') || q.includes('system') || q.includes('software')) return 'SERVICE_INTEREST';
        if (q.includes('skill') || q.includes('framework') || q.includes('technolog') || q.includes('language')) return 'SKILLS';
        if (q.includes('relocat') || q.includes('location') || q.includes('hybrid') || q.includes('city')) return 'LOCATION';
        if (q.includes('notice') || q.includes('joining') || q.includes('join')) return 'NOTICE_PERIOD';
        return 'GENERAL';
    }

    static localize(en, hi, te, lang = 'en') {
        const l = (lang || 'en').toLowerCase();
        if (l === 'hi') return hi;
        if (l === 'te') return te;
        return en;
    }
}
