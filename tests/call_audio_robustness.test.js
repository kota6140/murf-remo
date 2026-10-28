/**
 * tests/call_audio_robustness.test.js
 *
 * The AI's voice must not be cut by things that are not the caller interrupting:
 *  - a campaign's language is only a setting that is read while the greeting is already playing: it must not
 *    clear the audio (a language the caller really switches to still does);
 *  - speech has natural dips, so a short quiet gap (up to 8 frames, ~160 ms) does not restart the interruption
 *    count, while a longer gap means it was only a noise burst;
 *  - the limit is the same number of frames whether or not the count was reset (80 in the opening turn, 60 later);
 *  - the loudness needed to interrupt can be lowered with BARGE_IN_ENERGY_THRESHOLD for callers on a quiet line.
 */
import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';

process.env.SKIP_TTS_PRECACHE = '1';
const { CallSession, decodeMulawToPcm16, calculateRms } = await import('../services/voicebot_stream_service.js');

let total = 0;
let failed = 0;
async function test(name, fn) {
    total++;
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const LOUD = Buffer.alloc(160, 0x00);   // maximum amplitude in G.711 mu-law
const QUIET = Buffer.alloc(160, 0xFF);  // silence in G.711 mu-law

function makeSession() {
    const sent = [];
    const ws = { readyState: 1, OPEN: 1, send: (m) => sent.push(JSON.parse(m)) };
    const s = new CallSession(ws, { service: 'sales', callerName: 'Priya' });
    s.streamId = 'test_stream';
    s.isAiSpeaking = true;
    return { s, sent };
}
const feed = async (s, chunk, n) => { for (let i = 0; i < n; i++) await s.handleInboundAudio(chunk); };
const interrupted = (s, sent) => s.isAiSpeaking === false && sent.some((m) => m.event === 'clearAudio');

// ── language setting vs. a language the caller switches to ─────────────────
await test('A campaign language read during the greeting does not clear the audio that is playing', () => {
    const { s, sent } = makeSession();
    s.activeSpeechTimer = setTimeout(() => {}, 60000);
    s.setSessionLanguage('te', 'CAMPAIGN_CONFIG');
    assert.strictEqual(s.detectedLanguage, 'te', 'the language is applied for what comes next');
    assert.ok(!sent.some((m) => m.event === 'clearAudio'), 'no clearAudio: the greeting keeps playing');
    assert.strictEqual(s.isAiSpeaking, true);
    assert.notStrictEqual(s.activeSpeechTimer, null, 'the playback timer is kept');
    clearTimeout(s.activeSpeechTimer);
});

await test('A language the caller really switches to still stops the old language\'s audio', () => {
    const { s, sent } = makeSession();
    s.activeSpeechTimer = setTimeout(() => {}, 60000);
    s.setSessionLanguage('hi', 'LANGUAGE_STATE_MACHINE');
    assert.strictEqual(s.detectedLanguage, 'hi');
    assert.ok(sent.some((m) => m.event === 'clearAudio'));
    assert.strictEqual(s.isAiSpeaking, false);
    assert.strictEqual(s.activeSpeechTimer, null);
});

// ── interruption counting ──────────────────────────────────────────────────
await test('Opening turn: 80 loud frames interrupt, 79 do not', async () => {
    const a = makeSession();
    await feed(a.s, LOUD, 79);
    assert.ok(!interrupted(a.s, a.sent), '79 frames are not enough in the opening turn');
    await feed(a.s, LOUD, 1);
    assert.ok(interrupted(a.s, a.sent), 'the 80th frame interrupts');
});

await test('Later turns: 60 loud frames interrupt, 59 do not', async () => {
    const a = makeSession();
    a.s.currentTurnId = 3;
    await feed(a.s, LOUD, 59);
    assert.ok(!interrupted(a.s, a.sent));
    await feed(a.s, LOUD, 1);
    assert.ok(interrupted(a.s, a.sent));
});

await test('The opening-turn limit also applies while the greeting is still being delivered', async () => {
    const a = makeSession();
    a.s.currentTurnId = 3;
    a.s.greetingInProgress = true;
    await feed(a.s, LOUD, 79);
    assert.ok(!interrupted(a.s, a.sent));
    await feed(a.s, LOUD, 1);
    assert.ok(interrupted(a.s, a.sent));
});

await test('A short dip inside speech (8 quiet frames) does not restart the count', async () => {
    const a = makeSession();
    await feed(a.s, LOUD, 40);
    await feed(a.s, QUIET, 8);
    await feed(a.s, LOUD, 40);        // 80 loud frames in total
    assert.ok(interrupted(a.s, a.sent), 'speech with a natural pause still counts as one interruption');
});

await test('A longer quiet gap (9 frames) means it was only noise: the count starts over', async () => {
    const a = makeSession();
    await feed(a.s, LOUD, 70);        // more than 60, but less than the opening-turn limit of 80
    await feed(a.s, QUIET, 9);
    assert.strictEqual(a.s.overlapSpeechFrames, 0, 'the count is cleared, also when it was above 60');
    assert.strictEqual(a.s.overlapMulawChunks.length, 0, 'the noise is discarded');
    await feed(a.s, LOUD, 50);
    assert.ok(!interrupted(a.s, a.sent), '70 + 50 separate frames must not add up to an interruption');
});

await test('Noise bursts separated by quiet never add up', async () => {
    const a = makeSession();
    for (let i = 0; i < 5; i++) {
        await feed(a.s, LOUD, 30);
        await feed(a.s, QUIET, 20);
    }
    assert.ok(!interrupted(a.s, a.sent));
    assert.strictEqual(a.s.isAiSpeaking, true, 'the AI keeps talking');
});

await test('When it does interrupt, the caller\'s words are kept, including the short dips', async () => {
    const a = makeSession();
    await feed(a.s, LOUD, 40);
    await feed(a.s, QUIET, 5);
    await feed(a.s, LOUD, 40);
    assert.ok(interrupted(a.s, a.sent));
    assert.strictEqual(a.s.callerMulawChunks.length, 85, 'all 85 frames (80 loud + 5 quiet) are kept for the answer');
    assert.strictEqual(a.s.overlapQuietFrames, 0);
});

// ── loudness needed to interrupt ───────────────────────────────────────────
function byteWithRms(target) {
    let best = 0, bestDiff = Infinity;
    for (let b = 0; b < 256; b++) {
        const chunk = Buffer.alloc(160, b);
        const diff = Math.abs(calculateRms(decodeMulawToPcm16(chunk)) - target);
        if (diff < bestDiff) { best = b; bestDiff = diff; }
    }
    return Buffer.alloc(160, best);
}
const SOFT = byteWithRms(600);          // above the normal listening threshold (450), below the interrupt threshold (850)

await test('Quiet speech does not interrupt by default (the AI\'s own echo and line noise sit in this range)', async () => {
    const rms = calculateRms(decodeMulawToPcm16(SOFT));
    assert.ok(rms > 450 && rms < 850, `test frame loudness ${Math.round(rms)}`);
    const a = makeSession();
    assert.strictEqual(a.s.BARGE_IN_ENERGY_THRESHOLD, 850);
    await feed(a.s, SOFT, 100);
    assert.ok(!interrupted(a.s, a.sent));
});

await test('BARGE_IN_ENERGY_THRESHOLD lets callers on a quiet line interrupt; a silly value is ignored', async () => {
    const saved = process.env.BARGE_IN_ENERGY_THRESHOLD;
    try {
        process.env.BARGE_IN_ENERGY_THRESHOLD = '450';
        const a = makeSession();
        assert.strictEqual(a.s.BARGE_IN_ENERGY_THRESHOLD, 450);
        await feed(a.s, SOFT, 80);
        assert.ok(interrupted(a.s, a.sent), 'quiet speech now interrupts');

        for (const bad of ['10', '999999', 'abc', '']) {
            process.env.BARGE_IN_ENERGY_THRESHOLD = bad;
            assert.strictEqual(makeSession().s.BARGE_IN_ENERGY_THRESHOLD, 850, `"${bad}" falls back to 850`);
        }
    } finally {
        if (saved === undefined) delete process.env.BARGE_IN_ENERGY_THRESHOLD; else process.env.BARGE_IN_ENERGY_THRESHOLD = saved;
    }
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
