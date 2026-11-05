/**
 * Accounts, proposals and demo requests live in the database, not in data/*.json.
 * Uses a fake in-memory database: nothing here touches MySQL, SQLite or the data/ folder.
 *
 * Run: node tests/accounts_in_database.test.js
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setBackend, initCollections, flushWrites, defineCollection, failedWriteCount, refreshCollections } from '../services/doc_collections.js';

// A fake database: table name -> Map(id -> doc text). It survives "restarts" like a real database does.
const tables = new Map();
let failNextUpsert = false;
const fake = {
    async ensure(t) { if (!tables.has(t)) tables.set(t, new Map()); },
    async loadAll(t) {
        if (!tables.has(t)) throw new Error('no such table');
        return [...tables.get(t)].map(([id, doc]) => ({ id, doc }));
    },
    async upsert(t, id, doc) {
        if (failNextUpsert) { failNextUpsert = false; throw new Error('database down'); }
        tables.get(t).set(id, doc);
    },
    async remove(t, id) { tables.get(t).delete(id); }
};
setBackend(fake);

const users = await import('../users_store.js');
const proposals = await import('../proposals_store.js');
const demos = await import('../demo_store.js');

// Reading before the lists are loaded is a clear error, not an empty list.
assert.throws(() => users.readUsers(), /not loaded yet/);

await initCollections();
assert.deepStrictEqual(users.readUsers(), []);

// Create, change, find.
const a = users.createUser('Asha', 'Asha@Example.com', 'hash-a');
users.createUser('Bala', 'bala@example.com', 'hash-b');
assert.strictEqual(users.findUserByEmail('asha@example.com').id, a.id);
assert.throws(() => users.createUser('Asha 2', 'ASHA@example.com', 'x'), /already exists/);
users.updateUserProfile(a.id, { companyName: 'Acme' });
users.adminUpdateUser(a.id, { role: 'admin' }, null);
await flushWrites();

// "Restart": drop the memory copy and load again from the database. Everything is still there.
await initCollections();
assert.strictEqual(users.readUsers().length, 2);
assert.strictEqual(users.findUserById(a.id).companyName, 'Acme');
assert.strictEqual(users.findUserById(a.id).role, 'admin');
assert.strictEqual(users.findUserById(a.id).passwordHash, 'hash-a');

// A read is a copy: changing it does not change the stored list until write() is called.
const copy = users.readUsers();
copy[0].name = 'Changed in memory only';
assert.notStrictEqual(users.readUsers()[0].name, 'Changed in memory only');

// Deleting an account removes only that one row.
users.deleteUser(a.id);
await flushWrites();
assert.strictEqual(tables.get('app_users').size, 1);
assert.strictEqual(users.findUserByEmail('bala@example.com').name, 'Bala');

// Proposals and demo requests use the same store.
proposals.writeProposals([{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: 'u2' }]);
demos.addDemoRequest({ id: 'd1', email: 'x@example.com' });
await flushWrites();
await initCollections();
assert.strictEqual(proposals.readProposals().length, 2);
assert.strictEqual(demos.readDemoRequests()[0].id, 'd1');
proposals.writeProposals(proposals.readProposals().filter((p) => p.id !== 'p1'));
await flushWrites();
assert.deepStrictEqual([...tables.get('app_proposals').keys()], ['p2']);

// Import from the old JSON files: keeps existing rows untouched, matches accounts by email, keeps ids.
const usersCollection = defineCollection('users', 'app_users');
const before = tables.get('app_users').get(users.readUsers()[0].id);
const oldFile = [
    { id: 'usr_old1', name: 'Chitra', email: 'chitra@example.com', passwordHash: 'h1' },
    { id: 'usr_old2', name: 'Bala (older copy)', email: 'BALA@example.com', passwordHash: 'older' }, // same email as existing
    { id: 'usr_old3', name: 'Dev', email: 'dev@example.com', passwordHash: 'h3' },
    { name: 'No id', email: 'noid@example.com' }
];
const dry = await usersCollection.importMissing(oldFile, { matchKey: (r) => r.email, apply: false });
assert.deepStrictEqual(dry, { total: 4, alreadyThere: 1, toAdd: 2, skippedNoId: 1 });
assert.strictEqual(tables.get('app_users').size, 1, 'a dry run adds nothing');
await usersCollection.importMissing(oldFile, { matchKey: (r) => r.email, apply: true });
await flushWrites();
assert.strictEqual(tables.get('app_users').size, 3);
assert.strictEqual(users.findUserById('usr_old1').name, 'Chitra', 'the id from the file is kept');
assert.strictEqual(users.findUserByEmail('bala@example.com').passwordHash, 'hash-b', 'an existing account is not overwritten');
assert.strictEqual(tables.get('app_users').get(users.readUsers()[0].id), before);
// Running the import again adds nothing.
const again = await usersCollection.importMissing(oldFile, { matchKey: (r) => r.email, apply: true });
assert.strictEqual(again.toAdd, 0);

// A database failure is counted and logged, and later writes still go through.
const quiet = console.error; console.error = () => {};
failNextUpsert = true;
users.createUser('Eve', 'eve@example.com', 'h');
await flushWrites();
console.error = quiet;
assert.strictEqual(failedWriteCount(), 1);
users.createUser('Fay', 'fay@example.com', 'h');
await flushWrites();
assert.ok([...tables.get('app_users').values()].some((d) => d.includes('fay@example.com')));
assert.ok([...tables.get('app_users').values()].some((d) => d.includes('eve@example.com')), 'the refused record is sent again on the next write');

// Refresh: an account created by someone else (the other side of the shared database) shows up without a restart.
tables.get('app_users').set('usr_elsewhere', JSON.stringify({ id: 'usr_elsewhere', name: 'Gita', email: 'gita@example.com', passwordHash: 'h' }));
assert.strictEqual(users.findUserByEmail('gita@example.com'), null, 'not visible before a refresh');
await refreshCollections();
assert.strictEqual(users.findUserByEmail('gita@example.com').id, 'usr_elsewhere');
// ...and an account deleted by someone else disappears.
tables.get('app_users').delete('usr_elsewhere');
await refreshCollections();
assert.strictEqual(users.findUserByEmail('gita@example.com'), null);

// A refresh never undoes a local change that is still being saved.
const slow = fake.upsert;
let release;
fake.upsert = (t, id, doc) => new Promise((resolve) => { release = () => { tables.get(t).set(id, doc); resolve(); }; });
users.createUser('Hari', 'hari@example.com', 'h');
await refreshCollections(); // skipped: the save has not reached the database yet
assert.ok(users.findUserByEmail('hari@example.com'), 'unsaved change survives a refresh');
await new Promise((r) => setImmediate(r));
release();
fake.upsert = slow;
await flushWrites();
await refreshCollections();
assert.ok(users.findUserByEmail('hari@example.com'), 'and is still there once saved');

// A record the database refused to save also survives a refresh, and is sent with the next write.
const quiet2 = console.error; console.error = () => {};
failNextUpsert = true;
users.createUser('Ila', 'ila@example.com', 'h');
await flushWrites();
console.error = quiet2;
await refreshCollections();
assert.ok(users.findUserByEmail('ila@example.com'), 'a record that failed to save is not lost by a refresh');
users.createUser('Jai', 'jai@example.com', 'h');
await flushWrites();
assert.ok([...tables.get('app_users').values()].some((d) => d.includes('ila@example.com')), 'sent with the next write');

// The server starts the 30-second refresh.
const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf-8');
assert.ok(/startRefresh\(30000\)/.test(serverSource), 'server.js must start the refresh');
// Hosting panels that load the start file in their own way fail (503) on a top-level await.
assert.ok(!/^\s*(try\s*\{\s*)?await\s/m.test(serverSource.replace(/\/\/.*$/gm, '')), 'server.js must not use a top-level await');

// The stores no longer read or write the JSON files.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['users_store.js', 'proposals_store.js', 'demo_store.js']) {
    assert.ok(!/\.json['"]/.test(fs.readFileSync(path.join(root, f), 'utf-8')), `${f} must not use a .json data file`);
}

console.log('accounts_in_database: all checks passed');
