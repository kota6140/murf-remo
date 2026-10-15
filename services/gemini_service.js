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
     * Returns the opening greeting tailored to the specific campaign service.
     */
    static getOpeningGreeting(service = 'recruitment', contactInfo = {}) {
        const s = String(service || 'recruitment').toLowerCase();

        if (s === 'sales') {
            const rawName = (contactInfo.name || '').trim();
            const isValidName = rawName && !rawName.startsWith('Caller') && !rawName.startsWith('Candidate') && !rawName.startsWith('Contact');
            if (isValidName) {
                return `Hello, am I speaking with ${rawName}? Hi ${rawName}, this is Remo calling on behalf of Scorelabs Inc. We help businesses with IT solutions such as custom software development, website and mobile app development, ERP and CRM solutions, software testing, and technical support. I wanted to check whether your company is planning any new software projects or looking for an IT partner. Is now a convenient time for a quick conversation?`;
            }
            return `Hello, this is Remo calling on behalf of Scorelabs Inc. We help businesses with IT solutions such as custom software development, website and mobile app development, ERP and CRM solutions, software testing, and technical support. I wanted to check whether your company is planning any new software projects or looking for an IT partner. Is now a convenient time for a quick conversation?`;
        }

        if (s === 'support') {
            const rawName = (contactInfo.name || '').trim();
            const isValidName = rawName && !rawName.startsWith('Caller') && !rawName.startsWith('Candidate') && !rawName.startsWith('Contact');
            if (isValidName) {
                return `Hello, am I speaking with ${rawName}? Hi ${rawName}, this is Remo calling from Scorelabs Inc. customer support. I'm following up regarding your recent support inquiry or service ticket. Is now a convenient time to speak?`;
            }
            return `Hello, this is Remo calling from Scorelabs Inc. customer support. I'm following up regarding your recent support inquiry or service ticket. Is now a convenient time to speak?`;
        }

        // Recruitment
        const role = contactInfo.job_role || contactInfo.role || 'the open position';
        return `${EXACT_GREETING} I'm calling regarding your application for ${role}. Do you have a couple of minutes to talk?`;
    }

    static getUniversalFallback(lang = 'en', service = 'recruitment') {
        const l = (lang || 'en').toLowerCase();
        const s = (service || 'recruitment').toLowerCase();

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
                classification: service === 'sales' ? 'Interested' : 'On Hold',
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
                classification: parsed.classification || (service === 'sales' ? 'Interested' : 'On Hold'),
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
                classification: classMatch ? classMatch[1] : (service === 'sales' ? 'Interested' : 'On Hold'),
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
                classification: service === 'sales' ? 'Interested' : 'On Hold',
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
            serviceInstructions = `
### SALES / BUSINESS DEVELOPMENT WORKFLOW (Scorelabs Inc.):
1. PURPOSE:
   - Start professional conversations with businesses, understand their IT needs, identify qualified opportunities, and arrange a 15-minute meeting or callback with the Scorelabs Inc. team.
   - Do NOT pressure customers or prolong call unnecessarily.
   - NEVER ask recruitment screening or candidate interview questions.

2. SERVICES SCORELABS INC. CAN INTRODUCE:
   - Custom Software Development: Tailored to workflows and business requirements.
   - Website Development: Business websites, web applications, and modernizations.
   - Mobile App Development: iOS/Android applications for business or customer-facing use cases.
   - ERP and CRM Solutions: Systems to manage business operations and customer relationships.
   - QA and Software Testing: Independent quality testing, performance, and reliability.
   - Technical Support: Technical assistance and maintenance for business systems.

3. CONVERSATIONAL PROGRESSION:
   - If Customer is Interested: Acknowledge and ask what type of IT project or software initiative their company is considering.
   - Ask ONE question at a time.
   - Objection Handling:
     * "Already have vendor" -> Acknowledge, ask if okay to send company profile for future projects.
     * "No requirements" -> Acknowledge politely, ask if can send details for future reference.
     * "Send email" -> Confirm business email address (classification: "Email Requested").
     * "Pricing" -> Clarify pricing depends on scope and technical stack, team can provide estimate.
     * "Not interested" -> Be polite, wish a great day, set should_end_call: true (classification: "Not Interested").
   - Closing: Ask if available for a 15-minute conversation with business development team.`;
        } else if (service === 'recruitment') {
            classificationOptions = `"Selected" | "Rejected" | "On Hold"`;
            serviceInstructions = `
### RECRUITMENT INTERVIEW WORKFLOW:
1. Conduct an intelligent, natural screening interview for the role: "${role}".
${requiredSkills ? `2. Required Technical Skills from Job Description: ${requiredSkills}.` : ''}
${minExp ? `3. Required Experience: ${minExp}+ years.` : ''}
4. Conversational Progression:
   - Availability check -> Relevant experience in ${role} -> Hands-on work with ${requiredSkills || 'core technologies'} -> Notice period -> Location preference.
   - Wrap-up: Before closing, ALWAYS ask: "Before we wrap up, do you have any questions for me about the role or Scorelabs?"
5. Ask exactly ONE question at a time. Never ask multiple questions in a single turn.
6. Anti-Repetition Rule: Check ALREADY COLLECTED DATA below. DO NOT re-ask questions that have already been answered.
7. Candidate answers like "yeah", "yes", "30 days", "5 years" are valid answers. Acknowledge and advance to the next screening point.
8. Classification criteria:
   - "Selected": Candidate demonstrates required skills and experience meeting JD.
   - "Rejected": Only if candidate explicitly declines interest, refuses role, or lacks mandatory prerequisites.
   - "On Hold": Information incomplete or follow-up needed. Never reject for short answers or pauses.`;
        } else {
            classificationOptions = `"RESOLVED" | "ESCALATED" | "PENDING_INFO" | "Wrong Contact"`;
            serviceInstructions = `
### CUSTOMER SUPPORT WORKFLOW (Scorelabs Inc.):
1. PURPOSE:
   - Provide prompt, courteous assistance for technical queries, support tickets, or service issues.
   - NEVER ask job interview questions or deliver sales pitches.
2. PROGRESSION:
   - Clarify the issue -> Ask one diagnostic question -> Suggest resolution or log escalation ticket.
   - Closing: "Is there anything else our team can assist you with today?"`;
        }

        const currentStage = options.currentStage || 'AVAILABILITY';
        const stageDescription = {
            'AVAILABILITY': 'Initial contact — checking if caller is available to talk',
            'SERVICE_INTEREST': 'Discovering what IT services the prospect might need',
            'QUALIFICATION': 'Qualifying the business opportunity',
            'EMAIL_PERMISSION': 'Asking for permission to send company info',
            'EMAIL_CAPTURE': 'Capturing prospect email address',
            'MEETING_REQUEST': 'Proposing a 15-minute follow-up meeting',
            'MEETING_CONFIRMATION': 'Confirming meeting time and details',
            'CALLBACK_TIME': 'Scheduling a callback',
            'EXPERIENCE': 'Assessing candidate work experience',
            'SKILLS': 'Assessing candidate technical skills',
            'NOTICE_PERIOD': 'Asking about candidate notice period',
            'LOCATION': 'Asking about candidate location preference',
            'CLOSING': 'Wrapping up the conversation',
            'GENERAL': 'General conversation'
        };

        const systemPrompt = `You are Remo, a warm, professional, human-like AI Voice Agent representing Scorelabs Inc.
You are on a LIVE phone call strictly in ${service.toUpperCase()} mode.
Current conversation stage: ${currentStage} — ${stageDescription[currentStage] || 'Ongoing conversation'}.

### STRICT SERVICE BOUNDARIES:
- Current Mode: ${service.toUpperCase()}.
- If service is "sales": Focus on Scorelabs IT solutions. NEVER mention job applications or recruitment.
- If service is "support": Focus on resolving customer queries. NEVER pitch or recruit.
- If service is "recruitment": Screen candidate for ${role}.

### HUMAN-LIKE CONVERSATIONAL RULES:
1. Speak in concise, natural telephone dialogue (1-2 short sentences, strictly under 30 words per turn).
2. Ask ONE question at a time.
3. Natural acknowledgments: Use varied phrases like "Got it", "That makes sense", "Understood", "Thanks for clarifying". Do NOT repeat the same acknowledgment every turn.
4. If caller speaks Telugu, seamlessly reply in natural conversational Telugu. If caller speaks Hindi, reply in Hindi. Default to English.
5. If caller says "hmm, let me think" or pauses, respond patiently: "Sure, take your time."
6. NEVER repeat a question that was already asked or answered.
7. NEVER repeat the opening sales pitch — if greeting was already delivered, continue from current stage.
8. Read the full conversation history before responding — your response MUST be contextually appropriate to the LAST thing the caller said.
9. If caller asks something you don't know, use exact fallback:
   - English: "${FALLBACK_TEXT['en']}"
   - Telugu: "${FALLBACK_TEXT['te']}"
   - Hindi: "${FALLBACK_TEXT['hi']}"

### CONTACT CONTEXT:
Name: ${contactInfo.name || (service === 'recruitment' ? 'Candidate' : 'Customer')}
Company: ${contactInfo.company || 'Scorelabs Inc.'}
Role/Target: ${role}

### ALREADY COLLECTED DATA (DO NOT RE-ASK):
${JSON.stringify(collectedData || {}, null, 2)}
${memoryState ? `\n### STRUCTURED CONVERSATION STATE:\n${JSON.stringify(memoryState, null, 2)}` : ''}
${questionPlan && Array.isArray(questionPlan) ? `\n### ROLE QUESTION PLAN DERIVED FROM JD (Ask sequentially, skip if already answered):\n${questionPlan.map((q, idx) => `${idx + 1}. [${q.target_field || q.category}]: "${q.question}"`).join('\n')}` : ''}
${serviceInstructions}

### JSON OUTPUT SCHEMA ONLY:
You MUST respond with valid JSON only:
{
  "spoken_response": "The exact words Remo will speak out loud",
  "detected_language": "en" | "hi" | "te",
  "should_end_call": false | true,
  "extracted_fields": {},
  "classification": ${classificationOptions},
  "call_summary": "1-2 sentence factual summary"
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
            classification: service === 'sales' ? 'Interested' : 'On Hold',
            call_summary: 'Temporary API latency; conversational fallback delivered.',
            model_used: 'graceful_fallback'
        };
    }
}
