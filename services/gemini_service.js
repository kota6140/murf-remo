import 'dotenv/config';
import LLMService from './llm_service.js';

const EXACT_GREETING = "Hey, it's Remo, representing Score Labs.";

const FALLBACK_TEXT = {
    'en': "I'm sorry, I don't have that information right now, but I'll make sure our team follows up with you directly.",
    'hi': "माफ़ कीजिए, मेरे पास अभी यह जानकारी उपलब्ध नहीं है, लेकिन हमारी टीम आपसे जल्द संपर्क करेगी।",
    'te': "నన్ను క్షమించండి, ప్రస్తుతం నా వద్ద ఆ సమాచారం లేదు, కానీ మా బృందం నేరుగా మిమ్మల్ని సంప్రదిస్తుంది."
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

        if (s === 'sales') {
            // Check if uploaded document provided a specific opening greeting
            if (ctx.opening_greeting && typeof ctx.opening_greeting === 'string' && ctx.opening_greeting.length > 15) {
                let docGreeting = ctx.opening_greeting.trim();
                if (isValidName && !docGreeting.includes(rawName)) {
                    docGreeting = `Hello, am I speaking with ${rawName}? ` + docGreeting;
                }
                return docGreeting;
            }

            const company = ctx.company_name || 'Scorelabs Inc.';
            const product = ctx.product_name || '';
            const valueProp = Array.isArray(ctx.value_propositions) && ctx.value_propositions.length ? ctx.value_propositions[0] : '';

            // Document-driven custom sales greeting
            if (product && !product.includes('Scorelabs IT') && !product.includes('Scorelabs AI Voice Automation')) {
                if (isValidName) {
                    return `Hello, am I speaking with ${rawName}? Hi ${rawName}, this is Remo calling on behalf of ${company}. We provide ${product}${valueProp ? ` — ${valueProp}` : ''}. I wanted to see if now is a good time for a quick conversation?`;
                }
                return `Hello, this is Remo calling on behalf of ${company}. We provide ${product}${valueProp ? ` — ${valueProp}` : ''}. I wanted to see if now is a good time for a quick conversation?`;
            }

            // Standard verified greeting for Scorelabs Inc.
            if (isValidName) {
                return `Hello, am I speaking with ${rawName}? Hi ${rawName}, this is Remo calling on behalf of Scorelabs Inc. We help businesses with IT solutions such as custom software development, website and mobile app development, ERP and CRM solutions, software testing, and technical support. I wanted to check whether your company is planning any new software projects or looking for an IT partner. Is now a convenient time for a quick conversation?`;
            }
            return `Hello, this is Remo calling on behalf of Scorelabs Inc. We help businesses with IT solutions such as custom software development, website and mobile app development, ERP and CRM solutions, software testing, and technical support. I wanted to check whether your company is planning any new software projects or looking for an IT partner. Is now a convenient time for a quick conversation?`;
        }

        if (s === 'support') {
            if (ctx.opening_greeting && typeof ctx.opening_greeting === 'string' && ctx.opening_greeting.length > 15) {
                let docGreeting = ctx.opening_greeting.trim();
                if (isValidName && !docGreeting.includes(rawName)) {
                    docGreeting = `Hello, am I speaking with ${rawName}? ` + docGreeting;
                }
                return docGreeting;
            }

            const company = ctx.company_name || 'Scorelabs Inc.';
            const product = ctx.product_name || '';

            // Document-driven custom support greeting
            if (product && !product.includes('Scorelabs') && !product.includes('TakeRemo')) {
                if (isValidName) {
                    return `Hello, am I speaking with ${rawName}? Hi ${rawName}, this is Remo calling from ${company} customer support regarding your ${product} service inquiry. Is now a convenient time to speak?`;
                }
                return `Hello, this is Remo calling from ${company} customer support regarding your ${product} service inquiry. Is now a convenient time to speak?`;
            }

            if (isValidName) {
                return `Hello, am I speaking with ${rawName}? Hi ${rawName}, this is Remo calling from Scorelabs Inc. customer support. I'm following up regarding your recent support inquiry or service ticket. Is now a convenient time to speak?`;
            }
            return `Hello, this is Remo calling from Scorelabs Inc. customer support. I'm following up regarding your recent support inquiry or service ticket. Is now a convenient time to speak?`;
        }

        // Appointment setting: books a visit, meeting or slot (outgoing reminders/bookings and incoming booking requests)
        if (s === 'appointment') {
            const company = ctx.company_name || safeContact.company || 'Score Labs';
            if (safeContact.direction === 'inbound') {
                return `Thank you for calling ${company}, this is Remo. I can help you book an appointment. What would you like to book, and for which day?`;
            }
            if (ctx.opening_greeting && typeof ctx.opening_greeting === 'string' && ctx.opening_greeting.length > 15) {
                const docGreeting = ctx.opening_greeting.trim();
                return isValidName && !docGreeting.includes(rawName) ? `Hello, am I speaking with ${rawName}? ${docGreeting}` : docGreeting;
            }
            if (isValidName) {
                return `Hello, am I speaking with ${rawName}? This is Remo calling from ${company} to help you book your appointment. Is now a good time to talk?`;
            }
            return `Hello, this is Remo calling from ${company} to help you book an appointment. Is now a good time to talk?`;
        }

        // Receptionist: answers the line, handles questions, takes messages and routes requests
        if (s === 'receptionist') {
            const company = ctx.company_name || safeContact.company || 'Score Labs';
            if (safeContact.direction === 'outbound') {
                if (ctx.opening_greeting && typeof ctx.opening_greeting === 'string' && ctx.opening_greeting.length > 15) {
                    return ctx.opening_greeting.trim();
                }
                return `Hello, this is Remo from the ${company} front desk, following up on your enquiry. Is now a good time to talk?`;
            }
            return `Thank you for calling ${company}, this is Remo. How may I help you today?`;
        }

        // Recruitment
        const role = ctx.job_title || contactInfo.job_role || contactInfo.role || 'the open position';
        return `${EXACT_GREETING} I'm calling regarding your application for ${role}. Do you have a couple of minutes to talk?`;
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

    static getUniversalFallback(lang = 'en', service = 'recruitment') {
        const l = (lang || 'en').toLowerCase();
        const s = (service || 'recruitment').toLowerCase();

        if (s === 'appointment') {
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
            if (l === 'hi') return "मैं स्कोरलैब्स इंक की ओर से बात कर रहा हूँ। हम कस्टम सॉफ्टवेयर, वेब और मोबाइल ऐप, ईआरपी और आईटी सहायता प्रदान करते हैं। क्या आपकी कंपनी किसी नए प्रोजेक्ट पर विचार कर रही है?";
            if (l === 'te') return "నేను స్కోర్‌ల్యాబ్స్ ఇంక్ తరపున మాట్లాడుతున్నాను. మేము కస్టమ్ సాఫ్ట్‌వేర్, వెబ్ మరియు మొబైల్ యాప్ డెవలప్‌మెంట్, ఈఆర్‌పీ మరియు ఐటీ సొల్యూషన్స్ అందిస్తాము. మీ సంస్థ ఏదైనా కొత్త సాఫ్ట్‌వేర్ ప్రాజెక్ట్‌ను పరిశీలిస్తోందా?";
            return "I'm calling on behalf of Scorelabs Inc. We help businesses with custom software, web and mobile apps, ERP and CRM solutions, and QA testing. Is your company planning any software projects or looking for an IT partner?";
        }

        if (s === 'recruitment') {
            if (l === 'hi') return "मैं स्कोर लैब्स से आपकी नौकरी के आवेदन के संबंध में बात कर रहा हूँ। क्या आप अपने अनुभव के बारे में संक्षेप में बता सकते हैं?";
            if (l === 'te') return "నేను స్కోర్ ల్యాబ్స్ నుండి మీ జాబ్ అప్లికేషన్ గురించి మాట్లాడుతున్నాను. మీ అనుభవం గురించి క్లుప్తంగా చెప్పగలరా?";
            return "I'm calling from Score Labs regarding your application for the open role. Could you briefly tell me about your background and recent experience?";
        }

        if (s === 'support') {
            if (l === 'hi') return "मैं स्कोर लैब्स कस्टमर सपोर्ट से बात कर रहा हूँ। क्या आप अपनी समस्या के बारे में विस्तार से बता सकते हैं?";
            if (l === 'te') return "నేను స్కోర్ ల్యాబ్స్ కస్టమర్ సపోర్ట్ నుండి మాట్లాడుతున్నాను. మీ సమస్య గురించి కాస్త వివరంగా చెప్పగలరా?";
            return "I'm calling from Score Labs customer support. Could you please share a few more details about the issue you are experiencing so I can assist you?";
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
    static parseModelResponse(rawText, lang = 'en', service = 'recruitment') {
        if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
            return {
                spoken_response: this.getUniversalFallback(lang, service),
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
                spoken_response: parsed.spoken_response ? String(parsed.spoken_response).trim() : this.getUniversalFallback(lang, service),
                detected_language: ['en', 'hi', 'te'].includes(parsed.detected_language) ? parsed.detected_language : lang,
                should_end_call: Boolean(parsed.should_end_call),
                extracted_fields: cleanedExtracted,
                classification: parsed.classification || this.defaultClassification(service),
                call_summary: parsed.call_summary || 'Dialogue processed successfully.'
            };
        } catch (e) {
            // Resilient regex recovery for broken JSON
            const spokenMatch = rawText.match(/"spoken_response"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
            const langMatch = rawText.match(/"detected_language"\s*:\s*"([^"]+)"/i);
            const endMatch = rawText.match(/"should_end_call"\s*:\s*(true|false)/i);
            const classMatch = rawText.match(/"classification"\s*:\s*"([^"]+)"/i);

            return {
                spoken_response: spokenMatch ? spokenMatch[1].replace(/\\"/g, '"').trim() : this.getUniversalFallback(lang, service),
                detected_language: langMatch && ['en', 'hi', 'te'].includes(langMatch[1]) ? langMatch[1] : lang,
                should_end_call: endMatch ? endMatch[1].toLowerCase() === 'true' : false,
                extracted_fields: {},
                classification: classMatch ? classMatch[1] : this.defaultClassification(service),
                call_summary: 'Recovered from malformed JSON model response.'
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
                model_used: 'deterministic_first_turn'
            };
        }

        // Build campaign and role-specific context
        const jdCriteria = options.campaignContext || contactInfo.campaignContext || contactInfo.jdCriteria || {};
        const role = jdCriteria.job_title || contactInfo.job_role || contactInfo.role || 'the open position';
        const requiredSkills = jdCriteria.required_skills ? (Array.isArray(jdCriteria.required_skills) ? jdCriteria.required_skills.join(', ') : jdCriteria.required_skills) : '';
        const minExp = jdCriteria.min_experience_years || jdCriteria.min_experience || '';
        const questionPlan = options.questionPlan || null;
        const memoryState = options.memoryState || null;

        // Service-specific guidance
        let serviceInstructions = "";
        let classificationOptions = "";

        if (service === 'sales') {
            classificationOptions = `"Interested" | "Meeting Requested" | "Email Requested" | "Callback Requested" | "Not Interested" | "Wrong Contact" | "Do Not Call"`;
            const prodName = jdCriteria.product_name || 'IT Solutions & Custom Software';
            const compName = jdCriteria.company_name || 'Scorelabs Inc.';
            const valueProps = Array.isArray(jdCriteria.value_propositions) && jdCriteria.value_propositions.length ? jdCriteria.value_propositions.join('; ') : '';
            const keyFeatures = Array.isArray(jdCriteria.key_features) && jdCriteria.key_features.length ? jdCriteria.key_features.join('; ') : '';
            const pricing = jdCriteria.pricing_summary || '';
            const cta = jdCriteria.call_to_action || 'schedule a 15-minute introductory discovery session';
            const faqs = Array.isArray(jdCriteria.approved_faqs) && jdCriteria.approved_faqs.length ? JSON.stringify(jdCriteria.approved_faqs.slice(0, 4)) : '';
            const objections = Array.isArray(jdCriteria.objections_and_counters) && jdCriteria.objections_and_counters.length ? JSON.stringify(jdCriteria.objections_and_counters.slice(0, 3)) : '';

            serviceInstructions = `
### SALES WORKFLOW (${compName} — Offering: ${prodName}):
- Product/Service: "${prodName}" by "${compName}".
${valueProps ? `- Value Propositions: ${valueProps}` : ''}
${keyFeatures ? `- Key Features: ${keyFeatures}` : ''}
${pricing ? `- Pricing/Plans: ${pricing}` : ''}
${cta ? `- Primary Objective / CTA: ${cta}` : ''}
${faqs ? `- Approved FAQs from Document: ${faqs}` : ''}
${objections ? `- Objection Handling from Document: ${objections}` : ''}
- STRICT GROUNDING RULES:
  1. Base all answers EXCLUSIVELY on the verified facts above.
  2. NEVER invent features, prices, discounts, or promises not in the document.
  3. If information is not in the document, say: "I don't have that detail right in front of me, but I'll make sure our team confirms and follows up with you."
  4. Never ask repeatedly about details the prospect already provided.
  5. Never mention job applications or recruitment.
  6. Objections: "Have vendor" -> Ask if can share profile for future. "Send info" -> Request business email. "Not interested" -> Polite exit, set should_end_call: true.`;
        } else if (service === 'appointment') {
            classificationOptions = `"Appointment Booked" | "Reschedule Requested" | "Cancelled" | "Callback Requested" | "Not Interested" | "Wrong Contact" | "Do Not Call"`;
            const compName = jdCriteria.company_name || contactInfo.company || 'Score Labs';
            const knowledge = this.businessKnowledge(jdCriteria, 'booking_rules', 'Booking rules');
            serviceInstructions = `
### APPOINTMENT SETTING WORKFLOW (${compName}):${knowledge}
- Goal: book, reschedule or cancel an appointment with ${compName}.
- Collect ONE detail at a time: what the appointment is for, the preferred day, the preferred time, then the caller's name. Never re-ask what is already collected.
- You cannot see a live calendar. Take their preferred slot (offer to note a second choice) and say the team will confirm it by message or call. Never promise a slot is locked in.
- Before closing, repeat the details back once ("So that's Friday at 4 PM, correct?"). Only after they agree, classify "Appointment Booked".
- Put what you learn in extracted_fields: appointment_purpose, preferred_date, preferred_time, caller_name, email.
- Rescheduling -> "Reschedule Requested"; cancelling -> "Cancelled"; busy now -> "Callback Requested" and ask for a better time.
- If they decline politely, thank them and end the call. Never pressure.
- STRICT: never invent services, prices, doctor/staff names or opening hours that you were not given.`;
        } else if (service === 'receptionist') {
            classificationOptions = `"Query Answered" | "Message Taken" | "Appointment Requested" | "Callback Requested" | "Wrong Number"`;
            const compName = jdCriteria.company_name || contactInfo.company || 'Score Labs';
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
- Screen candidate for "${role}". ${requiredSkills ? `Required Skills: ${requiredSkills}.` : ''} ${minExp ? `Min Exp: ${minExp}+ yrs.` : ''}
- Progression: Availability -> Experience -> Key Tech Skills -> Notice Period -> Location.
- Ask ONE question at a time. Never repeat answered questions.
- Wrap-up: Before closing, ask if candidate has questions.
- Classification: "Selected" (meets skills/exp), "Rejected" (explicit refusal/lacks mandatory skills), "On Hold" (incomplete/short answers).`;
        } else {
            classificationOptions = `"RESOLVED" | "ESCALATED" | "PENDING_INFO" | "Wrong Contact"`;
            const compName = jdCriteria.company_name || 'Scorelabs Inc.';
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
- STRICT GROUNDING RULES:
  1. First understand the customer's exact issue before offering a resolution.
  2. Guide the caller step-by-step through the troubleshooting procedures above.
  3. NEVER invent policies, refund promises, or technical fixes not in the document.
  4. If the issue cannot be resolved using the document, state: "I will escalate this to our technical support team for further assistance" and capture their details.
  5. Never pitch sales or recruitment.`;
        }

        const currentStage = options.currentStage || 'AVAILABILITY';
        const organizationName = jdCriteria.company_name || 'Scorelabs Inc.';

        // Multi-agent: each agent can have its own name and standing instructions from the account owner.
        const agentName = String(options.agentName || '').trim();
        const agentInstructions = String(options.agentInstructions || '').trim();
        const inboundNote = options.direction === 'inbound'
            ? '\nThis is an INCOMING call: the caller dialled us. Greet them, find out why they called and help; do not pitch or screen unless the instructions say so.'
            : '';
        const agentBlock = agentInstructions
            ? `\nINSTRUCTIONS FOR THIS AGENT${agentName ? ` ("${agentName}")` : ''} (follow these for tone, wording and behaviour, but never break the JSON format or the rules below):\n${agentInstructions}\n`
            : '';

        const systemPrompt = `You are ${agentName || 'Remo'}, a warm, professional, human-like AI Voice Agent representing ${organizationName}.
Mode: ${service.toUpperCase()} | Stage: ${currentStage} | Contact: ${contactInfo.name || 'Caller'} (${contactInfo.company || organizationName}) | Subject: ${role}${inboundNote}${agentBlock}

RULES:
1. Speak in natural telephone dialogue: strictly 1-2 short sentences (under 25 words).
2. Ask ONE question at a time.
3. Natural acknowledgments ("Got it", "Understood"). Do not repeat the same phrase.
4. Seamlessly match caller language: Telugu in Telugu, Hindi in Hindi, default English.
5. If caller pauses/thinks: "Sure, take your time."
6. NEVER repeat questions or the opening pitch. Continue from current stage.
${collectedData && Object.keys(collectedData).length > 0 ? `ALREADY COLLECTED (DO NOT RE-ASK): ${JSON.stringify(collectedData)}` : ''}
${questionPlan && Array.isArray(questionPlan) ? `QUESTION PLAN: ${questionPlan.slice(0, 5).map((q, idx) => `${idx + 1}. [${q.target_field || q.category}]: "${q.question}"`).join(' | ')}` : ''}
${serviceInstructions}

OUTPUT STRICT JSON ONLY:
{
  "spoken_response": "1-2 short sentences to speak out loud",
  "detected_language": "en" | "hi" | "te",
  "should_end_call": false | true,
  "extracted_fields": {},
  "classification": ${classificationOptions},
  "call_summary": "1 sentence summary"
}`;

        const recentHistory = (conversationHistory || []).slice(-14);
        const historyLines = recentHistory.map(m => `${m.speaker || 'Unknown'}: ${m.text || ''}`);
        if (callerMessage && (!recentHistory.length || recentHistory[recentHistory.length - 1].text !== callerMessage)) {
            historyLines.push(`Caller: ${callerMessage}`);
        }

        const userPrompt = `Conversation History:\n${historyLines.join('\n')}\n\nGenerate Remo's next spoken response as pure JSON.`;

        // Execute via LLMService (Claude Haiku primary with Gemini Flash fallback)
        // FIX-4: Timeout raised to 6500ms — 4000ms was causing spurious "operation aborted"
        // errors on every turn where Claude took >4s under load, wasting the fallback slot.
        try {
            const llmRes = await LLMService.generate({
                systemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
                maxTokens: 300,
                jsonMode: true,
                timeoutMs: 6500
            });

            if (llmRes && llmRes.text) {
                const parsed = this.parseModelResponse(llmRes.text, lang, service);
                return {
                    ...parsed,
                    model_used: `${llmRes.provider}_${llmRes.model}`
                };
            }
        } catch (llmErr) {
            console.warn('[GeminiService] LLMService invocation exception:', llmErr.message);
        }

        // Safe graceful fallback if all networks fail
        return {
            spoken_response: this.getUniversalFallback(lang, service),
            detected_language: lang,
            should_end_call: false,
            extracted_fields: {},
            classification: this.defaultClassification(service),
            call_summary: 'Temporary API latency; conversational fallback delivered.',
            model_used: 'graceful_fallback'
        };
    }
}
