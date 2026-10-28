/**
 * tests/agent_text_limits.test.js
 *
 * How much text an agent's greeting and instructions can hold:
 *  - the server accepts up to the limit and rejects longer text with a clear message (it no longer trims silently);
 *  - the owner panel form shows the same numbers (textarea maxlength, hint and live counter).
 */
process.env.DB_ENGINE = 'sqlite'; // never reach the real database from this test

import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';
import fs from 'fs';
import { AGENT_LIMITS, AgentError, cleanFields } from '../services/agent_service.js';

let total = 0;
let failed = 0;
async function test(name, fn) {
    total++;
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const base = { name: 'Sirisha', phoneNumber: '918012345678', service: 'sales' };

await test('The limits are 6,000 characters for instructions and 1,000 for the greeting', () => {
    assert.deepStrictEqual(AGENT_LIMITS, { greeting: 1000, instructions: 6000 });
});

await test('Instructions of exactly the limit are accepted unchanged', () => {
    const text = 'a'.repeat(AGENT_LIMITS.instructions);
    assert.strictEqual(cleanFields({ ...base, instructions: text }, { requireAll: true }).instructions, text);
});

await test('Surrounding spaces do not count towards the limit', () => {
    const text = `   ${'a'.repeat(AGENT_LIMITS.instructions)}   `;
    assert.strictEqual(cleanFields({ ...base, instructions: text }, { requireAll: true }).instructions.length, AGENT_LIMITS.instructions);
});

await test('Instructions over the limit are rejected with the count, the limit and the word estimate', () => {
    let err;
    try { cleanFields({ ...base, instructions: 'a'.repeat(AGENT_LIMITS.instructions + 1) }, { requireAll: true }); } catch (e) { err = e; }
    assert.ok(err instanceof AgentError, 'an AgentError the panel can show');
    assert.strictEqual(err.message, 'The instructions are too long: 6,001 characters. The limit is 6,000 characters (about 1,000 words).');
});

await test('An over-long greeting is rejected too, and an update is checked the same way', () => {
    assert.throws(() => cleanFields({ greeting: 'x'.repeat(1001) }, { requireAll: false }), /The greeting is too long: 1,001 characters\. The limit is 1,000/);
    assert.throws(() => cleanFields({ instructions: 'x'.repeat(7000) }, { requireAll: false }), /limit is 6,000 characters/);
    assert.deepStrictEqual(cleanFields({ instructions: 'Be brief.' }, { requireAll: false }), { instructions: 'Be brief.' });
});

await test('Hindi and Telugu text count as characters, so the same limit applies', () => {
    const telugu = 'నమస్కారం '.repeat(800); // far more than 6,000 characters
    assert.throws(() => cleanFields({ ...base, instructions: telugu }, { requireAll: true }), /too long/);
});

await test('The owner panel form shows the same limit and a live word / character counter', () => {
    const html = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
    const js = fs.readFileSync(new URL('../admin-panel.js', import.meta.url), 'utf8');
    assert.ok(html.includes(`name="instructions" rows="5" maxlength="${AGENT_LIMITS.instructions}"`), 'textarea maxlength matches the server limit');
    assert.ok(html.includes(`name="greeting" rows="2" maxlength="${AGENT_LIMITS.greeting}"`), 'greeting maxlength matches the server limit');
    assert.ok(html.includes('Up to 6,000 characters (about 1,000 words)'), 'the limit is written next to the field');
    assert.ok(html.includes('id="instructionsCount"'), 'live counter element');
    assert.ok(js.includes('updateInstructionsCount') && js.includes("addEventListener('input', updateInstructionsCount)"), 'counter updates as the owner types');
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0); // the agent service keeps a database retry timer open
