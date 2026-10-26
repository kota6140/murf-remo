/**
 * tests/call_flow_regression.test.js
 *
 * Regression tests for the call flow: greeting, silence, repeated questions and the response lifecycle.
 * Speech-to-text, the AI, text-to-speech and the phone connection are all mocked, so the real CallSession
 * code runs end to end without any network. The database is pointed at a dead port and call saving is
 * stubbed, so nothing is ever written.
 *
 *  A. QuestionTracker: topics, duplicates, answered/asked, reply guard, de-duplication of spoken text
 *  B. The 12 call scenarios:
 *     1. "Yes" to the availability question -> the first screening question, once
 *     2. "Of course" -> the call continues (never the greeting again, never silence)
 *     3. "No, I'm busy" -> callback offered
 *     4. A technical answer is recorded and a *different* unanswered question follows
 *     5. A pause in the middle of a sentence is not treated as the end of the turn
 *     6. The caller interrupts -> stale audio is cancelled, the caller's words are kept
 *     7. The same reply arriving through early streaming and completion plays once
 *     8. Text-to-speech finishing after the AI is done: state stays consistent, no duplicate audio
 *     9. A full Hindi utterance -> the reply language is Hindi
 *    10. "ha", "uh", "hmm", "okay" never switch the language
 *    11. Recruitment, sales and support keep their own flows
 *    12. The line closing during speech triggers nothing more
 *
 * Run:  node tests/call_flow_regression.test.js
 */
import assert from 'assert';

// Never touch a real database or the paid voice service from this test.
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '1';
process.env.SKIP_TTS_PRECACHE = '1';
process.env.RECRUITMENT_VAD_SILENCE_MS = '1400';

const { CallSession, ConversationStates } = await import('../services/voicebot_stream_service.js');
const { default: ElevenLabsService } = await import('../services/elevenlabs_service.js');
const { default: GeminiService } = await import('../services/gemini_service.js');
const { default: IntentService } = await import('../services/intent_service.js');
const { ConversationMemory } = await import('../services/conversation_memory.js');
const Q = await import('../services/question_tracker.js');
const { QuestionTracker, stripAlreadySpoken } = Q;

let total = 0;
let passed = 0;
const failures = [];
const realLog = console.log;
const realWarn = console.warn;

async function test(name, fn) {
    total++;
    console.log = () => {};       // the call code logs a lot; keep the report readable
    console.warn = () => {};
    try {
        await fn();
        passed++;
        console.log = realLog; console.warn = realWarn;
        realLog(`  ok   ${name}`);
    } catch (e) {
        console.log = realLog; console.warn = realWarn;
        failures.push(name);
        realLog(`  FAIL ${name}\n       ${e.message}`);
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, ms = 3000) {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > ms) throw new Error('timed out waiting for a condition');
        await sleep(10);
    }
}

// ---------------------------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------------------------
const PLAN = [
    { id: 'q_availability', stage: 'AVAILABILITY', text: 'Hi, do you have a couple of minutes to talk about the role?', field_to_collect: 'is_available' },
    { id: 'q_experience', stage: 'EXPERIENCE', text: 'Could you briefly tell me about your recent development experience?', field_to_collect: 'experience_summary' },
    { id: 'q_technical_skills', stage: 'SKILLS', text: 'Which frontend and backend technologies have you used most?', field_to_collect: 'technical_skills' },
    { id: 'q_notice_period', stage: 'LOGISTICS', text: 'What is your official notice period, or are you available to join immediately?', field_to_collect: 'notice_period_days' },
    { id: 'q_candidate_questions', stage: 'CANDIDATE_QUESTIONS', text: 'Before we wrap up, do you have any questions for me about the role?', field_to_collect: 'candidate_inquiry' }
];

let ttsLog = [];          // every text sent to text-to-speech
let ttsChunkCount = 3;    // 20ms of audio per chunk
let ttsChunkDelayMs = 4;
let sttQueue = [];
let sttCalls = [];        // the language asked for on each speech-to-text request
let llmScript = [];       // functions (options) => reply
let llmCalls = [];

ElevenLabsService.isConfigured = () => true;
ElevenLabsService.getCachedAudio = () => null;
ElevenLabsService.speechToText = async (buf, name, lang) => { sttCalls.push(lang || null); return sttQueue.shift() || { transcript: '', language: 'en' }; };
ElevenLabsService.textToSpeech = async (text, opts = {}) => {
    ttsLog.push(text);
    const chunk = Buffer.alloc(160, 0x7f);
    const parts = [];
    for (let i = 0; i < ttsChunkCount; i++) {
        await sleep(ttsChunkDelayMs);
        if (opts.onChunk) opts.onChunk(chunk);
        parts.push(chunk);
    }
    return Buffer.concat(parts);
};
GeminiService.generateReply = async (service, contact, history, transcript, collected, options = {}) => {
    llmCalls.push({ service, transcript, options });
    const step = llmScript.shift();
    if (!step) throw new Error('no scripted AI reply left');
    return step(options);
};

function resetMocks() {
    ttsLog = []; sttQueue = []; sttCalls = []; llmScript = []; llmCalls = [];
    ttsChunkCount = 3; ttsChunkDelayMs = 4;
}

function createMockWs() {
    return {
        OPEN: 1, readyState: 1, sent: [],
        send(data) { this.sent.push(JSON.parse(data)); },
        close() { this.readyState = 3; }
    };
}

function makeSession(service = 'recruitment', params = {}) {
    const ws = createMockWs();
    const session = new CallSession(ws, { service, callerName: 'Priya Sharma', role: 'Backend Developer', ...params });
    session.streamId = 'st_test';
    session.persistCallResults = async () => {};
    session.questionPlan = service === 'recruitment' ? PLAN : null;
    session.memory = new ConversationMemory({ service, questionPlan: session.questionPlan });
    session.questions.registerPlan(session.questionPlan);
    return session;
}

async function callerSays(session, transcript, language = 'en', bytes = 3200) {
    sttQueue.push({ transcript, language });
    session.callerMulawChunks = [Buffer.alloc(bytes, 0x10)];
    await session.processCallerTurn();
}
const playbackDone = (s) => waitFor(() => !s.isAiSpeaking && s.pendingSpeech === 0);

const speechFrame = Buffer.alloc(160, 0).map((_, i) => (i % 2 === 0 ? 0x10 : 0x90));
const silenceFrame = Buffer.alloc(160, 0xFF);
const feed = async (s, frame, n) => { for (let i = 0; i < n; i++) await s.handleInboundAudio(frame); };
const audioMessages = (s) => s.ws.sent.filter(m => m.event === 'playAudio');

// ---------------------------------------------------------------------------------------------
// A. QuestionTracker
// ---------------------------------------------------------------------------------------------
realLog('\nA. Question tracker');

const TECH_A = "Could you tell me a bit about the main technologies you've used at MyGIO, especially on the frontend and backend?";
const TECH_B = 'Could you tell me which frontend and backend technologies you used most at MyGIO?';

await test('the two repeated questions from the call logs are recognised as the same question', () => {
    assert.strictEqual(Q.topicOf(TECH_A), 'tech_stack');
    assert.strictEqual(Q.topicOf(TECH_B), 'tech_stack');
    const t = new QuestionTracker({ service: 'recruitment' });
    t.noteResponseStarted(TECH_A);
    t.noteCallerTurn('I used React on the frontend and Node with MongoDB on the backend at MyGIO');
    const verdict = t.checkQuestion(TECH_B);
    assert.strictEqual(verdict.duplicate, true);
});

await test('a question is "asked" when its audio starts and "answered" only by a real answer', () => {
    const t = new QuestionTracker({ service: 'recruitment' });
    t.noteResponseStarted(PLAN[1].text);
    assert.deepStrictEqual(t.askedQuestionIds.length, 1);
    assert.strictEqual(t.pendingQuestionId !== null, true);
    assert.strictEqual(t.noteCallerTurn('Sure'), 'filler');
    assert.strictEqual(t.answeredQuestionIds.length, 0, '"Sure" does not answer a request for information');
    assert.strictEqual(t.noteCallerTurn('I have built Node and React apps for five years'), 'answer');
    assert.strictEqual(t.answeredQuestionIds.length, 1);
    assert.strictEqual(t.pendingQuestionId, null);
});

await test('"yes" answers a yes/no question but not a request such as "could you tell me..."', () => {
    assert.strictEqual(Q.isYesNoQuestion('Are you comfortable with the Hyderabad work arrangement?'), true);
    assert.strictEqual(Q.isYesNoQuestion('Is this a good time to speak for a minute?'), true);
    assert.strictEqual(Q.isYesNoQuestion('Could you briefly tell me about your recent development experience?'), false);
    assert.strictEqual(Q.isYesNoQuestion('What is your official notice period?'), false);
    const t = new QuestionTracker();
    t.noteResponseStarted('Is this a good time to speak for a minute?');
    t.noteCallerTurn('Yes, of course');
    assert.strictEqual(t.answeredQuestionIds.length, 1);
});

await test('"what do you mean?" and "and then?" are not answers; a clarification may repeat the question', () => {
    const t = new QuestionTracker();
    t.noteResponseStarted(TECH_A);
    assert.strictEqual(t.noteCallerTurn('Sorry, what do you mean?'), 'clarification');
    assert.strictEqual(t.pendingQuestionId !== null, true, 'still open');
    assert.strictEqual(t.checkQuestion(TECH_B, { clarification: true }).duplicate, false);
    assert.strictEqual(t.noteCallerTurn('And then?'), 'continuation');
    assert.strictEqual(t.answeredQuestionIds.length, 0);
});

await test('one follow-up is allowed after a very short answer, never a third question on the same topic', () => {
    const t = new QuestionTracker();
    t.noteResponseStarted(TECH_A);
    t.noteCallerTurn('React'); // too short to be complete
    assert.strictEqual(t.checkQuestion('Which backend technologies did you use?').duplicate, false, 'first follow-up allowed');
    assert.strictEqual(t.checkQuestion('And which databases did you use with it?').duplicate, true, 'a second one is not');
});

await test('guardReply swaps a repeated question for the next planned one and keeps the acknowledgement', () => {
    const t = new QuestionTracker({ service: 'recruitment' });
    t.registerPlan(PLAN);
    t.noteResponseStarted(PLAN[1].text);
    t.noteCallerTurn('I have been a full stack developer for about five years across two product companies');
    t.noteResponseStarted(TECH_A);
    t.noteCallerTurn('I worked with React, Redux, Node, Express and MongoDB at MyGIO for three years');
    const out = t.guardReply(`Thanks for sharing. ${TECH_B}`);
    assert.strictEqual(out.changed, true);
    assert.ok(out.text.startsWith('Thanks for sharing.'));
    assert.ok(out.text.includes('notice period'), out.text);
    assert.ok(!/frontend/i.test(out.text));
});

await test('guardReply never repeats an opener and never leaves a reply that is only "Sure."', () => {
    const t = new QuestionTracker({ service: 'recruitment' });
    t.registerPlan(PLAN);
    t.noteResponseStarted('Of course. Could you briefly tell me about your recent development experience?');
    t.noteCallerTurn('I have been building Node and React applications for about five years now');
    const out = t.guardReply('Of course. Thanks for that.');
    assert.ok(!out.text.startsWith('Of course'), `opener dropped: ${out.text}`);
    const ackOnly = t.guardReply('Sure.');
    assert.ok(ackOnly.text.includes('?'), 'a next question is added so the call is never left waiting');
});

await test('the availability question is never chosen as the next planned question', () => {
    const t = new QuestionTracker({ service: 'recruitment' });
    t.registerPlan(PLAN);
    assert.strictEqual(t.nextUnanswered().id, 'q_experience');
});

await test('the screening is reported complete when every planned question was asked', () => {
    const t = new QuestionTracker({ service: 'recruitment' });
    t.registerPlan(PLAN);
    for (const p of PLAN.slice(1)) { t.noteResponseStarted(p.text); t.noteCallerTurn('Here is my complete answer for that question, thank you'); }
    const out = t.guardReply(`Great. ${TECH_B}`);
    assert.strictEqual(out.exhausted, true);
});

await test('text already spoken while streaming is removed from the final text, even when worded a little differently', () => {
    assert.strictEqual(stripAlreadySpoken('Of course. What is your notice period?', ['Of course.']), 'What is your notice period?');
    assert.strictEqual(stripAlreadySpoken('Sure, got it. What is your notice period?', ['Of course.']), 'What is your notice period?', 'two acknowledgements are the same thing');
    assert.strictEqual(stripAlreadySpoken('Could you share your notice period?', ['Of course.']), 'Could you share your notice period?');
});

// ---------------------------------------------------------------------------------------------
// B. The call scenarios
// ---------------------------------------------------------------------------------------------
realLog('\nB. Call scenarios');

await test('1. greeting, then identity, then availability: each spoken once, in order, then the first question once', async () => {
    resetMocks();
    const s = makeSession();
    await s.deliverOpeningGreeting();
    await playbackDone(s);
    assert.strictEqual(ttsLog[0], 'Hello, am I speaking with Priya Sharma?');
    assert.strictEqual(s.currentStage, 'GREETING');
    await callerSays(s, 'Yes');
    await playbackDone(s);
    assert.strictEqual(ttsLog[1], 'Hi, this is Remo, an AI calling assistant from ScoreLabs Inc. Is this a good time to speak for a minute?');
    assert.strictEqual(s.currentStage, 'AVAILABILITY');
    await callerSays(s, 'Yes');
    await playbackDone(s);
    assert.strictEqual(ttsLog.length, 3, `exactly three utterances, got ${JSON.stringify(ttsLog)}`);
    assert.ok(ttsLog[2].includes('recent development experience'));
    assert.ok(!ttsLog.slice(2).some(t => /good time|couple of minutes/i.test(t)), 'availability is never asked again');
    assert.strictEqual(llmCalls.length, 0, 'no AI call needed for the opening');
    assert.strictEqual(s.questions.callStage, 'SCREENING');
});

await test('1b. with no verified name Remo introduces itself directly and "yes" goes to the first question', async () => {
    resetMocks();
    const s = makeSession('recruitment', { callerName: '' });
    await s.deliverOpeningGreeting();
    await playbackDone(s);
    assert.ok(ttsLog[0].startsWith('Hi, this is Remo, an AI calling assistant from ScoreLabs Inc.'));
    assert.strictEqual(s.currentStage, 'AVAILABILITY');
    await callerSays(s, 'Yeah sure');
    await playbackDone(s);
    assert.ok(ttsLog[1].includes('recent development experience'));
});

await test('2. "Of course" continues the call: no repeated greeting, no silence', async () => {
    resetMocks();
    const s = makeSession();
    await s.deliverOpeningGreeting();
    await playbackDone(s);
    await callerSays(s, 'Yes');                       // identity confirmed
    await playbackDone(s);
    await callerSays(s, 'Of course');                 // consent to talk
    await playbackDone(s);
    assert.ok(ttsLog[2].includes('recent development experience'), ttsLog[2]);
    // "Of course" to a request for information is consent to answer: Remo invites the answer, once, and waits.
    await callerSays(s, 'Of course, yes');
    await playbackDone(s);
    assert.strictEqual(ttsLog.length, 4);
    assert.ok(/go ahead/i.test(ttsLog[3]), ttsLog[3]);
    assert.strictEqual(s.questions.answeredQuestionIds.filter(id => id === 'q_experience').length, 0, 'the question is still open');
});

await test('3. "No, I\'m busy" offers a callback and asks no screening question', async () => {
    resetMocks();
    const s = makeSession('recruitment', { callerName: '' });
    await s.deliverOpeningGreeting();
    await playbackDone(s);
    await callerSays(s, "No, I'm busy");
    await playbackDone(s);
    assert.ok(/better time/i.test(ttsLog[1]), ttsLog[1]);
    assert.strictEqual(s.currentStage, 'CALLBACK_TIME');
    assert.ok(!ttsLog.some(t => /experience|notice period/i.test(t)));
});

await test('4. a technical answer is recorded and a different, unanswered question follows', async () => {
    resetMocks();
    const s = makeSession();
    s.currentStage = 'SKILLS';
    s.greetingDelivered = true;
    await s.playAiAudio(PLAN[1].text, s.beginResponse(1));  // the experience question was asked and answered earlier
    await playbackDone(s);
    s.questions.noteCallerTurn('I have been a full stack developer for about five years in product companies');
    await s.playAiAudio(TECH_A, s.beginResponse(2));        // then Remo asked the technology question
    await playbackDone(s);
    ttsLog = [];
    llmScript.push(() => ({
        spoken_response: `Thanks for sharing. ${TECH_B}`, // the AI asks the same thing again, reworded
        detected_language: 'en', should_end_call: false, extracted_fields: {}, next_stage: 'SKILLS'
    }));
    await callerSays(s, 'I used React and Redux on the frontend and Node with Express and MongoDB on the backend at MyGIO for three years');
    await playbackDone(s);
    const spoken = ttsLog.join(' ');
    assert.ok(!/frontend/i.test(spoken), `the repeated question must not be spoken: ${spoken}`);
    assert.ok(/notice period/i.test(spoken), `the next unanswered question is asked: ${spoken}`);
    assert.ok(s.questions.answeredQuestionIds.length >= 1, 'the technical answer is recorded');
});

await test('5. a pause in the middle of a sentence is not the end of the turn; the real end is', async () => {
    resetMocks();
    const s = makeSession();
    s.currentStage = 'EXPERIENCE';
    s.greetingDelivered = true;
    let turns = 0;
    const real = s.processCallerTurn.bind(s);
    s.processCallerTurn = async () => { turns++; return real(); };
    await feed(s, speechFrame, 40);                 // 0.8s of speech
    await feed(s, silenceFrame, 60);                // 1.2s thinking pause (the wait is 1.4s)
    assert.strictEqual(turns, 0, 'must not respond during a thinking pause');
    assert.strictEqual(s.conversationState, ConversationStates.WAITING_FOR_END_OF_TURN);
    await feed(s, speechFrame, 30);                 // the caller continues
    assert.strictEqual(s.conversationState, ConversationStates.CANDIDATE_SPEAKING);
    await feed(s, silenceFrame, 75);                // 1.5s of silence: really finished
    assert.strictEqual(turns, 1);
});

await test('5b. a short "yes" right after the greeting is answered sooner, a long answer keeps the patient wait', async () => {
    resetMocks();
    const brief = makeSession();
    brief.currentStage = 'AVAILABILITY';
    brief.greetingDelivered = true;
    let briefTurns = 0;
    const realBrief = brief.processCallerTurn.bind(brief);
    brief.processCallerTurn = async () => { briefTurns++; return realBrief(); };
    await feed(brief, speechFrame, 15);             // "yes, of course"
    await feed(brief, silenceFrame, 36);            // 0.72s
    assert.strictEqual(briefTurns, 1, 'a short answer to the availability question is answered after ~0.7s');

    const long = makeSession();
    long.currentStage = 'AVAILABILITY';
    long.greetingDelivered = true;
    let longTurns = 0;
    long.processCallerTurn = async () => { longTurns++; };
    await feed(long, speechFrame, 45);              // a long utterance
    await feed(long, silenceFrame, 45);             // 0.9s pause
    assert.strictEqual(longTurns, 0, 'a long utterance is never cut off by the short wait');
});

await test('6. the caller interrupts: the rest of the reply is cancelled and the caller\'s words are kept', async () => {
    resetMocks();
    ttsChunkCount = 25; ttsChunkDelayMs = 12;      // a long reply
    const s = makeSession();
    s.greetingDelivered = true;
    const response = s.beginResponse(1);
    const playing = s.playAiAudio('This is a long reply that the caller will interrupt part of the way through.', response);
    s.playAiAudio('And this is a second sentence that must never be heard.', response).catch(() => {});
    await waitFor(() => audioMessages(s).length >= 3);
    await feed(s, speechFrame, 36);                // 0.72s of sustained speech while Remo is talking
    assert.strictEqual(response.cancelled, true);
    assert.ok(s.ws.sent.some(m => m.event === 'clearAudio'), 'Plivo is told to drop queued audio');
    assert.strictEqual(s.conversationState, ConversationStates.CANDIDATE_SPEAKING);
    assert.ok(s.callerMulawChunks.length >= 35, 'the caller\'s words are kept');
    const clearedAt = s.ws.sent.findIndex(m => m.event === 'clearAudio');
    await playing;
    await sleep(60);
    const after = s.ws.sent.slice(clearedAt + 1).filter(m => m.event === 'playAudio');
    assert.strictEqual(after.length, 0, 'no stale audio is sent after the interruption');
    assert.ok(!ttsLog.some(t => t.includes('second sentence')), 'queued speech never started');
});

await test('7. the same reply through early streaming and completion plays once', async () => {
    resetMocks();
    const s = makeSession();
    s.currentStage = 'EXPERIENCE';
    s.greetingDelivered = true;
    llmScript.push(async (options) => {
        options.onSpokenSentence('Great, thanks for that.', true, false);   // the early phrase
        await sleep(30);
        return {
            spoken_response: 'Great, thanks for that. What is your official notice period?',
            detected_language: 'en', should_end_call: false, extracted_fields: {},
            emittedSentences: ['Great, thanks for that.']
        };
    });
    await callerSays(s, 'I have been working as a backend engineer for around five years in total');
    await playbackDone(s);
    assert.deepStrictEqual(ttsLog, ['Great, thanks for that.', 'What is your official notice period?']);
});

await test('7b. when the backup AI finishes the reply (nothing reported as streamed), the opener is not heard twice', async () => {
    resetMocks();
    const s = makeSession();
    s.currentStage = 'EXPERIENCE';
    s.greetingDelivered = true;
    llmScript.push(async (options) => {
        options.onSpokenSentence('Of course.', true, false);
        await sleep(20);
        return {
            spoken_response: 'Of course, understood. What is your official notice period?', // different wording, no emittedSentences
            detected_language: 'en', should_end_call: false, extracted_fields: {}
        };
    });
    await callerSays(s, 'I would say I have around four years of hands on experience in total');
    await playbackDone(s);
    const openers = ttsLog.filter(t => /^(of course|sure|understood)/i.test(t));
    assert.strictEqual(openers.length, 1, `one acknowledgement only, got ${JSON.stringify(ttsLog)}`);
    assert.ok(ttsLog.some(t => /notice period/.test(t)));
});

await test('8. the state does not return to listening while audio is still playing, and nothing plays twice', async () => {
    resetMocks();
    ttsChunkCount = 15; ttsChunkDelayMs = 10;      // ~300ms of audio per sentence
    const s = makeSession();
    s.currentStage = 'EXPERIENCE';
    s.greetingDelivered = true;
    llmScript.push(async (options) => {
        options.onSpokenSentence('Understood.', true, false);
        return { spoken_response: 'Understood. What is your official notice period?', detected_language: 'en', should_end_call: false, extracted_fields: {}, emittedSentences: ['Understood.'] };
    });
    await callerSays(s, 'I have been working as a backend engineer for around five years in total');
    // The AI finished and every sentence was handed over, but the caller is still hearing the audio.
    assert.ok(s.isAiSpeaking, 'audio is still playing');
    assert.strictEqual(s.conversationState, ConversationStates.SPEAKING, 'state must stay SPEAKING until playback completes');
    assert.strictEqual(s.isProcessingTurn, false, 'the turn itself is released');
    await playbackDone(s);
    assert.strictEqual(s.conversationState, ConversationStates.LISTENING);
    assert.deepStrictEqual(ttsLog, ['Understood.', 'What is your official notice period?']);
    assert.strictEqual(s.activeResponse.phase, 'PLAYBACK_COMPLETED');
});

await test('8b. Plivo\'s "played" checkpoint ends the speaking state; a stale checkpoint changes nothing', async () => {
    resetMocks();
    const s = makeSession();
    s.greetingDelivered = true;
    await s.playAiAudio('Thank you.', s.beginResponse(1));
    const checkpoints = s.ws.sent.filter(m => m.event === 'checkpoint');
    assert.strictEqual(checkpoints.length, 1, 'one checkpoint after the speech was sent');
    assert.ok(s.isAiSpeaking);
    s.handlePlaybackCheckpoint('cp_some_old_checkpoint');
    assert.ok(s.isAiSpeaking, 'a checkpoint from an earlier reply is ignored');
    s.handlePlaybackCheckpoint(checkpoints[0].name);
    assert.strictEqual(s.isAiSpeaking, false);
    assert.strictEqual(s.conversationState === ConversationStates.SPEAKING, false);
});

await test('8c. the same words finalised twice while the reply is active are answered once', async () => {
    resetMocks();
    const s = makeSession('recruitment', { callerName: '' });
    await s.deliverOpeningGreeting();
    await playbackDone(s);
    await callerSays(s, 'Yes');                      // replies with the first question
    const spokenBefore = ttsLog.length;
    await callerSays(s, 'Yes');                      // the same transcript again, straight away
    await playbackDone(s);
    assert.strictEqual(ttsLog.length, spokenBefore, 'the second copy produced no second reply');
});

await test('9. a full Hindi utterance switches to Hindi and the reply is generated in Hindi', async () => {
    resetMocks();
    const s = makeSession();
    s.currentStage = 'EXPERIENCE';
    s.greetingDelivered = true;
    llmScript.push(() => ({ spoken_response: 'धन्यवाद। आपका नोटिस पीरियड क्या है?', detected_language: 'hi', should_end_call: false, extracted_fields: {} }));
    await callerSays(s, 'मुझे यह नौकरी चाहिए और मेरा अनुभव तीन साल का है', 'hi');
    await playbackDone(s);
    assert.strictEqual(s.detectedLanguage, 'hi');
    assert.strictEqual(llmCalls[0].options.detectedLanguage, 'hi', 'the AI is asked to reply in Hindi');
});

await test('10. "ha", "uh", "hmm" and "okay" never switch the language, even when speech-to-text labels them Hindi', async () => {
    for (const word of ['ha', 'uh', 'hmm', 'okay']) {
        resetMocks();
        const s = makeSession();
        s.currentStage = 'EXPERIENCE';
        s.greetingDelivered = true;
        llmScript.push(() => ({ spoken_response: 'Got it.', detected_language: 'en', should_end_call: false, extracted_fields: {} }));
        await callerSays(s, word, 'hi');
        await sleep(20);
        assert.strictEqual(s.detectedLanguage, 'en', `"${word}" must not switch the language`);
    }
});

await test('10b. in the availability stage "uh-huh" is read as yes and does not restart the greeting', async () => {
    resetMocks();
    const s = makeSession('recruitment', { callerName: '' });
    await s.deliverOpeningGreeting();
    await playbackDone(s);
    await callerSays(s, 'Uh-huh', 'hi');
    await playbackDone(s);
    assert.strictEqual(s.detectedLanguage, 'en');
    assert.ok(ttsLog[1] && ttsLog[1].includes('recent development experience'), JSON.stringify(ttsLog));
});

await test('11. recruitment, sales and support keep their own flows and question records', async () => {
    resetMocks();
    const sales = makeSession('sales', { callerName: '' });
    const support = makeSession('support', { callerName: '' });
    const recruit = makeSession('recruitment');
    assert.strictEqual(sales.questions.serviceType, 'sales');
    assert.strictEqual(sales.questions.plan.length, 0, 'the recruitment plan does not leak into a sales call');
    assert.strictEqual(support.questions.plan.length, 0);
    assert.strictEqual(recruit.questions.plan.length, PLAN.length);

    const salesYes = IntentService.matchIntent('Yes', { service: 'sales', stage: 'PERMISSION_CHECK', questions: sales.questions });
    assert.ok(/services/i.test(salesYes.spoken_response) && !/notice period|experience/i.test(salesYes.spoken_response));
    const supportYes = IntentService.matchIntent('Yes', { service: 'support', stage: 'AVAILABILITY', questions: support.questions });
    assert.ok(/issue|error/i.test(supportYes.spoken_response) && !/notice period|experience/i.test(supportYes.spoken_response));

    // Without a question plan a repeated question is reported but never rewritten into a recruitment question.
    sales.questions.noteResponseStarted('Could you tell me a little about what you are looking for?');
    sales.questions.noteCallerTurn('We need a billing portal with payments and subscriptions for our company');
    const guarded = sales.questions.guardReply('Great. Could you explain your project requirements?', { enforceQuestions: false });
    assert.ok(!/notice period/i.test(guarded.text));
    assert.ok(guarded.notes.some(n => /duplicate question detected/.test(n)));
});

await test('12. the line closing during speech triggers no further speech or state change', async () => {
    resetMocks();
    ttsChunkCount = 10; ttsChunkDelayMs = 15;
    const s = makeSession();
    s.currentStage = 'EXPERIENCE';
    s.greetingDelivered = true;
    const response = s.beginResponse(1);
    const first = s.playAiAudio('First sentence of the reply.', response);
    s.playAiAudio('Second sentence that must not be spoken.', response).catch(() => {});
    await waitFor(() => ttsLog.length === 1);
    await s.endCall();
    await first;
    await sleep(40);
    assert.ok(!ttsLog.some(t => t.includes('Second sentence')), 'the queued sentence is never synthesised');
    assert.strictEqual(s.conversationState, ConversationStates.COMPLETED);
    assert.strictEqual(response.cancelled, true);

    // The AI finishing after the call ended says nothing and changes nothing.
    resetMocks();
    const s2 = makeSession();
    s2.currentStage = 'EXPERIENCE';
    llmScript.push(async () => { await sleep(60); return { spoken_response: 'Thanks. What is your notice period?', detected_language: 'en', should_end_call: false, extracted_fields: {} }; });
    const turn = callerSays(s2, 'I have around five years of experience building backend services in Node');
    await sleep(15);
    await s2.endCall();
    await turn;
    await sleep(40);
    assert.strictEqual(ttsLog.length, 0, 'nothing is spoken after the call has closed');
    assert.strictEqual(s2.conversationState, ConversationStates.COMPLETED);
});

await test('13. a clarification request clarifies the open question and does not advance', async () => {
    resetMocks();
    const s = makeSession();
    s.currentStage = 'SKILLS';
    s.greetingDelivered = true;
    await s.playAiAudio(TECH_A, s.beginResponse(1));
    await playbackDone(s);
    ttsLog = [];
    llmScript.push(() => ({ spoken_response: `Sure. I mean which frontend and backend technologies you worked with at MyGIO?`, detected_language: 'en', should_end_call: false, extracted_fields: {} }));
    await callerSays(s, 'Sorry, what do you mean by that?');
    await playbackDone(s);
    assert.strictEqual(llmCalls[0].options.questionState.turnKind, 'clarification');
    assert.ok(/frontend and backend/i.test(ttsLog.join(' ')), 'the clarification of the same question is allowed');
    assert.strictEqual(s.questions.answeredQuestionIds.length, 0, 'a clarification request is not an answer');
});

await test('14. "and then?" gets a natural continuation of the open question, not a new topic', async () => {
    resetMocks();
    const s = makeSession();
    s.currentStage = 'EXPERIENCE';
    s.greetingDelivered = true;
    await s.playAiAudio(PLAN[1].text, s.beginResponse(1));
    await playbackDone(s);
    ttsLog = [];
    await callerSays(s, 'And then?');
    await playbackDone(s);
    assert.strictEqual(llmCalls.length, 0);
    assert.ok(ttsLog[0].includes('recent development experience'), ttsLog[0]);
});

await test('15. a slow text-to-speech request is given up on instead of blocking the call', async () => {
    resetMocks();
    const realTts = ElevenLabsService.textToSpeech;
    const realTimeout = process.env.TTS_TIMEOUT_MS;
    process.env.TTS_TIMEOUT_MS = '150';
    ElevenLabsService.textToSpeech = () => new Promise(() => {});   // never answers
    try {
        const s = makeSession();
        s.greetingDelivered = true;
        const started = Date.now();
        await Promise.race([
            s.playAiAudio('This will never be synthesised.', s.beginResponse(1)),
            sleep(2000).then(() => { throw new Error('the call hung waiting for text-to-speech'); })
        ]);
        assert.ok(Date.now() - started < 1500, 'gave up quickly');
        assert.strictEqual(s.pendingSpeech, 0, 'the speech queue is clear again');
        assert.strictEqual(s.questions.askedQuestionIds.length, 0, 'a question nobody heard is not counted as asked');
    } finally {
        ElevenLabsService.textToSpeech = realTts;
        if (realTimeout === undefined) delete process.env.TTS_TIMEOUT_MS; else process.env.TTS_TIMEOUT_MS = realTimeout;
    }
});

await test('16. every caller turn makes exactly one speech-to-text request', async () => {
    resetMocks();
    const s = makeSession('recruitment', { callerName: '' });
    await s.deliverOpeningGreeting();
    await playbackDone(s);
    await callerSays(s, 'Yes');
    await playbackDone(s);
    await callerSays(s, 'Sure, go ahead');
    await playbackDone(s);
    assert.deepStrictEqual(sttCalls, ['en', 'en'], `one request per turn, got ${JSON.stringify(sttCalls)}`);
});

await test('16b. a wrong language label ("lit") makes no second request; the words and the call language are kept', async () => {
    resetMocks();
    const s = makeSession();
    s.currentStage = 'EXPERIENCE';
    s.greetingDelivered = true;
    llmScript.push(() => ({ spoken_response: 'Thanks. What is your notice period?', detected_language: 'en', should_end_call: false, extracted_fields: {} }));
    await callerSays(s, 'Five PM works for me tomorrow', 'lit');
    await playbackDone(s);
    assert.deepStrictEqual(sttCalls, ['en'], 'only one speech-to-text request');
    assert.ok(s.conversationHistory.some(m => m.text === 'Five PM works for me tomorrow'), 'the words were kept');
    assert.strictEqual(s.detectedLanguage, 'en', 'the wrong label did not change the language');
});

await test('16c. words returned in Urdu letters are dropped as unclear audio, still with one request', async () => {
    resetMocks();
    const s = makeSession();
    s.currentStage = 'EXPERIENCE';
    s.greetingDelivered = true;
    await callerSays(s, 'زِکرَم', 'urd', 3200);
    await sleep(30);
    assert.deepStrictEqual(sttCalls, ['en'], 'no second request');
    assert.ok(!s.conversationHistory.some(m => /[؀-ۿ]/.test(m.text)), 'Urdu text never reaches the conversation');
    assert.strictEqual(llmCalls.length, 0, 'the AI was not asked about unreadable words');
    assert.strictEqual(s.isProcessingTurn, false);
});

// ---------------------------------------------------------------------------------------------
realLog(`\n${passed}/${total} call flow tests passed\n`);
if (failures.length) realLog(`Failed: ${failures.join(' | ')}`);
process.exit(passed === total ? 0 : 1);
