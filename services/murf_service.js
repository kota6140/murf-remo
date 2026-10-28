import 'dotenv/config';
import WebSocket from 'ws';

/**
 * services/murf_service.js
 *
 * Real-time WebSocket Text-to-Speech (TTS) integration with Murf AI.
 * Endpoint: wss://global.api.murf.ai/v1/speech/stream-input
 *
 * Features:
 * - Persistent or per-request low-latency bidirectional WebSocket audio streaming.
 * - Converts Murf's 24kHz 16-bit linear PCM audio into 8kHz G.711 mu-law audio
 *   required by Plivo telephony in real-time.
 * - Streams audio chunks incrementally via onChunk callback as they arrive from Murf.
 * - RAM cache for sub-5ms instant playback of standard greetings and fast-path phrases.
 * - Safe error handling: logs actual provider errors without leaking API keys.
 */

const murfAudioCache = new Map();
const MAX_CACHE_SIZE = 200;

// G.711 mu-law encoder constants
const BIAS = 0x84;
const CLIP = 32635;

/**
 * Encodes a single 16-bit linear PCM sample into an 8-bit mu-law byte.
 */
export function linear16ToMulaw(sample) {
    let sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample += BIAS;
    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
    let mantissa = (sample >> (exponent + 3)) & 0x0F;
    let mulawByte = ~(sign | (exponent << 4) | mantissa);
    return mulawByte & 0xFF;
}

/**
 * Downsamples 24kHz 16-bit mono linear PCM to 8kHz 8-bit G.711 mu-law.
 * Downsample factor: 24,000 / 8,000 = 3 (decimation by 3 with 3-tap averaging).
 */
export function convertPcm24kToMulaw8k(pcm24kBuffer) {
    if (!pcm24kBuffer || pcm24kBuffer.length < 6) return Buffer.alloc(0);
    const numInputSamples = Math.floor(pcm24kBuffer.length / 2);
    const numOutputSamples = Math.floor(numInputSamples / 3);
    const mulawBuffer = Buffer.alloc(numOutputSamples);

    for (let i = 0; i < numOutputSamples; i++) {
        const offset = i * 6;
        const s0 = pcm24kBuffer.readInt16LE(offset);
        const s1 = pcm24kBuffer.readInt16LE(offset + 2);
        const s2 = pcm24kBuffer.readInt16LE(offset + 4);
        const avg = Math.round((s0 + s1 + s2) / 3);
        mulawBuffer[i] = linear16ToMulaw(avg);
    }
    return mulawBuffer;
}

export function getMinExpectedAudioBytes(text) {
    if (!text) return 0;
    const str = String(text).trim();
    if (!str) return 0;
    const words = str.split(/\s+/).filter(Boolean).length;
    // Fast speech is at most ~4-5 words/sec. At 8000 bytes/sec, ~1400-2000 bytes per word.
    // Minimum 2400 bytes (300ms) for brief utterances.
    return Math.max(words * 1400, Math.min(str.length * 150, 2400));
}

function getCacheKey(text, voiceId, modelId, locale) {
    return `${voiceId || 'Pooja'}_${modelId || 'falcon-2.1'}_${locale || 'en-IN'}_${String(text || '').trim().toLowerCase()}`;
}

export default class MurfService {
    static isConfigured() {
        return Boolean((process.env.MURF_API_KEY || '').trim());
    }

    static getApiKey() {
        const key = (process.env.MURF_API_KEY || '').trim();
        if (!key) {
            throw new Error('MURF_API_KEY is not configured in environment.');
        }
        return key;
    }

    static getWsUrl() {
        return (process.env.MURF_WS_URL || 'wss://global.api.murf.ai/v1/speech/stream-input').trim();
    }

    static getSttWsUrl() {
        return (process.env.MURF_STT_WS_URL || 'wss://in.api.murf.ai/v1/transcription/stream-input').trim();
    }

    static mapLanguageCodeForStt(lang) {
        if (!lang) return 'auto';
        const l = String(lang).toLowerCase().trim();
        if (l === 'en' || l === 'en-in' || l === 'en_in' || l === 'eng') return 'en_IN';
        if (l === 'hi' || l === 'hin' || l === 'hindi') return 'hi';
        if (l === 'te' || l === 'tel' || l === 'telugu') return 'te';
        if (l === 'ta' || l === 'tam') return 'ta';
        if (l === 'kn') return 'kn';
        if (l === 'ml') return 'ml';
        if (l === 'mr') return 'mr';
        if (l === 'bn') return 'bn';
        if (l === 'gu') return 'gu';
        if (l === 'pa') return 'pa';
        if (l === 'as') return 'as';
        if (l === 'or') return 'or';
        return 'auto';
    }

    static getVoiceId(options = {}) {
        if (options.voiceId) return options.voiceId;
        return (process.env.MURF_VOICE_ID || 'Pooja').trim();
    }

    static getStyle() {
        return (process.env.MURF_STYLE || 'Conversational').trim();
    }

    static getModelId() {
        const envModel = (process.env.MURF_MODEL || '').trim().toLowerCase();
        if (envModel.includes('falcon') || envModel.includes('2.1')) {
            return 'falcon-2.1';
        }
        return 'falcon-2.1';
    }

    static getLocale() {
        return (process.env.MURF_LOCALE || 'en-IN').trim();
    }

    /**
     * RAM cache retrieval with truncation guard
     */
    static getCachedAudio(text, options = {}) {
        if (!text) return null;
        const voiceId = this.getVoiceId(options);
        const modelId = options.model || options.modelId || this.getModelId();
        const locale = options.locale || this.getLocale();
        const key = getCacheKey(text, voiceId, modelId, locale);
        const cached = murfAudioCache.get(key) || null;
        if (cached) {
            const minExpected = getMinExpectedAudioBytes(text);
            if (cached.length < minExpected) {
                console.warn(`[MurfService] Cached audio for "${String(text).slice(0, 30)}..." is truncated (${cached.length} bytes < ${minExpected} min expected). Purging from cache.`);
                murfAudioCache.delete(key);
                return null;
            }
        }
        return cached;
    }

    /**
     * Pre-cache audio into RAM with truncation guard
     */
    static precacheAudio(text, audioBuffer, options = {}) {
        if (!text || !audioBuffer || audioBuffer.length === 0) return;
        const minExpected = getMinExpectedAudioBytes(text);
        if (audioBuffer.length < minExpected) {
            console.warn(`[MurfService] Refusing to cache incomplete audio buffer for "${String(text).slice(0, 30)}..." (${audioBuffer.length} bytes < ${minExpected} min expected).`);
            return;
        }
        const voiceId = this.getVoiceId(options);
        const modelId = options.model || options.modelId || this.getModelId();
        const locale = options.locale || this.getLocale();
        const key = getCacheKey(text, voiceId, modelId, locale);
        if (murfAudioCache.size >= MAX_CACHE_SIZE) {
            const oldestKey = murfAudioCache.keys().next().value;
            murfAudioCache.delete(oldestKey);
        }
        murfAudioCache.set(key, audioBuffer);
    }

    /**
     * Clear all cached audio buffers
     */
    static clearCache() {
        murfAudioCache.clear();
    }

    /**
     * Synthesizes text to 8kHz mu-law audio using Murf's WebSocket stream-input API.
     * Supports real-time chunk streaming via options.onChunk(mulawChunk).
     *
     * @param {string} text - Spoken text to synthesize
     * @param {object} options - { voiceId, style, model, locale, onChunk, timeoutMs }
     * @returns {Promise<Buffer|null>} - Complete 8kHz mu-law audio buffer
     */
    static async textToSpeech(text, options = {}) {
        const trimmed = String(text || '').trim();
        if (!trimmed) return Buffer.alloc(0);

        const voiceId = this.getVoiceId(options);
        const modelId = options.model || options.modelId || this.getModelId();
        const style = options.style || this.getStyle();
        const locale = options.locale || this.getLocale();
        const onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;
        const timeoutMs = options.timeoutMs || 8000;

        // Check RAM cache first
        const cached = this.getCachedAudio(trimmed, { voiceId, model: modelId, locale });
        if (cached) {
            if (onChunk) {
                try { onChunk(cached); } catch (_) {}
            }
            return cached;
        }

        let apiKey;
        try {
            apiKey = this.getApiKey();
        } catch (err) {
            console.error('[MurfService] Configuration error:', err.message);
            return null;
        }

        const wsBaseUrl = this.getWsUrl();
        const connectUrl = `${wsBaseUrl}?api_key=${encodeURIComponent(apiKey)}`;

        const startTime = Date.now();
        console.log(`[MurfService] TTS request start: Model=${modelId}, Voice=${voiceId}, Style=${style}, Locale=${locale}, Length=${trimmed.length} chars`);

        return new Promise((resolve) => {
            let settled = false;
            let ws = null;
            let timer = null;
            let firstChunkReceived = false;
            let isFirstAudioMsg = true;
            let remainderPcm = Buffer.alloc(0);
            const collectedMulawChunks = [];

            let idleTimer = null;

            const finish = (resultBuffer) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                if (idleTimer) clearTimeout(idleTimer);
                if (ws) {
                    try { ws.close(); } catch (_) {}
                }

                if (resultBuffer && resultBuffer.length > 0) {
                    const totalMs = Date.now() - startTime;
                    const audioDurationMs = Math.round((resultBuffer.length / 8000) * 1000);
                    console.log(`[MurfService] Audio complete: ${resultBuffer.length} bytes in ${totalMs}ms (Model: ${modelId}, ~${audioDurationMs}ms audio)`);
                    MurfService.precacheAudio(trimmed, resultBuffer, { voiceId, model: modelId, locale });
                    resolve(resultBuffer);
                } else {
                    resolve(null);
                }
            };

            timer = setTimeout(() => {
                console.warn(`[MurfService] TTS request timed out after ${timeoutMs}ms.`);
                finish(collectedMulawChunks.length > 0 ? Buffer.concat(collectedMulawChunks) : null);
            }, timeoutMs);

            try {
                ws = new WebSocket(connectUrl, {
                    headers: {
                        'api-key': apiKey,
                        'api_key': apiKey
                    }
                });
            } catch (initErr) {
                console.error('[MurfService] WebSocket initialization error:', initErr.message);
                return finish(null);
            }

            ws.on('open', () => {
                try {
                    // Send voice_config frame first
                    const voiceConfigMsg = {
                        voice_config: {
                            voiceId: voiceId,
                            style: style,
                            model: modelId,
                            locale: locale,
                            sampleRate: 8000,
                            format: 'MULAW',
                            channelType: 'MONO'
                        }
                    };
                    ws.send(JSON.stringify(voiceConfigMsg));

                    // Send text frame
                    const textMsg = {
                        text: trimmed
                    };
                    ws.send(JSON.stringify(textMsg));
                } catch (sendErr) {
                    console.error('[MurfService] Error sending initial payload:', sendErr.message);
                    finish(null);
                }
            });

            ws.on('message', (data, isBinary) => {
                if (settled) return;

                let audioBase64 = null;
                if (!isBinary) {
                    try {
                        const parsed = JSON.parse(data.toString());
                        if (parsed.error) {
                            console.error('[MurfService] API Error Message:', parsed.error);
                            return;
                        }
                        if (parsed.audio) {
                            audioBase64 = parsed.audio;
                        }
                    } catch (_) {}
                } else if (isBinary) {
                    // In case raw binary is returned
                    audioBase64 = data.toString('base64');
                }

                if (!audioBase64) return;

                let pcmChunk = Buffer.from(audioBase64, 'base64');
                if (pcmChunk.length === 0) return;

                // If first chunk starts with 44-byte RIFF WAV header, strip the header
                if (isFirstAudioMsg) {
                    isFirstAudioMsg = false;
                    if (pcmChunk.length >= 44 && pcmChunk.slice(0, 4).toString() === 'RIFF') {
                        pcmChunk = pcmChunk.subarray(44);
                    }
                }

                if (pcmChunk.length === 0) return;

                // Concatenate with any leftover bytes from previous chunk
                const combinedPcm = Buffer.concat([remainderPcm, pcmChunk]);
                // Each 24kHz 16-bit sample is 2 bytes, and 3-to-1 downsample needs 6 bytes per output sample
                const processableBytes = Math.floor(combinedPcm.length / 6) * 6;
                const pcmToConvert = combinedPcm.subarray(0, processableBytes);
                remainderPcm = Buffer.from(combinedPcm.subarray(processableBytes));

                if (pcmToConvert.length > 0) {
                    const mulawChunk = convertPcm24kToMulaw8k(pcmToConvert);
                    if (mulawChunk.length > 0) {
                        if (!firstChunkReceived) {
                            firstChunkReceived = true;
                            const firstByteMs = Date.now() - startTime;
                            console.log(`[MurfService] First audio chunk received in ${firstByteMs}ms (Model: ${modelId})`);
                        }
                        collectedMulawChunks.push(mulawChunk);
                        if (onChunk) {
                            try { onChunk(mulawChunk); } catch (_) {}
                        }
                    }
                }

                let totalCollectedBytes = 0;
                for (let i = 0; i < collectedMulawChunks.length; i++) {
                    totalCollectedBytes += collectedMulawChunks[i].length;
                }
                const minExpected = getMinExpectedAudioBytes(trimmed);
                // If we haven't reached the minimum expected audio length yet, Murf is still synthesizing
                // subsequent clauses/sentences; give it up to 1600ms between chunks so speech isn't cut off.
                // Once minimum audio has arrived, 700ms of idle confirms the stream has completed.
                const idleDelay = totalCollectedBytes < minExpected ? 1600 : 700;

                // Debounce idle timer: when audio pauses for idleDelay ms, stream has finished
                if (idleTimer) clearTimeout(idleTimer);
                idleTimer = setTimeout(() => {
                    finish(collectedMulawChunks.length > 0 ? Buffer.concat(collectedMulawChunks) : null);
                }, idleDelay);
            });

            ws.on('error', (err) => {
                console.error('[MurfService] WebSocket error:', err.message);
                if (!firstChunkReceived) finish(null);
            });

            ws.on('close', (code, reason) => {
                // Process any final remaining bytes if possible
                if (remainderPcm.length >= 2) {
                    const lastSample = remainderPcm.readInt16LE(0);
                    const lastMulaw = Buffer.from([linear16ToMulaw(lastSample)]);
                    collectedMulawChunks.push(lastMulaw);
                    if (onChunk) {
                        try { onChunk(lastMulaw); } catch (_) {}
                    }
                    remainderPcm = Buffer.alloc(0);
                }
                finish(collectedMulawChunks.length > 0 ? Buffer.concat(collectedMulawChunks) : null);
            });
        });
    }

    /**
     * Transcribes telephony audio (8kHz G.711 mu-law) using Murf's Speech-to-Text streaming WebSocket API.
     *
     * @param {Buffer} audioBuffer - 8kHz mu-law audio buffer (or PCM if specified)
     * @param {object} options - { language, codec, sampleRate, channels, timeoutMs }
     * @returns {Promise<{transcript: string, language: string, error?: string}>}
     */
    static async speechToText(audioBuffer, options = {}) {
        if (!audioBuffer || audioBuffer.length === 0) {
            return { transcript: '', language: options.language || 'en' };
        }

        let apiKey;
        try {
            apiKey = this.getApiKey();
        } catch (err) {
            console.error('[MurfService] STT Configuration error:', err.message);
            return { transcript: '', language: options.language || 'en', error: err.message };
        }

        const wsBaseUrl = this.getSttWsUrl();
        const langParam = this.mapLanguageCodeForStt(options.language);
        const connectUrl = `${wsBaseUrl}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(langParam)}&text_formatting=true`;

        const codec = options.codec || 'mulaw';
        const sampleRate = options.sampleRate || 8000;
        const channels = options.channels || 1;
        const timeoutMs = options.timeoutMs || 7000;

        const startTime = Date.now();
        console.log(`[MurfService] STT request start: Codec=${codec}, Rate=${sampleRate}, Lang=${langParam}, Audio=${audioBuffer.length} bytes`);

        return new Promise((resolve) => {
            let settled = false;
            let ws = null;
            let timer = null;
            let finalTranscript = '';
            let detectedLanguage = options.language || 'en';

            const finish = (result) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                if (ws) {
                    try {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.close();
                        }
                    } catch (_) {}
                }

                const elapsedMs = Date.now() - startTime;
                console.log(`[MurfService] STT complete in ${elapsedMs}ms (${audioBuffer.length} bytes audio): "${(result.transcript || '').slice(0, 60)}"`);
                resolve(result);
            };

            timer = setTimeout(() => {
                console.warn(`[MurfService] STT request timed out after ${timeoutMs}ms.`);
                finish({ transcript: finalTranscript, language: detectedLanguage, error: 'TIMEOUT' });
            }, timeoutMs);

            try {
                ws = new WebSocket(connectUrl, {
                    headers: {
                        'api-key': apiKey,
                        'api_key': apiKey
                    }
                });
            } catch (initErr) {
                console.error('[MurfService] STT WebSocket initialization error:', initErr.message);
                return finish({ transcript: '', language: detectedLanguage, error: initErr.message });
            }

            ws.on('open', () => {
                try {
                    // Send AudioConfig first
                    const configMsg = {
                        type: 'AudioConfig',
                        codec: codec,
                        sample_rate: sampleRate,
                        channels: channels
                    };
                    ws.send(JSON.stringify(configMsg));

                    // Send audio in 800-byte (100ms) chunks
                    const chunkSize = 800;
                    for (let offset = 0; offset < audioBuffer.length; offset += chunkSize) {
                        const chunk = audioBuffer.subarray(offset, Math.min(offset + chunkSize, audioBuffer.length));
                        ws.send(chunk);
                    }

                    // Send Finalize to mark end of turn
                    ws.send(JSON.stringify({ type: 'Finalize' }));
                } catch (sendErr) {
                    console.error('[MurfService] STT Error sending audio payload:', sendErr.message);
                    finish({ transcript: '', language: detectedLanguage, error: sendErr.message });
                }
            });

            ws.on('message', (data) => {
                if (settled) return;
                try {
                    const parsed = JSON.parse(data.toString());
                    if (parsed.type === 'Error') {
                        console.error('[MurfService] STT API Error:', parsed.message || 'Unknown error');
                        finish({ transcript: '', language: detectedLanguage, error: parsed.message });
                        return;
                    }
                    if (parsed.type === 'partial') {
                        if (parsed.transcript) {
                            finalTranscript = parsed.transcript.trim();
                        }
                    }
                    if (parsed.type === 'final') {
                        const text = (parsed.transcript || (parsed.rawEvent && parsed.rawEvent.transcript) || finalTranscript || '').trim();
                        finish({ transcript: text, language: detectedLanguage });
                    }
                } catch (_) {
                    // Non-fatal parse warning
                }
            });

            ws.on('error', (err) => {
                console.error('[MurfService] STT WebSocket error:', err.message);
                finish({ transcript: finalTranscript, language: detectedLanguage, error: err.message });
            });

            ws.on('close', () => {
                finish({ transcript: finalTranscript, language: detectedLanguage });
            });
        });
    }

    /**
     * Initializes a real-time continuous streaming STT session for an active caller turn.
     * Audio frames can be streamed incrementally as they arrive from telephony.
     */
    static createSttSession(options = {}) {
        const session = new MurfSttStreamSession(options);
        return session.start();
    }
}

/**
 * Continuous real-time Speech-to-Text streaming session for a single caller turn.
 * Connects to Murf STT WebSocket as soon as speech is detected, sends 8kHz mu-law frames
 * in real-time as they arrive from Plivo, and finalizes with minimal latency (< 100ms) upon VAD silence.
 */
export class MurfSttStreamSession {
    constructor(options = {}) {
        this.callId = options.callId || 'unknown';
        this.turnId = options.turnId || 1;
        this.language = options.language || 'en';
        this.codec = options.codec || 'mulaw';
        this.sampleRate = options.sampleRate || 8000;
        this.channels = options.channels || 1;
        this.onPartial = options.onPartial || null;
        this.onReady = options.onReady || null;

        this.state = 'INITIALIZING'; // INITIALIZING, CONNECTING, READY, STREAMING, FINALIZING, COMPLETED, CLOSED
        this.ws = null;
        this.pendingChunks = [];
        this.totalBytesSent = 0;
        this.partialTranscript = '';
        this.finalTranscript = '';
        this.error = null;
        this.finalizePromise = null;
        this.finalizeResolve = null;
        this.finalizeTimeoutTimer = null;
        this.createdAt = performance.now();
        this.connectStartTime = null;
        this.connectedTime = null;
        this.finalizedStartTime = null;
        this.finalReceivedTime = null;
    }

    start() {
        if (this.state !== 'INITIALIZING') return this;
        this.state = 'CONNECTING';
        this.connectStartTime = performance.now();

        let apiKey;
        try {
            apiKey = MurfService.getApiKey();
        } catch (err) {
            this.state = 'CLOSED';
            this.error = err.message;
            return this;
        }

        const wsBaseUrl = MurfService.getSttWsUrl();
        const langParam = MurfService.mapLanguageCodeForStt(this.language);
        const connectUrl = `${wsBaseUrl}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(langParam)}&text_formatting=true`;

        try {
            this.ws = new WebSocket(connectUrl, {
                headers: {
                    'api-key': apiKey,
                    'api_key': apiKey
                }
            });
        } catch (err) {
            this.state = 'CLOSED';
            this.error = err.message;
            return this;
        }

        this.ws.on('open', () => {
            if (this.state === 'CLOSED') {
                try { this.ws.close(); } catch (_) {}
                return;
            }
            this.connectedTime = performance.now();
            this.state = 'READY';
            if (typeof this.onReady === 'function') {
                this.onReady(Math.round(this.connectedTime - this.connectStartTime));
            }

            try {
                // Send AudioConfig handshake frame
                const configMsg = {
                    type: 'AudioConfig',
                    codec: this.codec,
                    sample_rate: this.sampleRate,
                    channels: this.channels
                };
                this.ws.send(JSON.stringify(configMsg));

                // Flush any buffered chunks accumulated while connecting
                if (this.pendingChunks.length > 0) {
                    this.state = 'STREAMING';
                    for (const chunk of this.pendingChunks) {
                        this.ws.send(chunk);
                        this.totalBytesSent += chunk.length;
                    }
                    this.pendingChunks = [];
                }

                // If finalize was already requested while connecting, send Finalize now
                if (this.finalizePromise && this.state !== 'FINALIZING') {
                    this._sendFinalize();
                }
            } catch (sendErr) {
                this.error = sendErr.message;
                this._resolveFinalize({ transcript: this.partialTranscript, language: this.language, error: sendErr.message });
            }
        });

        this.ws.on('message', (data) => {
            try {
                const parsed = JSON.parse(data.toString());
                if (parsed.type === 'Error') {
                    this.error = parsed.message || 'Murf STT Error';
                    console.warn(`[MurfSttStreamSession] STT Error for ${this.callId} turn ${this.turnId}:`, this.error);
                    this._resolveFinalize({ transcript: this.partialTranscript, language: this.language, error: this.error });
                    return;
                }
                if (parsed.type === 'partial') {
                    if (parsed.transcript) {
                        this.partialTranscript = parsed.transcript.trim();
                        if (typeof this.onPartial === 'function') {
                            this.onPartial(this.partialTranscript);
                        }
                    }
                }
                if (parsed.type === 'final') {
                    this.finalReceivedTime = performance.now();
                    this.finalTranscript = (parsed.transcript || (parsed.rawEvent && parsed.rawEvent.transcript) || this.partialTranscript || '').trim();
                    this.state = 'COMPLETED';
                    const dur = this.finalizedStartTime ? Math.round(this.finalReceivedTime - this.finalizedStartTime) : 0;
                    this._resolveFinalize({
                        transcript: this.finalTranscript,
                        language: this.language,
                        durationMs: dur,
                        totalDurationMs: Math.round(this.finalReceivedTime - this.createdAt)
                    });
                }
            } catch (_) {}
        });

        this.ws.on('error', (err) => {
            this.error = err.message;
            this._resolveFinalize({ transcript: this.partialTranscript, language: this.language, error: err.message });
        });

        this.ws.on('close', () => {
            if (this.state !== 'COMPLETED') {
                this.state = 'CLOSED';
                this._resolveFinalize({ transcript: this.finalTranscript || this.partialTranscript, language: this.language });
            }
        });

        return this;
    }

    sendAudioChunk(chunk) {
        if (!chunk || chunk.length === 0 || this.state === 'FINALIZING' || this.state === 'COMPLETED' || this.state === 'CLOSED') {
            return;
        }

        if (this.state === 'READY' || this.state === 'STREAMING') {
            try {
                this.ws.send(chunk);
                this.totalBytesSent += chunk.length;
                this.state = 'STREAMING';
            } catch (err) {
                this.error = err.message;
            }
        } else if (this.state === 'CONNECTING' || this.state === 'INITIALIZING') {
            if (this.totalBytesSent + this.pendingChunks.reduce((acc, c) => acc + c.length, 0) < 160000) {
                this.pendingChunks.push(chunk);
            }
        }
    }

    _sendFinalize() {
        this.state = 'FINALIZING';
        this.finalizedStartTime = performance.now();
        try {
            this.ws.send(JSON.stringify({ type: 'Finalize' }));
        } catch (err) {
            this.error = err.message;
            this._resolveFinalize({ transcript: this.partialTranscript, language: this.language, error: err.message });
        }
    }

    _resolveFinalize(result) {
        if (this.finalizeTimeoutTimer) {
            clearTimeout(this.finalizeTimeoutTimer);
            this.finalizeTimeoutTimer = null;
        }
        if (this.finalizeResolve) {
            const res = this.finalizeResolve;
            this.finalizeResolve = null;
            res(result);
        }
    }

    async finalize(timeoutMs = 4500) {
        if (this.finalizePromise) return this.finalizePromise;

        this.finalizePromise = new Promise((resolve) => {
            this.finalizeResolve = resolve;
            this.finalizeTimeoutTimer = setTimeout(() => {
                console.warn(`[MurfSttStreamSession] STT finalize timeout (${timeoutMs}ms) for ${this.callId} turn ${this.turnId}.`);
                this._resolveFinalize({
                    transcript: this.finalTranscript || this.partialTranscript,
                    language: this.language,
                    error: 'TIMEOUT'
                });
                this.close();
            }, timeoutMs);

            if (this.state === 'READY' || this.state === 'STREAMING') {
                this._sendFinalize();
            } else if (this.state === 'COMPLETED' || this.state === 'CLOSED') {
                this._resolveFinalize({
                    transcript: this.finalTranscript || this.partialTranscript,
                    language: this.language,
                    error: this.error
                });
            }
        });

        return this.finalizePromise;
    }

    close() {
        this.state = 'CLOSED';
        if (this.finalizeTimeoutTimer) {
            clearTimeout(this.finalizeTimeoutTimer);
            this.finalizeTimeoutTimer = null;
        }
        if (this.ws) {
            try {
                if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                    this.ws.close();
                }
            } catch (_) {}
            this.ws = null;
        }
    }
}

