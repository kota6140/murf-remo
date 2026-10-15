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

    static getModelId() {
        return (process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2').trim();
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
        const voiceId = options.voiceId || this.getVoiceId();
        const modelId = options.modelId || this.getModelId();
        const outputFormat = options.outputFormat || 'ulaw_8000';
        const key = getCacheKey(text, voiceId, modelId, outputFormat);
        return ttsAudioCache.get(key) || null;
    }

    /**
     * Explicitly saves an audio buffer to in-memory cache.
     */
    static precacheAudio(text, buffer, options = {}) {
        if (!text || !buffer) return;
        const voiceId = options.voiceId || this.getVoiceId();
        const modelId = options.modelId || this.getModelId();
        const outputFormat = options.outputFormat || 'ulaw_8000';
        const key = getCacheKey(text, voiceId, modelId, outputFormat);

        if (ttsAudioCache.size >= MAX_CACHE_SIZE) {
            const firstKey = ttsAudioCache.keys().next().value;
            ttsAudioCache.delete(firstKey);
        }
        ttsAudioCache.set(key, buffer);
    }

    /**
     * Converts text into speech audio using ElevenLabs REST API with in-memory caching.
     * @param {string} text - Spoken dialogue text
     * @param {object} options - Optional settings (voiceId, modelId, outputFormat, timeoutMs)
     * @returns {Promise<Buffer|null>} Audio buffer or null on error
     */
    static async textToSpeech(text, options = {}) {
        if (!text || !text.trim()) return null;

        const voiceId = options.voiceId || this.getVoiceId();
        const modelId = options.modelId || this.getModelId();
        const outputFormat = options.outputFormat || 'ulaw_8000';
        const cacheKey = getCacheKey(text, voiceId, modelId, outputFormat);

        // Instant cache hit (< 1ms)
        if (ttsAudioCache.has(cacheKey)) {
            return ttsAudioCache.get(cacheKey);
        }

        const apiKey = this.getApiKey();
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`;

        const payload = {
            text: text.trim(),
            model_id: modelId,
            voice_settings: {
                stability: options.stability ?? 0.5,
                similarity_boost: options.similarity_boost ?? 0.75,
                style: options.style ?? 0.0,
                use_speaker_boost: options.use_speaker_boost ?? true
            }
        };

        const timeoutMs = options.timeoutMs || 8000;
        const controller = new AbortController();
        const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

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

            clearTimeout(timeoutTimer);

            if (res.ok) {
                const arrayBuf = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuf);
                this.precacheAudio(text, buffer, { voiceId, modelId, outputFormat });
                return buffer;
            } else {
                const errText = await res.text();
                console.error(`[ElevenLabsService] TTS API error (HTTP ${res.status}):`, errText.slice(0, 200));
                return null;
            }
        } catch (err) {
            clearTimeout(timeoutTimer);
            if (err.name === 'AbortError') {
                console.warn(`[ElevenLabsService] TTS request timed out after ${timeoutMs}ms.`);
            } else {
                console.error('[ElevenLabsService] TTS network exception:', err.message);
            }
            return null;
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
