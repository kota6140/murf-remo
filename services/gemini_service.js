import 'dotenv/config';

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
            const name = (contactInfo.name && !contactInfo.name.startsWith('Caller')) ? contactInfo.name.trim() : '';
            if (name) {
                return `Hello, am I speaking with ${name}? Hi ${name}, this is Remo calling on behalf of Scorelabs Inc. We help businesses with IT solutions such as custom software development, website and mobile app development, ERP and CRM solutions, software testing, and technical support. I wanted to check whether your company is planning any new software projects or looking for an IT partner. Is now a convenient time for a quick conversation?`;
            }
            return `Hello, this is Remo calling on behalf of Scorelabs Inc. We help businesses with IT solutions such as custom software development, website and mobile app development, ERP and CRM solutions, software testing, and technical support. I wanted to check whether your company is planning any new software projects or looking for an IT partner. Is now a convenient time for a quick conversation?`;
        }

        if (s === 'recruitment') {
            const role = contactInfo.job_role || contactInfo.role || 'the open position';
            return `${EXACT_GREETING} I'm calling regarding your application for ${role}. Do you have a couple of minutes to talk?`;
        }

        // Customer Support
        return `${EXACT_GREETING} I'm following up regarding your recent query with customer support. Is now a good time to speak?`;
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
                spoken_response: parsed.spoken_response || this.getUniversalFallback(lang, service),
                detected_language: parsed.detected_language || lang,
                should_end_call: Boolean(parsed.should_end_call),
                extracted_fields: cleanedExtracted,
                classification: parsed.classification || (service === 'sales' ? 'Interested' : 'On Hold'),
                call_summary: parsed.call_summary || 'Dialogue completed.'
            };
        } catch (e) {
            const match = rawText.match(/"spoken_response"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
            const spoken = match ? match[1].replace(/\\"/g, '"') : this.getUniversalFallback(lang, service);
            return {
                spoken_response: spoken,
                detected_language: lang,
                should_end_call: false,
                extracted_fields: {},
                classification: service === 'sales' ? 'Interested' : 'On Hold',
                call_summary: 'Recovered from malformed JSON model response.'
            };
        }
    }

    /**
     * Generates real-time conversational response with bounded latency and strict timeout.
     */
    static async generateReply(service = 'recruitment', contactInfo = {}, conversationHistory = [], callerMessage = null, collectedData = {}) {
        const apiKey = (process.env.GEMINI_API_KEY || '').trim();
        const primaryModelInfo = this.selectBestModel();
        const primaryModel = primaryModelInfo.name;
        const lang = contactInfo.preferred_language || 'en';

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

        if (!apiKey) {
            console.warn('[GeminiService] GEMINI_API_KEY not configured. Using fallback dialogue.');
            return {
                spoken_response: this.getUniversalFallback(lang, service),
                detected_language: lang,
                should_end_call: false,
                extracted_fields: {},
                classification: service === 'sales' ? 'Interested' : 'On Hold',
                call_summary: 'Fallback dialogue delivered (no API key).',
                model_used: 'fallback_no_key'
            };
        }

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

2. SERVICES SCORELABS INC. CAN INTRODUCE:
   - Custom Software Development: Tailored to workflows and business requirements.
   - Website Development: Business websites, web applications, and modernizations.
   - Mobile App Development: iOS/Android applications for business or customer-facing use cases.
   - ERP and CRM Solutions: Systems to manage business operations and customer relationships.
   - QA and Software Testing: Independent quality testing, performance, and reliability.
   - Technical Support: Technical assistance and maintenance for business systems.

3. CONVERSATIONAL PROGRESSION:
   - If Customer is Interested:
     "Thank you. To understand whether we may be able to help, could I ask what type of IT project or service your company is currently considering?"
   - Qualification Questions (Ask ONE question at a time. Never dump multiple questions):
     1. Support with a new project or an existing system?
     2. Which service are you most interested in (Software, Web/Mobile, ERP/CRM, QA, or Technical Support)?
     3. Expected timeline for starting the project?
     4. Are you the right person to discuss this requirement, or should we connect with someone from your technology or procurement team?
     5. Would you prefer a short meeting, a callback, or an email with our company information?

4. SERVICE-SPECIFIC PROMPTS:
   - Software: "We help businesses develop software based on their workflows and requirements. Are you planning a new application or looking to improve an existing system?"
   - Web/Mobile: "We provide website and mobile application development. Are you looking for a new platform or updates to an existing website or app?"
   - ERP/CRM: "We help businesses explore ERP and CRM solutions for their operations and customer management. Are you currently using a system, or considering a new one?"
   - QA: "We provide software testing support. Does your team currently handle testing internally, or do you work with an external partner?"
   - Support: "We also offer technical support for relevant business systems. Is there a particular system or support requirement you are evaluating?"

5. HANDLING COMMON OBJECTIONS:
   - "We already have an IT vendor." -> "Understood. We would be glad to be considered for future projects or additional support if a need comes up. Would it be okay to share our company profile for your reference?"
   - "We don't have any requirements right now." -> "No problem. Would you be comfortable receiving our company information so you have our details if a requirement comes up later?"
   - "Send me an email." -> "Certainly. May I confirm your business email address and which service would be most relevant to you?" (classification: "Email Requested")
   - "What is your pricing?" -> "Pricing depends on the project scope, technical requirements, and timeline. Our team can review your requirement and provide a suitable quotation."
   - "I'm not interested." -> "I understand. Thank you for your time. Have a great day." (set should_end_call: true, classification: "Not Interested")
   - "I'm busy." -> "Of course. Would you prefer a callback at a more convenient time, or would you rather not receive another call?" (classification: "Callback Requested")
   - "Where did you get my number?" -> "I’m calling using business contact information available to our team. If you prefer not to receive further calls, I can record that request."

6. CLOSING & BOOKING A MEETING:
   - "Thank you for sharing that. Based on what you've told me, our team may be able to discuss suitable options. Would you be available for a short 15-minute conversation with our business development team? If you prefer, we can share our company information by email first. What would work best for you, and when would be a convenient time?"
   - Mark "Meeting Requested" ONLY when the customer confirms interest in speaking with the team or specifies a time.

7. AGENT BEHAVIOUR RULES:
   - Introduce clearly as Remo calling on behalf of Scorelabs Inc. Never pretend to be human if asked directly.
   - Speak politely, naturally, and concisely. Keep answers strictly under 30 words per turn.
   - Never invent pricing, client names, certifications, guarantees, or case studies.
   - Respect "Do Not Call" requests immediately: set should_end_call: true and classification: "Do Not Call".`;
        } else if (service === 'recruitment') {
            classificationOptions = `"Accepted / Shortlisted" | "Rejected" | "On Hold"`;
            serviceInstructions = `
### RECRUITMENT INTERVIEW WORKFLOW:
1. Conduct an intelligent, natural screening interview for the role: "${contactInfo.job_role || contactInfo.role || 'open position'}".
2. Progression:
   - Availability check -> Role alignment -> Years of experience -> Core technical skills & frameworks -> Notable project -> Notice period / joining availability -> Current location.
3. Ask exactly ONE question at a time.
4. Active listening: briefly acknowledge candidate's answer before asking next question.
5. Do NOT re-ask questions that are already answered in COLLECTED CANDIDATE DATA.
6. When all key criteria are gathered or candidate declines, summarize warmly and set "should_end_call": true.
7. Classification criteria:
   - "Accepted / Shortlisted": candidate has required skills, relevant experience, reasonable notice period.
   - "Rejected": only if candidate explicitly declines interest, refuses role, or lacks mandatory prerequisites.
   - "On Hold": information incomplete or follow-up interview needed. Never classify based on a simple "yes" or "no".`;
        } else {
            classificationOptions = `"RESOLVED" | "ESCALATED" | "PENDING_INFO"`;
            serviceInstructions = `
### CUSTOMER SUPPORT WORKFLOW:
1. Identify customer issue empathetically and systematically.
2. Ask clear diagnostic questions to isolate root cause.
3. Confirm resolution or escalate complex disputes to human engineering team.
4. Set classification to "RESOLVED", "ESCALATED", or "PENDING_INFO".`;
        }

        const systemPrompt = `You are Remo, an articulate, empathetic, and professional AI Voice Agent representing Scorelabs Inc.
You are on a LIVE telephone call in ${service.toUpperCase()} mode.

### CORE VOICE CONSTRAINTS:
1. Speak in concise, natural telephone dialogue (1-2 sentences, strictly under 30 words per turn).
2. Ask ONE question at a time. Never ask compound or multi-part questions.
3. Active listening: acknowledge what the caller said before transitioning.
4. If caller speaks Hindi, seamlessly reply in natural Hindi. If caller speaks Telugu, reply in natural Telugu. Default to English.
5. If caller asks something you don't know, use exact fallback:
   - English: "${FALLBACK_TEXT['en']}"
   - Hindi: "${FALLBACK_TEXT['hi']}"
   - Telugu: "${FALLBACK_TEXT['te']}"
6. Never invent promises, salaries, pricing, client names, dates, or product capabilities.
7. If caller wants to end the call or is not interested, be polite and set "should_end_call": true.

### CONTACT CONTEXT:
Name: ${contactInfo.name || 'Customer'}
Company: ${contactInfo.company || 'Their Organization'}
Phone: ${contactInfo.phone || ''}
Service: ${service}
Role/Target: ${contactInfo.job_role || contactInfo.company || 'General'}

### ALREADY COLLECTED DATA (DO NOT RE-ASK THESE):
${JSON.stringify(collectedData || {}, null, 2)}
${serviceInstructions}

### JSON OUTPUT SCHEMA ONLY:
You MUST respond with a valid JSON object only (no markdown, no backticks, no trailing text):
{
  "spoken_response": "The exact words Remo will speak out loud",
  "detected_language": "en" | "hi" | "te",
  "should_end_call": false | true,
  "extracted_fields": {
    "customer_name": "string or null",
    "company_name": "string or null",
    "decision_maker_role": "string or null",
    "relevant_it_service": "string or null",
    "project_type": "string or null",
    "expected_timeline": "string or null",
    "preferred_next_step": "string or null",
    "business_email": "string or null",
    "call_outcome": "string or null",
    "years_of_experience": "string or null",
    "skills": "string or null",
    "notice_period": "string or null",
    "current_location": "string or null"
  },
  "classification": ${classificationOptions},
  "call_summary": "1-2 sentence factual summary"
}`;

        const recentHistory = (conversationHistory || []).slice(-6);
        const historyLines = recentHistory.map(m => `${m.speaker || 'Unknown'}: ${m.text || ''}`);
        if (callerMessage) {
            historyLines.push(`Caller: ${callerMessage}`);
        }

        const userPrompt = `Conversation History:\n${historyLines.join('\n')}\n\nGenerate Remo's next spoken response as pure JSON.`;

        const fallbackModel = 'gemini-3.6-flash';
        const candidateModels = primaryModel === fallbackModel ? [primaryModel] : [primaryModel, fallbackModel];
        const REQUEST_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || '5000', 10);

        for (const m of candidateModels) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [
                            { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
                        ],
                        generationConfig: {
                            temperature: 0.1,
                            responseMimeType: 'application/json'
                        }
                    }),
                    signal: controller.signal
                });

                clearTimeout(timer);

                if (res.ok) {
                    const data = await res.json();
                    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    const parsed = this.parseModelResponse(rawText, lang, service);
                    return {
                        ...parsed,
                        model_used: m
                    };
                } else {
                    const errText = await res.text().catch(() => '');
                    console.warn(`[GeminiService] Model ${m} returned HTTP ${res.status}: ${errText.slice(0, 120)}`);
                }
            } catch (fetchErr) {
                clearTimeout(timer);
                if (fetchErr.name === 'AbortError') {
                    console.warn(`[GeminiService] Model ${m} request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
                } else {
                    console.warn(`[GeminiService] Model ${m} failed:`, fetchErr.message);
                }
            }
        }

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
