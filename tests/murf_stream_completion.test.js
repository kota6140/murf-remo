/**
 * tests/murf_stream_completion.test.js
 *
 * Murf's text-to-speech stream: speech must never be cut short just because Murf paused for a moment.
 *  - the text frame carries "end: true", and Murf answers with { final: true } when everything is spoken;
 *  - a pause longer than the old idle timers (500 ms, then 1600 ms) does not end the clip;
 *  - only a clip that Murf marked final (and that is long enough) is kept in the cache, so a cut-short clip
 *    is never replayed on a later call;
 *  - a fatal error, a closed connection (4029 = too many requests at once) or a missing final message
 *    still ends the request, with whatever arrived, and nothing is cached.
 *
 * Runs against a fake Murf server on localhost. It never contacts Murf and needs no database.
 */
process.env.MURF_API_KEY = 'test-key';
process.env.SKIP_TTS_PRECACHE = '1';

import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';
import fs from 'fs';
import { WebSocketServer } from 'ws';

let total = 0;
let failed = 0;
async function test(name, fn) {
    total++;
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// ── fake Murf ──────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ port: 0 });
await new Promise((r) => wss.on('listening', r));
process.env.MURF_WS_URL = `ws://127.0.0.1:${wss.address().port}`;

const { default: MurfService, getMinExpectedAudioBytes } = await import('../services/murf_service.js');

let connections = 0;
let frames = [];
let behaviour = () => {};
wss.on('connection', (ws) => {
    connections++;
    ws.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        frames.push(frame);
        if (typeof frame.text === 'string') behaviour(ws, frame);
    });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 24 kHz 16-bit mono audio of the given length; the first piece of a request starts with a WAV header, as Murf's does. */
function pcm(seconds, { header = false } = {}) {
    const samples = Math.round(24000 * seconds);
    const body = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) body.writeInt16LE(Math.round(8000 * Math.sin(i / 10)), i * 2);
    if (!header) return body;
    const wav = Buffer.alloc(44);
    wav.write('RIFF', 0);
    return Buffer.concat([wav, body]);
}
const audioFrame = (seconds, opts) => JSON.stringify({ audio: pcm(seconds, opts).toString('base64') });
const FINAL = JSON.stringify({ final: true, concurrency: { region: 'test', used: 1, limit: 5 } });
const BYTES_PER_SECOND = 8000; // 8 kHz mu-law
const LOCALE = { voiceId: 'test-voice', model: 'falcon-2.1', locale: 'en-IN' };
const speak = (text, extra = {}) => MurfService.textToSpeech(text, { ...LOCALE, timeoutMs: 8000, ...extra });
const cached = (text) => MurfService.getCachedAudio(text, LOCALE);

const TEXT_10_WORDS = 'Hello there, this is a test of the audio stream'; // needs at least 14,000 bytes (1.75 s)
const minBytes = getMinExpectedAudioBytes(TEXT_10_WORDS);

// ── tests ──────────────────────────────────────────────────────────────────
await test('A pause longer than the old idle timers does not cut the speech: it ends on Murf\'s final message', async () => {
    const text = `${TEXT_10_WORDS} one`;
    behaviour = async (ws) => {
        ws.send(audioFrame(0.7, { header: true }));
        await sleep(1900);                       // longer than 500 ms and than 1600 ms
        ws.send(audioFrame(0.7));
        await sleep(1900);
        ws.send(audioFrame(0.7));
        await sleep(30);
        ws.send(FINAL);
    };
    const pieces = [];
    const started = Date.now();
    const audio = await speak(text, { onChunk: (c) => pieces.push(c) });
    const took = Date.now() - started;

    assert.strictEqual(audio.length, Math.round(2.1 * BYTES_PER_SECOND), 'all three bursts arrived');
    assert.strictEqual(Buffer.concat(pieces).length, audio.length, 'every piece was also handed to the caller as it arrived');
    assert.ok(took >= 3700 && took < 5500, `finished right after the final message (${took} ms)`);
    assert.ok(cached(text) && cached(text).length === audio.length, 'a clip Murf marked final is kept');
});

await test('The text frame follows the voice settings and carries end: true', async () => {
    const [voice, text] = frames.slice(0, 2);
    assert.ok(voice.voice_config && voice.voice_config.voiceId === 'test-voice', 'voice settings are sent first');
    assert.strictEqual(typeof text.text, 'string');
    assert.strictEqual(text.end, true, 'end: true asks Murf for the final message');
});

await test('A kept clip is played from the cache with no new request to Murf', async () => {
    const text = `${TEXT_10_WORDS} one`;
    const before = connections;
    const again = await speak(text);
    assert.strictEqual(connections, before, 'no connection opened');
    assert.strictEqual(again.length, Math.round(2.1 * BYTES_PER_SECOND));
});

await test('Without a final message the request still ends with what arrived, is not cached, and later requests wait less', async () => {
    const text = `${TEXT_10_WORDS} two`;
    behaviour = (ws) => {                        // two bursts, then silence, connection stays open
        ws.send(audioFrame(0.4, { header: true }));
        setTimeout(() => ws.send(audioFrame(0.4)), 100);
    };
    assert.strictEqual(MurfService.finalMessageExpected, true, 'Murf is trusted to send it at first');

    let started = Date.now();
    const audio = await speak(text);
    let took = Date.now() - started;
    assert.strictEqual(audio.length, Math.round(0.8 * BYTES_PER_SECOND), 'what arrived is played');
    assert.ok(took >= 3800 && took < 5500, `ended by the long fallback wait (${took} ms)`);
    assert.strictEqual(cached(text), null, 'a clip that may be cut short is never kept');
    assert.strictEqual(MurfService.finalMessageExpected, false, 'no longer waiting for a message Murf did not send');

    started = Date.now();
    const next = await speak(`${TEXT_10_WORDS} two again`);
    took = Date.now() - started;
    assert.strictEqual(next.length, Math.round(0.8 * BYTES_PER_SECOND));
    assert.ok(took >= 1500 && took < 3000, `the next request uses the short wait (${took} ms)`);

    MurfService.finalMessageExpected = true;     // Murf sends it again: trusted again
});

await test('A fatal error ends the request quickly, with the audio so far, and nothing is cached', async () => {
    const text = `${TEXT_10_WORDS} three`;
    behaviour = (ws) => {
        ws.send(audioFrame(0.5, { header: true }));
        setTimeout(() => ws.send(JSON.stringify({ error: 'boom', error_code: 'E1', fatal: true })), 50);
    };
    const started = Date.now();
    const audio = await speak(text);
    assert.ok(Date.now() - started < 1200, 'did not wait for a timer');
    assert.strictEqual(audio.length, Math.round(0.5 * BYTES_PER_SECOND));
    assert.strictEqual(cached(text), null);
});

await test('Murf closing the connection with 4029 (too many requests at once) ends the request without audio', async () => {
    const text = `${TEXT_10_WORDS} four`;
    behaviour = (ws) => ws.close(4029, 'concurrency limit');
    const started = Date.now();
    const audio = await speak(text);
    assert.ok(Date.now() - started < 1500);
    assert.strictEqual(audio, null);
    assert.strictEqual(cached(text), null);
});

await test('A final message with far too little audio is played but never kept', async () => {
    const text = `${TEXT_10_WORDS} five`;
    behaviour = (ws) => {
        ws.send(audioFrame(0.2, { header: true }));
        ws.send(FINAL);
    };
    const audio = await speak(text);
    assert.ok(audio.length < minBytes, 'the clip is shorter than the text needs');
    assert.strictEqual(cached(text), null, 'a clip that is too short is not kept');
});

await test('The minimum-audio rule is one shared function', () => {
    assert.strictEqual(getMinExpectedAudioBytes(TEXT_10_WORDS), 14000);
    assert.strictEqual(getMinExpectedAudioBytes(''), 0);
    const call = fs.readFileSync(new URL('../services/voicebot_stream_service.js', import.meta.url), 'utf8');
    assert.ok(call.includes('getMinExpectedAudioBytes(greeting)'), 'the greeting check uses the shared rule');
    assert.ok(!/greeting\.length \* 150/.test(call), 'no second, different formula');
});

for (const client of wss.clients) client.terminate();
wss.close();
console.log(`\n${total - failed}/${total} passed`);
process.exitCode = failed ? 1 : 0;
