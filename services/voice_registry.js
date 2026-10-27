import 'dotenv/config';
import MurfService from './murf_service.js';

/**
 * services/voice_registry.js
 *
 * Central server-side registry and allowlist validator for AI Voices and Primary Languages.
 * Maps high-level voice identifiers (pooja, abhinav, samar, abirami) to their exact
 * server-side provider configuration, models, supported locales, and environment variables.
 *
 * Security & Integrity:
 * - API keys and provider secrets remain strictly on the backend.
 * - Enforces strict allowlist validation; arbitrary voice IDs submitted by clients are rejected.
 * - Enforces provider-verified voice-language compatibility.
 */

export const SUPPORTED_LANGUAGES = [
    {
        locale: 'te-IN',
        code: 'te',
        name: 'Telugu',
        nativeName: 'తెలుగు',
        label: 'Telugu (తెలుగు) — te-IN'
    },
    {
        locale: 'en-IN',
        code: 'en',
        name: 'English (India)',
        nativeName: 'English (India)',
        label: 'English (India) — en-IN'
    },
    {
        locale: 'hi-IN',
        code: 'hi',
        name: 'Hindi',
        nativeName: 'हिन्दी',
        label: 'Hindi (हिन्दी) — hi-IN'
    },
    {
        locale: 'ta-IN',
        code: 'ta',
        name: 'Tamil',
        nativeName: 'தமிழ்',
        label: 'Tamil (தமிழ்) — ta-IN'
    },
    {
        locale: 'kn-IN',
        code: 'kn',
        name: 'Kannada',
        nativeName: 'ಕನ್ನಡ',
        label: 'Kannada (ಕನ್ನಡ) — kn-IN'
    },
    {
        locale: 'ml-IN',
        code: 'ml',
        name: 'Malayalam',
        nativeName: 'മലയാളം',
        label: 'Malayalam (മലയാളം) — ml-IN'
    },
    {
        locale: 'mr-IN',
        code: 'mr',
        name: 'Marathi',
        nativeName: 'मराठी',
        label: 'Marathi (मराठी) — mr-IN'
    }
];

export const VOICE_DEFINITIONS = {
    pooja: {
        id: 'pooja',
        name: 'Pooja',
        gender: 'Female Voice',
        description: 'Female Voice',
        isDefault: true,
        provider: 'murf',
        model: 'falcon-2.1',
        defaultStyle: 'Conversational',
        getVoiceId: () => (process.env.MURF_POOJA_VOICE_ID || process.env.MURF_VOICE_ID || 'Pooja').trim(),
        supportedLocales: ['en-IN', 'te-IN', 'hi-IN', 'ta-IN', 'kn-IN']
    },
    abhinav: {
        id: 'abhinav',
        name: 'Abhinav',
        gender: 'Male Voice',
        description: 'Male Voice',
        provider: 'murf',
        model: 'falcon-2.1',
        defaultStyle: 'Conversational',
        getVoiceId: () => (process.env.MURF_ABHINAV_VOICE_ID || 'en-IN-abhinav').trim(),
        supportedLocales: ['en-IN', 'hi-IN', 'ml-IN', 'mr-IN']
    },
    samar: {
        id: 'samar',
        name: 'Samar',
        gender: 'Male Voice',
        description: 'Male Voice',
        provider: 'murf',
        model: 'falcon-2.1',
        defaultStyle: 'Conversational',
        getVoiceId: () => (process.env.MURF_SAMAR_VOICE_ID || 'en-IN-samar').trim(),
        supportedLocales: ['en-IN', 'te-IN', 'hi-IN', 'ta-IN', 'kn-IN', 'mr-IN']
    },
    abirami: {
        id: 'abirami',
        name: 'Abirami',
        gender: 'Female Voice',
        description: 'Female Voice',
        provider: 'murf',
        model: 'falcon-2.1',
        defaultStyle: 'Conversation',
        getVoiceId: () => (process.env.MURF_ABHINAMI_VOICE_ID || process.env.MURF_ABIRAMI_VOICE_ID || 'ta-IN-abirami').trim(),
        supportedLocales: ['ta-IN', 'te-IN', 'hi-IN']
    }
};

export const PREVIEW_TEXTS = {
    'te-IN': 'నమస్కారం! నేను టేక్‌రెమో నుండి మాట్లాడుతున్నాను. నేను మీకు ఎలా సహాయపడగలను?',
    'en-IN': 'Hello! This is TakeRemo speaking. How can I help you today?',
    'hi-IN': 'नमस्ते! मैं टेक रेमो से बोल रहा हूँ। मैं आज आपकी क्या सहायता कर सकता हूँ?',
    'ta-IN': 'வணக்கம்! நான் டேக் ரெமோவிலிருந்து பேசுகிறேன். இன்று நான் உங்களுக்கு எப்படி உதவ முடியும்?',
    'kn-IN': 'ನಮಸ್ಕಾರ! ನಾನು ಟೇಕ್‌ರೆಮೋದಿಂದ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?',
    'ml-IN': 'നമസ്കാരം! ഞാൻ ടേക്ക്റെമോയിൽ നിന്നാണ് സംസാരിക്കുന്നത്. ഇന്ന് ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കണം?',
    'mr-IN': 'नमस्कार! मी टेक रेमोकडून बोलत आहे. आज मी तुम्हाला कशी मदत करू शकेन?'
};

export class VoiceRegistry {
    /**
     * Normalizes any input key (e.g. 'Pooja', 'en-IN-pooja', 'pooja') to allowlisted canonical key.
     */
    static normalizeVoiceKey(rawKey) {
        if (!rawKey) return 'pooja';
        const str = String(rawKey).toLowerCase().trim();
        if (str.includes('pooja')) return 'pooja';
        if (str.includes('abhinav')) return 'abhinav';
        if (str.includes('samar')) return 'samar';
        if (str.includes('abirami')) return 'abirami';
        return str;
    }

    /**
     * Normalizes locale strings (e.g. 'te', 'te-in', 'te_IN') to canonical 'te-IN'.
     */
    static normalizeLocale(rawLocale) {
        if (!rawLocale) return 'en-IN';
        const str = String(rawLocale).trim().replace('_', '-');
        const match = SUPPORTED_LANGUAGES.find(l => 
            l.locale.toLowerCase() === str.toLowerCase() ||
            l.code.toLowerCase() === str.toLowerCase()
        );
        return match ? match.locale : str;
    }

    /**
     * Returns true if voice key is in the allowlist.
     */
    static isAllowlistedVoice(voiceKey) {
        const canonical = this.normalizeVoiceKey(voiceKey);
        return Object.prototype.hasOwnProperty.call(VOICE_DEFINITIONS, canonical);
    }

    /**
     * Returns true if the voice is properly configured with an environment variable / voice ID.
     */
    static isVoiceConfigured(voiceKey) {
        const canonical = this.normalizeVoiceKey(voiceKey);
        const def = VOICE_DEFINITIONS[canonical];
        if (!def) return false;
        try {
            const vid = def.getVoiceId();
            return Boolean(vid && vid.length > 0 && MurfService.isConfigured());
        } catch {
            return false;
        }
    }

    /**
     * Resolves voice key to full provider configuration. Throws on validation failure.
     */
    static resolveVoice(voiceKey, locale = 'en-IN') {
        const canonical = this.normalizeVoiceKey(voiceKey);
        const def = VOICE_DEFINITIONS[canonical];
        if (!def) {
            throw new Error(`Invalid voice identifier "${voiceKey}". Permitted voices are: pooja, abhinav, samar, abirami.`);
        }

        const normLocale = this.normalizeLocale(locale);
        const voiceId = def.getVoiceId();
        if (!voiceId) {
            throw new Error(`Voice "${def.name}" is not configured in the server environment.`);
        }

        return {
            id: def.id,
            key: def.id,
            name: def.name,
            gender: def.gender,
            description: def.description,
            isDefault: Boolean(def.isDefault),
            provider: def.provider,
            model: def.model,
            style: def.defaultStyle,
            voiceId: voiceId,
            locale: normLocale,
            supportedLocales: [...def.supportedLocales]
        };
    }

    /**
     * Resolves voice configuration (alias for resolveVoice).
     */
    static getVoiceConfig(voiceKey, locale = 'en-IN') {
        return this.resolveVoice(voiceKey, locale);
    }

    /**
     * Checks if a voice directly supports a specific locale.
     */
    static isLocaleSupported(voiceKey, locale) {
        const canonical = this.normalizeVoiceKey(voiceKey);
        const def = VOICE_DEFINITIONS[canonical];
        if (!def) return false;
        const normLocale = this.normalizeLocale(locale);
        return def.supportedLocales.includes(normLocale);
    }

    /**
     * Validates that voice and locale combination is valid, configured, and compatible.
     */
    static validateVoiceAndLocale(voiceKey, locale) {
        const canonical = this.normalizeVoiceKey(voiceKey);
        if (!this.isAllowlistedVoice(canonical)) {
            return {
                valid: false,
                error: `Invalid voice identifier "${voiceKey}". Permitted voices: pooja, abhinav, samar, abirami.`
            };
        }

        const normLocale = this.normalizeLocale(locale);
        const langDef = SUPPORTED_LANGUAGES.find(l => l.locale === normLocale);
        if (!langDef) {
            return {
                valid: false,
                error: `Unsupported language "${locale}". Supported locales: ${SUPPORTED_LANGUAGES.map(l => l.locale).join(', ')}.`
            };
        }

        const voiceDef = VOICE_DEFINITIONS[canonical];
        if (!voiceDef.supportedLocales.includes(normLocale)) {
            const supportedVoiceNames = Object.values(VOICE_DEFINITIONS)
                .filter(v => v.supportedLocales.includes(normLocale))
                .map(v => v.name)
                .join(', ');
            return {
                valid: false,
                error: `Voice "${voiceDef.name}" (${voiceDef.description}) does not support ${langDef.name} (${normLocale}). Supported voices for ${langDef.name}: ${supportedVoiceNames || 'None'}.`
            };
        }

        if (!this.isVoiceConfigured(canonical)) {
            return {
                valid: false,
                error: `Voice "${voiceDef.name}" is not fully configured on the server.`
            };
        }

        return { valid: true };
    }

    /**
     * Client-safe voice descriptors (NO API keys or secrets exposed).
     */
    static getPublicVoices() {
        return Object.values(VOICE_DEFINITIONS).map(v => ({
            id: v.id,
            key: v.id,
            name: v.name,
            gender: v.gender,
            description: v.description,
            provider: v.provider,
            supportedLocales: [...v.supportedLocales],
            isDefault: Boolean(v.isDefault),
            isConfigured: this.isVoiceConfigured(v.id)
        }));
    }

    /**
     * Client-safe languages list.
     */
    static getPublicLanguages() {
        return SUPPORTED_LANGUAGES.map(l => ({ ...l }));
    }

    /**
     * Returns full configuration payload safe for client consumption.
     */
    static getPublicConfig() {
        return {
            voices: this.getPublicVoices(),
            languages: this.getPublicLanguages(),
            defaultVoice: 'pooja',
            defaultLocale: 'en-IN',
            defaultLanguage: 'en-IN',
            previewSupported: MurfService.isConfigured()
        };
    }

    /**
     * Returns preview text for a locale.
     */
    static getPreviewText(locale) {
        const normLocale = this.normalizeLocale(locale);
        return PREVIEW_TEXTS[normLocale] || PREVIEW_TEXTS['en-IN'];
    }

    /**
     * Decodes a single 8-bit mu-law sample to a 16-bit linear PCM sample.
     */
    static mulawToLinear16(u) {
        u = ~u & 0xFF;
        const sign = u & 0x80;
        const exponent = (u >> 4) & 0x07;
        const mantissa = u & 0x0F;
        let sample = ((mantissa << 3) + 0x84) << exponent;
        sample -= 0x84;
        return sign !== 0 ? -sample : sample;
    }

    /**
     * Encapsulates 8kHz mu-law audio into standard 16-bit linear PCM WAV
     * universally playable by all modern web browsers (<audio> element & Web Audio API).
     */
    static mulawBufferToPcmWav(mulawBuf, sampleRate = 8000) {
        if (!mulawBuf || mulawBuf.length === 0) return Buffer.alloc(0);
        const numSamples = mulawBuf.length;
        const pcmBuf = Buffer.alloc(numSamples * 2);
        for (let i = 0; i < numSamples; i++) {
            pcmBuf.writeInt16LE(this.mulawToLinear16(mulawBuf[i]), i * 2);
        }

        const header = Buffer.alloc(44);
        header.write('RIFF', 0);
        header.writeUInt32LE(36 + pcmBuf.length, 4);
        header.write('WAVE', 8);
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16); // SubChunk1Size (16 for PCM)
        header.writeUInt16LE(1, 20);  // AudioFormat: 1 = PCM
        header.writeUInt16LE(1, 22);  // NumChannels = 1 (Mono)
        header.writeUInt32LE(sampleRate, 24); // SampleRate (8000)
        header.writeUInt32LE(sampleRate * 2, 28); // ByteRate (16000)
        header.writeUInt16LE(2, 32);  // BlockAlign = 2
        header.writeUInt16LE(16, 34); // BitsPerSample = 16
        header.write('data', 36);
        header.writeUInt32LE(pcmBuf.length, 40);

        return Buffer.concat([header, pcmBuf]);
    }
}
export default VoiceRegistry;
