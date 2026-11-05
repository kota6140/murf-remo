/**
 * tests/speech_titles.test.js
 *
 * A title in front of a name is spoken as a word ("Dr. Ravi" -> "Doctor Ravi", not "D R Ravi"), in English,
 * Hindi and Telugu lines. Only the words sent to the voice change; ordinary words are never touched.
 * Reads files and runs pure functions only; opens no database and calls no voice service.
 */
import assert from 'assert';
import fs from 'fs';
import { expandTitles } from '../services/speech_text.js';

let total = 0;
let failed = 0;
function test(name, fn) {
    total++;
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

test('English: Dr. / Dr / DR / dr in front of a name is spoken "Doctor"', () => {
    assert.strictEqual(expandTitles('Hi, am I speaking with Dr. Ravi?'), 'Hi, am I speaking with Doctor Ravi?');
    assert.strictEqual(expandTitles('Hello Dr Sharma, this is Remo.'), 'Hello Doctor Sharma, this is Remo.');
    assert.strictEqual(expandTitles('Am I speaking with DR Kumar?'), 'Am I speaking with Doctor Kumar?');
    assert.strictEqual(expandTitles('Am I speaking with dr. rao?'), 'Am I speaking with Doctor rao?');
    assert.strictEqual(expandTitles('Dr.Ravi is here'), 'Doctor Ravi is here');
    assert.strictEqual(expandTitles('Dr. Ravi Kumar'), 'Doctor Ravi Kumar');
});

test('Hindi and Telugu lines say the title in that language', () => {
    assert.strictEqual(expandTitles('नमस्ते, क्या मैं Dr. रवि से बात कर रहा हूँ?'), 'नमस्ते, क्या मैं डॉक्टर रवि से बात कर रहा हूँ?');
    assert.strictEqual(expandTitles('నమస్కారం, నేను Dr. రవి గారితో మాట్లాడుతున్నానా?'), 'నమస్కారం, నేను డాక్టర్ రవి గారితో మాట్లాడుతున్నానా?');
    assert.strictEqual(expandTitles('Dr. రవి'), 'డాక్టర్ రవి');
});

test('Other titles are spoken as words', () => {
    assert.strictEqual(expandTitles('Mr. Rao and Mrs. Devi'), 'Mister Rao and Missus Devi');
    assert.strictEqual(expandTitles('Ms Anita'), 'Miss Anita');
    assert.strictEqual(expandTitles('Prof. Iyer'), 'Professor Iyer');
});

test('Words that merely contain the letters are never changed', () => {
    for (const s of ['Hi Andre, how are you?', 'Drive safe', 'Mr', 'Hello Drew', 'Dr', 'Is it a good time?',
        'Drake called', 'Pandrangi garu', 'Mrinal here', 'Msc degree', 'Our product is great']) {
        assert.strictEqual(expandTitles(s), s, s);
    }
});

test('A title with no name after it is left alone, and empty input is safe', () => {
    assert.strictEqual(expandTitles('See you, Dr.'), 'See you, Dr.');
    assert.strictEqual(expandTitles(''), '');
    assert.strictEqual(expandTitles(undefined), undefined);
    assert.strictEqual(expandTitles(null), null);
});

test('Both voice services run the spoken text through expandTitles before speaking', () => {
    const read = (f) => fs.readFileSync(new URL(`../services/${f}`, import.meta.url), 'utf8');
    const murf = read('murf_service.js');
    const eleven = read('elevenlabs_service.js');
    assert.ok(/import \{ expandTitles \} from '\.\/speech_text\.js'/.test(murf));
    assert.ok(/const trimmed = String\(expandTitles\(text\) \|\| ''\)\.trim\(\)/.test(murf));
    assert.ok(/import \{ expandTitles \} from '\.\/speech_text\.js'/.test(eleven));
    assert.ok(/text = expandTitles\(text\);/.test(eleven));
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
