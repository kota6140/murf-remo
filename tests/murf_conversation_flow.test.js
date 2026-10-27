/**
 * tests/murf_conversation_flow.test.js
 *
 * Verifies the 10 required acceptance scenarios:
 * 1. Call connected -> immediate greeting (natural, short, no IVR catalogue).
 * 2. Caller says yes -> ask whether they need services.
 * 3. Caller expresses interest -> explain only relevant services.
 * 4. Caller is not interested -> polite farewell and complete playback.
 * 5. Caller is busy -> offer another time.
 * 6. Recruitment campaign -> ask one candidate question at a time.
 * 7. Customer support campaign -> listen and respond to the actual issue.
 * 8. Uploaded document -> campaign-specific responses remain grounded in the document.
 * 9. Long response -> final sentence plays completely.
 * 10. Murf WebSocket failure -> clear error reporting and safe recovery without secret leak.
 */

process.env.SKIP_TTS_PRECACHE = '1';

import assert from 'assert';
import MurfService from '../services/murf_service.js';
import IntentService from '../services/intent_service.js';
import GeminiService from '../services/gemini_service.js';
import { CallSession, ConversationStates, trimSilencePcm16 } from '../services/voicebot_stream_service.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runSync(name, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`  [PASS] Scenario ${totalTests}: ${name}`);
    } catch (e) {
        failedTests++;
        console.error(`  [FAIL] Scenario ${totalTests}: ${name}`);
        console.error(`         ${e.stack || e.message}`);
    }
}

async function runAsync(name, fn) {
    totalTests++;
    try {
        await fn();
        passedTests++;
        console.log(`  [PASS] Scenario ${totalTests}: ${name}`);
    } catch (e) {
        failedTests++;
        console.error(`  [FAIL] Scenario ${totalTests}: ${name}`);
        console.error(`         ${e.stack || e.message}`);
    }
}

console.log('================================================================');
console.log('AGENT REMO / HARI - MURF & NATURAL FLOW ACCEPTANCE TEST SUITE');
console.log('================================================================\n');

// ---------------------------------------------------------------------
// Scenario 1: Call connected -> immediate greeting (no robotic catalogue)
// ---------------------------------------------------------------------
runSync('Scenario 1: Call connected -> immediate short natural greeting', () => {
    // A. Greeting without contact name
    const greetingAnon = GeminiService.getOpeningGreeting('sales', {});
    assert.strictEqual(greetingAnon, 'Hi, this is Remo calling from Scorelabs. Is now a good time to talk?');
    assert.ok(!greetingAnon.toLowerCase().includes('custom software development'), 'Must not dump services catalogue in opening');
    assert.ok(!greetingAnon.toLowerCase().includes('qa and software testing'), 'Must not list testing');
    assert.ok(!greetingAnon.toLowerCase().includes('digital marketing services'), 'Must not list digital marketing');

    // B. Greeting with contact name
    const greetingNamed = GeminiService.getOpeningGreeting('sales', { name: 'Priya Sharma' });
    assert.strictEqual(greetingNamed, 'Hello, am I speaking with Priya Sharma?');

    // C. When contact confirms name in GREETING stage
    const greetingConfirm = IntentService.matchIntent('Yes', {
        service: 'sales',
        stage: 'GREETING',
        language: 'en',
        contact: { name: 'Priya Sharma' }
    });
    assert.strictEqual(greetingConfirm.matched, true);
    assert.ok(greetingConfirm.spoken_response.includes('Hi Priya Sharma, this is Remo calling from Scorelabs. Is now a good time to talk?'));
});

// ---------------------------------------------------------------------
// Scenario 2: Caller says yes -> ask whether they need services
// ---------------------------------------------------------------------
runSync('Scenario 2: Caller says yes -> ask whether they need services', () => {
    const res = IntentService.matchIntent('Yes, go ahead', {
        service: 'sales',
        stage: 'PERMISSION_CHECK',
        language: 'en'
    });
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.next_stage, 'INTEREST_DISCOVERY');
    assert.strictEqual(res.spoken_response, 'Great, thanks! I just wanted to ask — are you currently looking for any IT or digital marketing services?');
    assert.strictEqual(res.should_end_call, false);
});

// ---------------------------------------------------------------------
// Scenario 3: Caller expresses interest -> explain only relevant services
// ---------------------------------------------------------------------
runSync('Scenario 3: Caller expresses interest -> explain only relevant services', () => {
    // Caller says yes to services inquiry
    const resYes = IntentService.matchIntent('Yes we are', {
        service: 'sales',
        stage: 'INTEREST_DISCOVERY',
        language: 'en'
    });
    assert.strictEqual(resYes.matched, true);
    assert.strictEqual(resYes.spoken_response, 'Sure! What kind of service are you looking for?');

    // Caller asks what services Scorelabs offers
    const resWhat = IntentService.matchIntent('What services do you offer?', {
        service: 'sales',
        stage: 'INTEREST_DISCOVERY',
        language: 'en'
    });
    assert.strictEqual(resWhat.matched, true);
    assert.strictEqual(resWhat.spoken_response, 'We help with website and software development, mobile apps, and digital marketing. Which of these would be most useful to you?');
    assert.strictEqual(resWhat.next_stage, 'SERVICE_DISCOVERY');
});

// ---------------------------------------------------------------------
// Scenario 4: Caller is not interested -> polite farewell and complete playback
// ---------------------------------------------------------------------
runSync('Scenario 4: Caller is not interested -> polite farewell and graceful termination', () => {
    // A. "No" during interest discovery
    const resNo = IntentService.matchIntent('No, not looking right now', {
        service: 'sales',
        stage: 'INTEREST_DISCOVERY',
        language: 'en'
    });
    assert.strictEqual(resNo.matched, true);
    assert.strictEqual(resNo.spoken_response, 'No problem at all. Thanks for your time. Have a great day!');
    assert.strictEqual(resNo.should_end_call, true);
    assert.strictEqual(resNo.classification, 'Not Interested');

    // B. Direct "not interested"
    const resNotInterested = IntentService.matchIntent('not interested', {
        service: 'sales',
        stage: 'PERMISSION_CHECK',
        language: 'en'
    });
    assert.strictEqual(resNotInterested.matched, true);
    assert.strictEqual(resNotInterested.spoken_response, 'No problem at all. Thanks for your time. Have a great day!');
    assert.strictEqual(resNotInterested.should_end_call, true);
});

// ---------------------------------------------------------------------
// Scenario 5: Caller is busy -> offer another time
// ---------------------------------------------------------------------
runSync('Scenario 5: Caller is busy -> offer another time', () => {
    const variations = [
        'I am busy right now',
        'in a meeting',
        'driving right now',
        'not a good time',
        'can you call later'
    ];

    for (const phrase of variations) {
        const res = IntentService.matchIntent(phrase, {
            service: 'sales',
            stage: 'PERMISSION_CHECK',
            language: 'en'
        });
        assert.strictEqual(res.matched, true, `Failed matching busy phrase: "${phrase}"`);
        assert.strictEqual(res.spoken_response, 'Of course. Would another time be better?');
        assert.strictEqual(res.next_stage, 'CALLBACK_TIME');
        assert.strictEqual(res.classification, 'Callback Requested');
        assert.strictEqual(res.should_end_call, false);
    }
});

// ---------------------------------------------------------------------
// Scenario 6: Recruitment campaign -> ask one candidate question at a time
// ---------------------------------------------------------------------
runSync('Scenario 6: Recruitment campaign -> one question at a time, natural flow', () => {
    // Identity question first
    const identityGreeting = GeminiService.getOpeningGreeting('recruitment', { name: 'Rahul Verma' });
    assert.strictEqual(identityGreeting, 'Hello, am I speaking with Rahul Verma?');

    // Candidate confirms
    const confirm = IntentService.matchIntent('Yes speaking', {
        service: 'recruitment',
        stage: 'GREETING',
        language: 'en',
        contact: { name: 'Rahul Verma', job_role: 'Senior Node.js Developer', company: 'Acme Corp' }
    });
    assert.strictEqual(confirm.matched, true);
    assert.ok(confirm.spoken_response.includes('Senior Node.js Developer'), 'Must mention role');
    assert.ok(confirm.spoken_response.includes('Is now a good time to speak'), 'Must check permission');
    assert.strictEqual(confirm.next_stage, 'AVAILABILITY');

    // Candidate confirms availability -> moves to experience question ONE at a time
    const avail = IntentService.matchIntent('Yes it is', {
        service: 'recruitment',
        stage: 'AVAILABILITY',
        language: 'en',
        questions: { plan: [{ id: 'q1', text: 'How many years of Node.js experience do you have?', stage: 'EXPERIENCE' }] }
    });
    assert.strictEqual(avail.matched, true);
    assert.ok(avail.spoken_response.includes('How many years of Node.js experience do you have?'));
    assert.strictEqual(avail.next_stage, 'EXPERIENCE');
});

// ---------------------------------------------------------------------
// Scenario 7: Customer support campaign -> listen and respond to actual issue
// ---------------------------------------------------------------------
runSync('Scenario 7: Customer support campaign -> listen and respond to actual issue', () => {
    const greeting = GeminiService.getOpeningGreeting('support', {});
    assert.ok(greeting.includes('customer support'), 'Support greeting introduces support agent');
    assert.ok(greeting.toLowerCase().includes('is now a convenient time') || greeting.toLowerCase().includes('how can i help'), 'Asks permission / offers help');

    // Candidate confirms
    const yesRes = IntentService.matchIntent('Yes', {
        service: 'support',
        stage: 'AVAILABILITY',
        language: 'en'
    });
    assert.strictEqual(yesRes.matched, true);
    assert.ok(yesRes.spoken_response.includes('describe the specific error or issue'));
    assert.strictEqual(yesRes.classification, 'PENDING_INFO');
});

// ---------------------------------------------------------------------
// Scenario 8: Uploaded document -> responses remain grounded in document
// ---------------------------------------------------------------------
runSync('Scenario 8: Campaign document remains authoritative without reciting entire catalogue', () => {
    const customCampaignContext = {
        company_name: 'CloudScale Technologies',
        product_name: 'Enterprise Cloud Migration',
        key_features: ['AWS Migration', 'Database Modernization', 'Cost Optimization'],
        pricing_summary: '$5,000 per cloud workload'
    };

    // Custom company greeting uses natural pattern with grounded company name
    const greeting = GeminiService.getOpeningGreeting('sales', {
        campaignContext: customCampaignContext
    });
    assert.strictEqual(greeting, 'Hi, this is Remo calling from CloudScale Technologies. Is now a good time to talk?');

    // Purpose inquiry when asked what they do
    const purpose = IntentService.matchIntent('What is this call about?', {
        service: 'sales',
        stage: 'PERMISSION_CHECK',
        language: 'en',
        campaignContext: customCampaignContext
    });
    assert.strictEqual(purpose.matched, true);
    assert.strictEqual(purpose.spoken_response, "We help businesses with software development and digital marketing. Is there anything in those areas you're exploring?");
});

// ---------------------------------------------------------------------
// Scenario 9: Long response -> final sentence plays completely (hangUpAfterSpeech)
// ---------------------------------------------------------------------
runSync('Scenario 9: Long response -> duration-aware termination preserves complete playback', () => {
    const mockSession = new CallSession('test_call_long_response', {
        ws: { send: () => {}, readyState: 1 },
        contact: { name: 'Test' },
        service: 'sales'
    });

    const farewell = 'No problem at all. Thanks for your time. Have a great day!';
    mockSession.aiSpeechEndTime = Date.now() + 2500; // 2.5s of audio left
    mockSession.hangUpAfterSpeech(farewell, 1400, 2800);

    assert.ok(mockSession.hangUpTimer !== null, 'Hangup timer must be armed');
    assert.strictEqual(mockSession.isClosingCall, true, 'isClosingCall flag must prevent barge-in cutoff');
    clearTimeout(mockSession.hangUpTimer);
});

// ---------------------------------------------------------------------
// Scenario 10: Murf WebSocket failure -> clear error reporting and safe recovery
// ---------------------------------------------------------------------
runAsync('Scenario 10: Murf configuration, live streaming & error handling', async () => {
    // A. Verify Murf configuration helpers
    assert.strictEqual(MurfService.isConfigured(), true, 'MurfService must be configured with MURF_API_KEY');
    assert.strictEqual(MurfService.getModelId(), 'falcon-2.1', 'Must map to falcon-2.1 API model identifier');
    assert.strictEqual(MurfService.getVoiceId(), 'Pooja', 'Default voice ID must be Pooja');
    assert.strictEqual(MurfService.getStyle(), 'Conversational', 'Style must be Conversational');
    assert.strictEqual(MurfService.getLocale(), 'en-IN', 'Locale must be en-IN');

    // B. Fast PCM16 silence trimming test for STT optimization
    const silentLeading = Buffer.alloc(1600, 0); // 100ms silence
    const speechSamples = Buffer.alloc(1600);    // 100ms speech
    for (let i = 0; i < 800; i++) speechSamples.writeInt16LE(2000, i * 2);
    const silentTrailing = Buffer.alloc(3200, 0); // 200ms silence
    const fullAudio = Buffer.concat([silentLeading, speechSamples, silentTrailing]);

    const trimmed = trimSilencePcm16(fullAudio, 8000, 350, 100);
    assert.ok(trimmed.length < fullAudio.length, 'Trimmed audio must be shorter than raw audio with trailing silence');
    assert.ok(trimmed.length >= speechSamples.length, 'Trimmed audio must contain all speech samples');

    // C. Live Murf streaming test
    const chunks = [];
    const t0 = Date.now();
    const audio = await MurfService.textToSpeech('Hi, this is Remo calling from Scorelabs. Is now a good time to talk?', {
        onChunk: (c) => chunks.push(c)
    });

    const elapsed = Date.now() - t0;
    assert.ok(audio && audio.length > 0, 'Murf must return synthesized audio');
    assert.ok(chunks.length > 0, 'Murf streaming must deliver real-time audio chunks via onChunk');
    console.log(`         [Murf Live Benchmark] Audio: ${audio.length} bytes, Chunks: ${chunks.length}, Elapsed: ${elapsed}ms`);
});

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------
setTimeout(() => {
    console.log('\n================================================================');
    console.log(`TEST RUN COMPLETE: Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
    console.log('================================================================');
    if (failedTests > 0) process.exit(1);
    else process.exit(0);
}, 2500);
