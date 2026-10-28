/**
 * tests/agent_instructions_override.test.js
 *
 * An agent with its own instructions decides what is said about the business. Without them the built-in
 * default sales pitch ("IT or digital marketing services") must never be spoken for that agent:
 *  - the fixed fast-path replies that carry the pitch are skipped, so the AI answers from the instructions;
 *  - replies that say nothing about the business (opt-out, language, busy, repeat) still answer instantly;
 *  - the AI prompt makes the instructions the highest priority and drops the default pitch.
 * Agents without instructions behave exactly as before.
 */
process.env.SKIP_TTS_PRECACHE = '1';
process.env.DB_ENGINE = 'sqlite'; // never reach the real database from this test

import assert from 'assert';
import AgentService from '../services/agent_service.js';
import IntentService from '../services/intent_service.js';
import GeminiService from '../services/gemini_service.js';
import LLMService from '../services/llm_service.js';

let total = 0;
let failed = 0;
async function test(name, fn) {
    total++;
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const AXIS = 'You are Sirisha from Axis Bank. Offer the Axis Bank savings account and a free debit card.';
const sales = (extra = {}) => ({ service: 'sales', stage: 'PERMISSION_CHECK', language: 'en', ...extra });

await test('Without agent instructions, "yes" still gets the built-in pitch (unchanged behaviour)', () => {
    const r = IntentService.matchIntent('Yes', sales());
    assert.strictEqual(r.matched, true);
    assert.ok(/digital marketing/i.test(r.spoken_response));
});

await test('With agent instructions, "yes" goes to the AI instead of the IT / digital marketing line', () => {
    const r = IntentService.matchIntent('Yes', sales({ agentInstructions: AXIS }));
    assert.strictEqual(r.matched, false);
});

await test('With agent instructions, "what services do you offer", "why are you calling" and "who is this" go to the AI', () => {
    for (const q of ['What services do you offer?', 'What is this call about?', 'Who is this?']) {
        assert.strictEqual(IntentService.matchIntent(q, sales({ agentInstructions: AXIS })).matched, false, q);
    }
});

await test('With agent instructions, replies that say nothing about the business still answer instantly', () => {
    const ctx = sales({ agentInstructions: AXIS });
    for (const q of ['not interested', 'please do not call me again', 'please speak in hindi', 'could you repeat that please?']) {
        const r = IntentService.matchIntent(q, ctx);
        assert.strictEqual(r.matched, true, q);
        assert.ok(!/digital marketing|software development/i.test(r.spoken_response), q);
    }
});

await test('Other work types: an agent\'s appointment and support flows are not pushed to the AI needlessly', () => {
    const appt = IntentService.matchIntent('Yes', { service: 'appointment', stage: 'AVAILABILITY', collectedData: {}, language: 'en', agentInstructions: AXIS });
    assert.strictEqual(appt.matched, true);
    const rec = IntentService.matchIntent('Who are you?', { service: 'recruitment', stage: 'AVAILABILITY', language: 'en', agentInstructions: AXIS });
    assert.strictEqual(rec.matched, false, 'recruitment identity question names the company, so the AI answers it');
    const recNo = IntentService.matchIntent('not interested', { service: 'recruitment', language: 'en', agentInstructions: AXIS });
    assert.strictEqual(recNo.matched, true);
});

// The AI prompt
const realGenerate = LLMService.generate;
let captured = null;
LLMService.generate = async (opts) => {
    captured = opts;
    return { text: JSON.stringify({ spoken_response: 'ok', detected_language: 'en', should_end_call: false, extracted_fields: {}, classification: 'Interested', call_summary: 'ok' }), provider: 'test', model: 'test' };
};
const promptFor = async (service, options) => {
    await GeminiService.generateReply(service, { name: 'Ravi' }, [{ speaker: 'REMO', text: 'Hello' }], 'tell me more', {}, options);
    return captured.systemPrompt;
};

try {
    await test('Sales prompt with agent instructions: instructions first, no company built in, no default pitch or offerings', async () => {
        const p = await promptFor('sales', { agentName: 'Sirisha', agentInstructions: AXIS });
        assert.ok(p.includes('AGENT INSTRUCTIONS ("Sirisha") - HIGHEST PRIORITY'));
        assert.ok(p.includes('Never name a company unless these instructions or the campaign document name it'));
        assert.ok(p.includes('Axis Bank savings account'));
        assert.ok(p.includes('representing the company named in the agent instructions'));
        for (const banned of ['Score Labs', 'Scorelabs', 'digital marketing', 'IT or digital', 'web development', 'IT Solutions']) {
            assert.ok(!p.includes(banned), `prompt must not contain "${banned}"`);
        }
    });

    await test('Sales prompt without agent instructions keeps the default pitch but names no company', async () => {
        const p = await promptFor('sales', {});
        assert.ok(!/Score ?labs/i.test(p), 'no company is built in');
        assert.ok(p.includes('no company name (none was given, so never name or invent one)'));
        assert.ok(p.includes('IT or digital marketing services'));
        assert.ok(!p.includes('HIGHEST PRIORITY'));
    });

    await test('A campaign document\'s company and offerings still win over the placeholder', async () => {
        await GeminiService.generateReply('sales', { name: 'Ravi', campaignContext: { company_name: 'Axis Bank', key_features: ['Savings account', 'Debit card'] } },
            [{ speaker: 'REMO', text: 'Hello' }], 'tell me more', {}, { agentInstructions: AXIS });
        const p = captured.systemPrompt;
        assert.ok(p.includes('Axis Bank') && p.includes('Savings account; Debit card'));
        assert.ok(!/Score ?labs/i.test(p));
    });

    await test('No prompt names Scorelabs, with or without agent instructions', async () => {
        for (const service of ['sales', 'support', 'appointment', 'receptionist', 'recruitment']) {
            for (const options of [{}, { agentInstructions: AXIS }]) {
                const p = await promptFor(service, options);
                assert.ok(!/Score ?labs/i.test(p), `${service} ${options.agentInstructions ? 'with' : 'without'} agent instructions`);
            }
            assert.ok((await promptFor(service, { agentInstructions: AXIS })).includes('HIGHEST PRIORITY'), service);
        }
    });
} finally {
    LLMService.generate = realGenerate;
}

// The opening line of an agent that has instructions but no greeting of its own
await test('Opening for an agent without a greeting names only the agent, in English, Hindi and Telugu', () => {
    for (const lang of ['en', 'hi', 'te']) {
        for (const opts of [{ lang }, { lang, name: 'Ravi' }, { lang, inbound: true }]) {
            const line = AgentService.neutralOpening('Sirisha', opts);
            assert.ok(line.includes('Sirisha'), `${lang}: names the agent`);
            assert.ok(!/score ?labs|स्कोर|స్కోర్/i.test(line), `${lang}: must not name Scorelabs`);
        }
    }
    assert.strictEqual(AgentService.neutralOpening('Sirisha'), 'Hi, this is Sirisha. Is now a good time to talk?');
    assert.strictEqual(AgentService.neutralOpening('Sirisha', { name: 'Ravi' }), 'Hello, am I speaking with Ravi? This is Sirisha. Is now a good time to talk?');
    assert.strictEqual(AgentService.neutralOpening('Sirisha', { inbound: true }), 'Thank you for calling, this is Sirisha. How may I help you today?');
    assert.ok(AgentService.neutralOpening('').includes('Remo'), 'falls back to Remo');
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0); // the agent service keeps a database retry timer open
