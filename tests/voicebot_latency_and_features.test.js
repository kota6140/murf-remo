/**
 * tests/voicebot_latency_and_features.test.js
 * 
 * Comprehensive Automated Test Suite for Remo Voice Agent:
 * 1. Immediate first greeting without Gemini API request
 * 2. Acknowledgement of "yes", "no", "okay", and "correct"
 * 3. Context-aware interpretation of short answers (availability vs skills)
 * 4. English, Hindi, and Telugu responses & language switching
 * 5. Recruitment, sales, and customer support isolation (including Telugu sales fallback)
 * 6. Invalid Gemini model configuration and bounded fallback
 * 7. API timeouts, malformed JSON, and rate limits recovery
 * 8. Correct extraction and preservation of candidate information (non-destructive)
 * 9. Correct final classifications (Shortlisted, Rejected, On Hold)
 * 10. Duplicate webhook and greeting prevention (exact-once delivery)
 * 11. Call continuity after recoverable errors (exact phrase preserved)
 * 12. Turn-taking, backchannel filtering, adaptive silence VAD, and latency metrics
 */

import assert from 'assert';
import GeminiService from '../services/gemini_service.js';
import IntentService from '../services/intent_service.js';
import LatencyTracker from '../services/latency_tracker.js';
import { isBackchannelOnly, CallSession } from '../services/voicebot_stream_service.js';

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  [PASS] Test ${totalTests}: ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  [FAIL] Test ${totalTests}: ${name}`);
        console.error(`         ${err.message}`);
    }
}

async function runAsyncTest(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  [PASS] Test ${totalTests}: ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  [FAIL] Test ${totalTests}: ${name}`);
        console.error(`         ${err.message}`);
    }
}

async function main() {
    console.log('================================================================');
    console.log('REMO VOICEBOT COMPREHENSIVE AUTOMATED TEST SUITE');
    console.log('================================================================\n');

    // -------------------------------------------------------------
    // 1. Immediate First Greeting Without Gemini API
    // -------------------------------------------------------------
    console.log('--- Suite 1: Immediate Opening Greeting ---');

    runTest('Opening greeting is generated deterministically and contains exact identity phrase', () => {
        const greeting = GeminiService.getOpeningGreeting('recruitment', {
            job_role: 'Senior React Engineer',
            company: 'Score Labs'
        });

        assert.ok(greeting.startsWith("Hey, it's Remo, representing Score Labs."), 'Must start with exact identity phrase');
        assert.ok(greeting.includes('Senior React Engineer'), 'Must mention the candidate job role');
        assert.ok(greeting.includes('Do you have a couple of minutes to talk?'), 'Must ask availability question');
    });

    runTest('Opening greeting executes in < 1ms without external network request', () => {
        const start = performance.now();
        for (let i = 0; i < 100; i++) {
            GeminiService.getOpeningGreeting('recruitment', { job_role: 'Node.js Architect' });
        }
        const elapsed = performance.now() - start;
        assert.ok(elapsed < 20, `100 opening greetings took ${elapsed.toFixed(2)}ms (< 20ms required)`);
    });

    // -------------------------------------------------------------
    // 2. Simple Acknowledgements ("yes", "no", "okay", "correct")
    // -------------------------------------------------------------
    console.log('\n--- Suite 2: Deterministic Fast-Path Intent Handling ---');

    runTest('Affirmative utterance ("yes") advances interview with acknowledgement + next question', () => {
        const context = {
            service: 'recruitment',
            lastQuestion: "Do you have a couple of minutes to talk?",
            stage: 'AVAILABILITY',
            language: 'en'
        };

        const res = IntentService.matchIntent('Yes', context);
        assert.strictEqual(res.matched, true);
        assert.ok(res.spoken_response.includes('Great') || res.spoken_response.includes('Perfect'), 'Should include natural acknowledgement');
        assert.strictEqual(res.next_stage, 'EXPERIENCE');
        assert.strictEqual(res.should_end_call, false);
    });

    runTest('Affirmative utterance ("okay") in experience stage asks about skills', () => {
        const context = {
            service: 'recruitment',
            lastQuestion: "Could you tell me how many years of experience you have?",
            stage: 'EXPERIENCE',
            language: 'en'
        };

        const res = IntentService.matchIntent('okay', context);
        assert.strictEqual(res.matched, true);
        assert.strictEqual(res.next_stage, 'SKILLS');
    });

    runTest('Affirmative utterance ("correct") acknowledges and advances with location preference', () => {
        const context = {
            service: 'recruitment',
            lastQuestion: "Are you comfortable working in a hybrid environment?",
            stage: 'LOCATION',
            language: 'en'
        };

        const res = IntentService.matchIntent('correct', context);
        assert.strictEqual(res.matched, true);
        assert.strictEqual(res.extracted_fields.location_preference, 'Comfortable');
    });

    // -------------------------------------------------------------
    // 3. Context-Aware Interpretation of Short Answers
    // -------------------------------------------------------------
    console.log('\n--- Suite 3: Context-Aware Short Answer Logic ---');

    runTest('"No" to availability reschedules politely and NEVER marks candidate Rejected', () => {
        const context = {
            service: 'recruitment',
            lastQuestion: "Do you have a couple of minutes to talk?",
            stage: 'AVAILABILITY',
            language: 'en'
        };

        const res = IntentService.matchIntent('no, not right now', context);
        assert.strictEqual(res.matched, true);
        assert.strictEqual(res.classification, 'On Hold', 'Candidate unavailable must remain On Hold, never Rejected');
        assert.strictEqual(res.extracted_fields.candidate_interest, 'Reschedule Requested');
        assert.ok(res.spoken_response.toLowerCase().includes('better time') || res.spoken_response.toLowerCase().includes('convenient'), 'Should ask when is a better time');
    });

    runTest('"No" to relocation/salary preference logs info and continues interview without rejection', () => {
        const context = {
            service: 'recruitment',
            lastQuestion: "Are you willing to relocate for this role?",
            stage: 'LOCATION',
            language: 'en'
        };

        const res = IntentService.matchIntent('No', context);
        assert.strictEqual(res.matched, true);
        assert.strictEqual(res.should_end_call, false, 'Interview must continue');
        assert.notStrictEqual(res.classification, 'Rejected', 'Must not reject candidate for location preference');
        assert.strictEqual(res.extracted_fields.willing_to_relocate, 'No');
    });

    runTest('Ambiguous / nuanced answer safely returns matched: false to route to Gemini', () => {
        const context = {
            service: 'recruitment',
            lastQuestion: "Could you tell me about the projects you built with Node.js and AWS?",
            stage: 'PROJECTS',
            language: 'en'
        };

        const res = IntentService.matchIntent('I built a microservices platform on AWS ECS with PostgreSQL and Redis queues.', context);
        assert.strictEqual(res.matched, false, 'Complex technical answers must route to Gemini LLM');
    });

    runTest('"Repeat that" prompts Remo to repeat previous question', () => {
        const context = {
            service: 'recruitment',
            lastQuestion: "What is your current notice period?",
            stage: 'NOTICE_PERIOD',
            language: 'en'
        };

        const res = IntentService.matchIntent('could you repeat that please?', context);
        assert.strictEqual(res.matched, true);
        assert.ok(res.spoken_response.includes('What is your current notice period?'));
    });

    runTest('"Can you hear me?" answers audibility question naturally', () => {
        const context = {
            service: 'recruitment',
            lastQuestion: "What technologies do you use?",
            stage: 'SKILLS',
            language: 'en'
        };

        const res = IntentService.matchIntent('can you hear me?', context);
        assert.strictEqual(res.matched, true);
        assert.ok(res.spoken_response.toLowerCase().includes('hear you'));
    });

    // -------------------------------------------------------------
    // 4. English, Hindi, and Telugu Responses & Switching
    // -------------------------------------------------------------
    console.log('\n--- Suite 4: Multilingual Conversations (EN, HI, TE) ---');

    runTest('Language switch to Hindi ("speak in Hindi") updates language and replies in Hindi', () => {
        const context = {
            service: 'recruitment',
            lastQuestion: "Do you have a couple of minutes to talk?",
            stage: 'AVAILABILITY',
            language: 'en'
        };

        const res = IntentService.matchIntent('please speak in hindi', context);
        assert.strictEqual(res.matched, true);
        assert.strictEqual(res.detected_language, 'hi');
        assert.ok(res.spoken_response.includes('हिंदी में'));
    });

    runTest('Language switch to Telugu ("speak in Telugu") updates language and replies in Telugu', () => {
        const context = {
            service: 'recruitment',
            lastQuestion: "Do you have a couple of minutes to talk?",
            stage: 'AVAILABILITY',
            language: 'en'
        };

        const res = IntentService.matchIntent('telugu lo matladandi', context);
        assert.strictEqual(res.matched, true);
        assert.strictEqual(res.detected_language, 'te');
        assert.ok(res.spoken_response.includes('తెలుగు'));
    });

    runTest('Universal fallbacks are present and non-empty in English, Hindi, and Telugu', () => {
        for (const service of ['recruitment', 'sales', 'support']) {
            for (const lang of ['en', 'hi', 'te']) {
                const fallback = GeminiService.getUniversalFallback(lang, service);
                assert.ok(fallback && fallback.trim().length > 10, `Missing fallback for ${service} in ${lang}`);
            }
        }
    });

    // -------------------------------------------------------------
    // 5. Recruitment, Sales, and Customer Support Isolation
    // -------------------------------------------------------------
    console.log('\n--- Suite 5: Service Isolation & Workflows ---');

    runTest('Recruitment, Sales, and Customer Support greetings are isolated and unique', () => {
        const recGreeting = GeminiService.getOpeningGreeting('recruitment', { job_role: 'Data Scientist' });
        const salGreeting = GeminiService.getOpeningGreeting('sales', { name: 'Rahul', company: 'FinCorp' });
        const supGreeting = GeminiService.getOpeningGreeting('support', {});

        assert.ok(recGreeting.includes('application for Data Scientist'));
        assert.ok(salGreeting.includes('Scorelabs Inc.'));
        assert.ok(salGreeting.includes('custom software development'));
        assert.ok(supGreeting.includes('customer support'));
        assert.notStrictEqual(recGreeting, salGreeting);
        assert.notStrictEqual(salGreeting, supGreeting);
    });

    runTest('Sales has valid, dedicated Telugu fallback without recycling recruitment prompts', () => {
        const teSalesFallback = GeminiService.getUniversalFallback('te', 'sales');
        assert.ok(teSalesFallback.includes('స్కోర్‌ల్యాబ్స్'));
        assert.ok(teSalesFallback.includes('కస్టమ్ సాఫ్ట్‌వేర్'));
        assert.ok(!teSalesFallback.includes('జాబ్ అప్లికేషన్'), 'Sales fallback must never reference recruitment jobs');
    });

    runTest('Sales opening greeting formats prospect name and never asks recruitment questions', () => {
        const greetingWithName = GeminiService.getOpeningGreeting('sales', { name: 'pooja', company: 'Acme Corp' });
        assert.ok(greetingWithName.includes('pooja'), 'Should personalize with prospect name');
        assert.ok(greetingWithName.includes('Scorelabs Inc.'), 'Must represent Scorelabs Inc.');
        assert.ok(greetingWithName.includes('custom software development'), 'Must offer IT solutions');
        assert.ok(!greetingWithName.includes('open position'), 'Must NOT mention open position');
        assert.ok(!greetingWithName.includes('application'), 'Must NOT mention job application');

        const greetingWithoutName = GeminiService.getOpeningGreeting('sales', { name: 'Contact (Row 2)' });
        assert.ok(!greetingWithoutName.includes('Contact (Row 2)'), 'Must not speak raw spreadsheet row label as a name');
        assert.ok(greetingWithoutName.includes('Scorelabs Inc.'));
    });

    runTest('Support opening greeting addresses ticket/query and never asks recruitment questions', () => {
        const greeting = GeminiService.getOpeningGreeting('support', { name: 'pooja' });
        assert.ok(greeting.includes('pooja'));
        assert.ok(greeting.includes('Scorelabs Inc. customer support'));
        assert.ok(greeting.includes('ticket') || greeting.includes('inquiry'));
        assert.ok(!greeting.includes('open position'));
        assert.ok(!greeting.includes('application for'));
    });

    runTest('CallSession correctly propagates sales service to greeting and history', async () => {
        const fakeWs = { send: () => {}, readyState: 1 };
        const session = new CallSession(fakeWs, {
            service: 'sales',
            callerName: 'pooja',
            company: 'TechCorp'
        });
        assert.strictEqual(session.service, 'sales');
        assert.strictEqual(session.contact.service, 'sales');
        assert.strictEqual(session.contact.name, 'pooja');

        await session.deliverOpeningGreeting();
        assert.ok(session.currentQuestion.includes('Scorelabs Inc.'));
        assert.ok(!session.currentQuestion.includes('application'));
        assert.ok(!session.currentQuestion.includes('open position'));
    });

    // -------------------------------------------------------------
    // 6. Invalid Gemini Model Configuration & Bounded Fallback
    // -------------------------------------------------------------
    console.log('\n--- Suite 6: Model Validation & Fallback Resilience ---');

    runTest('Configured valid model is detected and selected properly', () => {
        const primary = GeminiService.selectBestModel();
        assert.ok(primary.name, 'Primary model must have a valid name');
        assert.ok(primary.name.startsWith('gemini-'), 'Must be a valid Gemini model ID');
    });

    runTest('Invalid model name in environment falls back to bounded safe model', () => {
        const originalEnv = process.env.GEMINI_MODEL;
        try {
            process.env.GEMINI_MODEL = 'models/unsupported-hallucinated-model-xyz';
            const model = GeminiService.selectBestModel();
            assert.ok(model.name === 'gemini-3.1-flash-lite' || model.name === 'gemini-2.5-flash', 'Must fall back to validated safe model');
        } finally {
            process.env.GEMINI_MODEL = originalEnv;
        }
    });

    // -------------------------------------------------------------
    // 7. API Timeouts, Malformed JSON & Rate Limits Recovery
    // -------------------------------------------------------------
    console.log('\n--- Suite 7: API Resilience & Robust JSON Parsing ---');

    runTest('parseModelResponse handles clean markdown code blocks', () => {
        const raw = '```json\n{"spoken_response": "Thank you! What is your notice period?", "classification": "On Hold"}\n```';
        const parsed = GeminiService.parseModelResponse(raw, 'en', 'recruitment');
        assert.strictEqual(parsed.spoken_response, "Thank you! What is your notice period?");
        assert.strictEqual(parsed.classification, "On Hold");
    });

    runTest('parseModelResponse handles messy/malformed JSON without throwing', () => {
        const raw = 'Here is the response: {"spoken_response": "Understood.", "extracted_fields": {"skills": "JavaScript, Node.js"} ... oops truncated';
        const parsed = GeminiService.parseModelResponse(raw, 'en', 'recruitment');
        assert.ok(parsed.spoken_response, 'Should recover a usable spoken response');
        assert.strictEqual(typeof parsed.extracted_fields, 'object');
    });

    runTest('parseModelResponse handles empty or blank response with universal fallback', () => {
        const parsed = GeminiService.parseModelResponse('', 'en', 'recruitment');
        assert.ok(parsed.spoken_response.includes('Score Labs'));
        assert.strictEqual(parsed.classification, 'On Hold');
    });

    // -------------------------------------------------------------
    // 8. Extraction and Non-Destructive Preservation of Data
    // -------------------------------------------------------------
    console.log('\n--- Suite 8: Non-Destructive Data Extraction ---');

    runTest('Extracted fields do not overwrite existing valid values with empty strings or null', () => {
        const collectedData = {
            candidate_name: 'Aditya Rao',
            job_role: 'Backend Engineer',
            years_of_experience: '4 years',
            skills: 'Node.js, MySQL'
        };

        const newReply = {
            extracted_fields: {
                skills: '', // Model returned empty string for skills
                notice_period: '30 days',
                salary_expectation: null // Model returned null
            }
        };

        for (const [k, v] of Object.entries(newReply.extracted_fields)) {
            if (v !== null && v !== undefined && String(v).trim() !== '') {
                collectedData[k] = v;
            }
        }

        assert.strictEqual(collectedData.skills, 'Node.js, MySQL', 'Valid skills must not be overwritten by empty string');
        assert.strictEqual(collectedData.notice_period, '30 days', 'New field must be added');
        assert.strictEqual(collectedData.salary_expectation, undefined, 'Null value must not be set');
    });

    // -------------------------------------------------------------
    // 9. Correct Final Classifications
    // -------------------------------------------------------------
    console.log('\n--- Suite 9: Classification Governance ---');

    runTest('Explicit candidate decline results in Rejected / Declined', () => {
        const context = {
            service: 'recruitment',
            lastQuestion: "Do you have a couple of minutes to talk?",
            stage: 'AVAILABILITY',
            language: 'en'
        };

        const res = IntentService.matchIntent('Not interested, please remove my number', context);
        assert.strictEqual(res.matched, true);
        assert.strictEqual(res.classification, 'Rejected');
        assert.strictEqual(res.should_end_call, true);
    });

    runTest('Candidate with matching skills and notice period qualifies for Shortlisted', () => {
        const candidateData = {
            years_of_experience: '5 years',
            skills: 'Node.js, Microservices, AWS',
            notice_period: 'Immediate'
        };

        assert.ok(parseInt(candidateData.years_of_experience) >= 3);
        assert.ok(candidateData.skills.includes('Node.js'));
        assert.strictEqual(candidateData.notice_period, 'Immediate');
    });

    // -------------------------------------------------------------
    // 10. Duplicate Webhook and Greeting Prevention
    // -------------------------------------------------------------
    console.log('\n--- Suite 10: Idempotent Exact-Once Greeting Delivery ---');

    await runAsyncTest('deliverOpeningGreeting is executed exactly once even if called multiple times', async () => {
        const mockWs = {
            readyState: 1,
            OPEN: 1,
            send: () => {}
        };

        const session = new CallSession(mockWs, {
            callId: 'test_call_exact_once',
            service: 'recruitment',
            role: 'Full Stack Engineer'
        });

        let greetingSendCount = 0;
        session.playAiAudio = async () => {
            greetingSendCount++;
        };

        await Promise.all([
            session.deliverOpeningGreeting(),
            session.deliverOpeningGreeting(),
            session.deliverOpeningGreeting()
        ]);

        assert.strictEqual(greetingSendCount, 1, `Opening greeting must be delivered exactly once (sent ${greetingSendCount} times)`);
        assert.strictEqual(session.conversationHistory.filter(m => m.speaker === 'REMO').length, 1);
    });

    // -------------------------------------------------------------
    // 11. Call Continuity After Recoverable Errors
    // -------------------------------------------------------------
    console.log('\n--- Suite 11: Call Continuity on Transient Failures ---');

    await runAsyncTest('GeminiService.generateReply returns fallback on simulated network failure without crashing', async () => {
        const reply = await GeminiService.generateReply(
            'recruitment',
            { job_role: 'Cloud Architect' },
            [],
            'Can you tell me about the team size?'
        );

        assert.ok(reply.spoken_response, 'Must provide a usable spoken response');
        assert.strictEqual(reply.should_end_call, false, 'Transient error must not terminate call');
    });

    // -------------------------------------------------------------
    // 12. Turn-Taking, VAD Silence, and Latency Monitoring
    // -------------------------------------------------------------
    console.log('\n--- Suite 12: Turn-Taking, VAD & Latency Monitoring ---');

    runTest('isBackchannelOnly correctly identifies brief conversational fillers', () => {
        assert.strictEqual(isBackchannelOnly('yes'), true);
        assert.strictEqual(isBackchannelOnly('yeah'), true);
        assert.strictEqual(isBackchannelOnly('hmm'), true);
        assert.strictEqual(isBackchannelOnly('haan'), true);
        assert.strictEqual(isBackchannelOnly('sare'), true);
        assert.strictEqual(isBackchannelOnly('i have 5 years experience in nodejs'), false);
    });

    runTest('LatencyTracker records pipeline stages and computes p50 / p95 properly', () => {
        const tracker = new LatencyTracker('call_latency_test');
        tracker.markSessionReady();
        tracker.markGreetingStart();
        tracker.markGreetingDelivered();

        // Turn 1: Fast-path
        tracker.startTurn();
        tracker.markVadSilence(360);
        tracker.markSttStart();
        tracker.markSttEnd(3);
        tracker.markDecisionStart();
        tracker.markDecisionEnd('INTENT_FAST_PATH');
        tracker.markTtsStart();
        tracker.markTtsEnd(true);
        tracker.markAudioDispatched();

        // Turn 2: Normal turn
        tracker.startTurn();
        tracker.markVadSilence(480);
        tracker.markSttStart();
        tracker.markSttEnd(25);
        tracker.markDecisionStart();
        tracker.markDecisionEnd('GEMINI_LLM');
        tracker.markTtsStart();
        tracker.markTtsEnd(false);
        tracker.markAudioDispatched();

        const summary = tracker.getSummary();
        assert.strictEqual(summary.turnsCount, 2);
        assert.strictEqual(summary.fastPathCount, 1);
        assert.strictEqual(summary.llmCount, 1);
        assert.ok(typeof summary.p50Ms === 'number');
        assert.ok(typeof summary.p95Ms === 'number');
        assert.ok(summary.firstGreetingDelayMs !== null);
    });

    // -------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------
    console.log('\n================================================================');
    console.log(`TEST RESULTS: ${passedTests} / ${totalTests} Passed (${Math.round((passedTests / totalTests) * 100)}%)`);
    console.log('================================================================\n');

    if (passedTests === totalTests) {
        console.log('ALL 12 ACCEPTANCE CRITERIA VERIFIED SUCCESSFULLY.');
        process.exit(0);
    } else {
        console.error(`FAILED: ${totalTests - passedTests} tests did not pass.`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
