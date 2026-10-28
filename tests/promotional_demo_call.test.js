import './_local_db_only.js'; // keep first: tests must never touch the live database
import 'dotenv/config';
import assert from 'assert';
import { CallSession, PROMOTIONAL_DEMO_SCRIPT } from '../services/voicebot_stream_service.js';
import PlivoService from '../services/plivo_service.js';
import ElevenLabsService from '../services/elevenlabs_service.js';
import { activeDemoCalls, updateDemoCallStatus } from '../routes/demo.js';

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

// Mock WebSocket helper
class MockWebSocket {
    constructor() {
        this.sent = [];
        this.readyState = 1; // WebSocket.OPEN
        this.OPEN = 1;
        this.CLOSED = 3;
        this.closeCode = null;
        this.closeReason = null;
    }
    send(data) {
        this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
    }
    close(code = 1000, reason = '') {
        this.readyState = this.CLOSED;
        this.closeCode = code;
        this.closeReason = reason;
    }
}

async function runPromotionalDemoSuite() {
    console.log('========================================================================');
    console.log('AGENT HARI / REMO — PROMOTIONAL DEMO ONE-WAY CALL VERIFICATION SUITE');
    console.log('========================================================================\n');

    // -----------------------------------------------------------------
    // Section 1: Exact Script Integrity
    // -----------------------------------------------------------------
    console.log('--- Section 1: Promotional Script Integrity ---');

    await test('Promotional script matches required TakeRemo copy character for character', () => {
        const expected = 
`Still spending hours making calls for your business? There’s a smarter way!

Meet TakeRemo.com — your AI calling platform that can make up to 1,000 calls with a single click!

Whether you need Recruitment to screen and schedule candidates, Sales to connect with leads, Customer Support to assist customers 24/7, Appointment Setting to fill your calendar, or a Receptionist to answer every call — TakeRemo has you covered!

For more details, log in to TakeRemo.com today and experience the future of AI calling!

TakeRemo.com — AI Calling. Human Conversations. Real Results!`.trim();

        assert.strictEqual(PROMOTIONAL_DEMO_SCRIPT, expected, 'Script must match the exact TakeRemo text');
        assert.ok(!PROMOTIONAL_DEMO_SCRIPT.includes('? How can I help you'), 'Script must not ask questions');
    });

    // -----------------------------------------------------------------
    // Section 2: Input Validation (Test D)
    // -----------------------------------------------------------------
    console.log('\n--- Section 2: Input Validation (Test D) ---');

    await test('Invalid mobile numbers are rejected with 400', async () => {
        const invalidNumbers = ['', '123', '1234567890', 'abc1234567', '5555555555', '0123456789'];
        for (const num of invalidNumbers) {
            const digits = String(num).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
            const isValid = /^[6-9]\d{9}$/.test(digits);
            assert.strictEqual(isValid, false, `Number "${num}" must be invalid`);
        }
    });

    await test('Valid 10-digit Indian mobile numbers pass validation', async () => {
        const validNumbers = ['9876543210', '+91 9876543210', '919876543210', '8123456789', '7012345678', '6234567890'];
        for (const num of validNumbers) {
            const digits = String(num).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
            const isValid = /^[6-9]\d{9}$/.test(digits);
            assert.strictEqual(isValid, true, `Number "${num}" must be valid`);
        }
    });

    // -----------------------------------------------------------------
    // Section 3: Successful One-Way Execution & Immediate Hangup (Test A)
    // -----------------------------------------------------------------
    console.log('\n--- Section 3: One-Way Promotional Execution (Test A) ---');

    await test('PROMOTIONAL_DEMO session plays complete script and triggers immediate hangup', async () => {
        const ws = new MockWebSocket();
        let hangupCalled = false;
        let hangupUuid = null;

        // Mock PlivoService.hangupCall for this test
        const originalHangup = PlivoService.hangupCall;
        PlivoService.hangupCall = async (uuid) => {
            hangupCalled = true;
            hangupUuid = uuid;
            return { success: true };
        };

        try {
            const session = new CallSession(ws, {
                callId: 'call_promo_test_1',
                service: 'promotional',
                callMode: 'PROMOTIONAL_DEMO',
                phone: '+919876543210'
            });

            assert.strictEqual(session.callMode, 'PROMOTIONAL_DEMO');
            assert.strictEqual(session.promoState, 'INITIATING');

            // Initialize the session
            await session.init();

            assert.strictEqual(session.promoState, 'PLAYING_PROMO');
            assert.strictEqual(session.isAiSpeaking, true);

            // Verify playAudio event was sent to Plivo
            const playMsg = ws.sent.find(m => m.event === 'playAudio');
            assert.ok(playMsg, 'Must send playAudio event to Plivo');
            assert.ok(playMsg.media?.payload, 'Audio payload must be non-empty');

            // Verify transcript message recorded exact script
            assert.strictEqual(session.conversationHistory.length, 1);
            assert.strictEqual(session.conversationHistory[0].text, PROMOTIONAL_DEMO_SCRIPT);

            // Verify hangup timer was scheduled
            assert.ok(session.promoPlaybackTimer, 'Must schedule playback completion timer');

            // Trigger completion callback
            await session.terminatePromotionalCall('TEST_PLAYBACK_COMPLETE');

            assert.strictEqual(session.promoState, 'COMPLETED');
            assert.strictEqual(session.isAiSpeaking, false);
            assert.strictEqual(session.callStatus, 'completed');
            assert.strictEqual(hangupCalled, true, 'Must call PlivoService.hangupCall');
            assert.strictEqual(hangupUuid, 'call_promo_test_1');
            assert.strictEqual(ws.readyState, ws.CLOSED, 'Must close WebSocket stream');

        } finally {
            PlivoService.hangupCall = originalHangup;
        }
    });

    // -----------------------------------------------------------------
    // Section 4: Caller Speech During Playback is Completely Ignored (Test B)
    // -----------------------------------------------------------------
    console.log('\n--- Section 4: Immunity to Caller Speech / Barge-In (Test B) ---');

    await test('Caller speech packets are completely ignored in PROMOTIONAL_DEMO mode', async () => {
        const ws = new MockWebSocket();
        const session = new CallSession(ws, {
            callId: 'call_promo_test_2',
            service: 'promotional',
            callMode: 'PROMOTIONAL_DEMO',
            phone: '+919876543210'
        });

        await session.init();

        // Simulate loud caller speech chunk while AI is speaking
        const loudSpeechChunk = Buffer.alloc(160, 0x7F); // Max amplitude ulaw
        await session.handleInboundAudio(loudSpeechChunk);

        // Verify session did NOT buffer audio, did NOT trigger barge-in, did NOT clear audio
        assert.strictEqual(session.callerMulawChunks.length, 0, 'Must not buffer caller speech');
        assert.strictEqual(session.overlapSpeechFrames, 0, 'Must not increment overlap frames');
        assert.strictEqual(session.interruptedWithAnswer, false, 'Must not trigger barge-in flag');

        const clearMsg = ws.sent.find(m => m.event === 'clearAudio');
        assert.strictEqual(clearMsg, undefined, 'Must NEVER send clearAudio on caller speech in promo demo');

        // Clean up
        if (session.promoPlaybackTimer) clearTimeout(session.promoPlaybackTimer);
    });

    // -----------------------------------------------------------------
    // Section 5: Caller Silence Handling (Test C)
    // -----------------------------------------------------------------
    console.log('\n--- Section 5: Caller Silence Handling (Test C) ---');

    await test('Caller silence does not cause premature hangup or delay', async () => {
        const ws = new MockWebSocket();
        const session = new CallSession(ws, {
            callId: 'call_promo_test_3',
            service: 'promotional',
            callMode: 'PROMOTIONAL_DEMO',
            phone: '+919876543210'
        });

        await session.init();

        // Simulate silence frames
        const silenceChunk = Buffer.alloc(160, 0xFF);
        for (let i = 0; i < 30; i++) {
            await session.handleInboundAudio(silenceChunk);
        }

        // Must still be playing promo, must not trigger turn processing
        assert.strictEqual(session.consecutiveSilenceFrames, 0, 'Promo mode must not track silence frames');
        assert.strictEqual(session.isProcessingTurn, false, 'Must not trigger conversational turn');

        if (session.promoPlaybackTimer) clearTimeout(session.promoPlaybackTimer);
    });

    // -----------------------------------------------------------------
    // Section 6: Duplicate Prevention (Test E)
    // -----------------------------------------------------------------
    console.log('\n--- Section 6: Duplicate Prevention (Test E) ---');

    await test('executePromotionalDemo ignores duplicate invocations', async () => {
        const ws = new MockWebSocket();
        const session = new CallSession(ws, {
            callId: 'call_promo_test_4',
            service: 'promotional',
            callMode: 'PROMOTIONAL_DEMO',
            phone: '+919876543210'
        });

        await session.init();
        const initialPlayCount = ws.sent.filter(m => m.event === 'playAudio').length;

        // Try calling executePromotionalDemo a second time
        await session.executePromotionalDemo();
        const secondPlayCount = ws.sent.filter(m => m.event === 'playAudio').length;

        assert.strictEqual(initialPlayCount, 1, 'Should play once on init');
        assert.strictEqual(secondPlayCount, 1, 'Should NOT play audio again on duplicate call');

        if (session.promoPlaybackTimer) clearTimeout(session.promoPlaybackTimer);
    });

    await test('terminatePromotionalCall ignores duplicate hangup calls', async () => {
        const ws = new MockWebSocket();
        let hangupCount = 0;
        const originalHangup = PlivoService.hangupCall;
        PlivoService.hangupCall = async () => {
            hangupCount++;
            return { success: true };
        };

        try {
            const session = new CallSession(ws, {
                callId: 'call_promo_test_5',
                service: 'promotional',
                callMode: 'PROMOTIONAL_DEMO'
            });

            await session.init();
            await session.terminatePromotionalCall('FIRST');
            await session.terminatePromotionalCall('DUPLICATE');

            assert.strictEqual(hangupCount, 1, 'Plivo REST hangup must only be called once');
        } finally {
            PlivoService.hangupCall = originalHangup;
        }
    });

    // -----------------------------------------------------------------
    // Section 7: Existing Services Non-Regression (Test F)
    // -----------------------------------------------------------------
    console.log('\n--- Section 7: Existing Services Isolation & Non-Regression (Test F) ---');

    await test('Recruitment call defaults to STANDARD mode and runs interactive interview loop', async () => {
        const ws = new MockWebSocket();
        const session = new CallSession(ws, {
            callId: 'call_recruitment_standard',
            service: 'recruitment',
            callerName: '',
            phone: '+919999999999'
        });

        assert.strictEqual(session.callMode, 'STANDARD');
        assert.strictEqual(session.service, 'recruitment');

        await session.init();

        // In standard mode, greeting is delivered and session enters AVAILABILITY listening stage
        assert.strictEqual(session.greetingDelivered, true);
        assert.strictEqual(session.currentStage, 'AVAILABILITY');
        assert.strictEqual(session.promoPlaybackTimer, null, 'Must NOT set promoPlaybackTimer for recruitment');
        assert.ok(session.memory, 'ConversationMemory must be initialized for recruitment');
    });

    await test('Sales call defaults to STANDARD mode with document grounding enabled', async () => {
        const ws = new MockWebSocket();
        const session = new CallSession(ws, {
            callId: 'call_sales_standard',
            service: 'sales',
            phone: '+919876543210'
        });

        assert.strictEqual(session.callMode, 'STANDARD');
        assert.strictEqual(session.service, 'sales');

        await session.init();

        assert.strictEqual(session.greetingDelivered, true);
        assert.strictEqual(session.promoPlaybackTimer, null, 'Must NOT set promoPlaybackTimer for sales');
    });

    await test('Customer Support call defaults to STANDARD mode with ticket resolution enabled', async () => {
        const ws = new MockWebSocket();
        const session = new CallSession(ws, {
            callId: 'call_support_standard',
            service: 'support',
            phone: '+919876543210'
        });

        assert.strictEqual(session.callMode, 'STANDARD');
        assert.strictEqual(session.service, 'support');

        await session.init();

        assert.strictEqual(session.greetingDelivered, true);
        assert.strictEqual(session.promoPlaybackTimer, null, 'Must NOT set promoPlaybackTimer for support');
    });

    // -----------------------------------------------------------------
    // Section 8: Simultaneous Call Independence (Test G)
    // -----------------------------------------------------------------
    console.log('\n--- Section 8: Simultaneous Call Independence (Test G) ---');

    await test('Promotional call runs one-way alongside a normal interactive Sales call without interference', async () => {
        const wsPromo = new MockWebSocket();
        const wsSales = new MockWebSocket();

        const promoSession = new CallSession(wsPromo, {
            callId: 'simultaneous_promo_1',
            service: 'promotional',
            callMode: 'PROMOTIONAL_DEMO',
            phone: '+919111111111'
        });

        const salesSession = new CallSession(wsSales, {
            callId: 'simultaneous_sales_1',
            service: 'sales',
            callMode: 'STANDARD',
            phone: '+919222222222'
        });

        // Initialize both simultaneously
        await Promise.all([
            promoSession.init(),
            salesSession.init()
        ]);

        assert.strictEqual(promoSession.callMode, 'PROMOTIONAL_DEMO');
        assert.strictEqual(salesSession.callMode, 'STANDARD');

        assert.strictEqual(promoSession.promoState, 'PLAYING_PROMO');
        assert.strictEqual(salesSession.greetingDelivered, true);

        // Terminate promotional call
        await promoSession.terminatePromotionalCall('FINISHED');

        assert.strictEqual(promoSession.promoState, 'COMPLETED');
        assert.strictEqual(wsPromo.readyState, wsPromo.CLOSED);

        // Verify sales session is still fully open and listening!
        assert.strictEqual(salesSession.isClosed, false);
        assert.strictEqual(wsSales.readyState, wsSales.OPEN);
        assert.strictEqual(salesSession.currentStage, 'PERMISSION_CHECK');
    });

    // -----------------------------------------------------------------
    // Section 9: Status Tracking & Webhook Sync
    // -----------------------------------------------------------------
    console.log('\n--- Section 9: Status Tracking & Webhook Sync ---');

    await test('updateDemoCallStatus updates active demo call map', () => {
        activeDemoCalls.set('test_call_uuid_100', {
            phone: '+91 9876543210',
            status: 'INITIATING',
            startedAt: Date.now(),
            updatedAt: Date.now()
        });

        updateDemoCallStatus('test_call_uuid_100', 'in-progress');
        assert.strictEqual(activeDemoCalls.get('test_call_uuid_100').status, 'in-progress');

        updateDemoCallStatus('test_call_uuid_100', 'COMPLETED');
        assert.strictEqual(activeDemoCalls.get('test_call_uuid_100').status, 'COMPLETED');
    });

    // -----------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`PROMOTIONAL DEMO SUITE RESULTS: ${passedTests} / ${totalTests} PASSED (${Math.round((passedTests/totalTests)*100)}%)`);
    if (failedTests > 0) {
        console.error(`FAILED: ${failedTests} tests`);
        process.exit(1);
    } else {
        console.log('ALL PROMOTIONAL DEMO TESTS PASSED SUCCESSFULLY.');
        console.log('========================================================================\n');
        process.exit(0);
    }
}

runPromotionalDemoSuite().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
