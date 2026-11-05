/**
 * tests/sales_opening_no_repeat.test.js
 *
 * A sales opening that already asks "is now a good time?" (an agent greeting or a campaign opening line)
 * must not be followed by the built-in "Hi <name>, this is Remo calling from <company>. Is now a good time
 * to talk?" after the caller says yes. Also: a company written as "Scorelabs Inc." never gives "Inc..".
 */
process.env.SKIP_TTS_PRECACHE = '1';

import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';
import fs from 'fs';
import IntentService from '../services/intent_service.js';
import GreetingScript from '../services/greeting_script.js';
import GeminiService from '../services/gemini_service.js';
import LLMService from '../services/llm_service.js';

let total = 0;
let failed = 0;
async function test(name, fn) {
    total++;
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const context = { contact: { name: 'Zikra' }, campaignContext: { company_name: 'Scorelabs Inc.' } };

test('Openings that already ask "good time?" are recognised, in all three languages', () => {
    assert.ok(IntentService.asksIfGoodTime('Hello Zikra, this is Monika calling on behalf of Scorelabs. Is now a convenient time for a quick conversation?'));
    assert.ok(IntentService.asksIfGoodTime('Hi, this is Remo. Is now a good time to talk?'));
    assert.ok(IntentService.asksIfGoodTime('नमस्ते, मैं रेमो बोल रहा हूँ। क्या अभी बात करने का सही समय है?'));
    assert.ok(IntentService.asksIfGoodTime('నమస్కారం, నేను రెమో. ఇప్పుడు మాట్లాడటానికి మంచి సమయమేనా?'));
});

test('A plain "am I speaking with <name>?" opening is not a permission question', () => {
    assert.ok(!IntentService.asksIfGoodTime('Hello, am I speaking with Zikra?'));
    assert.ok(!IntentService.asksIfGoodTime(''));
    assert.ok(!IntentService.asksIfGoodTime(undefined));
});

test('After the permission-asking opening, "yes" moves on to the first question without asking again', () => {
    const res = IntentService.matchIntent('Yes.', {
        service: 'sales',
        stage: 'PERMISSION_CHECK',
        lastQuestion: 'Hello Zikra, this is Monika calling on behalf of Scorelabs. Is now a convenient time for a quick conversation?',
        ...context
    });
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.next_stage, 'INTEREST_DISCOVERY');
    assert.ok(!/good time|convenient time/i.test(res.spoken_response), res.spoken_response);
});

test('After a name-only opening, "yes" still gets the introduction and permission question once', () => {
    const res = IntentService.matchIntent('Yes.', {
        service: 'sales',
        stage: 'GREETING',
        lastQuestion: 'Hello, am I speaking with Zikra?',
        ...context
    });
    assert.strictEqual(res.next_stage, 'PERMISSION_CHECK');
    assert.ok(/good time to talk/i.test(res.spoken_response));
});

test('The introduction never ends the company with a double full stop', () => {
    const res = IntentService.matchIntent('Yes.', {
        service: 'sales', stage: 'GREETING', lastQuestion: 'Hello, am I speaking with Zikra?', ...context
    });
    assert.ok(!res.spoken_response.includes('..'), res.spoken_response);
    assert.strictEqual(GreetingScript.fromCompany('Acme Inc.', 'en'), ' from Acme Inc');
    assert.strictEqual(GreetingScript.fromCompany('Acme', 'en'), ' from Acme');
    assert.strictEqual(GreetingScript.fromCompany('', 'en'), '');
});

test('The call session picks PERMISSION_CHECK for a named sales contact when the opening asks "good time?"', () => {
    const src = fs.readFileSync(new URL('../services/voicebot_stream_service.js', import.meta.url), 'utf8');
    assert.ok(/isNamed && !IntentService\.asksIfGoodTime\(greeting\) \? 'GREETING' : 'PERMISSION_CHECK'/.test(src));
});

// The AI prompt: an agent with instructions is answered by the AI, not by the fast path.
const realGenerate = LLMService.generate;
let captured = null;
LLMService.generate = async (opts) => {
    captured = opts;
    return { text: JSON.stringify({ spoken_response: 'ok', detected_language: 'en', should_end_call: false, extracted_fields: {}, classification: 'Interested', call_summary: 'ok' }), provider: 'test', model: 'test' };
};
const salesPrompt = async (options, campaignContext = { company_name: 'Acme Inc.' }) => {
    await GeminiService.generateReply('sales', { name: 'Zikra', campaignContext }, [{ speaker: 'REMO', text: 'Hello Zikra, is now a convenient time?' }], 'Yes.', {}, options);
    return captured.systemPrompt;
};

try {
    await test('Prompt: a "yes" to an opening that already asked "good time?" must not ask it again', async () => {
        const p = await salesPrompt({ agentName: 'Monika', agentInstructions: 'You are Monika.' });
        assert.ok(p.includes('ALREADY asked whether it is a good time'));
        assert.ok(p.includes('Do NOT ask it again'));
    });

    await test('Prompt: with agent instructions, no fixed "this is Remo calling from <company>" line is offered to speak', async () => {
        const p = await salesPrompt({ agentName: 'Monika', agentInstructions: 'You are Monika.' });
        assert.ok(!/this is Remo calling from/i.test(p), 'the AI must not be handed a Remo script when the agent has its own');
    });

    await test('Prompt: without agent instructions the default introduction has a single full stop after the company', async () => {
        const p = await salesPrompt({});
        assert.ok(p.includes('this is Remo calling from Acme Inc. Is now a good time to talk?'), 'single full stop');
        assert.ok(!p.includes('calling from Acme Inc..'));
    });
} finally {
    LLMService.generate = realGenerate;
}

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
