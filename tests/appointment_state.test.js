/**
 * tests/appointment_state.test.js
 *
 * Appointment calls must not repeat questions (regression for the call where the agent asked
 * for the name five times and restarted the booking after a bare "yeah"):
 * 1. Booking state: missing details, stage, "asked again" counter, filler answers
 * 2. The first "yes" starts the booking, later "yes"/"no" answers are left to the AI
 * 3. The AI prompt carries the booking status, the right stages and the plan's real text
 * 4. Failure fallbacks ask for the detail the call is on
 * 5. Other work types are unchanged
 *
 * Run:  node tests/appointment_state.test.js
 */
import assert from 'assert';
import AppointmentState from '../services/appointment_state.js';
import IntentService from '../services/intent_service.js';
import GeminiService from '../services/gemini_service.js';
import QuestionPlanner from '../services/question_planner.js';
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

const FULL = { appointment_purpose: 'teeth cleaning', preferred_date: 'Monday', preferred_time: '11 AM', caller_name: 'Ramana' };

await test('details are asked in order and the stage follows them', () => {
    assert.strictEqual(AppointmentState.stageFor({}), 'PURPOSE');
    assert.strictEqual(AppointmentState.stageFor({ appointment_purpose: 'cleaning' }), 'PREFERRED_DATE');
    assert.strictEqual(AppointmentState.stageFor({ appointment_purpose: 'cleaning', preferred_date: 'Monday' }), 'PREFERRED_TIME');
    assert.strictEqual(AppointmentState.stageFor({ ...FULL, caller_name: '' }), 'CONTACT_DETAILS');
    assert.strictEqual(AppointmentState.stageFor(FULL), 'CONFIRMATION');
    assert.strictEqual(AppointmentState.stageFor({ ...FULL, confirmation: 'yes' }), 'CLOSING');
});

await test('"yeah" and "mm-hmm" never count as a collected detail', () => {
    for (const filler of ['Yeah', 'yeah, yeah, yeah', 'Mm-hmm.', 'okay', 'हां', '']) {
        assert.ok(AppointmentState.isFiller(filler), `"${filler}" is filler`);
    }
    assert.ok(!AppointmentState.isFiller('Monday'));
    assert.strictEqual(AppointmentState.stageFor({ ...FULL, caller_name: 'Yeah' }), 'CONTACT_DETAILS');
});

await test('asking the same detail again is counted, progress resets the count', () => {
    let t = { field: null, count: 0 };
    t = AppointmentState.trackAsk(t, {});
    assert.deepStrictEqual(t, { field: 'appointment_purpose', count: 1 });
    t = AppointmentState.trackAsk(t, {});
    assert.strictEqual(t.count, 2);
    t = AppointmentState.trackAsk(t, { appointment_purpose: 'cleaning' });
    assert.deepStrictEqual(t, { field: 'preferred_date', count: 1 });
    assert.deepStrictEqual(AppointmentState.trackAsk(t, { ...FULL }), { field: null, count: 0 });
});

await test('the prompt block lists what is collected, and asks for a new wording after repeats', () => {
    const block = AppointmentState.buildPromptBlock({ appointment_purpose: 'teeth cleaning' }, { field: 'preferred_date', count: 2 });
    assert.ok(block.includes('appointment_purpose="teeth cleaning"'));
    assert.ok(block.includes('Still missing, in order: preferred_date, preferred_time, caller_name'));
    assert.ok(block.includes('already asked for "preferred_date" 2 times'));
    assert.ok(AppointmentState.buildPromptBlock(FULL).includes('Read them back ONCE'));
});

await test('the first "yes" starts the booking', () => {
    const r = IntentService.matchIntent('Yes, of course', { service: 'appointment', stage: 'AVAILABILITY', collectedData: {}, language: 'en' });
    assert.ok(r.matched);
    assert.strictEqual(r.reason, 'appointment_availability_yes');
    assert.strictEqual(r.next_stage, 'PURPOSE');
});

await test('a contact-list name does not stop the first "yes" from starting the booking', () => {
    const r = IntentService.matchIntent('Yeah', { service: 'appointment', stage: 'AVAILABILITY', collectedData: { caller_name: 'Ramana' }, language: 'en' });
    assert.strictEqual(r.reason, 'appointment_availability_yes');
});

await test('a later "yeah" does not restart the booking (even if the stage label went stale)', () => {
    const stale = IntentService.matchIntent('Yeah', { service: 'appointment', stage: 'AVAILABILITY', collectedData: { appointment_purpose: 'cleaning', preferred_date: 'Monday' }, language: 'en' });
    assert.strictEqual(stale.matched, false, 'left to the AI');
    const later = IntentService.matchIntent('Yeah', { service: 'appointment', stage: 'CONTACT_DETAILS', collectedData: {}, language: 'en' });
    assert.strictEqual(later.matched, false);
});

await test('a "no" after details were given is not treated as "call me back later"', () => {
    const r = IntentService.matchIntent('No', { service: 'appointment', stage: 'AVAILABILITY', collectedData: { appointment_purpose: 'cleaning' }, language: 'en' });
    assert.notStrictEqual(r.reason, 'appointment_availability_no');
    const first = IntentService.matchIntent('No', { service: 'appointment', stage: 'AVAILABILITY', collectedData: {}, language: 'en' });
    assert.strictEqual(first.reason, 'appointment_availability_no');
});

await test('the AI prompt for an appointment call is built for booking, not sales', async () => {
    let seen = null;
    const realGenerate = LLMService.generate;
    LLMService.generate = async (args) => {
        seen = args;
        return { text: '{"spoken_response":"Which day suits you?","extracted_fields":{}}', provider: 't', model: 't' };
    };
    try {
        const plan = QuestionPlanner.generateAppointmentPlan({ company_name: 'Smile Dental Clinic' });
        const history = Array.from({ length: 14 }, (_, i) => ({ speaker: i % 2 ? 'Ramana' : 'REMO', text: `line ${i}` }));
        await GeminiService.generateReply('appointment', { name: 'Ramana' }, history, 'Yeah', { appointment_purpose: 'teeth cleaning' }, {
            questionPlan: plan,
            currentStage: 'PREFERRED_DATE',
            appointmentTracker: { field: 'preferred_date', count: 2 }
        });
    } finally {
        LLMService.generate = realGenerate;
    }
    const p = seen.systemPrompt;
    assert.ok(p.includes('BOOKING STATUS'));
    assert.ok(p.includes('appointment_purpose="teeth cleaning"'));
    assert.ok(p.includes('"PURPOSE" | "PREFERRED_DATE"'), 'appointment stages are offered');
    assert.ok(!p.includes('INTEREST_DISCOVERY'), 'no sales stages or sales wording');
    assert.ok(p.includes('[appointment_purpose]: "What would you like to book'), 'plan shows its real fields and text');
    assert.ok(!p.includes('undefined'));
    assert.ok(seen.maxTokens >= 200, 'room for the full details list');
    assert.ok(seen.messages[0].content.includes('line 0'), 'the longer history window keeps early turns');
});

await test('failure fallbacks ask for the detail the call is on', () => {
    assert.ok(/what would you like to book/i.test(GeminiService.getUniversalFallback('en', 'appointment', 'PURPOSE')));
    assert.ok(/which day/i.test(GeminiService.getUniversalFallback('en', 'appointment', 'PREFERRED_DATE')));
    assert.ok(/what time/i.test(GeminiService.getUniversalFallback('en', 'appointment', 'PREFERRED_TIME')));
    assert.ok(/your name/i.test(GeminiService.getUniversalFallback('en', 'appointment', 'CONTACT_DETAILS')));
    assert.ok(/day and time/i.test(GeminiService.getUniversalFallback('en', 'appointment', 'AVAILABILITY')), 'unknown stage keeps the old line');
    assert.ok(/[ऀ-ॿ]/.test(GeminiService.getUniversalFallback('hi', 'appointment', 'CONTACT_DETAILS')));
});

await test('other work types are unchanged', async () => {
    assert.ok(!GeminiService.getUniversalFallback('en', 'sales', 'PERMISSION_CHECK').includes('book'));
    let seen = null;
    const realGenerate = LLMService.generate;
    LLMService.generate = async (args) => { seen = args; return { text: '{"spoken_response":"Hi"}', provider: 't', model: 't' }; };
    try {
        await GeminiService.generateReply('sales', { name: 'A' }, [{ speaker: 'REMO', text: 'x' }], 'yes please', {}, { currentStage: 'PERMISSION_CHECK' });
    } finally {
        LLMService.generate = realGenerate;
    }
    assert.ok(seen.systemPrompt.includes('INTEREST_DISCOVERY'));
    assert.strictEqual(seen.maxTokens, 250, 'room for one or two spoken sentences plus the JSON envelope');
    assert.ok(!seen.systemPrompt.includes('BOOKING STATUS'));
});

console.log(`\n${passed}/${total} appointment state tests passed\n`);
process.exit(passed === total ? 0 : 1);
