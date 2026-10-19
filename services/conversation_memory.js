/**
 * services/conversation_memory.js
 * 
 * High-Precision Conversational Memory & State Tracking for Remo AI Voice Agent.
 * 
 * Core Features:
 * 1. Strict anti-repetition: tracks asked questions & answered facts per call.
 * 2. Natural short-response interpretation ("yeah", "hmm", "30 days", "one second").
 * 3. Thinking pause recognition: prevents interrupting caller while they think.
 * 4. Contextual acknowledgment rotation (prevents monotonous "great/okay" loops).
 * 5. Role-specific stage progression (Recruitment, Sales, Customer Support).
 */

export class ConversationMemory {
    constructor(callIdOrOptions, options = {}) {
        let callId = 'call_' + Date.now();
        let opts = {};
        if (typeof callIdOrOptions === 'string') {
            callId = callIdOrOptions;
            opts = options || {};
        } else if (callIdOrOptions && typeof callIdOrOptions === 'object') {
            opts = callIdOrOptions;
            callId = opts.callId || callId;
        }

        this.callId = callId;
        this.service = opts.service || 'recruitment';
        this.contact = opts.contact || {};
        this.campaignContext = opts.campaignContext || {};
        this.questionPlan = opts.questionPlan || null;

        this.currentStage = 'GREETING';
        this.pendingQuestion = null;
        this.questionsAsked = [];      // Array of { id, text, stage, timestamp }
        this.questionsAnswered = [];   // Array of { id, question, answer, timestamp }
        this.factsCollected = {};      // Key-value store of extracted factual attributes
        this.factsToClarify = [];      // Ambiguous points requiring brief confirmation
        this.objections = [];          // Objections raised by prospect / customer
        this.recoveryAttempts = 0;
        this.lastAckIndex = -1;

        // Pre-populate facts from contact spreadsheet if available
        if (this.contact.skills) this.factsCollected.skills_from_sheet = this.contact.skills;
        if (this.contact.experience) this.factsCollected.experience_from_sheet = this.contact.experience;
        if (this.contact.notice_period) this.factsCollected.notice_period_from_sheet = this.contact.notice_period;
        if (this.contact.location) this.factsCollected.location_from_sheet = this.contact.location;
    }

    recordTurn(speaker, text) {
        if (!text) return;
        const norm = (speaker || '').toUpperCase();
        if (norm === 'REMO' || norm === 'AI' || norm === 'AGENT') {
            this.recordQuestionAsked(`q_${this.questionsAsked.length + 1}`, text, this.currentStage);
        } else {
            this.recordAnswer(text);
        }
    }

    getStateSummary() {
        return {
            stage: this.currentStage,
            pending_question: this.pendingQuestion ? this.pendingQuestion.text : null,
            questions_asked_count: this.questionsAsked.length,
            facts_collected: this.factsCollected
        };
    }

    /**
     * Contextual acknowledgments rotation pool
     */
    static ACKNOWLEDGMENTS = [
        "Got it.",
        "Understood.",
        "That makes sense.",
        "Thanks for clarifying.",
        "No problem.",
        "Sure, take your time.",
        "Perfect."
    ];

    /**
     * Gets a fresh, non-repetitive contextual acknowledgment.
     */
    getNextAcknowledgment(intent = 'general') {
        if (intent === 'thinking') {
            return "Take your time.";
        }
        if (intent === 'affirmative') {
            const pool = ["Got it.", "Understood.", "That makes sense.", "Perfect."];
            this.lastAckIndex = (this.lastAckIndex + 1) % pool.length;
            return pool[this.lastAckIndex];
        }
        this.lastAckIndex = (this.lastAckIndex + 1) % ConversationMemory.ACKNOWLEDGMENTS.length;
        return ConversationMemory.ACKNOWLEDGMENTS[this.lastAckIndex];
    }

    /**
     * Checks if a question or its semantic equivalent has already been asked.
     */
    /**
     * Checks if a question or its semantic equivalent has already been asked.
     */
    hasAskedQuestion(questionId, questionText = '') {
        if (!questionId && !questionText) return false;
        return this.questionsAsked.some(q => 
            (questionId && q.id === questionId) ||
            (questionText && this._textSimilarity(q.text, questionText) > 0.75) ||
            (questionText && this.isSemanticallyDuplicateQuestion(q.text, questionText))
        );
    }

    hasQuestionBeenAsked(questionId, questionText = '') {
        return this.hasAskedQuestion(questionId, questionText);
    }

    isQuestionAnswered(questionId) {
        return this.questionsAnswered.some(q => q.id === questionId);
    }

    /**
     * Determines whether two questions are asking for the exact same information
     * (e.g. project requirements, service needed, tech stack, follow-up).
     */
    isSemanticallyDuplicateQuestion(q1 = '', q2 = '') {
        if (!q1 || !q2) return false;
        const s1 = q1.toLowerCase().trim();
        const s2 = q2.toLowerCase().trim();
        if (s1 === s2) return true;

        const isDiscovery = q => /what you(?:'re| are) looking for|main requirements|explain your project|goal of your|tell me more about the project|project requirements|what you need/i.test(q);
        const isServiceNeed = q => /service or project you(?:'re| are) currently looking for|looking for any services|service or project are you/i.test(q);
        const isTechStack = q => /technical preferences|recommend the best approach|what technology|tech stack|programming language/i.test(q);
        const isAdditional = q => /anything else you(?:'d| would) like us to know|anything else to add/i.test(q);
        const isFollowup = q => /send you some information|discuss your requirements with our team|company information/i.test(q);
        const isPermission = q => /good time to talk|talk for a minute|convenient time/i.test(q);

        if (isDiscovery(s1) && isDiscovery(s2)) return true;
        if (isServiceNeed(s1) && isServiceNeed(s2)) return true;
        if (isTechStack(s1) && isTechStack(s2)) return true;
        if (isAdditional(s1) && isAdditional(s2)) return true;
        if (isFollowup(s1) && isFollowup(s2)) return true;
        if (isPermission(s1) && isPermission(s2)) return true;

        return false;
    }

    /**
     * Records a question sent to caller.
     */
    recordQuestionAsked(id, text, stage = this.currentStage) {
        this.pendingQuestion = { id, text, stage, timestamp: Date.now() };
        this.questionsAsked.push(this.pendingQuestion);
        this.currentStage = stage;
    }

    /**
     * Records an answer received from caller.
     */
    recordAnswer(answerOrId, answerText) {
        let text = answerText !== undefined ? answerText : answerOrId;
        if (!this.pendingQuestion && answerText !== undefined) {
            this.pendingQuestion = { id: answerOrId, text: '', stage: this.currentStage };
        }
        if (!this.pendingQuestion) return;
        const record = {
            id: this.pendingQuestion.id,
            question: this.pendingQuestion.text,
            stage: this.pendingQuestion.stage,
            answer: text,
            timestamp: Date.now()
        };
        this.questionsAnswered.push(record);

        // Extract key facts from simple answers
        this._extractInlineFacts(this.pendingQuestion.id, text);
        this.pendingQuestion = null;
        this.recoveryAttempts = 0;
    }

    recordFact(key, value) {
        if (key) this.factsCollected[key] = value;
    }

    getState() {
        return {
            stage: this.currentStage,
            pending_question: this.pendingQuestion,
            questions_asked: this.questionsAsked,
            questions_answered: this.questionsAnswered,
            facts_collected: this.factsCollected
        };
    }

    /**
     * Determines whether the user utterance is a thinking pause.
     */
    isThinkingPause(text) {
        const lower = (text || '').toLowerCase().trim();
        const thinkingPatterns = [
            /^(?:hmm+|um+|uh+)\s*,?\s*(?:let me think|give me a (?:sec|second|min|minute)|one (?:sec|second|min|minute))?$/i,
            /^(?:let me think|just a (?:sec|second|moment)|one moment|give me a moment|thinking)\b/i,
            /^(?:wait|hold on|one sec|one second|wait a (?:sec|second|min|minute)|just a (?:sec|second|moment))\b/i,
            /^(?:one|a)\s+(?:sec|second|min|minute|moment)(?:\s+please)?\b/i
        ];
        return thinkingPatterns.some(pattern => pattern.test(lower));
    }

    /**
     * Selects the next planned question from the campaign question plan.
     */
    getNextPlannedQuestion(questionPlan = []) {
        if (!Array.isArray(questionPlan) || questionPlan.length === 0) return null;

        for (const item of questionPlan) {
            // Skip already asked questions
            if (this.hasAskedQuestion(item.id, item.text)) continue;

            // Skip questions if the fact is already known reliably from spreadsheet
            if (item.field_to_collect && this._isFieldSufficientlyKnown(item.field_to_collect)) {
                continue;
            }

            return item;
        }

        // If all screening questions asked, return wrap-up question if not already asked
        if (!this.hasAskedQuestion('q_candidate_questions')) {
            return {
                id: 'q_candidate_questions',
                stage: 'CANDIDATE_QUESTIONS',
                text: 'Before we wrap up, do you have any questions for me about the position or the company?',
                field_to_collect: 'candidate_inquiry',
                mandatory: false
            };
        }

        return null;
    }

    /**
     * Compact summary for LLM prompt context to keep latency < 500ms
     */
    toCompactContextString() {
        const answeredSummary = this.questionsAnswered.map(qa => 
            `Q: "${qa.question}" -> A: "${qa.answer}"`
        ).join('\n');

        const factsSummary = Object.entries(this.factsCollected)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');

        return [
            `Current Stage: ${this.currentStage}`,
            `Questions Answered So Far:\n${answeredSummary || 'None yet.'}`,
            `Facts Collected: ${factsSummary || 'None yet.'}`
        ].join('\n\n');
    }

    /**
     * Private helpers
     */
    _extractInlineFacts(questionId, answer) {
        const clean = (answer || '').trim();
        const lower = clean.toLowerCase();

        // Check if customer called out repetition ("I already told you", "I just told you")
        if (/already told|just told|already said|just said|i told you/i.test(lower)) {
            this.factsCollected.customer_called_out_repetition = true;
        }

        // Notice period pattern: "30 days", "immediate", "1 month"
        if (questionId?.includes('notice') || /notice|join/i.test(clean)) {
            const daysMatch = clean.match(/(\d+)\s*days?/i);
            const monthMatch = clean.match(/(\d+)\s*months?/i);
            if (daysMatch) this.factsCollected.notice_period_days = parseInt(daysMatch[1], 10);
            else if (monthMatch) this.factsCollected.notice_period_days = parseInt(monthMatch[1], 10) * 30;
            else if (/immediate|serving/i.test(clean)) this.factsCollected.notice_period_days = 0;
            else this.factsCollected.notice_period_raw = clean;
        }

        // Experience pattern: "5 years", "3.5 yrs"
        if (questionId?.includes('experience') || /experience|years/i.test(clean)) {
            const expMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:years|yrs)/i);
            if (expMatch) this.factsCollected.experience_years = parseFloat(expMatch[1]);
        }

        // Business Email pattern
        const emailMatch = clean.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
        if (emailMatch) {
            this.factsCollected.business_email = emailMatch[0];
            this.factsCollected.email = emailMatch[0];
        }

        // Service Needed pattern (Sales)
        const sMatch = clean.match(/\b(website(?: development)?|web(?: development| dev)?|mobile app(?:lication)?(?: development)?|custom software|software development|erp|crm|software testing|cloud solutions?|digital marketing|billing(?: or invoicing)? system|invoicing system|invoice system|automating business processes|process automation|automation)\b/i);
        if (sMatch) {
            this.factsCollected.service_needed = sMatch[0];
        }

        // Detailed requirements from compound response
        // e.g. "I need an invoicing system with billing, payments, and subscription support"
        if (/billing|payments?|subscriptions?|invoic|e-commerce|checkout|portal|dashboard/i.test(clean)) {
            const reqs = [];
            if (/billing/i.test(clean)) reqs.push('billing');
            if (/payments?/i.test(clean)) reqs.push('payments');
            if (/subscriptions?/i.test(clean)) reqs.push('subscriptions');
            if (/invoic/i.test(clean)) reqs.push('invoicing');
            if (/e-commerce/i.test(clean)) reqs.push('e-commerce');
            if (reqs.length > 0) {
                this.factsCollected.key_requirements = reqs;
                if (!this.factsCollected.project_description) {
                    this.factsCollected.project_description = clean;
                }
            }
        }

        // Technical preferences (or non-technical indicators)
        if (/react|angular|vue|next\.?js|node|python|django|flask|flutter|react native|aws|azure|sql|postgres|mongodb/i.test(clean)) {
            this.factsCollected.tech_preference = clean;
        } else if (/don'?t know|not technical|no idea|not sure|you (?:can )?decide|whatever you recommend|recommend the best|team can recommend/i.test(clean)) {
            this.factsCollected.tech_preference = 'Team recommendation';
            this.factsCollected.is_non_technical = true;
        }

        // Project timeline pattern (including unusual timelines like "thousand years")
        const timelineMatch = clean.match(/\b(urgent|asap|immediately|next month|within \d+ (?:weeks?|months?)|in \d+ (?:weeks?|months?|years?)|in a thousand years|\d+ years?)\b/i);
        if (timelineMatch) {
            this.factsCollected.project_timeline = timelineMatch[0];
            this.factsCollected.timeline = timelineMatch[0];
        }

        // Callback time pattern
        if (/tomorrow|monday|tuesday|wednesday|thursday|friday|pm|am|\d+\s*(?:am|pm|o'clock)/i.test(clean)) {
            this.factsCollected.callback_time = clean;
        }

        // Follow-up preference
        if (/no[,.]?\s*(?:i don'?t want|not interested|no information|don'?t send)/i.test(clean)) {
            this.factsCollected.followup_preference = 'declined';
        } else if (/email|mail|send (?:me )?(?:information|details|profile)/i.test(clean)) {
            this.factsCollected.followup_preference = 'email';
        } else if (/discuss|call|meeting|talk with team/i.test(clean)) {
            this.factsCollected.followup_preference = 'meeting';
        }
    }

    _isFieldSufficientlyKnown(field) {
        if (field === 'notice_period_days' && this.factsCollected.notice_period_days !== undefined) return true;
        if (field === 'experience_years' && this.factsCollected.experience_years !== undefined) return true;
        if (field === 'business_email' && this.factsCollected.business_email !== undefined) return true;
        if (field === 'service_needed' && this.factsCollected.service_needed !== undefined) return true;
        if (field === 'project_timeline' && this.factsCollected.project_timeline !== undefined) return true;
        if (field === 'tech_preference' && this.factsCollected.tech_preference !== undefined) return true;
        if (field === 'project_description' && this.factsCollected.project_description !== undefined) return true;
        return false;
    }

    _textSimilarity(a, b) {
        if (!a || !b) return 0;
        const cleanA = a.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const cleanB = b.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        if (cleanA === cleanB) return 1.0;
        const wordsA = new Set(cleanA.split(/\s+/));
        const wordsB = new Set(cleanB.split(/\s+/));
        const intersection = [...wordsA].filter(w => wordsB.has(w));
        return (intersection.length * 2) / (wordsA.size + wordsB.size);
    }
}

export default ConversationMemory;
