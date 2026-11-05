/**
 * tests/campaign_list_live_counts.test.js
 *
 * The "Saved Voice Campaigns" cards always showed 0 In-Progress and 0 Failed. The list read the numbers stored on
 * the campaigns table, which nothing keeps up to date; only opening one campaign counted its contacts.
 * listCampaigns now counts the contacts for every campaign (one query), the same way getCampaign does.
 *
 * Run:  node tests/campaign_list_live_counts.test.js
 * It uses the local SQLite database and removes every row it creates.
 */
process.env.SKIP_TTS_PRECACHE = '1';

import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';

const { default: db, ensureCampaignSchema } = await import('../services/db.js');
const { CampaignService } = await import('../services/campaign_service.js');

let total = 0;
let passed = 0;
async function test(name, fn) {
    total++;
    try { await fn(); passed++; console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); }
}

const OWNER = 'owner_listcounts_test';
const now = new Date().toISOString();
const camp = (id, batchId, stored = {}) => db.run(
    `INSERT INTO campaigns (id, name, service, status, batch_id, owner_user_id, valid_contacts, completed_calls, failed_calls, inprogress_calls, created_at, updated_at)
     VALUES (?, ?, 'recruitment', 'READY', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, id, batchId, OWNER, stored.valid || 0, stored.completed || 0, stored.failed || 0, stored.inprogress || 0, now, now]);
let n = 0;
const contact = (campaignId, batchId, callStatus, { validation = 'VALID', classification = null } = {}) => db.run(
    `INSERT INTO contacts (id, batch_id, service, row_index, raw_data, name, phone, validation_status, call_status, classification, updated_at, campaign_id)
     VALUES (?, ?, 'recruitment', ?, '{}', 'T', ?, ?, ?, ?, ?, ?)`,
    [`cnt_lc_${++n}`, batchId, n, `9199000${String(n).padStart(5, '0')}`, validation, callStatus, classification, now, campaignId]);

async function cleanup() {
    await db.run("DELETE FROM contacts WHERE id LIKE 'cnt_lc_%'");
    await db.run('DELETE FROM campaigns WHERE owner_user_id = ?', [OWNER]);
    await db.run("DELETE FROM batches WHERE id LIKE 'b_lc_%'");
}

await ensureCampaignSchema();
await cleanup();

// A: contacts carry the campaign id and its batch id (counted once, not twice)
await camp('c_lc_a', 'b_lc_a');
await contact('c_lc_a', 'b_lc_a', 'COMPLETED', { classification: 'Selected' });
await contact('c_lc_a', 'b_lc_a', 'COMPLETED', { classification: 'Rejected' });
await contact('c_lc_a', 'b_lc_a', 'CALLING');
await contact('c_lc_a', 'b_lc_a', 'in-progress');
await contact('c_lc_a', 'b_lc_a', 'FAILED');
await contact('c_lc_a', 'b_lc_a', 'UNANSWERED');
await contact('c_lc_a', 'b_lc_a', 'PENDING');
await contact('c_lc_a', 'b_lc_a', 'PENDING', { validation: 'INVALID' });
// B: contacts have only the batch id (the campaign is found through its batch)
await camp('c_lc_b', 'b_lc_b', { completed: 99, failed: 99 });
await contact(null, 'b_lc_b', 'COMPLETED', { classification: 'On Hold' });
await contact(null, 'b_lc_b', 'FAILED');
// C: no contacts at all, its stored numbers stay
await camp('c_lc_c', 'b_lc_c', { valid: 5, completed: 3, failed: 2, inprogress: 1 });
// Another campaign's contacts must not leak in
await camp('c_lc_d', 'b_lc_d');
await contact('c_lc_d', 'b_lc_d', 'FAILED');

const list = async () => Object.fromEntries((await CampaignService.listCampaigns(OWNER)).map((c) => [c.id, c]));

await test('In-progress and failed are counted from the contacts', async () => {
    const a = (await list()).c_lc_a;
    assert.strictEqual(a.inprogress_calls, 2, 'CALLING and in-progress');
    assert.strictEqual(a.failed_calls, 2, 'FAILED and UNANSWERED');
    assert.strictEqual(a.completed_calls, 2);
});

await test('Contacts, pending, invalid and the outcome counts are live too, and nothing is counted twice', async () => {
    const a = (await list()).c_lc_a;
    assert.strictEqual(a.total_contacts, 8);
    assert.strictEqual(a.valid_contacts, 7);
    assert.strictEqual(a.invalid_contacts, 1);
    assert.strictEqual(a.pending_calls, 1);
    assert.strictEqual(a.selected_count, 1);
    assert.strictEqual(a.rejected_count, 1);
});

await test('A campaign whose contacts only carry the batch id is counted, and the stale stored numbers are replaced', async () => {
    const b = (await list()).c_lc_b;
    assert.strictEqual(b.completed_calls, 1, 'not the stored 99');
    assert.strictEqual(b.failed_calls, 1, 'not the stored 99');
    assert.strictEqual(b.on_hold_count, 1);
});

await test('A campaign with no contacts keeps its stored numbers', async () => {
    const c = (await list()).c_lc_c;
    assert.strictEqual(c.valid_contacts, 5);
    assert.strictEqual(c.completed_calls, 3);
    assert.strictEqual(c.failed_calls, 2);
    assert.strictEqual(c.inprogress_calls, 1);
});

await test('Another campaign\'s contacts do not leak in', async () => {
    const d = (await list()).c_lc_d;
    assert.strictEqual(d.failed_calls, 1);
    assert.strictEqual(d.completed_calls, 0);
    assert.strictEqual(d.total_contacts, 1);
});

await test('The list and the single-campaign view show the same numbers', async () => {
    const all = await list();
    const keys = ['total_contacts', 'valid_contacts', 'invalid_contacts', 'pending_calls', 'inprogress_calls', 'completed_calls', 'failed_calls', 'selected_count', 'rejected_count', 'on_hold_count'];
    for (const id of Object.keys(all)) {
        const one = await CampaignService.getCampaign(id, OWNER);
        for (const k of keys) assert.strictEqual(all[id][k], one[k], `${id}.${k}`);
    }
});

await test('An empty list is fine', async () => {
    assert.deepStrictEqual(await CampaignService.listCampaigns('owner_with_no_campaigns_xyz'), []);
});

await cleanup();
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
