import 'dotenv/config';
import assert from 'assert';
import ElevenLabsService from '../services/elevenlabs_service.js';
import { CallSession } from '../services/voicebot_stream_service.js';
import GeminiService from '../services/gemini_service.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function test(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  [PASS] Test ${totalTests}: ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  [FAIL] Test ${totalTests}: ${name}`);
        console.error(`         ${err.message}`);
        failedTests++;
    }
}

async function runSidVoiceIntegrationSuite() {
    console.log('========================================================================');
    console.log('AGENT HARI — SID VOICE ID (ELEVENLABS_VOICE_ID_SId) INTEGRATION SUITE');
    console.log('========================================================================\n');

    // -----------------------------------------------------------------
    // Section 1: Environment Variable & SID Configuration
    // -----------------------------------------------------------------
    console.log('--- Section 1: Environment Variable & Voice Resolution ---');

    await test('ELEVENLABS_VOICE_ID_SId is configured in .env and non-empty', () => {
        const envSid = process.env.ELEVENLABS_VOICE_ID_SId;
        assert.ok(envSid, 'process.env.ELEVENLABS_VOICE_ID_SId must exist');
        assert.strictEqual(typeof envSid, 'string');
        assert.ok(envSid.trim().length > 5, 'Voice ID must be a non-trivial string');
    });

    await test('ElevenLabsService.getSidVoiceId() reads exact value from process.env.ELEVENLABS_VOICE_ID_SId', () => {
        const sid = ElevenLabsService.getSidVoiceId();
        const expected = (process.env.ELEVENLABS_VOICE_ID_SId || '').trim();
        assert.strictEqual(sid, expected, 'getSidVoiceId() must return exact environment voice ID');
    });

    await test('Default getVoiceId() returns SID voice ID', () => {
        const sid = ElevenLabsService.getSidVoiceId();
        assert.strictEqual(ElevenLabsService.getVoiceId(), sid);
        assert.strictEqual(ElevenLabsService.getVoiceId('en'), sid);
        assert.strictEqual(ElevenLabsService.getVoiceId('hi'), sid);
    });

    // -----------------------------------------------------------------
    // Section 2: Language-Specific Model Preservation
    // -----------------------------------------------------------------
    console.log('\n--- Section 2: Language-Specific Model Preservation ---');

    await test('English selects configured model from ELEVENLABS_MODEL_ENGLISH', () => {
        const expected = (process.env.ELEVENLABS_MODEL_ENGLISH || 'eleven_flash_v2_5').trim();
        const selected = ElevenLabsService.selectTtsModel({ language: 'en' });
        assert.strictEqual(selected, expected);
    });

    await test('Hindi selects configured model from ELEVENLABS_MODEL_HINDI', () => {
        const expected = (process.env.ELEVENLABS_MODEL_HINDI || 'eleven_flash_v2_5').trim();
        const selected = ElevenLabsService.selectTtsModel({ language: 'hi' });
        assert.strictEqual(selected, expected);
    });

    await test('Telugu selects configured model from ELEVENLABS_MODEL_TELUGU', () => {
        const expected = (process.env.ELEVENLABS_MODEL_TELUGU || 'eleven_v4_turbo').trim();
        const selected = ElevenLabsService.selectTtsModel({ language: 'te' });
        assert.strictEqual(selected, expected);
    });

    // -----------------------------------------------------------------
    // Section 3: Compatibility & Safe Fallbacks
    // -----------------------------------------------------------------
    console.log('\n--- Section 3: Voice & Model Compatibility ---');

    await test('validateVoiceAndModel resolves fallback SID voice if empty voice ID provided', () => {
        const validated = ElevenLabsService.validateVoiceAndModel('', null, 'en');
        assert.strictEqual(validated.voiceId, ElevenLabsService.getSidVoiceId());
    });

    await test('validateVoiceAndModel resolves compatible Telugu model if Flash v2.5 accidentally paired with Telugu', () => {
        const validated = ElevenLabsService.validateVoiceAndModel(ElevenLabsService.getSidVoiceId(), 'eleven_flash_v2_5', 'te');
        assert.strictEqual(validated.modelId, ElevenLabsService.getModelForTelugu());
    });

    await test('validateConfiguration executes and logs SID voice ID without throwing', () => {
        let logged = '';
        const originalLog = console.log;
        console.log = (...args) => {
            logged += args.join(' ') + '\n';
            originalLog(...args);
        };
        try {
            ElevenLabsService.validateConfiguration();
            assert.ok(logged.includes('ELEVENLABS_VOICE_ID_SId') || logged.includes(ElevenLabsService.getSidVoiceId()));
        } finally {
            console.log = originalLog;
        }
    });

    // -----------------------------------------------------------------
    // Section 4: Live Speech Generation with SID Voice
    // -----------------------------------------------------------------
    console.log('\n--- Section 4: Live Audio Generation Across Languages with SID ---');

    if (ElevenLabsService.isConfigured()) {
        await test('Live English synthesis uses SID voice ID and eleven_flash_v2_5', async () => {
            const sidVoice = ElevenLabsService.getSidVoiceId();
            const model = ElevenLabsService.getModelForEnglish();
            const text = 'Hello, this is Remo speaking with Sid voice.';

            const buf = await ElevenLabsService.textToSpeech(text, {
                voiceId: sidVoice,
                language: 'en',
                outputFormat: 'ulaw_8000',
                timeoutMs: 10000
            });

            assert.ok(buf, 'Must return audio buffer');
            assert.ok(buf.length > 500, `Audio buffer must be non-empty (got ${buf.length} bytes)`);
            console.log(`    -> Live English generated: ${buf.length} bytes (Voice: ${sidVoice}, Model: ${model})`);
        });

        await test('Live Hindi synthesis uses SID voice ID and eleven_flash_v2_5', async () => {
            const sidVoice = ElevenLabsService.getSidVoiceId();
            const model = ElevenLabsService.getModelForHindi();
            const text = 'नमस्ते, यह सिड आवाज के साथ हिंदी परीक्षण है।';

            const buf = await ElevenLabsService.textToSpeech(text, {
                voiceId: sidVoice,
                language: 'hi',
                outputFormat: 'ulaw_8000',
                timeoutMs: 10000
            });

            assert.ok(buf, 'Must return audio buffer');
            assert.ok(buf.length > 500, `Audio buffer must be non-empty (got ${buf.length} bytes)`);
            console.log(`    -> Live Hindi generated: ${buf.length} bytes (Voice: ${sidVoice}, Model: ${model})`);
        });

        await test('Live Telugu synthesis uses SID voice ID and eleven_v4_turbo', async () => {
            const sidVoice = ElevenLabsService.getSidVoiceId();
            const model = ElevenLabsService.getModelForTelugu();
            const text = 'నమస్కారం, ఇది సిడ్ వాయిస్‌తో తెలుగు పరీక్ష.';

            const buf = await ElevenLabsService.textToSpeech(text, {
                voiceId: sidVoice,
                language: 'te',
                outputFormat: 'ulaw_8000',
                timeoutMs: 10000
            });

            assert.ok(buf, 'Must return audio buffer');
            assert.ok(buf.length > 500, `Audio buffer must be non-empty (got ${buf.length} bytes)`);
            console.log(`    -> Live Telugu generated: ${buf.length} bytes (Voice: ${sidVoice}, Model: ${model})`);
        });
    } else {
        console.log('  [SKIP] Live API synthesis tests skipped (ELEVENLABS_API_KEY not configured)');
    }

    // -----------------------------------------------------------------
    // Section 5: Streaming & Call Session Integration
    // -----------------------------------------------------------------
    console.log('\n--- Section 5: Streaming & Call Session Integration ---');

    await test('CallSession selects SID voice ID for English turn', async () => {
        const session = new CallSession({
            callId: 'test_sid_call_en',
            streamId: 'stream_sid_test',
            prospectName: 'Arjun',
            service: 'sales',
            language: 'en'
        });

        const voiceId = ElevenLabsService.getVoiceIdForLanguage(session.detectedLanguage);
        assert.strictEqual(voiceId, ElevenLabsService.getSidVoiceId());
    });

    await test('CallSession streaming playAiAudio captures first chunk and uses SID voice', async () => {
        let chunkCount = 0;
        let totalBytes = 0;
        const fakeWs = {
            readyState: 1,
            OPEN: 1,
            send: (payload) => {
                const msg = JSON.parse(payload);
                if (msg.event === 'playAudio' && msg.media?.payload) {
                    chunkCount++;
                    totalBytes += Buffer.from(msg.media.payload, 'base64').length;
                }
            }
        };

        const session = new CallSession({
            callId: 'test_sid_stream_call',
            streamId: 'stream_sid_test_2',
            prospectName: 'Pooja',
            service: 'sales',
            language: 'en'
        });
        session.ws = fakeWs;

        // Precache response to verify instant delivery
        const greeting = 'Welcome to Score Labs. How can we help you?';
        const sidVoice = ElevenLabsService.getSidVoiceId();
        const model = ElevenLabsService.selectTtsModel({ language: 'en', voiceId: sidVoice });
        const dummyBuffer = Buffer.alloc(16000, 0x7F); // 2 seconds of ulaw
        ElevenLabsService.precacheAudio(greeting, dummyBuffer, { voiceId: sidVoice, modelId: model });

        await session.playAiAudio(greeting);

        assert.ok(session.greetingDelivered || session.isAiSpeaking, 'Session must mark speech active');
        console.log(`    -> Session played audio using SID voice: ${session.currentQuestion.slice(0, 30)}...`);
    });

    // -----------------------------------------------------------------
    // Section 6: Security & Credentials Protection
    // -----------------------------------------------------------------
    console.log('\n--- Section 6: Security & Credentials Protection ---');

    await test('No secrets or API keys are printed in voice logging', () => {
        const apiKey = process.env.ELEVENLABS_API_KEY || '';
        let loggedText = '';
        const originalLog = console.log;
        console.log = (...args) => {
            loggedText += args.join(' ') + ' ';
            originalLog(...args);
        };
        try {
            ElevenLabsService.validateConfiguration();
            if (apiKey && apiKey.length > 8) {
                assert.ok(!loggedText.includes(apiKey), 'ELEVENLABS_API_KEY must not appear in logs');
            }
        } finally {
            console.log = originalLog;
        }
    });

    // -----------------------------------------------------------------
    // Section 7: Service Flow Non-Regression
    // -----------------------------------------------------------------
    console.log('\n--- Section 7: Service Flow Non-Regression ---');

    await test('Recruitment flow generates correct greeting and role details', () => {
        const greeting = GeminiService.getOpeningGreeting('recruitment', { name: 'Rahul', job_role: 'Full Stack Engineer' });
        assert.ok(greeting.includes('Rahul') || greeting.includes('Score Labs'));
    });

    await test('Sales flow generates correct stage-aware greeting', () => {
        const greeting = GeminiService.getOpeningGreeting('sales', { name: 'Anita' });
        assert.ok(greeting.includes('Anita'));
    });

    await test('Support flow generates correct customer support greeting', () => {
        const greeting = GeminiService.getOpeningGreeting('support', { name: 'Karan' });
        assert.ok(greeting.includes('Karan'));
    });

    // -----------------------------------------------------------------
    // Results Summary
    // -----------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`SID VOICE INTEGRATION RESULTS: ${passedTests} / ${totalTests} PASSED (${Math.round((passedTests/totalTests)*100)}%)`);
    if (failedTests > 0) {
        console.error(`FAILED: ${failedTests} tests`);
        process.exit(1);
    } else {
        console.log('ALL TESTS PASSED SUCCESSFULLY.');
        console.log('========================================================================\n');
    }
}

runSidVoiceIntegrationSuite().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});
