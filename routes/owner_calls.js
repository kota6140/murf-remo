/**
 * Owner panel: per-admin call data. Mounted by routes/owner.js (already behind requireOwner).
 *
 *   GET  /users/:id/conversations | calls | scheduled | batches
 *   GET  /conversations/:id          DELETE /conversations/:id
 *   GET  /conversations/:id/audio[?download=1]   GET /conversations/:id/recording-info
 *   POST /queue/:id/cancel           POST /users/:id/scheduled/cancel-all
 *   GET  /batches                    PUT /batches/:id/owner
 *   GET  /conversations-unassigned   PUT /conversations/:id/owner
 *
 * Call data is linked to a user through batches.owner_user_id (a batch = one uploaded contact sheet).
 * Live-voice conversations are often not tied to a batch, so conversations.owner_user_id can be set directly.
 * "Scheduled calls": the system has no date/time scheduling, so this lists calls waiting in the queue.
 */
import express from 'express';
import { readUsers } from '../users_store.js';
import callDb, { utcNow, ensureOwnerColumns } from '../services/db.js';
import RecordingService from '../services/recording_service.js';

const router = express.Router();
const fail = (res, code, message) => res.status(code).json({ success: false, message });

const route = (fn) => async (req, res) => {
    try {
        await ensureOwnerColumns();
        await fn(req, res);
    } catch (e) {
        console.error('[OWNER_CALLS]', e);
        fail(res, 500, 'Could not load call data. Check that the database is reachable.');
    }
};

const userExists = (req, res) => {
    if (readUsers().some(u => u.id === req.params.id)) return true;
    fail(res, 404, 'User not found.');
    return false;
};

const CALL_DONE = ['COMPLETED', 'FAILED', 'UNANSWERED', 'SKIPPED', 'CANCELLED', 'CALLING', 'in-progress'];

router.get('/users/:id/batches', route(async (req, res) => {
    if (!userExists(req, res)) return;
    const batches = await callDb.all(
        'SELECT id, service, filename, status, total_rows, valid_rows, invalid_rows, created_at FROM batches WHERE owner_user_id = ? ORDER BY created_at DESC',
        [req.params.id]);
    res.json({ success: true, batches });
}));

router.get('/users/:id/conversations', route(async (req, res) => {
    if (!userExists(req, res)) return;
    const rows = await callDb.all(
        `SELECT c.id, c.service, c.contact_name, c.phone, c.status, c.started_at, c.duration_seconds,
                c.language, c.summary, c.classification, c.sentiment
         FROM conversations c
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         LEFT JOIN batches b ON b.id = ct.batch_id
         WHERE c.owner_user_id = ? OR b.owner_user_id = ? ORDER BY c.started_at DESC`, [req.params.id, req.params.id]);
    res.json({ success: true, conversations: rows });
}));

router.get('/conversations/:id', route(async (req, res) => {
    const conv = await callDb.get(
        `SELECT c.*, b.filename AS batch_file FROM conversations c
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         LEFT JOIN batches b ON b.id = ct.batch_id WHERE c.id = ?`, [req.params.id]);
    if (!conv) return fail(res, 404, 'Conversation not found.');
    const transcript = await callDb.all(
        'SELECT speaker, text, timestamp FROM transcript_messages WHERE conversation_id = ? ORDER BY id ASC', [req.params.id]);
    const recordingRow = await RecordingService.findConversation(req.params.id);
    const recording = recordingRow ? RecordingService.describe(await RecordingService.resolve(recordingRow), '/api/owner') : null;
    // The raw Plivo link stays on the server; the page uses the checked audio route in `recording`.
    res.json({ success: true, conversation: { ...conv, recording_url: undefined, recording_id: undefined }, transcript, recording });
}));

// Call recordings: the owner can hear and download every call (an admin only their own, see routes/admin.js).
router.get('/conversations/:id/audio', route(async (req, res) => {
    const row = await RecordingService.findConversation(req.params.id);
    if (!row) return fail(res, 404, 'Conversation not found.');
    await RecordingService.serve(req, res, row, { download: req.query.download === '1' });
}));

router.get('/conversations/:id/recording-info', route(async (req, res) => {
    const row = await RecordingService.findConversation(req.params.id);
    if (!row) return fail(res, 404, 'Conversation not found.');
    res.json({ success: true, ...RecordingService.describe(await RecordingService.resolve(row), '/api/owner') });
}));

router.delete('/conversations/:id', route(async (req, res) => {
    const conv = await callDb.get('SELECT id FROM conversations WHERE id = ?', [req.params.id]);
    if (!conv) return fail(res, 404, 'Conversation not found.');
    await callDb.run('DELETE FROM transcript_messages WHERE conversation_id = ?', [req.params.id]);
    await callDb.run('DELETE FROM conversations WHERE id = ?', [req.params.id]);
    res.json({ success: true });
}));

router.get('/users/:id/calls', route(async (req, res) => {
    if (!userExists(req, res)) return;
    const marks = CALL_DONE.map(() => '?').join(',');
    const rows = await callDb.all(
        `SELECT ct.id, ct.service, ct.name, ct.phone, ct.call_status, ct.started_at, ct.ended_at, ct.duration_seconds,
                ct.detected_language, ct.call_outcome, ct.classification, ct.summary, ct.error_details,
                ct.attempt_count, b.filename AS batch_file
         FROM contacts ct JOIN batches b ON b.id = ct.batch_id
         WHERE b.owner_user_id = ? AND ct.call_status IN (${marks})
         ORDER BY COALESCE(ct.started_at, ct.updated_at) DESC`, [req.params.id, ...CALL_DONE]);
    res.json({ success: true, calls: rows });
}));

router.get('/users/:id/scheduled', route(async (req, res) => {
    if (!userExists(req, res)) return;
    const rows = await callDb.all(
        `SELECT q.id, q.service, q.status, q.priority, q.created_at, ct.name, ct.phone, ct.preferred_language, b.filename AS batch_file
         FROM call_queue q JOIN contacts ct ON ct.id = q.contact_id JOIN batches b ON b.id = q.batch_id
         WHERE b.owner_user_id = ? AND q.status IN ('QUEUED', 'IN_PROGRESS')
         ORDER BY q.priority DESC, q.created_at ASC`, [req.params.id]);
    res.json({ success: true, scheduled: rows });
}));

async function cancelQueued(where, params) {
    const now = utcNow();
    const rows = await callDb.all(
        `SELECT q.id, q.contact_id FROM call_queue q JOIN batches b ON b.id = q.batch_id WHERE q.status = 'QUEUED' AND ${where}`, params);
    for (const r of rows) {
        await callDb.run("UPDATE call_queue SET status = 'CANCELLED', updated_at = ? WHERE id = ?", [now, r.id]);
        await callDb.run("UPDATE contacts SET call_status = 'CANCELLED', updated_at = ? WHERE id = ?", [now, r.contact_id]);
    }
    return rows.length;
}

router.post('/queue/:id/cancel', route(async (req, res) => {
    const n = await cancelQueued('q.id = ?', [req.params.id]);
    if (!n) return fail(res, 404, 'That call is no longer waiting in the queue.');
    res.json({ success: true });
}));

router.post('/users/:id/scheduled/cancel-all', route(async (req, res) => {
    if (!userExists(req, res)) return;
    res.json({ success: true, cancelled: await cancelQueued('b.owner_user_id = ?', [req.params.id]) });
}));

// ── Everything, across all admins (the "Calls & data" section) ──────────────
const ROW_LIMIT = 1000;
function withOwnerNames(rows) {
    const names = new Map(readUsers().map(u => [u.id, u.name]));
    return rows.map(r => ({ ...r, owner_name: names.get(r.owner_user_id) || null }));
}

router.get('/all/conversations', route(async (req, res) => {
    const rows = await callDb.all(
        `SELECT c.id, c.service, c.contact_name, c.phone, c.status, c.started_at, c.duration_seconds,
                c.language, c.summary, c.classification, c.sentiment,
                COALESCE(c.owner_user_id, b.owner_user_id) AS owner_user_id,
                CASE WHEN c.owner_user_id IS NULL AND b.owner_user_id IS NOT NULL THEN b.filename ELSE NULL END AS owner_via_sheet
         FROM conversations c
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         LEFT JOIN batches b ON b.id = ct.batch_id
         ORDER BY c.started_at DESC LIMIT ${ROW_LIMIT}`);
    res.json({ success: true, rows: withOwnerNames(rows) });
}));

router.get('/all/calls', route(async (req, res) => {
    const marks = CALL_DONE.map(() => '?').join(',');
    const rows = await callDb.all(
        `SELECT ct.id, ct.service, ct.name, ct.phone, ct.call_status, ct.started_at, ct.duration_seconds,
                ct.call_outcome, ct.classification, ct.summary, ct.error_details,
                b.owner_user_id AS owner_user_id, b.filename AS batch_file
         FROM contacts ct LEFT JOIN batches b ON b.id = ct.batch_id
         WHERE ct.call_status IN (${marks})
         ORDER BY COALESCE(ct.started_at, ct.updated_at) DESC LIMIT ${ROW_LIMIT}`, CALL_DONE);
    res.json({ success: true, rows: withOwnerNames(rows) });
}));

router.get('/all/scheduled', route(async (req, res) => {
    const rows = await callDb.all(
        `SELECT q.id, q.service, q.status, q.created_at, ct.name, ct.phone,
                b.owner_user_id AS owner_user_id, b.filename AS batch_file
         FROM call_queue q JOIN contacts ct ON ct.id = q.contact_id LEFT JOIN batches b ON b.id = q.batch_id
         WHERE q.status IN ('QUEUED', 'IN_PROGRESS')
         ORDER BY q.priority DESC, q.created_at ASC LIMIT ${ROW_LIMIT}`);
    res.json({ success: true, rows: withOwnerNames(rows) });
}));

router.get('/batches', route(async (req, res) => {
    const batches = await callDb.all(
        `SELECT b.id, b.service, b.filename, b.status, b.total_rows, b.valid_rows, b.created_at, b.owner_user_id,
                (SELECT COUNT(*) FROM conversations c WHERE c.batch_id = b.id) AS conversation_count
         FROM batches b ORDER BY b.created_at DESC`);
    const names = new Map(readUsers().map(u => [u.id, u.name]));
    res.json({ success: true, batches: batches.map(b => ({ ...b, owner_name: names.get(b.owner_user_id) || null })) });
}));

router.get('/conversations-unassigned', route(async (req, res) => {
    const rows = await callDb.all(
        `SELECT c.id, c.service, c.contact_name, c.phone, c.status, c.started_at, c.duration_seconds, c.classification
         FROM conversations c
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         LEFT JOIN batches b ON b.id = ct.batch_id
         WHERE c.owner_user_id IS NULL AND b.owner_user_id IS NULL ORDER BY c.started_at DESC`);
    res.json({ success: true, conversations: rows });
}));

router.put('/conversations/:id/owner', route(async (req, res) => {
    const { userId } = req.body || {};
    if (userId && !readUsers().some(u => u.id === userId)) return fail(res, 404, 'User not found.');
    const conv = await callDb.get('SELECT id FROM conversations WHERE id = ?', [req.params.id]);
    if (!conv) return fail(res, 404, 'Conversation not found.');
    await callDb.run('UPDATE conversations SET owner_user_id = ? WHERE id = ?', [userId || null, req.params.id]);
    res.json({ success: true });
}));

router.put('/batches/:id/owner', route(async (req, res) => {
    const { userId } = req.body || {};
    if (userId && !readUsers().some(u => u.id === userId)) return fail(res, 404, 'User not found.');
    const batch = await callDb.get('SELECT id FROM batches WHERE id = ?', [req.params.id]);
    if (!batch) return fail(res, 404, 'Batch not found.');
    await callDb.run('UPDATE batches SET owner_user_id = ?, updated_at = ? WHERE id = ?', [userId || null, utcNow(), req.params.id]);
    res.json({ success: true });
}));

export default router;
