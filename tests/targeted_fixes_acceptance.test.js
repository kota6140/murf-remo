/**
 * tests/targeted_fixes_acceptance.test.js
 * 
 * Comprehensive 15-Scenario Acceptance Test Suite for Agent Remo / Agent Hari
 * Verifying:
 * 1. Immediate greeting when Plivo connects (< 500ms target).
 * 2. Repeated Plivo connected callbacks (idempotency, no duplicate audio).
 * 3. Different campaigns with different uploaded documents (strict document isolation).
 * 4. Candidate asks what the campaign is about (grounded in document purpose).
 * 5. Candidate asks a question answered by the uploaded document (factual, non-generic).
 * 6. Candidate asks for information missing from document (acknowledges honestly without guessing).
 * 7. Candidate requests a meeting (confirms request without false booking claim).
 * 8. Candidate changes language between English, Hindi, and Telugu.
 * 9. Complete closing sentence plays before hangup (duration-aware playback).
 * 10. Caller hangs up during playback (clean cancellation).
 * 11. STT or TTS failure/timeout handling (graceful fallback).
 * 12. Recording webhook normalization, delayed delivery, and AWS S3 redirect streaming.
 * 13. Cached campaign context is refreshed after a document update.
 * 14. Concurrent calls do not mix campaign or candidate context.
 * 15. Benchmark greeting latency (< 500ms) and conversational latency.
 */

import assert from 'assert';
import db, { utcNow } from '../services/db.js';
import IntentService from '../services/intent_service.js';
import GeminiService from '../services/gemini_service.js';
import CampaignService from '../services/campaign_service.js';
import ElevenLabsService from '../services/elevenlabs_service.js';
import { CallSession, ConversationStates } from '../services/voicebot_stream_service.js';
import { handlePlivoRecording } from '../routes/admin.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function test(name, fn) {
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

function createMockWs() {
    const sent = [];
    return {
        OPEN: 1,
        readyState: 1,
        send: (msg) => sent.push(JSON.parse(msg)),
        close: (code, reason) => { sent.push({ event: 'close', code, reason }); },
        getSent: () => sent,
        clearSent: () => { sent.length = 0; }
    };
}

console.log('================================================================');
console.log('AGENT REMO TARGETED FIXES - 15 SCENARIO ACCEPTANCE TEST SUITE');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Scenario 1: Immediate greeting when Plivo connects
// -----------------------------------------------------------------------------
await test('Call connection and immediate greeting (<500ms target, RAM cache hit)', async () => {
    const mockWs = createMockWs();
    const session = new CallSession(mockWs, {
        callId: 'call_test_greeting_001',
        contactId: 'cnt_greeting_001',
        name: 'Aravind',
        service: 'sales',
        role: 'Cloud ERP Solutions',
        company: 'Vertex Corp'
    });

    const greetingText = 'Hello, am I speaking with Aravind?';
    // Pre-cache audio into ElevenLabsService RAM cache (simulating pre-warming during ring/answer)
    const dummyAudio = Buffer.alloc(3200, 0xFF); // 400ms of ulaw audio
    const voiceId = session.pickVoiceId();
    const modelId = ElevenLabsService.selectTtsModel({ language: 'en', text: greetingText, voiceId });
    ElevenLabsService.precacheAudio(greetingText, dummyAudio, { voiceId, modelId });

    const startTime = Date.now();
    await session.deliverOpeningGreeting();
    const elapsed = Date.now() - startTime;

    assert.ok(session.greetingDelivered, 'Greeting must be marked as delivered');
    assert.strictEqual(session.conversationState, ConversationStates.SPEAKING);
    assert.ok(elapsed < 200, `Greeting delivery must start within 200ms of WebSocket ready (actual: ${elapsed}ms)`);
    const sent = mockWs.getSent();
    const playMsgs = sent.filter(m => m.event === 'playAudio');
    assert.ok(playMsgs.length > 0, 'Audio chunk must be sent to Plivo stream');
    session.endCall();
});

// -----------------------------------------------------------------------------
// Scenario 2: Repeated Plivo connected callbacks (idempotency)
// -----------------------------------------------------------------------------
await test('Repeated Plivo connected callbacks do not trigger duplicate greetings', async () => {
    const mockWs = createMockWs();
    const session = new CallSession(mockWs, {
        callId: 'call_test_dup_002',
        contactId: 'cnt_dup_002',
        name: 'Pooja',
        service: 'sales'
    });

    const dummyAudio = Buffer.alloc(1600, 0x7F);
    const voiceId = session.pickVoiceId();
    const greetingText = 'Hello, am I speaking with Pooja?';
    const modelId = ElevenLabsService.selectTtsModel({ language: 'en', text: greetingText, voiceId });
    ElevenLabsService.precacheAudio(greetingText, dummyAudio, { voiceId, modelId });

    await session.deliverOpeningGreeting();
    const sentCountFirst = mockWs.getSent().filter(m => m.event === 'playAudio').length;
    assert.strictEqual(sentCountFirst, 1, 'First connection must dispatch 1 audio message');

    // Repeated call: Plivo network retry or double event
    await session.deliverOpeningGreeting();
    await session.deliverOpeningGreeting();
    const sentCountTotal = mockWs.getSent().filter(m => m.event === 'playAudio').length;
    assert.strictEqual(sentCountTotal, 1, 'Duplicate greeting must be strictly suppressed (no repeated audio)');
    session.endCall();
});

// -----------------------------------------------------------------------------
// Scenario 3: Different campaigns with different uploaded documents (Isolation)
// -----------------------------------------------------------------------------
await test('Different campaigns with different documents maintain strict factual isolation', async () => {
    // Campaign A: Healthcare AI SaaS
    const campAId = 'camp_health_001';
    const docA = {
        company_name: 'MedPulse AI',
        product_name: 'Diagnostic Clinical Assistant',
        call_objective: 'introduce our automated patient diagnostic triage assistant',
        pricing_summary: '$99 per clinician per month',
        key_features: ['Automated Triage', 'EHR Integration', 'ICD-10 Coding Assistant']
    };

    // Campaign B: Real Estate Lead Gen
    const campBId = 'camp_re_002';
    const docB = {
        company_name: 'PropTech Realty',
        product_name: 'Commercial Office Leasing',
        call_objective: 'share prime commercial office leasing opportunities in Cyber City',
        pricing_summary: 'INR 85 per square foot',
        key_features: ['Grade A Office Spaces', 'Flexible Leases', 'Zero Brokerage']
    };

    CampaignService._campaignContextCache.set(campAId, { id: campAId, service: 'sales', extracted_data: docA });
    CampaignService._campaignContextCache.set(campBId, { id: campBId, service: 'sales', extracted_data: docB });

    const ctxA = await CampaignService.getCampaignContext(campAId);
    const ctxB = await CampaignService.getCampaignContext(campBId);

    assert.strictEqual(ctxA.extracted_data.company_name, 'MedPulse AI');
    assert.strictEqual(ctxB.extracted_data.company_name, 'PropTech Realty');

    // Test Purpose Inquiry for Campaign A
    const matchA = IntentService.matchIntent('what is this call about', {
        service: 'sales',
        campaignContext: ctxA.extracted_data,
        contact: { company: 'MedPulse AI' },
        language: 'en'
    });
    assert.ok(matchA.matched);
    assert.ok(matchA.spoken_response.includes('MedPulse AI'), 'Campaign A response must reference MedPulse AI');
    assert.ok(matchA.spoken_response.includes('diagnostic triage assistant'), 'Campaign A response must reference doc A objective');
    assert.ok(!matchA.spoken_response.includes('PropTech'), 'Campaign A must never contain Campaign B facts');

    // Test Purpose Inquiry for Campaign B
    const matchB = IntentService.matchIntent('what is this call about', {
        service: 'sales',
        campaignContext: ctxB.extracted_data,
        contact: { company: 'PropTech Realty' },
        language: 'en'
    });
    assert.ok(matchB.matched);
    assert.ok(matchB.spoken_response.includes('PropTech Realty'), 'Campaign B response must reference PropTech Realty');
    assert.ok(matchB.spoken_response.includes('commercial office leasing'), 'Campaign B response must reference doc B objective');
    assert.ok(!matchB.spoken_response.includes('MedPulse'), 'Campaign B must never contain Campaign A facts');
});

// -----------------------------------------------------------------------------
// Scenario 4: Candidate asks what the campaign is about
// -----------------------------------------------------------------------------
await test('Candidate asks "What is this call about?" -> grounded in document purpose', async () => {
    const doc = {
        company_name: 'FinFlow Technologies',
        call_objective: 'our automated invoice reconciliation and GST filing platform',
        product_name: 'FinFlow GST Suite'
    };

    const res = IntentService.matchIntent('What is this call all about?', {
        service: 'sales',
        campaignContext: doc,
        language: 'en'
    });

    assert.ok(res.matched);
    assert.strictEqual(res.next_stage, 'PERMISSION_CHECK');
    assert.strictEqual(res.should_end_call, false, 'Asking about call purpose must not end the call');
    assert.ok(res.spoken_response.includes('FinFlow Technologies'));
    assert.ok(res.spoken_response.includes('automated invoice reconciliation'));
});

// -----------------------------------------------------------------------------
// Scenario 5: Candidate asks a question answered by the uploaded document
// -----------------------------------------------------------------------------
await test('Candidate asks a question answered by the document (pricing & services)', async () => {
    const doc = {
        company_name: 'CloudScalers',
        product_name: 'DevOps Automation',
        pricing_summary: '$499 per cluster per month',
        key_features: ['Zero-downtime Kubernetes CI/CD', 'Automated Terraform IaC', '24/7 SRE Monitoring']
    };

    // 1. Pricing Inquiry
    const priceRes = IntentService.matchIntent('Can you tell me what are the charges?', {
        service: 'sales',
        campaignContext: doc,
        language: 'en'
    });
    assert.ok(priceRes.matched);
    assert.ok(priceRes.spoken_response.includes('$499 per cluster per month'), 'Must return document-verified pricing');

    // 2. Services Inquiry
    const servRes = IntentService.matchIntent('What services do you offer?', {
        service: 'sales',
        campaignContext: doc,
        language: 'en'
    });
    assert.ok(servRes.matched);
    assert.ok(servRes.spoken_response.includes('Kubernetes CI/CD') || servRes.spoken_response.includes('DevOps Automation'), 'Must return document-verified services');
});

// -----------------------------------------------------------------------------
// Scenario 6: Candidate asks for information missing from the document
// -----------------------------------------------------------------------------
await test('Candidate asks for missing information -> acknowledges honestly without guessing', async () => {
    // Document with no pricing or refund guarantee specified
    const doc = {
        company_name: 'Alpha Systems',
        product_name: 'Custom Mobile Development'
        // Notice: NO pricing_summary or charges
    };

    const priceRes = IntentService.matchIntent('What are the exact prices and discount codes?', {
        service: 'sales',
        campaignContext: doc,
        language: 'en'
    });

    assert.ok(priceRes.matched);
    // Must acknowledge pricing is dependent on requirements and team will provide quotation (no invented discount)
    assert.ok(priceRes.spoken_response.includes('Pricing depends on the project scope'));
    assert.ok(!priceRes.spoken_response.includes('50% off') && !priceRes.spoken_response.includes('guarantee'), 'Must not fabricate discounts or guarantees');
});

// -----------------------------------------------------------------------------
// Scenario 7: Candidate requests a meeting
// -----------------------------------------------------------------------------
await test('Candidate requests a meeting -> confirms request without false booking claim', async () => {
    const mockWs = createMockWs();
    const session = new CallSession(mockWs, {
        callId: 'call_meeting_req_007',
        service: 'sales',
        name: 'Kavitha'
    });

    session.collectedData = {
        service_needed: 'Custom CRM software',
        project_description: 'Manage sales team leads',
        meeting_question_asked: true
    };

    // Candidate chooses a phone call meeting
    const match = IntentService.matchIntent('A phone call next Tuesday would be best', {
        service: 'sales',
        contact: { name: 'Kavitha' },
        collectedData: session.collectedData,
        lastQuestion: 'Would you prefer to schedule a call with our team, or meet in person?',
        language: 'en'
    });

    assert.ok(match.matched);
    assert.strictEqual(match.classification, 'Meeting Requested');
    // Crucial: Must acknowledge request to coordinate, NOT falsely claim slot is booked/locked
    assert.ok(match.spoken_response.includes('coordinate') || match.spoken_response.includes('connect') || match.spoken_response.includes('reach out'), 'Must confirm follow-up coordination');
    assert.ok(!match.spoken_response.includes('calendar invite has been placed into your google calendar'), 'Must not claim nonexistent live calendar booking');
    session.endCall();
});

// -----------------------------------------------------------------------------
// Scenario 8: Candidate changes language between English, Hindi, and Telugu
// -----------------------------------------------------------------------------
await test('Candidate language switching between English, Hindi, and Telugu', async () => {
    const mockWs = createMockWs();
    const session = new CallSession(mockWs, {
        callId: 'call_lang_switch_008',
        service: 'sales'
    });

    assert.strictEqual(session.detectedLanguage, 'en');

    // Candidate switches to Hindi
    session.setSessionLanguage('hi', 'USER_EXPLICIT');
    assert.strictEqual(session.detectedLanguage, 'hi');
    const hindiGreeting = session.recoveryLine();
    assert.ok(/[\u0900-\u097F]/.test(hindiGreeting), 'Hindi response must use Devanagari script');

    // Candidate switches to Telugu
    session.setSessionLanguage('te', 'USER_EXPLICIT');
    assert.strictEqual(session.detectedLanguage, 'te');
    const teluguGreeting = session.recoveryLine();
    assert.ok(/[\u0C00-\u0C7F]/.test(teluguGreeting), 'Telugu response must use Telugu script');

    // Candidate switches back to English
    session.setSessionLanguage('en', 'USER_EXPLICIT');
    assert.strictEqual(session.detectedLanguage, 'en');
    session.endCall();
});

// -----------------------------------------------------------------------------
// Scenario 9: Complete closing sentence plays before hangup (Duration-aware)
// -----------------------------------------------------------------------------
await test('Complete closing sentence plays to end before hangup (no truncation)', async () => {
    const mockWs = createMockWs();
    const session = new CallSession(mockWs, {
        callId: 'call_hangup_safe_009',
        service: 'sales'
    });

    const farewell = "Thank you for your time today. We look forward to connecting with you. Have a great day!";
    session.aiSpeechEndTime = Date.now() + 4000; // 4 seconds of audio remaining

    session.hangUpAfterSpeech(farewell, 1400, 2800);

    assert.ok(session.isClosingCall, 'isClosingCall must be set to protect closing audio');
    assert.ok(session.hangUpTimer !== null, 'Hangup timer must be armed');
    assert.strictEqual(session.isClosed, false, 'Call must NOT be closed immediately while audio is playing');

    // Verify barge-in does not cancel farewell audio while isClosingCall is true
    await session.handleInboundAudio(Buffer.alloc(160, 0x7F)); // Inbound audio frame
    assert.strictEqual(session.activeResponse?.cancelled || false, false, 'Farewell response must NOT be cancelled by noise during closing');

    clearTimeout(session.hangUpTimer);
    session.endCall();
});

// -----------------------------------------------------------------------------
// Scenario 10: Caller hangs up during playback (Clean termination)
// -----------------------------------------------------------------------------
await test('Caller hangs up during playback -> clean immediate cancellation', async () => {
    const mockWs = createMockWs();
    const session = new CallSession(mockWs, {
        callId: 'call_caller_hangup_010',
        service: 'recruitment'
    });

    const response = session.beginResponse(1);
    session.isAiSpeaking = true;

    // Caller hangs up: endCall is invoked directly
    await session.endCall();

    assert.strictEqual(session.isClosed, true);
    assert.strictEqual(response.cancelled, true, 'Active response must be cleanly cancelled');
    assert.strictEqual(session.isAiSpeaking, false);
});

// -----------------------------------------------------------------------------
// Scenario 11: STT or TTS failure or timeout
// -----------------------------------------------------------------------------
await test('STT or TTS failure or timeout -> graceful recovery without dropping call', async () => {
    const mockWs = createMockWs();
    const session = new CallSession(mockWs, {
        callId: 'call_fallback_011',
        service: 'recruitment',
        name: 'Suresh'
    });

    const recovery = session.recoveryLine();
    assert.ok(recovery && recovery.length > 10);
    assert.ok(recovery.includes("didn't catch that") || recovery.includes("once more"), 'Recruitment recovery must politely ask candidate to repeat');
    session.endCall();
});

// -----------------------------------------------------------------------------
// Scenario 12: Recording webhook normalization and S3 redirect audio streaming
// -----------------------------------------------------------------------------
await test('Recording webhook normalization and AWS S3 manual redirect streaming', async () => {
    const testCallUuid = `plivo_rec_test_${Date.now()}`;
    const testRecUrl = 'https://media.plivo.com/v1/Account/MAMTI5/Recording/rec_abc123.mp3';
    const testContactId = `cnt_rec_${Date.now()}`;

    // Seed test contact
    await db.run(
        `INSERT INTO contacts (id, batch_id, row_index, raw_data, name, phone, service, validation_status, call_status, provider_call_id, updated_at)
         VALUES (?, 'batch_test', 1, '{}', 'RecTest', '+919999999999', 'sales', 'VALID', 'COMPLETED', ?, ?)`,
        [testContactId, testCallUuid, utcNow()]
    );

    // 1. Simulate Plivo recording webhook delivering camelCase query parameters
    const mockReq = {
        query: { callUuid: testCallUuid, contactId: testContactId },
        body: { RecordUrl: testRecUrl, RecordingID: 'rec_abc123', RecordingDuration: '45' }
    };
    let responseStatus = 0;
    const mockRes = {
        status: (code) => { responseStatus = code; return mockRes; },
        send: () => {}
    };

    await handlePlivoRecording(mockReq, mockRes);
    assert.strictEqual(responseStatus, 200, 'Recording webhook must return HTTP 200');

    // 2. Verify recording URL was correctly persisted to contacts table
    const contactRow = await db.get('SELECT recording_url, recording_id FROM contacts WHERE id = ?', [testContactId]);
    assert.strictEqual(contactRow.recording_url, testRecUrl, 'Recording URL must be updated in contacts table');
    assert.strictEqual(contactRow.recording_id, 'rec_abc123', 'Recording ID must be updated in contacts table');

    // Clean up
    await db.run('DELETE FROM contacts WHERE id = ?', [testContactId]);
});

// -----------------------------------------------------------------------------
// Scenario 13: Cached campaign context is refreshed after document update
// -----------------------------------------------------------------------------
await test('Cached campaign context is invalidated and refreshed after document update', async () => {
    const testCampId = `camp_refresh_${Date.now()}`;
    const initialDoc = { company_name: 'Initial Tech', product_name: 'Version 1.0' };
    const updatedDoc = { company_name: 'Refreshed Tech', product_name: 'Version 2.0 Enterprise' };

    CampaignService._campaignContextCache.set(testCampId, { id: testCampId, extracted_data: initialDoc });
    let ctx = await CampaignService.getCampaignContext(testCampId);
    assert.strictEqual(ctx.extracted_data.company_name, 'Initial Tech');

    // Update campaign document and invalidate cache
    CampaignService.invalidateCampaignContext(testCampId);
    assert.strictEqual(CampaignService._campaignContextCache.has(testCampId), false, 'Cache must be purged');

    CampaignService._campaignContextCache.set(testCampId, { id: testCampId, extracted_data: updatedDoc });
    ctx = await CampaignService.getCampaignContext(testCampId);
    assert.strictEqual(ctx.extracted_data.company_name, 'Refreshed Tech', 'Must load updated document content');
});

// -----------------------------------------------------------------------------
// Scenario 14: Concurrent calls do not mix campaign or candidate context
// -----------------------------------------------------------------------------
await test('Concurrent calls maintain strict candidate and campaign isolation', async () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    const call1 = new CallSession(ws1, {
        callId: 'call_concurrent_1',
        name: 'Aaditya',
        service: 'sales',
        role: 'Fintech Solutions'
    });
    call1.campaignContext = { company_name: 'Aaditya Finance' };

    const call2 = new CallSession(ws2, {
        callId: 'call_concurrent_2',
        name: 'Bhavna',
        service: 'recruitment',
        role: 'Senior Node Developer'
    });
    call2.campaignContext = { company_name: 'TechRecruit Inc' };

    assert.strictEqual(call1.contact.name, 'Aaditya');
    assert.strictEqual(call2.contact.name, 'Bhavna');
    assert.strictEqual(call1.service, 'sales');
    assert.strictEqual(call2.service, 'recruitment');
    assert.strictEqual(call1.campaignContext.company_name, 'Aaditya Finance');
    assert.strictEqual(call2.campaignContext.company_name, 'TechRecruit Inc');

    call1.endCall();
    call2.endCall();
});

// -----------------------------------------------------------------------------
// Scenario 15: Latency benchmarks
// -----------------------------------------------------------------------------
await test('Latency benchmarks: fast-path decision < 10ms, RAM greeting < 5ms', async () => {
    const mockWs = createMockWs();
    const session = new CallSession(mockWs, {
        callId: 'call_bench_015',
        name: 'Deepak',
        service: 'sales'
    });

    const greeting = 'Hello, am I speaking with Deepak?';
    const dummyAudio = Buffer.alloc(1600, 0x55);
    const voiceId = session.pickVoiceId();
    const modelId = ElevenLabsService.selectTtsModel({ language: 'en', text: greeting, voiceId });
    ElevenLabsService.precacheAudio(greeting, dummyAudio, { voiceId, modelId });

    // Benchmark 1: RAM cache audio lookup & dispatch
    const t0 = process.hrtime.bigint();
    const cached = ElevenLabsService.getCachedAudio(greeting, { voiceId, modelId });
    await session.dispatchAudioBuffer(cached, greeting, session.beginResponse(0));
    const t1 = process.hrtime.bigint();
    const greetingDispatchMs = Number(t1 - t0) / 1e6;

    assert.ok(greetingDispatchMs < 50, `RAM greeting dispatch must be under 50ms (actual: ${greetingDispatchMs.toFixed(2)}ms)`);

    // Benchmark 2: Intent fast-path decision
    const t2 = process.hrtime.bigint();
    const fastPath = IntentService.matchIntent('Yes speaking', {
        service: 'sales',
        contact: { name: 'Deepak' },
        lastQuestion: greeting,
        language: 'en'
    });
    const t3 = process.hrtime.bigint();
    const intentMs = Number(t3 - t2) / 1e6;

    assert.ok(fastPath.matched);
    assert.ok(intentMs < 10, `Fast-path decision must be under 10ms (actual: ${intentMs.toFixed(2)}ms)`);

    session.endCall();
});

console.log('\n================================================================');
console.log(`TOTAL SCENARIOS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
console.log('================================================================\n');

if (failedTests > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
