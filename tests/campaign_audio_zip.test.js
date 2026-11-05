/**
 * tests/campaign_audio_zip.test.js
 *
 * Campaign conversations popup: "Download Audio" gives the ticked calls' recordings in one .zip whose files are
 * named name_date_phone.mp3, and the popup pages through the calls (10/25/50/100 per page).
 *
 * Plain Node, no database and no phone provider: the audio fetch is replaced by a fake.
 *
 * Run: node tests/campaign_audio_zip.test.js
 */
import './_local_db_only.js';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipWriter, crc32 } from '../services/zip_writer.js';
import RecordingService from '../services/recording_service.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf-8');

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// A small zip reader, so the test checks the bytes a real unzip tool would read.
function readZip(buf) {
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(eocd >= 0, 'end of central directory not found');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const files = {};
    for (let i = 0; i < count; i++) {
        assert.strictEqual(buf.readUInt32LE(p), 0x02014b50, 'central directory entry');
        const crc = buf.readUInt32LE(p + 16);
        const size = buf.readUInt32LE(p + 24);
        const nameLen = buf.readUInt16LE(p + 28);
        const offset = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        assert.strictEqual(buf.readUInt32LE(offset), 0x04034b50, 'local header');
        const localNameLen = buf.readUInt16LE(offset + 26);
        const dataStart = offset + 30 + localNameLen + buf.readUInt16LE(offset + 28);
        const data = buf.subarray(dataStart, dataStart + size);
        assert.strictEqual(crc32(data), crc, `CRC of ${name}`);
        files[name] = data;
        p += 46 + nameLen;
    }
    return files;
}

const collect = () => {
    const chunks = [];
    return { write: (c) => { chunks.push(Buffer.from(c)); }, bytes: () => Buffer.concat(chunks) };
};

await test('crc32 matches the standard check value', () => {
    assert.strictEqual(crc32(Buffer.from('123456789')), 0xCBF43926);
});

await test('The zip writer produces a zip that reads back with the right names and bytes (Hindi/Telugu names too)', async () => {
    const out = collect();
    const zip = new ZipWriter(out.write);
    const a = Buffer.from('first audio');
    const b = Buffer.alloc(70000, 7);
    await zip.addFile('Asha_2026-10-30_919999999999.mp3', a);
    await zip.addFile('राम_2026-10-30_918888888888.mp3', b);
    await zip.addFile('empty.txt', Buffer.alloc(0));
    await zip.finish();
    const files = readZip(out.bytes());
    assert.deepStrictEqual(Object.keys(files), ['Asha_2026-10-30_919999999999.mp3', 'राम_2026-10-30_918888888888.mp3', 'empty.txt']);
    assert.ok(files['Asha_2026-10-30_919999999999.mp3'].equals(a));
    assert.ok(files['राम_2026-10-30_918888888888.mp3'].equals(b));
    assert.strictEqual(files['empty.txt'].length, 0);
});

await test('File names are name_date_phone.mp3', () => {
    const row = { contact_name: 'Asha Rao', phone: '+91 99999 99999', started_at: '2026-10-30T09:15:00.000Z' };
    assert.strictEqual(RecordingService.zipFileName(row), 'Asha_Rao_2026-10-30_919999999999.mp3');
    assert.strictEqual(RecordingService.zipFileName(row, 'audio/wav'), 'Asha_Rao_2026-10-30_919999999999.wav');
});

await test('Names in other scripts are kept, and missing parts get a placeholder', () => {
    assert.strictEqual(RecordingService.zipFileName({ contact_name: 'రవి కుమార్', phone: '9876543210', started_at: '2026-01-02T00:00:00Z' }),
        'రవి_కుమార్_2026-01-02_9876543210.mp3');
    assert.strictEqual(RecordingService.zipFileName({ contact_name: '', phone: '', started_at: '' }), 'call_no-date_no-number.mp3');
    assert.ok(!/[\\/:*?"<>|]/.test(RecordingService.zipFileName({ contact_name: 'A/B:C*', phone: '1', started_at: '2026-01-01' })), 'no characters a file name cannot hold');
});

await test('Calls without a usable recording are separated out with a reason', () => {
    const now = Date.now();
    const rows = [
        { id: 'ok', contact_name: 'A', phone: '1', recording_url: 'https://media.plivo.com/Recording/r1.mp3', ended_at: new Date(now - 3600e3).toISOString() },
        { id: 'old', contact_name: 'B', phone: '2', recording_url: 'https://media.plivo.com/Recording/r2.mp3', ended_at: new Date(now - 40 * 86400e3).toISOString() },
        { id: 'none', contact_name: 'C', phone: '3', recording_url: '', ended_at: new Date(now - 3600e3).toISOString() }
    ];
    const { available, notIncluded } = RecordingService.splitDownloadable(rows);
    assert.deepStrictEqual(available.map(r => r.id), ['ok']);
    assert.strictEqual(notIncluded.length, 2);
    assert.ok(notIncluded.some(t => t.startsWith('B (2)') && /expired/.test(t)));
    assert.ok(notIncluded.some(t => t.startsWith('C (3)') && /no recording/.test(t)));
});

await test('streamZip: one file per call, same-name calls get _2, failures are listed in NOT_INCLUDED.txt', async () => {
    const real = RecordingService.fetchAudio;
    RecordingService.fetchAudio = async (row) => row.fail
        ? { ok: false, reason: 'timed out' }
        : { ok: true, buffer: Buffer.from(`audio-${row.id}`), contentType: 'audio/mpeg' };
    try {
        const same = { contact_name: 'Asha', phone: '111', started_at: '2026-10-30T10:00:00Z' };
        const rows = [
            { id: '1', ...same }, { id: '2', ...same }, { id: '3', ...same },
            { id: '4', contact_name: 'Bala', phone: '222', started_at: '2026-10-29T10:00:00Z' },
            { id: '5', contact_name: 'Chitra', phone: '333', started_at: '2026-10-29T10:00:00Z', fail: true }
        ];
        const out = collect();
        const result = await RecordingService.streamZip(rows, out.write, { notIncluded: ['Dev (444): no recording'], concurrency: 2 });
        assert.deepStrictEqual({ included: result.included, notIncluded: result.notIncluded }, { included: 4, notIncluded: 2 });
        const files = readZip(out.bytes());
        assert.deepStrictEqual(Object.keys(files).sort(), [
            'Asha_2026-10-30_111.mp3', 'Asha_2026-10-30_111_2.mp3', 'Asha_2026-10-30_111_3.mp3',
            'Bala_2026-10-29_222.mp3', 'NOT_INCLUDED.txt'
        ].sort());
        assert.strictEqual(files['Asha_2026-10-30_111.mp3'].toString(), 'audio-1', 'order of the ticked calls is kept');
        const note = files['NOT_INCLUDED.txt'].toString();
        assert.ok(note.includes('Dev (444): no recording') && note.includes('Chitra (333): timed out'));
    } finally {
        RecordingService.fetchAudio = real;
    }
});

await test('streamZip stops when the browser goes away', async () => {
    const real = RecordingService.fetchAudio;
    let fetched = 0;
    RecordingService.fetchAudio = async () => { fetched++; return { ok: true, buffer: Buffer.from('x'), contentType: 'audio/mpeg' }; };
    try {
        const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), contact_name: `P${i}`, phone: String(i), started_at: '2026-10-30' }));
        const out = collect();
        let stop = false;
        const result = await RecordingService.streamZip(rows, (c) => { out.write(c); stop = true; }, { concurrency: 2, shouldStop: () => stop });
        assert.strictEqual(result.stopped, true);
        assert.ok(fetched < 10, 'it did not fetch every recording after the browser left');
    } finally {
        RecordingService.fetchAudio = real;
    }
});

// ── The route and the popup ─────────────────────────────────────────────────
const adminRoutes = read('routes/admin.js');
const html = read('dashboard.html');

await test('The route is admin-scoped, limited, and a call that is not theirs is left out', () => {
    const start = adminRoutes.indexOf("router.post('/conversations/audio-zip'");
    assert.ok(start > 0, 'route missing');
    const route = adminRoutes.slice(start, adminRoutes.indexOf("router.delete('/conversations/:id'"));
    assert.ok(route.includes('findConversation(id, { adminId: req.user.id })'), 'each call is looked up with the admin scope');
    assert.ok(route.includes('ZIP_MAX_CALLS'), 'there is a limit');
    assert.ok(route.includes("'application/zip'") && route.includes('.zip"'), 'sent as a .zip file');
    assert.ok(route.includes('notFound'), 'a call that is not theirs is listed as not found');
});

await test('The popup has a Download Audio button right after Download Excel, disabled until a call is ticked', () => {
    const excel = html.indexOf('id="camp-convs-dl-btn"');
    const audio = html.indexOf('id="camp-convs-audio-btn"');
    const close = html.indexOf('id="modal-camp-convs-close"');
    assert.ok(excel > 0 && audio > excel && close > audio, 'order: Excel, Audio, Close');
    assert.ok(/id="camp-convs-audio-btn"[^>]*\sdisabled/.test(html), 'starts disabled');
    assert.ok(html.includes('AdminClient.downloadAudioZip(ids)'), 'the button calls the zip download');
    assert.ok(read('admin-client.js').includes('/api/admin/conversations/audio-zip'), 'client posts to the zip route');
});

await test('The popup is paged: rows per page, page numbers, previous and next are wired', () => {
    for (const id of ['camp-convs-limit', 'camp-convs-prev-btn', 'camp-convs-next-btn', 'camp-convs-pages']) {
        assert.ok(html.includes(`id="${id}"`), `${id} missing`);
        assert.ok(html.includes(`getElementById('${id}')`), `${id} is not used by the script`);
    }
    assert.ok(html.includes('pageRows = filtered.slice('), 'only one page of rows is drawn');
    assert.ok(!/ORDER BY c\.started_at DESC LIMIT 100\b/.test(adminRoutes), 'the campaign list is no longer cut at 100 calls');
});

function runPager({ page, totalPages }) {
    const start = html.indexOf('function renderCampConvsPager(');
    const end = html.indexOf('function updateCampConvsSelectionUi(');
    assert.ok(start > 0 && end > start, 'renderCampConvsPager not found');
    const pages = { innerHTML: '' };
    const prev = { disabled: null };
    const next = { disabled: null };
    const ctx = {
        campConvsPage: page, totalPages,
        document: { getElementById: (id) => ({ 'camp-convs-pages': pages, 'camp-convs-prev-btn': prev, 'camp-convs-next-btn': next }[id] || null) }
    };
    vm.createContext(ctx);
    vm.runInContext(`${html.slice(start, end)}\nrenderCampConvsPager(totalPages);`, ctx);
    return { shown: [...pages.innerHTML.matchAll(/data-page="(\d+)"/g)].map(m => Number(m[1])), active: (/convs-page-btn active" data-page="(\d+)"/.exec(pages.innerHTML) || [])[1], gaps: (pages.innerHTML.match(/convs-page-gap/g) || []).length, prev: prev.disabled, next: next.disabled };
}

await test('Page buttons: first, last and the neighbours of the current page, with gaps', () => {
    const first = runPager({ page: 1, totalPages: 9 });
    assert.deepStrictEqual(first.shown, [1, 2, 9]);
    assert.strictEqual(first.active, '1');
    assert.strictEqual(first.prev, true);
    assert.strictEqual(first.next, false);
    const middle = runPager({ page: 5, totalPages: 9 });
    assert.deepStrictEqual(middle.shown, [1, 4, 5, 6, 9]);
    assert.strictEqual(middle.gaps, 2);
    const last = runPager({ page: 9, totalPages: 9 });
    assert.strictEqual(last.next, true);
    const one = runPager({ page: 1, totalPages: 1 });
    assert.deepStrictEqual(one.shown, [1]);
    assert.strictEqual(one.prev, true);
    assert.strictEqual(one.next, true);
});

if (failed) {
    console.log(`\n${failed} test(s) failed`);
    process.exit(1);
}
console.log('\ncampaign_audio_zip: all checks passed');
process.exit(0);
