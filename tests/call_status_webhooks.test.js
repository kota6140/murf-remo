/**
 * tests/call_status_webhooks.test.js
 *
 * Call history showed "failed". Plivo's status and hangup webhooks, and the restart recovery, were rewriting
 * the result of calls that had already finished. These tests cover the rules now:
 * 1. A call that already has a result (completed, failed, unanswered) keeps it
 * 2. A status we do not understand never moves a call backwards
 * 3. A call that never connected is "unanswered" and says so; a connected call is "completed"
 * 4. Failed and unanswered calls record why, so the call history can explain them
 * 5. Restarting the app does not mark an already-finished call as failed
 *
 * Run:  USE_LOCAL_DB=true node tests/call_status_webhooks.test.js
 * It uses the local SQLite database and removes every row it creates.
 */
process.env.USE_LOCAL_DB = 'true';
process.env.ELEVENLABS_API_KEY = '';      // stops the voice module's start-up pre-warming from calling ElevenLabs
process.env.PLIVO_AUTH_ID = 'MATESTAUTHID';
process.env.PLIVO_AUTH_TOKEN = 'test-token';
process.env.SERVER_URL = 'https://example.test';

import assert from 'assert';

const { default: db, initDb } = await import('../services/db.js');
const { handlePlivoStatus, handlePlivoHangup } = await import('../routes/admin.js');
const { default: CallQueueWorker } = await import('../services/call_queue_worker.js');

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

const fakeRes = () => { const r = {}; r.set = () => r; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const status = (body) => handlePlivoStatus({ query: {}, body }, fakeRes());
const hangup = (body) => handlePlivoHangup({ query: {}, body }, fakeRes());
const contact = (id) => db.get('SELECT * FROM contacts WHERE id = ?', [`cnt_cs_${id}`]);
const queue = (id) => db.get('SELECT status FROM call_queue WHERE contact_id = ?', [`cnt_cs_${id}`]);

async function seed(id, callStatus, { withQueue = true, withConversation = false } = {}) {
    const now = new Date().toISOString();
    await db.run("INSERT OR IGNORE INTO batches (id, service, filename, created_at, updated_at) VALUES ('b_cs', 'recruitment', 'test.xlsx', ?, ?)", [now, now]);
    await db.run(
        "INSERT INTO contacts (id, batch_id, service, row_index, raw_data, name, phone, call_status, provider_call_id, updated_at) VALUES (?, 'b_cs', 'recruitment', 1, '{}', 'T', '919900000001', ?, ?, ?)",
        [`cnt_cs_${id}`, callStatus, `PID-${id}`, now]);
    if (withQueue) {
        await db.run(
            "INSERT INTO call_queue (id, batch_id, contact_id, service, status, created_at, updated_at) VALUES (?, 'b_cs', ?, 'recruitment', 'IN_PROGRESS', ?, ?)",
            [`q_cs_${id}`, `cnt_cs_${id}`, now, now]);
    }
    if (withConversation) {
        await db.run(
            "INSERT INTO conversations (id, contact_id, batch_id, service, phone, contact_name, status, started_at, created_at) VALUES (?, ?, 'b_cs', 'recruitment', '919900000001', 'T', 'completed', ?, ?)",
            [`conv_cs_${id}`, `cnt_cs_${id}`, now, now]);
    }
}

async function cleanup() {
    await db.run("DELETE FROM call_queue WHERE id LIKE 'q_cs_%'");
    await db.run("DELETE FROM conversations WHERE id LIKE 'conv_cs_%'");
    await db.run("DELETE FROM contacts WHERE id LIKE 'cnt_cs_%'");
    await db.run("DELETE FROM batches WHERE id = 'b_cs'");
}

await initDb();
await cleanup();
console.log('\nStatus webhook');

await test('an unknown or empty status never moves a finished call backwards', async () => {
    await seed('a', 'COMPLETED');
    for (const s of ['', 'ringing', 'cancel', 'hangup', 'machine']) await status({ CallUUID: 'PID-a', CallStatus: s });
    assert.strictEqual((await contact('a')).call_status, 'COMPLETED');
});

await test('a late "failed" does not overwrite a call that completed', async () => {
    await status({ CallUUID: 'PID-a', CallStatus: 'failed' });
    await status({ CallUUID: 'PID-a', CallStatus: 'no-answer' });
    const c = await contact('a');
    assert.strictEqual(c.call_status, 'COMPLETED');
    assert.ok(!c.error_details, 'no failure note on a good call');
});

await test('an unknown status leaves a call in progress as it was', async () => {
    await seed('b', 'CALLING');
    await status({ CallUUID: 'PID-b', CallStatus: 'ringing' });
    await status({ CallUUID: 'PID-b' });
    assert.strictEqual((await contact('b')).call_status, 'CALLING');
});

await test('in-progress then completed moves the call forward, and the queue follows', async () => {
    await status({ CallUUID: 'PID-b', CallStatus: 'in-progress' });
    assert.strictEqual((await contact('b')).call_status, 'in-progress');
    await status({ CallUUID: 'PID-b', CallStatus: 'completed' });
    assert.strictEqual((await contact('b')).call_status, 'COMPLETED');
    assert.strictEqual((await queue('b')).status, 'COMPLETED');
});

await test('"failed" on a call that was still open is recorded with the reason', async () => {
    await seed('c', 'CALLING');
    await status({ CallUUID: 'PID-c', CallStatus: 'failed', HangupCauseName: 'Invalid Destination Address' });
    const c = await contact('c');
    assert.strictEqual(c.call_status, 'FAILED');
    assert.ok(/failed/.test(c.error_details) && /Invalid Destination Address/.test(c.error_details), c.error_details);
    assert.strictEqual((await queue('c')).status, 'FAILED');
});

await test('"no-answer" becomes unanswered, with a note', async () => {
    await seed('d', 'CALLING');
    await status({ CallUUID: 'PID-d', CallStatus: 'no-answer' });
    const c = await contact('d');
    assert.strictEqual(c.call_status, 'UNANSWERED');
    assert.ok(/no-answer/.test(c.error_details));
});

console.log('\nHangup webhook');

await test('a call that connected is completed, with its talk time (BillDuration wins over Duration)', async () => {
    await seed('e', 'CALLING');
    await hangup({ CallUUID: 'PID-e', Duration: '40', BillDuration: '25' });
    const c = await contact('e');
    assert.strictEqual(c.call_status, 'COMPLETED');
    assert.strictEqual(Number(c.duration_seconds), 25);
    assert.ok(c.ended_at);
    assert.strictEqual((await queue('e')).status, 'COMPLETED');
});

await test('a call that never connected is unanswered, and says so', async () => {
    await seed('f', 'CALLING');
    await hangup({ CallUUID: 'PID-f', Duration: '18', BillDuration: '0', HangupCauseName: 'No Answer' });
    const c = await contact('f');
    assert.strictEqual(c.call_status, 'UNANSWERED');
    assert.ok(/before it was answered/.test(c.error_details) && /No Answer/.test(c.error_details), c.error_details);
    assert.strictEqual((await queue('f')).status, 'UNANSWERED');
});

await test('hangup does not turn a failed call into a completed one', async () => {
    await seed('g', 'FAILED');
    await hangup({ CallUUID: 'PID-g', Duration: '30', BillDuration: '30' });
    assert.strictEqual((await contact('g')).call_status, 'FAILED');
});

await test('hangup on an already completed call keeps it completed and fills in the length', async () => {
    await seed('h', 'COMPLETED');
    await hangup({ CallUUID: 'PID-h', Duration: '144' });
    const c = await contact('h');
    assert.strictEqual(c.call_status, 'COMPLETED');
    assert.strictEqual(Number(c.duration_seconds), 144);
});

await test('a hangup for an unknown call is accepted without error', async () => {
    const res = fakeRes();
    await handlePlivoHangup({ query: {}, body: { CallUUID: 'NOT-A-REAL-ID', Duration: '10' } }, res);
    assert.strictEqual(res.code, 200);
});

console.log('\nApp restart recovery');

await test('a finished call is not marked failed by a restart, but a mid-call one is', async () => {
    await seed('i', 'CALLING', { withConversation: true });   // finished: its conversation was saved
    await seed('j', 'CALLING');                               // really was mid-call
    await seed('k', 'PENDING', { withQueue: false });         // never started
    await seed('l', 'COMPLETED', { withQueue: false });       // already done
    await CallQueueWorker.recoverStaleJobs();
    const i = await contact('i'), j = await contact('j'), k = await contact('k'), l = await contact('l');
    assert.strictEqual(i.call_status, 'COMPLETED', 'finished call kept');
    assert.strictEqual((await queue('i')).status, 'COMPLETED');
    assert.strictEqual(j.call_status, 'FAILED', 'mid-call is interrupted');
    assert.strictEqual(j.error_details, 'Call interrupted by server restart');
    assert.strictEqual((await queue('j')).status, 'FAILED');
    assert.strictEqual(k.call_status, 'PENDING');
    assert.strictEqual(l.call_status, 'COMPLETED');
});

await cleanup();
console.log(`\n${passed}/${total} call-status tests passed\n`);
process.exit(passed === total ? 0 : 1);
