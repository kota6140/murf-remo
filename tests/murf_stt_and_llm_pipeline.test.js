/**
 * tests/murf_stt_and_llm_pipeline.test.js
 *
 * Verifies the 12 required test cases for the Murf STT + TTS, OpenAI Primary, Claude Fallback pipeline:
 * 1. Remo plays opening greeting immediately after connection.
 * 2. Remo correctly transcribes "Yes, this is Anshu." (via Murf STT).
 * 3. OpenAI receives the transcript and returns a response.
 * 4. Murf generates response audio (TTS).
 * 5. Next caller response is captured and processed correctly.
 * 6. OpenAI failure triggers Claude fallback.
 * 7. Claude is not called when OpenAI succeeds.
 * 8. Empty audio does not trigger an LLM request.
 * 9. A transcription timeout does not permanently freeze the session.
 * 10. Duplicate final transcripts do not produce duplicate responses.
 * 11. Campaign instructions and uploaded documents remain available throughout call.
 * 12. Existing recruitment, sales, and customer-support workflows remain intact.
 */

import assert from 'assert';
import MurfService from '../services/murf_service.js';
import { LLMService } from '../services/llm_service.js';
import GeminiService from '../services/gemini_service.js';
import IntentService from '../services/intent_service.js';
import { CallSession, ConversationStates } from '../services/voicebot_stream_service.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function runTestCase(name, fn) {
    totalTests++;
    try {
        await fn();
        passedTests++;
        console.log(`  [PASS] Case ${totalTests}: ${name}`);
    } catch (e) {
        failedTests++;
        console.error(`  [FAIL] Case ${totalTests}: ${name}`);
        console.error(`         ${e.stack || e.message}`);
    }
}

async function main() {
    console.log('================================================================');
    console.log('TEST SUITE: MURF STT + TTS, OPENAI PRIMARY, CLAUDE FALLBACK');
    console.log('================================================================\n');

    // ---------------------------------------------------------------------
    // Case 1: Remo plays opening greeting immediately after connection
    // ---------------------------------------------------------------------
    await runTestCase('Case 1: Remo plays the opening greeting immediately after connection', () => {
        const greeting = GeminiService.getOpeningGreeting('sales', { name: 'Anshu' });
        assert.strictEqual(greeting, 'Hello, am I speaking with Anshu?');

        const greetingAnon = GeminiService.getOpeningGreeting('sales', {});
        assert.strictEqual(greetingAnon, 'Hi, this is Remo calling from Scorelabs. Is now a good time to talk?');
    });

    // ---------------------------------------------------------------------
    // Case 2: Remo correctly transcribes "Yes, this is Anshu."
    // ---------------------------------------------------------------------
    await runTestCase('Case 2: Remo correctly transcribes "Yes, this is Anshu."', async () => {
        const speechAudio = MurfService.getCachedAudio('Yes, this is Anshu.') ||
            await MurfService.textToSpeech('Yes, this is Anshu.', { timeoutMs: 10000 });
        assert.ok(speechAudio && speechAudio.length > 0, 'Murf TTS must generate test audio');

        const sttRes = await MurfService.speechToText(speechAudio, {
            language: 'en',
            codec: 'mulaw',
            sampleRate: 8000
        });
        assert.ok(sttRes && typeof sttRes.transcript === 'string', 'STT must return a transcript');
        const lower = sttRes.transcript.toLowerCase();
        assert.ok(lower.includes('anshu') || lower.includes('yes'), `Transcript must capture utterance: "${sttRes.transcript}"`);
    });

    // ---------------------------------------------------------------------
    // Case 3: OpenAI receives transcript and returns a response
    // ---------------------------------------------------------------------
    await runTestCase('Case 3: OpenAI receives the transcript and returns a response', async () => {
        const reply = await GeminiService.generateReply(
            'sales',
            { name: 'Anshu', company: 'Scorelabs' },
            [{ speaker: 'REMO', text: 'Hello, am I speaking with Anshu?' }],
            'Yes, this is Anshu.',
            {},
            { currentStage: 'GREETING', detectedLanguage: 'en' }
        );
        assert.ok(reply && reply.spoken_response, 'OpenAI must generate a spoken_response');
        assert.strictEqual(reply.provider, 'openai', 'Provider must be openai');
        assert.ok(reply.spoken_response.includes('Remo') || reply.spoken_response.includes('Score') || reply.spoken_response.includes('time to talk'),
            `Expected polite identity follow up, got: "${reply.spoken_response}"`);
    });

    // ---------------------------------------------------------------------
    // Case 4: Murf generates and plays response audio
    // ---------------------------------------------------------------------
    await runTestCase('Case 4: Murf generates response audio (TTS)', async () => {
        const textToSpeak = 'Hi Anshu, this is Remo calling from Scorelabs. Is now a good time to talk?';
        const audio = await MurfService.textToSpeech(textToSpeak, { timeoutMs: 10000 });
        assert.ok(audio && audio.length > 0, 'Murf TTS must return audio buffer');
        const cached = MurfService.getCachedAudio(textToSpeak);
        assert.ok(cached && cached.length === audio.length, 'Murf cache must store synthesized audio for instant replay');
    });

    // ---------------------------------------------------------------------
    // Case 5: Next caller response is captured and processed correctly
    // ---------------------------------------------------------------------
    await runTestCase('Case 5: Next caller response is captured and processed correctly', () => {
        const confirmAvailability = IntentService.matchIntent('Yes, I have a few minutes', {
            service: 'sales',
            stage: 'PERMISSION_CHECK',
            language: 'en'
        });
        assert.strictEqual(confirmAvailability.matched, true);
        assert.strictEqual(confirmAvailability.next_stage, 'INTEREST_DISCOVERY');
        assert.ok(confirmAvailability.spoken_response.includes('IT or digital marketing services'));
    });

    // ---------------------------------------------------------------------
    // Case 6: OpenAI failure triggers Claude fallback
    // ---------------------------------------------------------------------
    await runTestCase('Case 6: OpenAI failure triggers Claude fallback', async () => {
        const origKey = process.env.OPENAI_API_KEY;
        process.env.OPENAI_API_KEY = 'invalid-openai-key-for-test';
        try {
            const res = await LLMService.generate({
                systemPrompt: 'You are an AI assistant. Output JSON with key spoken_response.',
                messages: [{ role: 'user', content: 'Say hello in 4 words' }],
                jsonMode: true,
                maxTokens: 50,
                timeoutMs: 8000
            });
            assert.strictEqual(res.provider, 'claude', 'Must fall back to claude when OpenAI fails');
            assert.strictEqual(res.fallback, true, 'Fallback flag must be true');
            assert.ok(res.text && res.text.length > 0, 'Claude must return a non-empty response');
        } finally {
            process.env.OPENAI_API_KEY = origKey;
        }
    });

    // ---------------------------------------------------------------------
    // Case 7: Claude is not called when OpenAI succeeds
    // ---------------------------------------------------------------------
    await runTestCase('Case 7: Claude is not called when OpenAI succeeds', async () => {
        let claudeCalled = false;
        const origCallClaude = LLMService._callClaude;
        LLMService._callClaude = async () => {
            claudeCalled = true;
            return { text: 'claude response' };
        };

        try {
            const res = await LLMService.generate({
                systemPrompt: 'Say hello',
                messages: [{ role: 'user', content: 'Hello' }],
                maxTokens: 30,
                timeoutMs: 8000
            });
            assert.strictEqual(res.provider, 'openai', 'Must use openai');
            assert.strictEqual(res.fallback, false, 'Must not report fallback');
            assert.strictEqual(claudeCalled, false, 'Claude must not be called when OpenAI succeeds');
        } finally {
            LLMService._callClaude = origCallClaude;
        }
    });

    // ---------------------------------------------------------------------
    // Case 8: Empty audio does not trigger an LLM request
    // ---------------------------------------------------------------------
    await runTestCase('Case 8: Empty audio does not trigger an LLM request', async () => {
        let llmTriggered = false;
        const origGenerateReply = GeminiService.generateReply;
        GeminiService.generateReply = async () => {
            llmTriggered = true;
            return { spoken_response: 'unexpected' };
        };

        try {
            const session = new CallSession('test_call_empty_audio', {
                ws: { send: () => {}, readyState: 1 },
                contact: { name: 'Test' },
                service: 'sales'
            });

            // 100 bytes is below MIN_AUDIO_BYTES (1600 bytes = 200ms)
            session.callerMulawChunks = [Buffer.alloc(100, 0xFF)];
            await session.processCallerTurn();

            assert.strictEqual(llmTriggered, false, 'LLM must NOT be triggered for short/empty audio');
            assert.strictEqual(session.isProcessingTurn, false, 'Must release processing turn lock');
            assert.strictEqual(session.conversationState, ConversationStates.LISTENING, 'Must return to LISTENING');
        } finally {
            GeminiService.generateReply = origGenerateReply;
        }
    });

    // ---------------------------------------------------------------------
    // Case 9: A transcription timeout does not permanently freeze the session
    // ---------------------------------------------------------------------
    await runTestCase('Case 9: A transcription timeout does not permanently freeze the session', async () => {
        const origStt = MurfService.speechToText;
        MurfService.speechToText = async () => {
            return { transcript: '', error: 'TIMEOUT' };
        };

        try {
            const session = new CallSession('test_call_timeout', {
                ws: { send: () => {}, readyState: 1 },
                contact: { name: 'Anshu' },
                service: 'sales'
            });

            // 2000 bytes
            session.callerMulawChunks = [Buffer.alloc(2000, 0xFF)];
            await session.processCallerTurn();

            assert.strictEqual(session.isProcessingTurn, false, 'Session must not be stuck in isProcessingTurn');
            assert.strictEqual(session.conversationState, ConversationStates.LISTENING, 'Session must return to LISTENING state');
        } finally {
            MurfService.speechToText = origStt;
        }
    });

    // ---------------------------------------------------------------------
    // Case 10: Duplicate final transcripts do not produce duplicate responses
    // ---------------------------------------------------------------------
    await runTestCase('Case 10: Duplicate final transcripts do not produce duplicate responses', async () => {
        let speakCount = 0;
        const session = new CallSession('test_call_dedup', {
            ws: { send: () => {}, readyState: 1 },
            contact: { name: 'Anshu' },
            service: 'sales'
        });

        session.playAiAudio = async () => { speakCount++; };

        // Turn 1
        session.callerMulawChunks = [Buffer.alloc(3000, 0x10)];
        const origStt = MurfService.speechToText;
        MurfService.speechToText = async () => ({ transcript: 'Yes this is Anshu' });

        try {
            await session.processCallerTurn();
            const initialSpeaks = speakCount;
            assert.ok(initialSpeaks > 0, 'First turn must trigger speech');

            // Turn 2 with same transcript while activeResponse is active
            session.callerMulawChunks = [Buffer.alloc(3000, 0x10)];
            await session.processCallerTurn();

            assert.strictEqual(speakCount, initialSpeaks, 'Duplicate turn within window must NOT produce duplicate response');
        } finally {
            MurfService.speechToText = origStt;
        }
    });

    // ---------------------------------------------------------------------
    // Case 11: Campaign instructions and uploaded documents remain available throughout call
    // ---------------------------------------------------------------------
    await runTestCase('Case 11: Campaign instructions and uploaded documents remain available', () => {
        const customCampaign = {
            company_name: 'TechFin Solutions',
            product_name: 'Automated Invoicing Engine',
            key_features: ['ERP Sync', 'Tax Automation', 'Payment Reminders']
        };

        const session = new CallSession('test_call_campaign_ctx', {
            ws: { send: () => {}, readyState: 1 },
            contact: { name: 'Vikram', company: 'TechFin Solutions' },
            campaignContext: customCampaign,
            service: 'sales'
        });

        assert.ok(session.campaignContext, 'Campaign context must be attached');
        assert.strictEqual(session.campaignContext.company_name, 'TechFin Solutions');
        assert.strictEqual(session.campaignContext.product_name, 'Automated Invoicing Engine');

        const greeting = GeminiService.getOpeningGreeting('sales', {
            name: 'Vikram',
            campaignContext: session.campaignContext
        });
        assert.strictEqual(greeting, 'Hello, am I speaking with Vikram?');
    });

    // ---------------------------------------------------------------------
    // Case 12: Existing recruitment, sales, and customer-support workflows remain intact
    // ---------------------------------------------------------------------
    await runTestCase('Case 12: Existing recruitment, sales, and customer-support workflows remain intact', () => {
        // 1. Sales
        const salesOpening = GeminiService.getOpeningGreeting('sales', { name: 'Priya' });
        assert.strictEqual(salesOpening, 'Hello, am I speaking with Priya?');

        // 2. Recruitment
        const recruitOpening = GeminiService.getOpeningGreeting('recruitment', { name: 'Rohit', role: 'DevOps Lead' });
        assert.strictEqual(recruitOpening, 'Hello, am I speaking with Rohit?');

        // 3. Support
        const supportOpening = GeminiService.getOpeningGreeting('support', {});
        assert.ok(supportOpening.includes('customer support'));
    });

    console.log('\n================================================================');
    console.log(`TEST RUN COMPLETE: Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
    console.log('================================================================');
    if (failedTests > 0) process.exit(1);
    else process.exit(0);
}

main().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
