import 'dotenv/config';
import crypto from 'crypto';

/**
 * services/elevenlabs_service.js
 * Integration with ElevenLabs Voice AI:
 * - Text-to-Speech (TTS): hyper-realistic multilingual speech generation
 * - Speech-to-Text (STT): Scribe model transcription for caller speech
 * - Webhook Signature Verification (HMAC SHA-256)
 */

const ttsAudioCache = new Map();
const MAX_CACHE_SIZE = 150;

function getCacheKey(text, voiceId, modelId, outputFormat) {
    return `${voiceId}_${modelId}_${outputFormat}_${String(text || '').trim().toLowerCase()}`;
}

export default class ElevenLabsService {
    static getApiKey() {
        const key = (process.env.ELEVENLABS_API_KEY || '').trim();
        if (!key) {
            throw new Error('ELEVENLABS_API_KEY is not configured in environment.');
        }
        return key;
    }

    static getVoiceId(lang = null) {
        if (lang) {
            return this.getVoiceIdForLanguage(lang);
        }
        return (process.env.ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID_PARI || '06llJPvI62CjqSWOX9Gp').trim();
    }

    static getVoiceIdForLanguage(lang = 'en') {
        const l = (lang || '').toLowerCase().trim();
        if (l === 'te' || l === 'tel' || l === 'telugu') {
            return (process.env.ELEVENLABS_VOICE_ID_CHAITRA || 'oyjIr5XAhIyRjfNq6spl').trim();
        }
        return (process.env.ELEVENLABS_VOICE_ID_PARI || process.env.ELEVENLABS_VOICE_ID || '06llJPvI62CjqSWOX9Gp').trim();
    }

    static getFastModelId() {
        return (process.env.ELEVENLABS_FAST_MODEL_ID || 'eleven_flash_v2_5').trim();
    }

    static getMultilingualModelId() {
        return (process.env.ELEVENLABS_MULTILINGUAL_MODEL_ID || process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2').trim();
    }

    /**
     * Centralized TTS model selection function.
     * Evaluates language, voice, and configured preferences to select either
     * Flash v2.5 (low-latency) or Multilingual v2 (phonetic stability).
     * 
     * @param {object|string} options - Selection options or language code string
     * @param {string} [options.language='en'] - Conversation language (e.g. en, hi, te)
     * @param {string} [options.voiceId=null] - Voice ID
     * @param {string} [options.preferModel=null] - Optional override ('fast' | 'multilingual')
     * @param {string} [options.overrideModel=null] - Explicit model ID override
     * @returns {string} Model ID
     */
    static selectTtsModel(options = {}) {
        if (typeof options === 'string') {
            options = { language: options };
        }
        const { language = 'en', voiceId = null, preferModel = null, overrideModel = null } = options;

        if (overrideModel && typeof overrideModel === 'string' && overrideModel.trim()) {
            return overrideModel.trim();
        }

        const fastModel = this.getFastModelId();
        const multilingualModel = this.getMultilingualModelId();

        // Explicit preference override via option or env
        const globalPref = (preferModel || process.env.ELEVENLABS_PREFERRED_MODEL || '').toLowerCase().trim();
        if (globalPref === 'multilingual' || globalPref === 'eleven_multilingual_v2') {
            return multilingualModel;
        }
        if (globalPref === 'fast' || globalPref === 'flash' || globalPref === 'eleven_flash_v2_5') {
            return fastModel;
        }

        // Language normalization
        const l = (language || '').toLowerCase().trim();

        // Check language-specific override env if configured
        if ((l === 'te' || l === 'tel' || l === 'telugu') && process.env.ELEVENLABS_TELUGU_MODEL_ID) {
            return process.env.ELEVENLABS_TELUGU_MODEL_ID.trim();
        }

        // Policy:
        // 1. English (en/eng) -> Flash v2.5 (preferred low-latency conversational model)
        // 2. Hindi (hi/hin) -> Flash v2.5 (verified sub-500ms synthesis with Pari voice)
        // 3. Telugu (te/tel) -> Multilingual v2 (verified stability for complex Telugu script with Chaitra)
        // 4. Default -> Flash v2.5
        if (l === 'te' || l === 'tel' || l === 'telugu') {
            return multilingualModel;
        }
        if (l === 'hi' || l === 'hin' || l === 'hindi') {
            return fastModel;
        }
        if (l === 'en' || l === 'eng' || l === 'english') {
            return fastModel;
        }

        return fastModel;
    }

    /**
     * Backward-compatible alias for selectTtsModel.
     */
    static getModelId(options = {}) {
        return this.selectTtsModel(options);
    }

    /**
     * Returns the configured alternative model for compatibility fallback.
     */
    static getAlternativeModel(currentModel) {
        const fast = this.getFastModelId();
        const multi = this.getMultilingualModelId();
        if (currentModel === fast) return multi;
        return fast;
    }

    static getWebhookSecret() {
        return (
            process.env.ELEVENLABS_WEBHOOK_SECRET ||
            process.env['ELEVEVEN-LABS_WEBHOOK_SECRET'] ||
            process.env.ELEVEN_LABS_WEBHOOK_SECRET ||
            ''
        ).trim();
    }

    static isConfigured() {
        return Boolean((process.env.ELEVENLABS_API_KEY || '').trim());
    }

    /**
     * Retrieves pre-synthesized audio from in-memory cache without making a network request.
     */
    static getCachedAudio(text, options = {}) {
        if (!text || !text.trim()) return null;
        const voiceId = options.voiceId || this.getVoiceId(options.language || options.lang);
        const modelId = options.modelId || this.selectTtsModel(options);
        const outputFormat = options.outputFormat || 'ulaw_8000';
        const key = getCacheKey(text, voiceId, modelId, outputFormat);
        return ttsAudioCache.get(key) || null;
    }

    /**
     * Explicitly saves an audio buffer to in-memory cache.
     */
    static precacheAudio(text, buffer, options = {}) {
        if (!text || !buffer) return;
        const voiceId = options.voiceId || this.getVoiceId(options.language || options.lang);
        const modelId = options.modelId || this.selectTtsModel(options);
        const outputFormat = options.outputFormat || 'ulaw_8000';
        const key = getCacheKey(text, voiceId, modelId, outputFormat);

        if (ttsAudioCache.size >= MAX_CACHE_SIZE) {
            const firstKey = ttsAudioCache.keys().next().value;
            ttsAudioCache.delete(firstKey);
        }
        ttsAudioCache.set(key, buffer);
    }

    /**
     * Converts text into speech audio using ElevenLabs REST API with in-memory caching,
     * centralized model selection, streaming byte tracking, and compatibility fallback.
     * 
     * @param {string} text - Spoken dialogue text
     * @param {object} options - Optional settings (voiceId, modelId, language, outputFormat, timeoutMs, onChunk)
     * @returns {Promise<Buffer|null>} Audio buffer or null on error
     */
    static async textToSpeech(text, options = {}) {
        if (!text || !text.trim()) return null;

        const language = options.language || options.lang || 'en';
        const voiceId = options.voiceId || this.getVoiceId(language);
        const modelId = options.modelId || this.selectTtsModel({
            language,
            voiceId,
            preferModel: options.preferModel,
            overrideModel: options.overrideModel
        });
        const outputFormat = options.outputFormat || 'ulaw_8000';

        // Timing Log 1: Centralized Model Selection
        console.log(`[ElevenLabsService] Model selected: ${modelId} (Lang: ${language}, Voice: ${voiceId})`);

        const cacheKey = getCacheKey(text, voiceId, modelId, outputFormat);

        // Instant cache hit (< 1ms)
        if (ttsAudioCache.has(cacheKey)) {
            console.log(`[ElevenLabsService] TTS cache hit for model ${modelId} (< 1ms)`);
            return ttsAudioCache.get(cacheKey);
        }

        return await this._synthesizeWithFallback(text, {
            ...options,
            voiceId,
            modelId,
            language,
            outputFormat
        });
    }

    /**
     * Performs TTS synthesis with single automatic retry on model compatibility errors.
     * Prevents serial retries on rate limits, auth errors, or timeouts.
     */
    static async _synthesizeWithFallback(text, options) {
        const primaryModel = options.modelId;
        const voiceId = options.voiceId;
        const outputFormat = options.outputFormat;
        const timeoutMs = options.timeoutMs || 8000;

        const res = await this._executeTtsFetch(text, primaryModel, voiceId, outputFormat, timeoutMs, options.onChunk);

        if (res.success && res.buffer) {
            this.precacheAudio(text, res.buffer, { voiceId, modelId: primaryModel, outputFormat });
            return res.buffer;
        }

        // Retry policy: Only retry on model compatibility errors (HTTP 400/422 indicating model/voice/lang mismatch)
        const isModelCompatError = (res.status === 400 || res.status === 422) &&
            (res.errorText?.toLowerCase().includes('model') ||
             res.errorText?.toLowerCase().includes('not supported') ||
             res.errorText?.toLowerCase().includes('language') ||
             res.errorText?.toLowerCase().includes('voice'));

        if (isModelCompatError && !options._isRetry) {
            const altModel = this.getAlternativeModel(primaryModel);
            if (altModel && altModel !== primaryModel) {
                console.warn(`[ElevenLabsService] TTS fallback triggered: Primary model ${primaryModel} failed (HTTP ${res.status} - ${res.errorText?.slice(0, 80)}). Retrying with alternative model ${altModel}...`);
                const retryRes = await this._executeTtsFetch(text, altModel, voiceId, outputFormat, timeoutMs, options.onChunk);
                if (retryRes.success && retryRes.buffer) {
                    this.precacheAudio(text, retryRes.buffer, { voiceId, modelId: altModel, outputFormat });
                    return retryRes.buffer;
                }
            }
        }

        return null;
    }

    /**
     * Executes the HTTP POST request to ElevenLabs with streaming byte metrics and timing logs.
     */
    static async _executeTtsFetch(text, modelId, voiceId, outputFormat, timeoutMs, onChunk = null) {
        const apiKey = this.getApiKey();
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`;

        const payload = {
            text: text.trim(),
            model_id: modelId,
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0.0,
                use_speaker_boost: true
            }
        };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const startTime = performance.now();

        // Timing Log 2: Request Start
        console.log(`[ElevenLabsService] TTS request start: Model=${modelId}, Voice=${voiceId}, Format=${outputFormat}, Length=${text.trim().length} chars`);

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json',
                    'Accept': outputFormat.startsWith('mp3') ? 'audio/mpeg' : 'audio/basic'
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timer);

            if (!res.ok) {
                const errorText = await res.text();
                console.error(`[ElevenLabsService] TTS API error (HTTP ${res.status}, Model: ${modelId}):`, errorText.slice(0, 180));
                return { success: false, status: res.status, errorText };
            }

            let buffer;
            let firstByteMs = null;

            // Stream reading to capture first audio chunk timing
            if (res.body && typeof res.body.getReader === 'function') {
                const reader = res.body.getReader();
                const chunks = [];
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (firstByteMs === null && value && value.length > 0) {
                        firstByteMs = Math.round(performance.now() - startTime);
                        // Timing Log 3: First Audio Byte/Chunk
                        console.log(`[ElevenLabsService] First audio byte received in ${firstByteMs}ms (Model: ${modelId})`);
                    }
                    chunks.push(value);
                    if (typeof onChunk === 'function') {
                        try { onChunk(value); } catch (_) {}
                    }
                }
                buffer = Buffer.concat(chunks);
            } else {
                const arrayBuf = await res.arrayBuffer();
                buffer = Buffer.from(arrayBuf);
                firstByteMs = Math.round(performance.now() - startTime);
                console.log(`[ElevenLabsService] First audio byte received in ${firstByteMs}ms (Model: ${modelId})`);
            }

            const totalMs = Math.round(performance.now() - startTime);
            const estDurationMs = outputFormat === 'ulaw_8000' ? Math.round((buffer.length / 8000) * 1000) : null;
            // Timing Log 4: Audio Completion
            console.log(`[ElevenLabsService] Audio complete: ${buffer.length} bytes in ${totalMs}ms (Model: ${modelId}${estDurationMs ? `, ~${estDurationMs}ms audio` : ''})`);

            return {
                success: true,
                buffer,
                firstByteMs,
                totalMs
            };
        } catch (err) {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                console.warn(`[ElevenLabsService] TTS request timed out after ${timeoutMs}ms (Model: ${modelId}).`);
            } else {
                console.error(`[ElevenLabsService] TTS network exception (Model: ${modelId}):`, err.message);
            }
            return { success: false, status: 0, errorText: err.message };
        }
    }

    /**
     * Transcribes an audio buffer using ElevenLabs Scribe STT API.
     * @param {Buffer} audioBuffer - WAV, MP3, or PCM audio buffer
     * @param {string} filename - Filename for form-data (e.g. caller_turn.wav)
     * @param {string|null} languageCode - Optional language code (e.g. eng, hin, tel)
     * @returns {Promise<{transcript: string, language: string}>}
     */
    static async speechToText(audioBuffer, filename = 'caller_turn.wav', languageCode = null) {
        if (!audioBuffer || audioBuffer.length === 0) {
            return { transcript: '', language: 'en' };
        }

        const apiKey = this.getApiKey();
        const url = 'https://api.elevenlabs.io/v1/speech-to-text';

        const form = new FormData();
        const blob = new Blob([audioBuffer], { type: filename.endsWith('.wav') ? 'audio/wav' : 'audio/basic' });
        form.append('file', blob, filename);
        form.append('model_id', 'scribe_v1');

        if (languageCode) {
            form.append('language_code', languageCode);
        }

        const timeoutMs = 4500;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'xi-api-key': apiKey
                },
                body: form,
                signal: controller.signal
            });

            clearTimeout(timer);

            if (res.ok) {
                const data = await res.json();
                const transcript = (data.text || data.transcript || '').trim();
                const detectedLanguage = (data.language_code || data.language || 'en').toLowerCase();
                return { transcript, language: detectedLanguage };
            } else {
                const errText = await res.text();
                console.error(`[ElevenLabsService] STT API error (HTTP ${res.status}):`, errText.slice(0, 160));
                return { transcript: '', language: 'en' };
            }
        } catch (err) {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                console.warn(`[ElevenLabsService] STT request timed out after ${timeoutMs}ms.`);
            } else {
                console.error('[ElevenLabsService] STT network exception:', err.message);
            }
            return { transcript: '', language: 'en' };
        }
    }

    /**
     * Verifies the HMAC-SHA256 signature on incoming ElevenLabs webhooks.
     * @param {string|Buffer} rawBody - The unparsed request body string or buffer
     * @param {string} signatureHeader - Value of 'ElevenLabs-Signature' or 'elevenlabs-signature'
     * @param {string} secret - Webhook signing secret (wsec_...)
     * @returns {boolean}
     */
    static verifyWebhookSignature(rawBody, signatureHeader, secret = null) {
        const signingSecret = (secret || this.getWebhookSecret()).trim();
        if (!signingSecret) {
            console.warn('[ElevenLabsService] Webhook secret not set; skipping signature verification.');
            return true;
        }

        if (!signatureHeader || !rawBody) {
            return false;
        }

        try {
            // Header format: t=1614212948,v1=5257186dbcdf...
            const parts = signatureHeader.split(',');
            let timestamp = '';
            let signature = '';

            for (const part of parts) {
                const [k, v] = part.split('=');
                if (k.trim() === 't') timestamp = v.trim();
                if (k.trim() === 'v1') signature = v.trim();
            }

            if (!timestamp || !signature) {
                return false;
            }

            const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
            const signedPayload = `${timestamp}.${bodyString}`;
            const computedSignature = crypto
                .createHmac('sha256', signingSecret)
                .update(signedPayload)
                .digest('hex');

            return crypto.timingSafeEqual(
                Buffer.from(signature, 'hex'),
                Buffer.from(computedSignature, 'hex')
            );
        } catch (e) {
            console.error('[ElevenLabsService] Webhook verification error:', e.message);
            return false;
        }
    }

    /**
     * Fetches the list of accessible voices in the ElevenLabs account.
     */
    static async getVoices() {
        const apiKey = this.getApiKey();
        const res = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': apiKey }
        });
        if (res.ok) {
            const data = await res.json();
            return data.voices || [];
        }
        throw new Error(`Failed to list ElevenLabs voices: HTTP ${res.status}`);
    }
}
