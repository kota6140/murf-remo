/**
 * tests/conversations_pager.test.js
 *
 * The dashboard's Conversations table lets the admin choose how many rows to see per page (10, 25, 50, 100) and
 * shows "Showing 10 rows (667 total) · Page 1 of 67". The server already pages with ?page and ?limit; the page now
 * sends the chosen limit, remembers it, and starts again at page 1 when it changes.
 *
 * Runs on an in-memory SQLite database with db.get/all/run pointed at it, so it never touches the real database.
 * Needs Node 22+ (node:sqlite) or better-sqlite3; otherwise the server part skips.
 */
process.env.DB_ENGINE = 'sqlite';
process.env.SKIP_TTS_PRECACHE = '1';

import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';
import fs from 'fs';
import vm from 'vm';

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

let total = 0;
let failed = 0;
let skipped = 0;
async function test(name, fn) {
    total++;
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) {
        if (e && e.skip) { skipped++; console.log(`  skip ${name}`); return; }
        failed++; console.log(`  FAIL ${name}\n       ${e.message}`);
    }
}

const html = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');

// ---- server: paging with a real set of 67 conversations (adminA) and 5 more that belong to someone else ----
const mem = await openMemoryDb();
let ConversationService = null;
if (mem) {
    mem.exec(`
        CREATE TABLE batches (id TEXT PRIMARY KEY, owner_user_id TEXT);
        CREATE TABLE contacts (id TEXT PRIMARY KEY, batch_id TEXT, owner_user_id TEXT, extracted_data TEXT, notes TEXT);
        CREATE TABLE conversations (id TEXT PRIMARY KEY, contact_id TEXT, owner_user_id TEXT, service TEXT, contact_name TEXT,
            phone TEXT, status TEXT, started_at TEXT, created_at TEXT, duration_seconds INTEGER DEFAULT 0, summary TEXT,
            classification TEXT, sentiment TEXT);
    `);
    const add = mem.prepare(`INSERT INTO conversations (id, contact_id, owner_user_id, service, contact_name, phone, status, started_at, created_at, duration_seconds)
        VALUES (?, ?, ?, 'sales', ?, ?, 'completed', ?, ?, 60)`);
    for (let i = 1; i <= 67; i++) {
        const stamp = `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T10:${String(i % 60).padStart(2, '0')}:00.${String(i).padStart(3, '0')}Z`;
        add.run(`conv-a-${String(i).padStart(3, '0')}`, null, 'adminA', `Person ${i}`, `+91900000${String(i).padStart(4, '0')}`, stamp, stamp);
    }
    for (let i = 1; i <= 5; i++) add.run(`conv-b-${i}`, null, 'adminB', `Other ${i}`, `+9180000000${i}`, '2026-10-30T10:00:00Z', '2026-10-30T10:00:00Z');

    const { default: db } = await import('../services/db.js');
    db.get = async (sql, params = []) => mem.prepare(sql).get(...params) ?? null;
    db.all = async (sql, params = []) => mem.prepare(sql).all(...params);
    db.run = async (sql, params = []) => mem.prepare(sql).run(...params);
    ({ default: ConversationService } = await import('../services/conversation_service.js'));
}
const get = (limit, page = 1, owner = 'adminA') => ConversationService.getConversations('', '', '', '', '', page, limit, owner);
const needDb = () => { if (!ConversationService) { const e = new Error('no in-memory database'); e.skip = true; throw e; } };

await test('10 rows per page: 67 conversations make 7 pages, and the last page has 7 rows', async () => {
    needDb();
    const first = await get(10);
    assert.strictEqual(first.data.length, 10);
    assert.strictEqual(first.pagination.totalCount, 67);
    assert.strictEqual(first.pagination.totalPages, 7);
    assert.strictEqual((await get(10, 7)).data.length, 7);
});

await test('25, 50 and 100 rows per page give 3, 2 and 1 pages', async () => {
    needDb();
    for (const [limit, pages, lastRows] of [[25, 3, 17], [50, 2, 17], [100, 1, 67]]) {
        const p1 = await get(limit);
        assert.strictEqual(p1.pagination.limit, limit);
        assert.strictEqual(p1.pagination.totalCount, 67, 'the total does not depend on the page size');
        assert.strictEqual(p1.pagination.totalPages, pages);
        assert.strictEqual((await get(limit, pages)).data.length, lastRows);
    }
});

await test('Going through every page shows each conversation exactly once, newest first, whatever the page size', async () => {
    needDb();
    for (const limit of [10, 25, 50, 100]) {
        const ids = [];
        const pages = (await get(limit)).pagination.totalPages;
        for (let p = 1; p <= pages; p++) ids.push(...(await get(limit, p)).data.map((c) => c.id));
        assert.strictEqual(ids.length, 67, `limit ${limit}`);
        assert.strictEqual(new Set(ids).size, 67, `limit ${limit}: no row repeats`);
        const sameOrder = (await get(100)).data.map((c) => c.id);
        assert.deepStrictEqual(ids, sameOrder, `limit ${limit}: same order as one big page`);
    }
});

await test('The page size is limited to 1..100 and falls back to 10 when it is not a number', async () => {
    needDb();
    assert.strictEqual((await get(500)).pagination.limit, 100);
    assert.strictEqual((await get(0)).pagination.limit, 10);
    assert.strictEqual((await get('abc')).pagination.limit, 10);
    assert.strictEqual((await get(25)).pagination.limit, 25);
});

await test('An admin only gets their own conversations in the total, not another admin\'s', async () => {
    needDb();
    assert.strictEqual((await get(10, 1, 'adminB')).pagination.totalCount, 5);
    assert.strictEqual((await get(10, 1, 'adminA')).pagination.totalCount, 67);
});

// ---- dashboard page ----
await test('The Rows per page dropdown offers 10, 25, 50 and 100 and starts at 10', () => {
    const sel = (html.match(/<select[^>]*id="convs-limit-select"[^>]*>([\s\S]*?)<\/select>/) || [])[1];
    assert.ok(sel, 'dropdown not found');
    const values = [...sel.matchAll(/<option value="(\d+)"/g)].map((m) => Number(m[1]));
    assert.deepStrictEqual(values, [10, 25, 50, 100]);
    assert.ok(/<option value="10" selected>/.test(sel));
    assert.ok(/<label class="rows-per-page" for="convs-limit-select">/.test(html));
    assert.ok(css.includes('.rows-per-page') && css.includes('.admin-select-sm'));
});

await test('The page sends the chosen limit, remembers it, and goes back to page 1 when it changes', () => {
    assert.ok(html.includes('page: currentConvsPage, limit: convsLimit'));
    assert.ok(html.includes('const CONVS_LIMIT_CHOICES = [10, 25, 50, 100];'));
    assert.ok(html.includes("window.localStorage.setItem('convs-rows-per-page', String(convsLimit))"));
    assert.ok(html.includes("window.localStorage.getItem('convs-rows-per-page')"));
    const handler = html.slice(html.indexOf("convsLimitSelect.addEventListener('change'"), html.indexOf('const convsPrevBtn'));
    assert.ok(handler.includes('loadConversations(1)'), 'changing the size starts again at page 1');
    assert.ok(handler.includes('CONVS_LIMIT_CHOICES.includes(chosen) ? chosen : 10'), 'an unknown value falls back to 10');
});

// Run the page's own pager function against a fake page, so the real text is checked
function runPager({ pagination, shown, page }) {
    const start = html.indexOf('function updateConvsPager(');
    const end = html.indexOf('async function loadConversations');
    assert.ok(start > 0 && end > start, 'updateConvsPager not found');
    const info = { textContent: '' };
    const prev = { disabled: null };
    const next = { disabled: null };
    const ctx = {
        currentConvsPage: page, totalConvsPages: 1, pagination, shown,
        document: { getElementById: (id) => ({ 'convs-page-info': info, 'convs-prev-btn': prev, 'convs-next-btn': next }[id] || null) }
    };
    vm.createContext(ctx);
    vm.runInContext(`${html.slice(start, end)}\nupdateConvsPager(pagination, shown);`, ctx);
    return { text: info.textContent, prev: prev.disabled, next: next.disabled };
}

await test('The pager text reads "Showing 10 rows (667 total) · Page 1 of 67"', () => {
    const r = runPager({ pagination: { totalCount: 667, totalPages: 67 }, shown: 10, page: 1 });
    assert.strictEqual(r.text, 'Showing 10 rows (667 total) · Page 1 of 67');
    assert.strictEqual(r.prev, true);
    assert.strictEqual(r.next, false);
});

await test('A last page with fewer rows, a single row, an empty list and a bigger page size read correctly', () => {
    assert.strictEqual(runPager({ pagination: { totalCount: 667, totalPages: 67 }, shown: 7, page: 67 }).text,
        'Showing 7 rows (667 total) · Page 67 of 67');
    assert.strictEqual(runPager({ pagination: { totalCount: 51, totalPages: 2 }, shown: 1, page: 2 }).text,
        'Showing 1 row (51 total) · Page 2 of 2');
    assert.strictEqual(runPager({ pagination: { totalCount: 0, totalPages: 1 }, shown: 0, page: 1 }).text, 'No conversations');
    const big = runPager({ pagination: { totalCount: 667, totalPages: 7 }, shown: 100, page: 3 });
    assert.strictEqual(big.text, 'Showing 100 rows (667 total) · Page 3 of 7');
    assert.strictEqual(big.prev, false);
    assert.strictEqual(big.next, false);
});

console.log(`\n${total - failed - skipped}/${total} passed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
