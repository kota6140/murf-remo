import 'dotenv/config';
import LLMService from './llm_service.js';
import AppointmentState from './appointment_state.js';
import SalesState from './sales_state.js';
import GreetingScript from './greeting_script.js';

const FALLBACK_TEXT = {
    'en': "I'm sorry, I don't have that information right now, but I'll make sure our team follows up with you directly.",
    'hi': "माफ़ कीजिए, मेरे पास अभी यह जानकारी उपलब्ध नहीं है, लेकिन हमारी टीम आपसे जल्द संपर्क करेगी।",
    'te': "నన్ను క్షమించండి, ప్రస్తుతం నా వద్ద ఆ సమాచారం లేదు, కానీ మా బృందం నేరుగా మిమ్మల్ని సంప్రదిస్తుంది.",
    'ta': "மன்னிக்கவும், என்னிடம் இப்போது அந்த தகவல் இல்லை, ஆனால் எங்கள் குழு உங்களை நேரடியாக தொடர்பு கொள்ளும்.",
    'kn': "ಕ್ಷಮಿಸಿ, ನನ್ನ ಬಳಿ ಈಗ ಆ ಮಾಹಿತಿ ಲಭ್ಯವಿಲ್ಲ, ಆದರೆ ನಮ್ಮ ತಂಡವು ನಿಮ್ಮನ್ನು ನೇರವಾಗಿ ಸಂಪರ್ಕಿಸುತ್ತದೆ.",
    'ml': "ക്ഷമിക്കണം, എന്റെ പക്കൽ ഇപ്പോൾ ആ വിവരമില്ല, എന്നാൽ ഞങ്ങളുടെ ടീം നിങ്ങളെ നേരിട്ട് ബന്ധപ്പെടും.",
    'mr': "क्षमस्व, माझ्याकडे आता ती माहिती उपलब्ध नाही, परंतु आमची टीम आपल्याशी थेट संपर्क साधेल."
};

export default class GeminiService {
    /**
     * Returns the opening greeting tailored to the specific campaign service and attached document.
     */
    static getOpeningGreeting(service = 'recruitment', contactInfo = {}) {
        const s = String(service || 'recruitment').toLowerCase();
        const safeContact = contactInfo || {};
        const ctx = safeContact.campaignContext || safeContact.extracted_data || safeContact.jdCriteria || safeContact;
        const rawName = (safeContact.name || '').trim();
        const isValidName = rawName && !rawName.startsWith('Caller') && !rawName.startsWith('Candidate') && !rawName.startsWith('Contact') && !rawName.startsWith('Row');
        const langRaw = safeContact.language || (safeContact.primaryLocale ? safeContact.primaryLocale.split('-')[0] : 'en');
        const lang = String(langRaw || 'en').toLowerCase().trim();

        if (s === 'sales') {
            // No company is built in: only the campaign document's company is ever named.
            const shortCompany = String(ctx.company_name || '').replace(/\s+Inc\.?$/i, '').trim();
            const fc = (l) => GreetingScript.fromCompany(shortCompany, l);

            // If customer name is known, start with personal identity confirmation
            if (isValidName) {
                if (lang === 'te') return `నమస్కారం, నేను ${rawName} గారితో మాట్లాడుతున్నానా?`;
                if (lang === 'hi') return `नमस्ते, क्या मैं ${rawName} से बात कर रहा हूँ?`;
                if (lang === 'ta') return `வணக்கம், நான் ${rawName} அவர்களிடம் பேசுகிறேனா?`;
                if (lang === 'kn') return `ನಮಸ್ಕಾರ, ನಾನು ${rawName} ಅವರೊಂದಿಗೆ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆಯೇ?`;
                if (lang === 'ml') return `നമസ്കാരം, ഞാൻ ${rawName} ആണോ സംസാരിക്കുന്നത്?`;
                if (lang === 'mr') return `नमस्कार, मी ${rawName} यांच्याशी बोलत आहे का?`;
                return `Hello, am I speaking with ${rawName}?`;
            }

            // Short, natural, human-sounding opening
            if (lang === 'te') return `నమస్తే, నేను${fc('te')} రెమో మాట్లాడుతున్నాను. ఇప్పుడు మాట్లాడటానికి మంచి సమయమేనా?`;
            if (lang === 'hi') return `नमस्ते, मैं${fc('hi')} रेमो बोल रहा हूँ। क्या अभी बात करने के लिए सही समय है?`;
            if (lang === 'ta') return `வணக்கம், நான்${fc('ta')} ரெமோ பேசுகிறேன். இப்போது பேச நல்ல நேரமா?`;
            if (lang === 'kn') return `ನಮಸ್ಕಾರ, ನಾನು${fc('kn')} ರೆಮೋ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. ಈಗ ಮಾತನಾಡಲು ಇದು ಸರಿಯಾದ ಸಮಯವೇ?`;
            if (lang === 'ml') return `നമസ്കാരം, ഞാൻ${fc('ml')} റെമോ ആണ് സംസാരിക്കുന്നത്. സംസാരിക്കാൻ ഇപ്പോൾ സൗകര്യപ്രദമായ സമയമാണോ?`;
            if (lang === 'mr') return `नमस्कार, मी${fc('mr')} रेमो बोलत आहे. आता बोलण्यासाठी योग्य वेळ आहे का?`;
            return `Hi, this is Remo calling${fc('en')}. Is now a good time to talk?`;
        }

        if (s === 'support') {
            if (ctx.opening_greeting && typeof ctx.opening_greeting === 'string' && ctx.opening_greeting.length > 15) {
                let docGreeting = ctx.opening_greeting.trim();
                if (isValidName && !docGreeting.includes(rawName)) {
                    docGreeting = (lang === 'te' ? `నమస్కారం, నేను ${rawName} గారితో మాట్లాడుతున్నానా? ` : (lang === 'hi' ? `नमस्ते, क्या मैं ${rawName} से बात कर रहा हूँ? ` : `Hello, am I speaking with ${rawName}? `)) + docGreeting;
                }
                return docGreeting;
            }

            // Only the campaign document's company is named; with none the call says "customer support" alone.
            const company = String(ctx.company_name || '').trim();
            const product = ctx.product_name || '';
            const orgEn = company ? `${company} customer support` : 'customer support';
            const orgTe = company ? `${company} కస్టమర్ సపోర్ట్` : 'కస్టమర్ సపోర్ట్';
            const orgHi = company ? `${company} कस्टमर सपोर्ट` : 'कस्टमर सपोर्ट';

            // Document-driven custom support greeting
            if (product && !product.includes('TakeRemo')) {
                if (isValidName) {
                    if (lang === 'te') return `నమస్కారం, నేను ${rawName} గారితో మాట్లాడుతున్నానా? నమస్తే ${rawName}, నేను ${orgTe} నుండి రెమో మాట్లాడుతున్నాను. ఇప్పుడు మాట్లాడటానికి మీకు అనుకూలమేనా?`;
                    if (lang === 'hi') return `नमस्ते, क्या मैं ${rawName} से बात कर रहा हूँ? नमस्ते ${rawName}, मैं ${orgHi} से रेमो बोल रहा हूँ। क्या अभी बात करने के लिए सही समय है?`;
                    return `Hello, am I speaking with ${rawName}? Hi ${rawName}, this is Remo calling from ${orgEn} regarding your ${product} service inquiry. Is now a convenient time to speak?`;
                }
                if (lang === 'te') return `నమస్కారం, నేను ${orgTe} నుండి రెమో మాట్లాడుతున్నాను. ఇప్పుడు మాట్లాడటానికి మీకు అనుకూలమేనా?`;
                if (lang === 'hi') return `नमस्ते, मैं ${orgHi} से रेमो बोल रहा हूँ। क्या अभी बात करने के लिए सही समय है?`;
                return `Hello, this is Remo calling from ${orgEn} regarding your ${product} service inquiry. Is now a convenient time to speak?`;
            }

            if (isValidName) {
                if (lang === 'te') return `నమస్కారం, నేను ${rawName} గారితో మాట్లాడుతున్నానా? నమస్తే ${rawName}, నేను ${orgTe} నుండి రెమో మాట్లాడుతున్నాను. ఇప్పుడు మాట్లాడటానికి మీకు అనుకూలమేనా?`;
                if (lang === 'hi') return `नमस्ते, क्या मैं ${rawName} से बात कर रहा हूँ? नमस्ते ${rawName}, मैं ${orgHi} से रेमो बोल रहा हूँ। क्या अभी बात करने का सही समय है?`;
                return `Hello, am I speaking with ${rawName}? Hi ${rawName}, this is Remo calling from ${orgEn}. I'm following up regarding your recent support inquiry or service ticket. Is now a convenient time to speak?`;
            }
            if (lang === 'te') return `నమస్కారం, నేను ${orgTe} నుండి రెమో మాట్లాడుతున్నాను. ఇప్పుడు మాట్లాడటానికి మీకు అనుకూలమేనా?`;
            if (lang === 'hi') return `नमस्ते, मैं ${orgHi} से रेमो बोल रहा हूँ। क्या अभी बात करने के लिए सही समय है?`;
            return `Hello, this is Remo calling from ${orgEn}. I'm following up regarding your recent support inquiry or service ticket. Is now a convenient time to speak?`;
        }

        // Appointment setting: books a visit, meeting or slot (outgoing reminders/bookings and incoming booking requests)
        if (s === 'appointment') {
            // Only a company the document (or the contact sheet) gives is named; there is no built-in company.
            const company = String(ctx.company_name || safeContact.company || '').trim();
            const fc = (l) => GreetingScript.fromCompany(company, l);
            if (safeContact.direction === 'inbound') {
                if (lang === 'te') return `${company ? `${company}కి ` : ''}కాల్ చేసినందుకు ధన్యవాదాలు, నేను రెమో. నేను మీకు అపాయింట్‌మెంట్ బుక్ చేయడంలో సహాయపడగలను. మీరు ఏ రోజు బుక్ చేయాలనుకుంటున్నారు?`;
                if (lang === 'hi') return `${company ? `${company} में ` : ''}कॉल करने के लिए धन्यवाद, मैं रेमो हूँ। मैं अपॉइंटमेंट बुक करने में आपकी मदद कर सकता हूँ। आप किस दिन के लिए बुक करना चाहते हैं?`;
                return `Thank you for calling${company ? ` ${company}` : ''}, this is Remo. I can help you book an appointment. What would you like to book, and for which day?`;
            }
            if (ctx.opening_greeting && typeof ctx.opening_greeting === 'string' && ctx.opening_greeting.length > 15) {
                const docGreeting = ctx.opening_greeting.trim();
                return isValidName && !docGreeting.includes(rawName) ? `Hello, am I speaking with ${rawName}? ${docGreeting}` : docGreeting;
            }
            if (isValidName) {
                if (lang === 'te') return `నమస్కారం, నేను ${rawName} గారితో మాట్లాడుతున్నానా? నేను${fc('te')} రెమో మాట్లాడుతున్నాను. అపాయింట్‌మెంట్ బుక్ చేయడానికి ఇది మంచి సమయమేనా?`;
                if (lang === 'hi') return `नमस्ते, क्या मैं ${rawName} से बात कर रहा हूँ? मैं${fc('hi')} रेमो बोल रहा हूँ। क्या अभी बात करने के लिए सही समय है?`;
                return `Hello, am I speaking with ${rawName}? This is Remo calling${fc('en')} to help you book your appointment. Is now a good time to talk?`;
            }
            if (lang === 'te') return `నమస్కారం, నేను${fc('te')} రెమో మాట్లాడుతున్నాను. అపాయింట్‌మెంట్ బుక్ చేయడానికి ఇది మంచి సమయమేనా?`;
            if (lang === 'hi') return `नमस्ते, मैं${fc('hi')} रेमो बोल रहा हूँ। क्या अपॉइंटमेंट बुक करने के लिए अभी सही समय है?`;
            return `Hello, this is Remo calling${fc('en')} to help you book an appointment. Is now a good time to talk?`;
        }

        // Receptionist: answers the line, handles questions, takes messages and routes requests
        if (s === 'receptionist') {
            const company = String(ctx.company_name || safeContact.company || '').trim();
            if (safeContact.direction === 'outbound') {
                if (ctx.opening_greeting && typeof ctx.opening_greeting === 'string' && ctx.opening_greeting.length > 15) {
                    return ctx.opening_greeting.trim();
                }
                if (lang === 'te') return `నమస్తే, నేను ${company ? `${company} ` : ''}ఫ్రంట్ డెస్క్ నుండి రెమో మాట్లాడుతున్నాను. ఇప్పుడు మాట్లాడటానికి మంచి సమయమేనా?`;
                if (lang === 'hi') return `नमस्ते, मैं ${company ? `${company} ` : ''}फ्रंट डेस्क से रेमो बोल रहा हूँ। क्या अभी बात करने का सही समय है?`;
                return `Hello, this is Remo from the ${company ? `${company} ` : ''}front desk, following up on your enquiry. Is now a good time to talk?`;
            }
            if (lang === 'te') return `${company ? `${company}కి ` : ''}కాల్ చేసినందుకు ధన్యవాదాలు, నేను రెమో. నేను మీకు ఎలా సహాయపడగలను?`;
            if (lang === 'hi') return `${company ? `${company} में ` : ''}कॉल करने के लिए धन्यवाद, मैं रेमो हूँ। मैं आज आपकी क्या सहायता कर सकता हूँ?`;
            return `Thank you for calling${company ? ` ${company}` : ''}, this is Remo. How may I help you today?`;
        }

        // Recruitment: ask for the candidate by name first (only when the name is known and verified); after they
        // confirm, Remo introduces itself and asks if it is a good time. With no verified name, Remo introduces itself directly.
        if (isValidName) {
            return GreetingScript.identityQuestion(rawName, lang);
        }
        return GreetingScript.recruitmentIntro(lang, safeContact.job_role, safeContact.company);
    }

    /**
     * The facts from an appointment-setting / receptionist campaign document, as lines for the AI prompt.
     * Returns '' when the campaign has no document.
     */
    static businessKnowledge(ctx = {}, policyKey = 'booking_rules', policyLabel = 'Rules') {
        const lines = [];
        const list = (v) => (Array.isArray(v) ? v.filter(Boolean).map(x => (typeof x === 'string' ? x : (x.name || JSON.stringify(x)))).join('; ') : '');
        if (ctx.business_type) lines.push(`- Business: ${ctx.business_type}`);
        const services = list(ctx.services_offered);
        if (services) lines.push(`- Services offered: ${services}`);
        if (ctx.working_hours) lines.push(`- Working hours: ${ctx.working_hours}`);
        if (ctx.location) lines.push(`- Location: ${ctx.location}`);
        if (ctx[policyKey]) lines.push(`- ${policyLabel}: ${ctx[policyKey]}`);
        if (Array.isArray(ctx.departments_and_contacts) && ctx.departments_and_contacts.length) {
            lines.push(`- Departments / contacts: ${JSON.stringify(ctx.departments_and_contacts.slice(0, 6))}`);
        }
        if (Array.isArray(ctx.approved_faqs) && ctx.approved_faqs.length) {
            lines.push(`- Approved FAQs (use these exact answers): ${JSON.stringify(ctx.approved_faqs.slice(0, 6))}`);
        }
        return lines.length ? `\n${lines.join('\n')}` : '';
    }

    /** The outcome label used until the AI reports a real one. */
    static defaultClassification(service = 'recruitment') {
        const s = String(service || '').toLowerCase();
        if (s === 'sales') return 'Interested';
        if (s === 'appointment') return 'Pending';
        if (s === 'receptionist') return 'Enquiry';
        return 'On Hold';
    }

    /**
     * The prompt block built from the system's own record of the call: which topics were asked and answered,
     * the question still open, and what kind of turn the caller just took. Empty when there is nothing to say.
     */
    static buildQuestionBlock(qs) {
        if (!qs || typeof qs !== 'object') return '';
        const asked = Array.isArray(qs.askedTopics) ? qs.askedTopics : [];
        const answered = Array.isArray(qs.answeredTopics) ? qs.answeredTopics : [];
        const lines = ['QUESTION TRACKER (kept by the system; trust it over your own memory):'];
        if (qs.callStage) lines.push(`- Call phase: ${qs.callStage}`);
        if (answered.includes('permission')) lines.push('- The caller has already agreed to talk. NEVER ask again whether it is a good time.');
        if (asked.length) lines.push(`- Topics already asked: ${asked.join(', ')}`);
        if (answered.length) lines.push(`- Topics already ANSWERED (never ask about them again, not even reworded): ${answered.join(', ')}`);
        if (qs.openQuestion) lines.push(`- Question currently open: "${qs.openQuestion}"`);
        if (qs.nextPlanned) lines.push(`- Next planned question not yet asked: "${qs.nextPlanned}"`);
        if (qs.turnKind === 'clarification') {
            lines.push('- The caller asked for clarification. Explain the open question in simpler words and stop. Do NOT move to a new topic.');
        } else if (qs.turnKind === 'continuation') {
            lines.push('- The caller said something like "go on" or "and then?". Continue naturally from the open question. This is NOT an answer.');
        }
        lines.push('- Keep acknowledgements short and varied. Do not begin two replies in a row with the same word ("Of course", "Sure", "Absolutely").');
        return lines.length > 2 ? lines.join('\n') : '';
    }

    static getUniversalFallback(lang = 'en', service = 'recruitment', stage = null) {
        const l = (lang || 'en').toLowerCase();
        const s = (service || 'recruitment').toLowerCase();
        const st = (stage || '').toUpperCase();

        if (s === 'appointment') {
            // Ask for the detail the call is actually on, not always the day.
            const byStage = {
                PURPOSE: [
                    "I can help you book an appointment. What would you like to book?",
                    "मैं आपकी अपॉइंटमेंट बुक करने में मदद कर सकता हूँ। आप क्या बुक करना चाहेंगे?",
                    "నేను మీ అపాయింట్‌మెంట్ బుక్ చేయడంలో సహాయం చేయగలను. మీరు దేని కోసం బుక్ చేయాలనుకుంటున్నారు?"
                ],
                PREFERRED_DATE: [
                    "Sorry, which day would suit you best?",
                    "माफ़ कीजिए, आपके लिए कौन सा दिन सुविधाजनक रहेगा?",
                    "క్షమించండి, మీకు ఏ రోజు అనుకూలంగా ఉంటుంది?"
                ],
                PREFERRED_TIME: [
                    "Sorry, what time would work for you?",
                    "माफ़ कीजिए, आपके लिए कौन सा समय सुविधाजनक रहेगा?",
                    "క్షమించండి, మీకు ఏ సమయం అనుకూలంగా ఉంటుంది?"
                ],
                CONTACT_DETAILS: [
                    "Sorry, could I have your name for the booking?",
                    "माफ़ कीजिए, बुकिंग के लिए आपका नाम क्या है?",
                    "క్షమించండి, బుకింగ్ కోసం మీ పేరు చెప్పగలరా?"
                ],
                CONFIRMATION: [
                    "Sorry, could you confirm those booking details are correct?",
                    "माफ़ कीजिए, क्या बुकिंग की ये जानकारी सही है?",
                    "క్షమించండి, ఈ బుకింగ్ వివరాలు సరైనవేనా?"
                ],
                CLOSING: [
                    "Thank you. Our team will confirm your appointment shortly.",
                    "धन्यवाद। हमारी टीम जल्द ही आपकी अपॉइंटमेंट की पुष्टि करेगी।",
                    "ధన్యవాదాలు. మా బృందం త్వరలో మీ అపాయింట్‌మెంట్‌ను నిర్ధారిస్తుంది."
                ]
            };
            const pick = byStage[st];
            if (pick) return l === 'hi' ? pick[1] : (l === 'te' ? pick[2] : pick[0]);
            if (l === 'hi') return "मैं आपकी अपॉइंटमेंट बुक करने में मदद कर सकता हूँ। आपके लिए कौन सा दिन और समय सुविधाजनक रहेगा?";
            if (l === 'te') return "నేను మీ అపాయింట్‌మెంట్ బుక్ చేయడంలో సహాయం చేయగలను. మీకు ఏ రోజు మరియు సమయం అనుకూలంగా ఉంటుంది?";
            return "I can help you book an appointment. Which day and time would suit you best?";
        }

        if (s === 'receptionist') {
            if (l === 'hi') return "माफ़ कीजिए, मुझे यह जानकारी अभी उपलब्ध नहीं है, लेकिन मैं आपका संदेश हमारी टीम तक पहुँचा दूँगा। क्या मैं आपका नाम और नंबर ले सकता हूँ?";
            if (l === 'te') return "క్షమించండి, ప్రస్తుతం నా వద్ద ఆ సమాచారం లేదు, కానీ మీ సందేశాన్ని మా బృందానికి చేరవేస్తాను. మీ పేరు మరియు నంబర్ చెప్పగలరా?";
            return "I'm sorry, I don't have that information in front of me, but I'll pass your message to our team. May I take your name and number?";
        }

        if (s === 'sales') {
            if (st === 'PERMISSION_CHECK' || st === 'AVAILABILITY') {
                if (l === 'hi') return "धन्यवाद! मैं बस यह जानना चाहता था कि क्या आप वर्तमान में किसी ऐसी सेवा की तलाश में हैं जिसमें हम मदद कर सकें?";
                if (l === 'te') return "ధన్యవాదాలు! మేము సహాయపడగల ఏవైనా సేవల కోసం మీరు ప్రస్తుతం చూస్తున్నారా అని తెలుసుకోవాలనుకుంటున్నాను?";
                return "Thank you! I just wanted to check if you're currently looking for any services that we could help you with?";
            }

            if (st === 'INTEREST_DISCOVERY' || st === 'SERVICE_INTEREST') {
                if (l === 'hi') return "बहुत अच्छा! क्या आप थोड़ा बता सकते हैं कि आप किस प्रकार की सेवा की तलाश में हैं?";
                if (l === 'te') return "చాలా మంచిది! మీరు ఎలాంటి సేవల కోసం చూస్తున్నారో కాస్త చెప్పగలరా?";
                return "Great! Could you tell me a little about what you're looking for?";
            }

            if (st === 'QUALIFICATION' || st === 'SERVICE_DISCOVERY') {
                if (l === 'hi') return "समझ गया। क्या आप अपने प्रोजेक्ट की समय सीमा या मुख्य आवश्यकताओं के बारे में बता सकते हैं?";
                if (l === 'te') return "అర్థమైంది. మీ ప్రాజెక్ట్ సమయపరిమితి లేదా ముఖ్య అవసరాల గురించి చెప్పగలరా?";
                return "Understood. Could you share your expected project timeline or key requirements?";
            }

            if (st === 'CALLBACK_TIME') {
                if (l === 'hi') return "समझ गया। हमारी टीम के लिए आपसे दोबारा संपर्क करने का कौन सा समय सुविधाजनक रहेगा?";
                if (l === 'te') return "అర్థమైంది. మా బృందం మిమ్మల్ని మళ్లీ సంప్రదించడానికి ఏ సమయం అనుకూలంగా ఉంటుంది?";
                return "Understood. When would be a convenient time for our team to follow up?";
            }

            if (st === 'CLOSING') {
                if (l === 'hi') return "आपके समय के लिए धन्यवाद। आपका दिन शुभ हो!";
                if (l === 'te') return "మీ సమయానికి ధన్యవాదాలు. మంచి రోజవుగాక!";
                return "Thank you for your time. Have a wonderful day!";
            }

            if (l === 'hi') return "माफ़ कीजिए, मैं ठीक से समझ नहीं पाया। क्या आप थोड़ा और बता सकते हैं कि आप क्या तलाश रहे हैं?";
            if (l === 'te') return "క్షమించండి, నాకు సరిగ్గా అర్థం కాలేదు. మీరు ఏమి కోసం చూస్తున్నారో కాస్త ఎక్కువగా చెప్పగలరా?";
            return "I'm sorry, I didn't quite catch that. Could you tell me a little more about what you are looking for?";
        }

        if (s === 'recruitment') {
            if (l === 'hi') return "मैं आपकी नौकरी के आवेदन के संबंध में बात कर रहा हूँ। क्या आप अपने अनुभव के बारे में संक्षेप में बता सकते हैं?";
            if (l === 'te') return "నేను మీ జాబ్ అప్లికేషన్ గురించి మాట్లాడుతున్నాను. మీ అనుభవం గురించి క్లుప్తంగా చెప్పగలరా?";
            return "I'm calling regarding your application for the open role. Could you briefly tell me about your background and recent experience?";
        }

        if (s === 'support') {
            if (l === 'hi') return "मैं कस्टमर सपोर्ट से बात कर रहा हूँ। क्या आप अपनी समस्या के बारे में विस्तार से बता सकते हैं?";
            if (l === 'te') return "నేను కస్టమర్ సపోర్ట్ నుండి మాట్లాడుతున్నాను. మీ సమస్య గురించి కాస్త వివరంగా చెప్పగలరా?";
            return "I'm calling from customer support. Could you please share a few more details about the issue you are experiencing so I can assist you?";
        }

        return FALLBACK_TEXT[l] || FALLBACK_TEXT['en'];
    }

    /**
     * Validates and selects primary model with bounded safe fallback.
     */
    static selectBestModel() {
        const raw = (process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite').replace('models/', '').trim();
        if (raw && raw.startsWith('gemini-') && !raw.includes('unsupported') && !raw.includes('hallucinated')) {
            return { name: raw };
        }
        return { name: 'gemini-3.1-flash-lite', isFallback: true };
    }

    /**
     * Parses raw model output safely, with recovery for partial/malformed JSON.
     */
    static parseModelResponse(rawText, lang = 'en', service = 'recruitment', stage = null) {
        if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
            return {
                spoken_response: this.getUniversalFallback(lang, service, stage),
                detected_language: lang,
                should_end_call: false,
                extracted_fields: {},
                classification: this.defaultClassification(service),
                call_summary: 'Universal fallback delivered (empty model response).'
            };
        }

        try {
            const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanJson);
            const cleanedExtracted = {};
            if (parsed.extracted_fields && typeof parsed.extracted_fields === 'object') {
                for (const [k, v] of Object.entries(parsed.extracted_fields)) {
                    if (v !== null && v !== undefined && String(v).trim() !== '' && String(v).toLowerCase() !== 'null') {
                        cleanedExtracted[k] = v;
                    }
                }
            }

            return {
                spoken_response: parsed.spoken_response ? String(parsed.spoken_response).trim() : this.getUniversalFallback(lang, service, stage),
                detected_language: ['en', 'hi', 'te'].includes(parsed.detected_language) ? parsed.detected_language : lang,
                should_end_call: Boolean(parsed.should_end_call),
                extracted_fields: cleanedExtracted,
                classification: parsed.classification || this.defaultClassification(service),
                call_summary: parsed.call_summary || 'Dialogue processed successfully.',
                next_stage: parsed.next_stage || null
            };
        } catch (e) {
            // Resilient regex recovery for broken JSON
            const spokenMatch = rawText.match(/"spoken_response"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
            const langMatch = rawText.match(/"detected_language"\s*:\s*"([^"]+)"/i);
            const endMatch = rawText.match(/"should_end_call"\s*:\s*(true|false)/i);
            const classMatch = rawText.match(/"classification"\s*:\s*"([^"]+)"/i);
            const stageMatch = rawText.match(/"next_stage"\s*:\s*"([^"]+)"/i);

            return {
                spoken_response: spokenMatch ? spokenMatch[1].replace(/\\"/g, '"').trim() : this.getUniversalFallback(lang, service, stage),
                detected_language: langMatch && ['en', 'hi', 'te'].includes(langMatch[1]) ? langMatch[1] : lang,
                should_end_call: endMatch ? endMatch[1].toLowerCase() === 'true' : false,
                extracted_fields: {},
                classification: classMatch ? classMatch[1] : this.defaultClassification(service),
                call_summary: 'Recovered from malformed JSON model response.',
                next_stage: stageMatch ? stageMatch[1] : null
            };
        }
    }

    /**
     * Generates real-time conversational response with bounded latency and strict timeout.
     * Uses Claude Haiku as Primary model, and Gemini Flash as automatic failover.
     */
    static async generateReply(
        service = 'recruitment',
        contactInfo = {},
        conversationHistory = [],
        callerMessage = null,
        collectedData = {},
        options = {}
    ) {
        const lang = options.detectedLanguage || contactInfo.preferred_language || 'en';

        // Fast-path: First turn without message returns deterministic greeting instantly
        if ((!conversationHistory || conversationHistory.length === 0) && !callerMessage) {
            return {
                spoken_response: this.getOpeningGreeting(service, contactInfo),
                detected_language: lang,
                should_end_call: false,
                extracted_fields: {},
                classification: this.defaultClassification(service),
                call_summary: 'Call initiated. Opening greeting delivered.',
                model_used: 'deterministic_first_turn',
                next_stage: (service === 'sales' && contactInfo.name && !String(contactInfo.name).startsWith('Contact')) ? 'GREETING' : (service === 'sales' ? 'PERMISSION_CHECK' : 'AVAILABILITY')
            };
        }

        // Build campaign and role-specific context
        const jdCriteria = options.campaignContext || contactInfo.campaignContext || contactInfo.jdCriteria || {};
        const role = jdCriteria.job_title || contactInfo.job_role || contactInfo.role || 'the open position';
        const requiredSkills = jdCriteria.required_skills ? (Array.isArray(jdCriteria.required_skills) ? jdCriteria.required_skills.join(', ') : jdCriteria.required_skills) : '';
        const minExp = jdCriteria.min_experience_years || jdCriteria.min_experience || '';
        const questionPlan = options.questionPlan || null;
        const memoryState = options.memoryState || null;

        // Multi-agent: each agent can have its own name and standing instructions from the account owner.
        // When an agent has instructions they decide who we represent and what we say about the business;
        // the built-in sample offerings and pitch lines below are only used when it has none.
        // No company name is built in: only the campaign document or the agent instructions give one.
        const agentName = String(options.agentName || '').trim();
        const agentInstructions = String(options.agentInstructions || '').trim();
        const hasAgentScript = Boolean(agentInstructions);
        const AGENT_COMPANY = hasAgentScript
            ? 'the company named in the agent instructions'
            : 'no company name (none was given, so never name or invent one)';

        // Service-specific guidance
        let serviceInstructions = "";
        let classificationOptions = "";

        if (service === 'sales') {
            classificationOptions = `"Interested" | "Meeting Requested" | "Email Requested" | "Callback Requested" | "Not Interested" | "Wrong Contact" | "Do Not Call"`;
            const prodName = jdCriteria.product_name || (hasAgentScript ? 'the offering described in the agent instructions' : 'IT Solutions & Custom Software');
            const compName = jdCriteria.company_name || AGENT_COMPANY;
            const valueProps = Array.isArray(jdCriteria.value_propositions) && jdCriteria.value_propositions.length ? jdCriteria.value_propositions.join('; ') : '';
            const keyFeatures = Array.isArray(jdCriteria.key_features) && jdCriteria.key_features.length ? jdCriteria.key_features.join('; ') : '';
            const pricing = jdCriteria.pricing_summary || '';
            const cta = jdCriteria.call_to_action || (hasAgentScript ? 'the next step set out in the agent instructions' : 'schedule a quick 15-minute introductory call');
            const faqs = Array.isArray(jdCriteria.approved_faqs) && jdCriteria.approved_faqs.length ? JSON.stringify(jdCriteria.approved_faqs.slice(0, 4)) : '';
            const objections = Array.isArray(jdCriteria.objections_and_counters) && jdCriteria.objections_and_counters.length ? JSON.stringify(jdCriteria.objections_and_counters.slice(0, 3)) : '';

            const defaultOfferings = hasAgentScript
                ? 'only what the agent instructions say you offer'
                : "web development, custom software development, and digital solutions";
            const approvedOfferings = keyFeatures || valueProps || defaultOfferings;

            // Sample wording below is the built-in default pitch; an agent with instructions speaks from those instead.
            const interestStep = hasAgentScript
                ? 'follow the agent instructions for what to say and ask next'
                : '"Great, thanks! I just wanted to ask — are you currently looking for any IT or digital marketing services?"';
            const whoAreYouStep = hasAgentScript
                ? 'answer in one short sentence from the agent instructions, then ask the next question from them'
                : '"We help businesses with software development and digital marketing. Is there anything in those areas you\'re exploring?"';
            const interestedStep = hasAgentScript
                ? 'continue with the next step of the agent instructions -> next_stage: "QUALIFICATION".'
                : '"Sure! What kind of service are you looking for?" -> next_stage: "QUALIFICATION".';
            const servicesStep = hasAgentScript
                ? 'Mention only what the agent instructions say you offer, then ask which matters most to them -> next_stage: "SERVICE_DISCOVERY".'
                : 'Mention only 2-3 relevant services: "We help with website and software development, mobile apps, and digital marketing. Which of these would be most useful to you?" -> next_stage: "SERVICE_DISCOVERY".';

            serviceInstructions = `
### SALES WORKFLOW (${compName} — Offering: ${prodName}):
- Company: "${compName}" | Offering: "${prodName}".
- Approved Offerings/Features: ${approvedOfferings}.
${pricing ? `- Pricing/Plans: ${pricing}` : ''}
${cta ? `- Primary Objective / CTA: ${cta}` : ''}
${faqs ? `- Approved FAQs from Document: ${faqs}` : ''}
${objections ? `- Objection Handling from Document: ${objections}` : ''}

${SalesState.buildPromptBlock(collectedData, options.salesTracker)}

CONVERSATION FLOW & STAGE PROGRESSION:
1. GREETING: Remo introduced himself and verified contact's name ("Hello, am I speaking with Priya?") or gave natural opening ("Hi, this is Remo calling from ${compName}. Is now a good time to talk?").
   - If contact confirms ("Yes", "Speaking"): Transition to PERMISSION_CHECK: "Hi [Name], this is Remo calling from ${compName}. Is now a good time to talk?"
   - If contact says no/wrong person: Apologize politely and end call (should_end_call: true, next_stage: "CLOSING").
2. PERMISSION_CHECK:
   - If contact agrees ("yes", "sure", "go ahead"): Transition to INTEREST_DISCOVERY: ${interestStep}
   - If contact is busy / driving / in a meeting: "Of course. Would another time be better?" -> next_stage: "CALLBACK_TIME".
   - If contact asks what ${compName} does or who is calling: ${whoAreYouStep}
   - If unclear: Ask one short clarifying question instead of repeating the pitch.
   - CRITICAL: DO NOT pitch or list services during PERMISSION_CHECK.
3. INTEREST_DISCOVERY:
   - If interested ("Yes, we need an app", "Yes", "Sure"): ${interestedStep}
   - If caller asks what services are offered or expresses general interest: ${servicesStep}
   - If not interested ("No", "not looking", "not interested"): "No problem at all. Thanks for your time. Have a great day!" (should_end_call: true, next_stage: "CLOSING").
   - If already using another provider: Acknowledge politely without pressure: "Understood! Would you be open to exploring an alternative or keeping our details for future needs?"
   - If callback requested: Ask for a convenient callback time -> next_stage: "CALLBACK_TIME".
   - NEVER repeat the same interest question if the caller already answered.
4. SERVICE_DISCOVERY & QUALIFICATION:
   - Explain ONLY the specific service of interest conversationally using facts from the document above.
   - Ask ONE question at a time about requirements, timeline, or scope.
   - Do NOT turn the call into a rigid questionnaire or recite the whole document.
5. NEXT_STEP (MEETING PREFERENCE), after the discovery questions:
   - Ask exactly once: "${SalesState.meetingQuestion('en')}" Then wait for the answer.
   - The system records the answer (phone call, in person, either, undecided or declined). Never record or guess it yourself.
   - After a clear answer say our team will reach out to coordinate and share the details, thank them and end the call. If they decline: "No problem", and our team can reconnect in the future.
   - Only if the answer is unclear, ask ONE short clarification. Never ask the question twice. Offer to email company info only if the caller asks for it.
6. CALLBACK_TIME:
   - If caller gives time/day: Acknowledge, record in extracted_fields.callback_time, thank caller, set should_end_call: true, next_stage: "CLOSING".
7. CLOSING:
   - Warm, polite telephone farewell. Set should_end_call: true.

STRICT GROUNDING & TURN-TAKING RULES:
1. STRICTLY ONE SHORT TURN AT A TIME (1-2 sentences, under 20 words).
2. Ask NO MORE THAN ONE primary question per turn.
3. STOP speaking immediately after asking and wait for caller's answer.
4. Base all information EXCLUSIVELY on the verified document facts above${hasAgentScript ? ' and the agent instructions' : ''}. NEVER invent services, prices, discounts, or guarantees not in the document.
5. If caller asks something not covered in the document: say "I don't have that detail right in front of me, but our team can follow up with exact information."
6. NEVER concatenate greeting, permission, interest question, and service list into a single turn!`;
        } else if (service === 'appointment') {
            classificationOptions = `"Appointment Booked" | "Reschedule Requested" | "Cancelled" | "Callback Requested" | "Not Interested" | "Wrong Contact" | "Do Not Call"`;
            const compName = jdCriteria.company_name || (hasAgentScript ? AGENT_COMPANY : (contactInfo.company || AGENT_COMPANY));
            const knowledge = this.businessKnowledge(jdCriteria, 'booking_rules', 'Booking rules');
            serviceInstructions = `
### APPOINTMENT SETTING WORKFLOW (${compName}):${knowledge}
- Goal: book, reschedule or cancel an appointment with ${compName}.
${AppointmentState.buildPromptBlock(collectedData, options.appointmentTracker)}
- Collect ONE detail at a time: what the appointment is for, the preferred day, the preferred time, then the caller's name. Never re-ask what is already collected.
- Every turn, put EVERY booking detail you know (new and earlier ones) in extracted_fields, so nothing is forgotten.
- If the caller already gave several details in one message, record them all and ask only for what is still missing.
- If the caller asks who you are or your name, answer in a few words ("I'm Remo from ${compName}") and go straight back to the next missing detail. Do not treat that as their name.
- The caller's name may already be known from the contact list; if caller_name is under Collected, never ask for it again. Ask for an email at most once, and only after the booking is confirmed.
- You cannot see a live calendar. Take their preferred slot (offer to note a second choice) and say the team will confirm it by message or call. Never promise a slot is locked in.
- Before closing, repeat the details back once ("So that's Friday at 4 PM, correct?"). Only after they agree, classify "Appointment Booked".
- Put what you learn in extracted_fields: appointment_purpose, preferred_date, preferred_time, caller_name, email.
- Rescheduling -> "Reschedule Requested"; cancelling -> "Cancelled"; busy now -> "Callback Requested" and ask for a better time.
- If they decline politely, thank them and end the call. Never pressure.
- STRICT: never invent services, prices, doctor/staff names or opening hours that you were not given.`;
        } else if (service === 'receptionist') {
            classificationOptions = `"Query Answered" | "Message Taken" | "Appointment Requested" | "Callback Requested" | "Wrong Number"`;
            const compName = jdCriteria.company_name || (hasAgentScript ? AGENT_COMPANY : (contactInfo.company || AGENT_COMPANY));
            const knowledge = this.businessKnowledge(jdCriteria, 'message_policy', 'Message policy');
            serviceInstructions = `
### RECEPTIONIST WORKFLOW (front desk of ${compName}):${knowledge}
- You are the front desk. Find out who is calling and why, then help.
- Answer questions ONLY from the agent instructions above. Never invent opening hours, prices, names or policies. If you do not know: "I'll pass that to our team", then take a message.
- To take a message collect, one at a time: caller_name, callback_number, reason_for_call, best_time_to_call (put them in extracted_fields). Read the number back once to confirm.
- If they want to book a visit or meeting, collect preferred_date and preferred_time and classify "Appointment Requested".
- You cannot transfer the call to a person. Offer a callback or take a message instead.
- Be brief and friendly; end the call politely once their need is handled.`;
        } else if (service === 'recruitment') {
            classificationOptions = `"Selected" | "Rejected" | "On Hold"`;
            serviceInstructions = `
### RECRUITMENT INTERVIEW WORKFLOW:
You are Remo, a professional and patient AI recruitment interviewer.
Your primary responsibility is to understand the candidate's complete answers before asking another question.

- Target Role: "${role}". ${requiredSkills ? `Required Skills: ${requiredSkills}.` : ''} ${minExp ? `Min Exp: ${minExp}+ yrs.` : ''}
- Question Progression: Availability -> Total Experience -> Key Technical Skills / Frameworks -> Current Notice Period / Joining Date -> Work Mode / Location.
- Wrap-up: Before closing, ask if the candidate has any questions for you.
- Classification: "Selected" (meets skills/exp with concrete specifics), "Rejected" (explicit refusal/lacks mandatory skills), "On Hold" (incomplete/short answers).

LISTENING RULES:
- Never interrupt a candidate merely because they pause briefly while thinking.
- Never ask the next interview question while the candidate is still speaking.
- Allow candidates to explain their experience naturally, including longer answers.
- Do not assume that a sentence is complete because it contains a full stop or because a short silence occurred.
- Do not interrupt the candidate to acknowledge, summarize, evaluate, or ask a follow-up while their answer is still in progress.
- If the candidate pauses and then continues, treat the speech as part of the same answer when it belongs to the same turn.
- Wait until the audio-processing system confirms that the candidate's turn has ended and the transcript is finalized.
- After the answer is finalized, understand its meaning and respond naturally.
- Ask the next configured recruitment question only after the current answer has been fully processed.
- Ask a relevant clarification question when necessary, but do not repeatedly ask questions the candidate has already answered.
- Never invent missing candidate information.
- Never skip an unanswered question because of an incomplete transcript.
- If the audio or transcription is unclear, politely ask the candidate to repeat or clarify the relevant part.
- Maintain a professional, friendly, natural, and patient tone.

The audio system determines when the candidate has finished speaking. Do not attempt to determine this using the language model's reasoning alone.`;
        } else {
            classificationOptions = `"RESOLVED" | "ESCALATED" | "PENDING_INFO" | "Wrong Contact"`;
            const compName = jdCriteria.company_name || AGENT_COMPANY;
            const prodName = jdCriteria.product_name || 'Customer Support';
            const topics = Array.isArray(jdCriteria.supported_topics) && jdCriteria.supported_topics.length ? jdCriteria.supported_topics.join(', ') : '';
            const troubleshooting = Array.isArray(jdCriteria.troubleshooting_steps) && jdCriteria.troubleshooting_steps.length ? JSON.stringify(jdCriteria.troubleshooting_steps.slice(0, 3)) : '';
            const faqs = Array.isArray(jdCriteria.approved_faqs) && jdCriteria.approved_faqs.length ? JSON.stringify(jdCriteria.approved_faqs.slice(0, 4)) : '';
            const refundPolicy = jdCriteria.refund_and_cancellation_policy || '';
            const escalationPolicy = jdCriteria.escalation_policy || 'If issue is unresolved after diagnostic steps, log high-priority ticket and offer a callback.';

            serviceInstructions = `
### CUSTOMER SUPPORT WORKFLOW (${compName} — Product: ${prodName}):
- Support Domain: "${prodName}" by "${compName}".
${topics ? `- Supported Topics: ${topics}` : ''}
${troubleshooting ? `- Troubleshooting Procedures: ${troubleshooting}` : ''}
${faqs ? `- Approved FAQs: ${faqs}` : ''}
${refundPolicy ? `- Refund / Cancellation Policy: ${refundPolicy}` : ''}
${escalationPolicy ? `- Escalation Policy: ${escalationPolicy}` : ''}
- Conversation Flow:
  1. Introduce the agent briefly:
     - "Hi, this is Remo from ${compName} customer support. How can I help you today?"
  2. Ask what issue the customer needs help with.
  3. Listen to the response and address the actual issue using the document above.
  4. Ask relevant follow-up questions individually.
  5. Confirm whether the issue is resolved before ending the call:
     - "Has that resolved the issue for you?"
     - If yes: "Great! Glad I could help. Have a wonderful day!" and end call (should_end_call: true).
- STRICT GROUNDING RULES:
  1. First understand the customer's exact issue before offering a resolution.
  2. Guide the caller step-by-step through the troubleshooting procedures above.
  3. NEVER invent policies, refund promises, or technical fixes not in the document.
  4. If the issue cannot be resolved using the document, state: "I will escalate this to our technical support team for further assistance" and capture their details.
  5. Never pitch sales or recruitment.`;
        }

        const currentStage = options.currentStage || 'AVAILABILITY';
        const organizationName = jdCriteria.company_name || AGENT_COMPANY;

        const inboundNote = options.direction === 'inbound'
            ? '\nThis is an INCOMING call: the caller dialled us. Greet them, find out why they called and help; do not pitch or screen unless the instructions say so.'
            : '';
        const agentBlock = agentInstructions
            ? `\nAGENT INSTRUCTIONS${agentName ? ` ("${agentName}")` : ''} - HIGHEST PRIORITY. They set who you represent, what you say about the business, what you offer and what you ask. Never name a company unless these instructions or the campaign document name it. Wherever the workflow below has a company name, an offering, a product or sample wording, use these instructions instead and never speak the sample wording. The workflow below only supplies the mechanics: the JSON format, one short question per turn, the stages and ending the call.\n${agentInstructions}\n`
            : '';
        const agentReminder = agentInstructions
            ? '\nREMINDER: speak about the business only as the AGENT INSTRUCTIONS above say. Do not mention any company, product or service that is not in them or in the campaign document.\n'
            : '';

        const langMap = {
            'te': 'Telugu (తెలుగు)',
            'hi': 'Hindi (हिन्दी)',
            'ta': 'Tamil (தமிழ்)',
            'kn': 'Kannada (ಕನ್ನಡ)',
            'ml': 'Malayalam (മലയാളം)',
            'mr': 'Marathi (मराठी)',
            'en': 'Indian English'
        };
        const primaryLangName = langMap[lang] || 'Indian English';

        const systemPrompt = `You are ${agentName || 'Remo'}, a warm, professional, human-like AI Voice Agent representing ${organizationName}.
Mode: ${service.toUpperCase()} | Current Stage: ${currentStage} | Contact: ${contactInfo.name || 'Caller'} (${contactInfo.company || organizationName}) | Subject: ${role}${inboundNote}${agentBlock}

RULES:
1. Speak in natural telephone dialogue: strictly 1-2 short sentences (under 20 words).
2. Ask NO MORE THAN ONE question per turn.
3. Natural acknowledgments ("Got it", "Understood", "I see"). Do not repeat the same phrase.
4. PRIMARY LANGUAGE: ${primaryLangName}.
   - The selected primary language for this call is ${primaryLangName}.
   - You MUST formulate your spoken_response strictly in ${primaryLangName}${lang !== 'en' ? ' using its native script' : ''}.
   - Even if campaign document details, offerings, or questions are in English, converse naturally and accurately in ${primaryLangName}.
   - Do not invent facts, promises, or services; strictly adhere to the campaign document.
5. If caller pauses/thinks: "Sure, take your time."
${service === 'appointment'
    ? '6. NEVER repeat questions or the opening pitch. If caller agreed to speak (e.g. "Yeah it works for me", "Sure"), warmly acknowledge and ask for the first missing booking detail. If caller already answered, use their answer and ask for the next missing detail.'
    : `6. NEVER repeat questions or the opening pitch. If caller agreed to speak (e.g. "Yeah it works for me", "Sure"), warmly acknowledge and ${hasAgentScript ? 'continue with the next step of the agent instructions' : 'advance to INTEREST_DISCOVERY asking about their service needs'}. If caller already answered or stated their need, incorporate their answer and advance to the next logical stage.`}
${collectedData && Object.keys(collectedData).length > 0 ? `ALREADY COLLECTED (DO NOT RE-ASK): ${JSON.stringify(collectedData)}` : ''}
${questionPlan && Array.isArray(questionPlan) ? `QUESTION PLAN: ${questionPlan.slice(0, 5).map((q, idx) => `${idx + 1}. [${q.field_to_collect || q.target_field || q.category}]: "${q.text || q.question}"`).join(' | ')}` : ''}
${this.buildQuestionBlock(options.questionState)}
${serviceInstructions}
${agentReminder}
OUTPUT STRICT JSON ONLY:
{
  "spoken_response": "1-2 short sentences to speak out loud",
  "detected_language": "en" | "hi" | "te",
  "should_end_call": false | true,
  "extracted_fields": {},
  "classification": ${classificationOptions},
  "call_summary": "1 sentence summary",
  "next_stage": ${service === 'appointment'
    ? '"PURPOSE" | "PREFERRED_DATE" | "PREFERRED_TIME" | "CONTACT_DETAILS" | "CONFIRMATION" | "CLOSING"'
    : '"GREETING" | "PERMISSION_CHECK" | "INTEREST_DISCOVERY" | "SERVICE_DISCOVERY" | "QUALIFICATION" | "NEXT_STEP" | "CALLBACK_TIME" | "CLOSING"'}
}`;

        // Booking calls carry their own status block, but a longer window still helps the AI follow the thread.
        const recentHistory = (conversationHistory || []).slice(service === 'appointment' ? -16 : -8);
        const historyLines = recentHistory.map(m => `${m.speaker || 'Unknown'}: ${m.text || ''}`);
        if (callerMessage && (!recentHistory.length || recentHistory[recentHistory.length - 1].text !== callerMessage)) {
            historyLines.push(`Caller: ${callerMessage}`);
        }

        const userPrompt = `Conversation History:\n${historyLines.join('\n')}\n\nGenerate Remo's next spoken response as pure JSON.`;

        // Execute via LLMService (Claude Haiku primary with streaming & Gemini Flash fallback)
        // 260 maxTokens allows 1-2 complete spoken sentences + the full JSON envelope without truncation
        const maxTokens = service === 'appointment' ? 260 : 250;
        try {
            const llmRes = options.onSpokenSentence
                ? await LLMService.generateStream({
                    systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }],
                    maxTokens,
                    jsonMode: true,
                    timeoutMs: 6500,
                    onSpokenSentence: options.onSpokenSentence,
                    onToken: options.onToken
                })
                : await LLMService.generate({
                    systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }],
                    maxTokens,
                    jsonMode: true,
                    timeoutMs: 6500
                });

            if (llmRes && llmRes.text) {
                const parsed = this.parseModelResponse(llmRes.text, lang, service, currentStage);
                return {
                    ...parsed,
                    model_used: `${llmRes.provider}_${llmRes.model}`,
                    provider: llmRes.provider,
                    fallback: Boolean(llmRes.fallback),
                    fallbackReason: llmRes.fallbackReason || null,
                    firstTokenMs: llmRes.firstTokenMs || null,
                    emittedSentences: llmRes.emittedSentences || []
                };
            }
        } catch (llmErr) {
            console.warn('[GeminiService] LLMService invocation exception:', llmErr.message);
        }

        // Safe graceful fallback if all networks fail — stage aware
        return {
            spoken_response: this.getUniversalFallback(lang, service, currentStage),
            detected_language: lang,
            should_end_call: false,
            extracted_fields: {},
            classification: this.defaultClassification(service),
            call_summary: 'Temporary API latency; conversational fallback delivered.',
            model_used: 'graceful_fallback'
        };
    }
}
