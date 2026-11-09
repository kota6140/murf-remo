/**
 * tests/welcome_voice.test.js
 *
 * The home page says "Hey, welcome to Remo" in a female voice when it is opened, and again after every refresh
 * (a hard refresh is a refresh: browsers cannot tell them apart). Going Back, or opening the page again by a link
 * in the same tab session, stays quiet. Browsers block sound nobody asked for, so a blocked attempt waits for the
 * visitor's first tap/click/key. Runs the welcome code from script.js against a small fake browser.
 * Reads files only; opens no database.
 */
import assert from 'assert';
import fs from 'fs';
import vm from 'vm';

const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('script.js', root), 'utf8');
const start = source.indexOf('(function welcomeVoiceOnce()');
const end = source.indexOf('})();', start) + '})();'.length;
assert.ok(start > 0 && end > start, 'the welcome code is in script.js');
const code = source.slice(start, end);

let total = 0;
let failed = 0;
async function test(name, fn) {
    total++;
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const tick = () => new Promise((r) => setImmediate(r));

/**
 * A fake browser.
 * autoplay: 'allowed' | 'blocked' (until a gesture); clip: 'ok' | 'missing';
 * navType: 'navigate' | 'reload' | 'back_forward'; session / local: the two storages (kept between "page loads").
 */
function browser({ autoplay = 'allowed', clip = 'ok', homePage = true, navType = 'navigate', session = {}, local = {}, voices = [] } = {}) {
    const listeners = {};
    const state = { plays: 0, spoken: [], gestured: false, audioSrc: null };
    class FakeAudio {
        constructor(src) {
            state.audioSrc = src;
            this.handlers = {};
            if (clip === 'missing') setImmediate(() => (this.handlers.error || []).forEach((h) => h()));
        }
        addEventListener(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
        play() {
            state.plays++;
            if (clip === 'missing') return Promise.reject(new Error('NotSupportedError'));
            if (autoplay === 'blocked' && !state.gestured) return Promise.reject(new Error('NotAllowedError'));
            return Promise.resolve();
        }
    }
    const storage = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); } });
    const window = {
        localStorage: storage(local),
        sessionStorage: storage(session),
        performance: { getEntriesByType: () => [{ type: navType }] },
        addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || new Set()).add(fn); },
        removeEventListener: (ev, fn) => { if (listeners[ev]) listeners[ev].delete(fn); },
        speechSynthesis: { getVoices: () => voices, speak: (u) => state.spoken.push(u) }
    };
    const context = {
        window,
        document: { getElementById: (id) => (homePage && id === 'btn-hero-voice-sample' ? {} : null) },
        Audio: FakeAudio,
        SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
    };
    vm.runInNewContext(code, context);
    const gesture = async (ev = 'pointerdown') => {
        state.gestured = true;
        for (const fn of [...(listeners[ev] || [])]) fn({});
        await tick();
    };
    const listening = () => Object.values(listeners).reduce((n, s) => n + s.size, 0);
    return { state, session, local, gesture, listening };
}

await test('First visit, browser allows sound: the welcome plays at once, only once per page load', async () => {
    const b = browser();
    await tick();
    assert.strictEqual(b.state.audioSrc, '/assets/voices/welcome.wav');
    assert.strictEqual(b.state.plays, 1);
    assert.strictEqual(b.session.takeremo_welcome_played, 'yes');
    assert.strictEqual(b.listening(), 0, 'nothing is left listening');
    await b.gesture();
    assert.strictEqual(b.state.plays, 1, 'a later click does not play it again');
});

await test('Refresh (also a hard refresh) plays it again, every time', async () => {
    const session = {};
    const first = browser({ session });
    await tick();
    assert.strictEqual(first.state.plays, 1);
    for (let i = 0; i < 3; i++) {
        const again = browser({ navType: 'reload', session });
        await tick();
        assert.strictEqual(again.state.plays, 1, `refresh ${i + 1} plays the welcome again`);
    }
});

await test('Back button, and opening the page again by a link in the same tab session, stay quiet', async () => {
    const session = {};
    const first = browser({ session });
    await tick();
    assert.strictEqual(first.state.plays, 1);
    const link = browser({ navType: 'navigate', session });
    await tick();
    assert.strictEqual(link.state.plays, 0, 'a link back to the home page stays quiet');
    assert.strictEqual(link.listening(), 0);
    const back = browser({ navType: 'back_forward', session: {} });
    await tick();
    assert.strictEqual(back.state.plays, 0, 'the Back button stays quiet');
    assert.strictEqual(back.listening(), 0);
    const newTab = browser({ navType: 'navigate', session: {} });
    await tick();
    assert.strictEqual(newTab.state.plays, 1, 'a new tab or window is a new visit');
});

await test('Browser blocks sound: nothing is marked as played, and the first tap/click/key plays it', async () => {
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'click']) {
        const b = browser({ autoplay: 'blocked' });
        await tick();
        assert.strictEqual(b.session.takeremo_welcome_played, undefined, 'a blocked attempt is not "played"');
        assert.ok(b.listening() > 0);
        await b.gesture(ev);
        assert.strictEqual(b.session.takeremo_welcome_played, 'yes', `plays after ${ev}`);
        assert.strictEqual(b.listening(), 0);
        const plays = b.state.plays;
        await b.gesture(ev);
        assert.strictEqual(b.state.plays, plays, 'only once');
    }
    // a refresh after a blocked first attempt still tries again
    const session = {};
    browser({ autoplay: 'blocked', session });
    await tick();
    const again = browser({ autoplay: 'blocked', navType: 'reload', session });
    await tick();
    await again.gesture();
    assert.strictEqual(again.state.plays >= 2, true);
    assert.strictEqual(again.session.takeremo_welcome_played, 'yes');
});

await test('Only the home page plays it, and the sound switch turns it off', async () => {
    const other = browser({ homePage: false });
    await tick();
    assert.strictEqual(other.state.plays, 0);
    assert.strictEqual(other.listening(), 0);
    const muted = browser({ local: { takeremo_sound_fx: 'false' }, navType: 'reload' });
    await tick();
    assert.strictEqual(muted.state.plays, 0);
    assert.strictEqual(muted.session.takeremo_welcome_played, undefined, 'turning sound back on still lets it play');
});

await test('No clip file: the browser\'s female voice says "Hey, welcome to Remo" on the first tap', async () => {
    const voices = [
        { name: 'Microsoft David', lang: 'en-US' },
        { name: 'Microsoft Zira', lang: 'en-US' },
        { name: 'Hindi voice', lang: 'hi-IN' }
    ];
    const b = browser({ clip: 'missing', voices });
    await tick();
    assert.strictEqual(b.state.spoken.length, 0, 'it does not speak before any interaction');
    await b.gesture();
    assert.strictEqual(b.state.spoken.length, 1);
    assert.strictEqual(b.state.spoken[0].text, 'Hey, welcome to Remo.');
    assert.strictEqual(b.state.spoken[0].voice.name, 'Microsoft Zira', 'a female voice is chosen');
    assert.strictEqual(b.session.takeremo_welcome_played, 'yes');
    await b.gesture();
    assert.strictEqual(b.state.spoken.length, 1, 'only once');
});

await test('The welcome clip exists, is a real WAV (24 kHz, mono) and is short', () => {
    const wav = fs.readFileSync(new URL('assets/voices/welcome.wav', root));
    assert.strictEqual(wav.subarray(0, 4).toString(), 'RIFF');
    assert.strictEqual(wav.subarray(8, 12).toString(), 'WAVE');
    assert.strictEqual(wav.readUInt32LE(24), 24000);
    assert.strictEqual(wav.readUInt16LE(22), 1);
    const seconds = (wav.length - 44) / 2 / 24000;
    assert.ok(seconds > 0.8 && seconds < 6, `a short greeting, got ${seconds.toFixed(1)}s`);
    let peak = 0;
    for (let i = 44; i + 1 < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    assert.ok(peak > 2000, 'it contains sound, not silence');
});

await test('The page loads script.js and has the voice button the welcome code looks for', () => {
    const html = fs.readFileSync(new URL('index.html', root), 'utf8');
    assert.match(html, /id="btn-hero-voice-sample"/);
    assert.match(html, /<script[^>]*src="\/?script\.js/);
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
