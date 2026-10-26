/**
 * services/question_tracker.js
 *
 * Deterministic per-call record of which questions were asked and answered. The call decides from this
 * record, never from the AI's memory, whether a question may be asked again:
 *  - a question is "asked" when its audio actually starts playing, and "played" when playback ends
 *  - a question is "answered" when the caller gives a relevant answer (not a filler, a "what do you mean?"
 *    or an "and then?")
 *  - two questions are the same when they ask for the same thing (topic), however they are worded
 *  - a reply whose question repeats an asked/answered topic is swapped for the next unanswered plan question
 *
 * Pure JavaScript with no I/O, so every rule can be tested without a phone call.
 */

const norm = (s) => String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Splits text into sentences, keeping the punctuation (also the Hindi danda). */
export function splitSentences(text) {
    return String(text ?? '')
        .split(/(?<=[.?!।])\s+/)
        .map(s => s.trim())
        .filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// What a question is about
// ---------------------------------------------------------------------------------------------

const TECH_WORDS = /\b(technolog\w+|tech stack|stack|framework\w*|librar\w+|programming|languages?|tools?|front-?end|front end|back-?end|back end|full-?stack|database\w*|react\w*|node\w*|angular\w*|vue|python|java|javascript|typescript|django|flask|spring|\.net|sql|mongodb|aws|azure|docker|kubernetes|sap|abap|fico|cloud|devops)\b/;
const USE_WORDS = /\b(use|used|using|work|worked|working|hands-?on|experience|comfortable|proficien\w+|specializ\w+|skilled|expertise|familiar|exposure)\b/;

/** Topic rules, most specific first. The first match is the question's topic. */
const TOPIC_RULES = [
    ['permission', t => /(good|convenient|right|suitable) (time|moment)|time to (talk|speak|chat)|(talk|speak|chat) for (a|one|two|few) (minute|min)|(a couple of|a few|one|two) minutes?/.test(t)],
    ['identity', t => /(am i|is this).{0,14}(speaking|talking)|speaking with/.test(t)],
    ['candidate_questions', t => /questions for me|any questions (about|you have)|before we wrap up|anything else (you'd|you would|i can|that|to add)|anything else you/.test(t)],
    ['notice_period', t => /notice period|how soon (can|could) you|when (can|could) you (join|start)|joining date|earliest.{0,20}(join|start|available)|serving (your )?notice/.test(t)],
    ['salary', t => /\b(salary|ctc|compensation|package|pay expectation|expected pay|lpa)\b/.test(t)],
    ['location', t => /\b(location|relocat\w*|remote|hybrid|on-?site|which city)\b|work(ing)? (mode|arrangement)|work from office|where are you (based|located|currently)/.test(t)],
    ['experience_years', t => /how many years|years of (\w+ ){0,3}experience|total experience|how long have you (been|worked)/.test(t)],
    ['tech_preference', t => /technical preferences|recommend the best approach|preferred (tech|technolog)/.test(t)],
    ['tech_stack', t => TECH_WORDS.test(t) && USE_WORDS.test(t)],
    ['current_employer', t => /(current|present|last|previous|recent) (company|employer|organi[sz]ation|job|role|designation|position)|where (are you|do you) (currently )?work|which company/.test(t)],
    ['experience_overview', t => /(tell|share|walk|describe|talk).{0,30}(experience|background|journey|career)|recent.{0,20}experience|your (professional )?background/.test(t)],
    ['project_description', t => /(tell|share|describe).{0,30}(project|requirement)|what you(?:'re| are) looking for|what you need|main requirements|project requirements|explain your project/.test(t)],
    ['projects', t => /\bprojects?\b/.test(t) && /(work|built|develop|handled|deliver|describe|tell|share)/.test(t)],
    ['service_needed', t => /looking for (any )?(services?|help)|service or project|exploring any services/.test(t)],
    ['followup_offer', t => /send you (some )?information|discuss your requirements|company (profile|information)|(call|phone).{0,60}in[- ]person/.test(t)],
    ['education', t => /\b(education|degree|qualification|graduat\w+|university|college)\b/.test(t)],
    ['interview_slot', t => /\b(interview|slot|schedule|meeting)\b.{0,30}\b(day|time|when|available|suit)|which day|what day|what time/.test(t)],
    ['issue_description', t => /(what|which) (issue|problem)|describe (the|your) (issue|problem)|what seems to be|facing/.test(t)],
    ['account_identifier', t => /(order|ticket|account|reference|registered).{0,20}(number|id|email|phone)/.test(t)]
];

/** What each campaign-plan field collects, for plan items whose text hides the topic. */
const FIELD_TOPIC = {
    is_available: 'permission',
    experience_years: 'experience_years',
    experience_summary: 'experience_overview',
    technical_skills: 'tech_stack',
    skills: 'tech_stack',
    notice_period_days: 'notice_period',
    location_preference: 'location',
    expected_salary: 'salary',
    candidate_inquiry: 'candidate_questions',
    service_needed: 'service_needed',
    project_description: 'project_description',
    tech_preference: 'tech_preference'
};

/** The last question in a piece of speech (what the caller is being asked), or ''. */
export function questionPart(text) {
    const qs = splitSentences(text).filter(s => s.includes('?') || s.includes('？'));
    return qs.length ? qs[qs.length - 1] : '';
}

/** The topic a question is about, or null when it is not recognisably about one thing. */
export function topicOf(text) {
    const t = norm(text);
    if (!t) return null;
    for (const [topic, test] of TOPIC_RULES) {
        if (test(t)) return topic;
    }
    return null;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'you', 'your', 'me', 'my', 'is', 'are', 'was', 'were', 'do', 'did', 'does', 'have', 'has', 'had', 'can', 'could', 'would', 'will', 'tell', 'about', 'what', 'which', 'how', 'it', 'that', 'this', 'at', 'be', 'bit', 'little', 'please']);
const contentTokens = (s) => norm(s).split(' ').filter(w => w && !STOP.has(w));

/** 0..1 word overlap between two pieces of text (works in any language with spaces). */
export function similarity(a, b) {
    const A = new Set(contentTokens(a));
    const B = new Set(contentTokens(b));
    if (!A.size || !B.size) return 0;
    let shared = 0;
    for (const w of A) if (B.has(w)) shared++;
    return shared / Math.min(A.size, B.size);
}

// ---------------------------------------------------------------------------------------------
// What a caller turn is
// ---------------------------------------------------------------------------------------------

const FILLER_WORDS = new Set(['yes', 'yeah', 'yep', 'yup', 'ya', 'ok', 'okay', 'sure', 'hmm', 'hm', 'mm', 'mmm', 'mhm', 'mmhmm', 'uh', 'um', 'uhhuh', 'huh', 'right', 'fine', 'alright', 'haan', 'ha', 'haa', 'achha', 'acha', 'theek', 'hai', 'avunu', 'sare', 'oh', 'ah', 'so', 'well', 'of', 'course', 'absolutely', 'definitely', 'certainly', 'no', 'nope', 'nah', 'please', 'thanks', 'thank', 'you']);

/** True for "yeah", "uh-huh", "of course", "okay sure": words that carry no information. */
export function isFillerOnly(transcript) {
    const words = norm(transcript).replace(/-/g, '').split(' ').filter(Boolean);
    if (!words.length) return true;
    return words.length <= 4 && words.every(w => FILLER_WORDS.has(w));
}

/** "Uh-huh", "mm-hmm": the caller is following along or agreeing, not asking for anything. */
export function isAffirmativeMurmur(transcript) {
    const c = norm(transcript).replace(/-/g, '').replace(/\s+/g, '');
    return ['uhhuh', 'mhm', 'mhmm', 'mmhmm', 'mmhm', 'uhhuhm'].includes(c);
}

/**
 * True for a question the caller can answer with "yes" or "no" ("Are you comfortable with remote work?").
 * "Could you tell me about X?" is a request for information, so a bare "yes" does not answer it.
 */
export function isYesNoQuestion(question) {
    const q = norm(questionPart(question) || question);
    if (!q) return false;
    if (/^(could|can|would|will) you (please )?(tell|share|describe|walk|explain|give|briefly|list|outline|elaborate)/.test(q)) return false;
    if (/\b(how|what|which|when|where|why|who|whom|whose)\b/.test(q.split(' ').slice(0, 4).join(' '))) return false;
    return /^(do|does|did|are|is|am|can|could|would|will|have|has|had|were|was|should|shall)\b/.test(q)
        || /^(hello|hi|okay|ok|great|thanks|thank you|sure|got it|so|and|perfect|alright),? (do|does|are|is|can|could|would|will|have)\b/.test(q);
}

/** "What do you mean?", "Could you repeat that?", "What is this call about?", "Who is this?" */
export function isClarificationRequest(transcript) {
    const t = norm(transcript);
    if (!t) return false;
    if (/^(sorry|pardon|what|huh|come again|excuse me)$/.test(t)) return true;
    if (/what do you mean|didn'?t (get|catch|understand|hear)|(can|could) you (please )?(repeat|explain|clarify|say)|i (didn'?t|did not|don'?t) (understand|follow|get)|say that again|what was (that|the question)|which (one|part)|explain (that|the question)|phir se|samajh nahi|ardham kaledu|malli cheppandi/.test(t)) return true;
    // Inquiry on identity, purpose or company (e.g. "what is this call about?", "who is this?", "why are you calling?")
    if (/\b(what (?:is|was|s) (?:this|the) (?:call )?(?:all )?(?:about|regarding|for)|why (?:are you|did you|you) (?:calling|call)|who (?:is|are) (?:this|you|calling|speaking)|(?:what is|whats) (?:the )?purpose of (?:this |the )?call|which company|what company|where are you calling from|what do you want|what do you need)\b|kis (?:liye|baare|bare) mein|kaun bol raha|deni gurinchi|denikosam|enduku call|endukani call|evaru matladedi/i.test(t)) return true;
    // Any question asked when caller message is an interrogative or contains question mark
    if (String(transcript).includes('?') && /^(what|why|who|where|how|which|can|could|is this)\b/i.test(t)) return true;
    return false;
}

/** "And then?", "Please continue", "Go on". */
export function isContinuationPrompt(transcript) {
    const t = norm(transcript);
    return /^(and then|then what|and|so|go on|continue|carry on|keep going|what next|next|yes please continue|please continue|please go on|go ahead please)$/.test(t);
}

const ACK_OPENERS = new Set(['of', 'sure', 'absolutely', 'certainly', 'great', 'thanks', 'thank', 'got', 'understood', 'okay', 'ok', 'perfect', 'alright', 'right', 'noted', 'i', 'wonderful', 'excellent', 'good', 'nice', 'no', 'definitely', 'that', 'cool', 'awesome', 'fine', 'yes', 'yeah', 'indeed']);
const ACK_WORDS = new Set([...ACK_OPENERS, 'course', 'you', 'for', 'sharing', 'it', 'see', 'problem', 'thing', 'makes', 'sense', 'appreciate', 'helpful', 'the', 'info', 'information', 'details', 'telling', 'me', 'that', 'this', 'so', 'much', 'very', 'really', 'understand', 'and']);

/**
 * True for a sentence that is only an acknowledgement: "Of course.", "Got it.", "Sure, got it.",
 * "Great, thanks for sharing." (a short sentence made only of acknowledgement words).
 */
export function isAcknowledgement(sentence) {
    const s = String(sentence ?? '').trim();
    if (!s || s.includes('?')) return false;
    const words = norm(s).replace(/-/g, ' ').split(' ').filter(Boolean);
    if (!words.length || words.length > 6) return false;
    return ACK_OPENERS.has(words[0]) && words.every(w => ACK_WORDS.has(w));
}

/** Callers answer a few questions in one word ("immediate", "remote", "30 days"). */
function looksLikeShortAnswer(transcript) {
    return /\d/.test(transcript) || /\b(immediate\w*|remote|hybrid|onsite|on-site|fresher|none|nothing)\b/i.test(transcript);
}

// ---------------------------------------------------------------------------------------------
// The tracker
// ---------------------------------------------------------------------------------------------

const REASK_LIMIT = 2;               // a topic may be asked at most this many times, even when unanswered
const SHORT_ANSWER_WORDS = 6;        // an answer shorter than this may get one follow-up on the same topic

export const CALL_STAGES = Object.freeze({
    GREETING: 'GREETING',
    WAITING_FOR_AVAILABILITY: 'WAITING_FOR_AVAILABILITY',
    SCREENING: 'SCREENING',
    CLOSING: 'CLOSING'
});

/** Maps the call's working stage label onto the three call phases. */
export function callStageFor(currentStage) {
    const s = String(currentStage || '').toUpperCase();
    if (s === 'GREETING') return CALL_STAGES.GREETING;
    if (s === 'AVAILABILITY' || s === 'PERMISSION_CHECK') return CALL_STAGES.WAITING_FOR_AVAILABILITY;
    if (s === 'CLOSING' || s === 'COMPLETED') return CALL_STAGES.CLOSING;
    return CALL_STAGES.SCREENING;
}

export class QuestionTracker {
    constructor({ callId = '', service = 'recruitment', language = 'en' } = {}) {
        this.callId = callId;
        this.serviceType = String(service || 'recruitment').toLowerCase();
        this.currentLanguage = language;
        this.turnId = 0;
        this.callStage = CALL_STAGES.GREETING;
        this.currentQuestionId = null;
        this.currentQuestionText = '';
        this.pendingQuestionId = null;
        this.askedQuestionIds = [];
        this.answeredQuestionIds = [];
        this.lastCallerTranscript = '';
        this.lastAssistantResponse = '';
        this.lastCallerTurnKind = 'none';

        this.entries = [];           // one per distinct question: { id, text, topic, asks, answered, answerWords, followUps, started, played }
        this.plan = [];
        this.recentOpeners = [];     // acknowledgement each of the last replies opened with ('' when none)
    }

    /** Remembers the campaign's question plan so asked questions can be matched to plan ids. */
    registerPlan(plan) {
        this.plan = Array.isArray(plan)
            ? plan.filter(Boolean).map((item, idx) => ({
                ...item,
                id: item.id || `plan_${idx + 1}`,
                text: item.text || item.question || '',
                topic: FIELD_TOPIC[item.field_to_collect] || topicOf(item.text || item.question || '')
            }))
            : [];
    }

    setLanguage(language) { if (language) this.currentLanguage = language; }
    setTurn(turnId) { this.turnId = turnId; }
    syncStage(currentStage) { this.callStage = callStageFor(currentStage); }

    /** Plan id for a spoken question: an exact text match first, then the plan item about the same topic. */
    _matchPlanId(question, topic) {
        const nq = norm(question);
        const exact = this.plan.find(p => norm(p.text) === nq);
        if (exact) return exact.id;
        if (topic) {
            const same = this.plan.find(p => p.topic === topic && !this.askedQuestionIds.includes(p.id));
            if (same) return same.id;
        }
        const alike = this.plan.find(p => similarity(p.text, question) >= 0.75 && !this.askedQuestionIds.includes(p.id));
        return alike ? alike.id : null;
    }

    _entryByTopic(topic) {
        return topic ? this.entries.filter(e => e.topic === topic) : [];
    }

    /**
     * A response has started playing. If it contains a question, that question is now "asked".
     * (Playback is tracked separately: see noteResponsePlayed.)
     */
    noteResponseStarted(text, { questionId = null, turnId = this.turnId } = {}) {
        this.lastAssistantResponse = String(text ?? '');
        const q = questionPart(text);
        const sentences = splitSentences(text);
        const opener = sentences.length && isAcknowledgement(sentences[0]) ? norm(sentences[0]) : '';
        this.recentOpeners.push(opener);
        if (this.recentOpeners.length > 4) this.recentOpeners.shift();
        if (!q) return null;

        const topic = topicOf(q);
        const id = questionId || this._matchPlanId(q, topic) || `q_${this.entries.length + 1}`;
        let entry = this.entries.find(e => e.id === id)
            || (topic ? this.entries.find(e => e.topic === topic && !e.answered) : null);
        if (entry) {
            entry.asks += 1;
            entry.text = q;
        } else {
            entry = { id, text: q, topic, asks: 1, answered: false, answerWords: 0, followUps: 0, started: true, played: false, turnId };
            this.entries.push(entry);
        }
        entry.started = true;
        if (!this.askedQuestionIds.includes(entry.id)) this.askedQuestionIds.push(entry.id);
        this.currentQuestionId = entry.id;
        this.currentQuestionText = q;
        this.pendingQuestionId = entry.id;
        return entry;
    }

    /** The audio of the latest response has finished playing on the phone. */
    noteResponsePlayed() {
        const e = this.entries.find(x => x.id === this.currentQuestionId);
        if (e) e.played = true;
    }

    /**
     * Classifies the caller's turn and, when it is a real answer, marks the pending question answered.
     * @returns {'filler'|'clarification'|'continuation'|'answer'|'empty'}
     */
    noteCallerTurn(transcript, { turnId = this.turnId } = {}) {
        this.turnId = turnId;
        this.lastCallerTranscript = String(transcript ?? '');
        let kind;
        if (!norm(transcript)) kind = 'empty';
        else if (isClarificationRequest(transcript)) kind = 'clarification';
        else if (isContinuationPrompt(transcript)) kind = 'continuation';
        else if (isFillerOnly(transcript) && !looksLikeShortAnswer(transcript)) kind = 'filler';
        else kind = 'answer';
        this.lastCallerTurnKind = kind;

        if (kind === 'answer' && this.pendingQuestionId) {
            const e = this.entries.find(x => x.id === this.pendingQuestionId);
            if (e) {
                e.answered = true;
                e.answerWords = norm(transcript).split(' ').filter(Boolean).length;
                if (!this.answeredQuestionIds.includes(e.id)) this.answeredQuestionIds.push(e.id);
            }
            this.pendingQuestionId = null;
        }
        // "Yes" / "no" / "of course" answers a yes-no question ("is this a good time?", "comfortable with remote?"),
        // whatever its length. It does not answer a request such as "could you tell me about your experience?".
        if (kind === 'filler' && this.pendingQuestionId) {
            const e = this.entries.find(x => x.id === this.pendingQuestionId);
            if (e && (e.topic === 'permission' || e.topic === 'identity' || isYesNoQuestion(e.text))) {
                e.answered = true;
                e.answerWords = Math.max(e.answerWords, 6); // a yes/no is a complete answer: no follow-up on the same topic
                if (!this.answeredQuestionIds.includes(e.id)) this.answeredQuestionIds.push(e.id);
                this.pendingQuestionId = null;
            }
        }
        return kind;
    }

    /**
     * Whether a question may be asked now.
     * @returns {{ duplicate: boolean, of?: string, reason?: string }}
     */
    checkQuestion(question, { clarification = false, dryRun = false } = {}) {
        const q = String(question ?? '').trim();
        if (!q) return { duplicate: false };
        if (clarification) return { duplicate: false, reason: 'clarification_of_current_question' };

        const topic = topicOf(q);
        if (topic) {
            const same = this._entryByTopic(topic);
            for (const e of same) {
                if (e.answered) {
                    // One follow-up is allowed when the first answer was too short to be complete.
                    if (e.answerWords < SHORT_ANSWER_WORDS && e.followUps < 1) {
                        if (!dryRun) e.followUps += 1;
                        return { duplicate: false, reason: 'follow_up_on_short_answer' };
                    }
                    return { duplicate: true, of: e.id, reason: `topic "${topic}" already answered` };
                }
                if (e.asks >= REASK_LIMIT) return { duplicate: true, of: e.id, reason: `topic "${topic}" already asked ${e.asks} times` };
                if (this.lastCallerTurnKind === 'answer') return { duplicate: true, of: e.id, reason: `topic "${topic}" asked and the caller replied` };
            }
            return { duplicate: false };
        }

        // No recognisable topic: fall back to word overlap with questions already asked.
        for (const e of this.entries) {
            if (e.started && similarity(e.text, q) >= 0.7 && (e.answered || e.asks >= REASK_LIMIT)) {
                return { duplicate: true, of: e.id, reason: 'wording nearly identical to an earlier question' };
            }
        }
        return { duplicate: false };
    }

    /** True when the call has already asked (or been answered) this plan item's topic. */
    _planItemDone(item, { isFieldKnown = null } = {}) {
        if (this.askedQuestionIds.includes(item.id)) return true;
        if (item.topic === 'permission') return true; // consent is asked in the greeting, never again
        if (item.topic && this._entryByTopic(item.topic).some(e => e.started)) return true;
        if (isFieldKnown && item.field_to_collect && isFieldKnown(item.field_to_collect)) return true;
        return false;
    }

    /** The next plan question that has not been asked, or the wrap-up question once, or null. */
    nextUnanswered({ isFieldKnown = null } = {}) {
        for (const item of this.plan) {
            if (this._planItemDone(item, { isFieldKnown })) continue;
            return item;
        }
        const wrap = this.plan.find(p => p.topic === 'candidate_questions');
        if (wrap && !this.askedQuestionIds.includes(wrap.id)) return wrap;
        return null;
    }

    /**
     * Checks an AI reply before it is spoken.
     *  - a question that repeats an asked/answered topic is replaced by the next unanswered plan question
     *  - an acknowledgement that opened the last reply too is dropped
     *  - a reply that is only an acknowledgement gets the next plan question (so the call never goes quiet)
     * @returns {{ text: string, changed: boolean, notes: string[], kind: string }}
     */
    /** True when this acknowledgement would be the same opener as the last reply, or the third acknowledgement in a row. */
    wouldRepeatOpener(sentence) {
        if (!isAcknowledgement(sentence)) return false;
        const opener = norm(sentence);
        const last = this.recentOpeners.slice(-2);
        return last[last.length - 1] === opener || (last.length === 2 && last.every(Boolean));
    }

    /**
     * Checks an AI reply before it is spoken.
     *  - an acknowledgement that opened the last reply too is dropped
     *  - a question that repeats an asked/answered topic is replaced by the next unanswered plan question
     *    (only when enforceQuestions is on; otherwise it is only reported in the notes)
     *  - a reply that is only an acknowledgement gets the next plan question, so the call never goes quiet
     * @returns {{ text: string, changed: boolean, notes: string[], kind: string, replacedWith: string|null, exhausted: boolean }}
     */
    guardReply(text, { clarification = false, requireQuestion = false, shouldEnd = false, enforceQuestions = true, isFieldKnown = null } = {}) {
        const notes = [];
        let sentences = splitSentences(text);
        if (!sentences.length) return { text: String(text ?? ''), changed: false, notes, kind: 'empty', replacedWith: null, exhausted: false };
        const original = sentences.join(' ');
        let exhausted = false;

        // 1. Repeated opener: "Of course." twice in a row, or an acknowledgement on three replies in a row.
        if (sentences.length > 1 && this.wouldRepeatOpener(sentences[0])) {
            notes.push(`dropped repeated acknowledgement "${norm(sentences[0])}"`);
            sentences = sentences.slice(1);
        }

        // 2. A question that repeats an asked/answered topic.
        const qIdx = (() => { for (let i = sentences.length - 1; i >= 0; i--) if (sentences[i].includes('?')) return i; return -1; })();
        let replacedWith = null;
        if (qIdx >= 0 && !shouldEnd) {
            const verdict = this.checkQuestion(sentences[qIdx], { clarification, dryRun: !enforceQuestions });
            if (verdict.duplicate) {
                if (!enforceQuestions) {
                    notes.push(`duplicate question detected (${verdict.reason}); kept because this service has no question plan`);
                } else {
                    const next = this.nextUnanswered({ isFieldKnown });
                    if (next && !this.checkQuestion(next.text, { dryRun: true }).duplicate) {
                        notes.push(`replaced duplicate question (${verdict.reason}) with plan question ${next.id}`);
                        sentences[qIdx] = next.text;
                        replacedWith = next.id;
                    } else {
                        notes.push(`removed duplicate question (${verdict.reason}); no unanswered plan question left`);
                        sentences.splice(qIdx, 1);
                        exhausted = !next;
                    }
                }
            }
        }

        // 3. Only an acknowledgement, with nothing left to ask: add the next question so the caller is not left waiting.
        const hasQuestion = sentences.some(s => s.includes('?'));
        const ackOnly = sentences.length > 0 && sentences.every(isAcknowledgement);
        if (enforceQuestions && !hasQuestion && !shouldEnd && !clarification && (requireQuestion || ackOnly) && (ackOnly || sentences.join(' ').split(/\s+/).length <= 8)) {
            const next = this.nextUnanswered({ isFieldKnown });
            if (next) {
                notes.push(`added next plan question ${next.id} to an acknowledgement-only reply`);
                sentences.push(next.text);
                replacedWith = replacedWith || next.id;
            }
        }

        const out = sentences.join(' ').trim() || String(text ?? '').trim();
        const kind = shouldEnd ? 'ending'
            : clarification ? 'clarification'
                : sentences.some(s => s.includes('?')) ? 'screening_question'
                    : (sentences.length && sentences.every(isAcknowledgement) ? 'acknowledgement' : 'statement');
        return { text: out, changed: out !== original, notes, kind, replacedWith, exhausted };
    }
}

/**
 * Removes the sentences of a full reply that were already spoken (by early streaming), so the caller
 * never hears the same acknowledgement or question twice.
 */
export function stripAlreadySpoken(fullText, spokenSentences = []) {
    const spoken = (spokenSentences || []).map(s => String(s ?? '').trim()).filter(Boolean);
    const sentences = splitSentences(fullText);
    if (!spoken.length) return sentences.join(' ');
    const matchesSpoken = (s) => spoken.some(sp =>
        norm(sp) === norm(s)
        || similarity(sp, s) >= 0.7
        || (isAcknowledgement(sp) && isAcknowledgement(s)));
    let i = 0;
    while (i < sentences.length && matchesSpoken(sentences[i])) i++;
    return sentences.slice(i).filter(s => !spoken.some(sp => norm(sp) === norm(s))).join(' ').trim();
}

export default QuestionTracker;
