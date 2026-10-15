/**
 * tests/tts_model_selection_and_fallback.test.js
 * 
 * Comprehensive test suite verifying:
 * 1. Dual ElevenLabs model configuration (ELEVENLABS_FAST_MODEL_ID & ELEVENLABS_MULTILINGUAL_MODEL_ID)
 * 2. Centralized model selection for English, Hindi, and Telugu
 * 3. Preference overrides and custom model overrides
 * 4. Automatic compatibility fallback on model-specific 400/422 errors
 * 5. Prevention of unnecessary retries on 401, 429, or timeouts
 * 6. In-memory caching and voice routing preservation
 */

import assert from 'assert';
import ElevenLabsService from '../services/elevenlabs_service.js';

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
    console.log('ELEVENLABS DUAL TTS MODEL & FALLBACK TEST SUITE');
    console.log('====================================================\n');

    // -----------------------------------------------------------------
    // Suite 1: Environment & Model Getters
    // -----------------------------------------------------------------
    console.log('--- Suite 1: Environment Model Resolution ---');

    await test('getFastModelId returns configured or default fast model', () => {
        const fast = ElevenLabsService.getFastModelId();
        assert.ok(fast, 'Fast model ID must not be empty');
        assert.strictEqual(fast, process.env.ELEVENLABS_FAST_MODEL_ID || 'eleven_flash_v2_5');
    });

    await test('getMultilingualModelId returns configured or default multilingual model', () => {
        const multi = ElevenLabsService.getMultilingualModelId();
        assert.ok(multi, 'Multilingual model ID must not be empty');
        assert.strictEqual(multi, process.env.ELEVENLABS_MULTILINGUAL_MODEL_ID || process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2');
    });

    await test('getAlternativeModel returns complementary model', () => {
        const fast = ElevenLabsService.getFastModelId();
        const multi = ElevenLabsService.getMultilingualModelId();

        assert.strictEqual(ElevenLabsService.getAlternativeModel(fast), multi);
        assert.strictEqual(ElevenLabsService.getAlternativeModel(multi), fast);
    });

    // -----------------------------------------------------------------
    // Suite 2: Centralized Model Selection (selectTtsModel)
    // -----------------------------------------------------------------
    console.log('\n--- Suite 2: Centralized Model Selection ---');

    await test('English selects Flash v2.5 by default for low latency', () => {
        const modelEn = ElevenLabsService.selectTtsModel({ language: 'en' });
        assert.strictEqual(modelEn, ElevenLabsService.getFastModelId());

        const modelEng = ElevenLabsService.selectTtsModel('eng');
        assert.strictEqual(modelEng, ElevenLabsService.getFastModelId());

        const modelEnglish = ElevenLabsService.selectTtsModel('English');
        assert.strictEqual(modelEnglish, ElevenLabsService.getFastModelId());
    });

    await test('Hindi selects Flash v2.5 by default for verified fast synthesis', () => {
        const modelHi = ElevenLabsService.selectTtsModel({ language: 'hi' });
        assert.strictEqual(modelHi, ElevenLabsService.getFastModelId());

        const modelHin = ElevenLabsService.selectTtsModel('hin');
        assert.strictEqual(modelHin, ElevenLabsService.getFastModelId());
    });

    await test('Telugu selects Multilingual v2 for proven script fidelity', () => {
        const modelTe = ElevenLabsService.selectTtsModel({ language: 'te' });
        assert.strictEqual(modelTe, ElevenLabsService.getMultilingualModelId());

        const modelTel = ElevenLabsService.selectTtsModel('tel');
        assert.strictEqual(modelTel, ElevenLabsService.getMultilingualModelId());

        const modelTelugu = ElevenLabsService.selectTtsModel('Telugu');
        assert.strictEqual(modelTelugu, ElevenLabsService.getMultilingualModelId());
    });

    await test('getModelId is backward-compatible alias for selectTtsModel', () => {
        assert.strictEqual(ElevenLabsService.getModelId({ language: 'en' }), ElevenLabsService.getFastModelId());
        assert.strictEqual(ElevenLabsService.getModelId({ language: 'te' }), ElevenLabsService.getMultilingualModelId());
        assert.strictEqual(ElevenLabsService.getModelId('hi'), ElevenLabsService.getFastModelId());
    });

    // -----------------------------------------------------------------
    // Suite 3: Configurable Preferences & Overrides
    // -----------------------------------------------------------------
    console.log('\n--- Suite 3: Configurable Preferences & Overrides ---');

    await test('Explicit preferModel: multilingual forces multilingual for English/Hindi', () => {
        const model = ElevenLabsService.selectTtsModel({ language: 'en', preferModel: 'multilingual' });
        assert.strictEqual(model, ElevenLabsService.getMultilingualModelId());

        const modelHi = ElevenLabsService.selectTtsModel({ language: 'hi', preferModel: 'multilingual' });
        assert.strictEqual(modelHi, ElevenLabsService.getMultilingualModelId());
    });

    await test('Explicit preferModel: fast forces fast model for Telugu', () => {
        const model = ElevenLabsService.selectTtsModel({ language: 'te', preferModel: 'fast' });
        assert.strictEqual(model, ElevenLabsService.getFastModelId());
    });

    await test('overrideModel parameter overrides all defaults and preferences', () => {
        const custom = 'eleven_v4_turbo';
        const model = ElevenLabsService.selectTtsModel({ language: 'te', overrideModel: custom });
        assert.strictEqual(model, custom);
    });

    // -----------------------------------------------------------------
    // Suite 4: Voice Routing Preservation
    // -----------------------------------------------------------------
    console.log('\n--- Suite 4: Voice Routing Preservation ---');

    await test('Telugu routes to configured Chaitra voice ID', () => {
        const voiceId = ElevenLabsService.getVoiceIdForLanguage('te');
        const expected = (process.env.ELEVENLABS_VOICE_ID_CHAITRA || 'oyjIr5XAhIyRjfNq6spl').trim();
        assert.strictEqual(voiceId, expected);
    });

    await test('English and Hindi route to configured Pari voice ID', () => {
        const expected = (process.env.ELEVENLABS_VOICE_ID_PARI || '06llJPvI62CjqSWOX9Gp').trim();
        assert.strictEqual(ElevenLabsService.getVoiceIdForLanguage('en'), expected);
        assert.strictEqual(ElevenLabsService.getVoiceIdForLanguage('hi'), expected);
    });

    // -----------------------------------------------------------------
    // Suite 5: In-Memory Caching with Model-Aware Keys
    // -----------------------------------------------------------------
    console.log('\n--- Suite 5: Model-Aware Audio Caching ---');

    await test('Cached audio distinguishes between fast and multilingual models', () => {
        const text = 'Test cached greeting turn';
        const voiceId = '06llJPvI62CjqSWOX9Gp';
        const fastModel = ElevenLabsService.getFastModelId();
        const multiModel = ElevenLabsService.getMultilingualModelId();

        const fakeFastBuffer = Buffer.from('FAST_AUDIO_BUFFER');
        const fakeMultiBuffer = Buffer.from('MULTI_AUDIO_BUFFER');

        ElevenLabsService.precacheAudio(text, fakeFastBuffer, { voiceId, modelId: fastModel });
        ElevenLabsService.precacheAudio(text, fakeMultiBuffer, { voiceId, modelId: multiModel });

        const cachedFast = ElevenLabsService.getCachedAudio(text, { voiceId, modelId: fastModel });
        const cachedMulti = ElevenLabsService.getCachedAudio(text, { voiceId, modelId: multiModel });

        assert.strictEqual(cachedFast.toString(), 'FAST_AUDIO_BUFFER');
        assert.strictEqual(cachedMulti.toString(), 'MULTI_AUDIO_BUFFER');
    });

    // -----------------------------------------------------------------
    // Suite 6: Compatibility Fallback Logic
    // -----------------------------------------------------------------
    console.log('\n--- Suite 6: Compatibility Fallback & Retry Protection ---');

    await test('Model-specific 400 error triggers retry with alternative model', async () => {
        let callCount = 0;
        const requestedModels = [];

        // Temporarily intercept fetch to test fallback behavior
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, opts) => {
            callCount++;
            const body = JSON.parse(opts.body);
            requestedModels.push(body.model_id);

            // First call fails with model compatibility error
            if (callCount === 1) {
                return {
                    ok: false,
                    status: 400,
                    text: async () => 'Error: Model eleven_flash_v2_5 does not support voice configuration'
                };
            }
            // Fallback retry succeeds
            return {
                ok: true,
                status: 200,
                arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
            };
        };

        try {
            const buf = await ElevenLabsService.textToSpeech('Test fallback sentence', {
                language: 'en',
                modelId: ElevenLabsService.getFastModelId()
            });

            assert.ok(buf, 'Should return audio buffer from alternative model');
            assert.strictEqual(callCount, 2, 'Should make exactly 2 calls (primary + retry)');
            assert.strictEqual(requestedModels[0], ElevenLabsService.getFastModelId(), 'First attempt should use fast model');
            assert.strictEqual(requestedModels[1], ElevenLabsService.getMultilingualModelId(), 'Second attempt should use multilingual fallback');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    await test('Non-compatibility errors (401, 429) do NOT trigger retry to prevent latency spikes', async () => {
        let callCount = 0;

        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => {
            callCount++;
            return {
                ok: false,
                status: 429,
                text: async () => 'Rate limit exceeded'
            };
        };

        try {
            const buf = await ElevenLabsService.textToSpeech('Test rate limit no retry', {
                language: 'en',
                modelId: ElevenLabsService.getFastModelId()
            });

            assert.strictEqual(buf, null, 'Should return null on rate limit');
            assert.strictEqual(callCount, 1, 'Should NOT perform serial retry on 429 rate limit');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    await test('Network timeouts (AbortError) do NOT trigger retry to prevent call stalls', async () => {
        let callCount = 0;

        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => {
            callCount++;
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
        };

        try {
            const buf = await ElevenLabsService.textToSpeech('Test timeout no retry', {
                language: 'en',
                timeoutMs: 50
            });

            assert.strictEqual(buf, null);
            assert.strictEqual(callCount, 1, 'Should NOT perform serial retry on timeout');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    console.log('\n════════════════════════════════════════════════════');
    console.log(`TEST RESULTS: ${passed} / ${passed + failed} Passed`);
    console.log('════════════════════════════════════════════════════\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
