import db, { utcNow } from './db.js';
import ElevenLabsService from './elevenlabs_service.js';
import GeminiService from './gemini_service.js';
import IntentService from './intent_service.js';
import LatencyTracker from './latency_tracker.js';
import ConversationMemory from './conversation_memory.js';
import ScreeningEvaluator from './screening_evaluator.js';
import AgentService, { ensureAgentSchema } from './agent_service.js';

/**
 * services/voicebot_stream_service.js
 * 
 * Ultra-Low Latency Bidirectional Plivo Audio Streaming <-> ElevenLabs Voice Pipeline.
 * 
 * Performance & Conversational Architecture:
 * 1. Immediate Opening Greeting:
 *    - In-memory contact initialization from Plivo SIP/XML headers.
 *    - Exact-once greeting delivery triggered in < 1ms of audio session ready.
 *    - Zero blocking DB queries, zero LLM calls on startup.
 *    - Instant RAM-cached TTS audio playback.
 * 2. Deterministic Intent Fast-Path:
 *    - Evaluates short answers ("yes", "no", "okay", "repeat that", "can you hear me") in < 1ms.
 *    - Combines acknowledgment + next interview question in a single turn.
 *    - Bypasses LLM API calls entirely for common turns.
 * 3. Adaptive Silence Detection (VAD):
 *    - 18 frames (~360ms) for brief utterances ("yes", "ok", "no").
 *    - 24 frames (~480ms) for longer responses, preventing accidental cutoff.
 *    - Lowered audio threshold to 1600 bytes (200ms) to prevent dropping quick affirmations.
 * 4. Barge-In & Interruption:
 *    - Sustained caller speech (> 700ms) while AI speaks cancels pending audio,
 *      sends Plivo clearAudio event, and transitions smoothly to listening.
 *    - Ignores brief backchannels ("uh-huh", "hmm", breath noise).
 * 5. Structured Latency Monitoring:
 *    - Precision timestamp tracking across VAD, STT, Decision, and TTS stages.
 *    - Computes p50, p95, min, and max response metrics per call.
 * 
 * FIXES APPLIED (2026-10-15):
 *  FIX-1: isProcessingTurn is now cleared AFTER playAiAudio completes, not before.
 *         This prevents concurrent turns from running simultaneously.
 *  FIX-2: Noise transcripts ([indistinct], [phone ringing], etc.) are filtered
 *         before reaching the LLM, preventing 6s+ wasted Gemini calls.
 *  FIX-3: Stage advancement for sales is now tracked correctly — audibility check
 *         preserves current stage, and stage stays advanced after first real response.
 *  FIX-4: LLM timeout raised to 6000ms for Claude and 7000ms for Gemini fallback
 *         to reduce unnecessary "operation aborted" errors on slow networks.
 *  FIX-5: latency TOTAL is now always recorded even on LLM error paths.
 *  FIX-6: Per-turn ID guard (turnId) prevents duplicate processing of the same turn.
 *  FIX-7: dispatchAudioBuffer duration calculation uses correct ulaw_8000 byte rate (8000 bytes/sec).
 */

// G.711 mu-law expansion lookup table (converts 8-bit mu-law to 16-bit linear PCM)
const MULAW_TO_PCM16 = new Int16Array(256);
for (let i = 0; i < 256; i++) {
    let input = ~i;
    let sign = (input & 0x80);
    let exponent = (input >> 4) & 0x07;
    let mantissa = input & 0x0F;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    MULAW_TO_PCM16[i] = sign !== 0 ? -sample : sample;
}

/**
 * Decodes 8kHz 8-bit mu-law buffer into 16-bit Linear PCM buffer.
 */
export function decodeMulawToPcm16(mulawBuf) {
    if (!mulawBuf || mulawBuf.length === 0) return Buffer.alloc(0);
    const pcm = Buffer.alloc(mulawBuf.length * 2);
    for (let i = 0; i < mulawBuf.length; i++) {
        const val = MULAW_TO_PCM16[mulawBuf[i]];
        pcm.writeInt16LE(val, i * 2);
    }
    return pcm;
}

/**
 * Calculates Root Mean Square (RMS) audio energy of 16-bit mono PCM.
 */
export function calculateRms(pcmBuffer) {
    if (!pcmBuffer || pcmBuffer.length < 2) return 0;
    const numSamples = Math.floor(pcmBuffer.length / 2);
    let sumSq = 0;
    for (let i = 0; i < numSamples; i++) {
        const val = pcmBuffer.readInt16LE(i * 2);
        sumSq += val * val;
    }
    return Math.sqrt(sumSq / numSamples);
}

/**
 * Wraps 16-bit Linear PCM mono bytes into a valid 44-byte RIFF WAV container.
 */
export function pcmToWav(pcmBuffer, sampleRate = 8000, channels = 1, bitsPerSample = 16) {
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcmBuffer.length;
    const chunkSize = 36 + dataSize;

    header.write('RIFF', 0);
    header.writeUInt32LE(chunkSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);            // Subchunk1Size
    header.writeUInt16LE(1, 20);             // AudioFormat: Linear PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmBuffer]);
}

// Backchannel words that must NOT interrupt AI speech
const COMMON_BACKCHANNELS = new Set([
    'yes', 'yeah', 'yep', 'ok', 'okay', 'hmm', 'hmmm', 'mhm', 'uh-huh', 'uh huh',
    'right', 'sure', 'fine', 'got it', 'i see', 'understood', 'cool',
    'haan', 'ha', 'achha', 'acha', 'theek', 'sahi',
    'avunu', 'sare', 'alaage', 'alage', 'correct', 'yup', 'alright'
]);

export function isBackchannelOnly(transcript) {
    if (!transcript) return true;
    const cleaned = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (!cleaned) return true;
    const words = cleaned.split(/\s+/);
    if (words.length <= 2 && words.every(w => COMMON_BACKCHANNELS.has(w))) {
        return true;
    }
    return false;
}

/**
 * FIX-2: Noise transcript filter.
 * Detects and discards STT provider noise labels or artifacts that are not real speech.
 * These come from ElevenLabs Scribe when it cannot identify meaningful speech.
 */
const NOISE_TRANSCRIPT_PATTERNS = [
    /^\[.*\]$/,                              // e.g. [indistinct], [phone ringing], [music]
    /^\(.*\)$/,                              // e.g. (inaudible), (ringing)
    /^<.*>$/,                                // e.g. <noise>, <silence>
    /^\*.*\*$/,                              // e.g. *static*
    /^(inaudible|unintelligible|silence|background noise|static|ringing|noise|music|beep|click)$/i
];

export function isNoiseTranscript(transcript) {
    if (!transcript || !transcript.trim()) return true;
    const t = transcript.trim();
    return NOISE_TRANSCRIPT_PATTERNS.some(p => p.test(t));
}

/**
 * Languages Remo speaks. Speech-to-text sometimes labels a short English phrase as Lithuanian or a name as Urdu;
 * anything outside this set is treated as a wrong guess.
 */
const SUPPORTED_CALL_LANGS = new Set(['en', 'eng', 'hi', 'hin', 'te', 'tel']);

export function isSupportedCallLanguage(code) {
    return SUPPORTED_CALL_LANGS.has(String(code || '').toLowerCase());
}

/** The language to re-run speech-to-text in after a wrong guess: whatever the call has been in so far. */
export function retryLanguageFor(sessionLanguage) {
    const l = String(sessionLanguage || 'en').toLowerCase();
    if (l === 'te' || l === 'tel') return 'tel';
    if (l === 'hi' || l === 'hin') return 'hin';
    return 'eng';
}

// Safety nets so a call can never stay deaf: how long past its audio the "speaking" state may last,
// and the longest one caller turn may keep the bot busy (speech-to-text + AI + voice).
const SPEECH_GRACE_MS = 2000;
const MAX_TURN_MS = 20000;
const HEALTH_CHECK_MS = 5000;
const QUIET_WARN_MS = 5000;

/**
 * Manages a live call session over the Plivo WebSocket stream.
 */
export class CallSession {
    constructor(ws, params = {}) {
        this.ws = ws;
        this.callId = params.callId || `call_${Date.now()}`;
        this.streamId = null;
        this.contactId = params.contactId || '';
        this.service = (params.service || 'recruitment').toLowerCase();
        this.ownerUserId = params.ownerUserId || null;
        this.phone = params.phone || '';
        this.callerName = params.callerName || '';
        this.jobRole = params.role || '';
        this.companyName = params.company || '';
        this.campaignId = params.campaignId || null;
        // Multi-agent: the agent (number, greeting, instructions, voice) this call belongs to.
        this.agentId = params.agentId || '';
        this.direction = params.direction === 'inbound' ? 'inbound' : 'outbound';
        this.agent = null;
        this.campaign = null;
        this.campaignContext = null;
        this.questionPlan = null;
        this.memory = null;
        this.jdMatchScore = null;
        this.screeningResult = null;

        this.startTime = Date.now();
        this.latencyTracker = new LatencyTracker(this.callId);
        this.conversationHistory = [];
        this.collectedData = {};
        this.callStatus = 'in-progress';
        this.classification = 'On Hold';
        this.summary = '';
        this.currentStage = 'AVAILABILITY';
        this.detectedLanguage = 'en';

        // Greeting exact-once guards
        this.greetingDelivered = false;
        this.greetingInProgress = false;

        // Audio & Turn State
        this.isAiSpeaking = false;
        this.aiSpeechEndTime = 0;
        this.currentQuestion = '';
        this.interruptedWithAnswer = false;
        this.activeSpeechTimer = null;
        this.speechSeq = 0;               // bumps every time new speech is scheduled, so an old timer can never end newer speech

        // Call health (see checkHealth)
        this.lastInboundAudioAt = Date.now();
        this.inboundFrames = 0;
        this.processingSince = 0;
        this.lastQuietLogAt = 0;
        this.healthTimer = null;

        // Caller audio accumulation
        this.callerMulawChunks = [];
        this.consecutiveSpeechFrames = 0;
        this.consecutiveSilenceFrames = 0;
        this.isCallerSpeaking = false;

        // Overlap buffer (when caller speaks WHILE AI is speaking)
        this.overlapMulawChunks = [];
        this.overlapSpeechFrames = 0;

        // VAD parameters (20ms frames = 160 mulaw bytes at 8kHz)
        this.ENERGY_THRESHOLD = 450;        // Minimum RMS to count as speech
        this.MIN_INTERRUPT_FRAMES = 35;     // ~700ms of sustained speech while AI speaks triggers barge-in
        this.MIN_AUDIO_BYTES = 1600;        // 200ms of audio minimum to avoid discarding short answers

        // FIX-1 & FIX-6: isProcessingTurn is ONLY cleared after playAiAudio completes.
        // turnId prevents the same utterance from being processed twice.
        this.isProcessingTurn = false;
        this.currentTurnId = 0;
        this.isClosed = false;

        // FIX-3: Stage tracking for preventing repeated questions
        this.stageHistory = [];

        // Synchronous in-memory contact construction: ready IMMEDIATELY with service-appropriate defaults
        let defaultName = 'Customer';
        if (this.service === 'recruitment') defaultName = 'Candidate';
        const cleanName = (this.callerName || '').trim();
        if (cleanName && !cleanName.startsWith('Caller') && !cleanName.startsWith('Candidate') && !cleanName.startsWith('Contact')) {
            defaultName = cleanName;
        }

        this.contact = {
            id: this.contactId || `cnt_${Date.now()}`,
            name: defaultName,
            phone: this.phone || '',
            service: this.service,
            direction: this.direction,
            job_role: this.jobRole || (this.service === 'sales' ? 'IT Solutions'
                : (this.service === 'support' ? 'Technical Support'
                    : (this.service === 'appointment' ? 'your appointment'
                        : (this.service === 'receptionist' ? 'your enquiry' : 'the open position')))),
            company: this.companyName || (this.service === 'sales' ? 'Scorelabs Inc.' : 'Score Labs'),
            preferred_language: 'en'
        };
    }

    /**
     * Initializes the call session.
     * Enriches contact from database with a fast 150ms timeout guard, then delivers opening greeting.
     */
    async init() {
        this.latencyTracker.markSessionReady();
        this.startHealthMonitor();

        // Enforce fast DB enrichment before greeting (with 150ms timeout guard so it never blocks audio)
        await Promise.race([
            this.enrichContactFromDbAsync(),
            new Promise(r => setTimeout(r, 150))
        ]);

        // Initialize structured conversation memory and anti-repetition tracking
        this.memory = new ConversationMemory({
            service: this.service,
            role: this.jobRole || this.contact.job_role,
            candidateName: this.contact.name,
            campaignContext: this.campaignContext,
            questionPlan: this.questionPlan
        });

        // Deliver opening greeting immediately
        await this.deliverOpeningGreeting();
    }

    /**
     * Background DB lookup: updates contact name, role, company, and service if found in DB.
     */
    async enrichContactFromDbAsync() {
        try {
            // The agent decides greeting, instructions and voice. Cached after the Plivo answer step, so this is instant.
            if (this.agentId && !this.agent) {
                try { this.agent = await AgentService.get(this.agentId); } catch (e) { console.warn('[CallSession] Agent lookup note:', e.message); }
                if (this.agent && this.agent.assigned_user_id && !this.ownerUserId) this.ownerUserId = this.agent.assigned_user_id;
            }
            const inbound = this.direction === 'inbound';

            let row = null;
            if (this.contactId) {
                row = await db.get('SELECT * FROM contacts WHERE id = ?', [this.contactId]);
            }
            if (!row && this.callId && !inbound) {
                row = await db.get('SELECT * FROM contacts WHERE provider_call_id = ?', [this.callId]);
            }
            if (!row && inbound && this.phone) {
                // Incoming call: recognise the caller only among this admin's own contacts.
                row = await db.get(
                    'SELECT * FROM contacts WHERE phone LIKE ? AND owner_user_id = ? ORDER BY updated_at DESC LIMIT 1',
                    [`%${this.phone.slice(-10)}%`, this.ownerUserId || '']
                );
            }
            if (!row && this.phone && !inbound) {
                // If service is already known (e.g. sales or support), strictly match within that service first!
                if (this.service && this.service !== 'recruitment') {
                    row = await db.get(
                        'SELECT * FROM contacts WHERE phone LIKE ? AND service = ? ORDER BY updated_at DESC LIMIT 1',
                        [`%${this.phone.slice(-10)}%`, this.service]
                    );
                }
                if (!row) {
                    row = await db.get(
                        'SELECT * FROM contacts WHERE phone LIKE ? ORDER BY updated_at DESC LIMIT 1',
                        [`%${this.phone.slice(-10)}%`]
                    );
                }
            }
            if (!row && !inbound) {
                const qRow = await db.get(`
                    SELECT cq.service as queue_service, c.*
                    FROM call_queue cq JOIN contacts c ON cq.contact_id = c.id
                    WHERE cq.status = 'IN_PROGRESS'
                    ORDER BY cq.updated_at DESC LIMIT 1
                `);
                if (qRow) row = qRow;
            }

            if (row) {
                if (row.service) {
                    this.service = row.service.toLowerCase().trim();
                    this.contact.service = this.service;
                }
                if (row.id) {
                    this.contactId = row.id;
                    this.contact.id = row.id;
                }
                if (row.phone) {
                    this.phone = row.phone;
                    this.contact.phone = row.phone;
                }
                if (row.name && !row.name.startsWith('Contact (Row')) {
                    this.callerName = row.name;
                    this.contact.name = row.name;
                }
                if (row.job_role) {
                    this.jobRole = row.job_role;
                    this.contact.job_role = row.job_role;
                }
                if (row.company) {
                    this.companyName = row.company;
                    this.contact.company = row.company;
                }
                if (row.owner_user_id && !this.ownerUserId) this.ownerUserId = row.owner_user_id;
                if (row.preferred_language) {
                    this.contact.preferred_language = row.preferred_language;
                    this.detectedLanguage = row.preferred_language;
                }
                if (row.campaign_id && !this.campaignId) {
                    this.campaignId = row.campaign_id;
                }
                this.contact = { ...this.contact, ...row, service: this.service, name: this.contact.name };
                console.log(`[CallSession] Contact enriched from DB for ${this.contact.name} (${this.phone || 'N/A'}) — Service: ${this.service.toUpperCase()}`);
            }

            // An outgoing call placed from a stamped contact keeps its agent even when it was only found in the DB.
            if (!this.agent && row && row.agent_id) {
                try { this.agent = await AgentService.get(row.agent_id); this.agentId = row.agent_id; } catch { /* default behaviour */ }
            }

            // Load Campaign Configuration & Question Plan if linked to a Campaign
            if (this.campaignId) {
                try {
                    const camp = await db.get('SELECT * FROM campaigns WHERE id = ?', [this.campaignId]);
                    if (camp) {
                        this.campaign = camp;
                        if (camp.service) {
                            this.service = camp.service.toLowerCase().trim();
                            this.contact.service = this.service;
                        }
                        if (camp.extracted_data) {
                            try {
                                this.campaignContext = typeof camp.extracted_data === 'string' ? JSON.parse(camp.extracted_data) : camp.extracted_data;
                            } catch (e) {
                                this.campaignContext = { raw: camp.extracted_data };
                            }
                        }
                        if (this.campaignContext && this.campaignContext.job_title && (!this.jobRole || this.jobRole === 'the open position')) {
                            this.jobRole = this.campaignContext.job_title;
                            this.contact.job_role = this.campaignContext.job_title;
                        }
                        if (camp.question_plan) {
                            try {
                                this.questionPlan = typeof camp.question_plan === 'string' ? JSON.parse(camp.question_plan) : camp.question_plan;
                            } catch (e) {
                                this.questionPlan = null;
                            }
                        }
                        console.log(`[CallSession] Loaded campaign "${camp.name}" (${camp.id}) — Service: ${camp.service}`);
                    }
                } catch (campErr) {
                    console.warn('[CallSession] Campaign lookup note:', campErr.message);
                }
            }

            // Incoming calls, and calls taken by an appointment-setting or receptionist agent, are handled
            // as the agent's work type. This runs last so a campaign or contact row cannot override it.
            if (AgentService.decidesService(this.agent, this.direction)) {
                this.service = this.agent.service;
                this.contact.service = this.service;
            }
        } catch (e) {
            console.warn('[CallSession] Contact enrichment note:', e.message);
        }
    }

    hasRealCallerName() {
        const n = String((this.contact && this.contact.name) || '').trim();
        return Boolean(n) && !/^(Caller|Candidate|Contact|Customer|Row)/.test(n);
    }

    /**
     * The ElevenLabs voice for this call: the agent's own voice for English/Hindi when it has one,
     * otherwise the default language-based voice (Telugu always keeps its Telugu voice).
     */
    pickVoiceId() {
        if (this.agent && this.agent.voice_id && this.detectedLanguage !== 'te') return this.agent.voice_id;
        return ElevenLabsService.getVoiceIdForLanguage(this.detectedLanguage);
    }

    /**
     * Spoken opening greeting.
     * Spoken exactly once; checks RAM cache for instant < 1ms audio delivery.
     */
    async deliverOpeningGreeting() {
        if (this.greetingDelivered || this.greetingInProgress || this.isClosed) {
            return;
        }

        this.greetingInProgress = true;
        this.latencyTracker.markGreetingStart();

        // An agent with its own greeting says that; {name}, {role}, {company} and {agent} are filled in.
        const agentGreeting = this.agent && this.agent.greeting
            ? AgentService.renderGreeting(this.agent.greeting, {
                name: this.hasRealCallerName() ? this.contact.name : '',
                role: this.contact.job_role,
                company: this.contact.company,
                agent: this.agent.name
            })
            : '';
        const greeting = agentGreeting || GeminiService.getOpeningGreeting(this.service, {
            ...this.contact,
            campaignContext: this.campaignContext
        });
        this.currentQuestion = greeting;
        this.currentStage = 'AVAILABILITY';

        console.log(`[CallSession] Delivering opening greeting: "${greeting.substring(0, 80)}..."`);

        this.conversationHistory.push({
            speaker: 'REMO',
            text: greeting,
            time: '00:01'
        });

        try {
            if (this.memory && typeof this.memory.recordTurn === 'function') {
                this.memory.recordTurn('REMO', greeting);
            }
        } catch (memErr) {
            console.warn('[CallSession] Memory recordTurn non-fatal error:', memErr.message);
        }

        try {
            // 1. Instant Cache Check (< 1ms delivery)
            const voiceId = this.pickVoiceId();
            const modelId = ElevenLabsService.selectTtsModel({ language: this.detectedLanguage, voiceId });
            const cachedAudio = ElevenLabsService.getCachedAudio(greeting, { voiceId, modelId });
            if (cachedAudio) {
                console.log(`[CallSession] Instant cache hit for opening greeting! Dispatching audio in < 5ms.`);
                this.latencyTracker.markGreetingDelivered();
                this.greetingDelivered = true;
                this.greetingInProgress = false;
                await this.dispatchAudioBuffer(cachedAudio, greeting);
                return;
            }

            // 2. Synthesize audio via ElevenLabs
            console.log(`[CallSession] Synthesizing opening greeting via ElevenLabs (${this.detectedLanguage})...`);
            await this.playAiAudio(greeting);
            this.latencyTracker.markGreetingDelivered();
            this.greetingDelivered = true;
            this.greetingInProgress = false;
        } catch (greetErr) {
            console.error('[CallSession] Error delivering greeting:', greetErr.message);
            this.greetingInProgress = false;
        }
    }

    /**
     * Adds a piece of just-sent audio to the time the bot is expected to be speaking until.
     * ulaw_8000 is 8000 bytes per second, and Plivo plays the pieces back to back.
     */
    noteSpeechChunk(bytes) {
        this.aiSpeechEndTime = Math.max(this.aiSpeechEndTime, Date.now()) + (bytes / 8000) * 1000;
    }

    /**
     * Switches the bot back to "listening" when its audio has finished playing (aiSpeechEndTime).
     * A newer piece of speech replaces this timer, and the timer never depends on clock comparisons
     * that could leave the bot stuck in "speaking" (and therefore deaf).
     */
    scheduleSpeechEnd() {
        const seq = ++this.speechSeq;
        if (this.activeSpeechTimer) clearTimeout(this.activeSpeechTimer);
        const wait = Math.max(0, this.aiSpeechEndTime - Date.now());
        this.activeSpeechTimer = setTimeout(() => {
            this.activeSpeechTimer = null;
            if (seq !== this.speechSeq || this.isClosed) return; // newer speech was queued; its own timer decides
            if (this.isAiSpeaking) {
                this.isAiSpeaking = false;
                console.log('[CallSession] AI finished speaking turn. Now listening for caller.');
            }
        }, wait);
    }

    /** Starts the periodic health check for this call. */
    startHealthMonitor() {
        if (this.healthTimer) return;
        this.healthTimer = setInterval(() => this.checkHealth(), HEALTH_CHECK_MS);
        if (typeof this.healthTimer.unref === 'function') this.healthTimer.unref();
    }

    /**
     * Last line of defence against a call going silent. Returns what it fixed (for tests and logs).
     * - A caller turn stuck "busy" for too long is released.
     * - "Speaking" that outlasted its audio is cleared, so the bot listens again.
     * - A long stretch with no audio from the phone is logged, so a dropped stream is easy to spot.
     */
    checkHealth(now = Date.now()) {
        if (this.isClosed) return null;
        if (this.isProcessingTurn && this.processingSince && now - this.processingSince > MAX_TURN_MS) {
            console.warn(`[CallSession] Watchdog: a turn has been busy for ${Math.round((now - this.processingSince) / 1000)}s. Releasing it so the bot can listen again.`);
            this.isProcessingTurn = false;
            this.processingSince = 0;
            return 'processing-reset';
        }
        if (this.isAiSpeaking && now > this.aiSpeechEndTime + SPEECH_GRACE_MS) {
            console.warn('[CallSession] Watchdog: the bot was still marked as speaking after its audio ended. Switching back to listening.');
            this.isAiSpeaking = false;
            if (this.activeSpeechTimer) { clearTimeout(this.activeSpeechTimer); this.activeSpeechTimer = null; }
            return 'speaking-reset';
        }
        const quietMs = now - this.lastInboundAudioAt;
        if (quietMs > QUIET_WARN_MS && now - this.lastQuietLogAt > 10000) {
            this.lastQuietLogAt = now;
            console.warn(`[CallSession] No audio received from the phone for ${Math.round(quietMs / 1000)}s (frames so far: ${this.inboundFrames}; speaking=${this.isAiSpeaking}, busy=${this.isProcessingTurn}). The call may have dropped its audio stream.`);
            return 'no-audio';
        }
        return null;
    }

    /**
     * Sends raw mu-law audio buffer over WebSocket to Plivo.
     *
     * FIX-7: Duration calculation uses correct ulaw_8000 byte rate.
     * ulaw_8000 = 8000 bytes per second (8-bit samples at 8kHz, mono).
     */
    async dispatchAudioBuffer(audioBuffer, text) {
        if (!audioBuffer || this.isClosed) return;

        try {
            this.isAiSpeaking = true;
            // ulaw_8000: 8000 bytes/sec (8-bit PCM, 8kHz mono)
            const durationMs = Math.round((audioBuffer.length / 8000) * 1000);
            this.aiSpeechEndTime = Date.now() + durationMs;

            const payloadBase64 = audioBuffer.toString('base64');
            if (this.ws.readyState === this.ws.OPEN) {
                const playMsg = {
                    event: 'playAudio',
                    media: {
                        contentType: 'audio/x-mulaw',
                        sampleRate: 8000,
                        payload: payloadBase64
                    }
                };
                if (this.streamId) {
                    playMsg.streamId = this.streamId;
                    playMsg.stream_id = this.streamId;
                }
                this.ws.send(JSON.stringify(playMsg));
                console.log(`[CallSession] Sent ${audioBuffer.length} bytes of audio to Plivo (~${durationMs}ms at 8kHz ulaw)`);
            }

            this.scheduleSpeechEnd();

        } catch (e) {
            console.error('[CallSession] dispatchAudioBuffer error:', e.message);
            this.isAiSpeaking = false;
        }
    }

    /**
     * Synthesizes dialogue text via ElevenLabs with caching and dispatches audio to Plivo.
     * Uses automatic language-aware voice routing (Telugu Chaitra vs. English Pari).
     */
    async playAiAudio(text) {
        if (!text || this.isClosed) return;

        try {
            this.currentQuestion = text;
            this.latencyTracker.markTtsStart();

            const voiceId = this.pickVoiceId();
            const modelId = ElevenLabsService.selectTtsModel({ language: this.detectedLanguage, voiceId });
            const voiceName = (voiceId === (process.env.ELEVENLABS_VOICE_ID_CHAITRA || 'oyjIr5XAhIyRjfNq6spl')) ? 'Chaitra (Telugu)' : 'Pari (English/Hindi)';
            console.log(`[CallSession] Voice selected: ${voiceName} (VoiceID: ${voiceId}, Lang: ${this.detectedLanguage}, Model: ${modelId})`);

            // Check cache
            let audioBuffer = ElevenLabsService.getCachedAudio(text, { voiceId, modelId, language: this.detectedLanguage });
            const isCached = Boolean(audioBuffer);

            // Stream TTS audio chunks directly to Plivo in real-time as they arrive
            let firstChunkSent = false;
            let streamedBytes = 0;

            if (!audioBuffer && ElevenLabsService.isConfigured()) {
                audioBuffer = await ElevenLabsService.textToSpeech(text, {
                    voiceId,
                    modelId,
                    language: this.detectedLanguage,
                    outputFormat: 'ulaw_8000',
                    onChunk: (chunk) => {
                        if (!chunk || this.isClosed || !this.ws || this.ws.readyState !== this.ws.OPEN) return;
                        streamedBytes += chunk.length;
                        this.isAiSpeaking = true;
                        this.noteSpeechChunk(chunk.length);

                        // Mark first audio chunk sent for precise caller-endpoint-to-audible-response metric
                        if (!firstChunkSent) {
                            firstChunkSent = true;
                            this.latencyTracker.markFirstAudioChunkSent();
                            console.log(`[CallSession] First audio chunk streamed to Plivo (${chunk.length} bytes)`);
                        }

                        // Stream audio frame incrementally to Plivo
                        const payloadBase64 = Buffer.from(chunk).toString('base64');
                        const playMsg = {
                            event: 'playAudio',
                            media: {
                                contentType: 'audio/x-mulaw',
                                sampleRate: 8000,
                                payload: payloadBase64
                            }
                        };
                        if (this.streamId) {
                            playMsg.streamId = this.streamId;
                            playMsg.stream_id = this.streamId;
                        }
                        this.ws.send(JSON.stringify(playMsg));
                    }
                });
            }

            this.latencyTracker.markTtsEnd(isCached);

            if (!audioBuffer) {
                console.warn('[CallSession] ElevenLabs TTS unavailable; simulating turn timing.');
                const wordCount = text.split(/\s+/).length;
                const simDurationMs = Math.max(wordCount * 320, 1400);
                this.isAiSpeaking = true;
                this.aiSpeechEndTime = Date.now() + simDurationMs;
                this.scheduleSpeechEnd();
                return;
            }

            // If audio was already streamed chunk-by-chunk, calculate total duration and set completion timer
            if (firstChunkSent) {
                const totalDurationMs = Math.round((streamedBytes / 8000) * 1000);
                // aiSpeechEndTime was built up chunk by chunk as the audio was sent
                console.log(`[CallSession] Incremental stream complete: ${streamedBytes} bytes (~${totalDurationMs}ms at 8kHz ulaw)`);
                this.latencyTracker.markAudioDispatched();
                this.scheduleSpeechEnd();
            } else {
                // If loaded from RAM cache, dispatch complete buffer instantly
                this.latencyTracker.markFirstAudioChunkSent();
                await this.dispatchAudioBuffer(audioBuffer, text);
            }

        } catch (e) {
            console.error('[CallSession] playAiAudio error:', e.message);
            this.isAiSpeaking = false;
        }
    }

    /**
     * Processes inbound audio packets from the caller (Plivo media event).
     */
    async handleInboundAudio(mulawChunk) {
        this.lastInboundAudioAt = Date.now();
        this.inboundFrames++;
        if (this.isProcessingTurn || this.isClosed) return;

        // Watchdog: never stay deaf. If the bot is still marked as speaking well after its audio ended
        // (its end-of-speech timer was lost), go back to listening right now.
        if (this.isAiSpeaking && this.lastInboundAudioAt > this.aiSpeechEndTime + SPEECH_GRACE_MS) {
            console.warn('[CallSession] Watchdog: the bot was still marked as speaking after its audio ended. Switching back to listening.');
            this.isAiSpeaking = false;
            if (this.activeSpeechTimer) { clearTimeout(this.activeSpeechTimer); this.activeSpeechTimer = null; }
        }

        const pcm16 = decodeMulawToPcm16(mulawChunk);
        const energy = calculateRms(pcm16);
        const hasSpeech = energy >= this.ENERGY_THRESHOLD;

        // SCENARIO 1: AI IS CURRENTLY SPEAKING (Barge-In Handling)
        if (this.isAiSpeaking) {
            if (hasSpeech) {
                this.overlapMulawChunks.push(mulawChunk);
                this.overlapSpeechFrames++;

                // If candidate speaks sustained speech (>= 700ms), trigger barge-in!
                if (this.overlapSpeechFrames >= this.MIN_INTERRUPT_FRAMES) {
                    console.log(`[CallSession] Caller sustained speech detected (${this.overlapSpeechFrames * 20}ms). Stopping AI speech (Barge-in).`);

                    // Stop Plivo playback buffer immediately
                    if (this.streamId && this.ws.readyState === this.ws.OPEN) {
                        this.ws.send(JSON.stringify({
                            event: 'clearAudio',
                            streamId: this.streamId
                        }));
                    }

                    if (this.activeSpeechTimer) {
                        clearTimeout(this.activeSpeechTimer);
                        this.activeSpeechTimer = null;
                    }
                    this.speechSeq++;
                    this.aiSpeechEndTime = 0; // the cut-off audio no longer counts toward the next reply

                    this.isAiSpeaking = false;
                    this.interruptedWithAnswer = true;

                    // Move overlap audio into active caller buffer
                    this.callerMulawChunks.push(...this.overlapMulawChunks);
                    this.overlapMulawChunks = [];
                    this.overlapSpeechFrames = 0;
                    this.isCallerSpeaking = true;
                    this.consecutiveSilenceFrames = 0;
                }
            } else {
                // Short noise burst (< 700ms) while AI speaking: ignore and discard
                if (this.overlapSpeechFrames > 0 && this.overlapSpeechFrames < this.MIN_INTERRUPT_FRAMES) {
                    this.overlapMulawChunks = [];
                    this.overlapSpeechFrames = 0;
                }
            }
            return;
        }

        // SCENARIO 2: AI IS LISTENING
        if (hasSpeech) {
            this.callerMulawChunks.push(mulawChunk);
            this.consecutiveSpeechFrames++;
            this.consecutiveSilenceFrames = 0;
            this.isCallerSpeaking = true;
        } else {
            if (this.isCallerSpeaking) {
                this.callerMulawChunks.push(mulawChunk);
                this.consecutiveSilenceFrames++;

                // Configurable, low-latency adaptive silence threshold:
                // Default: 14 frames (~280ms) for brief answers ("yes", "okay", "no")
                // 18 frames (~360ms) for longer speech to allow natural breathing pauses
                // Configurable via VAD_SILENCE_THRESHOLD_MS (e.g. 250 - 350ms)
                const baseShortFrames = process.env.VAD_SILENCE_THRESHOLD_MS
                    ? Math.max(12, Math.round(parseInt(process.env.VAD_SILENCE_THRESHOLD_MS, 10) / 20))
                    : 14;
                const silenceRequired = this.consecutiveSpeechFrames < 60 ? baseShortFrames : (baseShortFrames + 4);

                if (this.consecutiveSilenceFrames >= silenceRequired) {
                    const silenceMs = this.consecutiveSilenceFrames * 20;
                    console.log(`[CallSession] Silence threshold met (${silenceMs}ms). Processing caller turn.`);
                    this.latencyTracker.markVadSilence(silenceMs);

                    this.isCallerSpeaking = false;
                    this.consecutiveSilenceFrames = 0;
                    this.consecutiveSpeechFrames = 0;
                    await this.processCallerTurn();
                }
            }
        }
    }

    /**
     * Completes caller audio turn:
     * 1. Transcribes via ElevenLabs Scribe STT.
     * 2. Filters noise transcripts (FIX-2).
     * 3. Checks deterministic IntentService (< 1ms fast-path).
     * 4. Falls back to optimized LLM only when necessary.
     * 5. Dispatches spoken reply and records comprehensive latency.
     * 
     * FIX-1: isProcessingTurn is now cleared AFTER playAiAudio, not before.
     * FIX-6: turnId guard prevents processing the same turn twice.
     */
    async processCallerTurn() {
        if (this.callerMulawChunks.length === 0 || this.isProcessingTurn) return;
        this.isProcessingTurn = true;
        this.processingSince = Date.now();

        // FIX-6: Unique ID for this turn — used to detect stale completions
        const turnId = ++this.currentTurnId;

        const totalMulaw = Buffer.concat(this.callerMulawChunks);
        this.callerMulawChunks = [];

        // Check minimum audio duration (>= 200ms = 1600 bytes)
        // Prevents dropping short words ("yes", "ok", "no") while filtering clicks
        if (totalMulaw.length < this.MIN_AUDIO_BYTES) {
            this.isProcessingTurn = false;
            return;
        }

        const pcm16 = decodeMulawToPcm16(totalMulaw);
        const wavBuffer = pcmToWav(pcm16, 8000, 1, 16);

        let transcript = '';
        let detectedLanguage = this.detectedLanguage || 'en';

        try {
            if (ElevenLabsService.isConfigured()) {
                this.latencyTracker.markSttStart();
                let sttResult = await ElevenLabsService.speechToText(wavBuffer, 'caller_turn.wav');
                // A wrong language guess ("Five PM" as Lithuanian, a name written in Urdu script) gives a useless transcript.
                // Re-run once in the language the call has been in; this only costs time when the guess was wrong.
                if (sttResult.transcript && !isSupportedCallLanguage(sttResult.language)) {
                    const retryLang = retryLanguageFor(this.detectedLanguage);
                    console.log(`[CallSession] Speech-to-text guessed "${sttResult.language}", which is not English, Hindi or Telugu. Re-running as ${retryLang}.`);
                    const again = await ElevenLabsService.speechToText(wavBuffer, 'caller_turn.wav', retryLang);
                    sttResult = again && again.transcript
                        ? { transcript: again.transcript, language: retryLang }
                        : { transcript: sttResult.transcript, language: retryLang };
                }
                transcript = (sttResult.transcript || '').trim();
                if (sttResult.language) {
                    detectedLanguage = sttResult.language;
                    this.detectedLanguage = detectedLanguage;
                }
                this.latencyTracker.markSttEnd(transcript.length);
            }
        } catch (e) {
            console.error('[CallSession] STT error:', e.message);
        }

        // FIX-6: If a newer turn started while we were in STT, discard this stale result
        if (turnId !== this.currentTurnId) {
            console.log(`[CallSession] Turn ${turnId} discarded (superseded by turn ${this.currentTurnId}).`);
            this.isProcessingTurn = false;
            return;
        }

        // FIX-2: Filter noise transcripts before ANY processing
        if (!transcript || isNoiseTranscript(transcript)) {
            console.log(`[CallSession] Noise/empty transcript filtered: "${transcript || '(empty)'}". Resuming listening.`);
            this.isProcessingTurn = false;
            return;
        }

        // Normalize 3-letter language codes from ElevenLabs Scribe to standard 2-letter codes
        const hasTeluguChars = /[\u0C00-\u0C7F]/.test(transcript);
        const teluguWords = /\b(avunu|kaadu|sare|alaage|alage|cheppandi|namaskaram|meeru|nenu|telugu|undi|ledu|eppudu)\b/i.test(transcript);
        if (hasTeluguChars || teluguWords || detectedLanguage === 'tel') {
            detectedLanguage = 'te';
            this.detectedLanguage = 'te';
        } else if (detectedLanguage === 'hin') {
            detectedLanguage = 'hi';
            this.detectedLanguage = 'hi';
        } else if (detectedLanguage === 'eng') {
            detectedLanguage = 'en';
            this.detectedLanguage = 'en';
        }

        console.log(`[CallSession] Caller said: "${transcript}" (Lang: ${detectedLanguage}, TurnId: ${turnId})`);

        // Check for thinking pauses ("hmm, let me think", "one minute", "wait")
        if (this.memory && this.memory.isThinkingPause(transcript)) {
            console.log(`[CallSession] Caller thinking pause detected ("${transcript}"). Responding patiently.`);
            const pauseAck = this.detectedLanguage === 'te' ? 'సరే, ఆలోచించి చెప్పండి.' : (this.detectedLanguage === 'hi' ? 'ज़रूर, सोचिए।' : 'Sure, take your time.');
            const replyTimeSec = Math.floor((Date.now() - this.startTime) / 1000);
            const replyTimeStr = `${String(Math.floor(replyTimeSec / 60)).padStart(2, '0')}:${String(replyTimeSec % 60).padStart(2, '0')}`;
            this.conversationHistory.push({
                speaker: 'REMO',
                text: pauseAck,
                time: replyTimeStr
            });
            this.memory.recordTurn('USER', transcript);
            this.memory.recordTurn('REMO', pauseAck);

            // FIX-1: Clear processing AFTER audio plays
            await this.playAiAudio(pauseAck);
            this.latencyTracker.markAudioDispatched();
            this.isProcessingTurn = false;
            return;
        }

        // Discard pure non-answer listening murmurs ("hmm", "mhm") while maintaining conversational focus
        const pureMurmurs = new Set(['hmm', 'hmmm', 'mhm', 'uh-huh', 'uh huh', 'mm', 'mmm']);
        const cleanedUtterance = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        if (pureMurmurs.has(cleanedUtterance) && !this.interruptedWithAnswer) {
            console.log(`[CallSession] Caller murmur acknowledged ("${transcript}"). Maintaining conversational focus.`);
            this.isProcessingTurn = false;
            return;
        }

        // Add caller turn to conversation history & memory
        const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
        const timeStr = `${String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:${String(elapsedSec % 60).padStart(2, '0')}`;

        this.conversationHistory.push({
            speaker: this.contact.name || 'Caller',
            text: transcript,
            time: timeStr
        });

        try {
            if (this.memory && typeof this.memory.recordTurn === 'function') {
                this.memory.recordTurn('USER', transcript);
            }
        } catch (memErr) {
            console.warn('[CallSession] Memory recordTurn USER error:', memErr.message);
        }

        // -------------------------------------------------------------
        // STEP 1: FAST-PATH DETERMINISTIC INTENT EVALUATION (< 1ms)
        // -------------------------------------------------------------
        this.latencyTracker.markDecisionStart();

        const intentContext = {
            service: this.service,
            lastQuestion: this.currentQuestion,
            language: this.detectedLanguage,
            stage: this.currentStage,
            contact: this.contact,
            collectedData: this.collectedData,
            history: this.conversationHistory,
            questionPlan: this.questionPlan,
            campaignContext: this.campaignContext,
            memory: this.memory
        };

        const intent = IntentService.matchIntent(transcript, intentContext);

        if (intent.matched) {
            this.latencyTracker.markDecisionEnd(`INTENT_FAST_PATH:${intent.reason || 'DIRECT'}`);

            if (intent.extracted_fields && Object.keys(intent.extracted_fields).length > 0) {
                this.collectedData = { ...this.collectedData, ...intent.extracted_fields };
            }
            if (intent.classification) {
                this.classification = intent.classification;
            }
            // FIX-3: Only advance stage if the intent explicitly provides next_stage
            // Audibility check ("hello") does NOT advance stage — preserves current context
            if (intent.next_stage) {
                this.stageHistory.push(this.currentStage);
                this.currentStage = intent.next_stage;
            }
            if (intent.detected_language) {
                this.detectedLanguage = intent.detected_language;
            }

            const spokenResponse = intent.spoken_response;
            const replyTimeSec = Math.floor((Date.now() - this.startTime) / 1000);
            const replyTimeStr = `${String(Math.floor(replyTimeSec / 60)).padStart(2, '0')}:${String(replyTimeSec % 60).padStart(2, '0')}`;

            this.conversationHistory.push({
                speaker: 'REMO',
                text: spokenResponse,
                time: replyTimeStr
            });

            try {
                if (this.memory && typeof this.memory.recordTurn === 'function') {
                    this.memory.recordTurn('REMO', spokenResponse);
                }
            } catch (memErr) {
                console.warn('[CallSession] Memory recordTurn REMO error:', memErr.message);
            }

            this.currentQuestion = spokenResponse;
            this.interruptedWithAnswer = false;

            // FIX-1: Play fast-path response BEFORE clearing isProcessingTurn
            await this.playAiAudio(spokenResponse);
            this.latencyTracker.markAudioDispatched();

            // FIX-1: Only NOW clear the processing lock
            this.isProcessingTurn = false;

            if (intent.should_end_call) {
                this.callStatus = 'COMPLETED';
                const hangupDelay = Math.max((spokenResponse.split(/\s+/).length * 320) + 1200, 2500);
                setTimeout(() => this.endCall(), hangupDelay);
            }

            return; // Fast-path turn finished without calling LLM
        }

        // -------------------------------------------------------------
        // STEP 2: LLM (Claude Haiku primary / Gemini fallback) FOR COMPLEX/AMBIGUOUS RESPONSES
        // -------------------------------------------------------------
        try {
            const reply = await GeminiService.generateReply(
                this.service,
                this.contact,
                this.conversationHistory,
                transcript,
                this.collectedData,
                {
                    campaignContext: this.campaignContext,
                    questionPlan: this.questionPlan,
                    memoryState: this.memory ? this.memory.getStateSummary() : null,
                    detectedLanguage: this.detectedLanguage,
                    currentStage: this.currentStage,
                    agentName: this.agent ? this.agent.name : '',
                    agentInstructions: this.agent ? this.agent.instructions : '',
                    direction: this.direction
                }
            );

            this.latencyTracker.markDecisionEnd('LLM');

            // FIX-6: Check if we've been superseded by a newer turn
            if (turnId !== this.currentTurnId) {
                console.log(`[CallSession] LLM response for turn ${turnId} discarded (superseded by turn ${this.currentTurnId}).`);
                this.isProcessingTurn = false;
                return;
            }

            if (reply.extracted_fields && Object.keys(reply.extracted_fields).length > 0) {
                for (const [k, v] of Object.entries(reply.extracted_fields)) {
                    if (v !== null && v !== undefined && String(v).trim() !== '') {
                        this.collectedData[k] = v;
                    }
                }
            }

            if (reply.classification) {
                this.classification = reply.classification;
            }
            if (reply.call_summary) {
                this.summary = reply.call_summary;
            }
            if (reply.detected_language) {
                this.detectedLanguage = reply.detected_language;
            }

            const spokenResponse = reply.spoken_response;
            if (!spokenResponse) {
                console.warn('[CallSession] LLM returned empty spoken_response. Using universal fallback.');
                const fallback = GeminiService.getUniversalFallback(this.detectedLanguage, this.service);
                const replyTimeSec = Math.floor((Date.now() - this.startTime) / 1000);
                const replyTimeStr = `${String(Math.floor(replyTimeSec / 60)).padStart(2, '0')}:${String(replyTimeSec % 60).padStart(2, '0')}`;
                this.conversationHistory.push({ speaker: 'REMO', text: fallback, time: replyTimeStr });
                this.currentQuestion = fallback;
                this.interruptedWithAnswer = false;
                await this.playAiAudio(fallback);
                this.latencyTracker.markAudioDispatched();
                this.isProcessingTurn = false;
                return;
            }

            const replyTimeSec = Math.floor((Date.now() - this.startTime) / 1000);
            const replyTimeStr = `${String(Math.floor(replyTimeSec / 60)).padStart(2, '0')}:${String(replyTimeSec % 60).padStart(2, '0')}`;

            this.conversationHistory.push({
                speaker: 'REMO',
                text: spokenResponse,
                time: replyTimeStr
            });

            try {
                if (this.memory && typeof this.memory.recordTurn === 'function') {
                    this.memory.recordTurn('REMO', spokenResponse);
                }
            } catch (memErr) {
                console.warn('[CallSession] Memory recordTurn REMO error:', memErr.message);
            }

            this.currentQuestion = spokenResponse;
            this.interruptedWithAnswer = false;

            // FIX-1: Play LLM response BEFORE clearing isProcessingTurn
            await this.playAiAudio(spokenResponse);
            this.latencyTracker.markAudioDispatched();

            // FIX-1: Only NOW clear the processing lock
            this.isProcessingTurn = false;

            if (reply.should_end_call) {
                this.callStatus = 'COMPLETED';
                const hangupDelay = Math.max((spokenResponse.split(/\s+/).length * 320) + 1400, 2800);
                setTimeout(() => this.endCall(), hangupDelay);
            }

        } catch (genErr) {
            console.error('[CallSession] Error generating reply:', genErr.message);
            this.latencyTracker.markDecisionEnd('LLM_ERROR');

            // FIX-5: Always record audio dispatched even on error, so TOTAL latency is correct
            // Deliver a service-specific recovery phrase so caller isn't left in silence
            try {
                const recoveryPhrase = GeminiService.getUniversalFallback(this.detectedLanguage, this.service);
                const replyTimeSec = Math.floor((Date.now() - this.startTime) / 1000);
                const replyTimeStr = `${String(Math.floor(replyTimeSec / 60)).padStart(2, '0')}:${String(replyTimeSec % 60).padStart(2, '0')}`;
                this.conversationHistory.push({ speaker: 'REMO', text: recoveryPhrase, time: replyTimeStr });
                await this.playAiAudio(recoveryPhrase);
                this.latencyTracker.markAudioDispatched();
            } catch (recoveryErr) {
                console.error('[CallSession] Recovery phrase also failed:', recoveryErr.message);
                this.latencyTracker.markAudioDispatched(); // Still mark so TOTAL is tracked
            }

            // FIX-1: Clear processing lock after recovery
            this.isProcessingTurn = false;
        }
    }

    /**
     * Ends call, logs latency profile, and asynchronously writes conversation to DB.
     */
    async endCall() {
        if (this.isClosed) return;
        this.isClosed = true;

        if (this.activeSpeechTimer) {
            clearTimeout(this.activeSpeechTimer);
            this.activeSpeechTimer = null;
        }
        if (this.healthTimer) {
            clearInterval(this.healthTimer);
            this.healthTimer = null;
        }

        try {
            if (this.ws.readyState === this.ws.OPEN) {
                this.ws.close(1000, 'Call completed');
            }
        } catch (e) {}

        // Log latency report
        if (this.latencyTracker) {
            this.latencyTracker.logFinalSummary();
        }

        // Asynchronously persist call results off the critical path (non-blocking)
        this.persistCallResults().catch(err => {
            console.error(`[CallSession] Error during async persistCallResults for call ${this.callId}:`, err.message);
        });
    }

    async persistCallResults() {
        const durationSec = Math.round((Date.now() - this.startTime) / 1000);
        const now = utcNow();

        console.log(`[CallSession] Finalizing call ${this.callId} (${durationSec}s, status: ${this.callStatus})...`);

        try {
            if (this.service === 'recruitment') {
                try {
                    const evalResult = await ScreeningEvaluator.evaluateCandidate({
                        jd: this.campaignContext,
                        jdCriteria: this.campaignContext,
                        candidate: { ...this.contact, ...this.collectedData, call_status: 'COMPLETED', status: 'COMPLETED', duration_seconds: durationSec },
                        collectedData: this.collectedData,
                        factsCollected: this.collectedData,
                        transcript: this.conversationHistory,
                        conversationHistory: this.conversationHistory
                    });
                    this.classification = evalResult.status || this.classification;
                    this.jdMatchScore = evalResult.jd_match_score;
                    if (evalResult.summary) this.summary = evalResult.summary;
                    this.collectedData = {
                        ...this.collectedData,
                        ai_screening_status: evalResult.status,
                        jd_match_score: evalResult.jd_match_score,
                        skills_match: evalResult.skills_match,
                        experience_match: evalResult.experience_match,
                        decision_reason: evalResult.decision_reason
                    };
                    console.log(`[CallSession] Screening evaluated for ${this.contact.name}: ${evalResult.status} (Score: ${evalResult.jd_match_score}%)`);
                } catch (evalErr) {
                    console.warn('[CallSession] Screening evaluation note:', evalErr.message);
                }
            }

            if (this.contactId) {
                const notesAddition = this.summary ? `\nSummary: ${this.summary}` : '';
                const updatedNotes = (this.contact?.notes || '') + notesAddition;
                await db.run(`
                    UPDATE contacts
                    SET call_status = 'COMPLETED',
                        duration_seconds = ?,
                        classification = ?,
                        extracted_data = ?,
                        notes = ?,
                        updated_at = ?
                    WHERE id = ?
                `, [
                    durationSec,
                    this.classification,
                    JSON.stringify(this.collectedData),
                    updatedNotes,
                    now,
                    this.contactId
                ]);

                await db.run(`
                    UPDATE call_queue
                    SET status = 'COMPLETED', updated_at = ?
                    WHERE contact_id = ?
                `, [now, this.contactId]);
            }

            const ownerId = this.ownerUserId || this.contact?.owner_user_id || 'usr_admin_takeremo_reach';
            const phone = this.contact?.phone || this.phone || '';
            const contactName = this.contact?.name || this.callerName || (phone ? `Caller (${phone})` : 'Caller');

            const convId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            await db.run(`
                INSERT INTO conversations (id, contact_id, batch_id, campaign_id, service, phone, contact_name, status, started_at, ended_at, duration_seconds, summary, classification, created_at, owner_user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)
            `, [
                convId,
                this.contactId || this.contact?.id || 'direct',
                this.contact?.batch_id || 'direct_batch',
                this.campaignId || null,
                this.service,
                phone,
                contactName,
                new Date(this.startTime).toISOString(),
                now,
                durationSec,
                this.summary || `${this.service.toUpperCase()} call completed.`,
                this.classification,
                now,
                ownerId
            ]);

            // Record which agent took the call and whether it was incoming or outgoing.
            try {
                await ensureAgentSchema();
                await db.run('UPDATE conversations SET agent_id = ?, direction = ? WHERE id = ?', [this.agent ? this.agent.id : null, this.direction, convId]);
            } catch (agentErr) {
                console.warn('[CallSession] Could not record the agent on the conversation:', agentErr.message);
            }

            for (const msg of this.conversationHistory) {
                await db.run(`
                    INSERT INTO transcript_messages (conversation_id, speaker, text, time_str, timestamp, language)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    convId,
                    msg.speaker,
                    msg.text,
                    msg.time,
                    now,
                    this.detectedLanguage || 'en'
                ]);
            }

            // Real-time Campaign counters update
            if (this.campaignId) {
                try {
                    const selInc = this.classification === 'Selected' ? 1 : 0;
                    const rejInc = this.classification === 'Rejected' ? 1 : 0;
                    const holdInc = this.classification === 'On Hold' ? 1 : 0;
                    await db.run(`
                        UPDATE campaigns
                        SET completed_calls = completed_calls + 1,
                            selected_count = selected_count + ?,
                            rejected_count = rejected_count + ?,
                            on_hold_count = on_hold_count + ?,
                            inprogress_calls = CASE WHEN inprogress_calls > 0 THEN inprogress_calls - 1 ELSE 0 END,
                            updated_at = ?
                        WHERE id = ?
                    `, [selInc, rejInc, holdInc, now, this.campaignId]);
                } catch (campUpErr) {
                    console.warn('[CallSession] Campaign counter update note:', campUpErr.message);
                }
            }

            console.log(`[CallSession] Call ${this.callId} records successfully persisted to database (ConvID: ${convId}).`);

        } catch (dbErr) {
            console.error('[CallSession] Non-fatal error saving call records:', dbErr.message);
        }
    }
}

/**
 * Handles incoming WebSocket connection from Plivo audio stream.
 * @param {import('ws').WebSocket} ws
 * @param {import('http').IncomingMessage} request
 */
export function handleVoicebotWebsocket(ws, request) {
    console.log('[VoicebotStream] New WebSocket connection from', request.socket?.remoteAddress || 'unknown');

    let parsedUrl;
    try {
        parsedUrl = new URL(request.url, 'http://localhost');
    } catch (e) {
        parsedUrl = { searchParams: new URLSearchParams((request.url || '').split('?')[1] || '') };
    }

    const rawService = parsedUrl.searchParams.get('service');
    const service = (rawService || 'recruitment').toLowerCase().trim();
    const callerName = decodeURIComponent(parsedUrl.searchParams.get('name') || '').trim();
    const role = decodeURIComponent(parsedUrl.searchParams.get('role') || '').trim();
    const company = decodeURIComponent(parsedUrl.searchParams.get('company') || '').trim();
    const phone = decodeURIComponent(parsedUrl.searchParams.get('phone') || parsedUrl.searchParams.get('To') || '').trim();

    const params = {
        callId: parsedUrl.searchParams.get('callId') || parsedUrl.searchParams.get('CallSid') || `plv_${Date.now()}`,
        contactId: parsedUrl.searchParams.get('contactId') || '',
        service: service,
        ownerUserId: parsedUrl.searchParams.get('ownerId') || parsedUrl.searchParams.get('owner_user_id') || null,
        phone: phone,
        callerName: callerName,
        role: role,
        company: company,
        campaignId: parsedUrl.searchParams.get('campaignId') || parsedUrl.searchParams.get('campaign_id') || '',
        agentId: parsedUrl.searchParams.get('agentId') || '',
        direction: parsedUrl.searchParams.get('direction') || ''
    };

    const session = new CallSession(ws, params);

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString('utf8'));
            const event = msg.event;

            if (event === 'start') {
                session.streamId = msg.streamId || msg.start?.streamId;
                if (msg.start?.callId) session.callId = msg.start.callId;

                const headers = msg.extra_headers || msg.extraHeaders || msg.start?.extraHeaders || msg.start?.extra_headers || msg.start?.customHeaders || msg.start?.customParameters || msg.customParameters;
                if (headers) {
                    if (typeof headers === 'object') {
                        if (headers.campaignId || headers.campaign_id) session.campaignId = headers.campaignId || headers.campaign_id;
                        if (headers.agentId) session.agentId = headers.agentId;
                        if (headers.direction) session.direction = headers.direction === 'inbound' ? 'inbound' : 'outbound';
                        if (headers.contactId) session.contactId = headers.contactId;
                        if (headers.service) {
                            session.service = headers.service.toLowerCase().trim();
                            session.contact.service = session.service;
                        }
                        if (headers.ownerId) session.ownerUserId = headers.ownerId;
                        if (headers.phone) {
                            session.phone = headers.phone;
                            session.contact.phone = headers.phone;
                        }
                        if (headers.name) {
                            session.callerName = headers.name;
                            session.contact.name = headers.name;
                        }
                        if (headers.role) {
                            session.jobRole = headers.role;
                            session.contact.job_role = headers.role;
                        }
                        if (headers.company) {
                            session.companyName = headers.company;
                            session.contact.company = headers.company;
                        }
                    } else if (typeof headers === 'string') {
                        const pairs = headers.split(/[,;&]/);
                        for (const pair of pairs) {
                            const [k, v] = pair.split('=');
                            if (!k) continue;
                            const key = k.trim();
                            const val = decodeURIComponent((v || '').trim());
                            if (key === 'campaignId' || key === 'campaign_id') session.campaignId = val;
                            if (key === 'agentId' && val) session.agentId = val;
                            if (key === 'direction' && val) session.direction = val === 'inbound' ? 'inbound' : 'outbound';
                            if (key === 'contactId') session.contactId = val;
                            if (key === 'service') {
                                session.service = val.toLowerCase().trim();
                                session.contact.service = session.service;
                            }
                            if (key === 'ownerId') session.ownerUserId = val;
                            if (key === 'phone') {
                                session.phone = val;
                                session.contact.phone = val;
                            }
                            if (key === 'name') {
                                session.callerName = val;
                                session.contact.name = val;
                            }
                            if (key === 'role') {
                                session.jobRole = val;
                                session.contact.job_role = val;
                            }
                            if (key === 'company') {
                                session.companyName = val;
                                session.contact.company = val;
                            }
                        }
                    }
                }

                // Update in-memory contact fields from extracted parameters
                if (session.service) session.contact.service = session.service;
                if (session.jobRole) session.contact.job_role = session.jobRole;
                if (session.companyName) session.contact.company = session.companyName;
                if (session.callerName && !session.callerName.startsWith('Caller') && !session.callerName.startsWith('Candidate') && !session.callerName.startsWith('Contact')) {
                    session.contact.name = session.callerName;
                }

                console.log(`[VoicebotStream] Plivo stream started — CallId: ${session.callId}, StreamId: ${session.streamId}, Service: ${session.service.toUpperCase()}, Contact: ${session.contact.name} (${session.contact.job_role})`);
                await session.init();

            } else if (event === 'media') {
                const payload = msg.media?.payload;
                if (payload) {
                    const chunk = Buffer.from(payload, 'base64');
                    await session.handleInboundAudio(chunk);
                }
            } else if (event === 'stop') {
                console.log(`[VoicebotStream] Plivo stream stopped for CallId: ${session.callId}`);
                await session.endCall();
            }
        } catch (err) {
            console.error('[VoicebotStream] Error processing WebSocket message:', err);
        }
    });

    ws.on('error', (err) => {
        console.error('[VoicebotStream] WebSocket error:', err.message);
    });

    ws.on('close', async (code, reason) => {
        console.log(`[VoicebotStream] Connection closed (${code}) for CallId: ${session.callId}`);
        await session.endCall();
    });

    // Initial handshake acknowledgement
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ event: 'connected', service: 'Plivo-ElevenLabs-VoiceBot' }));
    }
}

/**
 * Pre-caches standard greetings and acknowledgments into RAM on startup.
 */
export async function precacheStandardGreetings() {
    if (!ElevenLabsService.isConfigured()) return;
    try {
        // Sequential pre-warm (concurrency = 1) to respect ElevenLabs rate limits
        console.log('[VoicebotStream] Pre-warming standard opening greetings in TTS cache...');
        const salesGreeting = GeminiService.getOpeningGreeting('sales', {});
        const salesVoice = ElevenLabsService.getVoiceIdForLanguage('en');
        const salesModel = ElevenLabsService.selectTtsModel({ language: 'en', voiceId: salesVoice });
        await ElevenLabsService.textToSpeech(salesGreeting, { voiceId: salesVoice, modelId: salesModel, language: 'en', outputFormat: 'ulaw_8000', timeoutMs: 10000 });

        const recGreeting = GeminiService.getOpeningGreeting('recruitment', { job_role: 'the open position' });
        const recVoice = ElevenLabsService.getVoiceIdForLanguage('en');
        const recModel = ElevenLabsService.selectTtsModel({ language: 'en', voiceId: recVoice });
        await ElevenLabsService.textToSpeech(recGreeting, { voiceId: recVoice, modelId: recModel, language: 'en', outputFormat: 'ulaw_8000', timeoutMs: 10000 });
        console.log('[VoicebotStream] Standard greetings cached in RAM successfully.');
    } catch (e) {
        // Non-fatal
    }
}

// Trigger background warmup
precacheStandardGreetings();
