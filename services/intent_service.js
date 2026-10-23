import AppointmentState from './appointment_state.js';
import SalesState from './sales_state.js';
import GreetingScript from './greeting_script.js';
import { isYesNoQuestion, topicOf, questionPart } from './question_tracker.js';

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
    'of course', 'certainly', 'by all means', 'yes please', 'please go ahead',
    'definitely', 'absolutely', 'alright', 'all right', 'agree', 'speaking', 'yes speaking',
    'go ahead', 'go for it', 'why not', 'sure thing', 'fine with me', 'works for me', 'it works for me',
    'yeah it works for me', 'that works', 'that works for me', 'this works', 'works fine',
    'sounds good', 'sounds good to me', 'sounds great', 'sounds fine',
    'i can talk', 'we can talk', 'lets talk', "let's talk", 'tell me', 'you can speak', 'speak',
    'have a minute', 'sure i have a minute', 'i have time', 'i have a minute', 'i have some time',
    'i am free', 'im free', 'free to talk', 'i have two minutes', 'i have 2 minutes',
    'haan', 'ha', 'haa', 'achha', 'acha', 'theek hai', 'theek', 'sahi', 'sahi hai',
    'bolo', 'boliye', 'haan boliye', 'ha boliye', 'haan theek hai', 'ha theek hai', 'bilkul', 'zaroor',
    'bilkul boliye', 'samay hai', 'time hai',
    'avunu', 'sare', 'alage', 'alaage', 'correcte', 'cheppandi', 'matladandi', 'matladavachu',
    'kudurutundi', 'kudarutundi', 'parvaledu', 'paravaledu', 'samayam undi', 'time undi',
    'avunu cheppandi', 'alage cheppandi', 'sare cheppandi'
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
    static getSalesCompany(context = {}) {
        const cc = context.campaignContext || (context.contact && context.contact.campaignContext) || {};
        return cc.company_name || (context.contact && context.contact.company) || 'Score Labs';
    }

    static getSalesOfferings(context = {}) {
        const cc = context.campaignContext || (context.contact && context.contact.campaignContext) || {};
        if (Array.isArray(cc.key_features) && cc.key_features.length > 0) {
            return cc.key_features.slice(0, 2).join(' and ');
        }
        if (cc.product_name && !cc.product_name.includes('Scorelabs')) {
            return cc.product_name;
        }
        return "web development, custom software, and digital solutions";
    }

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
                intent: 'DO_NOT_CALL',
                spoken_response: this.localize(
                    "Understood, I have recorded your request not to be contacted again. Have a great day.",
                    "समझ गया, मैंने दोबारा संपर्क न करने का आपका अनुरोध दर्ज कर लिया है। आपका दिन शुभ हो।",
                    "అర్థమైంది, మళ్లీ సంప్రదించవద్దని మీ అభ్యర్థనను నమోదు చేసాను. మీ దినం శుభప్రదం కాగాక.",
                    currentLang
                ),
                detected_language: currentLang,
                should_end_call: true,
                next_stage: 'CLOSING',
                classification: (service === 'sales' || service === 'appointment') ? 'Do Not Call' : (service === 'receptionist' ? 'Callback Requested' : 'Rejected'),
                extracted_fields: { preferred_next_step: 'none', call_outcome: 'Do Not Call', opt_out: true },
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
                classification: (service === 'sales' || service === 'appointment') ? 'Wrong Contact' : (service === 'receptionist' ? 'Wrong Number' : 'Rejected'),
                extracted_fields: { preferred_next_step: 'none', call_outcome: 'Wrong Contact' },
                reason: 'wrong_contact'
            };
        }

        // -------------------------------------------------------------
        // 2.5 EXPLICIT DO NOT CALL / OPT OUT
        // -------------------------------------------------------------
        if (clean.includes('do not call') || clean.includes('dont call') || clean.includes('remove my number') || clean.includes('stop calling') || clean.includes('never call') || clean.includes('remove me')) {
            return {
                matched: true,
                intent: 'DO_NOT_CALL',
                spoken_response: this.localize(
                    "I have recorded your request and removed your number from our contact list. You will not receive any further calls. Have a good day.",
                    "मैंने आपका अनुरोध दर्ज कर लिया है और आपका नंबर हमारी सूची से हटा दिया है। आपको आगे कोई कॉल नहीं आएगी। आपका दिन शुभ हो।",
                    "నేను మీ అభ్యర్థనను నమోదు చేసాను మరియు మా లిస్ట్ నుండి మీ నంబర్‌ను తొలగించాను. ఇకపై మీకు కాల్స్ రావు. మంచి రోజవుగాక.",
                    currentLang
                ),
                detected_language: currentLang,
                should_end_call: true,
                next_stage: 'CLOSING',
                classification: 'Do Not Call',
                extracted_fields: { preferred_next_step: 'none', call_outcome: 'Do Not Call', opt_out: true },
                reason: 'do_not_call_opt_out'
            };
        }

        // -------------------------------------------------------------
        // 2.6 SALES: the answer to "call with our team, or meet in person?"
        // -------------------------------------------------------------
        if (service === 'sales') {
            const meeting = this.handleMeetingAnswer(text, context, currentLang);
            if (meeting) return meeting;
        }

        // -------------------------------------------------------------
        // 3. EXPLICIT DECLINE / NOT INTERESTED
        // -------------------------------------------------------------
        if (clean.includes('not interested') || clean.includes('no interest') || clean.includes('not looking') || clean.includes('phone rakho') || clean.includes('cut the call')) {
            return {
                matched: true,
                intent: 'NOT_INTERESTED',
                spoken_response: this.localize(
                    "I understand. Thank you for your time. Have a great day.",
                    "मैं समझता हूँ। आपके समय के लिए धन्यवाद। आपका दिन शुभ हो।",
                    "నేను అర్థం చేసుకోగలను. మీ సమయానికి ధన్యవాదాలు. మంచి రోజవుగాక.",
                    currentLang
                ),
                detected_language: currentLang,
                should_end_call: true,
                next_stage: 'CLOSING',
                classification: (service === 'sales' || service === 'appointment') ? 'Not Interested' : (service === 'recruitment' ? 'Rejected' : (service === 'receptionist' ? 'Query Answered' : 'RESOLVED')),
                extracted_fields: { preferred_next_step: 'none', call_outcome: 'Not Interested', candidate_interest: 'Declined' },
                reason: 'not_interested'
            };
        }

        // -------------------------------------------------------------
        // 4. SALES SPECIFIC OBJECTIONS & PROMPTS
        // -------------------------------------------------------------
        if (service === 'sales') {
            const comp = this.getSalesCompany(context);

            // A. Identity Inquiry: "Who is this?" / "Who is calling?"
            if (clean.includes('who is this') || clean.includes('who is calling') || clean.includes('who are you') || clean.includes('whos this') || clean.includes('who is remo') || clean.includes('kaun bol raha hai') || clean.includes('evaru matladutunnaru') || clean.includes('who speaking')) {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        `This is Remo calling from ${comp}. Is this a good time to talk for a minute?`,
                        `मैं ${comp} से रेमो बात कर रहा हूँ। क्या आपके पास एक मिनट बात करने का समय है?`,
                        `నేను ${comp} నుండి రెమో మాట్లాడుతున్నాను. మాట్లాడటానికి ఒక నిమిషం సమయం ఉందా?`,
                        currentLang
                    ),
                    detected_language: currentLang,
                    next_stage: 'PERMISSION_CHECK',
                    should_end_call: false,
                    reason: 'sales_identity_inquiry'
                };
            }

            // B. Purpose Inquiry: "Why are you calling?" / "What is this about?"
            if (clean.includes('why are you calling') || clean.includes('what is this regarding') || clean.includes('what is this about') || clean.includes('what is the call about') || clean.includes('purpose of call') || clean.includes('kis liye call kiya') || clean.includes('endukani call chesaru')) {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        `I'm reaching out from ${comp} to check if you're exploring any services we could help you with. Do you have a brief minute?`,
                        `मैं ${comp} से यह जानने के लिए कॉल कर रहा हूँ कि क्या आप किसी सेवा की तलाश में हैं। क्या आपके पास एक मिनट का समय है?`,
                        `మేము సహాయపడగల సేవల గురించి తెలుసుకోవడానికి ${comp} నుండి కాల్ చేస్తున్నాను. ఒక నిమిషం సమయం ఉందా?`,
                        currentLang
                    ),
                    detected_language: currentLang,
                    next_stage: 'PERMISSION_CHECK',
                    should_end_call: false,
                    reason: 'sales_purpose_inquiry'
                };
            }

            // C. Services Inquiry: "What services do you offer?" / "What do you do?"
            if (clean.includes('what services') || clean.includes('which services') || clean.includes('what do you do') || clean.includes('what do you offer') || clean.includes('kya service') || clean.includes('services kya') || clean.includes('elaanti services')) {
                const offerings = this.getSalesOfferings(context);
                return {
                    matched: true,
                    spoken_response: this.localize(
                        `We can help with services such as ${offerings}. Is there anything specific you're looking for?`,
                        `हम ${offerings} जैसी सेवाओं में मदद कर सकते हैं। क्या आप किसी विशिष्ट सेवा की तलाश में हैं?`,
                        `మేము ${offerings} వంటి సేవలతో సహాయం చేయగలము. మీరు ప్రత్యేకంగా దేని కోసమైనా చూస్తున్నారా?`,
                        currentLang
                    ),
                    detected_language: currentLang,
                    next_stage: 'SERVICE_DISCOVERY',
                    should_end_call: false,
                    reason: 'sales_services_inquiry'
                };
            }

            // D. Callback time handling when already in CALLBACK_TIME stage
            if (stage === 'CALLBACK_TIME') {
                if (clean.includes('tomorrow') || clean.includes('monday') || clean.includes('tuesday') || clean.includes('wednesday') || clean.includes('thursday') || clean.includes('friday') || clean.includes('later') || clean.includes('evening') || clean.includes('morning') || clean.includes('afternoon') || clean.includes('pm') || clean.includes('am') || /\b\d+\s*(?:am|pm|o'clock)?\b/.test(clean)) {
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Thank you, I've noted that down. We will connect with you then. Have a great day!",
                            "धन्यवाद, मैंने यह नोट कर लिया है। हम उस समय आपसे संपर्क करेंगे। आपका दिन शुभ हो!",
                            "ధన్యవాదాలు, నేను నోట్ చేసుకున్నాను. ఆ సమయానికి మేము మిమ్మల్ని సంప్రదిస్తాము. మంచి రోజవుగాక!",
                            currentLang
                        ),
                        detected_language: currentLang,
                        next_stage: 'CLOSING',
                        classification: 'Callback Requested',
                        extracted_fields: { callback_time: text, call_outcome: 'Callback Requested' },
                        should_end_call: true,
                        reason: 'sales_callback_time_noted'
                    };
                }
            }

            // E. "We already have an IT vendor"
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

            // F. "We don't have any requirements right now"
            if (clean.includes('no requirement') || clean.includes('no requirements') || clean.includes('dont have any requirement') || clean.includes('no project')) {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        "No problem. Would you be comfortable receiving our company information so you have our details if a requirement comes up later?",
                        "कोई समस्या नहीं। क्या आप हमारी कंपनी की जानकारी प्राप्त करना चाहेंगे ताकि बाद में आवश्यकता होने पर आपके पास हमारा विवरण हो?",
                        "ఏమీ समस्या లేదు. తర్వాత ఎప్పుడైనా అవసరం వచ్చినప్పుడు మీ వద్ద మా వివరాలు ఉండేలా మా కంపెనీ సమాచారాన్ని అందుకోవడానికి మీకు సౌకర్యంగా ఉంటుందా?",
                        currentLang
                    ),
                    detected_language: currentLang,
                    next_stage: 'EMAIL_PERMISSION',
                    classification: 'Interested',
                    should_end_call: false,
                    reason: 'sales_objection_no_req'
                };
            }

            // G. "Send me an email"
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

            // H. "What is your pricing?"
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

            // I. "Where did you get my number?"
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
                    next_stage: 'PERMISSION_CHECK',
                    should_end_call: false,
                    reason: 'sales_number_origin'
                };
            }

            // J. "I'm busy" / Meeting / Driving
            if (clean.includes('busy') || clean.includes('in a meeting') || clean.includes('driving') || clean.includes('call later')) {
                return {
                    matched: true,
                    intent: 'BUSY',
                    spoken_response: this.localize(
                        "I completely understand. Would another time be better for a quick call, or would you prefer not to receive another call?",
                        "मैं पूरी तरह समझता हूँ। क्या किसी अन्य समय बात करना बेहतर रहेगा, या आप दोबारा कॉल प्राप्त नहीं करना चाहेंगे?",
                        "నేను పూర్తిగా అర్థం చేసుకోగలను. మరో సమయంలో మాట్లాడటం మంచిదా, లేక మళ్లీ కాల్ వద్దనుకుంటున్నారా?",
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

            // K. Service Need Expressed: e.g. "We need a website", "Looking for mobile app", "We need software", "web development"
            const serviceMatch = clean.match(/\b(website(?: development)?|web(?: development| dev)?|mobile app(?: development)?|custom software|software development|erp|crm|software testing|qa testing|cloud(?: solutions)?|digital solutions|it services)\b/i);
            if (serviceMatch && (stage === 'PERMISSION_CHECK' || stage === 'INTEREST_DISCOVERY' || stage === 'SERVICE_INTEREST' || stage === 'SERVICE_DISCOVERY' || stage === 'AVAILABILITY')) {
                const matchedService = serviceMatch[0];
                return {
                    matched: true,
                    spoken_response: this.localize(
                        `We can certainly help with ${matchedService}! Could you tell me a little about your project requirements or timeline?`,
                        `हम निश्चित रूप से ${matchedService} में आपकी मदद कर सकते हैं! क्या आप अपनी परियोजना की आवश्यकताओं या समय सीमा के बारे में थोड़ा बता सकते हैं?`,
                        `మేము ఖచ్చితంగా ${matchedService}తో మీకు సహాయం చేయగలము! మీ ప్రాజెక్ట్ అవసరాలు లేదా కాలక్రమం గురించి కాస్త చెప్పగలరా?`,
                        currentLang
                    ),
                    detected_language: currentLang,
                    next_stage: 'QUALIFICATION',
                    extracted_fields: { service_needed: matchedService, customer_interest: 'Interested' },
                    classification: 'Interested',
                    should_end_call: false,
                    reason: 'sales_service_need_expressed'
                };
            }
        }

        // -------------------------------------------------------------
        // 4b. RECRUITMENT: "who is this?" and "and then?" / "please continue"
        // -------------------------------------------------------------
        if (service === 'recruitment') {
            const questions = context.questions || null;
            const opening = stage === 'GREETING' || stage === 'AVAILABILITY' || stage === 'PERMISSION_CHECK';
            if (opening && /\b(who is this|who is calling|who are you|whos this|who is speaking|which company|what company|where are you calling from|kaun bol raha)\b/.test(clean)) {
                return {
                    matched: true,
                    spoken_response: GreetingScript.whoIsCalling(currentLang),
                    detected_language: currentLang,
                    next_stage: 'AVAILABILITY',
                    should_end_call: false,
                    reason: 'recruitment_identity_inquiry'
                };
            }
            if (context.turnKind === 'continuation') {
                const open = questions && questions.pendingQuestionId ? questions.currentQuestionText : '';
                return {
                    matched: true,
                    spoken_response: open && currentLang === 'en'
                        ? `Sure. ${open}`
                        : this.localize('Sure, please go ahead.', 'जी, कृपया बताइए।', 'తప్పకుండా, చెప్పండి.', currentLang),
                    detected_language: currentLang,
                    should_end_call: false,
                    reason: 'recruitment_continue'
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
                            : (service === 'appointment'
                                ? `ज़रूर, हम हिंदी में बात करते हैं। आपकी अपॉइंटमेंट के लिए कौन सा दिन और समय सुविधाजनक रहेगा?`
                                : (service === 'receptionist'
                                    ? `ज़रूर, हम हिंदी में बात करते हैं। मैं आपकी कैसे मदद कर सकता हूँ?`
                                    : `ज़रूर, हम हिंदी में सहायता करेंगे। कृपया अपनी समस्या संक्षेप में बताएं।`))),
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
                            : (service === 'appointment'
                                ? `ఖచ్చితంగా, మనం తెలుగులోనే మాట్లాడదాం. మీ అపాయింట్‌మెంట్ కోసం ఏ రోజు మరియు సమయం అనుకూలంగా ఉంటుంది?`
                                : (service === 'receptionist'
                                    ? `ఖచ్చితంగా, మనం తెలుగులోనే మాట్లాడదాం. నేను మీకు ఎలా సహాయం చేయగలను?`
                                    : `ఖచ్చితంగా, మనం తెలుగులోనే మాట్లాడగలను. మీ సమస్య ఏమిటో కాస్త వివరించగలరా?`))),
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

        // Fast-path deterministic evaluation for short/medium affirmations & responses (<= 8 words)
        if (words.length <= 8) {
            const isAffirmativeIdiom = clean === 'why not' || clean.includes('parvaledu') || clean.includes('paravaledu');
            const hasNegative = !isAffirmativeIdiom && (
                clean.includes('not ') || clean.endsWith(' not') ||
                clean === 'no' || clean.startsWith('no ') || clean.includes('busy') ||
                clean.includes('dont ') || clean.includes('cant ') || clean.includes('wont ') ||
                clean.includes('driving') || clean.includes('meeting') || clean.includes('later') ||
                clean.includes('wrong') || clean.includes('nahi') ||
                /\b(ledu|kadu|vaddu)\b/.test(clean)
            );

            // Fast-path yes/no is strictly for brief affirmative/negative acknowledgments (e.g. "yes", "sure", "ok", "works for me").
            // Substantive candidate/prospect answers (> 3 words) must NEVER be hijacked as a bare yes/no,
            // e.g. "Yes, I have worked with React, Next.js and Node.js..." contains substantive technical skills.
            const isKnownAffirmativePhrase = AFFIRMATIVE_TERMS.has(clean) || words.every(w => AFFIRMATIVE_TERMS.has(w));
            const isShortAffirmativePrefix = (words.length <= 3) && (
                clean.startsWith('yes') || clean.startsWith('yeah') || clean.startsWith('yep') || clean.startsWith('yup') ||
                clean.startsWith('sure') || clean.startsWith('ok') || clean.startsWith('okay') || clean.startsWith('fine') ||
                clean.startsWith('alright') || clean.startsWith('haan') || clean.startsWith('ha ') || clean.startsWith('avunu') ||
                clean.startsWith('sare') || clean.startsWith('alage') || clean.startsWith('bilkul') ||
                clean.startsWith('of course') || clean.startsWith('certainly') || clean.startsWith('by all means')
            );
            const isAffirmativeKeywordMatch = (words.length <= 5) && (
                clean.includes('works for me') || clean.includes('work for me') || clean.includes('that works') || clean.includes('this works') ||
                clean.includes('sounds good') || clean.includes('sounds great') || clean.includes('sounds fine') ||
                clean.includes('have time') || clean.includes('am free') || clean.includes('im free') ||
                clean.includes('have a minute') || clean.includes('have a min') || clean.includes('have 2 minutes') || clean.includes('have two minutes') ||
                clean.includes('i can talk') || clean.includes('go ahead') || clean.includes('go for it') || clean.includes('why not') ||
                clean.includes('fine with me') || clean.includes('sure thing') || clean.includes('lets talk') || clean.includes('we can talk') ||
                clean.includes('you can speak') || clean.includes('tell me') || clean.includes('boliye') || clean.includes('cheppandi') ||
                clean.includes('kudurutundi') || clean.includes('kudarutundi') || clean.includes('parvaledu') || clean.includes('samayam undi') || clean.includes('time undi')
            );

            const isYes = !hasNegative && (isKnownAffirmativePhrase || isShortAffirmativePrefix || isAffirmativeKeywordMatch);

            const isKnownNegativePhrase = NEGATIVE_TERMS.has(clean) || words.every(w => NEGATIVE_TERMS.has(w));
            const isShortNegativePrefix = (words.length <= 5) && (clean.startsWith('no ') || clean === 'no');
            const isNegativeKeywordMatch = (words.length <= 6) && (
                clean.includes('not right now') || clean.includes('not now') || clean.includes('not at the moment') ||
                clean.includes('not really') || clean.includes('not currently') || clean.includes('not yet')
            );

            const isNo = isKnownNegativePhrase || isShortNegativePrefix || isNegativeKeywordMatch;

            // -------------------------------------------------------------
            // 9. CONTEXT-AWARE YES
            // -------------------------------------------------------------
            if (isYes) {
                return this.handleYes(service, stage, currentLang, role, company, context.questionPlan, context.memory, context);
            }

            // -------------------------------------------------------------
            // 10. CONTEXT-AWARE NO
            // -------------------------------------------------------------
            if (isNo) {
                return this.handleNo(service, stage, currentLang, role, context);
            }
        }

        return { matched: false };
    }

    /**
     * Sales: while the call-or-in-person question is open, a clear answer is recorded, acknowledged and the call is
     * closed; a bare "yes"/"okay" gets one short clarification. Anything else goes on to the normal handling.
     */
    static handleMeetingAnswer(text, context, lang) {
        const turn = SalesState.captureMeetingAnswer(context.collectedData || {}, text);
        if (turn.clarify) {
            return {
                matched: true,
                spoken_response: SalesState.meetingClarification(lang),
                detected_language: lang,
                extracted_fields: turn.fields,
                should_end_call: false,
                reason: 'sales_meeting_clarify'
            };
        }
        if (!turn.captured) return null;

        const meetingAgreed = ['phone_call', 'in_person', 'either'].includes(turn.preference);
        return {
            matched: true,
            spoken_response: SalesState.meetingReply(turn.preference, lang),
            detected_language: lang,
            next_stage: 'CLOSING',
            classification: meetingAgreed ? 'Meeting Requested' : undefined,
            extracted_fields: meetingAgreed
                ? { ...turn.fields, preferred_next_step: 'meeting', call_outcome: 'Meeting Requested' }
                : turn.fields,
            should_end_call: true,
            reason: `sales_meeting_${turn.preference}`
        };
    }

    /**
     * Context-aware handling for affirmative answers ("yes", "sure", "okay", "correct")
     */
    static handleYes(service, stage, lang, role, company, questionPlan = null, memory = null, context = {}) {
        if (service === 'sales') {
            switch (stage) {
                case 'GREETING': {
                    const rawName = (context.contact && context.contact.name && !String(context.contact.name).startsWith('Contact')) ? String(context.contact.name).trim() : '';
                    const comp = this.getSalesCompany(context);
                    const namePrefix = rawName ? `Hi ${rawName}, ` : 'Hi, ';
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            `${namePrefix}this is Remo calling from ${comp}. Is this a good time to talk for a minute?`,
                            `${namePrefix}मैं ${comp} से रेमो बात कर रहा हूँ। क्या यह बात करने के लिए अच्छा समय है?`,
                            `${namePrefix}నేను ${comp} నుండి రెమో మాట్లాడుతున్నాను. మాట్లాడటానికి ఇది మంచి సమయమేనా?`,
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Interested',
                        next_stage: 'PERMISSION_CHECK',
                        should_end_call: false,
                        reason: 'sales_greeting_yes'
                    };
                }

                case 'AVAILABILITY':
                case 'PERMISSION_CHECK':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Thank you! I just wanted to check if you're currently looking for any services that we could help you with?",
                            "धन्यवाद! मैं बस यह जानना चाहता था कि क्या आप वर्तमान में किसी ऐसी सेवा की तलाश में हैं जिसमें हम मदद कर सकें?",
                            "ధన్యవాదాలు! మేము సహాయపడగల ఏవైనా సేవల కోసం మీరు ప్రస్తుతం చూస్తున్నారా అని తెలుసుకోవాలనుకుంటున్నాను?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Interested',
                        next_stage: (stage === 'AVAILABILITY') ? 'SERVICE_INTEREST' : 'INTEREST_DISCOVERY',
                        should_end_call: false,
                        reason: 'sales_permission_yes'
                    };

                case 'INTEREST_DISCOVERY':
                case 'SERVICE_INTEREST':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Great! Could you tell me a little about what you're looking for?",
                            "बहुत अच्छा! क्या आप थोड़ा बता सकते हैं कि आप किस प्रकार की सेवा की तलाश में हैं?",
                            "చాలా మంచిది! మీరు ఎలాంటి సేవల కోసం చూస్తున్నారో కాస్త చెప్పగలరా?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Interested',
                        next_stage: 'QUALIFICATION',
                        should_end_call: false,
                        reason: 'sales_interest_yes'
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
                case 'NEXT_STEP':
                case 'CLOSING':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Wonderful! What day and time next week would be convenient for a quick 15-minute introductory call?",
                            "बहुत बढ़िया! 15 मिनट की बातचीत के लिए अगले सप्ताह कौन सा दिन और समय सुविधाजनक होगा?",
                            "చాలా మంచిది! 15 నిమిషాల కాల్ కోసం వచ్చే వారం ఏ రోజు మరియు సమయం అనుకూలంగా ఉంటుంది?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Meeting Requested',
                        next_stage: 'CLOSING',
                        extracted_fields: { preferred_next_step: 'meeting', call_outcome: 'Meeting Requested' },
                        should_end_call: false,
                        reason: 'sales_meeting_yes'
                    };

                default:
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Understood. Could you tell me a little about what you're looking for?",
                            "समझ गया। क्या आप थोड़ा बता सकते हैं कि आप क्या तलाश रहे हैं?",
                            "అర్థమైంది. మీరు దేని కోసం చూస్తున్నారో కాస్త చెప్పగలరా?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Interested',
                        next_stage: 'QUALIFICATION',
                        extracted_fields: { call_outcome: 'Interested' },
                        should_end_call: false,
                        reason: 'sales_generic_yes'
                    };
            }
        }

        if (service === 'recruitment') {
            const questions = context.questions || null;
            const collected = context.collectedData || {};
            const isFieldKnown = (f) => collected[f] !== undefined && collected[f] !== null && String(collected[f]).trim() !== '';

            // "Of course" / "sure" after a request such as "could you tell me about your experience?" is consent to
            // answer, not the answer: invite the answer instead of moving on to a different question.
            const openQuestion = questions && questions.pendingQuestionId ? questions.currentQuestionText : '';
            if (stage !== 'GREETING' && stage !== 'AVAILABILITY' && stage !== 'PERMISSION_CHECK' && openQuestion && !isYesNoQuestion(openQuestion)) {
                return {
                    matched: true,
                    spoken_response: this.localize(
                        'Please go ahead, I am listening.',
                        'जी, कृपया बताइए, मैं सुन रहा हूँ।',
                        'దయచేసి చెప్పండి, నేను వింటున్నాను.',
                        lang
                    ),
                    detected_language: lang,
                    should_end_call: false,
                    reason: 'recruitment_yes_to_open_question'
                };
            }

            // The next planned question that has not been asked. The availability question is never asked again.
            let plannedNext = null;
            if (questions && questions.plan.length) {
                plannedNext = questions.nextUnanswered({ isFieldKnown });
            } else if (memory && typeof memory.getNextPlannedQuestion === 'function' && Array.isArray(questionPlan)) {
                const withoutAvailability = questionPlan.filter(q => q && q.field_to_collect !== 'is_available' && q.stage !== 'AVAILABILITY');
                plannedNext = memory.getNextPlannedQuestion(withoutAvailability);
            }

            switch (stage) {
                case 'GREETING':
                    // "Hello, am I speaking with <name>?" -> "Yes": now Remo introduces itself and asks if it is a good time.
                    return {
                        matched: true,
                        spoken_response: GreetingScript.recruitmentIntro(lang),
                        detected_language: lang,
                        extracted_fields: { identity_confirmed: 'Yes' },
                        classification: 'On Hold',
                        next_stage: 'AVAILABILITY',
                        should_end_call: false,
                        reason: 'recruitment_greeting_yes'
                    };

                case 'AVAILABILITY': {
                    // Consent given: go straight to the first screening question, once.
                    const firstQuestion = (plannedNext && plannedNext.text) ? plannedNext.text : GreetingScript.firstScreeningQuestion('en');
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            `Thank you. ${firstQuestion}`,
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
                }

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
                    // With a question plan, "yes" to a yes/no question moves to the next planned question,
                    // or closes the screening when every planned question has been asked.
                    if (questions && questions.plan.length) {
                        if (plannedNext && plannedNext.text) {
                            return {
                                matched: true,
                                spoken_response: this.localize(`Great, thank you. ${plannedNext.text}`, `बहुत बढ़िया, धन्यवाद। ${plannedNext.text}`, `చాలా మంచిది, ధన్యవాదాలు. ${plannedNext.text}`, lang),
                                detected_language: lang,
                                next_stage: plannedNext.stage || 'SCREENING',
                                should_end_call: false,
                                reason: 'recruitment_yes_next_planned'
                            };
                        }
                        return {
                            matched: true,
                            spoken_response: this.localize(
                                'Thank you for your time. Our team will review your profile and get back to you. Have a great day!',
                                'आपके समय के लिए धन्यवाद। हमारी टीम आपकी प्रोफ़ाइल देखकर आपसे संपर्क करेगी। आपका दिन शुभ हो!',
                                'మీ సమయానికి ధన్యవాదాలు. మా బృందం మీ ప్రొఫైల్‌ను సమీక్షించి మిమ్మల్ని సంప్రదిస్తుంది. మంచి రోజు గడపండి!',
                                lang
                            ),
                            detected_language: lang,
                            next_stage: 'CLOSING',
                            should_end_call: true,
                            reason: 'recruitment_screening_complete'
                        };
                    }
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

        // Only the very first "yes" (to "is now a good time?") starts the booking questions. Once any detail
        // is collected, or the call has moved on, a bare "yes" goes to the AI instead of restarting the booking.
        if (service === 'appointment' && (stage === 'AVAILABILITY' || stage === 'GREETING') && !AppointmentState.hasProgress(context.collectedData)) {
            return {
                matched: true,
                spoken_response: this.localize(
                    "Thank you! What would the appointment be for, and which day would suit you best?",
                    "धन्यवाद! अपॉइंटमेंट किस काम के लिए है, और आपके लिए कौन सा दिन सबसे सुविधाजनक रहेगा?",
                    "ధన్యవాదాలు! అపాయింట్‌మెంట్ దేని కోసం, మరియు మీకు ఏ రోజు అనుకూలంగా ఉంటుంది?",
                    lang
                ),
                detected_language: lang,
                classification: 'Pending',
                next_stage: 'PURPOSE',
                should_end_call: false,
                reason: 'appointment_availability_yes'
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
    static handleNo(service, stage, lang, role, context = {}) {
        if (service === 'sales') {
            switch (stage) {
                case 'GREETING':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "I apologize for the mix-up. Thank you for your time, and have a good day.",
                            "असुविधा के लिए माफ़ी चाहता हूँ। आपके समय के लिए धन्यवाद, और आपका दिन शुभ हो।",
                            "పొరపాటుకు క్షమించండి. మీ సమయానికి ధన్యవాదాలు, మంచి రోజవుగాక.",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Wrong Contact',
                        next_stage: 'CLOSING',
                        extracted_fields: { call_outcome: 'Wrong Contact' },
                        should_end_call: true,
                        reason: 'sales_wrong_person'
                    };

                case 'AVAILABILITY':
                case 'PERMISSION_CHECK':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "I completely understand. Would another time be better for a quick call back, or would you prefer not to receive another call?",
                            "मैं पूरी तरह समझता हूँ। क्या किसी अन्य समय बात करना बेहतर रहेगा, या आप दोबारा कॉल प्राप्त नहीं करना चाहेंगे?",
                            "నేను పూర్తిగా అర్థం చేసుకోగలను. మరో సమయంలో మాట్లాడటం మంచిదా, లేక మళ్లీ కాల్ వద్దనుకుంటున్నారా?",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Callback Requested',
                        next_stage: 'CALLBACK_TIME',
                        extracted_fields: { preferred_next_step: 'callback', call_outcome: 'Callback Requested' },
                        should_end_call: false,
                        reason: (stage === 'AVAILABILITY') ? 'sales_availability_no' : 'sales_permission_no'
                    };

                case 'INTEREST_DISCOVERY':
                case 'SERVICE_DISCOVERY':
                case 'SERVICE_INTEREST':
                case 'discovery':
                    return {
                        matched: true,
                        intent: 'NEGATIVE_TO_CURRENT_QUESTION',
                        spoken_response: this.localize(
                            "I completely understand. Thank you so much for your time today, and have a wonderful day!",
                            "मैं समझता हूँ। आज आपके समय के लिए बहुत-बहुत धन्यवाद, और आपका दिन शुभ हो!",
                            "నేను అర్థం చేసుకోగలను. ఈ రోజు మీ సమయానికి చాలా ధన్యవాదాలు, మరియు మంచి రోజవుగాక!",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Not Interested',
                        next_stage: 'CLOSING',
                        extracted_fields: { preferred_next_step: 'none', call_outcome: 'Not Interested' },
                        should_end_call: true,
                        reason: 'sales_interest_no'
                    };

                case 'CALLBACK_TIME':
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "Understood, I have recorded your request not to be contacted again. Have a great day.",
                            "समझ गया, मैंने दोबारा संपर्क न करने का आपका अनुरोध दर्ज कर लिया है। आपका दिन शुभ हो।",
                            "అర్థమైంది, మళ్లీ సంప్రదించవద్దని మీ అభ్యర్థనను నమోదు చేసాను. మంచి రోజవుగాక.",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Do Not Call',
                        next_stage: 'CLOSING',
                        extracted_fields: { preferred_next_step: 'none', call_outcome: 'Do Not Call' },
                        should_end_call: true,
                        reason: 'sales_callback_no'
                    };

                case 'MEETING_REQUEST':
                case 'NEXT_STEP':
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
                            "Understood. Thank you for your time today. Have a great day!",
                            "समझ गया। आज आपके समय के लिए धन्यवाद। आपका दिन शुभ हो!",
                            "అర్థమైంది. ఈ రోజు మీ సమయానికి ధన్యవాదాలు. మంచి రోజవుగాక!",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Not Interested',
                        next_stage: 'CLOSING',
                        should_end_call: true,
                        reason: 'sales_generic_no'
                    };
            }
        }

        if (service === 'recruitment') {
            const questions = context.questions || null;
            switch (stage) {
                case 'GREETING':
                    // "Hello, am I speaking with <name>?" -> "No": wrong person.
                    return {
                        matched: true,
                        spoken_response: this.localize(
                            "I apologize for the mix-up. Thank you for your time, and have a good day.",
                            "असुविधा के लिए माफ़ी चाहता हूँ। आपके समय के लिए धन्यवाद, और आपका दिन शुभ हो।",
                            "పొరపాటుకు క్షమించండి. మీ సమయానికి ధన్యవాదాలు, మంచి రోజవుగాక.",
                            lang
                        ),
                        detected_language: lang,
                        classification: 'Wrong Contact',
                        next_stage: 'CLOSING',
                        extracted_fields: { call_outcome: 'Wrong Contact' },
                        should_end_call: true,
                        reason: 'recruitment_wrong_person'
                    };

                case 'AVAILABILITY':
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
                    // With a question plan, "no" is the answer to the open question; move to the next planned
                    // question (never back to one already asked), or close the screening when none is left.
                    if (questions && questions.plan.length) {
                        const collected = context.collectedData || {};
                        const known = (f) => collected[f] !== undefined && collected[f] !== null && String(collected[f]).trim() !== '';
                        const pending = questions.pendingQuestionId ? questions.currentQuestionText : '';
                        const next = topicOf(questionPart(pending)) === 'candidate_questions' ? null : questions.nextUnanswered({ isFieldKnown: known });
                        if (next && next.text) {
                            return {
                                matched: true,
                                spoken_response: this.localize(`Understood. ${next.text}`, `समझ गया। ${next.text}`, `అర్థమైంది. ${next.text}`, lang),
                                detected_language: lang,
                                classification: 'On Hold',
                                next_stage: next.stage || 'SCREENING',
                                should_end_call: false,
                                reason: 'recruitment_no_next_planned'
                            };
                        }
                        return {
                            matched: true,
                            spoken_response: this.localize(
                                'Thank you for your time. Our team will review your profile and get back to you. Have a great day!',
                                'आपके समय के लिए धन्यवाद। हमारी टीम आपकी प्रोफ़ाइल देखकर आपसे संपर्क करेगी। आपका दिन शुभ हो!',
                                'మీ సమయానికి ధన్యవాదాలు. మా బృందం మీ ప్రొఫైల్‌ను సమీక్షించి మిమ్మల్ని సంప్రదిస్తుంది. మంచి రోజు గడపండి!',
                                lang
                            ),
                            detected_language: lang,
                            classification: 'On Hold',
                            next_stage: 'CLOSING',
                            should_end_call: true,
                            reason: 'recruitment_screening_complete'
                        };
                    }
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

        // Only the very first question ("is now a good time?") can be answered "no" with a callback offer;
        // once any booking detail is collected a "no" belongs to the AI (e.g. "no, that's not right").
        if (service === 'appointment' && (stage === 'AVAILABILITY' || stage === 'GREETING') && !AppointmentState.hasProgress(context.collectedData)) {
            return {
                matched: true,
                spoken_response: this.localize(
                    "No problem at all. When would be a better time for me to call you back?",
                    "कोई बात नहीं। मैं आपको किस समय दोबारा कॉल कर सकता हूँ?",
                    "ఏమీ పర్వాలేదు. నేను మిమ్మల్ని ఏ సమయంలో తిరిగి కాల్ చేయాలి?",
                    lang
                ),
                detected_language: lang,
                classification: 'Callback Requested',
                next_stage: 'CALLBACK_TIME',
                extracted_fields: { preferred_next_step: 'callback' },
                should_end_call: false,
                reason: 'appointment_availability_no'
            };
        }

        return { matched: false };
    }

    static inferStageFromQuestion(question) {
        if (!question) return 'AVAILABILITY';
        const q = question.toLowerCase();
        if (q.includes('am i speaking with') || q.includes('speaking with')) return 'GREETING';
        if (q.includes('looking for any services') || q.includes('services that we could help')) return 'INTEREST_DISCOVERY';
        if (q.includes('good time to talk') || q.includes('convenient time') || q.includes('quick conversation') || q.includes('minute') || q.includes('time to speak') || q.includes('time to talk') || q.includes('talk for a minute') || q.includes('available')) return 'PERMISSION_CHECK';
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
