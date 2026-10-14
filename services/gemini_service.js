import 'dotenv/config';

const EXACT_GREETING = "Hey, it's Remo, representing Score Labs.";

const FALLBACK_TEXT = {
    'en': "I'm sorry, I don't have that information right now, but I'll make sure our team follows up with you directly.",
    'hi': "माफ़ कीजिए, मेरे पास अभी यह जानकारी उपलब्ध नहीं है, लेकिन हमारी टीम आपसे जल्द संपर्क करेगी।",
    'te': "నన్ను క్షమించండి, ప్రస్తుతం నా వద్ద ఆ సమాచారం లేదు, కానీ మా బృందం నేరుగా మిమ్మల్ని సంప్రదిస్తుంది."
};

export default class GeminiService {
    static getOpeningGreeting(service = 'recruitment', contactInfo = {}) {
        const s = String(service || 'recruitment').toLowerCase();
        let intro = EXACT_GREETING;

        if (s === 'recruitment') {
            const role = contactInfo.job_role || contactInfo.role || 'the open position';
            intro += ` I'm calling regarding your application for ${role}. Do you have a couple of minutes to talk?`;
        } else if (s === 'sales') {
            const company = contactInfo.company || 'your team';
            intro += ` I'm reaching out to see if we can help automate voice communications for ${company}. Are you available for a brief chat?`;
        } else {
            intro += ` I'm following up regarding your recent query with customer support. Is now a good time to speak?`;
        }

        return intro;
    }

    static getUniversalFallback(lang = 'en', service = 'recruitment') {
        const l = (lang || 'en').toLowerCase();
        const s = (service || 'recruitment').toLowerCase();

        if (s === 'recruitment') {
            if (l === 'hi') return "मैं स्कोर लैब्स से आपकी नौकरी के आवेदन के संबंध में बात कर रहा हूँ। क्या आप अपने अनुभव के बारे में संक्षेप में बता सकते हैं?";
            if (l === 'te') return "నేను స్కోర్ ల్యాబ్స్ నుండి మీ జాబ్ అప్లికేషన్ గురించి మాట్లాడుతున్నాను. మీ అనుభవం గురించి క్లుప్తంగా చెప్పగలరా?";
            return "I'm calling from Score Labs regarding your application for the open role. Could you briefly tell me about your background and recent experience?";
        }

        if (s === 'sales') {
            if (l === 'hi') return "मैं स्कोर लैब्स से कॉल कर रहा हूँ कि हम आपकी टीम की वॉयस ऑटोमेशन में कैसे मदद कर सकते हैं। आप अभी क्या समाधान उपयोग कर रहे हैं?";
            if (l === 'te') return "నేను స్కోర్ ల్యాబ్స్ నుండి కాల్ చేస్తున్నాను, మీ టీమ్‌కి వాయిస్ ఆటోమేషన్‌లో మేము ఎలా సహాయపడగలమో తెలుసుకోవడానికి. మీరు ప్రస్తుతం ఏ సిస్టమ్‌ని ఉపయోగిస్తున్నారు?";
            return "I'm reaching out from Score Labs to see how we can assist your team with AI voice communication. What system is your team currently using?";
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
                classification: 'On Hold',
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
                classification: parsed.classification || 'On Hold',
                call_summary: parsed.call_summary || 'Dialogue completed.'
            };
        } catch (e) {
            // Attempt regex extraction for spoken_response if JSON was truncated
            const match = rawText.match(/"spoken_response"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
            const spoken = match ? match[1].replace(/\\"/g, '"') : this.getUniversalFallback(lang, service);
            return {
                spoken_response: spoken,
                detected_language: lang,
                should_end_call: false,
                extracted_fields: {},
                classification: 'On Hold',
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
                classification: 'On Hold',
                call_summary: 'Call initiated. Opening identity greeting delivered.',
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
                classification: 'On Hold',
                call_summary: 'Fallback dialogue delivered (no API key).',
                model_used: 'fallback_no_key'
            };
        }

        // Service-specific guidance
        let serviceInstructions = "";
        if (service === 'recruitment') {
            serviceInstructions = `
### RECRUITMENT INTERVIEW WORKFLOW:
1. Conduct an intelligent, natural screening interview for the role: "${contactInfo.job_role || contactInfo.role || 'open position'}".
2. Progression:
   - Availability check -> Role alignment -> Years of experience -> Core technical skills & frameworks -> Notable project -> Notice period / joining availability -> Current location.
3. Keep questions focused: ask exactly ONE question at a time.
4. Active listening: briefly acknowledge candidate's answer before asking next question ("Got it, 4 years in React and Node...").
5. Do NOT re-ask questions that are already answered in COLLECTED CANDIDATE DATA.
6. When all key criteria are gathered or candidate declines, summarize warmly and set "should_end_call": true.
7. Classification criteria:
   - "Accepted / Shortlisted": candidate has required skills, relevant experience, reasonable notice period.
   - "Rejected": only if candidate explicitly declines interest, refuses role, or lacks mandatory prerequisites.
   - "On Hold": information incomplete or follow-up interview needed. Never classify based on a simple "yes" or "no".`;
        } else if (service === 'sales') {
            serviceInstructions = `
### SALES DISCOVERY WORKFLOW:
1. Understand customer's company (${contactInfo.company || 'their organization'}) and telephony setup.
2. Ask targeted discovery questions about call volume, current pain points, and voice automation goals.
3. Highlight Score Labs Remo capabilities (24/7 outbound/inbound voice AI, natural conversations, CRM integration).
4. Address objections with empathy. Never invent pricing, guarantees, or product features.
5. If interested, confirm follow-up / demo details and set "should_end_call": true, classification: "INTERESTED".`;
        } else {
            serviceInstructions = `
### CUSTOMER SUPPORT WORKFLOW:
1. Identify customer issue empathetically and systematically.
2. Ask clear diagnostic questions to isolate root cause.
3. Confirm resolution or escalate complex disputes to human engineering team.
4. Set classification to "RESOLVED", "ESCALATED", or "PENDING_INFO".`;
        }

        const systemPrompt = `You are Remo, an articulate, empathetic, and professional AI Voice Agent representing Score Labs.
You are on a LIVE telephony call in ${service.toUpperCase()} mode.

### CORE VOICE CONSTRAINTS:
1. Speak in concise, natural telephone dialogue (1-2 sentences, strictly under 30 words per turn).
2. Ask ONE question at a time. Never ask compound or multi-part questions.
3. Active listening: acknowledge what the caller said before transitioning.
4. If caller speaks Hindi, seamlessly reply in natural Hindi. If caller speaks Telugu, reply in natural Telugu. Default to English.
5. If caller asks something you don't know, use exact fallback:
   - English: "${FALLBACK_TEXT['en']}"
   - Hindi: "${FALLBACK_TEXT['hi']}"
   - Telugu: "${FALLBACK_TEXT['te']}"
6. Never invent promises, salaries, dates, or product capabilities.
7. If caller wants to end the call or is not interested, be polite and set "should_end_call": true.

### CONTACT CONTEXT:
Name: ${contactInfo.name || 'Caller'}
Phone: ${contactInfo.phone || ''}
Service: ${service}
Role/Target: ${contactInfo.job_role || contactInfo.company || 'Open'}

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
    "years_of_experience": "string or null",
    "skills": "string or null",
    "notice_period": "string or null",
    "current_location": "string or null",
    "candidate_interest": "string or null"
  },
  "classification": "Accepted / Shortlisted" | "Rejected" | "On Hold" | "INTERESTED" | "NOT_INTERESTED" | "RESOLVED" | "ESCALATED" | "PENDING_INFO",
  "call_summary": "1-2 sentence factual summary"
}`;

        // Prompt token optimization: Keep only recent context (last 6 turns) + current caller message
        const recentHistory = (conversationHistory || []).slice(-6);
        const historyLines = recentHistory.map(m => `${m.speaker || 'Unknown'}: ${m.text || ''}`);
        if (callerMessage) {
            historyLines.push(`Caller: ${callerMessage}`);
        }

        const userPrompt = `Conversation History:\n${historyLines.join('\n')}\n\nGenerate Remo's next spoken response as pure JSON.`;

        // Bounded model strategy: single primary model + single verified fast fallback
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

        // Graceful conversational recovery: keep the call alive!
        return {
            spoken_response: this.getUniversalFallback(lang, service),
            detected_language: lang,
            should_end_call: false,
            extracted_fields: {},
            classification: 'On Hold',
            call_summary: 'Temporary API latency; conversational fallback delivered.',
            model_used: 'graceful_fallback'
        };
    }
}
