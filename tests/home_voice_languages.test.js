/**
 * tests/home_voice_languages.test.js
 *
 * The home page's "AI that sounds, listens, and feels like your best employee" section has language tabs
 * (Telugu, English, Hindi, Kannada, Malayalam, German, Spanish, in that order). Each tab plays the four scenes
 * in its language, so every language needs its five voice clips and its five caption lines.
 * Reads files only; opens no database and calls no voice service.
 */
import assert from 'assert';
import fs from 'fs';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const html = read('index.html');
const script = read('script.js');

let total = 0;
let failed = 0;
function test(name, fn) {
    total++;
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const ORDER = [['te', 'Telugu'], ['en', 'English'], ['hi', 'Hindi'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['de', 'German'], ['es', 'Spanish']];
const CLIPS = ['breath', 'cut-caller', 'cut-remo', 'care', 'done'];
const tabs = [...html.matchAll(/<button[^>]*class="ht-lang-tab[^"]*"[^>]*data-lang="(\w+)"[^>]*>([^<]+)<\/button>/g)]
    .map((m) => [m[1], m[2].trim()]);

test('The tabs appear in the requested order', () => {
    assert.deepStrictEqual(tabs, ORDER);
});

test('Exactly one tab is selected, and the tab list is labelled for screen readers', () => {
    assert.strictEqual((html.match(/aria-selected="true"/g) || []).length >= 1, true);
    const selected = [...html.matchAll(/class="ht-lang-tab[^"]*"[^>]*aria-selected="true"/g)];
    assert.strictEqual(selected.length, 1);
    assert.ok(/role="tablist" aria-label="Choose the language Remo speaks"/.test(html));
});

test('Every language has its five voice clips as real mono 16-bit WAV files', () => {
    for (const [lang] of ORDER) {
        for (const clip of CLIPS) {
            const file = lang === 'en' ? `assets/voices/${clip}.wav` : `assets/voices/${lang}/${clip}.wav`;
            const buf = fs.readFileSync(new URL(file, root));
            assert.ok(buf.length > 20000, `${file} is too small (${buf.length} bytes)`);
            assert.strictEqual(buf.toString('ascii', 0, 4), 'RIFF', `${file} is not a WAV`);
            assert.strictEqual(buf.toString('ascii', 8, 12), 'WAVE', `${file} is not a WAV`);
            assert.strictEqual(buf.readUInt16LE(22), 1, `${file} is not mono`);
            assert.strictEqual(buf.readUInt16LE(34), 16, `${file} is not 16-bit`);
            const seconds = buf.readUInt32LE(40) / (buf.readUInt32LE(24) * 2);
            assert.ok(seconds > 1 && seconds < 15, `${file} lasts ${seconds.toFixed(1)}s`);
        }
    }
});

test('script.js has the five caption lines for every language', () => {
    const block = script.slice(script.indexOf('const HT_TEXTS = {'), script.indexOf('const HT_SCENE_CLIPS'));
    assert.ok(block.length > 500, 'caption block not found');
    for (const [lang] of ORDER) {
        const start = block.indexOf(`      ${lang}: {`);
        assert.ok(start >= 0, `no captions for ${lang}`);
        const end = block.indexOf('\n      }', start);
        const section = block.slice(start, end);
        for (const clip of CLIPS) {
            const key = clip.includes('-') ? `'${clip}':` : `${clip}:`;
            assert.ok(section.includes(key), `${lang} is missing the "${clip}" line`);
        }
    }
});

test('Each language\'s clips are loaded from its own folder, English from the top folder', () => {
    assert.ok(script.includes("lang === 'en' ? '/assets/voices/' : `/assets/voices/${lang}/`"));
});

test('Choosing a language switches the voice, turns sound on, and restarts the current scene', () => {
    const fn = script.slice(script.indexOf('const htSetLanguage'), script.indexOf('langTabs.forEach((tab, i)'));
    assert.ok(fn.includes('voiceScenes = getVoiceScenes(lang)'));
    assert.ok(fn.includes('stopVoice()'));
    assert.ok(fn.includes('voiceOn = true'));
    assert.ok(fn.includes('htSelect(htCurrent)'));
});

test('The page asks for fresh copies of the script and styles', () => {
    const v = (re) => (html.match(re) || [])[1];
    assert.strictEqual(v(/styles\.css\?v=(\w+)/), '20261104e');
    assert.strictEqual(v(/script\.js\?v=(\w+)/), '20261104a');
});

test('Hero "Hear Remo\'s Real Voice" plays the recorded female Murf clip; Hindi breath/care are spoken in the feminine', () => {
    const buf = fs.readFileSync(new URL('assets/voices/hero.wav', root));
    assert.strictEqual(buf.toString('ascii', 0, 4), 'RIFF');
    assert.strictEqual(buf.readUInt16LE(22), 1, 'hero.wav is not mono');
    assert.strictEqual(buf.readUInt16LE(34), 16, 'hero.wav is not 16-bit');
    const seconds = buf.readUInt32LE(40) / (buf.readUInt32LE(24) * 2);
    assert.ok(seconds > 3 && seconds < 20, `hero.wav lasts ${seconds.toFixed(1)}s`);
    assert.ok(script.includes("new Audio('/assets/voices/hero.wav')"));
    const hi = script.slice(script.indexOf('      hi: {', script.indexOf('const HT_TEXTS = {')));
    const hiBreath = hi.match(/breath: '([^']+)'/)[1];
    const hiCare = hi.match(/care: '([^']+)'/)[1];
    assert.ok(hiBreath.includes('बोल रही हूँ') && hiBreath.includes('सुन रही हूँ'), hiBreath);
    assert.ok(hiCare.includes('ठीक करती हूँ'), hiCare);
});

// ---- "Built for conversations across industries": language tabs that translate and read the sample line ----
const INDUSTRIES = [...html.matchAll(/class="ind-pill-btn[^"]*"[^>]*data-industry="(\w+)"/g)].map((m) => m[1]);
const NON_ENGLISH = ORDER.filter(([lang]) => lang !== 'en');
const ALL_LANGS = ORDER; // the industries section reads English aloud too
const indTabs = [...html.matchAll(/<button[^>]*class="ind-lang-tab[^"]*"[^>]*data-lang="(\w+)"[^>]*>([^<]+)<\/button>/g)]
    .map((m) => [m[1], m[2].trim()]);

test('Industries: the language tabs appear in the requested order, English selected', () => {
    assert.deepStrictEqual(indTabs, ORDER);
    const selected = [...html.matchAll(/class="ind-lang-tab[^"]*"[^>]*aria-selected="true"/g)];
    assert.strictEqual(selected.length, 1);
    assert.ok(/class="ind-lang-tab is-active"[^>]*data-lang="en"/.test(html));
    assert.ok(/role="tablist" aria-label="Choose the language of the sample call"/.test(html));
});

test('Industries: there are 8 industries, each with a line in all 6 other languages', () => {
    assert.strictEqual(INDUSTRIES.length, 8);
    const block = script.slice(script.indexOf('const IND_TEXTS = {'), script.indexOf("const industryTabs = document.querySelectorAll('.ind-pill-btn"));
    assert.ok(block.length > 5000, 'IND_TEXTS block not found');
    for (const [lang] of NON_ENGLISH) {
        const start = block.indexOf(`    ${lang}: {`);
        assert.ok(start >= 0, `no lines for ${lang}`);
        const end = block.indexOf('\n    }', start);
        const section = block.slice(start, end);
        for (const key of INDUSTRIES) {
            const m = section.match(new RegExp(`      ${key}: '([^\\n]+)'`));
            assert.ok(m && m[1].length > 60, `${lang} is missing the "${key}" line`);
        }
    }
});

test('Industries: every language, English included, has all 8 voice clips as real mono 16-bit WAV files', () => {
    for (const [lang] of ALL_LANGS) {
        for (const key of INDUSTRIES) {
            const file = `assets/voices/industries/${lang}/${key}.wav`;
            const buf = fs.readFileSync(new URL(file, root));
            assert.ok(buf.length > 100000, `${file} is too small (${buf.length} bytes)`);
            assert.strictEqual(buf.toString('ascii', 0, 4), 'RIFF', `${file} is not a WAV`);
            assert.strictEqual(buf.toString('ascii', 8, 12), 'WAVE', `${file} is not a WAV`);
            assert.strictEqual(buf.readUInt16LE(22), 1, `${file} is not mono`);
            assert.strictEqual(buf.readUInt16LE(34), 16, `${file} is not 16-bit`);
            const seconds = buf.readUInt32LE(40) / (buf.readUInt32LE(24) * 2);
            assert.ok(seconds > 6 && seconds < 20, `${file} lasts ${seconds.toFixed(1)}s`);
        }
    }
});

test('Industries: the voice follows the language, the rotation waits for the clip, and sound stops off-screen', () => {
    assert.ok(script.includes('audio.src = `/assets/voices/industries/${id}.wav`'));
    assert.ok(script.includes('Math.max(IND_DURATION, seconds * 1000 + 1600)'));
    assert.ok(script.includes('duration: indDurationFor(indCurrent)'));
    assert.ok(script.includes('if (indVisible) playIndVoice(indCurrent); else stopIndVoice();'));
    const fn = script.slice(script.indexOf('const indSetLanguage'), script.indexOf('indLangTabs.forEach((tab, i)'));
    assert.ok(fn.includes('indVoiceOn = true') && fn.includes('selectIndustry(indCurrent)'));
});

test('Industries: the Voice on/off button is always visible, starts off, and the page opens silent', () => {
    const btn = (html.match(/<button[^>]*id="ind-voice"[^>]*>/) || [''])[0];
    assert.ok(btn, 'voice button not found');
    assert.ok(!/\shidden[\s>]/.test(btn), 'the button must not be hidden');
    assert.ok(/data-state="off"/.test(btn) && /aria-pressed="false"/.test(btn));
    assert.ok(script.includes('let indVoiceOn = false;'), 'no sound before the visitor asks for it');
    assert.ok(!script.includes("indLang !== 'en' && indVoiceOn"), 'English is read aloud like the other languages');
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
