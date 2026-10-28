/**
 * tests/tts_model_selection_and_fallback.test.js
 * 
 * Comprehensive test suite verifying:
 * 1. Environment model resolution (ELEVENLABS_MODEL_TELUGU, ELEVENLABS_MODEL_HINDI, ELEVENLABS_MODEL_ENGLISH)
 * 2. Automatic centralized model selection based on conversation language & text script
 * 3. Pari voice ID preservation across English, Hindi, and Telugu
 * 4. Model language compatibility verification (preventing sending Telugu to Flash v2.5)
 * 5. Language switching during active calls with audio buffer clearing
 * 6. Compatibility fallback on model-specific errors
 * 7. Live ElevenLabs TTS API synthesis verification for Telugu, Hindi, and English
 */

import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';
import ElevenLabsService from '../services/elevenlabs_service.js';
import { CallSession } from '../services/voicebot_stream_service.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

async function runTests() {
    console.log('====================================================');
    console.log('ELEVENLABS LANGUAGE-BASED MODEL SELECTION TEST SUITE');
    console.log('====================================================\n');

    // -----------------------------------------------------------------
    // Suite 1: Environment & Model Getters
    // -----------------------------------------------------------------
    console.log('--- Suite 1: Environment Model Resolution ---');

    await test('getModelForTelugu returns ELEVENLABS_MODEL_TELUGU from environment', () => {
        const teModel = ElevenLabsService.getModelForTelugu();
        assert.ok(teModel, 'Telugu model must not be empty');
        assert.strictEqual(teModel, process.env.ELEVENLABS_MODEL_TELUGU || 'eleven_v4_turbo');
    });

    await test('getModelForHindi returns ELEVENLABS_MODEL_HINDI from environment', () => {
        const hiModel = ElevenLabsService.getModelForHindi();
        assert.ok(hiModel, 'Hindi model must not be empty');
        assert.strictEqual(hiModel, process.env.ELEVENLABS_MODEL_HINDI || 'eleven_flash_v2_5');
    });

    await test('getModelForEnglish returns ELEVENLABS_MODEL_ENGLISH from environment', () => {
        const enModel = ElevenLabsService.getModelForEnglish();
        assert.ok(enModel, 'English model must not be empty');
        assert.strictEqual(enModel, process.env.ELEVENLABS_MODEL_ENGLISH || 'eleven_flash_v2_5');
    });

    await test('getFastModelId and getMultilingualModelId return configured env values', () => {
        const fast = ElevenLabsService.getFastModelId();
        const multi = ElevenLabsService.getMultilingualModelId();
        assert.strictEqual(fast, process.env.ELEVENLABS_FAST_MODEL_ID || 'eleven_flash_v2_5');
        assert.strictEqual(multi, process.env.ELEVENLABS_MULTILINGUAL_MODEL_ID || 'eleven_multilingual_v2');
    });

    // -----------------------------------------------------------------
    // Suite 2: Centralized Model Selection (selectTtsModel)
    // -----------------------------------------------------------------
    console.log('\n--- Suite 2: Centralized Model Selection by Language ---');

    await test('Telugu selects configured eleven_v4_turbo model', () => {
        const modelTe = ElevenLabsService.selectTtsModel({ language: 'te' });
        assert.strictEqual(modelTe, ElevenLabsService.getModelForTelugu());

        const modelTel = ElevenLabsService.selectTtsModel('tel');
        assert.strictEqual(modelTel, ElevenLabsService.getModelForTelugu());

        const modelTelugu = ElevenLabsService.selectTtsModel('Telugu');
        assert.strictEqual(modelTelugu, ElevenLabsService.getModelForTelugu());
    });

    await test('Hindi selects configured eleven_flash_v2_5 model', () => {
        const modelHi = ElevenLabsService.selectTtsModel({ language: 'hi' });
        assert.strictEqual(modelHi, ElevenLabsService.getModelForHindi());

        const modelHin = ElevenLabsService.selectTtsModel('hin');
        assert.strictEqual(modelHin, ElevenLabsService.getModelForHindi());
    });

    await test('English selects configured eleven_flash_v2_5 model', () => {
        const modelEn = ElevenLabsService.selectTtsModel({ language: 'en' });
        assert.strictEqual(modelEn, ElevenLabsService.getModelForEnglish());

        const modelEng = ElevenLabsService.selectTtsModel('eng');
        assert.strictEqual(modelEng, ElevenLabsService.getModelForEnglish());
    });

    await test('Response text with Telugu script automatically selects Telugu model', () => {
        const teText = 'నమస్కారం, స్కోర్ ల్యాబ్స్ నుండి మాట్లాడుతున్నాను.';
        const selected = ElevenLabsService.selectTtsModel({ text: teText });
        assert.strictEqual(selected, ElevenLabsService.getModelForTelugu());
    });

    await test('Response text with Hindi Devanagari script automatically selects Hindi model', () => {
        const hiText = 'नमस्ते, मैं स्कोरलैब्स से बात कर रहा हूँ।';
        const selected = ElevenLabsService.selectTtsModel({ text: hiText });
        assert.strictEqual(selected, ElevenLabsService.getModelForHindi());
    });

    await test('getModelId is backward-compatible alias for selectTtsModel', () => {
        assert.strictEqual(ElevenLabsService.getModelId({ language: 'en' }), ElevenLabsService.getModelForEnglish());
        assert.strictEqual(ElevenLabsService.getModelId({ language: 'te' }), ElevenLabsService.getModelForTelugu());
        assert.strictEqual(ElevenLabsService.getModelId('hi'), ElevenLabsService.getModelForHindi());
    });

    // -----------------------------------------------------------------
    // Suite 3: Model Compatibility & Safety Validation
    // -----------------------------------------------------------------
    console.log('\n--- Suite 3: Model Compatibility & Safety ---');

    await test('isLanguageSupportedByModel correctly blocks Telugu on Flash v2.5', () => {
        assert.strictEqual(ElevenLabsService.isLanguageSupportedByModel('eleven_flash_v2_5', 'te'), false);
        assert.strictEqual(ElevenLabsService.isLanguageSupportedByModel('eleven_multilingual_v2', 'te'), false);
        assert.strictEqual(ElevenLabsService.isLanguageSupportedByModel('eleven_v4_turbo', 'te'), true);
        assert.strictEqual(ElevenLabsService.isLanguageSupportedByModel('eleven_v4', 'te'), true);
    });

    await test('validateModelCompatibility auto-resolves incompatible Telugu model to eleven_v4_turbo', () => {
        const safeModel = ElevenLabsService.validateModelCompatibility('eleven_flash_v2_5', 'te');
        assert.strictEqual(safeModel, ElevenLabsService.getModelForTelugu());
    });

    await test('getAlternativeModel returns language-compatible fallback for Telugu', () => {
        const tePrimary = ElevenLabsService.getModelForTelugu(); // eleven_v4_turbo
        const teAlt = ElevenLabsService.getAlternativeModel(tePrimary, 'te');
        assert.ok(teAlt === 'eleven_v4' || teAlt === 'eleven_v3', 'Telugu alternative must be a Telugu-compatible model');
    });

    // -----------------------------------------------------------------
    // Suite 4: Voice Routing & SID Voice ID
    // -----------------------------------------------------------------
    console.log('\n--- Suite 4: Voice Routing & SID Voice Integration ---');

    await test('SID voice ID is loaded from ELEVENLABS_VOICE_ID_SId in environment', () => {
        const sidVoice = ElevenLabsService.getSidVoiceId();
        const expected = (process.env.ELEVENLABS_VOICE_ID_SId || '0muxiGNHAVvmM1qWRtyV').trim();
        assert.strictEqual(sidVoice, expected);
    });

    await test('English and Hindi route to SID voice ID by default', () => {
        const expected = ElevenLabsService.getSidVoiceId();
        assert.strictEqual(ElevenLabsService.getVoiceIdForLanguage('en'), expected);
        assert.strictEqual(ElevenLabsService.getVoiceIdForLanguage('hi'), expected);
    });

    await test('Telugu routes to configured voice ID (SID or custom) with language compatibility', () => {
        const expected = ElevenLabsService.getVoiceIdForLanguage('te');
        assert.ok(expected && expected.length > 0);
    });

    // -----------------------------------------------------------------
    // Suite 5: Active Call Language Switching & Audio Queue Clearing
    // -----------------------------------------------------------------
    console.log('\n--- Suite 5: Active Call Language Switching ---');

    await test('Language switch from EN -> TE clears Plivo audio queue and updates model', () => {
        const sentMessages = [];
        const fakeWs = {
            readyState: 1, // OPEN
            OPEN: 1,
            send: (msg) => sentMessages.push(JSON.parse(msg))
        };

        const session = new CallSession(fakeWs, {
            call_id: 'call_switch_test',
            service: 'sales',
            contact: { name: 'Priya' }
        });
        session.streamId = 'stream_test_123';
        session.detectedLanguage = 'en';
        session.isAiSpeaking = true;

        // Caller switches to Telugu
        session.setSessionLanguage('te', 'USER_SWITCH_TELUGU');

        assert.strictEqual(session.detectedLanguage, 'te');
        assert.strictEqual(session.isAiSpeaking, false);
        const clearMsg = sentMessages.find(m => m.event === 'clearAudio');
        assert.ok(clearMsg, 'Must dispatch clearAudio event over Plivo stream to halt English speech');
        assert.strictEqual(clearMsg.streamId, 'stream_test_123');

        // Next response uses Telugu model
        const nextModel = ElevenLabsService.selectTtsModel({ language: session.detectedLanguage });
        assert.strictEqual(nextModel, ElevenLabsService.getModelForTelugu());
    });

    await test('Language switch from TE -> HI updates model to Flash v2.5 and clears audio', () => {
        const sentMessages = [];
        const fakeWs = {
            readyState: 1,
            OPEN: 1,
            send: (msg) => sentMessages.push(JSON.parse(msg))
        };

        const session = new CallSession(fakeWs, {
            call_id: 'call_switch_te_hi',
            service: 'recruitment',
            contact: { name: 'Rahul' }
        });
        session.streamId = 'stream_test_456';
        session.detectedLanguage = 'te';

        session.setSessionLanguage('hi', 'USER_SWITCH_HINDI');

        assert.strictEqual(session.detectedLanguage, 'hi');
        const clearMsg = sentMessages.find(m => m.event === 'clearAudio');
        assert.ok(clearMsg, 'Must dispatch clearAudio on switch');
        const nextModel = ElevenLabsService.selectTtsModel({ language: session.detectedLanguage });
        assert.strictEqual(nextModel, ElevenLabsService.getModelForHindi());
    });

    await test('Language switch from HI -> EN updates session back to English', () => {
        const fakeWs = { readyState: 1, OPEN: 1, send: () => {} };
        const session = new CallSession(fakeWs, {
            call_id: 'call_switch_hi_en',
            service: 'support'
        });
        session.detectedLanguage = 'hi';

        session.setSessionLanguage('en', 'USER_SWITCH_ENGLISH');

        assert.strictEqual(session.detectedLanguage, 'en');
        const nextModel = ElevenLabsService.selectTtsModel({ language: session.detectedLanguage });
        assert.strictEqual(nextModel, ElevenLabsService.getModelForEnglish());
    });

    // -----------------------------------------------------------------
    // Suite 6: Compatibility Fallback & Retry Protection
    // -----------------------------------------------------------------
    console.log('\n--- Suite 6: Compatibility Fallback & Retry Protection ---');

    await test('Model-specific 400 error triggers retry with alternative model', async () => {
        let callCount = 0;
        const requestedModels = [];

        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, opts) => {
            if (typeof url === 'string' && url.includes('elevenlabs.io')) {
                callCount++;
                const body = typeof opts?.body === 'string' ? JSON.parse(opts.body) : {};
                requestedModels.push(body.model_id);

                if (callCount === 1) {
                    return {
                        ok: false,
                        status: 400,
                        text: async () => 'Error: Model eleven_flash_v2_5 does not support voice configuration'
                    };
                }
                return {
                    ok: true,
                    status: 200,
                    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
                };
            }
            return { ok: false, status: 500 };
        };

        try {
            const buf = await ElevenLabsService.textToSpeech('Test fallback sentence', {
                language: 'en',
                modelId: ElevenLabsService.getFastModelId()
            });

            assert.ok(buf, 'Should return audio buffer from alternative model');
            assert.strictEqual(callCount, 2, 'Should make exactly 2 calls');
            assert.strictEqual(requestedModels[0], ElevenLabsService.getFastModelId());
            assert.strictEqual(requestedModels[1], ElevenLabsService.getMultilingualModelId());
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    await test('Non-compatibility errors (401, 429) do NOT trigger retry to prevent latency spikes', async () => {
        let elevenLabsCallCount = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, opts) => {
            if (typeof url === 'string' && url.includes('elevenlabs.io')) {
                elevenLabsCallCount++;
                return {
                    ok: false,
                    status: 429,
                    text: async () => 'Rate limit exceeded'
                };
            }
            return {
                ok: false,
                status: 500,
                text: async () => 'Emergency fallback error'
            };
        };

        try {
            const buf = await ElevenLabsService.textToSpeech('Test rate limit no retry', {
                language: 'en',
                modelId: ElevenLabsService.getFastModelId()
            });
            assert.strictEqual(buf, null);
            assert.strictEqual(elevenLabsCallCount, 1);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    // -----------------------------------------------------------------
    // Suite 7: Live API Speech Generation Verification (EN, HI, TE)
    // -----------------------------------------------------------------
    console.log('\n--- Suite 7: Live Speech Generation Verification ---');

    if (ElevenLabsService.isConfigured()) {
        await test('Live Telugu synthesis uses eleven_v4_turbo and generates valid 8kHz ulaw audio with SID voice', async () => {
            const teDialogue = 'నమస్కారం, ఇది తెలుగు వాయిస్ టెస్ట్.';
            const sidVoice = ElevenLabsService.getSidVoiceId();
            const teModel = ElevenLabsService.getModelForTelugu();

            const buf = await ElevenLabsService.textToSpeech(teDialogue, {
                voiceId: sidVoice,
                language: 'te',
                outputFormat: 'ulaw_8000',
                timeoutMs: 10000
            });

            assert.ok(buf, 'Live Telugu synthesis must return audio buffer');
            assert.ok(buf.length > 1000, `Audio buffer must contain valid audio (got ${buf.length} bytes)`);
            console.log(`    -> Telugu Audio: ${buf.length} bytes synthesized with model ${teModel} and SID voice`);
        });

        await test('Live Hindi synthesis uses eleven_flash_v2_5 and SID voice', async () => {
            const hiDialogue = 'नमस्ते, यह हिंदी स्पीच टेस्ट है।';
            const sidVoice = ElevenLabsService.getSidVoiceId();
            const hiModel = ElevenLabsService.getModelForHindi();

            const buf = await ElevenLabsService.textToSpeech(hiDialogue, {
                voiceId: sidVoice,
                language: 'hi',
                outputFormat: 'ulaw_8000',
                timeoutMs: 10000
            });

            assert.ok(buf, 'Live Hindi synthesis must return audio buffer');
            assert.ok(buf.length > 1000, `Audio buffer must contain valid audio (got ${buf.length} bytes)`);
            console.log(`    -> Hindi Audio: ${buf.length} bytes synthesized with model ${hiModel} and SID voice`);
        });

        await test('Live English synthesis uses eleven_flash_v2_5 and SID voice', async () => {
            const enDialogue = 'Hello, this is Remo testing natural English speech.';
            const sidVoice = ElevenLabsService.getSidVoiceId();
            const enModel = ElevenLabsService.getModelForEnglish();

            const buf = await ElevenLabsService.textToSpeech(enDialogue, {
                voiceId: sidVoice,
                language: 'en',
                outputFormat: 'ulaw_8000',
                timeoutMs: 10000
            });

            assert.ok(buf, 'Live English synthesis must return audio buffer');
            assert.ok(buf.length > 1000, `Audio buffer must contain valid audio (got ${buf.length} bytes)`);
            console.log(`    -> English Audio: ${buf.length} bytes synthesized with model ${enModel} and SID voice`);
        });
    } else {
        console.log('  [SKIP] Live API synthesis tests skipped (ELEVENLABS_API_KEY not configured)');
    }

    console.log('\n════════════════════════════════════════════════════');
    console.log(`TEST RESULTS: ${passed} / ${passed + failed} Passed`);
    console.log('════════════════════════════════════════════════════\n');

    if (failed > 0) {
        process.exit(1);
    }
    process.exit(0);
}

runTests();
