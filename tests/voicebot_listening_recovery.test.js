/**
 * tests/voicebot_listening_recovery.test.js
 *
 * A live call went silent after a few turns: the bot stayed marked as "speaking", so it ignored the caller.
 * These tests cover the fixes:
 * 1. The "back to listening" step is reliable, and a newer reply is never ended by an older timer
 * 2. A watchdog switches the bot back to listening if that step is ever lost
 * 3. A turn that stays busy too long is released, and a dropped audio stream is logged
 * 4. A wrong speech-to-text language label costs no second request (one request per turn)
 * 5. Plivo's status and hangup webhooks find the contact (the live call ID is saved at answer time)
 *
 * Run:  USE_LOCAL_DB=true node tests/voicebot_listening_recovery.test.js
 * It uses the local SQLite database and removes every row it creates.
 */
process.env.USE_LOCAL_DB = 'true';
process.env.ELEVENLABS_API_KEY = '';      // stops the module's start-up voice pre-warming from calling ElevenLabs
process.env.PLIVO_AUTH_ID = 'MATESTAUTHID';
process.env.PLIVO_AUTH_TOKEN = 'test-token';
process.env.SERVER_URL = 'https://example.test';

import assert from 'assert';

// Loaded after the environment above is set. (Static imports run first, and the voice module would then
// warm its greeting cache using the real ElevenLabs key from .env.)
const { default: db, initDb } = await import('../services/db.js');
const { default: ElevenLabsService } = await import('../services/elevenlabs_service.js');
const { default: GeminiService } = await import('../services/gemini_service.js');
const { CallSession, isSupportedCallLanguage, isUsableCallScript } = await import('../services/voicebot_stream_service.js');
const { handlePlivoAnswer, handlePlivoStatus, handlePlivoHangup } = await import('../routes/admin.js');

let total = 0;
let passed = 0;
async function test(name, fn) {
    total++;
    try {
        await fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        console.error(`  FAIL ${name}\n       ${e.message}`);
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeWs = () => ({ readyState: 1, OPEN: 1, sent: [], send(m) { this.sent.push(m); }, close() { this.readyState = 3; } });
const newSession = (id) => new CallSession(fakeWs(), { callId: id });
const silenceFrame = () => Buffer.alloc(160, 0xFF); // 20 ms of silence (mu-law)
const fakeRes = () => { const r = {}; r.set = () => r; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };

await initDb();
console.log('\nVoice call: listening recovery');

await test('language helpers: only English, Hindi and Telugu are accepted', async () => {
    ['en', 'eng', 'hi', 'hin', 'te', 'tel', 'EN'].forEach((c) => assert.ok(isSupportedCallLanguage(c), c));
    ['lit', 'urd', 'rus', '', null, undefined].forEach((c) => assert.ok(!isSupportedCallLanguage(c), String(c)));
    // Words in English, Hindi or Telugu letters are usable; words in other letters (e.g. Urdu) are not.
    ['Five PM works for me', 'मैं कल आ सकता हूँ', 'నేను రేపు రాగలను', 'Zikra', ''].forEach((t) => assert.ok(isUsableCallScript(t), t));
    ['زِکرَم', 'Привет'].forEach((t) => assert.ok(!isUsableCallScript(t), t));
});

await test('after a reply finishes, the bot goes back to listening', async () => {
    const s = newSession('t-end');
    await s.dispatchAudioBuffer(Buffer.alloc(800), 'hello'); // 100 ms of audio
    assert.strictEqual(s.isAiSpeaking, true);
    await sleep(260);
    assert.strictEqual(s.isAiSpeaking, false, 'should be listening again');
});

await test('audio sent in pieces adds up to the real speaking time', async () => {
    const s = newSession('t-chunks');
    const t0 = Date.now();
    s.noteSpeechChunk(8000);   // 1.0 s
    s.noteSpeechChunk(4000);   // 0.5 s more, queued behind the first
    const ms = s.aiSpeechEndTime - t0;
    assert.ok(ms >= 1480 && ms <= 1600, `expected about 1500 ms, got ${ms}`);
});

await test('a newer reply is not ended by an older timer', async () => {
    const s = newSession('t-seq');
    await s.dispatchAudioBuffer(Buffer.alloc(800), 'short');   // 100 ms
    await s.dispatchAudioBuffer(Buffer.alloc(8000), 'long');   // 1 s, replaces the first
    await sleep(300);
    assert.strictEqual(s.isAiSpeaking, true, 'the longer reply is still playing');
    s.isClosed = true; clearTimeout(s.activeSpeechTimer);
});

await test('watchdog: a lost timer cannot leave the bot deaf', async () => {
    const s = newSession('t-watchdog');
    s.isAiSpeaking = true;                       // stuck in "speaking"
    s.aiSpeechEndTime = Date.now() - 5000;       // its audio ended 5 s ago
    await s.handleInboundAudio(silenceFrame());
    assert.strictEqual(s.isAiSpeaking, false, 'the next audio frame should switch it back to listening');
});

await test('watchdog does not interrupt a reply that is still playing', async () => {
    const s = newSession('t-playing');
    s.isAiSpeaking = true;
    s.aiSpeechEndTime = Date.now() + 5000;
    await s.handleInboundAudio(silenceFrame());
    assert.strictEqual(s.isAiSpeaking, true);
    // and a reply that ended only a moment ago is left to its own timer
    s.aiSpeechEndTime = Date.now() - 500;
    await s.handleInboundAudio(silenceFrame());
    assert.strictEqual(s.isAiSpeaking, true);
});

await test('health check releases a turn stuck busy, but not a recent one', async () => {
    const s = newSession('t-busy');
    s.isProcessingTurn = true; s.processingSince = Date.now() - 3000;
    assert.strictEqual(s.checkHealth(), null);
    assert.strictEqual(s.isProcessingTurn, true);
    s.processingSince = Date.now() - 30000;
    assert.strictEqual(s.checkHealth(), 'processing-reset');
    assert.strictEqual(s.isProcessingTurn, false);
});

await test('health check also fixes a stuck "speaking" state', async () => {
    const s = newSession('t-health-speak');
    s.isAiSpeaking = true; s.aiSpeechEndTime = Date.now() - 6000;
    assert.strictEqual(s.checkHealth(), 'speaking-reset');
    assert.strictEqual(s.isAiSpeaking, false);
});

await test('health check reports a long silence from the phone (once, not every time)', async () => {
    const s = newSession('t-quiet');
    s.lastInboundAudioAt = Date.now() - 12000;
    assert.strictEqual(s.checkHealth(), 'no-audio');
    assert.strictEqual(s.checkHealth(), null, 'logged recently, so not repeated straight away');
    const fresh = newSession('t-fresh');
    assert.strictEqual(fresh.checkHealth(), null);
});

await test('ending the call stops the health timer', async () => {
    const s = newSession('t-stop');
    s.persistCallResults = async () => {};
    s.startHealthMonitor();
    assert.ok(s.healthTimer);
    await s.endCall();
    assert.strictEqual(s.healthTimer, null);
});

await test('a wrong language label makes no second request: the words are kept, the call language stays', async () => {
    const realStt = ElevenLabsService.speechToText;
    const realTts = ElevenLabsService.textToSpeech;
    const realReply = GeminiService.generateReply;
    const calls = [];
    process.env.ELEVENLABS_API_KEY = 'test-key';
    ElevenLabsService.speechToText = async (buf, name, lang) => {
        calls.push(lang || null);
        return { transcript: 'Zikra', language: 'lit' };   // right words, wrong label
    };
    ElevenLabsService.textToSpeech = async () => Buffer.alloc(800);
    GeminiService.generateReply = async () => ({ spoken_response: 'Thanks Zikra.', detected_language: 'en', should_end_call: false, extracted_fields: {}, classification: 'Pending', call_summary: 'x' });
    try {
        const s = newSession('t-stt');
        s.callerMulawChunks = [Buffer.alloc(3200, 0x80)];
        await s.processCallerTurn();
        assert.deepStrictEqual(calls, ['en'], 'exactly one speech-to-text request for the turn');
        assert.ok(s.conversationHistory.some((m) => m.text === 'Zikra'), 'the words were kept');
        assert.strictEqual(s.detectedLanguage, 'en', 'the wrong label did not change the call language');
        assert.strictEqual(s.isProcessingTurn, false);
        s.isClosed = true; clearTimeout(s.activeSpeechTimer);
    } finally {
        ElevenLabsService.speechToText = realStt; ElevenLabsService.textToSpeech = realTts; GeminiService.generateReply = realReply;
        process.env.ELEVENLABS_API_KEY = '';
    }
});

await test('words returned in another script (Urdu letters) are dropped as unclear audio, still with one request', async () => {
    const realStt = ElevenLabsService.speechToText;
    const realTts = ElevenLabsService.textToSpeech;
    const realReply = GeminiService.generateReply;
    const calls = [];
    process.env.ELEVENLABS_API_KEY = 'test-key';
    ElevenLabsService.speechToText = async (buf, name, lang) => { calls.push(lang || null); return { transcript: 'زِکرَم', language: 'urd' }; };
    ElevenLabsService.textToSpeech = async () => Buffer.alloc(800);
    GeminiService.generateReply = async () => ({ spoken_response: 'Should not be asked.', detected_language: 'en', should_end_call: false, extracted_fields: {}, classification: 'Pending', call_summary: 'x' });
    try {
        const s = newSession('t-stt-script');
        s.callerMulawChunks = [Buffer.alloc(3200, 0x80)];
        await s.processCallerTurn();
        assert.deepStrictEqual(calls, ['en'], 'no second speech-to-text request');
        assert.ok(!s.conversationHistory.some((m) => /[؀-ۿ]/.test(m.text)), 'the Urdu-script text never reaches the conversation');
        assert.strictEqual(s.isProcessingTurn, false);
        s.isClosed = true; clearTimeout(s.activeSpeechTimer);
    } finally {
        ElevenLabsService.speechToText = realStt; ElevenLabsService.textToSpeech = realTts; GeminiService.generateReply = realReply;
        process.env.ELEVENLABS_API_KEY = '';
    }
});

await test('a correct language guess is not re-run (no extra delay)', async () => {
    const realStt = ElevenLabsService.speechToText;
    const realTts = ElevenLabsService.textToSpeech;
    const realReply = GeminiService.generateReply;
    const calls = [];
    process.env.ELEVENLABS_API_KEY = 'test-key';
    ElevenLabsService.speechToText = async (buf, name, lang) => { calls.push(lang || null); return { transcript: 'Friday at five please', language: 'eng' }; };
    ElevenLabsService.textToSpeech = async () => Buffer.alloc(800);
    GeminiService.generateReply = async () => ({ spoken_response: 'Got it.', detected_language: 'en', should_end_call: false, extracted_fields: {}, classification: 'Pending', call_summary: 'x' });
    try {
        const s = newSession('t-stt-ok');
        s.callerMulawChunks = [Buffer.alloc(3200, 0x80)];
        await s.processCallerTurn();
        assert.deepStrictEqual(calls, ['en']);
        s.isClosed = true; clearTimeout(s.activeSpeechTimer);
    } finally {
        ElevenLabsService.speechToText = realStt; ElevenLabsService.textToSpeech = realTts; GeminiService.generateReply = realReply;
        process.env.ELEVENLABS_API_KEY = '';
    }
});

console.log('\nPlivo webhooks');

const CONTACT = 'cnt_vbtest_1';
const nowIso = new Date().toISOString();
await db.run("INSERT OR IGNORE INTO batches (id, service, filename, created_at, updated_at) VALUES ('b_vbtest', 'recruitment', 'test.xlsx', ?, ?)", [nowIso, nowIso]);
await db.run("DELETE FROM contacts WHERE id = ?", [CONTACT]);
await db.run(
    "INSERT INTO contacts (id, batch_id, service, row_index, raw_data, name, phone, call_status, provider_call_id, updated_at) VALUES (?, 'b_vbtest', 'recruitment', 1, '{}', 'T', '919900000009', 'CALLING', 'REQUEST-UUID-OLD', ?)",
    [CONTACT, nowIso]);

await test('answering saves the live call ID on the contact', async () => {
    await handlePlivoAnswer({ query: { contactId: CONTACT, service: 'recruitment', direction: 'outbound' }, body: { CallUUID: 'LIVE-UUID-1' } }, fakeRes());
    const row = await db.get('SELECT provider_call_id FROM contacts WHERE id = ?', [CONTACT]);
    assert.strictEqual(row.provider_call_id, 'LIVE-UUID-1');
});

await test('the status webhook now finds the contact', async () => {
    const res = fakeRes();
    await handlePlivoStatus({ query: {}, body: { CallUUID: 'LIVE-UUID-1', CallStatus: 'completed' } }, res);
    assert.strictEqual(res.code, 200);
    const row = await db.get('SELECT call_status FROM contacts WHERE id = ?', [CONTACT]);
    assert.strictEqual(row.call_status, 'COMPLETED');
});

await test('the hangup webhook records the call length', async () => {
    const res = fakeRes();
    await handlePlivoHangup({ query: {}, body: { CallUUID: 'LIVE-UUID-1', Duration: '144' } }, res);
    assert.strictEqual(res.code, 200);
    const row = await db.get('SELECT duration_seconds, ended_at FROM contacts WHERE id = ?', [CONTACT]);
    assert.strictEqual(Number(row.duration_seconds), 144);
    assert.ok(row.ended_at);
});

await test('a webhook that only carries the request ID still works', async () => {
    await db.run("UPDATE contacts SET provider_call_id = 'REQUEST-UUID-2', call_status = 'CALLING' WHERE id = ?", [CONTACT]);
    await handlePlivoStatus({ query: {}, body: { RequestUUID: 'REQUEST-UUID-2', CallStatus: 'no-answer' } }, fakeRes());
    const row = await db.get('SELECT call_status FROM contacts WHERE id = ?', [CONTACT]);
    assert.strictEqual(row.call_status, 'UNANSWERED');
});

await test('a webhook with no ID at all is accepted without error', async () => {
    const res = fakeRes();
    await handlePlivoStatus({ query: {}, body: {} }, res);
    assert.strictEqual(res.code, 200);
});

await db.run("DELETE FROM contacts WHERE id = ?", [CONTACT]);
await db.run("DELETE FROM batches WHERE id = 'b_vbtest'");
console.log(`\n${passed}/${total} listening-recovery tests passed\n`);
process.exit(passed === total ? 0 : 1);
