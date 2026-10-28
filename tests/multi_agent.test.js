/**
 * tests/multi_agent.test.js
 *
 * Multi-agent support:
 * 1. Any number of agents can be created, each with its own phone number (duplicates rejected)
 * 2. One admin can hold several agents; an agent belongs to at most one admin
 * 3. Outgoing calls pick the admin's agent (explicit choice, then work type, then first); admins without agents keep the shared number
 * 4. An admin can never use another admin's agent
 * 5. Plivo outgoing calls use the agent's number as caller ID and carry the agent to the answer webhook
 * 6. Incoming calls to an agent's number are routed to that agent and its admin
 * 7. Agent greetings are filled in with name / role / company / agent
 *
 * Run:  USE_LOCAL_DB=true node tests/multi_agent.test.js
 * It uses the local SQLite database and removes every row it creates.
 */
process.env.USE_LOCAL_DB = 'true';
process.env.PLIVO_AUTH_ID = 'MATESTAUTHID';
process.env.PLIVO_AUTH_TOKEN = 'test-token';
process.env.PLIVO_VIRTUAL_NUMBER = '918000000000';
process.env.SERVER_URL = 'https://example.test';

import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';
import db, { initDb } from '../services/db.js';
import AgentService, { ensureAgentSchema } from '../services/agent_service.js';
import PlivoService from '../services/plivo_service.js';
import { handlePlivoAnswer } from '../routes/admin.js';
import GeminiService from '../services/gemini_service.js';
import LLMService from '../services/llm_service.js';
import IntentService from '../services/intent_service.js';

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

const ADMIN_A = 'usr_test_admin_a';
const ADMIN_B = 'usr_test_admin_b';
const created = [];

async function cleanup() {
    // GLOB is case-sensitive (SQLite only; MySQL has no GLOB, so this fails instead of matching a real "Test ..." agent).
    await db.run("DELETE FROM agents WHERE id GLOB 'agt_*' AND name GLOB 'TEST *'");
    await db.run("DELETE FROM contacts WHERE id LIKE 'cnt_agenttest_%'");
    await db.run("DELETE FROM batches WHERE id LIKE 'batch_agenttest_%'");
}

await initDb();
await ensureAgentSchema();
await cleanup();
console.log('\nMulti-agent tests');

await test('creates several agents with their own numbers', async () => {
    const a = await AgentService.create({ name: 'TEST Hiring', phoneNumber: '+91 80 1111 2222', service: 'recruitment', assignedUserId: ADMIN_A });
    const b = await AgentService.create({ name: 'TEST Sales', phoneNumber: '+918033334444', service: 'sales', assignedUserId: ADMIN_A, greeting: 'Hi {name}, {agent} here from {company}.', instructions: 'Be brief.' });
    const c = await AgentService.create({ name: 'TEST Support', phoneNumber: '918055556666', service: 'support', assignedUserId: ADMIN_B });
    created.push(a, b, c);
    assert.strictEqual(a.phone_number, '918011112222');
    assert.strictEqual(b.service, 'sales');
    assert.ok(a.id.startsWith('agt_'));
});

await test('rejects a duplicate phone number (any formatting)', async () => {
    await assert.rejects(() => AgentService.create({ name: 'TEST Clash', phoneNumber: '080 1111 2222', service: 'sales' }), /already uses this phone number/);
    await assert.rejects(() => AgentService.create({ name: 'TEST Clash', phoneNumber: '8011112222' }), /already uses/);
});

await test('rejects bad input', async () => {
    await assert.rejects(() => AgentService.create({ name: 'x', phoneNumber: '918077778888' }), /name is required/i);
    await assert.rejects(() => AgentService.create({ name: 'TEST Bad', phoneNumber: 'abc' }), /phone number/i);
    await assert.rejects(() => AgentService.create({ name: 'TEST Bad', phoneNumber: '918077778888', service: 'banking' }), /appointment or receptionist/);
});

await test('one admin holds several agents, other admins see only theirs', async () => {
    const a = await AgentService.list({ userId: ADMIN_A });
    const b = await AgentService.list({ userId: ADMIN_B });
    assert.strictEqual(a.filter((x) => x.name.startsWith('TEST')).length, 2);
    assert.strictEqual(b.filter((x) => x.name.startsWith('TEST')).length, 1);
});

await test('outgoing: "Automatic" picks only an agent whose work type matches the campaign', async () => {
    assert.strictEqual((await AgentService.resolveForOutbound(ADMIN_A, { service: 'sales' })).name, 'TEST Sales');
    assert.strictEqual((await AgentService.resolveForOutbound(ADMIN_A, { service: 'recruitment' })).name, 'TEST Hiring');
    // ADMIN_B only has a support agent, so a recruitment campaign keeps the shared number
    assert.strictEqual(await AgentService.resolveForOutbound(ADMIN_B, { service: 'recruitment' }), null);
    assert.strictEqual((await AgentService.resolveForOutbound(ADMIN_B, { service: 'support' })).name, 'TEST Support');
});

await test('outgoing: an explicit choice wins, and another admin\'s agent is refused', async () => {
    const [hiring, sales] = created;
    const picked = await AgentService.resolveForOutbound(ADMIN_A, { service: 'recruitment', agentId: sales.id });
    assert.strictEqual(picked.id, sales.id);
    await assert.rejects(() => AgentService.resolveForOutbound(ADMIN_B, { agentId: hiring.id }), /not assigned to you/);
});

await test('outgoing: an admin with no agents keeps the shared number', async () => {
    assert.strictEqual(await AgentService.resolveForOutbound('usr_test_nobody', { service: 'sales' }), null);
});

await test('a switched-off agent is not used', async () => {
    const [hiring] = created;
    await AgentService.update(hiring.id, { status: 'disabled' });
    assert.strictEqual(await AgentService.resolveForOutbound(ADMIN_A, { service: 'recruitment' }), null);
    await assert.rejects(() => AgentService.resolveForOutbound(ADMIN_A, { agentId: hiring.id }), /switched off/);
    await AgentService.update(hiring.id, { status: 'active' });
    assert.strictEqual((await AgentService.resolveForOutbound(ADMIN_A, { service: 'recruitment' })).name, 'TEST Hiring');
});

await test('giving an agent to another admin / taking it back', async () => {
    const [hiring] = created;
    await AgentService.assign(hiring.id, ADMIN_B);
    assert.strictEqual((await AgentService.list({ userId: ADMIN_B })).filter((x) => x.name.startsWith('TEST')).length, 2);
    await AgentService.setAgentsForUser(ADMIN_A, [hiring.id, created[1].id]);
    assert.strictEqual((await AgentService.get(hiring.id, { fresh: true })).assigned_user_id, ADMIN_A);
    await AgentService.setAgentsForUser(ADMIN_A, [created[1].id]);
    assert.strictEqual((await AgentService.get(hiring.id, { fresh: true })).assigned_user_id, null);
    await AgentService.assign(hiring.id, ADMIN_A);
});

await test('a stamped contact dials with its stamped agent', async () => {
    const [hiring, sales] = created;
    const now = new Date().toISOString();
    await db.run("INSERT INTO batches (id, service, filename, status, created_at, updated_at, owner_user_id) VALUES ('batch_agenttest_1', 'recruitment', 't.xlsx', 'READY', ?, ?, ?)", [now, now, ADMIN_A]);
    await db.run("INSERT INTO contacts (id, batch_id, service, row_index, raw_data, name, phone, call_status, updated_at, owner_user_id) VALUES ('cnt_agenttest_1', 'batch_agenttest_1', 'recruitment', 1, '{}', 'T', '919900000001', 'PENDING', ?, ?)", [now, ADMIN_A]);
    await AgentService.stampBatch('batch_agenttest_1', sales);
    const row = await db.get("SELECT * FROM contacts WHERE id = 'cnt_agenttest_1'");
    assert.strictEqual(row.agent_id, sales.id);
    assert.strictEqual((await AgentService.resolveForContact(row)).id, sales.id);
    // unstamped: falls back to the admin's best match
    await db.run("UPDATE contacts SET agent_id = NULL WHERE id = 'cnt_agenttest_1'");
    const plain = await db.get("SELECT * FROM contacts WHERE id = 'cnt_agenttest_1'");
    assert.strictEqual((await AgentService.resolveForContact(plain)).id, hiring.id);
});

await test('Plivo outgoing call uses the agent number as caller ID and passes the agent on', async () => {
    const realFetch = globalThis.fetch;
    let sent = null;
    globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ message: 'call fired', request_uuid: 'req-1' }) }; };
    try {
        const [hiring] = created;
        const res = await PlivoService.initiateOutboundCall({ id: 'cnt_agenttest_x', phone: '9900000002', name: 'Asha' }, 'recruitment', { agent: hiring });
        assert.ok(res.success);
        assert.strictEqual(sent.from, '918011112222');
        assert.ok(sent.answer_url.includes(`agentId=${hiring.id}`));
        assert.ok(sent.answer_url.includes('direction=outbound'));
        // no agent: the shared number
        await PlivoService.initiateOutboundCall({ id: 'cnt_agenttest_y', phone: '9900000003', name: 'Ravi' }, 'sales', {});
        assert.strictEqual(sent.from, '918000000000');
    } finally { globalThis.fetch = realFetch; }
});

function fakeRes() {
    const r = { headers: {}, body: '' };
    r.set = (k, v) => { r.headers[k] = v; return r; };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    return r;
}

await test('incoming call to an agent number is routed to that agent and its admin', async () => {
    const [, sales] = created;
    const res = fakeRes();
    await handlePlivoAnswer({ query: {}, body: { CallUUID: 'in-1', Direction: 'inbound', From: '919812345678', To: '918033334444' } }, res);
    assert.strictEqual(res.code, 200);
    assert.ok(res.body.includes(`agentId=${sales.id}`), res.body);
    assert.ok(res.body.includes('direction=inbound'));
    assert.ok(res.body.includes('service=sales'));
    assert.ok(res.body.includes(`ownerId=${ADMIN_A}`));
    assert.ok(res.body.includes('phone=919812345678'), 'the caller number is kept as the contact phone');
});

await test('incoming call to an unknown number does not pick an agent', async () => {
    const res = fakeRes();
    await handlePlivoAnswer({ query: {}, body: { CallUUID: 'in-2', Direction: 'inbound', From: '919812345678', To: '919000000099', service: 'support' } }, res);
    assert.strictEqual(res.code, 200);
    assert.ok(!res.body.includes('agentId=agt_'));
});

await test('outgoing answer webhook keeps the agent', async () => {
    const [hiring] = created;
    const res = fakeRes();
    await handlePlivoAnswer({ query: { contactId: 'cnt_agenttest_1', service: 'recruitment', agentId: hiring.id, direction: 'outbound' }, body: { CallUUID: 'out-1' } }, res);
    assert.ok(res.body.includes(`agentId=${hiring.id}`));
    assert.ok(res.body.includes('direction=outbound'));
});

await test('greeting placeholders are filled in and tidied', async () => {
    const out = AgentService.renderGreeting('Hi {name}, {agent} here from {company}.', { name: 'Asha', agent: 'Priya', company: 'Score Labs' });
    assert.strictEqual(out, 'Hi Asha, Priya here from Score Labs.');
    assert.strictEqual(AgentService.renderGreeting('Hello {name}, this is {agent}.', { agent: 'Priya' }), 'Hello, this is Priya.');
});

await test('deleting an agent clears it from contacts', async () => {
    const [, sales] = created;
    await db.run("UPDATE contacts SET agent_id = ? WHERE id = 'cnt_agenttest_1'", [sales.id]);
    await AgentService.remove(sales.id);
    assert.strictEqual((await db.get("SELECT agent_id FROM contacts WHERE id = 'cnt_agenttest_1'")).agent_id, null);
    assert.strictEqual(await AgentService.get(sales.id, { fresh: true }), null);
});

console.log('\nAppointment-setting and receptionist work types');
let booking;
let frontDesk;

await test('appointment and receptionist agents can be created', async () => {
    booking = await AgentService.create({ name: 'TEST Booking', phoneNumber: '918066660001', service: 'appointment', assignedUserId: ADMIN_A, instructions: 'We are a dental clinic open 9 to 6.' });
    frontDesk = await AgentService.create({ name: 'TEST Front Desk', phoneNumber: '918066660002', service: 'receptionist', assignedUserId: ADMIN_A });
    assert.strictEqual(booking.service, 'appointment');
    assert.strictEqual(frontDesk.service, 'receptionist');
});

await test('"Automatic" never picks them for a classic campaign, an explicit choice does', async () => {
    assert.strictEqual((await AgentService.resolveForOutbound(ADMIN_A, { service: 'recruitment' })).name, 'TEST Hiring');
    assert.strictEqual((await AgentService.resolveForOutbound(ADMIN_A, { service: 'appointment' })).name, 'TEST Booking');
    assert.strictEqual((await AgentService.resolveForOutbound(ADMIN_A, { service: 'sales', agentId: frontDesk.id })).id, frontDesk.id);
});

await test('their work type decides how a call is handled (always for these two; for others only when incoming)', async () => {
    assert.ok(AgentService.decidesService(booking, 'outbound'));
    assert.ok(AgentService.decidesService(frontDesk, 'outbound'));
    assert.ok(!AgentService.decidesService(created[0], 'outbound'));
    assert.ok(AgentService.decidesService(created[0], 'inbound'));
    assert.ok(!AgentService.decidesService(null, 'inbound'));
});

await test('incoming call to a receptionist number is handled as receptionist', async () => {
    const res = fakeRes();
    await handlePlivoAnswer({ query: {}, body: { CallUUID: 'in-3', Direction: 'inbound', From: '919800000001', To: '918066660002' } }, res);
    assert.ok(res.body.includes('service=receptionist'), res.body);
    assert.ok(res.body.includes(`agentId=${frontDesk.id}`));
    assert.ok(res.body.includes(`ownerId=${ADMIN_A}`));
});

await test('an outgoing call from an appointment agent is handled as appointment setting, even on another sheet', async () => {
    const res = fakeRes();
    await handlePlivoAnswer({ query: { contactId: 'cnt_agenttest_1', service: 'recruitment', agentId: booking.id, direction: 'outbound' }, body: { CallUUID: 'out-2' } }, res);
    assert.ok(res.body.includes('service=appointment'), res.body);
});

await test('greetings: appointment and receptionist, incoming and outgoing', async () => {
    const out = GeminiService.getOpeningGreeting('appointment', { name: 'Asha', company: 'Smile Clinic', direction: 'outbound' });
    assert.ok(out.includes('Asha') && out.includes('Smile Clinic') && /appointment/i.test(out), out);
    const inb = GeminiService.getOpeningGreeting('appointment', { company: 'Smile Clinic', direction: 'inbound' });
    assert.ok(inb.startsWith('Thank you for calling Smile Clinic'), inb);
    assert.ok(GeminiService.getOpeningGreeting('receptionist', { company: 'Smile Clinic', direction: 'inbound' }).includes('How may I help you today?'));
    assert.ok(GeminiService.getOpeningGreeting('receptionist', { company: 'Smile Clinic', direction: 'outbound' }).includes('following up'));
});

await test('default outcome labels and fallbacks exist for the new work types', async () => {
    assert.strictEqual(GeminiService.defaultClassification('appointment'), 'Pending');
    assert.strictEqual(GeminiService.defaultClassification('receptionist'), 'Enquiry');
    assert.strictEqual(GeminiService.defaultClassification('sales'), 'Interested');
    assert.strictEqual(GeminiService.defaultClassification('recruitment'), 'On Hold');
    assert.ok(/appointment/i.test(GeminiService.getUniversalFallback('en', 'appointment')));
    assert.ok(/message/i.test(GeminiService.getUniversalFallback('en', 'receptionist')));
});

await test('the AI prompt carries the new workflows, the agent instructions and the right outcome labels', async () => {
    const realGenerate = LLMService.generate;
    let captured = null;
    LLMService.generate = async (opts) => { captured = opts; return { text: JSON.stringify({ spoken_response: 'Sure.', detected_language: 'en', should_end_call: false, extracted_fields: {}, classification: 'Appointment Booked', call_summary: 'ok' }), provider: 'test', model: 'test' }; };
    try {
        const reply = await GeminiService.generateReply('appointment', { name: 'Asha', company: 'Smile Clinic' }, [{ speaker: 'REMO', text: 'Hello' }], 'Friday at four please', {}, { agentName: 'Meera', agentInstructions: 'We are a dental clinic open 9 to 6.', direction: 'outbound' });
        assert.strictEqual(reply.classification, 'Appointment Booked');
        assert.ok(captured.systemPrompt.includes('APPOINTMENT SETTING WORKFLOW'));
        assert.ok(captured.systemPrompt.includes('dental clinic open 9 to 6'));
        assert.ok(captured.systemPrompt.includes('You are Meera'));
        assert.ok(captured.systemPrompt.includes('"Appointment Booked"'));
        await GeminiService.generateReply('receptionist', { name: 'Caller' }, [{ speaker: 'REMO', text: 'Hi' }], 'Are you open on Sunday?', {}, { direction: 'inbound' });
        assert.ok(captured.systemPrompt.includes('RECEPTIONIST WORKFLOW'));
        assert.ok(captured.systemPrompt.includes('INCOMING call'));
        assert.ok(captured.systemPrompt.includes('"Message Taken"'));
    } finally { LLMService.generate = realGenerate; }
});

await test('quick replies: appointment opening yes/no, not interested, wrong number', async () => {
    const yes = IntentService.matchIntent('yes', { service: 'appointment', stage: 'AVAILABILITY' });
    assert.ok(yes.matched, 'a yes to the opening is understood');
    assert.ok(/appointment/i.test(yes.spoken_response));
    const no = IntentService.matchIntent('no', { service: 'appointment', stage: 'AVAILABILITY' });
    assert.ok(no.matched);
    assert.strictEqual(no.classification, 'Callback Requested');
    assert.strictEqual(IntentService.matchIntent('not interested', { service: 'appointment' }).classification, 'Not Interested');
    assert.strictEqual(IntentService.matchIntent('wrong number', { service: 'receptionist' }).classification, 'Wrong Number');
    // existing work types behave as before
    assert.strictEqual(IntentService.matchIntent('not interested', { service: 'recruitment' }).classification, 'Rejected');
    assert.strictEqual(IntentService.matchIntent('not interested', { service: 'sales' }).classification, 'Not Interested');
});

await cleanup();
console.log(`\n${passed}/${total} multi-agent tests passed\n`);
process.exit(passed === total ? 0 : 1);
