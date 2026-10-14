/**
 * routes/admin.js
 * Admin dashboard API (/api/admin/*). Requires an account with the admin role.
 *
 * Thin HTTP layer over the service modules, which all use services/db.js (MySQL, with SQLite
 * fallback). Used by dashboard.html through admin-client.js.
 */

import express from 'express';
import path from 'path';
import multer from 'multer';
import { requireAdmin } from '../middleware/auth.js';
import { readUsers } from '../users_store.js';
import db, { utcNow, ensureOwnerColumns } from '../services/db.js';
import AdminService from '../services/admin_service.js';
import ConversationService from '../services/conversation_service.js';
import CallService from '../services/call_service.js';
import ExcelService from '../services/excel_service.js';
import RecruitmentService from '../services/recruitment_service.js';
import SalesService from '../services/sales_service.js';
import SupportService from '../services/support_service.js';
import { CallQueueWorker } from '../services/call_queue_worker.js';
import PlivoService from '../services/plivo_service.js';
import ElevenLabsService from '../services/elevenlabs_service.js';

const SERVICES = {
    recruitment: RecruitmentService,
    sales: SalesService,
    support: SupportService
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.xlsx', '.xls', '.csv'].includes(ext)) return cb(null, true);
        cb(new Error(`Unsupported file type ${ext}. Only Excel/CSV allowed.`));
    }
});

const router = express.Router();
router.use(requireAdmin);
// Make sure the owner columns exist before any per-admin query runs.
router.use(async (req, res, next) => {
    try { await ensureOwnerColumns(); } catch (e) { console.error('[AdminRoutes] owner columns:', e.message); }
    next();
});

const fail = (res, code, message) => res.status(code).json({ success: false, message });
const wrap = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (e) {
        console.error(`[AdminRoutes] ${req.method} ${req.originalUrl}:`, e);
        fail(res, e.statusCode || 500, e.message || 'Something went wrong.');
    }
};

function serviceFor(req, res, next) {
    const name = (req.params.service || '').toLowerCase();
    if (!SERVICES[name]) return fail(res, 400, 'Invalid service.');
    req.serviceName = name;
    next();
}

// ============================================================================
// GET /api/admin/dashboard
// ============================================================================
router.get('/dashboard', wrap(async (req, res) => {
    // Every admin only sees their own data (see owner_user_id).
    const stats = await AdminService.getDashboardStats(req.user.id);

    // The dashboard's queue panel expects these field names.
    const active = await db.get(`
        SELECT ct.name, ct.phone, ct.service
        FROM call_queue q JOIN contacts ct ON ct.id = q.contact_id
        WHERE q.status = 'IN_PROGRESS' AND q.batch_id IN (SELECT id FROM batches WHERE owner_user_id = ?)
        ORDER BY q.updated_at DESC LIMIT 1`, [req.user.id]);
    const q = stats.queue || {};
    stats.queue = {
        ...q,
        queuedCount: q.queueLength || 0,
        inProgressCount: active ? 1 : 0,
        isRunning: !!q.active,
        activeCall: active ? { contact_name: active.name, name: active.name, phone: active.phone, service: active.service } : null
    };

    res.json({ success: true, ...stats });
}));

// ============================================================================
// GET /api/admin/users
// ============================================================================
router.get('/users', (req, res) => {
    const { page = 1, limit = 10, search = '' } = req.query;
    // Admins must not see other customers' details: only their own account is listed.
    let users = readUsers().filter(u => u.id === req.user.id).map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone || '',
        companyName: u.companyName || '',
        role: u.role || 'user',
        profileCompleted: !!u.profileCompleted,
        createdAt: u.createdAt
    }));

    if (search) {
        const s = String(search).toLowerCase();
        users = users.filter(u => (u.name || '').toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s));
    }

    const total = users.length;
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const lm = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const start = (pg - 1) * lm;

    res.json({
        success: true,
        data: users.slice(start, start + lm),
        pagination: { page: pg, limit: lm, total, totalPages: Math.ceil(total / lm) }
    });
});

// ============================================================================
// POST /api/admin/:service/upload   (multipart field "file")
// POST /api/admin/:service/start    { fileId }
// GET  /api/admin/:service/download ?batchId=
// ============================================================================
router.post('/:service/upload', serviceFor, (req, res, next) => {
    upload.single('file')(req, res, (err) => (err ? fail(res, 400, err.message) : next()));
}, wrap(async (req, res) => {
    if (!req.file) return fail(res, 400, 'Please choose an Excel or CSV file to upload.');
    const result = await SERVICES[req.serviceName].validateAndProcessUpload(req.file, req.file.originalname);

    // Record who uploaded this sheet, so its calls and conversations show up under them in the owner panel.
    if (result.fileId) {
        try {
            await ensureOwnerColumns();
            await db.run('UPDATE batches SET owner_user_id = ? WHERE id = ?', [req.user.id, result.fileId]);
        } catch (e) {
            console.error('[AdminRoutes] Could not record upload owner:', e.message);
        }
    }

    res.json({ success: true, ...result });
}));

router.post('/:service/start', serviceFor, wrap(async (req, res) => {
    // Only this admin's own contact sheets can be started.
    let { fileId } = req.body || {};
    fileId = typeof fileId === 'string' ? fileId.trim() : '';
    let batch = null;
    if (fileId) {
        batch = await db.get('SELECT id FROM batches WHERE id = ? AND owner_user_id = ?', [fileId, req.user.id]);
        if (!batch) return fail(res, 404, 'That contact sheet was not found in your account.');
    } else {
        batch = await db.get(
            "SELECT id FROM batches WHERE service = ? AND owner_user_id = ? AND status IN ('READY', 'IN_PROGRESS') ORDER BY created_at DESC LIMIT 1",
            [req.serviceName, req.user.id]);
        if (!batch) return fail(res, 400, 'Upload a contact sheet first.');
    }
    const result = await SERVICES[req.serviceName].startCallingCampaign(batch.id);
    res.json({ success: true, ...result });
}));

router.get('/:service/download', serviceFor, wrap(async (req, res) => {
    const buffer = await ExcelService.generateUpdatedWorkbook(req.serviceName, req.query.batchId || null, req.user.id);
    res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${req.serviceName}_report.xlsx"`
    });
    res.send(Buffer.from(buffer));
}));

// ============================================================================
// Conversations
// ============================================================================
router.get('/conversations', wrap(async (req, res) => {
    const { service, user, status, date, search, page, limit } = req.query;
    const result = await ConversationService.getConversations(service, user, status, date, search, page, limit, req.user.id);
    res.json({ success: true, ...result });
}));

router.get('/conversations/:id', wrap(async (req, res) => {
    const conversation = await ConversationService.getConversationById(req.params.id, req.user.id);
    if (!conversation) return fail(res, 404, 'Conversation not found.');
    res.json({ success: true, conversation, ...conversation });
}));

router.delete('/conversations/:id', wrap(async (req, res) => {
    const conv = await ConversationService.getConversationById(req.params.id, req.user.id);
    if (!conv) return fail(res, 404, 'Conversation not found.');
    await db.run('DELETE FROM transcript_messages WHERE conversation_id = ?', [req.params.id]);
    await db.run('DELETE FROM conversations WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Conversation deleted.' });
}));

// ============================================================================
// Call history
// ============================================================================
router.get('/calls', wrap(async (req, res) => {
    const { service, status, user, date, search, page, limit } = req.query;
    const result = await CallService.getCalls(service, status, user, date, search, page, limit, req.user.id);
    res.json({ success: true, ...result });
}));

// Call ids look like "call_<first 8 chars of the contact id>" (see CallService.getCalls).
router.delete('/calls/:id', wrap(async (req, res) => {
    const m = /^call_([A-Za-z0-9_-]{1,8})$/.exec(req.params.id);
    if (!m) return fail(res, 404, 'Call record not found.');
    const rows = await db.all(
        'SELECT ct.id FROM contacts ct LEFT JOIN batches b ON b.id = ct.batch_id WHERE ct.id LIKE ? AND (b.owner_user_id = ? OR ct.owner_user_id = ? OR b.owner_user_id IS NULL)',
        [`${m[1]}%`, req.user.id, req.user.id]);
    if (rows.length !== 1) return fail(res, 404, 'Call record not found.');
    await db.run("UPDATE contacts SET call_status = 'DELETED', updated_at = ? WHERE id = ?", [utcNow(), rows[0].id]);
    res.json({ success: true, message: 'Call record deleted.' });
}));

// ============================================================================
// Queue controls
// ============================================================================
router.get('/queue/status', wrap(async (req, res) => {
    const status = await CallQueueWorker.getQueueStatus(req.query.batchId || null, req.user.id);
    res.json({ success: true, ...status, queuedCount: status.queueLength, isRunning: status.active });
}));

router.post('/queue/pause', (req, res) => {
    CallQueueWorker.pauseQueue(req.user.id);
    res.json({ success: true, message: 'Queue paused.' });
});

router.post('/queue/resume', (req, res) => {
    CallQueueWorker.resumeQueue(req.user.id);
    res.json({ success: true, message: 'Queue resumed.' });
});

router.post('/queue/cancel', wrap(async (req, res) => {
    await CallQueueWorker.cancelQueue((req.body || {}).batchId || null, req.user.id);
    res.json({ success: true, message: 'Queue cancelled.' });
}));

// ============================================================================
// POST /api/admin/test-call
// ============================================================================
router.post('/test-call', async (req, res) => {
    const { phone, name, service } = req.body || {};
    if (!phone || !name) return fail(res, 400, 'Phone and name are required.');

    console.log(`[AdminRoutes] Test call request: ${name} (${phone}) — service: ${service || 'recruitment'}`);

    try {
        if (PlivoService.isConfigured()) {
            const ownerId = req.user?.id || 'usr_admin_takeremo_reach';
            const contactId = `cnt_test_${Date.now()}`;
            const now = utcNow();

            const testContact = {
                id: contactId,
                phone: phone,
                name: name,
                service: service || 'recruitment',
                owner_user_id: ownerId,
                job_role: 'Senior Software Engineer',
                experience: '4 years',
                skills: 'Node.js, React, Voice AI',
                company: 'Score Labs',
                notes: 'Live test call initiated from Admin Dashboard'
            };

            // Pre-insert into contacts table
            try {
                await db.run(`
                    INSERT INTO contacts (
                        id, batch_id, service, row_index, raw_data, name, phone, preferred_language,
                        notes, extra_data, validation_status, validation_errors, call_status,
                        started_at, updated_at, owner_user_id
                    ) VALUES (?, 'direct_batch', ?, 1, ?, ?, ?, 'en', ?, ?, 'VALID', '[]', 'CALLING', ?, ?, ?)
                `, [
                    testContact.id,
                    testContact.service,
                    JSON.stringify(testContact),
                    testContact.name,
                    testContact.phone,
                    testContact.notes,
                    JSON.stringify({
                        job_role: testContact.job_role,
                        experience: testContact.experience,
                        skills: testContact.skills,
                        company: testContact.company
                    }),
                    now,
                    now,
                    ownerId
                ]);
            } catch (insErr) {
                console.warn('[AdminRoutes] Note: pre-insert test contact:', insErr.message);
            }

            const callResult = await PlivoService.initiateOutboundCall(testContact, service || 'recruitment');
            if (callResult.success) {
                if (callResult.callUuid) {
                    await db.run('UPDATE contacts SET provider_call_id = ? WHERE id = ?', [callResult.callUuid, testContact.id]).catch(() => {});
                }
                return res.json({
                    success: true,
                    message: `Test call initiated successfully via Plivo to ${phone}! Call ID: ${callResult.callUuid}`,
                    callId: callResult.callUuid
                });
            } else {
                return res.status(502).json({
                    success: false,
                    message: `Plivo test call failed: ${callResult.error}`
                });
            }
        } else {
            return res.json({
                success: true,
                message: `Test call recorded (Plivo credentials not configured, simulated only).`
            });
        }
    } catch (err) {
        console.error('[AdminRoutes] Test call error:', err);
        return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
    }
});

// ============================================================================
// Plivo Webhook Handlers (Answer XML, Call Status, Call Hangup)
// ============================================================================
export async function handlePlivoAnswer(req, res) {
    const query = { ...(req.query || {}), ...(req.body || {}) };
    const callUuid = query.CallUUID || query.call_uuid || query.CallId || '';
    const contactId = query.contactId || '';
    const service = query.service || 'recruitment';
    const ownerId = query.ownerId || '';
    const phone = query.phone || query.To || '';
    const name = query.name || '';
    const role = query.role || query.job_role || '';
    const company = query.company || '';

    console.log(`[Plivo Answer] Received answer for CallUUID: ${callUuid}, Contact: ${contactId}, Service: ${service}`);

    const cfg = PlivoService.getConfig();
    const serverUrl = cfg.serverUrl || 'https://election-driller-arguably.ngrok-free.dev';
    const wsBaseUrl = serverUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    const streamWsUrl = `${wsBaseUrl}/voicebot`;
    const extraHeaders = `callId=${callUuid},contactId=${contactId},service=${service},ownerId=${ownerId},phone=${phone},name=${encodeURIComponent(name)},role=${encodeURIComponent(role)},company=${encodeURIComponent(company)}`;

    const xml = PlivoService.generateAnswerXml(streamWsUrl, extraHeaders);
    res.set('Content-Type', 'text/xml');
    res.status(200).send(xml);
}

export async function handlePlivoStatus(req, res) {
    const body = { ...(req.query || {}), ...(req.body || {}) };
    const callUuid = body.CallUUID || body.call_uuid || '';
    const status = String(body.CallStatus || body.Status || body.status || '').toLowerCase();

    console.log(`[Plivo Status] CallUUID: ${callUuid}, Status: ${status}`);

    if (callUuid) {
        try {
            const now = utcNow();
            let dbStatus = 'CALLING';
            if (['in-progress', 'answered'].includes(status)) dbStatus = 'in-progress';
            else if (['completed'].includes(status)) dbStatus = 'COMPLETED';
            else if (['busy', 'no-answer', 'timeout'].includes(status)) dbStatus = 'UNANSWERED';
            else if (['failed', 'rejected'].includes(status)) dbStatus = 'FAILED';

            await db.run(
                `UPDATE contacts SET call_status = ?, updated_at = ? WHERE provider_call_id = ?`,
                [dbStatus, now, callUuid]
            );

            if (['COMPLETED', 'FAILED', 'UNANSWERED'].includes(dbStatus)) {
                await db.run(
                    `UPDATE call_queue SET status = ?, updated_at = ? WHERE contact_id IN (SELECT id FROM contacts WHERE provider_call_id = ?)`,
                    [dbStatus, now, callUuid]
                );
            }
        } catch (e) {
            console.error('[Plivo Status] DB update error:', e.message);
        }
    }

    res.status(200).send('OK');
}

export async function handlePlivoHangup(req, res) {
    const body = { ...(req.query || {}), ...(req.body || {}) };
    const callUuid = body.CallUUID || body.call_uuid || '';
    const duration = parseInt(body.Duration || body.duration || body.CallDuration || '0', 10) || 0;

    console.log(`[Plivo Hangup] CallUUID: ${callUuid}, Duration: ${duration}s`);

    if (callUuid) {
        try {
            const now = utcNow();
            await db.run(
                `UPDATE contacts SET call_status = 'COMPLETED', ended_at = ?, duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END, updated_at = ? WHERE provider_call_id = ?`,
                [now, duration, duration, now, callUuid]
            );
            await db.run(
                `UPDATE conversations SET duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END, ended_at = ? WHERE contact_id IN (SELECT id FROM contacts WHERE provider_call_id = ?)`,
                [duration, duration, now, callUuid]
            );
            await db.run(
                `UPDATE call_queue SET status = 'COMPLETED', updated_at = ? WHERE contact_id IN (SELECT id FROM contacts WHERE provider_call_id = ?)`,
                [now, callUuid]
            );
        } catch (e) {
            console.error('[Plivo Hangup] DB update error:', e.message);
        }
    }

    res.status(200).send('OK');
}

// ============================================================================
// ElevenLabs Webhook Handler
// ============================================================================
export async function handleElevenLabsWebhook(req, res) {
    const sigHeader = req.headers['elevenlabs-signature'] || req.headers['ElevenLabs-Signature'] || '';
    const rawBody = req.rawBody || JSON.stringify(req.body || {});

    const isValid = ElevenLabsService.verifyWebhookSignature(rawBody, sigHeader);
    if (!isValid) {
        console.warn('[ElevenLabs Webhook] Signature verification failed.');
        return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    const payload = req.body || {};
    const type = payload.type || payload.event || '';
    console.log(`[ElevenLabs Webhook] Received verified event: ${type}`);

    return res.status(200).json({ received: true });
}

// ============================================================================
// Exotel webhook handler (Legacy fallback)
// ============================================================================
const EXOTEL_FINAL = {
    completed: 'COMPLETED',
    failed: 'FAILED',
    busy: 'UNANSWERED',
    'no-answer': 'UNANSWERED',
    canceled: 'CANCELLED'
};

export async function handleExotelWebhook(req, res) {
    const body = { ...(req.query || {}), ...(req.body || {}) };
    const callSid = body.CallSid || body.call_sid || '';
    const status = String(body.Status || body.status || '').toLowerCase();

    console.log(`[Exotel] Webhook received — CallSid: ${callSid}, Status: ${status}`);

    const callStatus = EXOTEL_FINAL[status];
    if (callSid && callStatus) {
        try {
            const contact = await db.get('SELECT id FROM contacts WHERE provider_call_id = ?', [callSid]);
            if (contact) {
                const now = utcNow();
                const duration = parseInt(body.ConversationDuration || body.Duration || body.duration || '0', 10) || 0;
                await db.run(
                    `UPDATE contacts SET call_status = ?, ended_at = ?, duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END, updated_at = ? WHERE id = ?`,
                    [callStatus, now, duration, duration, now, contact.id]);
                await db.run(
                    'UPDATE call_queue SET status = ?, updated_at = ? WHERE contact_id = ?',
                    [callStatus === 'COMPLETED' ? 'COMPLETED' : 'FAILED', now, contact.id]);
            }
        } catch (e) {
            console.error('[Exotel] Webhook DB update failed:', e.message);
        }
    }

    res.status(200).send('OK');
}

export default router;
