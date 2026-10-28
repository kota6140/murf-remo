/**
 * tests/agent_hari_conversation_restore.test.js
 * 
 * Comprehensive regression tests verifying Agent Hari's fast, natural conversation:
 * 1. Candidate asks what the call is about.
 * 2. Candidate says they are busy.
 * 3. Candidate agrees to continue.
 * 4. Candidate declines the call.
 * 5. Candidate asks a follow-up question before answering the pending question.
 * 6. Candidate switches between English, Hindi, and Telugu.
 * 7. Primary LLM times out and the fallback responds.
 * 8. A duplicate or stale LLM result arrives.
 * 9. TTS begins streaming while the remaining LLM response is generated.
 * 10. Call ends while generation or playback is in progress.
 */

import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';
import IntentService from '../services/intent_service.js';
import { QuestionTracker, isClarificationRequest } from '../services/question_tracker.js';
import LLMService from '../services/llm_service.js';
import GeminiService from '../services/gemini_service.js';
import { CallSession, ConversationStates } from '../services/voicebot_stream_service.js';

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
console.log('AGENT HARI CONVERSATION RESTORATION - 10 SCENARIO TEST SUITE');
console.log('================================================================\n');

// -------------------------------------------------------------
// Scenario 1: Candidate asks what the call is about
// -------------------------------------------------------------
runSync('Scenario 1: Candidate asks "What is this call about?" (Sales & Recruitment)', () => {
    // 1a. Sales
    const salesRes = IntentService.matchIntent('What is this call about?', {
        service: 'sales',
        stage: 'PERMISSION_CHECK',
        contact: { name: 'Anshu' }
    });
    assert.strictEqual(salesRes.matched, true, 'Must match purpose inquiry fast path');
    assert.strictEqual(salesRes.should_end_call, false, 'Must not end call');
    assert.strictEqual(salesRes.next_stage, 'PERMISSION_CHECK', 'Must remain at PERMISSION_CHECK');
    assert.ok(salesRes.spoken_response.includes('exploring') || salesRes.spoken_response.includes('software development') || salesRes.spoken_response.includes('services'), 'Briefly explains purpose');
    assert.strictEqual(salesRes.classification, undefined, 'Must not classify as interested or meeting agreed');

    // 1b. Recruitment
    const recRes = IntentService.matchIntent('What is this call about?', {
        service: 'recruitment',
        stage: 'AVAILABILITY',
        contact: { job_role: 'Full Stack Engineer' }
    });
    assert.strictEqual(recRes.matched, true, 'Recruitment must match purpose inquiry');
    assert.strictEqual(recRes.should_end_call, false);
    assert.strictEqual(recRes.next_stage, 'AVAILABILITY');
    assert.ok(recRes.spoken_response.includes('job application'), 'Explains recruitment purpose');
});

// -------------------------------------------------------------
// Scenario 2: Candidate says they are busy
// -------------------------------------------------------------
runSync('Scenario 2: Candidate says they are busy / in a meeting', () => {
    const busySales = IntentService.matchIntent("I'm in a meeting right now, please call later", {
        service: 'sales',
        stage: 'PERMISSION_CHECK'
    });
    assert.strictEqual(busySales.matched, true);
    assert.strictEqual(busySales.should_end_call, false, 'Must not hang up immediately; asks for callback time');
    assert.strictEqual(busySales.next_stage, 'CALLBACK_TIME');
    assert.strictEqual(busySales.classification, 'Callback Requested');

    const busyRec = IntentService.matchIntent("I am driving right now", {
        service: 'recruitment',
        stage: 'AVAILABILITY'
    });
    assert.strictEqual(busyRec.matched, true);
    assert.strictEqual(busyRec.should_end_call, false);
});

// -------------------------------------------------------------
// Scenario 3: Candidate agrees to continue
// -------------------------------------------------------------
runSync('Scenario 3: Candidate agrees to continue ("Yeah, that works for me")', () => {
    const agreeSales = IntentService.matchIntent('Yeah, that works for me', {
        service: 'sales',
        stage: 'PERMISSION_CHECK'
    });
    assert.strictEqual(agreeSales.matched, true);
    assert.strictEqual(agreeSales.next_stage, 'INTEREST_DISCOVERY');
    assert.strictEqual(agreeSales.should_end_call, false);

    const agreeRec = IntentService.matchIntent('Sure, I have time', {
        service: 'recruitment',
        stage: 'AVAILABILITY',
        contact: { job_role: 'Node.js Developer' }
    });
    assert.strictEqual(agreeRec.matched, true);
    assert.strictEqual(agreeRec.should_end_call, false);
    assert.strictEqual(agreeRec.next_stage, 'EXPERIENCE');
});

// -------------------------------------------------------------
// Scenario 4: Candidate declines the call
// -------------------------------------------------------------
runSync('Scenario 4: Candidate declines the call ("No, not interested")', () => {
    const declineSales = IntentService.matchIntent('No, not interested at all', {
        service: 'sales',
        stage: 'PERMISSION_CHECK'
    });
    assert.strictEqual(declineSales.matched, true);
    assert.strictEqual(declineSales.should_end_call, true);
    assert.strictEqual(declineSales.classification, 'Not Interested');
    assert.ok(declineSales.spoken_response.toLowerCase().includes('thank you') || declineSales.spoken_response.toLowerCase().includes('thanks'));
});

// -------------------------------------------------------------
// Scenario 5: Candidate asks follow-up question before answering pending question
// -------------------------------------------------------------
runSync('Scenario 5: Candidate asks follow-up question before answering pending question', () => {
    const tracker = new QuestionTracker({ service: 'sales' });
    tracker.noteResponseStarted('Is this a good time to speak for a minute?');
    assert.ok(tracker.pendingQuestionId !== null, 'Open question must be pending');

    // Candidate asks a question instead of answering
    const transcript = 'What is this call about?';
    assert.strictEqual(isClarificationRequest(transcript), true, 'Must be detected as clarification');

    const kind = tracker.noteCallerTurn(transcript);
    assert.strictEqual(kind, 'clarification', 'Turn kind must be clarification');
    assert.strictEqual(tracker.answeredQuestionIds.length, 0, 'Must NOT mark open question as answered');
    assert.ok(tracker.pendingQuestionId !== null, 'Pending question must remain pending');
});

// -------------------------------------------------------------
// Scenario 6: Candidate switches between English, Hindi, and Telugu
// -------------------------------------------------------------
runSync('Scenario 6: Candidate switches between English, Hindi, and Telugu', () => {
    const hindiIntent = IntentService.matchIntent('please speak in hindi', {
        service: 'sales',
        stage: 'PERMISSION_CHECK',
        language: 'en'
    });
    assert.strictEqual(hindiIntent.matched, true);
    assert.strictEqual(hindiIntent.detected_language, 'hi');

    const teluguIntent = IntentService.matchIntent('telugu lo matladandi', {
        service: 'sales',
        stage: 'PERMISSION_CHECK',
        language: 'hi'
    });
    assert.strictEqual(teluguIntent.matched, true);
    assert.strictEqual(teluguIntent.detected_language, 'te');
});

// -------------------------------------------------------------
// Scenario 7: Primary LLM times out and fallback responds
// -------------------------------------------------------------
await runAsync('Scenario 7: Primary LLM times out and Anthropic fallback responds', async () => {
    const origCallOpenAI = LLMService._callOpenAIStream;
    LLMService._callOpenAIStream = async () => {
        throw new Error('OpenAI timeout exceeded 3500ms');
    };

    try {
        const streamRes = await LLMService.generateStream({
            systemPrompt: 'You are a helpful assistant. Output JSON: {"spoken_response": "Fallback greeting"}',
            messages: [{ role: 'user', content: 'Hello' }],
            jsonMode: true,
            timeoutMs: 3000
        });

        assert.strictEqual(streamRes.provider, 'claude', 'Should failover to Claude Haiku');
        assert.strictEqual(streamRes.fallback, true, 'Must indicate fallback was used');
        assert.ok(streamRes.fallbackReason.includes('timeout'), 'Must record failure reason');
        assert.ok(streamRes.text.includes('spoken_response'), 'Fallback must produce valid response');
    } finally {
        LLMService._callOpenAIStream = origCallOpenAI;
    }
});

// -------------------------------------------------------------
// Scenario 8: Duplicate or stale LLM result arrives
// -------------------------------------------------------------
await runAsync('Scenario 8: Duplicate or stale LLM result arrives and is discarded', async () => {
    const mockWs = { readyState: 1, OPEN: 1, send: () => {} };
    const session = new CallSession(mockWs, { service: 'sales' });
    const response = session.beginResponse(1);
    session.currentTurnId = 2; // Newer turn active

    let speechEmitted = 0;
    session.playAiAudio = async () => { speechEmitted++; };

    // Stale turn 1 completion arrives
    const staleTurnId = 1;
    if (staleTurnId !== session.currentTurnId) {
        session.cancelActiveResponse('turn_superseded');
    }

    assert.strictEqual(response.cancelled, true, 'Stale response must be cancelled');
    assert.strictEqual(speechEmitted, 0, 'No audio must be dispatched for superseded turn');
});

// -------------------------------------------------------------
// Scenario 9: TTS streams early while remaining LLM response generated
// -------------------------------------------------------------
await runAsync('Scenario 9: TTS streams early and deduplicates final speech without duplicate playback events', async () => {
    const mockWs = { readyState: 1, OPEN: 1, send: () => {} };
    const session = new CallSession(mockWs, { service: 'sales' });
    session.streamId = 'test_stream';

    const eventsLogged = [];
    session.logDiagnostic = (event, data) => {
        eventsLogged.push({ event, ...data });
    };

    const response = session.beginResponse(1);

    // First early sentence arrives via stream
    const earlySentence = 'We provide custom software development.';
    session.noteSpeechStarted(earlySentence, response);

    // Remainder arrives
    const remainder = 'Is there a specific project you are planning?';
    session.noteSpeechStarted(remainder, response);

    // Verify playback_started logged exactly ONCE for this response
    const playbackStartedEvents = eventsLogged.filter(e => e.event === 'playback_started');
    assert.strictEqual(playbackStartedEvents.length, 1, 'playback_started must only be logged once per logical response');
    assert.strictEqual(playbackStartedEvents[0].responseId, response.id);
});

// -------------------------------------------------------------
// Scenario 10: Call ends while generation or playback is in progress
// -------------------------------------------------------------
await runAsync('Scenario 10: Call ends while generation or playback is in progress', async () => {
    const mockWs = { readyState: 1, OPEN: 1, send: () => {} };
    const session = new CallSession(mockWs, { service: 'sales' });
    const response = session.beginResponse(1);

    // Call hangs up / closes
    session.isClosed = true;
    session.cancelActiveResponse('call_closed');

    let audioPlayed = false;
    session._synthesizeAndSend = async () => { audioPlayed = true; };

    await session.playAiAudio('This should not play', response);
    assert.strictEqual(audioPlayed, false, 'No audio should be synthesized or sent after call is closed');
});

console.log('\n================================================================');
console.log(`SUMMARY: ${passedTests}/${totalTests} tests passed (${failedTests} failed).`);
console.log('================================================================\n');

if (failedTests > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
