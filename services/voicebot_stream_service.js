import db, { utcNow } from './db.js';
import ElevenLabsService from './elevenlabs_service.js';
import MurfService from './murf_service.js';
import GeminiService from './gemini_service.js';
import IntentService from './intent_service.js';
import AppointmentState from './appointment_state.js';
import SalesState from './sales_state.js';
import LatencyTracker from './latency_tracker.js';
import ConversationMemory from './conversation_memory.js';
import ScreeningEvaluator from './screening_evaluator.js';
import AgentService, { ensureAgentSchema } from './agent_service.js';
import PlivoService from './plivo_service.js';
import RecordingService from './recording_service.js';
import CampaignService from './campaign_service.js';
import LanguageStateMachine from './language_state_machine.js';
import QuestionTracker, { stripAlreadySpoken, isAffirmativeMurmur, isAcknowledgement, splitSentences, topicOf, questionPart } from './question_tracker.js';
import VoiceRegistry from './voice_registry.js';

/**
 * The exact one-way promotional script spoken by Remo on "Get Instant Call".
 * Strictly delivered in a single uninterrupted speaking sequence without questioning or listening.
 */
export const PROMOTIONAL_DEMO_SCRIPT =
`Still spending hours making calls for your business? There’s a smarter way!

Meet TakeRemo.com — your AI calling platform that can make up to 1,000 calls with a single click!

Whether you need Recruitment to screen and schedule candidates, Sales to connect with leads, Customer Support to assist customers 24/7, Appointment Setting to fill your calendar, or a Receptionist to answer every call — TakeRemo has you covered!

For more details, log in to TakeRemo.com today and experience the future of AI calling!

TakeRemo.com — AI Calling. Human Conversations. Real Results!`.trim();

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
 * Trims leading and trailing silence from 16-bit PCM buffer to reduce STT turnaround time,
 * preserving a safety padding (default 100ms) around speech.
 */
export function trimSilencePcm16(pcmBuffer, sampleRate = 8000, threshold = 350, paddingMs = 100) {
    if (!pcmBuffer || pcmBuffer.length < 4) return pcmBuffer;
    const numSamples = Math.floor(pcmBuffer.length / 2);
    const paddingSamples = Math.floor((sampleRate * paddingMs) / 1000);

    let start = 0;
    for (let i = 0; i < numSamples; i++) {
        if (Math.abs(pcmBuffer.readInt16LE(i * 2)) > threshold) {
            start = Math.max(0, i - paddingSamples);
            break;
        }
    }

    let end = numSamples - 1;
    for (let i = numSamples - 1; i >= 0; i--) {
        if (Math.abs(pcmBuffer.readInt16LE(i * 2)) > threshold) {
            end = Math.min(numSamples - 1, i + paddingSamples);
            break;
        }
    }

    if (start >= end) {
        return pcmBuffer;
    }

    return pcmBuffer.slice(start * 2, (end + 1) * 2);
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

/**
 * True when most letters of a transcript are in a script Remo speaks (Latin, Devanagari, Telugu).
 * A wrong language guess can come back in another script (for example a name written in Urdu letters),
 * which is useless to the conversation.
 */
export function isUsableCallScript(transcript) {
    const letters = [...String(transcript ?? '')].filter(ch => /\p{L}/u.test(ch));
    if (letters.length === 0) return true;
    const spoken = letters.filter(ch => /[\p{Script=Latin}\p{Script=Devanagari}\p{Script=Telugu}]/u.test(ch));
    return spoken.length / letters.length >= 0.6;
}

// Safety nets so a call can never stay deaf: how long past its audio the "speaking" state may last,
// and the longest one caller turn may keep the bot busy (speech-to-text + AI + voice).
const SPEECH_GRACE_MS = 2000;
const MAX_TURN_MS = 20000;
const HEALTH_CHECK_MS = 5000;
const QUIET_WARN_MS = 5000;
// One piece of speech must never keep the bot busy for longer than this (text-to-speech request time).
const TTS_TIMEOUT_MS = 8000;
// The same caller words arriving again within this time while a reply is still active are one turn, not two.
const DUPLICATE_TURN_WINDOW_MS = 4000;
// Plivo "checkpoint" events tell us when our audio has really finished playing on the phone.
// Set PLIVO_PLAYBACK_CHECKPOINTS=off to rely on the audio-length timer only.
const PLAYBACK_CHECKPOINTS = String(process.env.PLIVO_PLAYBACK_CHECKPOINTS || 'on').toLowerCase() !== 'off';

/**
 * Standard Conversation States for Remo voice pipeline.
 * Ensures robust turn-taking and prevents premature question advancement.
 */
export const ConversationStates = Object.freeze({
    IDLE: 'IDLE',
    LISTENING: 'LISTENING',
    CANDIDATE_SPEAKING: 'CANDIDATE_SPEAKING',
    WAITING_FOR_END_OF_TURN: 'WAITING_FOR_END_OF_TURN',
    FINALIZING_TRANSCRIPT: 'FINALIZING_TRANSCRIPT',
    PROCESSING_ANSWER: 'PROCESSING_ANSWER',
    GENERATING_RESPONSE: 'GENERATING_RESPONSE',
    SPEAKING: 'SPEAKING',
    COMPLETED: 'COMPLETED'
});

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
        this.callerName = params.callerName || params.name || '';
        this.jobRole = params.role || '';
        this.companyName = params.company || '';
        this.campaignId = params.campaignId || null;
        this.contact = {
            id: this.contactId,
            name: this.callerName || (this.service === 'recruitment' ? 'Candidate' : 'Customer'),
            phone: this.phone,
            role: this.jobRole,
            company: this.companyName,
            service: this.service
        };
        // Multi-agent: the agent (number, greeting, instructions, voice) this call belongs to.
        this.agentId = params.agentId || '';
        this.direction = params.direction === 'inbound' ? 'inbound' : 'outbound';
        this.agent = null;
        this.campaign = params.campaign || null;
        this.campaignContext = params.campaignContext || null;
        this.questionPlan = params.questionPlan || null;
        this.memory = null;
        this.jdMatchScore = null;
        this.screeningResult = null;

        this.startTime = Date.now();
        this.latencyTracker = new LatencyTracker(this.callId);
        this.conversationHistory = [];
        this.collectedData = {};
        // Appointment calls: which booking detail was asked last and how many times in a row.
        this.apptTracker = { field: null, count: 0 };
        // Sales calls: which discovery detail was asked last and how many times in a row.
        this.salesTracker = { field: null, count: 0 };
        this.callStatus = 'in-progress';
        this.classification = 'On Hold';
        this.summary = '';
        this.currentStage = 'AVAILABILITY';
        this.detectedLanguage = 'en';
        this.languageStateMachine = new LanguageStateMachine(this.detectedLanguage);

        // Conversation state machine
        this.conversationState = ConversationStates.IDLE;

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
        this.activeSttSession = null;
        this.activeSttTurnId = 0;

        // Overlap buffer (when caller speaks WHILE AI is speaking or turn is being processed)
        this.overlapMulawChunks = [];
        this.overlapSpeechFrames = 0;

        // Call termination & playback state
        this.isClosingCall = false;
        this.hangUpTimer = null;

        // VAD parameters (20ms frames = 160 mulaw bytes at 8kHz)
        this.ENERGY_THRESHOLD = 450;             // Minimum RMS to count as speech when AI is listening
        this.BARGE_IN_ENERGY_THRESHOLD = 850;   // Higher threshold while AI speaks to prevent speaker echo / background noise from cutting AI off
        this.MIN_INTERRUPT_FRAMES = 60;          // ~1200ms of sustained speech while AI speaks triggers barge-in
        this.MIN_AUDIO_BYTES = 1600;             // 200ms of audio minimum to avoid discarding short answers

        // FIX-1 & FIX-6: isProcessingTurn is ONLY cleared after playAiAudio completes.
        // turnId prevents the same utterance from being processed twice.
        this.isProcessingTurn = false;
        this.currentTurnId = 0;
        this.isClosed = false;

        // FIX-3: Stage tracking for preventing repeated questions
        this.stageHistory = [];

        // Persistent question record (asked / answered / duplicates), kept in code and not in the AI's memory.
        this.questions = new QuestionTracker({ callId: this.callId, service: this.service, language: this.detectedLanguage });

        // Response lifecycle: generating -> speech sent -> playback completed. Only one response is active at a time.
        // Speech is queued so sentences play in order, and a cancelled response never plays another word.
        this.activeResponse = null;      // { id, turnId, cancelled, phase, spoken: [] }
        this.responseSeq = 0;
        this.pendingSpeech = 0;          // pieces of speech queued or still being synthesised
        this.speechChain = Promise.resolve();
        this.lastFinalTranscript = { text: '', at: 0 };
        this.playbackCheckpoint = null;  // name of the Plivo checkpoint sent after the latest speech
        this.checkpointSeq = 0;

        // Synchronous in-memory contact construction: ready IMMEDIATELY with service-appropriate defaults
        let defaultName = 'Customer';
        if (this.service === 'recruitment') defaultName = 'Candidate';
        const cleanName = (this.callerName || '').trim();
        if (cleanName && !cleanName.startsWith('Caller') && !cleanName.startsWith('Candidate') && !cleanName.startsWith('Contact')) {
            defaultName = cleanName;
        }

        // Dedicated Promotional Demo Mode state
        this.callMode = (params.callMode || 'STANDARD').toUpperCase().trim();
        this.promoState = 'INITIATING'; // INITIATING | CONNECTED | PLAYING_PROMO | COMPLETED | FAILED
        this.promoPlaybackTimer = null;
        this.promoHangupTriggered = false;

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
            company: this.companyName || '',
            preferred_language: 'en'
        };
    }

    /**
     * Updates conversation state machine and logs state change with reason.
     */
    setConversationState(newState, reason = '') {
        const oldState = this.conversationState;
        if (oldState === newState) return;
        this.conversationState = newState;
        this.logDiagnostic('state_change', {
            from: oldState,
            to: newState,
            reason
        });
    }

    /**
     * Emits structured diagnostic logs with timestamps, call ID, turn ID, and state.
     */
    logDiagnostic(event, details = {}) {
        const timestamp = new Date().toISOString();
        const payload = {
            timestamp,
            callId: this.callId || 'unknown_call',
            turnId: this.currentTurnId,
            state: this.conversationState,
            service: this.service,
            event,
            ...details
        };
        console.log(`[Diagnostic] ${JSON.stringify(payload)}`);
    }

    /**
     * Returns configurable end-of-turn silence threshold in milliseconds.
     * Dynamic adaptation:
     * - Recruitment: Allows generous thinking pauses (default 1,400ms or RECRUITMENT_VAD_SILENCE_MS).
     * - Sales / Support / Appointment:
     *     - Brief acknowledgments (<= 15 speech frames, ~300ms speech): 350ms silence for ultra-low latency.
     *     - Sustained explanations (> 15 speech frames): 450-500ms silence so callers are never interrupted during natural pauses.
     */
    getSilenceThresholdMs() {
        if (this.service === 'recruitment') {
            let longMs = 1400; // Default 1,400ms end-of-turn threshold for recruitment answers
            const envVal = process.env.RECRUITMENT_VAD_SILENCE_MS;
            if (envVal) {
                const parsed = parseInt(envVal, 10);
                if (!isNaN(parsed) && parsed >= 500 && parsed <= 5000) longMs = parsed;
            }

            // Right after greeting or permission question, short confirmations reply snappily (300-350ms)
            const waitingForShortAnswer = this.greetingDelivered
                && ['GREETING', 'AVAILABILITY', 'PERMISSION_CHECK'].includes(this.currentStage)
                && this.consecutiveSpeechFrames <= 25; // brief affirmation up to ~0.5s of speech
            if (waitingForShortAnswer) {
                let briefMs = 320;
                const briefEnv = parseInt(process.env.RECRUITMENT_VAD_BRIEF_SILENCE_MS, 10);
                if (!isNaN(briefEnv) && briefEnv >= 250 && briefEnv <= 1400) briefMs = briefEnv;
                return Math.min(briefMs, longMs);
            }
            // For general brief utterances (<= 15 speech frames = ~300ms speech)
            if (this.consecutiveSpeechFrames <= 15) {
                return 320;
            }
            return longMs;
        }

        if (process.env.VAD_SILENCE_THRESHOLD_MS) {
            const parsed = parseInt(process.env.VAD_SILENCE_THRESHOLD_MS, 10);
            if (!isNaN(parsed) && parsed >= 100) {
                return parsed;
            }
        }

        // Adaptive natural pause tolerance for telephone conversation:
        // Brief acknowledgments ("yes", "no", "sure", "speaking", <= 20 speech frames = ~400ms speech): 320ms silence
        if (this.consecutiveSpeechFrames <= 20) {
            return 320;
        }
        // Sustained explanations (> 50 speech frames = ~1000ms speech): 480ms silence to allow natural pause
        if (this.consecutiveSpeechFrames > 50) {
            return 480;
        }
        // Standard intermediate conversational turns: 380ms
        return 380;
    }

    /**
     * Checks if overlap audio was buffered during AI speech / turn finalization,
     * and rolls it seamlessly into caller speech buffer without dropping any syllables.
     */
    checkAndApplyOverlapAudio() {
        if (this.overlapMulawChunks && this.overlapMulawChunks.length > 0 && !this.isAiSpeaking && !this.isProcessingTurn) {
            console.log(`[CallSession] Applying ${this.overlapMulawChunks.length} buffered overlap chunks (~${this.overlapMulawChunks.length * 20}ms) into caller buffer.`);
            this.callerMulawChunks.push(...this.overlapMulawChunks);
            this.overlapMulawChunks = [];
            this.consecutiveSpeechFrames = this.overlapSpeechFrames;
            this.overlapSpeechFrames = 0;
            this.consecutiveSilenceFrames = 0;
            this.isCallerSpeaking = true;
            this.setConversationState(ConversationStates.CANDIDATE_SPEAKING, 'overlap_audio_carried_over');
        }
    }

    /**
     * Initializes the call session.
     * Enriches contact from database with a fast 150ms timeout guard, then delivers opening greeting.
     */
    async init() {
        this.latencyTracker.markSessionReady();
        this.startHealthMonitor();

        // DEDICATED PROMOTIONAL_DEMO MODE:
        // Execute pure one-way promotional script delivery and disconnect.
        // Completely isolated from standard conversational loop, DB candidate lookup, and LLM processing.
        if (this.callMode === 'PROMOTIONAL_DEMO') {
            console.log(`[CallSession] [PROMO] Call ${this.callId} initialized in PROMOTIONAL_DEMO mode.`);
            this.promoState = 'CONNECTED';
            await this.executePromotionalDemo();
            return;
        }

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

        // The call id and work type are final now (the stream's start message can change them).
        this.questions = new QuestionTracker({ callId: this.callId, service: this.service, language: this.detectedLanguage });
        this.questions.registerPlan(this.questionPlan);

        // Deliver opening greeting immediately
        await this.deliverOpeningGreeting();
    }

    /**
     * Executes the one-way promotional demo call:
     * - Dispatches the complete promotional script in a single uninterrupted speaking sequence.
     * - Completely ignores caller speech / input (no listening, no barge-in, no response generation).
     * - Immediately terminates the telephone call via Plivo when playback finishes.
     */
    async executePromotionalDemo() {
        if (this.promoState === 'PLAYING_PROMO' || this.promoState === 'COMPLETED' || this.isClosed) {
            console.log(`[CallSession] [PROMO] Suppressing duplicate promotional execution (State: ${this.promoState}).`);
            return;
        }

        this.promoState = 'PLAYING_PROMO';
        this.isAiSpeaking = true;
        this.latencyTracker.markTtsStart();

        console.log(`[CallSession] [PROMO] Playing promotional script to ${this.phone || this.callId}...`);

        try {
            const isMurf = MurfService.isConfigured();
            const voiceId = isMurf ? MurfService.getVoiceId() : ElevenLabsService.getVoiceIdForLanguage('en');
            const modelId = isMurf ? MurfService.getModelId() : ElevenLabsService.selectTtsModel({ language: 'en', text: PROMOTIONAL_DEMO_SCRIPT, voiceId });

            // 1. Retrieve pre-cached audio or synthesize via Murf (or ElevenLabs if Murf not configured)
            let audioBuffer = isMurf
                ? MurfService.getCachedAudio(PROMOTIONAL_DEMO_SCRIPT, { voiceId, modelId })
                : ElevenLabsService.getCachedAudio(PROMOTIONAL_DEMO_SCRIPT, { voiceId, modelId, language: 'en' });

            if (!audioBuffer) {
                console.log(`[CallSession] [PROMO] Pre-cached audio not found. Synthesizing promotional audio via ${isMurf ? 'Murf' : 'ElevenLabs'}...`);
                if (isMurf) {
                    audioBuffer = await MurfService.textToSpeech(PROMOTIONAL_DEMO_SCRIPT, {
                        voiceId,
                        model: modelId,
                        timeoutMs: 15000
                    });
                } else if (ElevenLabsService.isConfigured()) {
                    audioBuffer = await ElevenLabsService.textToSpeech(PROMOTIONAL_DEMO_SCRIPT, {
                        voiceId,
                        modelId,
                        language: 'en',
                        outputFormat: 'ulaw_8000',
                        timeoutMs: 15000
                    });
                }
            }

            if (!audioBuffer || audioBuffer.length === 0) {
                console.error('[CallSession] [PROMO] Promotional audio unavailable; terminating call safely.');
                this.promoState = 'FAILED';
                await this.terminatePromotionalCall('AUDIO_UNAVAILABLE');
                return;
            }

            this.latencyTracker.markTtsEnd(true);
            this.latencyTracker.markFirstAudioChunkSent();

            // 2. Exact audio duration calculation (8000 bytes/sec at 8kHz ulaw)
            const durationMs = Math.round((audioBuffer.length / 8000) * 1000);
            this.aiSpeechEndTime = Date.now() + durationMs;

            // 3. Dispatch complete audio buffer to Plivo
            const payloadBase64 = audioBuffer.toString('base64');
            if (this.ws && this.ws.readyState === this.ws.OPEN) {
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
                console.log(`[CallSession] [PROMO] Dispatched ${audioBuffer.length} bytes (~${durationMs}ms) of promotional audio to Plivo.`);
            }

            this.conversationHistory.push({
                speaker: 'REMO',
                text: PROMOTIONAL_DEMO_SCRIPT,
                time: '00:00'
            });

            // 4. Exact playback completion event:
            // Terminates the call immediately after audio finishes (+ 200ms to allow hardware jitter buffer to clear).
            const completionMs = durationMs + 200;
            console.log(`[CallSession] [PROMO] Promotional audio scheduled to finish in ${completionMs}ms. Hang-up will trigger immediately.`);

            if (this.promoPlaybackTimer) clearTimeout(this.promoPlaybackTimer);
            this.promoPlaybackTimer = setTimeout(async () => {
                console.log(`[CallSession] [PROMO] Audio playback complete. Disconnecting call immediately.`);
                this.promoState = 'COMPLETED';
                await this.terminatePromotionalCall('PLAYBACK_COMPLETED');
            }, completionMs);

        } catch (err) {
            console.error('[CallSession] [PROMO] Error in executePromotionalDemo:', err.message);
            this.promoState = 'FAILED';
            await this.terminatePromotionalCall('EXECUTION_ERROR');
        }
    }

    /**
     * Terminates promotional call immediately:
     * - Hangs up telephony line via Plivo REST API.
     * - Closes WebSocket stream.
     * - Prevents any further conversational processing.
     */
    async terminatePromotionalCall(reason = 'NORMAL') {
        if (this.promoHangupTriggered) return;
        this.promoHangupTriggered = true;

        if (this.promoPlaybackTimer) {
            clearTimeout(this.promoPlaybackTimer);
            this.promoPlaybackTimer = null;
        }

        this.isAiSpeaking = false;
        this.callStatus = 'completed';
        this.promoState = 'COMPLETED';

        console.log(`[CallSession] [PROMO] Terminating promotional call ${this.callId} (Reason: ${reason})...`);

        // 1. Send hangup request to Plivo REST API
        try {
            await PlivoService.hangupCall(this.callId);
        } catch (hangupErr) {
            console.warn('[CallSession] [PROMO] Plivo REST hangup note:', hangupErr.message);
        }

        // 2. Close WebSocket connection
        try {
            if (this.ws && this.ws.readyState === this.ws.OPEN) {
                this.ws.close(1000, `Promotional call completed: ${reason}`);
            }
        } catch (wsErr) {}

        // 3. Persist promotional call record
        this.persistCallResults().catch(e => {
            console.warn('[CallSession] [PROMO] Non-fatal promo persistence warning:', e.message);
        });
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
                if (!this.campaignId && row.batch_id) {
                    const batchRow = await db.get('SELECT campaign_id FROM batches WHERE id = ?', [row.batch_id]);
                    if (batchRow && batchRow.campaign_id) {
                        this.campaignId = batchRow.campaign_id;
                    }
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
                    const campCtx = await CampaignService.getCampaignContext(this.campaignId);
                    if (campCtx) {
                        this.campaign = campCtx;
                        if (campCtx.service) {
                            this.service = campCtx.service.toLowerCase().trim();
                            this.contact.service = this.service;
                        }
                        if (campCtx.extracted_data) {
                            this.campaignContext = campCtx.extracted_data;
                        }
                        if (this.campaignContext && this.campaignContext.job_title && (!this.jobRole || this.jobRole === 'the open position')) {
                            this.jobRole = this.campaignContext.job_title;
                            this.contact.job_role = this.campaignContext.job_title;
                        }
                        if (this.service === 'sales' && this.campaignContext) {
                            if (this.campaignContext.company_name) {
                                this.contact.company = this.campaignContext.company_name;
                                this.companyName = this.campaignContext.company_name;
                            }
                            if (this.campaignContext.product_name) {
                                this.contact.job_role = this.campaignContext.product_name;
                                this.jobRole = this.campaignContext.product_name;
                            }
                        }
                        if (campCtx.question_plan) {
                            this.questionPlan = campCtx.question_plan;
                        }

                        // Apply campaign-configured primary language and AI voice
                        const campLang = campCtx.primary_language || campCtx.config?.primary_language;
                        const campLocale = campCtx.primary_locale || campCtx.config?.primary_locale || campLang;
                        const campVoice = campCtx.voice_id || campCtx.config?.voice_id;

                        if (campLocale) {
                            this.primaryLocale = campLocale;
                            this.primaryLanguage = campLang || campLocale;
                            const shortCode = campLocale.split('-')[0].toLowerCase();
                            this.setSessionLanguage(shortCode, 'CAMPAIGN_CONFIG');
                        }
                        if (campVoice) {
                            this.campaignVoiceKey = VoiceRegistry.normalizeVoiceKey(campVoice);
                        }

                        console.log(`[CallSession] Loaded campaign "${campCtx.name}" (${campCtx.id}) — Service: ${campCtx.service}, Lang: ${this.primaryLocale || 'en-IN'} (${this.detectedLanguage}), Voice: ${this.campaignVoiceKey || 'pooja'}`);
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
     * Appointment calls only: after every reply, work out from the collected details which one is
     * being asked next, so the stage and the "asked too many times" counter never go stale.
     */
    syncAppointmentState() {
        if (this.service !== 'appointment') return;
        this.apptTracker = AppointmentState.trackAsk(this.apptTracker, this.collectedData);
        // A caller who will not give a name must not block the booking.
        if (this.apptTracker.field === 'caller_name' && this.apptTracker.count >= AppointmentState.GIVE_UP_AFTER) {
            this.collectedData.caller_name = 'Not given';
            if (this.memory && typeof this.memory.recordFact === 'function') {
                this.memory.recordFact('caller_name', 'Not given');
            }
            this.apptTracker = AppointmentState.trackAsk(this.apptTracker, this.collectedData);
        }
        const stage = AppointmentState.stageFor(this.collectedData);
        if (stage !== this.currentStage) {
            this.stageHistory.push(this.currentStage);
            this.currentStage = stage;
        }
        if (this.memory) this.memory.currentStage = stage;
    }

    /**
     * Sales calls only: after every reply, count how many times in a row the same discovery detail
     * has gone unanswered, so the prompt can tell the AI to stop repeating the question.
     */
    syncSalesState() {
        if (this.service !== 'sales') return;
        this.salesTracker = SalesState.trackTurn(this.salesTracker, this.collectedData, this.currentStage);
    }

    /**
     * Sales calls only: remembers that the call-or-in-person question has been said, so it is asked once.
     */
    noteSalesReply(spoken) {
        if (this.service !== 'sales') return;
        const fields = SalesState.noteSpokenReply(this.collectedData, spoken);
        if (!fields) return;
        this.collectedData = { ...this.collectedData, ...fields };
        if (this.memory && typeof this.memory.recordFact === 'function') {
            for (const [k, v] of Object.entries(fields)) this.memory.recordFact(k, v);
        }
    }

    /**
     * Resolves the full voice configuration (voiceId, model, style, locale, provider)
     * for this call session based on campaign settings or server-side voice registry.
     */
    pickVoiceConfig() {
        const isMurf = MurfService.isConfigured();
        if (!isMurf) {
            const voiceId = (this.agent && this.agent.voice_id && this.detectedLanguage !== 'te')
                ? this.agent.voice_id
                : ElevenLabsService.getVoiceIdForLanguage(this.detectedLanguage);
            return {
                voiceKey: 'elevenlabs',
                voiceId,
                provider: 'elevenlabs',
                model: ElevenLabsService.selectTtsModel({ language: this.detectedLanguage, text: '', voiceId }),
                style: 'Conversational',
                locale: this.primaryLocale || 'en-IN'
            };
        }

        const voiceKey = this.campaignVoiceKey || this.campaignContext?.voice_id || this.campaign?.voice_id || this.campaignContext?.config?.voice_id || this.campaign?.config?.voice_id || 'pooja';
        const locale = this.primaryLocale || this.campaignContext?.primary_locale || this.campaign?.primary_locale || this.campaignContext?.config?.primary_locale || this.campaign?.config?.primary_locale || (this.detectedLanguage === 'te' ? 'te-IN' : (this.detectedLanguage === 'hi' ? 'hi-IN' : (this.detectedLanguage === 'ta' ? 'ta-IN' : (this.detectedLanguage === 'kn' ? 'kn-IN' : (this.detectedLanguage === 'ml' ? 'ml-IN' : (this.detectedLanguage === 'mr' ? 'mr-IN' : 'en-IN'))))));

        try {
            const resolved = VoiceRegistry.resolveVoice(voiceKey, locale);
            return {
                voiceKey: resolved.id,
                voiceId: resolved.voiceId,
                provider: resolved.provider,
                model: resolved.model,
                style: resolved.style,
                locale: locale
            };
        } catch (resolveErr) {
            console.warn(`[CallSession] Voice resolution note for "${voiceKey}" (${locale}):`, resolveErr.message);
            return {
                voiceKey: 'pooja',
                voiceId: MurfService.getVoiceId(),
                provider: 'murf',
                model: MurfService.getModelId(),
                style: MurfService.getStyle(),
                locale: locale
            };
        }
    }

    /**
     * Voice selection for this call: Murf voice when configured,
     * otherwise the agent's custom voice or ElevenLabs voice.
     */
    pickVoiceId() {
        const cfg = this.pickVoiceConfig();
        return cfg.voiceId;
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
        // An agent with no greeting of its own opens with its own name only. A named sales contact is only asked
        // for their name, which names no company, and a campaign document that names its company still wins.
        const namedSalesContact = this.service === 'sales' && this.hasRealCallerName();
        const neutralOpening = !agentGreeting && this.agent
            && this.service !== 'recruitment' && !namedSalesContact
            && !(this.campaignContext && this.campaignContext.company_name)
            ? AgentService.neutralOpening(this.agent.name, {
                name: this.hasRealCallerName() ? this.contact.name : '',
                lang: this.detectedLanguage,
                inbound: this.direction === 'inbound'
            })
            : '';
        const greeting = agentGreeting || neutralOpening || GeminiService.getOpeningGreeting(this.service, {
            ...this.contact,
            campaignContext: this.campaignContext
        });
        this.currentQuestion = greeting;
        if (this.service === 'sales') {
            const rawName = (this.contact && this.contact.name) ? String(this.contact.name).trim() : '';
            const isNamed = rawName && !rawName.startsWith('Contact') && !rawName.startsWith('Caller') && !rawName.startsWith('Customer');
            this.currentStage = isNamed ? 'GREETING' : 'PERMISSION_CHECK';
        } else if (this.service === 'recruitment' && /\bam i speaking with\b/i.test(greeting)) {
            // "Hello, am I speaking with <name>?": the candidate confirms who they are first, then hears the introduction.
            this.currentStage = 'GREETING';
        } else {
            this.currentStage = 'AVAILABILITY';
        }
        this.questions.syncStage(this.currentStage);
        // The greeting already used the contact's name, so a booking call does not ask for it again.
        if (this.service === 'appointment' && this.hasRealCallerName() && !this.collectedData.caller_name) {
            this.collectedData.caller_name = String(this.contact.name).trim();
        }

        console.log(`[CallSession] Delivering opening greeting: "${greeting.substring(0, 80)}..."`);
        this.setConversationState(ConversationStates.SPEAKING, 'opening_greeting');
        this.logDiagnostic('remo_started_speaking', { text: greeting, isGreeting: true });

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
            const voiceConfig = this.pickVoiceConfig();
            const voiceId = voiceConfig.voiceId;
            const isMurf = voiceConfig.provider === 'murf';
            const ttsProvider = isMurf ? 'murf' : 'elevenlabs';
            const modelId = isMurf ? voiceConfig.model : ElevenLabsService.selectTtsModel({ language: this.detectedLanguage, text: greeting, voiceId });
            const locale = voiceConfig.locale;

            if (!isMurf) {
                const textLang = ElevenLabsService.detectLanguageFromText(greeting, this.detectedLanguage);
                if (textLang && textLang !== this.detectedLanguage) {
                    this.setSessionLanguage(textLang, 'GREETING_SCRIPT');
                }
            }

            // 1. Instant Cache Check (< 1ms delivery)
            const cachedAudio = isMurf
                ? MurfService.getCachedAudio(greeting, { voiceId, model: modelId, locale })
                : ElevenLabsService.getCachedAudio(greeting, { voiceId, modelId });

            const minExpectedGreetingBytes = Math.min(
                greeting.split(/\s+/).filter(Boolean).length * 1400,
                greeting.length * 150
            );

            if (cachedAudio && cachedAudio.length >= minExpectedGreetingBytes) {
                console.log(`[CallSession] Instant cache hit for opening greeting (${cachedAudio.length} bytes)! Dispatching audio in < 5ms via ${ttsProvider}.`);
                this.latencyTracker.markGreetingDelivered();
                this.greetingDelivered = true;
                this.greetingInProgress = false;
                await this.dispatchAudioBuffer(cachedAudio, greeting, this.beginResponse(0));
                return;
            } else if (cachedAudio) {
                console.warn(`[CallSession] Cached opening greeting was incomplete (${cachedAudio.length} bytes < ${minExpectedGreetingBytes} min expected). Synthesizing freshly.`);
            }

            // 2. Synthesize audio via active TTS provider
            console.log(`[CallSession] Synthesizing opening greeting via ${ttsProvider} (Lang: ${this.detectedLanguage}, Locale: ${locale}, Voice: ${voiceConfig.voiceKey || voiceId})...`);
            await this.playAiAudio(greeting, this.beginResponse(0));
            this.latencyTracker.markGreetingDelivered();
            this.greetingDelivered = true;
            this.greetingInProgress = false;
        } catch (greetErr) {
            console.error('[CallSession] Error delivering greeting:', greetErr.message);
            this.greetingInProgress = false;
            this.setConversationState(ConversationStates.LISTENING, 'greeting_error');
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
            // More speech of the same reply is still being made: the audio so far ending is not the end of the reply.
            if (this.pendingSpeech > 0 && this.aiSpeechEndTime > 0) {
                this.scheduleSpeechEnd();
                return;
            }
            // If an early sentence finished playing but the LLM is still generating the remainder, wait for generation.
            if (this.activeResponse && this.activeResponse.isStreaming && !this.activeResponse.llmComplete) {
                this.scheduleSpeechEnd();
                return;
            }
            this.completePlayback('timer');
        }, this.pendingSpeech > 0 ? Math.max(wait, 60) : wait);
    }

    /**
     * The reply's audio has finished playing on the phone: the bot may listen again.
     * @param {'timer'|'plivo_checkpoint'} source how the end was detected
     */
    completePlayback(source) {
        if (this.activeSpeechTimer) { clearTimeout(this.activeSpeechTimer); this.activeSpeechTimer = null; }
        this.speechSeq++;
        if (!this.isAiSpeaking || this.isClosed) return;
        this.isAiSpeaking = false;
        console.log('[CallSession] AI finished speaking turn. Now listening for caller.');
        if (this.activeResponse && !this.activeResponse.cancelled) {
            this.activeResponse.phase = 'PLAYBACK_COMPLETED';
            this.activeResponse.playbackComplete = true;
        }
        this.questions.noteResponsePlayed();
        this.logDiagnostic('playback_completed', { source, responseId: this.activeResponse ? this.activeResponse.id : null });
        if (this.conversationState === ConversationStates.SPEAKING) {
            this.setConversationState(ConversationStates.LISTENING, 'speech_playback_complete');
        }
        this.checkAndApplyOverlapAudio();
    }

    /** Plivo reports that the audio before one of our checkpoints has been played. */
    handlePlaybackCheckpoint(name) {
        if (!name || name !== this.playbackCheckpoint || this.isClosed) return;
        if (this.pendingSpeech > 0) return; // more speech of this reply was queued after the checkpoint
        this.playbackCheckpoint = null;
        this.completePlayback('plivo_checkpoint');
    }

    /** Asks Plivo to tell us when everything sent so far has been played. */
    sendPlaybackCheckpoint() {
        if (!PLAYBACK_CHECKPOINTS || !this.streamId || !this.ws || this.ws.readyState !== this.ws.OPEN) return;
        const name = `cp_${this.callId}_${++this.checkpointSeq}`;
        this.playbackCheckpoint = name;
        try {
            this.ws.send(JSON.stringify({ event: 'checkpoint', streamId: this.streamId, name }));
        } catch (e) {
            this.playbackCheckpoint = null;
        }
    }

    // ------------------------------------------------------------------------------------------
    // Response lifecycle: one active response per call, cancellable, with ordered speech
    // ------------------------------------------------------------------------------------------

    /** Starts the one response for a caller turn. A response still active from before is cancelled. */
    beginResponse(turnId = this.currentTurnId) {
        this.cancelActiveResponse('superseded_by_new_response');
        const response = {
            id: ++this.responseSeq,
            turnId,
            cancelled: false,
            phase: 'GENERATING',
            spoken: [],
            startedAt: Date.now(),
            llmComplete: false,
            ttsComplete: false,
            chunksDelivered: false,
            playbackComplete: false,
            callTerminated: false
        };
        this.activeResponse = response;
        this.logDiagnostic('response_started', { responseId: response.id, turnId });
        return response;
    }

    /** Stops a response so none of its remaining speech plays (caller interrupted, or a newer response started). */
    cancelActiveResponse(reason) {
        const r = this.activeResponse;
        if (!r || r.cancelled || r.phase === 'PLAYBACK_COMPLETED') return;
        r.cancelled = true;
        r.phase = 'CANCELLED';
        this.logDiagnostic('response_cancelled', { responseId: r.id, reason });
    }

    /**
     * The caller's turn is fully handled. The turn is released at once, but the bot only goes back to
     * "listening" when its audio has really finished (completePlayback does that).
     */
    finishTurn(reason) {
        this.isProcessingTurn = false;
        this.processingSince = 0;
        const callerIsTalking = this.conversationState === ConversationStates.CANDIDATE_SPEAKING
            || this.conversationState === ConversationStates.WAITING_FOR_END_OF_TURN;
        if (this.isAiSpeaking || this.pendingSpeech > 0) {
            this.logDiagnostic('turn_released_while_audio_playing', { reason });
        } else if (!callerIsTalking && this.conversationState !== ConversationStates.COMPLETED) {
            this.setConversationState(ConversationStates.LISTENING, reason);
        }
        this.checkAndApplyOverlapAudio();
    }

    /** The first audio of a piece of speech is going out: any question in it now counts as asked. */
    noteSpeechStarted(text, response) {
        if (response && response.phase === 'GENERATING') response.phase = 'SPEAKING';
        this.questions.setLanguage(this.detectedLanguage);
        this.questions.syncStage(this.currentStage);
        const entry = this.questions.noteResponseStarted(text, { turnId: response ? response.turnId : this.currentTurnId });
        if (!response || !response.playbackStarted) {
            if (response) response.playbackStarted = true;
            this.logDiagnostic('playback_started', {
                responseId: response ? response.id : null,
                questionId: entry ? entry.id : null,
                topic: entry ? entry.topic : null,
                text: String(text).slice(0, 120)
            });
        }
    }

    /** All queued speech has been sent. Ask Plivo for the real end-of-playback signal and arm the timer fallback. */
    onSpeechQueueDrained(response) {
        if (this.isClosed || (response && response.cancelled)) return;
        if (!this.isAiSpeaking) return;
        this.sendPlaybackCheckpoint();
        this.scheduleSpeechEnd();
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
        if (this.isAiSpeaking && this.aiSpeechEndTime > 0 && now > this.aiSpeechEndTime + SPEECH_GRACE_MS) {
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
    async dispatchAudioBuffer(audioBuffer, text, response = null) {
        if (!audioBuffer || this.isClosed) return;
        if (response && response.cancelled) return;

        try {
            this.isAiSpeaking = true;
            // ulaw_8000: 8000 bytes/sec (8-bit PCM, 8kHz mono)
            const durationMs = Math.round((audioBuffer.length / 8000) * 1000);
            // Audio queued behind speech that is still playing starts when that speech ends.
            this.aiSpeechEndTime = Math.max(this.aiSpeechEndTime, Date.now()) + durationMs;
            if (text) this.noteSpeechStarted(text, response);

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
                if (response) {
                    response.chunksDelivered = true;
                }
                console.log(`[CallSession] Sent ${audioBuffer.length} bytes of audio to Plivo (~${durationMs}ms at 8kHz ulaw)`);
            }

            this.scheduleSpeechEnd();

        } catch (e) {
            console.error('[CallSession] dispatchAudioBuffer error:', e.message);
            this.isAiSpeaking = false;
            if (this.conversationState === ConversationStates.SPEAKING) {
                this.setConversationState(ConversationStates.LISTENING, 'playback_error');
            }
        }
    }

    /**
     * Updates call session language and halts any active audio from the previous language.
     * Prevents stale audio from playing after a language switch.
     */
    setSessionLanguage(newLanguage, reason = 'unknown') {
        const normalized = ElevenLabsService.normalizeLanguageCode(newLanguage);
        if (normalized && normalized !== this.detectedLanguage) {
            const oldLanguage = this.detectedLanguage;
            console.log(`[CallSession] Language switch detected: ${oldLanguage} -> ${normalized} (Reason: ${reason})`);

            // Clear any queued / in-flight Plivo playback buffer from the previous language
            if (this.streamId && this.ws && this.ws.readyState === this.ws.OPEN) {
                try {
                    this.ws.send(JSON.stringify({
                        event: 'clearAudio',
                        streamId: this.streamId
                    }));
                } catch (wsErr) {
                    // Non-fatal
                }
            }

            // Cancel any active speech timer
            if (this.activeSpeechTimer) {
                clearTimeout(this.activeSpeechTimer);
                this.activeSpeechTimer = null;
            }

            this.isAiSpeaking = false;
            this.detectedLanguage = normalized;
            // Keep the language state machine and the question record on the same language.
            if (this.languageStateMachine) this.languageStateMachine.currentLanguage = normalized;
            if (this.questions) this.questions.setLanguage(normalized);
        }
    }

    /**
     * Synthesizes dialogue text via ElevenLabs with caching and dispatches audio to Plivo.
     * Uses automatic language-aware model and voice selection (Telugu v4 Turbo, Hindi/English Flash v2.5).
     */
    async playAiAudio(text, response = this.activeResponse) {
        if (!text || this.isClosed) return;
        if (response && response.cancelled) {
            this.logDiagnostic('speech_skipped', { responseId: response.id, reason: 'response_cancelled', text: String(text).slice(0, 60) });
            return;
        }

        // Speech plays strictly in order: a second sentence waits for the first one to finish being sent,
        // so two pieces of audio can never interleave or play twice.
        this.pendingSpeech++;
        const run = async () => {
            try {
                if (this.isClosed || (response && response.cancelled)) {
                    this.logDiagnostic('speech_skipped', { responseId: response ? response.id : null, reason: 'cancelled_while_queued' });
                    return;
                }
                if (response) response.spoken.push(text);
                await this._synthesizeAndSend(text, response);
            } finally {
                this.pendingSpeech = Math.max(0, this.pendingSpeech - 1);
                if (this.pendingSpeech === 0) this.onSpeechQueueDrained(response);
            }
        };
        const job = this.speechChain.then(run, run);
        this.speechChain = job.catch(() => {});
        return job;
    }

    /** Makes one piece of speech with ElevenLabs and sends it to Plivo (called by playAiAudio, one at a time). */
    async _synthesizeAndSend(text, response = null) {
        if (this.callMode === 'PROMOTIONAL_DEMO' && this.promoState === 'COMPLETED') {
            console.log('[CallSession] [PROMO] Suppressing additional speech after promo completion.');
            return;
        }

        try {
            const voiceConfig = this.pickVoiceConfig();
            const voiceId = voiceConfig.voiceId;
            const isMurf = voiceConfig.provider === 'murf';
            const ttsProvider = isMurf ? 'murf' : 'elevenlabs';
            const modelId = isMurf ? voiceConfig.model : ElevenLabsService.selectTtsModel({ language: this.detectedLanguage, text, voiceId });
            const locale = voiceConfig.locale;
            const style = voiceConfig.style;

            // Confirm text language and sync session if response text was in a different language
            if (!isMurf) {
                const textLang = ElevenLabsService.detectLanguageFromText(text, this.detectedLanguage);
                if (textLang && textLang !== this.detectedLanguage) {
                    this.setSessionLanguage(textLang, 'RESPONSE_TEXT_SCRIPT');
                }
            }

            this.currentQuestion = text;
            this.latencyTracker.markTtsStart();

            const voiceName = isMurf ? `Murf ${voiceConfig.voiceKey} (${voiceId}, ${modelId}, ${locale})` : voiceId;
            console.log(`[CallSession] Voice selected: ${voiceName} (VoiceID: ${voiceId}, Provider: ${ttsProvider}, Model: ${modelId})`);

            // Check cache
            let audioBuffer = isMurf
                ? MurfService.getCachedAudio(text, { voiceId, model: modelId, locale })
                : ElevenLabsService.getCachedAudio(text, { voiceId, modelId, language: this.detectedLanguage });
            const isCached = Boolean(audioBuffer);

            // Stream TTS audio chunks directly to Plivo in real-time as they arrive
            let firstChunkSent = false;
            let streamedBytes = 0;

            if (!audioBuffer) {
                // A request that takes too long is given up on, and audio that arrives after that is dropped.
                let abandoned = false;
                let ttsTimer = null;
                const envTimeout = parseInt(process.env.TTS_TIMEOUT_MS, 10);
                const ttsTimeoutMs = envTimeout >= 100 ? envTimeout : TTS_TIMEOUT_MS;

                const onChunkHandler = (chunk) => {
                    if (!chunk || abandoned || this.isClosed || !this.ws || this.ws.readyState !== this.ws.OPEN) return;
                    // The caller interrupted, or a newer reply started: this reply must not play another sound.
                    if (response && response.cancelled) return;
                    streamedBytes += chunk.length;
                    this.isAiSpeaking = true;
                    this.noteSpeechChunk(chunk.length);

                    // Mark first audio chunk sent for precise caller-endpoint-to-audible-response metric
                    if (!firstChunkSent) {
                        firstChunkSent = true;
                        this.latencyTracker.markFirstAudioChunkSent();
                        this.noteSpeechStarted(text, response);
                        console.log(`[CallSession] First audio chunk streamed to Plivo (${chunk.length} bytes via ${ttsProvider})`);
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
                };

                let ttsPromise;
                if (isMurf) {
                    ttsPromise = MurfService.textToSpeech(text, {
                        voiceId,
                        model: modelId,
                        style,
                        locale,
                        onChunk: onChunkHandler,
                        timeoutMs: ttsTimeoutMs
                    });
                } else if (ElevenLabsService.isConfigured()) {
                    ttsPromise = ElevenLabsService.textToSpeech(text, {
                        voiceId,
                        modelId,
                        language: this.detectedLanguage,
                        outputFormat: 'ulaw_8000',
                        onChunk: onChunkHandler,
                        timeoutMs: ttsTimeoutMs
                    });
                } else {
                    ttsPromise = Promise.resolve(null);
                }

                try {
                    audioBuffer = await Promise.race([
                        ttsPromise,
                        new Promise((resolve) => {
                            ttsTimer = setTimeout(() => {
                                abandoned = true;
                                console.warn(`[CallSession] Text-to-speech (${ttsProvider}) did not answer within ${ttsTimeoutMs}ms. Giving up on this piece of speech.`);
                                this.logDiagnostic('tts_timeout', { provider: ttsProvider, responseId: response ? response.id : null, text: String(text).slice(0, 60) });
                                resolve(null);
                            }, ttsTimeoutMs);
                        })
                    ]);
                } catch (ttsErr) {
                    console.error(`[CallSession] TTS Error (${ttsProvider}):`, ttsErr.message);
                    this.logDiagnostic('tts_error', { provider: ttsProvider, error: ttsErr.message, responseId: response ? response.id : null });
                } finally {
                    if (ttsTimer) clearTimeout(ttsTimer);
                }
                ttsPromise.catch(() => {});
            }

            if (response) {
                response.ttsComplete = true;
            }
            this.latencyTracker.markTtsEnd(isCached);

            this.logDiagnostic('tts_completed', {
                ttsProvider,
                modelId,
                voiceId,
                responseId: response ? response.id : null,
                cached: isCached,
                audioStarted: firstChunkSent,
                cancelled: Boolean(response && response.cancelled),
                bytes: audioBuffer ? audioBuffer.length : streamedBytes
            });

            if (response && response.cancelled) {
                // Interrupted while the speech was being made: whatever was already sent was cleared by the barge-in.
                return;
            }

            if (!audioBuffer && !firstChunkSent) {
                console.warn(`[CallSession] ${ttsProvider} TTS unavailable; simulating turn timing.`);
                const wordCount = text.split(/\s+/).length;
                const simDurationMs = Math.max(wordCount * 320, 1400);
                this.isAiSpeaking = true;
                this.aiSpeechEndTime = Math.max(this.aiSpeechEndTime, Date.now()) + simDurationMs;
                this.logDiagnostic('speech_unavailable', { provider: ttsProvider, responseId: response ? response.id : null, text: String(text).slice(0, 60) });
                this.scheduleSpeechEnd();
                return;
            }

            // If audio was already streamed chunk-by-chunk, calculate total duration and set completion timer
            if (firstChunkSent) {
                const totalDurationMs = Math.round((streamedBytes / 8000) * 1000);
                if (response) response.chunksDelivered = true;
                console.log(`[CallSession] Incremental stream complete: ${streamedBytes} bytes (~${totalDurationMs}ms at 8kHz ulaw)`);
                this.latencyTracker.markAudioDispatched();
                this.scheduleSpeechEnd();
            } else {
                // If loaded from RAM cache, dispatch complete buffer instantly
                this.latencyTracker.markFirstAudioChunkSent();
                await this.dispatchAudioBuffer(audioBuffer, text, response);
                if (response) response.chunksDelivered = true;
            }

        } catch (e) {
            console.error('[CallSession] playAiAudio error:', e.message);
            this.isAiSpeaking = false;
            if (this.conversationState === ConversationStates.SPEAKING) {
                this.setConversationState(ConversationStates.LISTENING, 'speech_error');
            }
        }
    }

    /**
     * Processes inbound audio packets from the caller (Plivo media event).
     */
    async handleInboundAudio(mulawChunk) {
        this.lastInboundAudioAt = Date.now();
        this.inboundFrames++;

        // STRICT ONE-WAY PROMOTIONAL DEMO GUARD:
        // Remo must deliver the entire promotional script in a single uninterrupted sequence.
        // Must not listen, buffer caller audio, trigger barge-in, or generate responses.
        if (this.callMode === 'PROMOTIONAL_DEMO') {
            return;
        }

        if (this.isClosed) return;

        // If the call is in closing sequence and delivering farewell, do not allow barge-in to truncate it
        if (this.isClosingCall) {
            return;
        }

        // Watchdog: never stay deaf. If the bot is still marked as speaking well after its audio ended
        // (its end-of-speech timer was lost), go back to listening right now.
        if (this.isAiSpeaking && this.aiSpeechEndTime > 0 && this.lastInboundAudioAt > this.aiSpeechEndTime + SPEECH_GRACE_MS) {
            console.warn('[CallSession] Watchdog: the bot was still marked as speaking after its audio ended. Switching back to listening.');
            this.isAiSpeaking = false;
            if (this.activeSpeechTimer) { clearTimeout(this.activeSpeechTimer); this.activeSpeechTimer = null; }
        }

        const pcm16 = decodeMulawToPcm16(mulawChunk);
        const energy = calculateRms(pcm16);
        const hasSpeech = energy >= this.ENERGY_THRESHOLD;

        // SCENARIO 1: AI IS CURRENTLY SPEAKING (Barge-In Handling)
        if (this.isAiSpeaking || this.conversationState === ConversationStates.SPEAKING) {
            const hasBargeInSpeech = energy >= (this.BARGE_IN_ENERGY_THRESHOLD || 850);
            if (hasBargeInSpeech) {
                this.overlapMulawChunks.push(mulawChunk);
                this.overlapSpeechFrames++;

                // If candidate speaks sustained speech (>= 1200ms), trigger barge-in!
                // During opening greeting (turn 0), require at least 80 frames (~1600ms) to ensure line connect clicks do not cut greeting
                const minBargeInFrames = (this.greetingInProgress || this.currentTurnId === 0) ? 80 : this.MIN_INTERRUPT_FRAMES;
                if (this.overlapSpeechFrames >= minBargeInFrames) {
                    console.log(`[CallSession] Caller sustained speech detected (${this.overlapSpeechFrames * 20}ms). Stopping AI speech (Barge-in).`);
                    this.logDiagnostic('candidate_speech_started', { reason: 'barge_in', frames: this.overlapSpeechFrames });

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

                    // Stop the rest of this reply for good: queued sentences are skipped and audio still being made is dropped.
                    this.cancelActiveResponse('barge_in');
                    this.playbackCheckpoint = null;

                    this.isAiSpeaking = false;
                    this.interruptedWithAnswer = true;

                    // Clean up any old STT session on barge-in
                    if (this.activeSttSession) {
                        this.activeSttSession.close();
                        this.activeSttSession = null;
                    }

                    // Move overlap audio into active caller buffer
                    const overlapCopy = [...this.overlapMulawChunks];
                    this.callerMulawChunks.push(...this.overlapMulawChunks);
                    this.overlapMulawChunks = [];
                    this.consecutiveSpeechFrames = this.overlapSpeechFrames;
                    this.overlapSpeechFrames = 0;
                    this.isCallerSpeaking = true;
                    this.consecutiveSilenceFrames = 0;
                    this.setConversationState(ConversationStates.CANDIDATE_SPEAKING, 'barge_in');

                    // Start continuous STT session for barge-in turn
                    if (MurfService.isConfigured()) {
                        const nextTurnId = this.currentTurnId + 1;
                        this.activeSttTurnId = nextTurnId;
                        this.activeSttSession = MurfService.createSttSession({
                            callId: this.callId,
                            turnId: nextTurnId,
                            language: this.detectedLanguage,
                            codec: 'mulaw',
                            sampleRate: 8000,
                            onReady: (connectMs) => {
                                this.latencyTracker.markSttSessionReady(connectMs);
                            }
                        });
                        for (const chunk of overlapCopy) {
                            this.activeSttSession.sendAudioChunk(chunk);
                        }
                    }
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

        // SCENARIO 2: AI IS FINALIZING OR GENERATING RESPONSE (Turn in progress)
        // Never discard candidate audio during STT finalization or LLM reasoning!
        // Buffer into overlapMulawChunks so continued candidate speech rolls into next turn.
        if (this.isProcessingTurn ||
            this.conversationState === ConversationStates.FINALIZING_TRANSCRIPT ||
            this.conversationState === ConversationStates.PROCESSING_ANSWER ||
            this.conversationState === ConversationStates.GENERATING_RESPONSE) {
            if (hasSpeech) {
                this.overlapMulawChunks.push(mulawChunk);
                this.overlapSpeechFrames++;
                this.logDiagnostic('candidate_speech_detected', { context: 'during_turn_processing', frames: this.overlapSpeechFrames });
            } else if (this.overlapSpeechFrames > 0) {
                // Keep brief silence frames in overlap buffer so speech pauses are preserved when rolled over
                this.overlapMulawChunks.push(mulawChunk);
            }
            return;
        }

        // SCENARIO 3: ACTIVE CALLER TURN (AI LISTENING)
        if (this.conversationState === ConversationStates.IDLE) {
            this.setConversationState(ConversationStates.LISTENING, 'inbound_audio_received');
        }

        if (hasSpeech) {
            this.logDiagnostic('candidate_speech_detected', { rms: energy });

            if (this.conversationState === ConversationStates.LISTENING) {
                this.setConversationState(ConversationStates.CANDIDATE_SPEAKING, 'speech_started');
                this.logDiagnostic('candidate_speech_started', { initialRms: energy });
                this.latencyTracker.markCallerSpeechStarted();
                this.consecutiveSpeechFrames = 0;
                this.consecutiveSilenceFrames = 0;

                // Start continuous STT streaming session if not already active
                if (MurfService.isConfigured() && !this.activeSttSession) {
                    const nextTurnId = this.currentTurnId + 1;
                    this.activeSttTurnId = nextTurnId;
                    this.activeSttSession = MurfService.createSttSession({
                        callId: this.callId,
                        turnId: nextTurnId,
                        language: this.detectedLanguage,
                        codec: 'mulaw',
                        sampleRate: 8000,
                        onReady: (connectMs) => {
                            this.latencyTracker.markSttSessionReady(connectMs);
                        }
                    });
                }
            } else if (this.conversationState === ConversationStates.WAITING_FOR_END_OF_TURN) {
                const elapsedSilenceMs = this.consecutiveSilenceFrames * 20;
                this.logDiagnostic('silence_timer_reset_speech_resumed', { elapsedSilenceMs });
                this.setConversationState(ConversationStates.CANDIDATE_SPEAKING, 'speech_resumed_after_pause');
                this.consecutiveSilenceFrames = 0;
            }

            this.callerMulawChunks.push(mulawChunk);
            if (this.activeSttSession) {
                this.activeSttSession.sendAudioChunk(mulawChunk);
            }
            this.consecutiveSpeechFrames++;
            this.isCallerSpeaking = true;
        } else {
            if (this.conversationState === ConversationStates.CANDIDATE_SPEAKING) {
                // First silence frame: start silence timer and enter WAITING_FOR_END_OF_TURN
                this.isCallerSpeaking = false;
                this.setConversationState(ConversationStates.WAITING_FOR_END_OF_TURN, 'speech_pause_started');
                const thresholdMs = this.getSilenceThresholdMs();
                this.logDiagnostic('silence_timer_started', { thresholdMs, consecutiveSpeechFrames: this.consecutiveSpeechFrames });
                this.callerMulawChunks.push(mulawChunk);
                if (this.activeSttSession) {
                    this.activeSttSession.sendAudioChunk(mulawChunk);
                }
                this.consecutiveSilenceFrames = 1;
            } else if (this.conversationState === ConversationStates.WAITING_FOR_END_OF_TURN) {
                this.callerMulawChunks.push(mulawChunk);
                if (this.activeSttSession) {
                    this.activeSttSession.sendAudioChunk(mulawChunk);
                }
                this.consecutiveSilenceFrames++;

                const currentSilenceMs = this.consecutiveSilenceFrames * 20;
                const thresholdMs = this.getSilenceThresholdMs();

                // Compute frames required
                let silenceRequiredFrames = Math.max(1, Math.round(thresholdMs / 20));
                if (this.service !== 'recruitment' && this.consecutiveSpeechFrames >= 50) {
                    silenceRequiredFrames += 3;
                }

                if (this.consecutiveSilenceFrames >= silenceRequiredFrames) {
                    this.logDiagnostic('end_of_turn_confirmed', {
                        reason: 'silence_threshold_reached',
                        silenceMs: currentSilenceMs,
                        thresholdMs,
                        totalAudioBytes: this.callerMulawChunks.length * 160,
                        totalSpeechFrames: this.consecutiveSpeechFrames
                    });

                    this.latencyTracker.markVadSilence(currentSilenceMs, this.currentTurnId + 1);

                    this.isCallerSpeaking = false;
                    this.consecutiveSilenceFrames = 0;
                    this.consecutiveSpeechFrames = 0;
                    this.setConversationState(ConversationStates.FINALIZING_TRANSCRIPT, 'silence_threshold_met');
                    await this.processCallerTurn();
                }
            }
        }
    }

    /**
     * Completes caller audio turn:
     * 1. Transcribes via ElevenLabs Scribe STT.
     * 2. Filters noise transcripts (FIX-2) and handles unclear audio (Test H).
     * 3. Checks deterministic IntentService (< 1ms fast-path).
     * 4. Falls back to optimized LLM only when necessary.
     * 5. Dispatches spoken reply and records comprehensive latency.
     * 6. Safe conversation state transitions and overlap audio roll-over.
     */
    async processCallerTurn() {
        if (this.callMode === 'PROMOTIONAL_DEMO') return;
        if (this.callerMulawChunks.length === 0 || this.isProcessingTurn) return;
        this.isProcessingTurn = true;
        this.processingSince = Date.now();

        // Turn ID safeguard: prevents duplicate or stale turn processing
        const turnId = ++this.currentTurnId;
        this.setConversationState(ConversationStates.FINALIZING_TRANSCRIPT, `turn_${turnId}_start`);
        this.logDiagnostic('transcript_finalization_started', { turnId, chunksCount: this.callerMulawChunks.length });

        const totalMulaw = Buffer.concat(this.callerMulawChunks);
        this.callerMulawChunks = [];

        // Check minimum audio duration (>= 200ms = 1600 bytes)
        // Prevents dropping short words ("yes", "ok", "no") while filtering clicks
        if (totalMulaw.length < this.MIN_AUDIO_BYTES) {
            this.logDiagnostic('turn_dropped_too_short', { turnId, bytes: totalMulaw.length });
            this.latencyTracker.cancelTurn();
            if (this.activeSttSession) {
                this.activeSttSession.close();
                this.activeSttSession = null;
            }
            this.isProcessingTurn = false;
            this.setConversationState(ConversationStates.LISTENING, 'click_filtered');
            this.checkAndApplyOverlapAudio();
            return;
        }

        const pcm16 = decodeMulawToPcm16(totalMulaw);
        const trimmedPcm = trimSilencePcm16(pcm16, 8000, 350, 100);
        const wavBuffer = pcmToWav(trimmedPcm, 8000, 1, 16);

        let transcript = '';
        let detectedLanguage = this.detectedLanguage || 'en';
        let sttLanguageHint = null;
        let sttError = null;
        let sttFinalizeDurationMs = null;

        // Take ownership of active continuous streaming STT session
        const continuousSession = this.activeSttSession;
        this.activeSttSession = null;

        try {
            if (continuousSession && MurfService.isConfigured()) {
                this.latencyTracker.markSttFinalizeSent();
                console.log(`[CallSession] Finalizing continuous Murf STT for turn ${turnId}...`);
                const sttResult = await continuousSession.finalize(4500);
                if (sttResult.error) {
                    sttError = sttResult.error;
                }
                transcript = (sttResult.transcript || '').trim();
                sttFinalizeDurationMs = sttResult.durationMs || null;
                this.latencyTracker.markSttEnd(transcript.length, sttFinalizeDurationMs);
                continuousSession.close();
            }

            // Fallback to batch Murf STT if continuous STT did not produce a transcript
            if (!transcript && MurfService.isConfigured()) {
                this.latencyTracker.markSttStart();
                const totalDurationSec = Math.round((totalMulaw.length / 8000) * 10) / 10;
                console.log(`[CallSession] Transcribing turn ${turnId} via batch Murf STT (${totalMulaw.length} bytes, ~${totalDurationSec}s 8kHz ulaw, lang: ${this.detectedLanguage})...`);
                const sttResult = await MurfService.speechToText(totalMulaw, {
                    language: this.detectedLanguage,
                    codec: 'mulaw',
                    sampleRate: 8000,
                    timeoutMs: 6500
                });
                if (sttResult.error) {
                    sttError = sttResult.error;
                }
                transcript = (sttResult.transcript || '').trim();
                sttLanguageHint = sttResult.language || null;
                this.latencyTracker.markSttEnd(transcript.length);
            } else if (!transcript && ElevenLabsService.isConfigured()) {
                this.latencyTracker.markSttStart();
                // One speech-to-text request per turn. The request already asks for the language the call has been
                // in, so sending the same audio again with the same language would only add 1-2 seconds of delay.
                let sttResult = await ElevenLabsService.speechToText(wavBuffer, 'caller_turn.wav', this.detectedLanguage);
                if (sttResult.transcript && !isSupportedCallLanguage(sttResult.language)) {
                    // The label is a wrong guess ("lit", "urd"). Keep the words if they are in a script we speak
                    // (English, Hindi, Telugu); drop them as unclear audio if they are not (e.g. Urdu letters).
                    const usable = isUsableCallScript(sttResult.transcript);
                    console.log(`[CallSession] Speech-to-text labelled this turn "${sttResult.language}", which is not English, Hindi or Telugu. ${usable ? 'Keeping the words and the call language.' : 'The words are in another script, so the turn is treated as unclear audio.'}`);
                    this.logDiagnostic('stt_language_label_unsupported', { turnId, label: sttResult.language, kept: usable });
                    sttResult = { transcript: usable ? sttResult.transcript : '', language: this.detectedLanguage };
                }
                transcript = (sttResult.transcript || '').trim();
                // The label speech-to-text puts on a turn is only a hint. A lone "ha", "hmm" or "okay" is often
                // labelled Hindi or Telugu, so the language is decided by the language state machine below
                // (sustained sentences or an explicit request), never by one word.
                sttLanguageHint = sttResult.language || null;
                this.latencyTracker.markSttEnd(transcript.length);
            }
        } catch (e) {
            sttError = e.message;
            console.error('[CallSession] STT error:', e.message);
        }

        // Stale completion guard: if a newer turn started while in STT, discard
        if (turnId !== this.currentTurnId) {
            console.log(`[CallSession] Turn ${turnId} discarded (superseded by turn ${this.currentTurnId}).`);
            this.logDiagnostic('turn_superseded', { staleTurnId: turnId, currentTurnId: this.currentTurnId });
            this.latencyTracker.cancelTurn();
            this.isProcessingTurn = false;
            this.setConversationState(ConversationStates.LISTENING, 'turn_superseded');
            this.checkAndApplyOverlapAudio();
            return;
        }

        this.logDiagnostic('final_transcript_received', { turnId, transcript, language: detectedLanguage });
        this.logDiagnostic('transcript_finalization_completed', { turnId, transcriptLength: transcript.length });

        // Filter noise or handle unclear audio:
        if (!transcript || isNoiseTranscript(transcript)) {
            const hasSubstantialAudio = totalMulaw.length >= 8000 || this.consecutiveSpeechFrames >= 15;
            this.consecutiveUnclearTurns = (this.consecutiveUnclearTurns || 0) + 1;

            // If caller actually spoke substantial audio (> 1s) or there was an STT error, provide a gentle bounded clarification
            if (hasSubstantialAudio && this.consecutiveUnclearTurns <= 2) {
                console.log(`[CallSession] Unclear audio or STT issue on turn ${turnId} (${totalMulaw.length} bytes, attempt ${this.consecutiveUnclearTurns}). Asking for clarification.`);
                this.logDiagnostic('unclear_audio_detected', { turnId, bytes: totalMulaw.length, sttError, attempts: this.consecutiveUnclearTurns });

                this.setConversationState(ConversationStates.GENERATING_RESPONSE, 'unclear_audio_clarification');
                const clarification = this.detectedLanguage === 'te'
                    ? 'క్షమించండి, మీ మాట స్పష్టంగా వినిపించలేదు. దయచేసి మళ్ళీ చెప్పగలరా?'
                    : (this.detectedLanguage === 'hi'
                        ? 'माफ़ कीजिए, मुझे आपकी आवाज़ ठीक से सुनाई नहीं दी। क्या आप कृपया दोबारा बता सकते हैं?'
                        : "I'm sorry, I couldn't quite hear that. Could you please repeat that?");

                const replyTimeSec = Math.floor((Date.now() - this.startTime) / 1000);
                const replyTimeStr = `${String(Math.floor(replyTimeSec / 60)).padStart(2, '0')}:${String(replyTimeSec % 60).padStart(2, '0')}`;
                this.conversationHistory.push({
                    speaker: 'REMO',
                    text: clarification,
                    time: replyTimeStr,
                    isClarification: true
                });

                this.setConversationState(ConversationStates.SPEAKING, 'speaking_clarification');
                this.logDiagnostic('remo_started_speaking', { turnId, text: clarification, isClarification: true });
                const clarifyResponse = this.beginResponse(turnId);
                await this.playAiAudio(clarification, clarifyResponse);
                this.latencyTracker.markAudioDispatched();
                this.finishTurn('clarification_requested');
                return;
            }

            console.log(`[CallSession] Noise/empty transcript filtered: "${transcript || '(empty)'}". Resuming listening.`);
            this.logDiagnostic('noise_transcript_filtered', { turnId, transcript, bytes: totalMulaw.length, sttError });
            this.latencyTracker.cancelTurn();
            this.isProcessingTurn = false;
            this.setConversationState(ConversationStates.LISTENING, 'noise_filtered');
            this.checkAndApplyOverlapAudio();
            return;
        }

        // Valid transcript received -> reset unclear turn counter
        this.consecutiveUnclearTurns = 0;

        // The same words arriving again while the reply to them is still active are one turn, not two
        // (a transcript finalised twice, or an echo of the caller's last words): never answer them twice.
        {
            const normalized = transcript.toLowerCase().replace(/\s+/g, ' ').trim();
            const previous = this.lastFinalTranscript;
            const replyStillActive = Boolean(this.activeResponse)
                && !this.activeResponse.cancelled
                && this.activeResponse.phase !== 'PLAYBACK_COMPLETED';
            if (normalized && normalized === previous.text && Date.now() - previous.at < DUPLICATE_TURN_WINDOW_MS && (replyStillActive || this.isAiSpeaking)) {
                console.log(`[CallSession] Duplicate turn ignored ("${transcript}"): the reply to it is still active.`);
                this.logDiagnostic('duplicate_turn_ignored', { turnId, transcript, responseId: this.activeResponse ? this.activeResponse.id : null });
                this.latencyTracker.cancelTurn();
                this.finishTurn('duplicate_turn_ignored');
                return;
            }
            this.lastFinalTranscript = { text: normalized, at: Date.now() };
        }

        // Evaluate language through intelligent state machine
        // Prevents switching on short words ("haan", "achha", "sare", "avunu", "okay") or code-switching
        const langEval = this.languageStateMachine.evaluateTurn(transcript, sttLanguageHint || detectedLanguage);
        if (langEval.shouldSwitch && langEval.targetLanguage !== this.detectedLanguage) {
            this.setSessionLanguage(langEval.targetLanguage, langEval.reason);
            detectedLanguage = this.detectedLanguage;
        } else {
            detectedLanguage = this.detectedLanguage;
        }
        this.logDiagnostic('language_evaluated', {
            turnId,
            sttHint: sttLanguageHint,
            sessionLanguage: this.detectedLanguage,
            switched: Boolean(langEval.shouldSwitch),
            reason: langEval.reason
        });

        console.log(`[CallSession] Caller said: "${transcript}" (Lang: ${detectedLanguage}, TurnId: ${turnId})`);

        this.setConversationState(ConversationStates.PROCESSING_ANSWER, 'answer_recorded');
        this.logDiagnostic('complete_candidate_answer_recorded', {
            turnId,
            transcript,
            associatedQuestion: this.currentQuestion
        });
        this.logDiagnostic('answer_processing_started', { turnId });

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

            this.setConversationState(ConversationStates.SPEAKING, 'thinking_pause_ack');
            this.logDiagnostic('remo_started_speaking', { turnId, text: pauseAck, reason: 'thinking_pause' });
            const pauseResponse = this.beginResponse(turnId);
            await this.playAiAudio(pauseAck, pauseResponse);
            this.latencyTracker.markAudioDispatched();
            this.finishTurn('thinking_pause_ack_done');
            return;
        }

        // Discard pure non-answer listening murmurs ("hmm", "mhm") while maintaining conversational focus
        // "Mm-hmm" loses its hyphen below and becomes "mmhmm", so the joined spellings are listed too.
        const pureMurmurs = new Set(['hmm', 'hmmm', 'mhm', 'mhmm', 'uh-huh', 'uh huh', 'uhhuh', 'mm', 'mmm', 'mmhmm', 'mm hmm', 'mmhm', 'hm']);
        const cleanedUtterance = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        // Right after "is this a good time?", "uh-huh" means yes; it is read in context, not thrown away.
        const waitingForAvailability = ['GREETING', 'AVAILABILITY', 'PERMISSION_CHECK'].includes(this.currentStage);
        const affirmativeMurmur = waitingForAvailability && isAffirmativeMurmur(transcript);
        if (pureMurmurs.has(cleanedUtterance) && !this.interruptedWithAnswer && !affirmativeMurmur) {
            console.log(`[CallSession] Caller murmur acknowledged ("${transcript}"). Maintaining conversational focus.`);
            this.isProcessingTurn = false;
            this.setConversationState(ConversationStates.LISTENING, 'murmur_ignored');
            this.checkAndApplyOverlapAudio();
            return;
        }

        // Persistent question record: what kind of turn is this, and did it answer the open question?
        this.questions.setTurn(turnId);
        this.questions.setLanguage(this.detectedLanguage);
        this.questions.syncStage(this.currentStage);
        if (!this.questions.plan.length && Array.isArray(this.questionPlan) && this.questionPlan.length) {
            this.questions.registerPlan(this.questionPlan);
        }
        const openQuestion = { id: this.questions.currentQuestionId, text: this.questions.currentQuestionText };
        const turnKind = this.questions.noteCallerTurn(transcript, { turnId });
        this.logDiagnostic('caller_turn_classified', {
            turnId,
            transcript,
            language: this.detectedLanguage,
            stage: this.currentStage,
            callStage: this.questions.callStage,
            kind: turnKind,
            openQuestionId: openQuestion.id,
            openQuestion: String(openQuestion.text || '').slice(0, 100),
            answeredQuestionIds: [...this.questions.answeredQuestionIds]
        });

        // Add caller turn to conversation history & memory with associated question
        const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
        const timeStr = `${String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:${String(elapsedSec % 60).padStart(2, '0')}`;

        this.conversationHistory.push({
            speaker: this.contact.name || 'Caller',
            text: transcript,
            time: timeStr,
            associatedQuestion: this.currentQuestion
        });

        try {
            if (this.memory && typeof this.memory.recordTurn === 'function') {
                this.memory.recordTurn('USER', transcript);
                if (this.memory.factsCollected) {
                    this.collectedData = { ...this.memory.factsCollected, ...this.collectedData };
                }
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
            memory: this.memory,
            questions: this.questions,
            agentInstructions: this.agent ? this.agent.instructions : '',
            turnKind
        };

        // "uh-huh" after the availability question is read as "yes"; the real words stay in the transcript.
        const intent = IntentService.matchIntent(affirmativeMurmur ? 'yes' : transcript, intentContext);

        if (intent.matched) {
            this.latencyTracker.markDecisionEnd(`INTENT_FAST_PATH:${intent.reason || 'DIRECT'}`);

            if (intent.extracted_fields && Object.keys(intent.extracted_fields).length > 0) {
                this.collectedData = { ...this.collectedData, ...intent.extracted_fields };
                if (this.memory && typeof this.memory.recordFact === 'function') {
                    for (const [k, v] of Object.entries(intent.extracted_fields)) {
                        this.memory.recordFact(k, v);
                    }
                }
            }
            if (intent.classification) {
                this.classification = intent.classification;
            }
            if (intent.next_stage) {
                this.stageHistory.push(this.currentStage);
                this.currentStage = intent.next_stage;
            }
            if (intent.detected_language) {
                this.setSessionLanguage(intent.detected_language, `INTENT_FAST_PATH:${intent.reason || 'DIRECT'}`);
                detectedLanguage = this.detectedLanguage;
            }
            this.syncAppointmentState();
            this.syncSalesState();

            // Recruitment: a fast-path question that repeats an asked topic is swapped for the next planned one.
            let spokenResponse = intent.spoken_response;
            if (this.service === 'recruitment') {
                const guarded = this.questions.guardReply(spokenResponse, {
                    clarification: turnKind === 'clarification',
                    shouldEnd: Boolean(intent.should_end_call),
                    isFieldKnown: (f) => this.collectedData[f] !== undefined && this.collectedData[f] !== null && String(this.collectedData[f]).trim() !== ''
                });
                if (guarded.changed) {
                    spokenResponse = guarded.text;
                    this.logDiagnostic('reply_adjusted', { turnId, source: 'INTENT_FAST_PATH', notes: guarded.notes });
                }
            }
            this.logDiagnostic('response_selected', {
                turnId,
                source: 'INTENT_FAST_PATH',
                reason: intent.reason || 'DIRECT',
                kind: this.classifyReply(spokenResponse, intent.should_end_call),
                text: String(spokenResponse).slice(0, 120)
            });
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
            this.noteSalesReply(spokenResponse);

            this.logDiagnostic('answer_processing_completed', { turnId, source: 'INTENT_FAST_PATH' });
            this.setConversationState(ConversationStates.GENERATING_RESPONSE, 'intent_fast_path');
            this.logDiagnostic('next_question_generated', { turnId, question: spokenResponse, source: 'INTENT_FAST_PATH' });

            this.setConversationState(ConversationStates.SPEAKING, 'intent_fast_path');
            this.logDiagnostic('remo_started_speaking', { turnId, text: spokenResponse, source: 'INTENT_FAST_PATH' });
            const fastResponse = this.beginResponse(turnId);
            await this.playAiAudio(spokenResponse, fastResponse);
            this.latencyTracker.markAudioDispatched();

            this.finishTurn('intent_turn_completed');

            if (intent.should_end_call) {
                this.callStatus = 'COMPLETED';
                this.setConversationState(ConversationStates.COMPLETED, 'intent_call_completed');
                this.hangUpAfterSpeech(spokenResponse, 1200, 2500);
            }

            return;
        }

        // -------------------------------------------------------------
        // STEP 2: LLM (Claude Haiku primary / Gemini fallback) FOR COMPLEX/AMBIGUOUS RESPONSES
        // -------------------------------------------------------------
        this.setConversationState(ConversationStates.GENERATING_RESPONSE, 'llm_start');
        const response = this.beginResponse(turnId);
        try {
            let firstSentenceDispatched = false;
            const earlySpoken = [];            // sentences already sent to speech while the AI was still writing
            this.logDiagnostic('llm_generation_started', { turnId, responseId: response.id, turnKind });

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
                    appointmentTracker: this.apptTracker,
                    salesTracker: this.salesTracker,
                    agentName: this.agent ? this.agent.name : '',
                    agentInstructions: this.agent ? this.agent.instructions : '',
                    direction: this.direction,
                    questionState: this.buildQuestionState(turnKind),
                    onToken: (token, ttftMs) => {
                        this.latencyTracker.markLlmFirstToken();
                    },
                    onSpokenSentence: async (sentence, isFirst, isFinal) => {
                        if (isFirst && !firstSentenceDispatched && turnId === this.currentTurnId && !this.isClosed && !response.cancelled) {
                            // Hold back anything the caller would hear twice: the same opener as last time, or a
                            // question that repeats an earlier topic. The finished reply is checked before it plays.
                            const repeatsOpener = this.questions.wouldRepeatOpener(sentence);
                            const repeatsQuestion = (this.service === 'recruitment' && sentence.includes('?')
                                && this.questions.checkQuestion(sentence, { clarification: turnKind === 'clarification', dryRun: true }).duplicate)
                                || (this.service === 'sales' && SalesState.wouldRepeatMeetingQuestion(this.collectedData, sentence));
                            if (repeatsOpener || repeatsQuestion) {
                                this.logDiagnostic('early_phrase_held_back', { turnId, reason: repeatsOpener ? 'repeated_opener' : 'duplicate_question', text: sentence.slice(0, 80) });
                                return;
                            }
                            firstSentenceDispatched = true;
                            earlySpoken.push(sentence);
                            response.isStreaming = true;
                            response.llmComplete = false;
                            this.latencyTracker.markFirstSafePhraseReady();
                            this.latencyTracker.markDecisionEnd('LLM_STREAM');
                            console.log(`[CallSession] Early spoken phrase extracted. Streaming to TTS: "${sentence.slice(0, 50)}..."`);
                            this.setConversationState(ConversationStates.SPEAKING, 'llm_early_phrase');
                            this.logDiagnostic('remo_started_speaking', { turnId, text: sentence, source: 'LLM_EARLY_STREAM' });
                            await this.playAiAudio(sentence, response);
                        }
                    }
                }
            );

            response.llmComplete = true;

            if (!firstSentenceDispatched) {
                this.latencyTracker.markDecisionEnd('LLM');
            }
            this.logDiagnostic('llm_generation_completed', {
                turnId,
                responseId: response.id,
                model: reply.model_used || null,
                provider: reply.provider || null,
                isFallback: Boolean(reply.fallback),
                failureReason: reply.fallbackReason || null,
                streamedEarly: firstSentenceDispatched
            });

            // FIX-6: Check if we've been superseded by a newer turn
            if (turnId !== this.currentTurnId) {
                console.log(`[CallSession] LLM response for turn ${turnId} discarded (superseded by turn ${this.currentTurnId}).`);
                this.cancelActiveResponse('turn_superseded');
                this.isProcessingTurn = false;
                this.setConversationState(ConversationStates.LISTENING, 'turn_superseded');
                this.checkAndApplyOverlapAudio();
                return;
            }

            // The call ended while the AI was writing: nothing more is said and no state changes.
            if (this.isClosed) {
                this.logDiagnostic('reply_dropped_call_closed', { turnId, responseId: response.id });
                return;
            }

            if (reply.extracted_fields && Object.keys(reply.extracted_fields).length > 0) {
                // The meeting preference is read from the caller's words by code; the AI cannot set or change it.
                const aiFields = this.service === 'sales' ? SalesState.filterAiFields(this.collectedData, reply.extracted_fields) : reply.extracted_fields;
                for (const [k, v] of Object.entries(aiFields)) {
                    if (v !== null && v !== undefined && String(v).trim() !== '') {
                        this.collectedData[k] = v;
                        if (this.memory && typeof this.memory.recordFact === 'function') {
                            this.memory.recordFact(k, v);
                        }
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
                this.setSessionLanguage(reply.detected_language, 'LLM_REPLY');
                detectedLanguage = this.detectedLanguage;
            }
            if (this.service === 'appointment') {
                // The stage follows the collected details, not the AI's guess.
                this.syncAppointmentState();
            } else if (reply.next_stage) {
                this.stageHistory.push(this.currentStage);
                this.currentStage = reply.next_stage;
                if (this.memory) {
                    this.memory.currentStage = reply.next_stage;
                }
            }
            this.syncSalesState();

            // The caller interrupted while the AI was writing: none of this reply may be spoken.
            if (response.cancelled) {
                this.logDiagnostic('reply_dropped_response_cancelled', { turnId, responseId: response.id });
                this.finishTurn('response_cancelled');
                return;
            }

            let spokenResponse = reply.spoken_response;
            let endAfterReply = Boolean(reply.should_end_call);
            if (spokenResponse) {
                // One last check before the caller hears it: no repeated question, no repeated opener, never a bare "Sure."
                const guarded = this.questions.guardReply(spokenResponse, {
                    clarification: turnKind === 'clarification',
                    shouldEnd: endAfterReply,
                    enforceQuestions: this.service === 'recruitment',
                    isFieldKnown: (f) => this.collectedData[f] !== undefined && this.collectedData[f] !== null && String(this.collectedData[f]).trim() !== ''
                });
                if (guarded.changed) {
                    this.logDiagnostic('reply_adjusted', { turnId, source: 'LLM', notes: guarded.notes, replacedWith: guarded.replacedWith || null });
                    spokenResponse = guarded.text;
                    const planned = guarded.replacedWith ? this.questions.plan.find(p => p.id === guarded.replacedWith) : null;
                    if (planned && planned.stage) this.currentStage = planned.stage;
                    // Every planned question has been asked and nothing is left to ask: the screening is complete.
                    if (guarded.exhausted && this.service === 'recruitment' && !/\?/.test(spokenResponse)) {
                        spokenResponse = `${spokenResponse} ${this.screeningClosingLine()}`.trim();
                        endAfterReply = true;
                    }
                }
                this.logDiagnostic('response_selected', {
                    turnId,
                    source: 'LLM',
                    kind: this.classifyReply(spokenResponse, endAfterReply),
                    questionTopic: topicOf(questionPart(spokenResponse)),
                    text: String(spokenResponse).slice(0, 120)
                });
            }
            // Sales: the call-or-in-person question is asked once; a repeat becomes the closing for what is known.
            if (spokenResponse && this.service === 'sales' && SalesState.wouldRepeatMeetingQuestion(this.collectedData, spokenResponse)) {
                this.logDiagnostic('reply_adjusted', { turnId, source: 'LLM', notes: ['repeated_meeting_question'] });
                spokenResponse = SalesState.meetingReply(this.collectedData.meeting_preference, this.detectedLanguage);
                endAfterReply = true;
            }
            if (!spokenResponse) {
                console.warn('[CallSession] LLM returned empty spoken_response. Using stage-aware universal fallback.');
                const fallback = this.recoveryLine();
                const replyTimeSec = Math.floor((Date.now() - this.startTime) / 1000);
                const replyTimeStr = `${String(Math.floor(replyTimeSec / 60)).padStart(2, '0')}:${String(replyTimeSec % 60).padStart(2, '0')}`;
                this.conversationHistory.push({ speaker: 'REMO', text: fallback, time: replyTimeStr });
                this.currentQuestion = fallback;
                this.interruptedWithAnswer = false;
                this.logDiagnostic('answer_processing_completed', { turnId, source: 'LLM_FALLBACK' });
                this.logDiagnostic('next_question_generated', { turnId, question: fallback, source: 'LLM_FALLBACK' });
                this.setConversationState(ConversationStates.SPEAKING, 'llm_fallback');
                this.logDiagnostic('remo_started_speaking', { turnId, text: fallback, source: 'LLM_FALLBACK' });
                await this.playAiAudio(fallback, response);
                this.latencyTracker.markAudioDispatched();
                this.finishTurn('llm_fallback_finished');
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
            this.noteSalesReply(spokenResponse);

            this.logDiagnostic('answer_processing_completed', { turnId, source: 'LLM' });
            this.logDiagnostic('next_question_generated', { turnId, question: spokenResponse, source: 'LLM' });

            this.setConversationState(ConversationStates.SPEAKING, 'llm_speaking');
            if (!firstSentenceDispatched) {
                this.logDiagnostic('remo_started_speaking', { turnId, text: spokenResponse, source: 'LLM' });
            }

            // Safe streaming: play only what has not been spoken yet. The sentence(s) already sent while the AI
            // was still writing are removed from the final text by meaning (not by exact characters), so an
            // acknowledgement such as "Of course." is never heard twice, even if the final text was worded
            // slightly differently or came from the backup AI after the first one failed part-way.
            if (firstSentenceDispatched) {
                const remainder = stripAlreadySpoken(spokenResponse, earlySpoken);
                if (remainder && remainder.length > 3 && turnId === this.currentTurnId && !this.isClosed && !response.cancelled) {
                    console.log(`[CallSession] Streaming remainder sentence to TTS: "${remainder.slice(0, 50)}..."`);
                    this.logDiagnostic('remainder_dispatched', { turnId, responseId: response.id, text: remainder.slice(0, 80) });
                    await this.playAiAudio(remainder, response);
                } else if (!remainder) {
                    this.logDiagnostic('remainder_deduplicated', { turnId, responseId: response.id, early: earlySpoken });
                }
            } else {
                await this.playAiAudio(spokenResponse, response);
            }
            this.latencyTracker.markAudioDispatched();

            // FIX-1: Only NOW clear the processing lock (the state goes back to LISTENING when the audio has really finished)
            this.finishTurn('llm_turn_completed');

            if (endAfterReply) {
                this.callStatus = 'COMPLETED';
                this.setConversationState(ConversationStates.COMPLETED, 'llm_call_completed');
                this.hangUpAfterSpeech(spokenResponse, 1400, 2800);
            }

        } catch (genErr) {
            console.error('[CallSession] Error generating reply:', genErr.message);
            this.latencyTracker.markDecisionEnd('LLM_ERROR');

            // FIX-5: Always record audio dispatched even on error, so TOTAL latency is correct
            // Deliver a stage-specific recovery phrase so caller isn't left in silence or restarted
            try {
                // Only when the caller has heard nothing of this reply yet, and the reply was not cancelled or the call closed.
                if (response.spoken.length === 0 && !response.cancelled && !this.isClosed) {
                    const recoveryPhrase = this.recoveryLine();
                    const replyTimeSec = Math.floor((Date.now() - this.startTime) / 1000);
                    const replyTimeStr = `${String(Math.floor(replyTimeSec / 60)).padStart(2, '0')}:${String(replyTimeSec % 60).padStart(2, '0')}`;
                    this.conversationHistory.push({ speaker: 'REMO', text: recoveryPhrase, time: replyTimeStr });
                    this.setConversationState(ConversationStates.SPEAKING, 'recovery_phrase');
                    this.logDiagnostic('remo_started_speaking', { turnId, text: recoveryPhrase, source: 'RECOVERY' });
                    await this.playAiAudio(recoveryPhrase, response);
                }
                this.latencyTracker.markAudioDispatched();
            } catch (recoveryErr) {
                console.error('[CallSession] Recovery phrase also failed:', recoveryErr.message);
                this.latencyTracker.markAudioDispatched(); // Still mark so TOTAL is tracked
            }

            // FIX-1: Clear processing lock after recovery
            this.finishTurn('recovery_turn_finished');
        }
    }

    /**
     * What Remo says when the AI could not produce a reply. A recruitment call asks the caller to say it
     * once more (it never replays the opening pitch or jumps to another question); other work types keep
     * their stage-aware fallback line.
     */
    recoveryLine() {
        if (this.service === 'recruitment') {
            if (this.detectedLanguage === 'hi') return 'माफ़ कीजिए, मैं ठीक से सुन नहीं पाया। क्या आप एक बार फिर बता सकते हैं?';
            if (this.detectedLanguage === 'te') return 'క్షమించండి, నాకు సరిగా వినిపించలేదు. దయచేసి మరొకసారి చెప్పగలరా?';
            return "Sorry, I didn't catch that. Could you please say it once more?";
        }
        return GeminiService.getUniversalFallback(this.detectedLanguage, this.service, this.currentStage);
    }

    /** Ends the call after the closing words have completely finished playing on the phone line. */
    hangUpAfterSpeech(spokenText, paddingMs = 1400, minimumMs = 2800) {
        if (this.hangUpTimer) {
            clearTimeout(this.hangUpTimer);
            this.hangUpTimer = null;
        }
        this.isClosingCall = true; // Prevents barge-in or background noise from truncating farewell
        const words = String(spokenText || '').split(/\s+/).filter(Boolean);
        const wordsMs = words.length * 360 + paddingMs;
        const audioLeftMs = Math.max(0, this.aiSpeechEndTime - Date.now()) + 1400;
        const delay = Math.max(wordsMs, audioLeftMs, minimumMs);

        console.log(`[CallSession] Scheduling duration-aware termination in ${delay}ms to guarantee complete farewell playback.`);
        this.hangUpTimer = setTimeout(() => {
            this.hangUpTimer = null;
            if (!this.isClosed) {
                if (this.activeResponse) this.activeResponse.callTerminated = true;
                this.endCall();
            }
        }, delay);
    }

    /** What the question record knows, for the AI's prompt. */
    buildQuestionState(turnKind = 'answer') {
        const q = this.questions;
        const isFieldKnown = (f) => this.collectedData[f] !== undefined && this.collectedData[f] !== null && String(this.collectedData[f]).trim() !== '';
        const next = q.nextUnanswered({ isFieldKnown });
        return {
            callStage: q.callStage,
            askedTopics: [...new Set(q.entries.filter(e => e.started && e.topic).map(e => e.topic))],
            answeredTopics: [...new Set(q.entries.filter(e => e.answered && e.topic).map(e => e.topic))],
            openQuestion: q.pendingQuestionId ? q.currentQuestionText : '',
            nextPlanned: next ? next.text : '',
            turnKind
        };
    }

    /** acknowledgement | screening_question | clarification | ending | statement (for the diagnostic log). */
    classifyReply(text, shouldEnd = false) {
        if (shouldEnd) return 'ending';
        const sentences = splitSentences(text);
        if (sentences.some(s => s.includes('?'))) return 'screening_question';
        if (sentences.length && sentences.every(isAcknowledgement)) return 'acknowledgement';
        return 'statement';
    }

    /** The line that closes a screening once every planned question has been asked. */
    screeningClosingLine() {
        if (this.detectedLanguage === 'te') return 'మీ సమయానికి ధన్యవాదాలు. మా బృందం మీ ప్రొఫైల్‌ను సమీక్షించి మిమ్మల్ని సంప్రదిస్తుంది. మంచి రోజు గడపండి!';
        if (this.detectedLanguage === 'hi') return 'आपके समय के लिए धन्यवाद। हमारी टीम आपकी प्रोफ़ाइल देखकर आपसे संपर्क करेगी। आपका दिन शुभ हो!';
        return 'Thank you for your time. Our team will review your profile and get back to you. Have a great day!';
    }

    /**
     * Ends call, logs latency profile, and asynchronously writes conversation to DB.
     */
    async endCall() {
        if (this.isClosed) return;
        this.isClosed = true;

        if (this.hangUpTimer) {
            clearTimeout(this.hangUpTimer);
            this.hangUpTimer = null;
        }
        if (this.activeResponse) {
            this.activeResponse.callTerminated = true;
        }

        // No further speech after the line is gone: cancel the reply in progress and drop the queue.
        this.cancelActiveResponse('call_ended');
        this.playbackCheckpoint = null;
        this.isAiSpeaking = false;
        this.setConversationState(ConversationStates.COMPLETED, 'call_ended');

        if (this.promoPlaybackTimer) {
            clearTimeout(this.promoPlaybackTimer);
            this.promoPlaybackTimer = null;
        }
        if (this.callMode === 'PROMOTIONAL_DEMO' && this.promoState === 'PLAYING_PROMO') {
            this.promoState = 'COMPLETED';
        }

        if (this.activeSpeechTimer) {
            clearTimeout(this.activeSpeechTimer);
            this.activeSpeechTimer = null;
        }
        if (this.healthTimer) {
            clearInterval(this.healthTimer);
            this.healthTimer = null;
        }

        if (this.activeSttSession) {
            try { this.activeSttSession.close(); } catch (_) {}
            this.activeSttSession = null;
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

            if (this.service === 'sales') {
                // Meeting preference from what the caller actually said ("not_specified" when never answered).
                this.collectedData = { ...this.collectedData, ...SalesState.finalizeMeetingFields(this.collectedData) };
                this.summary = SalesState.composeSalesSummary(this.collectedData, { classification: this.classification, summary: this.summary });
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

            let existingRecUrl = null;
            let existingRecId = null;
            if (this.contactId) {
                try {
                    const ct = await db.get('SELECT recording_url, recording_id FROM contacts WHERE id = ?', [this.contactId]);
                    if (ct) {
                        existingRecUrl = ct.recording_url || null;
                        existingRecId = ct.recording_id || null;
                    }
                } catch {}
            }

            const convId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            await db.run(`
                INSERT INTO conversations (id, contact_id, batch_id, campaign_id, service, phone, contact_name, status, started_at, ended_at, duration_seconds, summary, classification, created_at, owner_user_id, provider_call_id, recording_url, recording_id, recording_expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                ownerId,
                this.callId || null,
                existingRecUrl,
                existingRecId,
                // The recording is deleted 30 days after the call ended.
                (existingRecUrl || existingRecId) ? RecordingService.expiryFor({ ended_at: now }) : null
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
    const rawCallMode = parsedUrl.searchParams.get('callMode') || parsedUrl.searchParams.get('call_mode');
    const callMode = (rawCallMode || (service === 'promotional' ? 'PROMOTIONAL_DEMO' : 'STANDARD')).toUpperCase().trim();
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
        direction: parsedUrl.searchParams.get('direction') || '',
        callMode: callMode
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
                        if (headers.callMode || headers.call_mode) session.callMode = (headers.callMode || headers.call_mode).toUpperCase().trim();
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
                            if (key === 'callMode' || key === 'call_mode') session.callMode = val.toUpperCase().trim();
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

                // Auto-sync promotional demo mode if service is promotional
                if (session.service === 'promotional' || session.callMode === 'PROMOTIONAL_DEMO') {
                    session.callMode = 'PROMOTIONAL_DEMO';
                    session.service = 'promotional';
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
            } else if (event === 'playedStream') {
                // Plivo: everything we sent before the named checkpoint has been played to the caller.
                session.handlePlaybackCheckpoint(msg.name || (msg.playedStream && msg.playedStream.name));
            } else if (event === 'clearedAudio') {
                session.logDiagnostic('plivo_cleared_audio', {});
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

    // Keep-alive heartbeat: ping the WebSocket every 10s to prevent ngrok / proxy from timing out the connection
    const pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            try { ws.ping(); } catch (_) {}
        }
    }, 10000);

    ws.on('close', async (code, reason) => {
        clearInterval(pingInterval);
        console.log(`[VoicebotStream] Connection closed (${code}) for CallId: ${session.callId}`);
        await session.endCall();
    });

    // Initial handshake acknowledgement
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ event: 'connected', service: 'Plivo-Murf-VoiceBot' }));
    }
}

/**
 * Pre-caches standard greetings and acknowledgments into RAM on startup.
 */
export async function precacheStandardGreetings() {
    // Tests set SKIP_TTS_PRECACHE=1 so loading this file never calls the paid voice service
    if (process.env.SKIP_TTS_PRECACHE === '1') return;

    const prewarmPhrases = [
        GeminiService.getOpeningGreeting('sales', {}),
        GeminiService.getOpeningGreeting('recruitment', { job_role: 'the open position' }),
        "Hi, this is Remo calling. Is now a good time to talk?",
        "Great, thanks! I just wanted to ask — are you currently looking for any IT or digital marketing services?",
        "Sure! What kind of service are you looking for?",
        "We help with website and software development, mobile apps, and digital marketing. Which of these would be most useful to you?",
        "No problem at all. Thanks for your time. Have a great day!",
        "Of course. Would another time be better?",
        "We help businesses with software development and digital marketing. Is there anything in those areas you're exploring?"
    ];

    if (MurfService.isConfigured()) {
        try {
            console.log('[VoicebotStream] Pre-warming standard opening greetings and fast-path responses in Murf TTS cache...');
            const voiceId = MurfService.getVoiceId();
            const modelId = MurfService.getModelId();
            for (const phrase of prewarmPhrases) {
                try {
                    await MurfService.textToSpeech(phrase, { voiceId, model: modelId, timeoutMs: 10000 });
                } catch (err) {
                    // Non-fatal per phrase
                }
            }
            try {
                console.log('[VoicebotStream] Pre-warming promotional demo script in Murf TTS cache...');
                await MurfService.textToSpeech(PROMOTIONAL_DEMO_SCRIPT, {
                    voiceId,
                    model: modelId,
                    timeoutMs: 15000
                });
                console.log('[VoicebotStream] Promotional demo script pre-cached successfully in Murf RAM.');
            } catch (promoErr) {
                console.warn('[VoicebotStream] Promotional script pre-cache note:', promoErr.message);
            }
            console.log('[VoicebotStream] Standard greetings cached in Murf RAM successfully.');
        } catch (e) {
            // Non-fatal
        }
        return;
    }

    if (!ElevenLabsService.isConfigured()) return;
    try {
        ElevenLabsService.validateConfiguration();
        console.log('[VoicebotStream] Pre-warming standard opening greetings and fast-path responses in TTS cache...');
        for (const phrase of prewarmPhrases) {
            try {
                const voiceId = ElevenLabsService.getVoiceIdForLanguage('en');
                const modelId = ElevenLabsService.selectTtsModel({ language: 'en', text: phrase, voiceId });
                await ElevenLabsService.textToSpeech(phrase, { voiceId, modelId, language: 'en', outputFormat: 'ulaw_8000', timeoutMs: 10000 });
            } catch (err) {
                // Non-fatal per phrase
            }
        }
        try {
            console.log('[VoicebotStream] Pre-warming promotional demo script in TTS cache...');
            const promoVoiceId = ElevenLabsService.getVoiceIdForLanguage('en');
            const promoModelId = ElevenLabsService.selectTtsModel({ language: 'en', text: PROMOTIONAL_DEMO_SCRIPT, voiceId: promoVoiceId });
            await ElevenLabsService.textToSpeech(PROMOTIONAL_DEMO_SCRIPT, {
                voiceId: promoVoiceId,
                modelId: promoModelId,
                language: 'en',
                outputFormat: 'ulaw_8000',
                timeoutMs: 15000
            });
            console.log('[VoicebotStream] Promotional demo script pre-cached successfully in RAM.');
        } catch (promoErr) {
            console.warn('[VoicebotStream] Promotional script pre-cache note:', promoErr.message);
        }
        console.log('[VoicebotStream] Standard greetings and fast-path responses cached in RAM successfully.');
    } catch (e) {
        // Non-fatal
    }
}

// Trigger background warmup
precacheStandardGreetings();
