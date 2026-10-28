/**
 * tests/admin_data_scoping.test.js
 *
 * An admin sees only the conversations they own (directly or through their contact sheet). Rows without
 * an owner are visible to no admin until services/unowned_assign.js gives them to one admin; it leaves
 * other admins' rows alone and a dry run changes nothing.
 *
 * Runs on an in-memory SQLite database with db.get/all/run pointed at it, so it never touches the real
 * database. Needs Node 22+ (node:sqlite) or better-sqlite3; otherwise it skips.
 */
process.env.DB_ENGINE = 'sqlite';
process.env.SKIP_TTS_PRECACHE = '1';

import assert from 'assert';

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
    CREATE TABLE campaigns (id TEXT PRIMARY KEY, owner_user_id TEXT);
    CREATE TABLE contacts (id TEXT PRIMARY KEY, batch_id TEXT, owner_user_id TEXT, extracted_data TEXT, notes TEXT);
    CREATE TABLE conversations (id TEXT PRIMARY KEY, contact_id TEXT, owner_user_id TEXT, created_at TEXT,
        duration_seconds INTEGER DEFAULT 0);
`);

const { default: db } = await import('../services/db.js');
db.get = async (sql, params = []) => mem.prepare(sql).get(...params) ?? null;
db.all = async (sql, params = []) => mem.prepare(sql).all(...params);
db.run = async (sql, params = []) => mem.prepare(sql).run(...params);

const { default: ConversationService } = await import('../services/conversation_service.js');
const { assignUnownedRows } = await import('../services/unowned_assign.js');

let total = 0;
let failed = 0;
async function test(name, fn) {
    total++;
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

function seed() {
    mem.exec('DELETE FROM batches; DELETE FROM campaigns; DELETE FROM contacts; DELETE FROM conversations;');
    mem.exec(`
        INSERT INTO batches VALUES ('b-mine', 'adminA'), ('b-theirs', 'adminB'), ('b-old', NULL);
        INSERT INTO campaigns VALUES ('c-mine', 'adminA'), ('c-theirs', 'adminB'), ('c-old', NULL);
        INSERT INTO contacts (id, batch_id, owner_user_id) VALUES ('ct-mine', 'b-mine', NULL),
            ('ct-theirs', 'b-theirs', NULL), ('ct-old', 'b-old', NULL), ('ct-direct', NULL, NULL);
        INSERT INTO conversations (id, contact_id, owner_user_id, created_at) VALUES
            ('v-mine', 'ct-mine', NULL, '2026-01-01'), ('v-theirs', 'ct-theirs', NULL, '2026-01-02'),
            ('v-old', 'ct-old', NULL, '2026-01-03'), ('v-direct', 'ct-direct', NULL, '2026-01-04');
    `);
}

const ownerOf = (table, id) => mem.prepare(`SELECT owner_user_id AS o FROM ${table} WHERE id = ?`).get(id).o;

await test('An admin sees only conversations from their own sheet, not other admins\' or unowned ones', async () => {
    seed();
    const list = await ConversationService.getConversations('', '', '', '', '', 1, 50, 'adminA');
    const ids = (list.conversations || list.items || list.data || list).map(c => c.id);
    assert.ok(ids.includes('v-mine'), 'own conversation is listed');
    for (const id of ['v-theirs', 'v-old', 'v-direct']) assert.ok(!ids.includes(id), `${id} must not be listed`);
    assert.strictEqual(await ConversationService.getConversationById('v-old', 'adminA'), null);
    assert.strictEqual(await ConversationService.getConversationById('v-theirs', 'adminA'), null);
});

await test('A dry run counts the unowned rows and changes nothing', async () => {
    seed();
    const counts = await assignUnownedRows('adminReach', { apply: false });
    assert.deepStrictEqual(counts, { conversations: 2, contacts: 2, batches: 1, campaigns: 1 });
    assert.strictEqual(ownerOf('campaigns', 'c-old'), null);
});

await test('Assigning gives unowned rows to one admin and leaves other admins\' rows alone', async () => {
    seed();
    await assignUnownedRows('adminReach', { apply: true });
    assert.strictEqual(ownerOf('campaigns', 'c-old'), 'adminReach');
    assert.strictEqual(ownerOf('batches', 'b-old'), 'adminReach');
    assert.strictEqual(ownerOf('conversations', 'v-old'), 'adminReach');
    assert.strictEqual(ownerOf('conversations', 'v-direct'), 'adminReach');
    assert.strictEqual(ownerOf('campaigns', 'c-theirs'), 'adminB');
    assert.strictEqual(ownerOf('batches', 'b-theirs'), 'adminB');
    assert.strictEqual(ownerOf('conversations', 'v-theirs'), null, 'a row reached through another admin\'s sheet is not taken');
    assert.strictEqual(ownerOf('conversations', 'v-mine'), null, 'a row reached through its own sheet is not double-owned');

    const reach = await ConversationService.getConversations('', '', '', '', '', 1, 50, 'adminReach');
    const ids = (reach.conversations || reach.items || reach.data || reach).map(c => c.id);
    assert.ok(ids.includes('v-old') && ids.includes('v-direct'), 'the receiving admin now sees them');
    assert.ok(!ids.includes('v-mine') && !ids.includes('v-theirs'), 'and nobody else\'s');
});

await test('Running the assignment twice changes nothing the second time', async () => {
    seed();
    await assignUnownedRows('adminReach', { apply: true });
    const again = await assignUnownedRows('adminOther', { apply: true });
    assert.deepStrictEqual(again, { conversations: 0, contacts: 0, batches: 0, campaigns: 0 });
    assert.strictEqual(ownerOf('campaigns', 'c-old'), 'adminReach');
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
