/**
 * tests/promise_tracking.test.js
 *
 * Promise tracking and auto-callback (services/promise_service.js):
 * 1. Time words ("tomorrow at 5 pm", "in 2 hours", "Friday morning", "kal shaam") become a moment in time
 * 2. Promises are read from what the call collected (callback_time) and from the AI's reading of the transcript
 * 3. A callback is only ever dialled inside calling hours, never to a "do not call" number, never past the
 *    minutes limit, never twice at once, and is retried once if it is not answered
 * 4. An admin only sees and changes their own promises
 *
 * Run:  node tests/promise_tracking.test.js
 * Local SQLite only; every row it creates is removed. No real call is placed (the queue loop is switched off).
 */
import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';
import db from '../services/db.js';
import PromiseService, { parseDue, insideCallingHours, nextCallingTime, ensurePromiseSchema, looksLikeVoicemail, personTexts } from '../services/promise_service.js';
import CallQueueWorker from '../services/call_queue_worker.js';
import MinutesService from '../services/minutes_service.js';
import PlivoService from '../services/plivo_service.js';
import ExotelService from '../services/exotel_service.js';

let total = 0;
let failed = 0;
async function test(name, fn) {
    total++;
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e.message}`); }
}

// Wednesday 4 Nov 2026, 15:00 in India (09:30 UTC).
const NOW = Date.parse('2026-11-04T09:30:00Z');
const at = (iso) => Date.parse(iso);
const OWNER = `usr_prom_test_${Math.random().toString(36).slice(2, 8)}`;
const OTHER = `usr_prom_other_${Math.random().toString(36).slice(2, 8)}`;
const PHONE = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

// No real call: the queue loop never starts, and the real minutes check is replaced.
CallQueueWorker._startLoop = () => {};
const realExhausted = MinutesService.isExhausted;
const realExtract = PromiseService.llmExtract;
PromiseService.llmExtract = async () => [];

async function cleanup() {
    PromiseService.llmExtract = realExtract;
    MinutesService.isExhausted = realExhausted;
    await db.run('DELETE FROM call_promises WHERE owner_user_id IN (?, ?)', [OWNER, OTHER]).catch(() => {});
    await db.run('DELETE FROM call_queue WHERE batch_id LIKE ?', [`cbk_${OWNER}%`]).catch(() => {});
    await db.run('DELETE FROM call_queue WHERE batch_id LIKE ?', [`cdn_${OWNER}%`]).catch(() => {});
    await db.run('DELETE FROM contacts WHERE owner_user_id IN (?, ?)', [OWNER, OTHER]).catch(() => {});
    await db.run('DELETE FROM batches WHERE owner_user_id IN (?, ?)', [OWNER, OTHER]).catch(() => {});
    await db.run('DELETE FROM conversations WHERE phone = ?', [PHONE]).catch(() => {});
}

function blank(extra = {}) {
    return {
        conversationId: 'conv_test', contactId: null, ownerId: OWNER, agentId: null, service: 'sales',
        phone: PHONE, contactName: 'Test Person', collectedData: {}, classification: '', history: [], nowMs: NOW, ...extra
    };
}
async function promiseRows(owner = OWNER) {
    return db.all('SELECT * FROM call_promises WHERE owner_user_id = ? ORDER BY created_at', [owner]);
}

try {
    await ensurePromiseSchema();
    await cleanup();

    // ---------------------------------------------------------------- 1. reading time words
    await test('Time words become the right moment (India time)', () => {
        const cases = [
            ['tomorrow at 5 pm', '2026-11-05T11:30:00Z'],
            ['Tomorrow at 5:30 p.m.', '2026-11-05T12:00:00Z'],
            ['in 2 hours', new Date(NOW + 2 * 3600000).toISOString()],
            ['in half an hour', new Date(NOW + 1800000).toISOString()],
            ['after 30 minutes', new Date(NOW + 1800000).toISOString()],
            ['Friday morning', '2026-11-06T04:30:00Z'],
            ['kal shaam', '2026-11-05T12:30:00Z'],
            ['repu udayam', '2026-11-05T04:30:00Z'],
            ['at 5', '2026-11-04T11:30:00Z'],
            ['5 pm', '2026-11-04T11:30:00Z'],
            ['2 pm', '2026-11-05T08:30:00Z'],
            ['17:45', '2026-11-04T12:15:00Z'],
            ['next week', '2026-11-11T04:30:00Z'],
            ['day after tomorrow at 11 am', '2026-11-06T05:30:00Z']
        ];
        for (const [text, iso] of cases) {
            const r = parseDue(text, NOW, 330);
            assert.ok(r, `"${text}" is understood`);
            assert.strictEqual(new Date(r.dueMs).toISOString(), new Date(iso).toISOString(), `"${text}"`);
        }
    });

    await test('Words with no time give nothing, and a clock time is marked exact', () => {
        for (const text of ['', null, 'sure thing', 'I will think about it', 'not_specified']) assert.strictEqual(parseDue(text, NOW, 330), null, String(text));
        assert.strictEqual(parseDue('tomorrow at 5 pm', NOW, 330).exact, true);
        assert.strictEqual(parseDue('tomorrow', NOW, 330).exact, false);
    });

    await test('Calling hours: 9 am to 8 pm, and the next opening time is found', () => {
        assert.strictEqual(insideCallingHours(at('2026-11-04T09:30:00Z'), 330), true);
        assert.strictEqual(insideCallingHours(at('2026-11-04T04:00:00Z'), 330), true);   // 9:30 India
        assert.strictEqual(insideCallingHours(at('2026-11-04T03:00:00Z'), 330), false);  // 8:30 India
        assert.strictEqual(insideCallingHours(at('2026-11-04T14:30:00Z'), 330), false);  // 20:00 India
        assert.strictEqual(new Date(nextCallingTime(at('2026-11-04T17:30:00Z'), 330)).toISOString(), '2026-11-05T03:30:00.000Z'); // 23:00 -> 9:00 next day
        assert.strictEqual(new Date(nextCallingTime(at('2026-11-04T01:00:00Z'), 330)).toISOString(), '2026-11-04T03:30:00.000Z'); // 6:30 -> 9:00 same day
        assert.strictEqual(nextCallingTime(NOW, 330), NOW);
    });

    // ---------------------------------------------------------------- 2. finding promises
    await test('A callback time collected on the call becomes a callback with that time', async () => {
        const out = await PromiseService.collect({ collectedData: { callback_time: 'tomorrow at 5 pm' }, classification: 'Callback Requested', nowMs: NOW });
        assert.strictEqual(out.length, 1);
        assert.strictEqual(out[0].kind, 'callback');
        assert.strictEqual(new Date(out[0].dueMs).toISOString(), '2026-11-05T11:30:00.000Z');
        assert.strictEqual(out[0].exact, true);
    });

    await test('"Callback requested" with no time still gives a callback (time filled in when saved)', async () => {
        const out = await PromiseService.collect({ collectedData: {}, classification: 'Callback Requested', nowMs: NOW });
        assert.strictEqual(out.length, 1);
        assert.strictEqual(out[0].dueMs, null);
        const none = await PromiseService.collect({ collectedData: { callback_time: 'not_specified' }, classification: 'Interested', nowMs: NOW });
        assert.deepStrictEqual(none, []);
    });

    await test('No callback_time was collected: the time is read from what the caller said, then the summary', async () => {
        const history = [
            { speaker: 'REMO', text: 'Is now a good time? You can say in 5 minutes or later.' },
            { speaker: 'Test Person', text: 'I am busy, please call me after 2 minutes' },
            { speaker: 'REMO', text: 'Sure, I will call you back.' }
        ];
        let out = await PromiseService.collect({ collectedData: {}, classification: 'Callback Requested', history, nowMs: NOW });
        assert.strictEqual(out.length, 1);
        assert.strictEqual(out[0].dueMs, NOW + 120000, 'two minutes from now, not tomorrow');
        out = await PromiseService.collect({ collectedData: {}, classification: 'Callback Requested', history: [], summary: 'Customer requested a callback after two minutes.', nowMs: NOW });
        assert.strictEqual(out[0].dueMs, NOW + 120000);
        // the AI reading can supply the time too
        PromiseService.llmExtract = async () => [{ kind: 'callback', text: 'Call back', when: 'in 10 minutes' }];
        out = await PromiseService.collect({ collectedData: {}, classification: 'Callback Requested', history: [{ speaker: 'Caller', text: 'okay' }], nowMs: NOW });
        assert.strictEqual(out.length, 1);
        assert.strictEqual(out[0].dueMs, NOW + 600000);
        PromiseService.llmExtract = async () => [];
        // saved: due about two minutes out, inside calling hours
        const saved = await PromiseService.captureForCall(blank({ classification: 'Callback Requested', history }));
        assert.strictEqual(saved.length, 1);
        assert.strictEqual(Date.parse(saved[0].due_at), NOW + 120000);
        await cleanup();
    });

    await test('Someone who said "do not call" gets no promise at all', async () => {
        PromiseService.llmExtract = async () => [{ kind: 'callback', text: 'call back', when: 'tomorrow' }];
        assert.deepStrictEqual(await PromiseService.collect({ collectedData: { callback_time: 'tomorrow' }, classification: 'Do Not Call', nowMs: NOW }), []);
        assert.deepStrictEqual(await PromiseService.collect({ collectedData: { opt_out: true, callback_time: 'tomorrow' }, classification: 'x', nowMs: NOW }), []);
        PromiseService.llmExtract = async () => [];
    });

    await test('The AI reading adds other promises; a second callback and bad entries are dropped', async () => {
        PromiseService.llmExtract = async () => [
            { kind: 'caller_action', text: 'Will send the resume', when: 'by Friday' },
            { kind: 'agent_action', text: 'Send pricing on WhatsApp', when: '' },
            { kind: 'callback', text: 'Call again', when: 'in 1 hour' },
            { kind: 'nonsense', text: 'ignored', when: '' },
            { kind: 'caller_action', text: '', when: '' }
        ];
        const out = await PromiseService.collect({ collectedData: { callback_time: 'tomorrow at 5 pm' }, classification: 'Callback Requested', nowMs: NOW });
        assert.deepStrictEqual(out.map((p) => p.kind), ['callback', 'caller_action', 'agent_action']);
        assert.strictEqual(out[0].text.includes('tomorrow at 5 pm'), true, 'the caller\'s own callback wins');
        assert.ok(out[1].dueMs, 'the Friday promise has a date');
        assert.strictEqual(out[2].dueMs, null, 'no date said, none invented');
        PromiseService.llmExtract = async () => { throw new Error('model down'); };
        const safe = await PromiseService.collect({ collectedData: { callback_time: 'in 2 hours' }, classification: '', nowMs: NOW });
        assert.strictEqual(safe.length, 1, 'if the AI reading fails the plain callback is still kept');
        PromiseService.llmExtract = async () => [];
    });

    // ---------------------------------------------------------------- saving
    await test('Saving keeps the callback inside calling hours and never in the past', async () => {
        await PromiseService.captureForCall(blank({ collectedData: { callback_time: 'tonight at 11 pm' }, classification: 'Callback Requested' }));
        await PromiseService.captureForCall(blank({ phone: `8${PHONE.slice(1)}`, classification: 'Callback Requested' }));
        const rows = await promiseRows();
        assert.strictEqual(rows.length, 2);
        for (const r of rows) {
            assert.strictEqual(r.status, 'pending');
            assert.strictEqual(Number(r.auto_call), 1);
            assert.ok(Date.parse(r.due_at) > NOW, 'in the future');
            assert.ok(insideCallingHours(Date.parse(r.due_at), 330), `${r.due_at} is inside calling hours`);
        }
        const night = rows.find((r) => /11 pm/.test(r.promise_text));
        assert.strictEqual(night.due_at, '2026-11-05T03:30:00.000Z', '11 pm waits for 9 am');
        await cleanup();
    });

    await test('No phone number, or an error, never breaks saving the call', async () => {
        assert.deepStrictEqual(await PromiseService.captureForCall(blank({ phone: '' })), []);
        PromiseService.llmExtract = async () => { throw new Error('boom'); };
        await PromiseService.captureForCall(blank({ collectedData: { callback_time: 'in 2 hours' } }));
        assert.strictEqual((await promiseRows()).length, 1);
        PromiseService.llmExtract = async () => [];
        await cleanup();
    });

    // ---------------------------------------------------------------- 3. the automatic callback
    async function dueCallback(minutesAgo = 1, extra = {}) {
        const saved = await PromiseService.captureForCall(blank({ collectedData: { callback_time: 'in 2 hours' }, nowMs: NOW - 3 * 3600000, ...extra }));
        const id = saved[0].id;
        await db.run('UPDATE call_promises SET due_at = ? WHERE id = ?', [new Date(NOW - minutesAgo * 60000).toISOString(), id]);
        return id;
    }
    const get = (id) => db.get('SELECT * FROM call_promises WHERE id = ?', [id]);

    await test('A due callback is put in the call queue as a new contact, once', async () => {
        const id = await dueCallback();
        let r = await PromiseService.processDue(NOW);
        assert.strictEqual(r.dialled, 1);
        const p = await get(id);
        assert.strictEqual(p.status, 'queued');
        assert.strictEqual(Number(p.attempts), 1);
        const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [p.callback_contact_id]);
        assert.strictEqual(contact.phone, PHONE);
        assert.strictEqual(contact.owner_user_id, OWNER);
        assert.strictEqual(contact.call_status, 'PENDING');
        const queue = await db.get('SELECT * FROM call_queue WHERE contact_id = ?', [contact.id]);
        assert.strictEqual(queue.status, 'QUEUED');
        r = await PromiseService.processDue(NOW);
        assert.strictEqual(r.dialled, 0, 'a second pass does not dial again');
        assert.strictEqual((await db.all('SELECT id FROM call_queue WHERE batch_id = ?', [queue.batch_id])).length, 1);
        await cleanup();
    });

    await test('Not yet due, outside calling hours, or auto-call turned off: nothing is dialled', async () => {
        const later = await PromiseService.captureForCall(blank({ collectedData: { callback_time: 'in 2 hours' } }));
        assert.strictEqual((await PromiseService.processDue(NOW)).dialled, 0, 'not due yet');
        await cleanup();

        const id = await dueCallback();
        const night = at('2026-11-04T17:30:00Z'); // 23:00 India
        assert.strictEqual((await PromiseService.processDue(night)).dialled, 0, 'outside calling hours');
        assert.strictEqual((await get(id)).status, 'pending', 'it waits, it is not lost');
        await PromiseService.update(OWNER, id, { action: 'auto', autoCall: false });
        assert.strictEqual((await PromiseService.processDue(NOW)).dialled, 0, 'automatic call is off');
        await PromiseService.update(OWNER, id, { action: 'auto', autoCall: true });
        assert.strictEqual((await PromiseService.processDue(NOW)).dialled, 1);
        assert.ok(later.length === 1);
        await cleanup();
    });

    await test('A number that asked not to be called is cancelled, not dialled', async () => {
        const id = await dueCallback();
        // An OLD "do not call" (before the callback was asked for) does not block it: the latest word wins.
        const old = '2020-01-01T00:00:00.000Z';
        await db.run(
            "INSERT INTO conversations (id, contact_id, batch_id, service, phone, contact_name, status, started_at, created_at, classification) VALUES (?, 'c', 'b', 'sales', ?, 'T', 'completed', ?, ?, 'Do Not Call')",
            [`conv_dnc_old_${OWNER}`, `+91${PHONE}`, old, old]
        );
        assert.strictEqual(await PromiseService.isDoNotCall(PHONE), true, 'with no date, any do-not-call counts');
        assert.strictEqual(await PromiseService.isDoNotCall(PHONE, (await get(id)).created_at), false, 'an older one is replaced by the later request');
        await db.run('DELETE FROM conversations WHERE id = ?', [`conv_dnc_old_${OWNER}`]);
        // A "do not call" said AFTER the callback was promised does block it.
        const stamp = new Date(Date.now() + 5000).toISOString();
        await db.run(
            "INSERT INTO conversations (id, contact_id, batch_id, service, phone, contact_name, status, started_at, created_at, classification) VALUES (?, 'c', 'b', 'sales', ?, 'T', 'completed', ?, ?, 'Do Not Call')",
            [`conv_dnc_${OWNER}`, `+91${PHONE}`, stamp, stamp]
        );
        const r = await PromiseService.processDue(NOW);
        assert.strictEqual(r.cancelled, 1);
        assert.strictEqual(r.dialled, 0);
        const p = await get(id);
        assert.strictEqual(p.status, 'cancelled');
        assert.match(p.note, /not to be called/);
        await db.run('DELETE FROM conversations WHERE id = ?', [`conv_dnc_${OWNER}`]);
        await cleanup();
    });

    await test('Finished minutes block the call; a paused queue holds it', async () => {
        const id = await dueCallback();
        MinutesService.isExhausted = async () => true;
        let r = await PromiseService.processDue(NOW);
        assert.strictEqual(r.blocked, 1);
        assert.strictEqual((await get(id)).status, 'blocked');
        MinutesService.isExhausted = async () => false;
        await db.run("UPDATE call_promises SET status = 'pending' WHERE id = ?", [id]);
        CallQueueWorker.pausedOwners.add(OWNER);
        r = await PromiseService.processDue(NOW);
        assert.strictEqual(r.dialled, 0, 'the admin paused their calls');
        assert.strictEqual((await get(id)).status, 'pending');
        CallQueueWorker.pausedOwners.delete(OWNER);
        r = await PromiseService.processDue(NOW);
        assert.strictEqual(r.dialled, 1);
        await cleanup();
    });

    await test('The same number is not rung twice at once', async () => {
        const id = await dueCallback();
        await PromiseService.queueCallback({ owner_user_id: OWNER, service: 'sales', contact_name: 'Other', phone: `+91${PHONE}`, promise_text: 'x' });
        const r = await PromiseService.processDue(NOW);
        assert.strictEqual(r.dialled, 0);
        assert.strictEqual((await get(id)).status, 'pending');
        await cleanup();
    });

    await test('Answered: done. Not answered: tried again in 30 minutes, then marked not reached', async () => {
        // answered
        let id = await dueCallback();
        await PromiseService.processDue(NOW);
        let p = await get(id);
        await db.run("UPDATE contacts SET call_status = 'COMPLETED', duration_seconds = 42 WHERE id = ?", [p.callback_contact_id]);
        let r = await PromiseService.processDue(NOW + 60000);
        assert.strictEqual(r.done, 1);
        assert.strictEqual((await get(id)).status, 'done');
        await cleanup();

        // not answered, twice
        id = await dueCallback();
        await PromiseService.processDue(NOW);
        p = await get(id);
        await db.run("UPDATE contacts SET call_status = 'FAILED' WHERE id = ?", [p.callback_contact_id]);
        await db.run("DELETE FROM call_queue WHERE contact_id = ?", [p.callback_contact_id]);
        r = await PromiseService.processDue(NOW + 60000);
        assert.strictEqual(r.retried, 1);
        p = await get(id);
        assert.strictEqual(p.status, 'pending');
        assert.strictEqual(Number(p.attempts), 1);
        assert.strictEqual(p.due_at, new Date(NOW + 60000 + 30 * 60000).toISOString(), 'retry in 30 minutes');
        const retryTime = NOW + 40 * 60000;
        r = await PromiseService.processDue(retryTime);
        assert.strictEqual(r.dialled, 1);
        p = await get(id);
        assert.strictEqual(Number(p.attempts), 2);
        await db.run("UPDATE contacts SET call_status = 'COMPLETED', duration_seconds = 2 WHERE id = ?", [p.callback_contact_id]);
        r = await PromiseService.processDue(retryTime + 60000);
        assert.strictEqual(r.missed, 1, 'a 2-second "call" is not a conversation');
        p = await get(id);
        assert.strictEqual(p.status, 'missed');
        r = await PromiseService.processDue(retryTime + 3600000);
        assert.strictEqual(r.dialled, 0, 'no third try');
        await cleanup();
    });

    // ---------------------------------------------------------------- 3b. no repeated calls to one number
    await test('Two runners at the same moment queue ONE call (live + localhost share a database)', async () => {
        const id = await dueCallback();
        const [a, b] = await Promise.all([PromiseService.processDue(NOW), PromiseService.processDue(NOW)]);
        assert.strictEqual(a.dialled + b.dialled, 1, 'only one runner wins the callback');
        const p = await get(id);
        assert.strictEqual(Number(p.attempts), 1, 'counted once, not twice');
        const queued = await db.all("SELECT cq.id FROM call_queue cq JOIN contacts c ON c.id = cq.contact_id WHERE c.owner_user_id = ?", [OWNER]);
        assert.strictEqual(queued.length, 1, 'one queue row, one contact');
        await cleanup();
    });

    await test('A voicemail greeting or an echo of Remo is not a person asking for a callback', async () => {
        const voicemail = [
            { speaker: 'REMO', text: 'Hello, am I speaking with Ramana?' },
            { speaker: 'Ramana', text: 'Hey, this is Ramna, sorry, I missed your call. I am either in a meeting or another call. Please leave your number, name or short message.' }
        ];
        assert.strictEqual(looksLikeVoicemail(voicemail), true);
        assert.deepStrictEqual(await PromiseService.collect({ collectedData: {}, classification: 'Callback Requested', history: voicemail, nowMs: NOW }), []);
        const saved = await PromiseService.captureForCall(blank({ classification: 'Callback Requested', history: voicemail }));
        assert.deepStrictEqual(saved, []);
        assert.strictEqual((await promiseRows()).length, 0);

        // The line played Remo's own words back: the "caller" said exactly what Remo said. Not a request.
        const echo = [
            { speaker: 'REMO', text: 'Hi, am I speaking with Ramana?' },
            { speaker: 'Ramana', text: 'Hi, am I speaking with Ramana?' }
        ];
        assert.deepStrictEqual(personTexts(echo), []);
        const out = await PromiseService.collect({ collectedData: {}, classification: 'Callback Requested', history: echo, nowMs: NOW });
        assert.strictEqual(out[0].dueMs, null, 'the echo gave no time');

        // A real person is still understood, and a short "yes" is never dropped as an echo.
        const real = [
            { speaker: 'REMO', text: 'Is now a good time to speak for a minute?' },
            { speaker: 'Ramana', text: 'yes' },
            { speaker: 'Ramana', text: 'Please call me on Monday' }
        ];
        assert.strictEqual(looksLikeVoicemail(real), false);
        assert.deepStrictEqual(personTexts(real), ['yes', 'Please call me on Monday']);
        const ok = await PromiseService.collect({ collectedData: {}, classification: 'Callback Requested', history: real, nowMs: NOW });
        assert.ok(ok[0].dueMs, 'Monday is understood');
    });

    await test('A new callback request moves the waiting one; it never piles up', async () => {
        await PromiseService.captureForCall(blank({ collectedData: { callback_time: 'in 2 hours' }, classification: 'Callback Requested' }));
        const again = await PromiseService.captureForCall(blank({ collectedData: { callback_time: 'tomorrow at 5 pm' }, classification: 'Callback Requested' }));
        assert.strictEqual(again.length, 1);
        const rows = await promiseRows();
        assert.strictEqual(rows.length, 1, 'one waiting callback for the number');
        assert.strictEqual(rows[0].due_at, '2026-11-05T11:30:00.000Z', 'moved to the newer time');
        assert.strictEqual(Number(rows[0].attempts), 0);
        await cleanup();
    });

    await test('A call made BECAUSE of a callback only schedules another when a real time is spoken', async () => {
        const id = await dueCallback();
        await PromiseService.processDue(NOW);
        const p = await get(id);
        const vague = await PromiseService.captureForCall(blank({ contactId: p.callback_contact_id, classification: 'Callback Requested', history: [{ speaker: 'Test Person', text: 'I am busy right now' }] }));
        assert.deepStrictEqual(vague, [], 'no time spoken: no new callback, so the loop stops');
        const timed = await PromiseService.captureForCall(blank({ contactId: p.callback_contact_id, collectedData: { callback_time: 'Monday at 11 am' }, classification: 'Callback Requested' }));
        assert.strictEqual(timed.length, 1, 'a spoken time is still honoured');
        await cleanup();
    });

    await test('Saying "call me ..." many times in ONE call still gives one callback, with the latest time', async () => {
        const history = [
            { speaker: 'REMO', text: 'Is now a good time to speak for a minute?' },
            { speaker: 'Test Person', text: 'Call me after 10 minutes' },
            { speaker: 'REMO', text: 'Sure. Just a quick question first.' },
            { speaker: 'Test Person', text: 'No no, call me back after 2 minutes' },
            { speaker: 'Test Person', text: 'Please call me after 2 minutes' }
        ];
        PromiseService.llmExtract = async () => [
            { kind: 'callback', text: 'Call back after 2 minutes', when: 'after 2 minutes' },
            { kind: 'callback', text: 'Call back again', when: 'after 2 minutes' },
            { kind: 'agent_action', text: 'Arrange a callback in 2 minutes', when: 'after 2 minutes' },
            { kind: 'agent_action', text: 'Send the details on WhatsApp', when: '' }
        ];
        const out = await PromiseService.collect({ collectedData: {}, classification: 'Callback Requested', history, nowMs: NOW });
        PromiseService.llmExtract = async () => [];
        assert.deepStrictEqual(out.map((o) => o.kind), ['callback', 'agent_action'], 'one callback; the WhatsApp note is a different promise and stays');
        assert.strictEqual(out[0].dueMs, NOW + 120000, 'the latest time wins');
        assert.strictEqual(out[1].text, 'Send the details on WhatsApp');
        const saved = await PromiseService.captureForCall(blank({ classification: 'Callback Requested', history }));
        assert.strictEqual(saved.filter((s) => s.kind === 'callback').length, 1);
        await cleanup();
    });

    await test('Only one automatic callback per number per day; the next one waits, it is not lost', async () => {
        process.env.PROMISE_MAX_AUTO_PER_DAY = '1';
        const first = await dueCallback();
        await PromiseService.processDue(NOW);
        const p1 = await get(first);
        await db.run("UPDATE contacts SET call_status = 'COMPLETED', duration_seconds = 60 WHERE id = ?", [p1.callback_contact_id]);
        await db.run("UPDATE call_queue SET status = 'COMPLETED' WHERE contact_id = ?", [p1.callback_contact_id]);
        await PromiseService.processDue(NOW + 60000);
        assert.strictEqual((await get(first)).status, 'done');
        // a second callback for the same number, due now
        await db.run(
            "INSERT INTO call_promises (id, owner_user_id, service, phone, contact_name, kind, promise_text, due_at, auto_call, status, attempts, created_at, updated_at) VALUES (?, ?, 'sales', ?, 'T', 'callback', 'again', ?, 1, 'pending', 0, ?, ?)",
            [`prm_cap_${OWNER}`, OWNER, PHONE, new Date(NOW).toISOString(), new Date(NOW).toISOString(), new Date(NOW).toISOString()]
        );
        const r = await PromiseService.processDue(NOW + 120000);
        assert.strictEqual(r.dialled, 0, 'already called today');
        assert.strictEqual(r.deferred, 1);
        const held = await get(`prm_cap_${OWNER}`);
        assert.strictEqual(held.status, 'pending', 'still waiting');
        assert.ok(Date.parse(held.due_at) >= NOW + 23 * 3600000, 'moved to about a day later');
        delete process.env.PROMISE_MAX_AUTO_PER_DAY;
        await cleanup();
    });

    await test('The call queue skips a number that was called a few minutes ago, from any batch', async () => {
        const prev = process.env.SAME_NUMBER_COOLDOWN_MIN;
        delete process.env.SAME_NUMBER_COOLDOWN_MIN;
        const tag = Math.random().toString(36).slice(2, 8);
        const batchId = `cdn_${OWNER}_${tag}`; // an ordinary uploaded sheet
        const cbBatchId = `cbk_${OWNER}_${tag}`; // the owner's promised-callback batch
        const now = new Date().toISOString();
        const mkContact = async (id, status, batch = batchId) => db.run(
            `INSERT INTO contacts (id, batch_id, service, row_index, raw_data, name, phone, preferred_language, notes, extra_data, validation_status, validation_errors, call_status, started_at, updated_at, owner_user_id)
             VALUES (?, ?, 'sales', 0, '{}', 'T', ?, 'en', '', '{}', 'VALID', '[]', ?, ?, ?, ?)`,
            [id, batch, `+91${PHONE}`, status, now, now, OWNER]
        );
        for (const b of [batchId, cbBatchId]) {
            await db.run("INSERT INTO batches (id, service, filename, status, total_rows, valid_rows, invalid_rows, created_at, updated_at, owner_user_id) VALUES (?, 'sales', 'x', 'IN_PROGRESS', 0, 0, 0, ?, ?, ?)", [b, now, now, OWNER]);
        }
        await mkContact(`cnt_recent_${tag}`, 'COMPLETED');
        await mkContact(`cnt_new_${tag}`, 'PENDING');
        await db.run("INSERT INTO call_queue (id, batch_id, contact_id, service, status, priority, created_at, updated_at) VALUES (?, ?, ?, 'sales', 'QUEUED', 5, ?, ?)", [`q_cd_${tag}`, batchId, `cnt_new_${tag}`, now, now]);
        // Safety: no real call can leave this test, whatever happens.
        const realPlivo = PlivoService.initiateOutboundCall;
        const realExotel = ExotelService.initiateOutboundCall;
        let dialled = 0;
        PlivoService.initiateOutboundCall = async () => { dialled++; return { success: false, error: 'test' }; };
        ExotelService.initiateOutboundCall = async () => { dialled++; return { success: false, error: 'test' }; };
        const realRun = CallQueueWorker.isRunning;
        CallQueueWorker.isRunning = true;
        const nextFn = CallQueueWorker._processNext;
        let chained = 0;
        CallQueueWorker._processNext = async function () { chained++; return nextFn.call(this); };
        await nextFn.call(CallQueueWorker); // one pass; the follow-up pass finds an empty queue
        await new Promise((r) => setTimeout(r, 200));
        CallQueueWorker._processNext = nextFn;
        CallQueueWorker.isRunning = realRun;
        PlivoService.initiateOutboundCall = realPlivo;
        ExotelService.initiateOutboundCall = realExotel;
        assert.strictEqual(dialled, 0, 'no call was attempted for the automatic one');
        const skipped = await db.get('SELECT call_status, error_details FROM contacts WHERE id = ?', [`cnt_new_${tag}`]);
        assert.strictEqual(skipped.call_status, 'CANCELLED');
        assert.match(skipped.error_details, /called in the last 30 minutes/);
        assert.strictEqual((await db.get('SELECT status FROM call_queue WHERE id = ?', [`q_cd_${tag}`])).status, 'CANCELLED');

        // A campaign the admin starts on purpose (queue row has a campaign_id) is dialled even so.
        await mkContact(`cnt_camp_${tag}`, 'PENDING');
        await db.run("INSERT INTO call_queue (id, batch_id, contact_id, service, status, priority, campaign_id, created_at, updated_at) VALUES (?, ?, ?, 'sales', 'QUEUED', 9, ?, ?, ?)", [`q_camp_${tag}`, batchId, `cnt_camp_${tag}`, `camp_${tag}`, now, now]);
        const realConfigured = PlivoService.isConfigured;
        PlivoService.isConfigured = () => false; // goes to the stubbed dialler, no voice pre-warm
        PlivoService.initiateOutboundCall = async () => { dialled++; return { success: false, error: 'test' }; };
        ExotelService.initiateOutboundCall = async () => { dialled++; return { success: false, error: 'test' }; };
        CallQueueWorker._processNext = async function () { chained++; return nextFn.call(this); };
        CallQueueWorker.isRunning = true;
        await nextFn.call(CallQueueWorker);
        await new Promise((r) => setTimeout(r, 200));
        CallQueueWorker._processNext = nextFn;
        CallQueueWorker.isRunning = realRun;
        PlivoService.isConfigured = realConfigured;
        PlivoService.initiateOutboundCall = realPlivo;
        ExotelService.initiateOutboundCall = realExotel;
        assert.strictEqual(dialled, 1, 'the campaign contact was dialled (stubbed), not skipped');
        const camp = await db.get('SELECT call_status, error_details FROM contacts WHERE id = ?', [`cnt_camp_${tag}`]);
        assert.ok(!/Skipped/.test(String(camp.error_details || '')), 'not skipped by the cooldown');

        // A promised callback ("call me after 2 minutes") comes right after the call that asked for it: it goes out.
        await mkContact(`cnt_cb_${tag}`, 'PENDING', cbBatchId);
        await db.run("INSERT INTO call_queue (id, batch_id, contact_id, service, status, priority, created_at, updated_at) VALUES (?, ?, ?, 'sales', 'QUEUED', 9, ?, ?)", [`q_cb_${tag}`, cbBatchId, `cnt_cb_${tag}`, now, now]);
        PlivoService.isConfigured = () => false;
        PlivoService.initiateOutboundCall = async () => { dialled++; return { success: false, error: 'test' }; };
        ExotelService.initiateOutboundCall = async () => { dialled++; return { success: false, error: 'test' }; };
        CallQueueWorker._processNext = async function () { chained++; return nextFn.call(this); };
        CallQueueWorker.isRunning = true;
        await nextFn.call(CallQueueWorker);
        await new Promise((r) => setTimeout(r, 200));
        CallQueueWorker._processNext = nextFn;
        CallQueueWorker.isRunning = realRun;
        PlivoService.isConfigured = realConfigured;
        PlivoService.initiateOutboundCall = realPlivo;
        ExotelService.initiateOutboundCall = realExotel;
        assert.strictEqual(dialled, 2, 'the promised callback was dialled (stubbed) right after the earlier call');
        const cbc = await db.get('SELECT error_details FROM contacts WHERE id = ?', [`cnt_cb_${tag}`]);
        assert.ok(!/Skipped/.test(String(cbc.error_details || '')), 'the callback is not skipped by the cooldown');
        if (prev !== undefined) process.env.SAME_NUMBER_COOLDOWN_MIN = prev;
        await cleanup();
    });

    // ---------------------------------------------------------------- 4. the dashboard side
    await test('An admin sees and changes only their own promises', async () => {
        await PromiseService.captureForCall(blank({ collectedData: { callback_time: 'in 2 hours' } }));
        await PromiseService.captureForCall(blank({ ownerId: OTHER, collectedData: { callback_time: 'in 3 hours' } }));
        const mine = await PromiseService.list(OWNER, { status: 'open' });
        assert.strictEqual(mine.total, 1);
        assert.strictEqual(mine.items[0].name, 'Test Person');
        const id = mine.items[0].id;
        assert.strictEqual(await PromiseService.update(OTHER, id, { action: 'done' }), null, 'another admin cannot touch it');
        assert.strictEqual((await get(id)).status, 'pending');
        assert.strictEqual((await PromiseService.update(OWNER, id, { action: 'done' })).status, 'done');
        assert.strictEqual((await PromiseService.list(OWNER, { status: 'open' })).total, 0);
        assert.strictEqual((await PromiseService.list(OWNER, { status: 'done' })).total, 1);
        assert.strictEqual((await PromiseService.update(OWNER, id, { action: 'reopen' })).status, 'pending');
        await assert.rejects(() => PromiseService.update(OWNER, id, { action: 'reschedule', dueAt: 'not a date' }), /valid date/);
        const moved = await PromiseService.update(OWNER, id, { action: 'reschedule', dueAt: '2026-12-01T05:00:00Z' });
        assert.strictEqual(moved.dueAt, '2026-12-01T05:00:00.000Z');
        assert.strictEqual((await PromiseService.update(OWNER, id, { action: 'cancel' })).status, 'cancelled');
        await cleanup();
    });

    await test('Overdue promises are flagged and counted; only callbacks can be set to auto-call', async () => {
        PromiseService.llmExtract = async () => [{ kind: 'caller_action', text: 'Will send the resume', when: 'tomorrow' }];
        await PromiseService.captureForCall(blank({ history: new Array(6).fill({ speaker: 'user', text: 'x' }) }));
        PromiseService.llmExtract = async () => [];
        const row = (await promiseRows())[0];
        assert.strictEqual(row.kind, 'caller_action');
        assert.strictEqual(Number(row.auto_call), 0);
        await assert.rejects(() => PromiseService.update(OWNER, row.id, { action: 'auto', autoCall: true }), /Only callbacks/);
        await db.run('UPDATE call_promises SET due_at = ? WHERE id = ?', [new Date(Date.now() - 86400000).toISOString(), row.id]);
        const list = await PromiseService.list(OWNER, { status: 'open' });
        assert.strictEqual(list.items[0].overdue, true);
        const counts = await PromiseService.counts(OWNER);
        assert.strictEqual(counts.open, 1);
        assert.strictEqual(counts.overdue, 1);
        await cleanup();
    });

    await test('The call-saving code, the server and the dashboard are wired to it', async () => {
        const fs = await import('fs');
        const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
        assert.match(read('services/voicebot_stream_service.js'), /PromiseService\.captureForCall\(/);
        assert.match(read('server.js'), /PromiseService\.start\(\)/);
        assert.match(read('routes/admin.js'), /router\.patch\('\/promises\/:id'/);
        assert.match(read('routes/admin.js'), /router\.post\('\/promises\/:id\/call-now', requireMinutes/);
        const html = read('dashboard.html');
        assert.match(html, /id="view-promises"/);
        assert.match(html, /data-nav="promises"/);
        assert.match(html, /loadPromises\(1\)/);
    });
} finally {
    await cleanup();
}

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
