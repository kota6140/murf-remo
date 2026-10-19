/**
 * tests/sales_state.test.js
 *
 * Sales calls must not repeat questions the customer already answered:
 * 1. Code-side state: what is collected, what is missing, which stage the discovery is in
 * 2. The "asked again" counter only runs once the discovery questions have started
 * 3. The AI prompt for a sales call carries the status block (and only sales calls do)
 *
 * Run:  node tests/sales_state.test.js
 */
import assert from 'assert';
import SalesState from '../services/sales_state.js';
import GeminiService from '../services/gemini_service.js';
import LLMService from '../services/llm_service.js';

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

async function promptFor(service, collected, options = {}) {
    let seen = null;
    const realGenerate = LLMService.generate;
    LLMService.generate = async (args) => {
        seen = args;
        return { text: '{"spoken_response":"Sure.","extracted_fields":{}}', provider: 't', model: 't' };
    };
    try {
        await GeminiService.generateReply(service, { name: 'Priya' }, [{ speaker: 'REMO', text: 'Hello' }], 'We need a website', collected, options);
    } finally {
        LLMService.generate = realGenerate;
    }
    return seen.systemPrompt;
}

await test('a bare "yeah" or "mm-hmm" is never a collected detail', () => {
    for (const filler of ['Yeah', 'mm-hmm', 'okay', 'हां', '']) {
        assert.ok(SalesState.isFiller(filler), `"${filler}" is filler`);
    }
    assert.ok(!SalesState.isFiller('web development'));
    assert.ok(!SalesState.has({ service_needed: 'yeah' }, 'service_needed'));
});

await test('the stage follows what the customer has already said', () => {
    assert.strictEqual(SalesState.stageFor({ greeting_confirmed: true, permission_granted: true }, 'PERMISSION_CHECK'), 'SERVICE_DISCOVERY');
    assert.strictEqual(SalesState.stageFor({ permission_granted: true, service_needed: 'website' }, 'SERVICE_DISCOVERY'), 'PROJECT_DESCRIPTION');
    assert.strictEqual(SalesState.stageFor({ permission_granted: true, service_needed: 'website', project_description: 'billing portal' }, 'x'), 'TECH_PREFERENCE');
    assert.strictEqual(SalesState.stageFor({ call_outcome: 'Not Interested' }, 'PERMISSION_CHECK'), 'CLOSING');
});

await test('details the customer gave are not asked again', () => {
    const got = { service_needed: 'website', project_description: 'billing portal', tech_preference: 'Team recommendation', additional_info: 'none', followup_preference: 'email' };
    assert.deepStrictEqual(SalesState.missingFields(got), []);
    const missing = SalesState.missingFields({ service_needed: 'website', project_description: 'billing portal' }).map(f => f.key);
    assert.deepStrictEqual(missing, ['tech_preference', 'additional_info', 'followup_preference']);
});

await test('the "asked again" counter counts the same detail and resets on progress', () => {
    let t = SalesState.trackTurn({ field: null, count: 0 }, {}, 'SERVICE_DISCOVERY');
    assert.deepStrictEqual(t, { field: 'service_needed', count: 1 });
    t = SalesState.trackTurn(t, {}, 'SERVICE_DISCOVERY');
    assert.strictEqual(t.count, 2);
    t = SalesState.trackTurn(t, { service_needed: 'website' }, 'SERVICE_DISCOVERY');
    assert.deepStrictEqual(t, { field: 'project_description', count: 1 });
});

await test('turns spent on greeting and "is this a good time?" are not counted as repeats', () => {
    let t = { field: null, count: 0 };
    for (let i = 0; i < 4; i++) t = SalesState.trackTurn(t, {}, 'PERMISSION_CHECK');
    assert.deepStrictEqual(t, { field: null, count: 0 });
    t = SalesState.trackTurn(t, {}, 'GREETING');
    assert.deepStrictEqual(t, { field: null, count: 0 });
});

await test('the status block lists what is collected and asks for a new wording after repeats', () => {
    const block = SalesState.buildPromptBlock({ service_needed: 'website development' }, { field: 'project_description', count: 2 });
    assert.ok(block.includes('service_needed: "website development"'));
    assert.ok(block.includes('Do NOT ask what service they need'));
    assert.ok(block.includes('DO NOT repeat the question'));
    assert.ok(SalesState.buildPromptBlock({ customer_called_out_repetition: true }).includes('already told you'));
});

await test('the sales AI prompt carries what the customer already said', async () => {
    const p = await promptFor('sales', { service_needed: 'website development', project_description: 'billing portal' }, {
        currentStage: 'QUALIFICATION',
        salesTracker: { field: 'tech_preference', count: 2 }
    });
    assert.ok(p.includes('SALES STATE & ANTI-REPETITION STATUS'));
    assert.ok(p.includes('service_needed: "website development"'));
    assert.ok(p.includes('Do NOT ask what they are looking for'));
    assert.ok(p.includes('DO NOT repeat the question'), 'repeat note shown after 2 unanswered asks');
});

await test('other work types do not get the sales block', async () => {
    for (const service of ['recruitment', 'support', 'appointment', 'receptionist']) {
        const p = await promptFor(service, {}, { currentStage: 'AVAILABILITY' });
        assert.ok(!p.includes('SALES STATE'), `${service} prompt has no sales block`);
    }
});

console.log(`\n${passed}/${total} sales state tests passed\n`);
process.exit(passed === total ? 0 : 1);
