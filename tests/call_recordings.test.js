/**
 * tests/call_recordings.test.js
 *
 * Call recordings: access (admin = own calls, owner = all), play / download, the 30-day expiry counted
 * from the call END, the daily permanent deletion, retry of the recording start and recovery of missed links.
 *
 * Runs on an in-memory SQLite database and a fake Plivo (global fetch), so it never touches the real
 * database or phone provider. Needs Node 22+ (node:sqlite) or better-sqlite3; otherwise it skips.
 */
process.env.DB_ENGINE = 'sqlite';
process.env.SKIP_TTS_PRECACHE = '1';
process.env.PLIVO_AUTH_ID = 'MATESTAUTH';
process.env.PLIVO_AUTH_TOKEN = 'testtoken';
process.env.SERVER_URL = 'https://test.example.com';

import assert from 'assert';
import fs from 'fs';
import { Writable } from 'stream';

async function openMemoryDb() {
    try {
        const { DatabaseSync } = await import('node:sqlite');
        return new DatabaseSync(':memory:');
    } catch { /* older Node */ }
    try {
        const { default: Database } = await import('better-sqlite3');
        return new Database(':memory:');
    } catch {
        return null;
    }
}

const mem = await openMemoryDb();
if (!mem) {
    console.log('SKIP: needs Node 22+ (node:sqlite) or better-sqlite3 for the in-memory database.');
    process.exit(0);
}

mem.exec(`
    CREATE TABLE batches (id TEXT PRIMARY KEY, owner_user_id TEXT);
    CREATE TABLE contacts (
        id TEXT PRIMARY KEY, batch_id TEXT, name TEXT, phone TEXT, provider_call_id TEXT,
        started_at TEXT, ended_at TEXT, duration_seconds INTEGER DEFAULT 0, updated_at TEXT,
        recording_url TEXT, recording_id TEXT, recording_expires_at TEXT
    );
    CREATE TABLE conversations (
        id TEXT PRIMARY KEY, contact_id TEXT, batch_id TEXT, phone TEXT, contact_name TEXT, status TEXT,
        started_at TEXT, ended_at TEXT, duration_seconds INTEGER DEFAULT 0, created_at TEXT, owner_user_id TEXT,
        provider_call_id TEXT, recording_url TEXT, recording_id TEXT, recording_expires_at TEXT, recording_deleted_at TEXT,
        summary TEXT, classification TEXT
    );
    CREATE TABLE transcript_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT, speaker TEXT, text TEXT);
`);

const { default: db } = await import('../services/db.js');
db.get = async (sql, params = []) => mem.prepare(sql).get(...params) ?? null;
db.all = async (sql, params = []) => mem.prepare(sql).all(...params);
db.run = async (sql, params = []) => mem.prepare(sql).run(...params);

const { default: RecordingService } = await import('../services/recording_service.js');
const { default: PlivoService } = await import('../services/plivo_service.js');
RecordingService.ensureSchema = async () => {};
const adminModule = await import('../routes/admin.js');
const adminRouter = adminModule.default;
const { handlePlivoRecording } = adminModule;
const ownerCallsRouter = (await import('../routes/owner_calls.js')).default;

// ── helpers ─────────────────────────────────────────────────────────────────
let total = 0;
let failed = 0;
async function test(name, fn) {
    total++;
    try {
        await fn();
        console.log(`  [PASS] ${name}`);
    } catch (e) {
        failed++;
        console.error(`  [FAIL] ${name}\n         ${e.stack || e.message}`);
    }
}

const DAY = 24 * 60 * 60 * 1000;
const iso = (days) => new Date(Date.now() + days * DAY).toISOString();
const url = (id) => `https://media.plivo.com/v1/Account/MATESTAUTH/Recording/${id}.mp3`;
const AUDIO = Buffer.from('ID3-fake-audio-bytes');

function reset() {
    mem.exec('DELETE FROM conversations; DELETE FROM contacts; DELETE FROM batches; DELETE FROM transcript_messages;');
}

function addConversation(o) {
    const c = {
        id: 'conv', contact_id: 'ct', batch_id: 'b', phone: '+919999999999', contact_name: 'Asha Rao', status: 'completed',
        started_at: iso(-1), ended_at: iso(-1), duration_seconds: 60, created_at: iso(-1), owner_user_id: null,
        provider_call_id: null, recording_url: null, recording_id: null, recording_expires_at: null, recording_deleted_at: null, ...o
    };
    mem.prepare(`INSERT INTO conversations (id, contact_id, batch_id, phone, contact_name, status, started_at, ended_at, duration_seconds, created_at, owner_user_id, provider_call_id, recording_url, recording_id, recording_expires_at, recording_deleted_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(c.id, c.contact_id, c.batch_id, c.phone, c.contact_name, c.status, c.started_at, c.ended_at, c.duration_seconds, c.created_at, c.owner_user_id, c.provider_call_id, c.recording_url, c.recording_id, c.recording_expires_at, c.recording_deleted_at);
}

function addContact(o) {
    const c = {
        id: 'ct', batch_id: 'b', name: 'Asha Rao', phone: '+919999999999', provider_call_id: null, started_at: iso(-1),
        ended_at: iso(-1), duration_seconds: 60, updated_at: iso(-1), recording_url: null, recording_id: null, recording_expires_at: null, ...o
    };
    mem.prepare(`INSERT INTO contacts (id, batch_id, name, phone, provider_call_id, started_at, ended_at, duration_seconds, updated_at, recording_url, recording_id, recording_expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(c.id, c.batch_id, c.name, c.phone, c.provider_call_id, c.started_at, c.ended_at, c.duration_seconds, c.updated_at, c.recording_url, c.recording_id, c.recording_expires_at);
}

const addBatch = (id, owner) => mem.prepare('INSERT INTO batches (id, owner_user_id) VALUES (?, ?)').run(id, owner);
const conv = (id) => mem.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
const contact = (id) => mem.prepare('SELECT * FROM contacts WHERE id = ?').get(id);

// Fake Plivo / storage: rules are tried in order; every request is recorded.
let requests = [];
let rules = [];
globalThis.fetch = async (target, init = {}) => {
    const request = { url: String(target), method: init.method || 'GET', headers: init.headers || {}, body: init.body };
    requests.push(request);
    for (const rule of rules) {
        const response = rule(request);
        if (response) return response;
    }
    return new Response('not stubbed', { status: 500 });
};
const setRules = (...r) => { requests = []; rules = r; };
const sent = (method) => requests.filter(r => r.method === method);

const storageRules = () => [
    (r) => r.url.startsWith('https://media.plivo.com/') && r.method === 'GET'
        ? new Response(null, { status: 302, headers: { location: 'https://s3.example.com/signed?sig=1' } }) : null,
    (r) => r.url.startsWith('https://s3.example.com/')
        ? new Response(AUDIO, {
            status: r.headers.Range ? 206 : 200,
            headers: { 'content-type': 'audio/mpeg', 'content-length': String(AUDIO.length), ...(r.headers.Range ? { 'content-range': `bytes 0-${AUDIO.length - 1}/${AUDIO.length}` } : {}) }
        }) : null
];

class MockRes extends Writable {
    constructor() {
        super();
        this.statusCode = 200;
        this.headers = {};
        this.chunks = [];
        this.body = null;
        this.done = new Promise(resolve => this.on('finish', resolve));
    }
    status(code) { this.statusCode = code; return this; }
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; }
    json(payload) { this.body = payload; this.end(); return this; }
    send(text) { this.body = text; this.end(); return this; }
    _write(chunk, enc, cb) { this.chunks.push(chunk); cb(); }
    get bytes() { return Buffer.concat(this.chunks); }
}

const routeHandler = (router, path) => router.stack.find(l => l.route && l.route.path === path && l.route.methods.get).route.stack[0].handle;

console.log('================================================================');
console.log('CALL RECORDINGS: ACCESS, DOWNLOAD, 30-DAY EXPIRY, DELETION, RELIABILITY');
console.log('================================================================\n');

// ── Links ───────────────────────────────────────────────────────────────────
await test('Only https links on Plivo\'s own domain are accepted', () => {
    assert.ok(RecordingService.isAllowedUrl(url('a')));
    assert.ok(RecordingService.isAllowedUrl('https://plivo.com/x.mp3'));
    for (const bad of ['http://media.plivo.com/x.mp3', 'https://evil.com/?plivo.com', 'https://plivo.com.evil.com/x', 'https://notplivo.com/x', 'C:\\secrets\\.env', '/etc/passwd', '', null, undefined]) {
        assert.strictEqual(RecordingService.isAllowedUrl(bad), false, `must reject ${bad}`);
    }
    assert.strictEqual(RecordingService.idFromUrl(url('rec-9')), 'rec-9');
});

// ── Expiry ──────────────────────────────────────────────────────────────────
await test('Expiry is 30 days after the call ENDED, with fallbacks, and a stored stamp wins', () => {
    const ended = '2026-10-01T10:30:00.000Z';
    assert.strictEqual(RecordingService.expiryFor({ ended_at: ended, started_at: '2026-10-01T10:00:00.000Z' }), '2026-10-31T10:30:00.000Z');
    // No end time: start + duration
    assert.strictEqual(RecordingService.expiryFor({ started_at: '2026-10-01T10:00:00.000Z', duration_seconds: 120 }), '2026-10-31T10:02:00.000Z');
    assert.strictEqual(RecordingService.expiryFor({ recording_expires_at: '2030-01-01T00:00:00.000Z', ended_at: ended }), '2030-01-01T00:00:00.000Z');
    assert.strictEqual(RecordingService.expiryFor({}), null);
});

await test('Status: available, unavailable, expired (by date or by deletion)', () => {
    assert.strictEqual(RecordingService.statusOf({ recording_url: url('a'), ended_at: iso(-1) }), 'available');
    assert.strictEqual(RecordingService.statusOf({ ended_at: iso(-1) }), 'unavailable');
    assert.strictEqual(RecordingService.statusOf({ recording_url: url('a'), ended_at: iso(-31) }), 'expired');
    assert.strictEqual(RecordingService.statusOf({ recording_url: url('a'), ended_at: iso(-29) }), 'available');
    assert.strictEqual(RecordingService.statusOf({ recording_deleted_at: iso(-1) }), 'expired');
    assert.strictEqual(RecordingService.statusOf({ ended_at: iso(-90) }), 'unavailable', 'an old call that never had a recording is not "expired"');
    const info = RecordingService.describe({ id: 'c 1', recording_url: url('a'), ended_at: iso(-1) }, '/api/owner');
    assert.strictEqual(info.audio_url, '/api/owner/conversations/c%201/audio');
    assert.strictEqual(info.download_url, '/api/owner/conversations/c%201/audio?download=1');
    assert.strictEqual(info.retention_days, 30);
});

// ── Access ──────────────────────────────────────────────────────────────────
await test('An admin only finds their own calls (not unassigned ones); the owner finds every call', async () => {
    reset();
    addBatch('b-admin1', 'admin1');
    addBatch('b-admin2', 'admin2');
    addBatch('b-free', null);
    addContact({ id: 'ct1', batch_id: 'b-admin1' });
    addContact({ id: 'ct2', batch_id: 'b-admin2' });
    addContact({ id: 'ctf', batch_id: 'b-free' });
    addConversation({ id: 'mine', contact_id: 'ct1', batch_id: 'b-admin1', owner_user_id: 'admin1' });
    addConversation({ id: 'theirs', contact_id: 'ct2', batch_id: 'b-admin2', owner_user_id: 'admin2' });
    addConversation({ id: 'via-sheet', contact_id: 'ct1', batch_id: 'b-admin1', owner_user_id: null });
    addConversation({ id: 'other-sheet', contact_id: 'ct2', batch_id: 'b-admin2', owner_user_id: null });
    addConversation({ id: 'unassigned', contact_id: 'ctf', batch_id: 'b-free', owner_user_id: null });
    addConversation({ id: 'direct', contact_id: 'direct', batch_id: 'direct_batch', owner_user_id: null });

    for (const id of ['mine', 'via-sheet']) {
        assert.ok(await RecordingService.findConversation(id, { adminId: 'admin1' }), `admin1 must reach ${id}`);
    }
    for (const id of ['theirs', 'other-sheet', 'unassigned', 'direct']) {
        assert.strictEqual(await RecordingService.findConversation(id, { adminId: 'admin1' }), null, `admin1 must NOT reach ${id}`);
    }
    for (const id of ['mine', 'theirs', 'via-sheet', 'other-sheet', 'unassigned', 'direct']) {
        assert.ok(await RecordingService.findConversation(id), `owner must reach ${id}`);
    }
    assert.strictEqual(await RecordingService.findConversation('nope'), null);
    assert.strictEqual(await RecordingService.findConversation(''), null);
});

await test('Admin routes check ownership: another admin\'s audio and info are "not found"', async () => {
    reset();
    addBatch('b2', 'admin2');
    addContact({ id: 'ct2', batch_id: 'b2' });
    addConversation({ id: 'theirs', contact_id: 'ct2', batch_id: 'b2', owner_user_id: 'admin2', recording_url: url('r1'), recording_id: 'r1' });
    setRules(...storageRules());

    for (const path of ['/conversations/:id/audio', '/conversations/:id/recording-info']) {
        const res = new MockRes();
        await routeHandler(adminRouter, path)({ params: { id: 'theirs' }, query: {}, headers: {}, user: { id: 'admin1', role: 'admin' } }, res);
        assert.strictEqual(res.statusCode, 404, `${path} must be 404 for another admin`);
        assert.strictEqual(requests.length, 0, 'the recording must not even be requested from storage');
    }

    const res = new MockRes();
    await routeHandler(adminRouter, '/conversations/:id/audio')({ params: { id: 'theirs' }, query: {}, headers: {}, user: { id: 'admin2', role: 'admin' } }, res);
    await res.done;
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.bytes, AUDIO);

    const info = new MockRes();
    await routeHandler(adminRouter, '/conversations/:id/recording-info')({ params: { id: 'theirs' }, query: {}, headers: {}, user: { id: 'admin2', role: 'admin' } }, info);
    assert.strictEqual(info.body.available, true);
    assert.strictEqual(info.body.audio_url, '/api/admin/conversations/theirs/audio');
    assert.ok(info.body.download_url.endsWith('?download=1'));
    assert.ok(info.body.expires_at, 'the expiry date must be shown');
});

await test('Owner panel has the audio and info routes; end users have none', () => {
    const paths = ownerCallsRouter.stack.filter(l => l.route && l.route.methods.get).map(l => l.route.path);
    assert.ok(paths.includes('/conversations/:id/audio'));
    assert.ok(paths.includes('/conversations/:id/recording-info'));
    assert.ok(!/recording|audio/i.test(fs.readFileSync(new URL('../routes/user.js', import.meta.url), 'utf8')), 'routes/user.js must not expose recordings');
});

// ── Play and download ───────────────────────────────────────────────────────
await test('Playing follows the redirect, sends credentials to Plivo only, and supports seeking (Range)', async () => {
    reset();
    addConversation({ id: 'c1', recording_url: url('r1'), recording_id: 'r1' });
    setRules(...storageRules());
    const row = await RecordingService.findConversation('c1');
    const res = new MockRes();
    await RecordingService.serve({ headers: { range: 'bytes=0-9' } }, res, row);
    await res.done;

    assert.strictEqual(res.statusCode, 206);
    assert.strictEqual(res.headers['content-type'], 'audio/mpeg');
    assert.ok(res.headers['content-range']);
    assert.strictEqual(res.headers['cache-control'], 'private, no-store');
    assert.ok(!res.headers['content-disposition'], 'playing is not a download');
    assert.deepStrictEqual(res.bytes, AUDIO);
    assert.ok(requests[0].headers.Authorization.startsWith('Basic '), 'Plivo gets the credentials');
    assert.strictEqual(requests[1].url.startsWith('https://s3.example.com/'), true);
    assert.strictEqual(requests[1].headers.Authorization, undefined, 'the storage address must never get the credentials');
    assert.strictEqual(requests[1].headers.Range, 'bytes=0-9');
});

await test('Download sends the file named with the contact and call date, and ignores Range', async () => {
    reset();
    addConversation({ id: 'c1', contact_name: 'Asha Rao', started_at: '2026-10-05T09:30:00.000Z', recording_url: url('r1'), recording_id: 'r1' });
    setRules(...storageRules());
    const row = await RecordingService.findConversation('c1');
    const res = new MockRes();
    await RecordingService.serve({ headers: { range: 'bytes=5-' } }, res, row, { download: true });
    await res.done;
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-disposition'], 'attachment; filename="Asha_Rao_2026-10-05.mp3"');
    assert.strictEqual(requests[1].headers.Range, undefined);

    assert.strictEqual(RecordingService.downloadName({ contact_name: 'నమస్కారం', phone: '+91 98765 43210', started_at: 'bad' }, 'audio/wav'), '91_98765_43210_recording.wav');
    assert.strictEqual(RecordingService.downloadName({}, ''), 'call_recording.mp3');
});

await test('A link served directly by Plivo (no redirect) is streamed with the credentials', async () => {
    reset();
    addConversation({ id: 'c1', recording_url: url('r1'), recording_id: 'r1' });
    setRules((r) => r.url === url('r1') ? new Response(AUDIO, { status: 200, headers: { 'content-type': 'audio/mpeg' } }) : null);
    const res = new MockRes();
    await RecordingService.serve({ headers: {} }, res, await RecordingService.findConversation('c1'));
    await res.done;
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.bytes, AUDIO);
    assert.strictEqual(requests.length, 1);
});

await test('Expired recordings answer 410, missing ones 404, and neither reaches storage', async () => {
    reset();
    addConversation({ id: 'old', ended_at: iso(-31), started_at: iso(-31), recording_url: url('r1'), recording_id: 'r1' });
    addConversation({ id: 'gone', recording_deleted_at: iso(-1) });
    addConversation({ id: 'none', provider_call_id: null });
    setRules(...storageRules());

    for (const [id, code, status] of [['old', 410, 'expired'], ['gone', 410, 'expired'], ['none', 404, 'unavailable']]) {
        const res = new MockRes();
        await RecordingService.serve({ headers: {} }, res, await RecordingService.findConversation(id));
        assert.strictEqual(res.statusCode, code, id);
        assert.strictEqual(res.body.status, status, id);
    }
    assert.match(
        (await (async () => { const r = new MockRes(); await RecordingService.serve({ headers: {} }, r, await RecordingService.findConversation('old')); return r.body.message; })()),
        /expired \(30-day limit\)/i);
    assert.strictEqual(requests.length, 0);
});

await test('A stored link that is not a Plivo address is never fetched or read from disk', async () => {
    reset();
    addConversation({ id: 'evil1', recording_url: 'https://evil.example.com/?plivo.com' });
    addConversation({ id: 'evil2', recording_url: 'C:\\Users\\Shaibaaz\\murf-remo\\.env' });
    setRules(...storageRules());
    for (const id of ['evil1', 'evil2']) {
        const res = new MockRes();
        await RecordingService.serve({ headers: {} }, res, await RecordingService.findConversation(id));
        assert.strictEqual(res.statusCode, 404, id);
    }
    assert.strictEqual(requests.length, 0, 'no request may be made with our Plivo credentials');
});

await test('Storage errors become a clean 502 (or 404 when Plivo says the recording is gone)', async () => {
    reset();
    addConversation({ id: 'c1', recording_url: url('r1'), recording_id: 'r1' });
    const row = await RecordingService.findConversation('c1');
    setRules(() => new Response('boom', { status: 500 }));
    let res = new MockRes();
    await RecordingService.serve({ headers: {} }, res, row);
    assert.strictEqual(res.statusCode, 502);
    setRules(() => new Response('missing', { status: 404 }));
    res = new MockRes();
    await RecordingService.serve({ headers: {} }, res, row);
    assert.strictEqual(res.statusCode, 404);
});

// ── Saving the link ─────────────────────────────────────────────────────────
await test('Recording callback saves the link on the right call and stamps call end + 30 days', async () => {
    reset();
    addContact({ id: 'ct', provider_call_id: 'call-1', ended_at: '2026-10-01T10:30:00.000Z' });
    addConversation({ id: 'c1', contact_id: 'ct', provider_call_id: 'call-1', ended_at: '2026-10-01T10:30:00.000Z' });
    const result = await RecordingService.saveFromWebhook({ callUuid: 'call-1', contactId: 'ct', recordingUrl: url('r1'), recordingId: 'r1' });
    assert.strictEqual(result.saved, true);
    assert.strictEqual(conv('c1').recording_url, url('r1'));
    assert.strictEqual(conv('c1').recording_id, 'r1');
    assert.strictEqual(conv('c1').recording_expires_at, '2026-10-31T10:30:00.000Z');
    assert.strictEqual(contact('ct').recording_url, url('r1'));
    assert.strictEqual(contact('ct').recording_expires_at, '2026-10-31T10:30:00.000Z');
});

await test('A callback does not copy its recording onto the contact\'s other calls', async () => {
    reset();
    addContact({ id: 'ct', provider_call_id: 'call-2' }); // second attempt is the current call
    addConversation({ id: 'first', contact_id: 'ct', provider_call_id: 'call-1', recording_url: url('r-first'), recording_id: 'r-first' });
    addConversation({ id: 'second', contact_id: 'ct', provider_call_id: 'call-2' });
    await RecordingService.saveFromWebhook({ callUuid: 'call-2', contactId: 'ct', recordingUrl: url('r-second'), recordingId: 'r-second' });
    assert.strictEqual(conv('first').recording_id, 'r-first', 'the earlier call keeps its own recording');
    assert.strictEqual(conv('second').recording_id, 'r-second');

    // A late callback of the first attempt must not replace the newer call's link on the contact.
    await RecordingService.saveFromWebhook({ callUuid: 'call-1', contactId: 'ct', recordingUrl: url('r-first'), recordingId: 'r-first' });
    assert.strictEqual(contact('ct').recording_id, 'r-second');
    assert.strictEqual(conv('second').recording_id, 'r-second');
});

await test('A callback with a link that is not a Plivo address is ignored', async () => {
    reset();
    addContact({ id: 'ct', provider_call_id: 'call-1' });
    addConversation({ id: 'c1', contact_id: 'ct', provider_call_id: 'call-1' });
    const res = new MockRes();
    await handlePlivoRecording({ query: { callUuid: 'call-1', contactId: 'ct' }, body: { RecordUrl: 'C:\\Users\\x\\.env', RecordingID: 'r1' } }, res);
    assert.strictEqual(res.statusCode, 200, 'Plivo is still answered OK');
    assert.ok(!conv('c1').recording_url && !conv('c1').recording_id);
    assert.ok(!contact('ct').recording_url);
});

await test('The callback handler (Plivo field names) saves and stamps the expiry', async () => {
    reset();
    addContact({ id: 'ct', provider_call_id: 'call-1', ended_at: null, started_at: null });
    addConversation({ id: 'c1', contact_id: 'ct', provider_call_id: 'call-1' });
    const res = new MockRes();
    const before = Date.now();
    await handlePlivoRecording({ query: { callUuid: 'call-1', contactId: 'ct' }, body: { RecordUrl: url('r1'), RecordingID: 'r1', RecordingDuration: '45' } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(contact('ct').recording_id, 'r1');
    // The conversation's end is known, so its stamp is that end + 30 days.
    const expected = Date.parse(conv('c1').ended_at) + 30 * DAY;
    assert.strictEqual(Date.parse(conv('c1').recording_expires_at), expected);
    // The contact has no end time yet: the callback arrives right after the call ends, so "now" is used.
    const stamp = Date.parse(contact('ct').recording_expires_at);
    assert.ok(stamp >= before + 30 * DAY && stamp <= Date.now() + 30 * DAY);
});

// ── Missed callbacks ────────────────────────────────────────────────────────
await test('A missing link is recovered from Plivo when the recording is opened', async () => {
    reset();
    addContact({ id: 'ct', provider_call_id: 'call-1' });
    addConversation({ id: 'c1', contact_id: 'ct', provider_call_id: 'call-1' });
    setRules(
        (r) => r.url.includes('/Recording/?call_uuid=call-1') ? Response.json({ objects: [{ recording_id: 'r1', recording_url: url('r1') }] }) : null,
        ...storageRules());
    const res = new MockRes();
    await RecordingService.serve({ headers: {} }, res, await RecordingService.findConversation('c1'));
    await res.done;
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(conv('c1').recording_url, url('r1'));
    assert.ok(conv('c1').recording_expires_at, 'the recovered link gets its expiry date too');
    assert.strictEqual(contact('ct').recording_id, 'r1');
});

await test('Plivo is not asked about calls that are past 30 days or already deleted', async () => {
    reset();
    addConversation({ id: 'old', provider_call_id: 'call-old', ended_at: iso(-40), started_at: iso(-40) });
    addConversation({ id: 'gone', provider_call_id: 'call-gone', recording_deleted_at: iso(-1) });
    setRules(() => Response.json({ objects: [{ recording_id: 'x', recording_url: url('x') }] }));
    for (const id of ['old', 'gone']) {
        await RecordingService.resolve(await RecordingService.findConversation(id));
    }
    assert.strictEqual(requests.length, 0);
});

await test('The recovery job finds links for calls that ended in the last hours, and no others', async () => {
    reset();
    addConversation({ id: 'recent', provider_call_id: 'call-recent', ended_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    addConversation({ id: 'too-new', provider_call_id: 'call-new', ended_at: new Date(Date.now() - 60 * 1000).toISOString() });
    addConversation({ id: 'too-old', provider_call_id: 'call-old', ended_at: iso(-3) });
    setRules((r) => r.url.includes('call_uuid=call-recent') ? Response.json({ objects: [{ recording_id: 'r1', recording_url: url('r1') }] }) : Response.json({ objects: [] }));
    const result = await RecordingService.reconcileMissing();
    assert.deepStrictEqual({ ...result }, { checked: 1, found: 1 });
    assert.strictEqual(conv('recent').recording_url, url('r1'));
    assert.ok(!conv('too-new').recording_url && !conv('too-old').recording_url);
});

// ── Daily deletion ──────────────────────────────────────────────────────────
await test('Cleanup permanently deletes expired recordings, keeps the transcript data, and retries failures', async () => {
    reset();
    addContact({ id: 'ct-old', provider_call_id: 'call-old', ended_at: iso(-40), recording_url: url('rec-old'), recording_id: 'rec-old' });
    addConversation({ id: 'old', contact_id: 'ct-old', provider_call_id: 'call-old', ended_at: iso(-40), started_at: iso(-40), recording_url: url('rec-old'), recording_id: 'rec-old', summary: undefined });
    addConversation({ id: 'stuck', provider_call_id: 'call-stuck', ended_at: iso(-35), started_at: iso(-35), recording_url: url('rec-stuck'), recording_id: 'rec-stuck', recording_expires_at: iso(-5) });
    addConversation({ id: 'fresh', provider_call_id: 'call-fresh', ended_at: iso(-2), started_at: iso(-2), recording_url: url('rec-fresh'), recording_id: 'rec-fresh' });
    // Provider: rec-old deletes fine, rec-stuck fails.
    let stuckStatus = 500;
    setRules((r) => {
        if (r.method !== 'DELETE') return null;
        if (r.url.includes('/Recording/rec-old/')) return new Response(null, { status: 204 });
        if (r.url.includes('/Recording/rec-stuck/')) return new Response('err', { status: stuckStatus });
        return null;
    });

    let result = await RecordingService.purgeExpired();
    assert.deepStrictEqual({ ...result }, { deleted: 1, failed: 1, skipped: false });
    assert.ok(sent('DELETE').every(r => !r.url.includes('rec-fresh')), 'a recording within 30 days must never be deleted');
    assert.ok(sent('DELETE').every(r => r.headers.Authorization.startsWith('Basic ')));

    // The deleted one: link gone everywhere, marked deleted, shown as expired. The conversation row itself stays.
    assert.ok(conv('old'), 'transcript, summary and screening result stay');
    assert.strictEqual(conv('old').recording_url, null);
    assert.strictEqual(conv('old').recording_id, null);
    assert.ok(conv('old').recording_deleted_at);
    assert.strictEqual(contact('ct-old').recording_url, null);
    assert.strictEqual(RecordingService.statusOf(conv('old')), 'expired');
    assert.ok(conv('old').recording_expires_at === null || Date.parse(conv('old').recording_expires_at) < Date.now(), 'the old call got its expiry stamp');

    // The failed one keeps its link for the retry, but can no longer be played.
    assert.strictEqual(conv('stuck').recording_url, url('rec-stuck'));
    const res = new MockRes();
    await RecordingService.serve({ headers: {} }, res, await RecordingService.findConversation('stuck'));
    assert.strictEqual(res.statusCode, 410);

    assert.strictEqual(conv('fresh').recording_url, url('rec-fresh'));
    assert.strictEqual(conv('fresh').recording_deleted_at, null);

    // Next day Plivo says the recording is already gone (404): that counts as deleted.
    stuckStatus = 404;
    result = await RecordingService.purgeExpired();
    assert.deepStrictEqual({ ...result }, { deleted: 1, failed: 0, skipped: false });
    assert.strictEqual(conv('stuck').recording_url, null);
    assert.ok(conv('stuck').recording_deleted_at);
});

await test('Cleanup removes only the audio: transcript, summary and screening result stay untouched', async () => {
    reset();
    addConversation({ id: 'old', ended_at: iso(-60), started_at: iso(-60), recording_url: url('rec-old'), recording_id: 'rec-old' });
    mem.prepare("UPDATE conversations SET summary = 'Candidate has 5 years of Node.', classification = 'SELECTED' WHERE id = 'old'").run();
    mem.prepare("INSERT INTO transcript_messages (conversation_id, speaker, text) VALUES ('old', 'REMO', 'Hello'), ('old', 'Candidate', 'Hi, yes')").run();
    setRules((r) => r.method === 'DELETE' ? new Response(null, { status: 204 }) : null);

    const result = await RecordingService.purgeExpired();
    assert.strictEqual(result.deleted, 1);
    assert.strictEqual(conv('old').summary, 'Candidate has 5 years of Node.');
    assert.strictEqual(conv('old').classification, 'SELECTED');
    assert.strictEqual(conv('old').contact_name, 'Asha Rao');
    assert.strictEqual(mem.prepare("SELECT COUNT(*) AS n FROM transcript_messages WHERE conversation_id = 'old'").get().n, 2);
    assert.strictEqual(conv('old').recording_url, null, 'only the recording is gone');
});

await test('Existing recordings without an expiry date get one from their call date, then expire on time', async () => {
    reset();
    addConversation({ id: 'legacy', provider_call_id: 'call-legacy', ended_at: iso(-45), started_at: iso(-45), recording_url: url('rec-legacy'), recording_id: 'rec-legacy' });
    addConversation({ id: 'recent', provider_call_id: 'call-recent', ended_at: iso(-3), started_at: iso(-3), recording_url: url('rec-recent'), recording_id: 'rec-recent' });
    setRules((r) => r.method === 'DELETE' ? new Response(null, { status: 204 }) : null);
    await RecordingService.backfillExpiry();
    assert.strictEqual(Date.parse(conv('recent').recording_expires_at), Date.parse(conv('recent').ended_at) + 30 * DAY);
    const result = await RecordingService.purgeExpired();
    assert.strictEqual(result.deleted, 1);
    assert.strictEqual(sent('DELETE').length, 1);
    assert.ok(sent('DELETE')[0].url.includes('/Recording/rec-legacy/'));
    assert.strictEqual(conv('recent').recording_url, url('rec-recent'));
});

await test('A recording saved without an id is still deleted (id taken from its link)', async () => {
    reset();
    addConversation({ id: 'c1', ended_at: iso(-40), started_at: iso(-40), recording_url: url('rec-from-url') });
    setRules((r) => r.method === 'DELETE' ? new Response(null, { status: 204 }) : null);
    const result = await RecordingService.purgeExpired();
    assert.strictEqual(result.deleted, 1);
    assert.ok(sent('DELETE')[0].url.includes('/Recording/rec-from-url/'));
});

await test('Cleanup does nothing, and clears nothing, when Plivo is not configured', async () => {
    reset();
    addConversation({ id: 'c1', ended_at: iso(-40), started_at: iso(-40), recording_url: url('r1'), recording_id: 'r1' });
    setRules(() => new Response(null, { status: 204 }));
    const saved = process.env.PLIVO_AUTH_ID;
    process.env.PLIVO_AUTH_ID = '';
    try {
        const result = await RecordingService.purgeExpired();
        assert.strictEqual(result.skipped, true);
    } finally {
        process.env.PLIVO_AUTH_ID = saved;
    }
    assert.strictEqual(requests.length, 0);
    assert.strictEqual(conv('c1').recording_url, url('r1'));
});

await test('The cleanup log holds counts only, no personal data', async () => {
    reset();
    addConversation({ id: 'c1', contact_name: 'Asha Rao', phone: '+919876543210', ended_at: iso(-40), started_at: iso(-40), recording_url: url('r1'), recording_id: 'r1' });
    setRules((r) => r.method === 'DELETE' ? new Response(null, { status: 204 }) : null);
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try { await RecordingService.purgeExpired(); } finally { console.log = original; }
    const text = lines.join('\n');
    assert.match(text, /Cleanup finished: 1 deleted, 0 failed/);
    assert.ok(!/Asha|98765|MATESTAUTH|rec/i.test(text.replace('Recordings', '')), `log leaked data: ${text}`);
});

// ── Starting the recording ──────────────────────────────────────────────────
await test('Starting the recording is retried until Plivo accepts it', async () => {
    let attempts = 0;
    setRules((r) => {
        if (r.method !== 'POST' || !r.url.includes('/Call/call-1/Record/')) return null;
        attempts++;
        return attempts < 3 ? Response.json({ error: 'call not found' }, { status: 404 }) : Response.json({ recording_id: 'r1', url: url('r1') }, { status: 202 });
    });
    const quiet = console.warn; console.warn = () => {};
    try {
        const result = await PlivoService.startCallRecordingWithRetry('call-1', { delaysMs: [0, 0], callbackUrl: 'https://test.example.com/cb' });
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.attempts, 3);
    } finally { console.warn = quiet; }
    assert.strictEqual(sent('POST').length, 3);
    assert.strictEqual(JSON.parse(sent('POST')[0].body).callback_url, 'https://test.example.com/cb');
});

await test('"Already recording" counts as success; giving up is reported; no credentials means no retry loop', async () => {
    const quietWarn = console.warn; const quietError = console.error;
    console.warn = () => {}; console.error = () => {};
    try {
        setRules(() => Response.json({ error: 'Call is already being recorded' }, { status: 400 }));
        let result = await PlivoService.startCallRecordingWithRetry('call-2', { delaysMs: [0, 0] });
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.attempts, 1);

        setRules(() => Response.json({ error: 'server error' }, { status: 500 }));
        result = await PlivoService.startCallRecordingWithRetry('call-3', { delaysMs: [0, 0] });
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.attempts, 3);
        assert.strictEqual(sent('POST').length, 3);

        const saved = process.env.PLIVO_AUTH_TOKEN;
        process.env.PLIVO_AUTH_TOKEN = '';
        try {
            setRules(() => Response.json({}, { status: 202 }));
            result = await PlivoService.startCallRecordingWithRetry('call-4', { delaysMs: [0, 0] });
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.attempts, 1);
            assert.strictEqual(requests.length, 0);
        } finally { process.env.PLIVO_AUTH_TOKEN = saved; }
    } finally { console.warn = quietWarn; console.error = quietError; }
});

// ── Pages ───────────────────────────────────────────────────────────────────
await test('The privacy page states the 30-day recording retention', () => {
    const html = fs.readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');
    assert.match(html, /deleted\s+30 days after the call ends/);
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
