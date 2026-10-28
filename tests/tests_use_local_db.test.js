/**
 * tests/tests_use_local_db.test.js
 *
 * Tests must never touch the live MySQL database. Every test that loads the database code has to import
 * './_local_db_only.js' FIRST (before any other import), because tests that only set USE_LOCAL_DB in their
 * body connect to the live database while their imports load.
 *
 * This reads the test files only; it opens no connection. It fails when a test that can reach the database
 * is missing the guard, or the guard is not the first import.
 */
import './_local_db_only.js';
import assert from 'assert';
import fs from 'fs';

const dir = new URL('./', import.meta.url);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js') && f !== 'tests_use_local_db.test.js');

// A test is considered "database-reaching" when it imports anything that opens the database at load time.
// Tests that use only an in-memory database (dynamic imports after the env is set) are listed here on purpose.
const IN_MEMORY_ONLY = new Set(['admin_data_scoping.test.js', 'call_recordings.test.js', 'instant_call_login.test.js']);
const REACHES_DB = /services\/(db|agent_service|campaign_service|call_queue_worker|voicebot_stream_service|excel_service|appointment_service|receptionist_service|sales_service|recruitment_service|support_service|plivo_service|conversation_service|call_service|admin_service|recording_service)\.js|routes\/(admin|demo|owner)[a-z_]*\.js/;

let total = 0;
let failed = 0;
function test(name, fn) {
    total++;
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

test('The guard sets the local database before anything else loads', () => {
    assert.strictEqual(process.env.DB_ENGINE, 'sqlite');
    assert.strictEqual(process.env.USE_LOCAL_DB, 'true');
});

test('Every database-reaching test imports the guard first', () => {
    const bad = [];
    for (const f of files) {
        if (IN_MEMORY_ONLY.has(f)) continue;
        const text = fs.readFileSync(new URL(f, dir), 'utf8');
        if (!REACHES_DB.test(text)) continue;
        const firstImport = text.split('\n').find((l) => /^import\s/.test(l)) || '';
        if (!firstImport.includes("'./_local_db_only.js'")) bad.push(`${f} (first import: ${firstImport.trim().slice(0, 60)})`);
    }
    assert.deepStrictEqual(bad, [], `these tests can reach the live database: ${bad.join('; ')}`);
});

test('The agent test cleans up with a case-sensitive match', () => {
    const text = fs.readFileSync(new URL('multi_agent.test.js', dir), 'utf8');
    assert.ok(!/name LIKE 'TEST/.test(text), "must not use a case-insensitive LIKE on agent names (it deleted a real 'Test Booking' agent)");
    assert.ok(text.includes("name GLOB 'TEST *'"));
});

console.log(`\n${total - failed}/${total} passed`);
process.exitCode = failed ? 1 : 0;
