/**
 * tests/queue_panel_counts.test.js
 *
 * The dashboard's "Sequential Outbound Calling Worker" panel shows Queued, In-Progress, Completed and Failed.
 * Completed and Failed used to be missing from the data sent to it, so the panel stayed at 0. They now come
 * from the same totals as the dashboard metric cards, and the call being made shows its phone number.
 * Pure function test; opens no database.
 */
process.env.SKIP_TTS_PRECACHE = '1';

import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';
import fs from 'fs';
import AdminService from '../services/admin_service.js';

let total = 0;
let failed = 0;
function test(name, fn) {
    total++;
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const stats = { completedCalls: 42, failedCalls: 7, queue: { queueLength: 506, active: true, isPaused: false } };

test('Completed and failed counts reach the panel', () => {
    const p = AdminService.buildQueuePanel(stats, null);
    assert.strictEqual(p.completedCount, 42);
    assert.strictEqual(p.failedCount, 7);
    assert.strictEqual(p.queuedCount, 506);
    assert.strictEqual(p.inProgressCount, 0);
    assert.strictEqual(p.isRunning, true);
    assert.strictEqual(p.activeCall, null);
});

test('The call being made is counted and shows its phone number, name and service', () => {
    const p = AdminService.buildQueuePanel(stats, { name: 'Asha', phone: '+910000000000', service: 'sales' });
    assert.strictEqual(p.inProgressCount, 1);
    assert.strictEqual(p.activeCall.phone_number, '+910000000000');
    assert.strictEqual(p.activeCall.contact_name, 'Asha');
    assert.strictEqual(p.activeCall.service, 'sales');
});

test('Missing totals are 0, never undefined or NaN', () => {
    const p = AdminService.buildQueuePanel({}, null);
    assert.strictEqual(p.completedCount, 0);
    assert.strictEqual(p.failedCount, 0);
    assert.strictEqual(p.queuedCount, 0);
    const p2 = AdminService.buildQueuePanel({ completedCalls: null, failedCalls: undefined }, null);
    assert.strictEqual(p2.completedCount, 0);
    assert.strictEqual(p2.failedCount, 0);
});

test('The dashboard route builds the panel with buildQueuePanel', () => {
    const src = fs.readFileSync(new URL('../routes/admin.js', import.meta.url), 'utf8');
    assert.ok(src.includes('stats.queue = AdminService.buildQueuePanel(stats, active);'));
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
