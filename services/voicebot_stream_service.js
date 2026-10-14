import db, { utcNow } from './db.js';
import ElevenLabsService from './elevenlabs_service.js';
import GeminiService from './gemini_service.js';
import IntentService from './intent_service.js';
import LatencyTracker from './latency_tracker.js';

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
        this.isProcessingTurn = false;
        this.isClosed = false;

        // Synchronous in-memory contact construction: ready IMMEDIATELY with zero DB wait
        this.contact = {
            id: this.contactId || `cnt_${Date.now()}`,
            name: this.callerName || (this.phone ? `Caller (${this.phone})` : 'Candidate'),
            phone: this.phone || '',
            service: this.service,
            job_role: this.jobRole || (this.service === 'sales' ? 'Voice Automation' : 'the open position'),
            company: this.companyName || 'Score Labs',
            preferred_language: 'en'
        };
    }

    /**
     * Initializes the call session.
     * Fires opening greeting IMMEDIATELY without waiting for DB queries.
     * Starts background asynchronous DB lookup.
     */
    async init() {
        this.latencyTracker.markSessionReady();

        // Asynchronously enrich contact details from DB without blocking audio loop
        this.enrichContactFromDbAsync();

        // Deliver opening greeting immediately
        await this.deliverOpeningGreeting();
    }

    /**
     * Background DB lookup: updates contact name, role, company if found in DB.
     * Does NOT block greeting or conversational turns.
     */
    async enrichContactFromDbAsync() {
        try {
            let row = null;
            if (this.contactId) {
                row = await db.get('SELECT * FROM contacts WHERE id = ?', [this.contactId]);
            }
            if (!row && this.callId) {
                row = await db.get('SELECT * FROM contacts WHERE provider_call_id = ?', [this.callId]);
            }
            if (!row && this.phone) {
                row = await db.get(
                    'SELECT * FROM contacts WHERE phone LIKE ? ORDER BY updated_at DESC LIMIT 1',
                    [`%${this.phone.slice(-10)}%`]
                );
            }

            if (row) {
                if (row.service) this.service = row.service.toLowerCase();
                if (row.id && !this.contactId) this.contactId = row.id;
                if (row.phone && !this.phone) this.phone = row.phone;
                if (row.name && (!this.callerName || this.callerName.startsWith('Caller'))) {
                    this.callerName = row.name;
                    this.contact.name = row.name;
                }
                if (row.job_role && !this.jobRole) {
                    this.jobRole = row.job_role;
                    this.contact.job_role = row.job_role;
                }
                if (row.company && !this.companyName) {
                    this.companyName = row.company;
                    this.contact.company = row.company;
                }
                if (row.owner_user_id && !this.ownerUserId) this.ownerUserId = row.owner_user_id;
                if (row.preferred_language) {
                    this.contact.preferred_language = row.preferred_language;
                    this.detectedLanguage = row.preferred_language;
                }
                this.contact = { ...this.contact, ...row };
                console.log(`[CallSession] Contact enriched from DB for ${this.callerName || this.phone} (${this.contact.job_role || 'open position'})`);
            }
        } catch (e) {
            // Non-fatal: in-memory contact already has all critical info
            console.warn('[CallSession] Non-blocking DB contact enrichment note:', e.message);
        }
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

        const greeting = GeminiService.getOpeningGreeting(this.service, this.contact);
        this.currentQuestion = greeting;
        this.currentStage = 'AVAILABILITY';

        this.conversationHistory.push({
            speaker: 'REMO',
            text: greeting,
            time: '00:01'
        });

        // 1. Instant Cache Check (< 1ms delivery)
        const cachedAudio = ElevenLabsService.getCachedAudio(greeting);
        if (cachedAudio) {
            console.log(`[CallSession] Instant cache hit for opening greeting! Dispatching audio in < 5ms.`);
            this.latencyTracker.markGreetingDelivered();
            this.greetingDelivered = true;
            this.greetingInProgress = false;
            await this.dispatchAudioBuffer(cachedAudio, greeting);
            return;
        }

        // 2. Synthesize audio via ElevenLabs
        await this.playAiAudio(greeting);
        this.latencyTracker.markGreetingDelivered();
        this.greetingDelivered = true;
        this.greetingInProgress = false;
    }

    /**
     * Sends raw mu-law audio buffer over WebSocket to Plivo.
     */
    async dispatchAudioBuffer(audioBuffer, text) {
        if (!audioBuffer || this.isClosed) return;

        try {
            this.isAiSpeaking = true;
            const durationMs = (audioBuffer.length / 8000) * 1000;
            this.aiSpeechEndTime = Date.now() + durationMs;

            const payloadBase64 = audioBuffer.toString('base64');
            if (this.ws.readyState === this.ws.OPEN) {
                this.ws.send(JSON.stringify({
                    event: 'playAudio',
                    media: {
                        contentType: 'audio/x-mulaw',
                        sampleRate: 8000,
                        payload: payloadBase64
                    }
                }));
                console.log(`[CallSession] Sent ${audioBuffer.length} bytes of audio to Plivo (~${Math.round(durationMs)}ms)`);
            }

            if (this.activeSpeechTimer) clearTimeout(this.activeSpeechTimer);
            this.activeSpeechTimer = setTimeout(() => {
                if (Date.now() >= this.aiSpeechEndTime && this.isAiSpeaking) {
                    this.isAiSpeaking = false;
                    console.log('[CallSession] AI finished speaking turn. Now listening for caller.');
                }
            }, durationMs);

        } catch (e) {
            console.error('[CallSession] dispatchAudioBuffer error:', e.message);
            this.isAiSpeaking = false;
        }
    }

    /**
     * Synthesizes dialogue text via ElevenLabs with caching and dispatches audio to Plivo.
     */
    async playAiAudio(text) {
        if (!text || this.isClosed) return;

        try {
            this.currentQuestion = text;
            this.latencyTracker.markTtsStart();

            // Check cache
            let audioBuffer = ElevenLabsService.getCachedAudio(text);
            const isCached = Boolean(audioBuffer);

            if (!audioBuffer && ElevenLabsService.isConfigured()) {
                audioBuffer = await ElevenLabsService.textToSpeech(text, {
                    outputFormat: 'ulaw_8000'
                });
            }

            this.latencyTracker.markTtsEnd(isCached);

            if (!audioBuffer) {
                console.warn('[CallSession] ElevenLabs TTS unavailable; simulating turn timing.');
                const wordCount = text.split(/\s+/).length;
                const simDurationMs = Math.max(wordCount * 320, 1400);
                this.isAiSpeaking = true;
                this.aiSpeechEndTime = Date.now() + simDurationMs;
                if (this.activeSpeechTimer) clearTimeout(this.activeSpeechTimer);
                this.activeSpeechTimer = setTimeout(() => {
                    if (this.isAiSpeaking) {
                        this.isAiSpeaking = false;
                    }
                }, simDurationMs);
                return;
            }

            await this.dispatchAudioBuffer(audioBuffer, text);

        } catch (e) {
            console.error('[CallSession] playAiAudio error:', e.message);
            this.isAiSpeaking = false;
        }
    }

    /**
     * Processes inbound audio packets from the caller (Plivo media event).
     */
    async handleInboundAudio(mulawChunk) {
        if (this.isProcessingTurn || this.isClosed) return;

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

                // Adaptive silence threshold:
                // Short answers (< 1.2s speech, e.g. "yes", "okay", "no") trigger after 18 frames (~360ms)
                // Longer speech triggers after 24 frames (~480ms) to allow breathing pauses
                const silenceRequired = this.consecutiveSpeechFrames < 60 ? 18 : 24;

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
     * 2. Checks deterministic IntentService (< 1ms fast-path).
     * 3. Falls back to optimized Gemini LLM only when necessary.
     * 4. Dispatches spoken reply and records comprehensive latency.
     */
    async processCallerTurn() {
        if (this.callerMulawChunks.length === 0 || this.isProcessingTurn) return;
        this.isProcessingTurn = true;

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
                const sttResult = await ElevenLabsService.speechToText(wavBuffer, 'caller_turn.wav');
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

        if (!transcript) {
            console.log('[CallSession] Unintelligible or empty caller audio. Resuming listening.');
            this.isProcessingTurn = false;
            return;
        }

        console.log(`[CallSession] Caller said: "${transcript}" (Lang: ${detectedLanguage})`);

        // Discard pure backchannels if no interruption occurred
        if (isBackchannelOnly(transcript) && this.currentQuestion && !this.interruptedWithAnswer) {
            console.log(`[CallSession] Caller backchannel acknowledged ("${transcript}"). Maintaining conversational focus.`);
            this.isProcessingTurn = false;
            return;
        }

        // Add caller turn to conversation history
        const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
        const timeStr = `${String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:${String(elapsedSec % 60).padStart(2, '0')}`;

        this.conversationHistory.push({
            speaker: this.contact.name || 'Caller',
            text: transcript,
            time: timeStr
        });

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
            history: this.conversationHistory
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
            if (intent.next_stage) {
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

            this.currentQuestion = spokenResponse;
            this.interruptedWithAnswer = false;
            this.isProcessingTurn = false;

            // Play fast-path response
            await this.playAiAudio(spokenResponse);
            this.latencyTracker.markAudioDispatched();

            if (intent.should_end_call) {
                this.callStatus = 'COMPLETED';
                const hangupDelay = Math.max((spokenResponse.split(/\s+/).length * 320) + 1200, 2500);
                setTimeout(() => this.endCall(), hangupDelay);
            }

            return; // Fast-path turn finished without calling Gemini
        }

        // -------------------------------------------------------------
        // STEP 2: GEMINI LLM FOR COMPLEX/AMBIGUOUS RESPONSES
        // -------------------------------------------------------------
        try {
            const reply = await GeminiService.generateReply(
                this.service,
                this.contact,
                this.conversationHistory,
                transcript,
                this.collectedData
            );

            this.latencyTracker.markDecisionEnd('GEMINI_LLM');

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
            const replyTimeSec = Math.floor((Date.now() - this.startTime) / 1000);
            const replyTimeStr = `${String(Math.floor(replyTimeSec / 60)).padStart(2, '0')}:${String(replyTimeSec % 60).padStart(2, '0')}`;

            this.conversationHistory.push({
                speaker: 'REMO',
                text: spokenResponse,
                time: replyTimeStr
            });

            this.currentQuestion = spokenResponse;
            this.interruptedWithAnswer = false;
            this.isProcessingTurn = false;

            // Play LLM response
            await this.playAiAudio(spokenResponse);
            this.latencyTracker.markAudioDispatched();

            if (reply.should_end_call) {
                this.callStatus = 'COMPLETED';
                const hangupDelay = Math.max((spokenResponse.split(/\s+/).length * 320) + 1400, 2800);
                setTimeout(() => this.endCall(), hangupDelay);
            }

        } catch (genErr) {
            console.error('[CallSession] Error generating reply:', genErr.message);
            this.latencyTracker.markDecisionEnd('GEMINI_ERROR');
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

        try {
            if (this.ws.readyState === this.ws.OPEN) {
                this.ws.close(1000, 'Call completed');
            }
        } catch (e) {}

        // Log latency report
        if (this.latencyTracker) {
            this.latencyTracker.logFinalSummary();
        }

        // Asynchronously persist call results
        await this.persistCallResults();
    }

    async persistCallResults() {
        const durationSec = Math.round((Date.now() - this.startTime) / 1000);
        const now = utcNow();

        console.log(`[CallSession] Finalizing call ${this.callId} (${durationSec}s, status: ${this.callStatus})...`);

        try {
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
                INSERT INTO conversations (id, contact_id, batch_id, service, phone, contact_name, status, started_at, ended_at, duration_seconds, summary, classification, created_at, owner_user_id)
                VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)
            `, [
                convId,
                this.contactId || this.contact?.id || 'direct',
                this.contact?.batch_id || 'direct_batch',
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

    const params = {
        callId: parsedUrl.searchParams.get('callId') || parsedUrl.searchParams.get('CallSid') || `plv_${Date.now()}`,
        contactId: parsedUrl.searchParams.get('contactId') || '',
        service: parsedUrl.searchParams.get('service') || 'recruitment',
        ownerUserId: parsedUrl.searchParams.get('ownerId') || parsedUrl.searchParams.get('owner_user_id') || null,
        phone: parsedUrl.searchParams.get('phone') || parsedUrl.searchParams.get('To') || '',
        callerName: parsedUrl.searchParams.get('name') || '',
        role: parsedUrl.searchParams.get('role') || '',
        company: parsedUrl.searchParams.get('company') || ''
    };

    const session = new CallSession(ws, params);

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString('utf8'));
            const event = msg.event;

            if (event === 'start') {
                session.streamId = msg.streamId || msg.start?.streamId;
                if (msg.start?.callId) session.callId = msg.start.callId;

                const headers = msg.extra_headers || msg.extraHeaders || msg.start?.extraHeaders || msg.start?.extra_headers || msg.start?.customHeaders;
                if (headers) {
                    if (typeof headers === 'object') {
                        if (headers.contactId) session.contactId = headers.contactId;
                        if (headers.service) session.service = headers.service;
                        if (headers.ownerId) session.ownerUserId = headers.ownerId;
                        if (headers.phone) session.phone = headers.phone;
                        if (headers.name) session.callerName = headers.name;
                        if (headers.role) session.jobRole = headers.role;
                        if (headers.company) session.companyName = headers.company;
                    } else if (typeof headers === 'string') {
                        const pairs = headers.split(/[,;&]/);
                        for (const pair of pairs) {
                            const [k, v] = pair.split('=');
                            if (!k) continue;
                            const key = k.trim();
                            const val = decodeURIComponent((v || '').trim());
                            if (key === 'contactId') session.contactId = val;
                            if (key === 'service') session.service = val;
                            if (key === 'ownerId') session.ownerUserId = val;
                            if (key === 'phone') session.phone = val;
                            if (key === 'name') session.callerName = val;
                            if (key === 'role') session.jobRole = val;
                            if (key === 'company') session.companyName = val;
                        }
                    }
                }

                // Update in-memory contact fields from extracted headers
                if (session.jobRole) session.contact.job_role = session.jobRole;
                if (session.companyName) session.contact.company = session.companyName;
                if (session.callerName && !session.contact.name) session.contact.name = session.callerName;

                console.log(`[VoicebotStream] Plivo stream started — CallId: ${session.callId}, StreamId: ${session.streamId}, Service: ${session.service}, Role: ${session.contact.job_role}`);
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
            // Non-JSON message or raw buffer
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
        // Starter plan limit: max 3 concurrent requests.
        // We pre-warm only the primary recruitment opening greeting sequentially (concurrency = 1).
        const mainGreeting = GeminiService.getOpeningGreeting('recruitment', { job_role: 'the open position' });
        console.log('[VoicebotStream] Pre-warming primary opening greeting in TTS cache...');
        await ElevenLabsService.textToSpeech(mainGreeting, { outputFormat: 'ulaw_8000' });
        console.log('[VoicebotStream] Primary greeting cached in RAM successfully.');
    } catch (e) {
        // Non-fatal
    }
}

// Trigger background warmup
precacheStandardGreetings();
