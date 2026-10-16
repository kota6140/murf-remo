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
import AppointmentService from '../services/appointment_service.js';
import ReceptionistService from '../services/receptionist_service.js';
import CampaignService from '../services/campaign_service.js';
import { PDFService } from '../services/pdf_service.js';
import { DocumentService } from '../services/document_service.js';
import { QuestionPlanner } from '../services/question_planner.js';
import { CallQueueWorker } from '../services/call_queue_worker.js';
import PlivoService from '../services/plivo_service.js';
import ElevenLabsService from '../services/elevenlabs_service.js';
import AgentService from '../services/agent_service.js';
import { updateDemoCallStatus } from './demo.js';

const SERVICES = {
    recruitment: RecruitmentService,
    sales: SalesService,
    support: SupportService,
    appointment: AppointmentService,
    receptionist: ReceptionistService
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.xlsx', '.xls', '.csv'].includes(ext)) return cb(null, true);
        cb(new Error(`Unsupported file type ${ext}. Only Excel/CSV allowed.`));
    }
});

const uploadDoc = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.pdf', '.docx', '.doc'].includes(ext)) return cb(null, true);
        cb(new Error(`Unsupported file type ${ext}. Only PDF documents (.pdf) and Microsoft Word (.docx, .doc) are allowed.`));
    }
});
const uploadPdf = uploadDoc; // Backward-compatible alias

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
// GET /api/admin/agents  -  only the agents the owner assigned to this admin
// ============================================================================
router.get('/agents', wrap(async (req, res) => {
    const agents = await AgentService.list({ userId: req.user.id });
    res.json({ success: true, agents: agents.map(AgentService.publicView) });
}));

// Picks the agent a start request should use. null means "no agents assigned: use the shared number".
async function pickAgent(req, service) {
    const agentId = typeof (req.body || {}).agentId === 'string' ? req.body.agentId.trim() : '';
    return AgentService.resolveForOutbound(req.user.id, { service, agentId });
}

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
        batch = await db.get('SELECT id FROM batches WHERE id = ? AND (owner_user_id = ? OR owner_user_id IS NULL)', [fileId, req.user.id]);
        if (!batch) return fail(res, 404, 'That contact sheet was not found in your account.');
    } else {
        batch = await db.get(
            "SELECT id FROM batches WHERE service = ? AND (owner_user_id = ? OR owner_user_id IS NULL) AND status IN ('READY', 'IN_PROGRESS') ORDER BY created_at DESC LIMIT 1",
            [req.serviceName, req.user.id]);
        if (!batch) return fail(res, 400, 'Upload a contact sheet first.');
    }
    // Remember which agent (number + behaviour) this sheet's calls use before the queue starts dialling.
    const agent = await pickAgent(req, req.serviceName);
    await AgentService.stampBatch(batch.id, agent);
    const result = await SERVICES[req.serviceName].startCallingCampaign(batch.id);
    res.json({ success: true, ...result, agent: agent ? { id: agent.id, name: agent.name, phoneNumber: agent.phone_number } : null });
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

            const agent = await pickAgent(req, service || 'recruitment');
            if (agent) await db.run('UPDATE contacts SET agent_id = ? WHERE id = ?', [agent.id, testContact.id]).catch(() => {});
            const callResult = await PlivoService.initiateOutboundCall(testContact, service || 'recruitment', { agent });
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
// CAMPAIGN MANAGEMENT API (/api/admin/campaigns/*)
// ============================================================================

// List campaigns
router.get('/campaigns', wrap(async (req, res) => {
    const { service, status } = req.query;
    const campaigns = await CampaignService.listCampaigns(req.user.id, { service, status });
    res.json({ success: true, campaigns });
}));

// Preview and extract PDF/Word requirements without saving immediately
const previewDocHandler = wrap(async (req, res) => {
    if (!req.file) return fail(res, 400, 'Please select a PDF or Word document (.docx, .doc) to preview.');
    const service = (req.body.service || 'recruitment').toLowerCase();
    if (!SERVICES[service]) return fail(res, 400, 'Invalid service.');
    const extracted = await DocumentService.parseCampaignDocument(req.file.buffer, req.file.originalname, service);
    const questionPlan = await QuestionPlanner.generatePlanFor(service, extracted);
    res.json({
        success: true,
        filename: req.file.originalname,
        documentType: extracted.document_type || DocumentService.getDocumentType(req.file.originalname),
        extractedData: extracted,
        questionPlan
    });
});
router.post('/campaigns/preview-pdf', uploadDoc.single('file'), previewDocHandler);
router.post('/campaigns/preview-doc', uploadDoc.single('file'), previewDocHandler);

// Get single campaign
router.get('/campaigns/:id', wrap(async (req, res) => {
    const campaign = await CampaignService.getCampaign(req.params.id, req.user.id);
    if (!campaign) return fail(res, 404, 'Campaign not found.');
    res.json({ success: true, campaign });
}));

// Create campaign
router.post('/campaigns', wrap(async (req, res) => {
    const { name, service, description, config } = req.body;
    if (!name || !name.trim()) return fail(res, 400, 'Campaign name is required.');
    const campaign = await CampaignService.createCampaign({
        name,
        service: service || 'recruitment',
        description,
        config: config || {},
        ownerUserId: req.user.id
    });
    res.status(201).json({ success: true, campaign });
}));

// Update campaign
router.put('/campaigns/:id', wrap(async (req, res) => {
    const updated = await CampaignService.updateCampaign(req.params.id, req.body, req.user.id);
    res.json({ success: true, campaign: updated });
}));

// Upload PDF / Word Document (Job Description or Sales/Support Guide)
const uploadDocHandler = wrap(async (req, res) => {
    if (!req.file) return fail(res, 400, 'Please select a PDF or Word document (.docx, .doc) to upload.');
    const result = await CampaignService.attachDocument(req.params.id, req.file.buffer, req.file.originalname, req.user.id);
    res.json({ success: true, ...result });
});
router.post('/campaigns/:id/upload-pdf', uploadDoc.single('file'), uploadDocHandler);
router.post('/campaigns/:id/upload-doc', uploadDoc.single('file'), uploadDocHandler);

// Remove Attached Document from Campaign
router.delete('/campaigns/:id/document', wrap(async (req, res) => {
    const result = await CampaignService.removeDocument(req.params.id, req.user.id);
    res.json(result);
}));

// Upload Excel / CSV
router.post('/campaigns/:id/upload-excel', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) return fail(res, 400, 'Please select an Excel or CSV file to upload.');
    const result = await CampaignService.attachExcel(req.params.id, req.file, req.file.originalname, req.user.id);
    res.json({ success: true, ...result });
}));

// Start / Dispatch Campaign
router.post('/campaigns/:id/start', wrap(async (req, res) => {
    const campaign = await CampaignService.getCampaign(req.params.id, req.user.id);
    if (!campaign) return fail(res, 404, 'Campaign not found.');
    const agent = await pickAgent(req, campaign.service);
    if (campaign.batch_id) await AgentService.stampBatch(campaign.batch_id, agent);
    const result = await CampaignService.startCampaign(req.params.id, req.user.id);
    res.json({ success: true, ...result, agent: agent ? { id: agent.id, name: agent.name, phoneNumber: agent.phone_number } : null });
}));

// Pause Campaign
router.post('/campaigns/:id/pause', wrap(async (req, res) => {
    const result = await CampaignService.pauseCampaign(req.params.id, req.user.id);
    res.json({ success: true, ...result });
}));

// Resume Campaign
router.post('/campaigns/:id/resume', wrap(async (req, res) => {
    const result = await CampaignService.resumeCampaign(req.params.id, req.user.id);
    res.json({ success: true, ...result });
}));

// Duplicate Campaign
router.post('/campaigns/:id/duplicate', wrap(async (req, res) => {
    const result = await CampaignService.duplicateCampaign(req.params.id, req.user.id);
    res.status(201).json({ success: true, campaign: result });
}));

// Delete Campaign (Permanent)
router.delete('/campaigns/:id', wrap(async (req, res) => {
    const result = await CampaignService.deleteCampaign(req.params.id, req.user.id);
    res.json(result);
}));
router.post('/campaigns/:id/delete', wrap(async (req, res) => {
    const result = await CampaignService.deleteCampaign(req.params.id, req.user.id);
    res.json(result);
}));

// Archive Campaign (kept for backwards compatibility)
router.post('/campaigns/:id/archive', wrap(async (req, res) => {
    const result = await CampaignService.archiveCampaign(req.params.id, req.user.id);
    res.json({ success: true, ...result });
}));

// Download Updated Excel with AI Screening Status & Match Scores
router.get('/campaigns/:id/download', wrap(async (req, res) => {
    const campaign = await CampaignService.getCampaign(req.params.id, req.user.id);
    if (!campaign) return fail(res, 404, 'Campaign not found.');
    const buffer = await ExcelService.generateUpdatedWorkbook({ campaignId: req.params.id });
    const safeName = (campaign.name || 'campaign').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeName}_Screening_Results_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
}));

// View Conversations for Campaign
router.get('/campaigns/:id/conversations', wrap(async (req, res) => {
    const campaign = await CampaignService.getCampaign(req.params.id, req.user.id);
    if (!campaign) return fail(res, 404, 'Campaign not found.');
    const rows = await db.all(`
        SELECT c.*, ct.phone as contact_phone, ct.name as contact_display_name, ct.classification as contact_classification
        FROM conversations c
        LEFT JOIN contacts ct ON c.contact_id = ct.id
        WHERE c.campaign_id = ? OR (c.batch_id = ? AND c.batch_id IS NOT NULL AND c.batch_id != '')
        ORDER BY c.started_at DESC LIMIT 100
    `, [req.params.id, campaign.batch_id || '']);
    res.json({ success: true, conversations: rows });
}));

// ============================================================================
// Plivo Webhook Handlers (Answer XML, Call Status, Call Hangup)
// ============================================================================
export async function handlePlivoAnswer(req, res) {
    const query = { ...(req.query || {}), ...(req.body || {}) };
    const callUuid = query.CallUUID || query.call_uuid || query.CallId || '';
    let contactId = query.contactId || '';
    let service = (query.service || '').toLowerCase().trim();
    let callMode = (query.callMode || query.call_mode || '').trim() || 'STANDARD';
    let ownerId = query.ownerId || '';
    let phone = query.phone || query.To || query.From || '';
    let name = query.name || '';
    let role = query.role || query.job_role || '';
    let company = query.company || '';
    let campaignId = query.campaignId || query.campaign_id || '';
    let agentId = query.agentId || '';
    const direction = String(query.Direction || query.direction || '').toLowerCase() === 'inbound' && !contactId ? 'inbound' : 'outbound';
    let agent = null;

    // Incoming call: whoever dialled one of our agent numbers is routed to that agent and its admin.
    // (For an incoming call Plivo's "To" is our number and "From" is the person calling.)
    if (direction === 'inbound') {
        try {
            agent = await AgentService.findByNumber(query.To || query.to || '');
        } catch (agentErr) {
            console.warn('[Plivo Answer] Agent lookup by number failed:', agentErr.message);
        }
        if (agent) {
            agentId = agent.id;
            service = agent.service;
            ownerId = agent.assigned_user_id || '';
            phone = query.From || query.from || '';
            name = '';
        } else {
            console.warn(`[Plivo Answer] Incoming call to ${query.To || 'unknown number'} but no active agent owns that number.`);
        }
    } else if (agentId) {
        try { agent = await AgentService.get(agentId); } catch { /* keep going without the agent */ }
    }

    if (service === 'promotional' || callMode === 'PROMOTIONAL_DEMO') {
        callMode = 'PROMOTIONAL_DEMO';
        service = 'promotional';
    }

    // 1. If contactId was passed, verify and enrich directly from contacts table
    if (contactId) {
        try {
            const contact = await db.get('SELECT * FROM contacts WHERE id = ?', [contactId]);
            if (contact) {
                if (contact.service) service = contact.service.toLowerCase();
                if (contact.name && !name) name = contact.name;
                if (contact.phone && !phone) phone = contact.phone;
                if (contact.owner_user_id && !ownerId) ownerId = contact.owner_user_id;
                if (contact.campaign_id && !campaignId) campaignId = contact.campaign_id;
                let parsed = {};
                try { parsed = JSON.parse(contact.raw_data || contact.extra_data || '{}'); } catch {}
                if (!role && (parsed.role || parsed.job_role || parsed.jobRole || parsed.title)) {
                    role = parsed.role || parsed.job_role || parsed.jobRole || parsed.title;
                }
                if (!company && (parsed.company || parsed.companyName || parsed.company_name)) {
                    company = parsed.company || parsed.companyName || parsed.company_name;
                }
            }
        } catch (dbErr) {
            console.warn('[Plivo Answer] DB lookup by contactId warning:', dbErr.message);
        }
    }

    // 2. If service is missing, look up active call queue job or provider_call_id
    if (!service) {
        try {
            let activeItem = null;
            if (callUuid) {
                activeItem = await db.get(`
                    SELECT c.id as contact_id, c.service, c.name, c.phone, c.extra_data, c.raw_data, c.owner_user_id, c.campaign_id
                    FROM contacts c WHERE c.provider_call_id = ?
                    LIMIT 1
                `, [callUuid]);
            }
            if (!activeItem && phone) {
                activeItem = await db.get(`
                    SELECT cq.service, cq.contact_id, cq.campaign_id, c.name, c.phone, c.extra_data, c.raw_data, c.owner_user_id
                    FROM call_queue cq
                    JOIN contacts c ON cq.contact_id = c.id
                    WHERE cq.status IN ('IN_PROGRESS', 'QUEUED') AND (c.phone LIKE ? OR c.phone LIKE ?)
                    ORDER BY cq.updated_at DESC LIMIT 1
                `, [`%${phone.slice(-10)}%`, `%${phone}%`]);
            }
            if (!activeItem) {
                activeItem = await db.get(`
                    SELECT cq.service, cq.contact_id, cq.campaign_id, c.name, c.phone, c.extra_data, c.raw_data, c.owner_user_id
                    FROM call_queue cq
                    JOIN contacts c ON cq.contact_id = c.id
                    WHERE cq.status = 'IN_PROGRESS'
                    ORDER BY cq.updated_at DESC LIMIT 1
                `);
            }
            if (activeItem) {
                if (activeItem.service) service = activeItem.service.toLowerCase();
                if (!contactId && activeItem.contact_id) contactId = activeItem.contact_id;
                if (!name && activeItem.name) name = activeItem.name;
                if (!phone && activeItem.phone) phone = activeItem.phone;
                if (!ownerId && activeItem.owner_user_id) ownerId = activeItem.owner_user_id;
                if (!campaignId && activeItem.campaign_id) campaignId = activeItem.campaign_id;

                let parsed = {};
                try { parsed = JSON.parse(activeItem.raw_data || activeItem.extra_data || '{}'); } catch {}
                if (!role && (parsed.role || parsed.job_role || parsed.jobRole || parsed.title)) {
                    role = parsed.role || parsed.job_role || parsed.jobRole || parsed.title;
                }
                if (!company && (parsed.company || parsed.companyName || parsed.company_name)) {
                    company = parsed.company || parsed.companyName || parsed.company_name;
                }
            }
        } catch (qErr) {
            console.warn('[Plivo Answer] Queue resolution warning:', qErr.message);
        }
    }

    if (!service) {
        service = 'recruitment';
    }

    // Appointment-setting and receptionist agents decide how their calls are handled, whatever the contact sheet says.
    if (AgentService.decidesService(agent, direction)) service = agent.service;

    // When dialling, Plivo gives back a request ID, which is what the queue saved. The live call has its own CallUUID,
    // and Plivo's status and hangup webhooks use that one. Save it now so those webhooks can find this contact.
    if (contactId && callUuid) {
        try {
            await db.run('UPDATE contacts SET provider_call_id = ? WHERE id = ?', [callUuid, contactId]);
        } catch (idErr) {
            console.warn('[Plivo Answer] Could not save the live call ID:', idErr.message);
        }
    }

    console.log(`[Plivo Answer] Active CallUUID: ${callUuid}, Contact: ${name || phone} (${contactId || 'unknown'}), Service: ${service.toUpperCase()}, Campaign: ${campaignId || 'none'}`);

    const cfg = PlivoService.getConfig();
    const serverUrl = cfg.serverUrl || 'https://takeremo.com';
    const wsBaseUrl = serverUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    
    // Embed parameters directly in the WebSocket URL so the stream connection has complete context immediately
    const wsParams = new URLSearchParams({
        callId: String(callUuid || ''),
        contactId: String(contactId || ''),
        service: String(service || 'recruitment'),
        ownerId: String(ownerId || ''),
        phone: String(phone || ''),
        name: String(name || ''),
        role: String(role || ''),
        company: String(company || ''),
        campaignId: String(campaignId || ''),
        agentId: String(agentId || ''),
        direction,
        callMode: String(callMode || 'STANDARD')
    });
    const streamWsUrl = `${wsBaseUrl}/voicebot?${wsParams.toString()}`;
    const extraHeaders = `callId=${callUuid},contactId=${contactId},service=${service},ownerId=${ownerId},phone=${phone},name=${encodeURIComponent(name)},role=${encodeURIComponent(role)},company=${encodeURIComponent(company)},campaignId=${campaignId},agentId=${agentId},direction=${direction},callMode=${callMode}`;

    const xml = PlivoService.generateAnswerXml(streamWsUrl, extraHeaders);
    res.set('Content-Type', 'text/xml');
    res.status(200).send(xml);
}

export async function handlePlivoStatus(req, res) {
    const body = { ...(req.query || {}), ...(req.body || {}) };
    const callUuid = body.CallUUID || body.call_uuid || body.RequestUUID || body.request_uuid || '';
    const status = String(body.CallStatus || body.Status || body.status || '').toLowerCase();

    console.log(`[Plivo Status] CallUUID: ${callUuid}, Status: ${status}`);
    if (!callUuid) console.log('[Plivo Status] No call ID in this webhook. Fields received:', Object.keys(body).join(', ') || '(none)');

    if (callUuid) {
        try {
            const now = utcNow();
            // Only statuses we understand change anything. A status we do not know (empty, "ringing", "cancel"...)
            // must never move a call backwards.
            let dbStatus = null;
            if (['in-progress', 'answered'].includes(status)) dbStatus = 'in-progress';
            else if (['completed'].includes(status)) dbStatus = 'COMPLETED';
            else if (['busy', 'no-answer', 'timeout'].includes(status)) dbStatus = 'UNANSWERED';
            else if (['failed', 'rejected'].includes(status)) dbStatus = 'FAILED';

            if (!dbStatus) {
                if (status) console.log(`[Plivo Status] Status "${status}" needs no change.`);
            } else {
                // Why it ended, so the call history can explain a failed or unanswered call.
                const cause = String(body.HangupCauseName || body.HangupCause || '').trim();
                const reason = ['FAILED', 'UNANSWERED'].includes(dbStatus)
                    ? `Plivo reported "${status}"${cause ? ` (${cause})` : ''}` : '';

                // Sync demo call tracking if this was an instant promotional demo call
                updateDemoCallStatus(callUuid, dbStatus);

                // A call that has already finished (completed, failed, unanswered, cancelled) keeps its result.
                const res1 = await db.run(
                    `UPDATE contacts SET call_status = ?, error_details = CASE WHEN ? <> '' THEN ? ELSE error_details END, updated_at = ?
                     WHERE provider_call_id = ? AND call_status IN ('PENDING', 'CALLING', 'in-progress')`,
                    [dbStatus, reason, reason, now, callUuid]
                );

                if (res1 && res1.changes > 0 && ['COMPLETED', 'FAILED', 'UNANSWERED'].includes(dbStatus)) {
                    await db.run(
                        `UPDATE call_queue SET status = ?, updated_at = ? WHERE contact_id IN (SELECT id FROM contacts WHERE provider_call_id = ?)`,
                        [dbStatus, now, callUuid]
                    );
                }
            }
        } catch (e) {
            console.error('[Plivo Status] DB update error:', e.message);
        }
    }

    res.status(200).send('OK');
}

export async function handlePlivoHangup(req, res) {
    const body = { ...(req.query || {}), ...(req.body || {}) };
    const callUuid = body.CallUUID || body.call_uuid || body.RequestUUID || body.request_uuid || '';
    // Seconds the call was actually connected (BillDuration), falling back to the total length.
    const talked = parseInt(body.BillDuration || body.billduration || '', 10);
    const duration = Number.isFinite(talked) ? talked : (parseInt(body.Duration || body.duration || body.CallDuration || '0', 10) || 0);
    const cause = String(body.HangupCauseName || body.HangupCause || '').trim();

    console.log(`[Plivo Hangup] CallUUID: ${callUuid}, Duration: ${duration}s${cause ? `, Cause: ${cause}` : ''}`);
    if (!callUuid) console.log('[Plivo Hangup] No call ID in this webhook. Fields received:', Object.keys(body).join(', ') || '(none)');

    if (callUuid) {
        try {
            const now = utcNow();
            updateDemoCallStatus(callUuid, 'COMPLETED');
            const row = await db.get('SELECT id, call_status FROM contacts WHERE provider_call_id = ?', [callUuid]);
            if (row) {
                const open = ['PENDING', 'CALLING', 'in-progress'].includes(row.call_status);
                if (duration > 0) {
                    // The call connected. Finish it, unless it already has a result (failed, unanswered...).
                    await db.run(
                        `UPDATE contacts SET call_status = CASE WHEN call_status IN ('PENDING', 'CALLING', 'in-progress') THEN 'COMPLETED' ELSE call_status END,
                         ended_at = ?, duration_seconds = ?, updated_at = ? WHERE id = ?`,
                        [now, duration, now, row.id]
                    );
                    await db.run(
                        `UPDATE conversations SET duration_seconds = ?, ended_at = ? WHERE contact_id = ?`,
                        [duration, now, row.id]
                    );
                    if (open) {
                        await db.run(`UPDATE call_queue SET status = 'COMPLETED', updated_at = ? WHERE contact_id = ?`, [now, row.id]);
                    }
                } else if (open) {
                    // It ended without ever connecting: nobody picked up, or the call was dropped. Say so.
                    const note = `The call ended before it was answered${cause ? ` (${cause})` : ''}`;
                    await db.run(
                        `UPDATE contacts SET call_status = 'UNANSWERED', error_details = ?, ended_at = ?, updated_at = ? WHERE id = ?`,
                        [note, now, now, row.id]
                    );
                    await db.run(`UPDATE call_queue SET status = 'UNANSWERED', updated_at = ? WHERE contact_id = ?`, [now, row.id]);
                } else {
                    await db.run(`UPDATE contacts SET ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?`, [now, now, row.id]);
                }
            }
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
