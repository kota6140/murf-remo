/**
 * routes/user.js
 * User-only API routes for the TakeRemo User Dashboard.
 * - POST /api/user/proposals    — Submit an agent proposal
 * - GET  /api/user/proposals    — Get current user's own proposals
 *
 * Security:
 * - authenticateJwt required on all routes (no admin check)
 * - User ID always taken from JWT (never from request body)
 * - Users can only access their own proposals
 * - File uploads (optional docs) stored securely in data/user_uploads/
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { authenticateJwt } from '../middleware/auth.js';
import { sendEmail, escapeHtml } from '../services/email_service.js';
import { readProposals, writeProposals as saveProposals } from '../proposals_store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const USER_UPLOADS_DIR = path.join(DATA_DIR, 'user_uploads');

// Ensure directories exist
if (!fs.existsSync(USER_UPLOADS_DIR)) fs.mkdirSync(USER_UPLOADS_DIR, { recursive: true });

// ============================================================================
// Proposals are kept in the database (see proposals_store.js)
// ============================================================================
function writeProposals(proposals) {
    try {
        saveProposals(proposals);
        return true;
    } catch (e) {
        console.error('[UserRoutes] Error writing proposals:', e.message);
        return false;
    }
}

// ============================================================================
// Multer for optional document uploads (text documents, PDFs only — no executables)
// ============================================================================
const ALLOWED_DOC_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.xlsx', '.xls', '.csv', '.pptx', '.ppt'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const docStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, USER_UPLOADS_DIR),
    filename: (req, file, cb) => {
        const id = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname).toLowerCase();
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
        cb(null, `doc_${id}_${safeName}`);
    }
});

const docUpload = multer({
    storage: docStorage,
    limits: { fileSize: MAX_FILE_SIZE, files: 5 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_DOC_EXTENSIONS.includes(ext)) {
            return cb(null, true);
        }
        cb(new Error(`File type not allowed: ${ext}. Accepted: ${ALLOWED_DOC_EXTENSIONS.join(', ')}`));
    }
});

const router = express.Router();
router.use(authenticateJwt);

// ============================================================================
// POST /api/user/proposals
// ============================================================================
router.post('/proposals', docUpload.array('documents', 5), async (req, res) => {
    const user = req.user; // Always from JWT — never from body

    const {
        fullName, phone, email, companyName, companyWebsite,
        industry, industryOther, agentType, agentDescription,
        businessBenefit, callVolume, languages, languagesOther,
        documentsText, additionalRequirements, gstNumber, govtId
    } = req.body || {};

    // ── Server-side validation ──────────────────────────────────────────────
    const errors = [];
    if (!fullName || fullName.trim().length < 2) errors.push('Full name is required (at least 2 characters).');
    if (!phone || !/^\+?[\d\s\-().]{7,20}$/.test(phone.trim())) errors.push('Valid phone number is required.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.push('Valid email address is required.');
    if (!companyName || companyName.trim().length < 1) errors.push('Company name is required.');
    if (!govtId || govtId.trim().length < 3) errors.push('Govt ID / Registration number is required.');
    if (!industry) errors.push('Industry is required.');
    if (!agentType) errors.push('Agent type is required.');
    if (!agentDescription || agentDescription.trim().length < 10) errors.push('Agent description must be at least 10 characters.');
    if (!businessBenefit || businessBenefit.trim().length < 10) errors.push('Business benefit description is required.');

    if (errors.length) {
        // Remove any uploaded files on validation failure
        (req.files || []).forEach(f => { try { fs.unlinkSync(f.path); } catch (e) { } });
        return res.status(400).json({ success: false, message: errors[0], errors });
    }

    // ── Deduplicate: check if user already has a pending proposal ───────────
    const existing = readProposals();
    const recentPending = existing.find(p =>
        p.userId === user.id &&
        p.status === 'pending' &&
        (Date.now() - new Date(p.submittedAt).getTime()) < 24 * 60 * 60 * 1000
    );
    if (recentPending) {
        (req.files || []).forEach(f => { try { fs.unlinkSync(f.path); } catch (e) { } });
        return res.status(409).json({
            success: false,
            message: 'You already have a pending proposal submitted in the last 24 hours. Our team will review it and get in touch shortly.'
        });
    }

    // ── Build proposal object ────────────────────────────────────────────────
    const proposalId = 'prop_' + crypto.randomBytes(10).toString('hex');
    const uploadedFiles = (req.files || []).map(f => ({
        originalName: f.originalname,
        storedName: f.filename,
        size: f.size,
        mimetype: f.mimetype
    }));

    // Parse languages array (may come as JSON string or comma-separated)
    let parsedLanguages = [];
    try {
        parsedLanguages = typeof languages === 'string'
            ? (languages.startsWith('[') ? JSON.parse(languages) : languages.split(',').map(l => l.trim()))
            : (Array.isArray(languages) ? languages : []);
    } catch (e) { parsedLanguages = []; }

    const proposal = {
        id: proposalId,
        userId: user.id,          // Always from JWT
        submittedAt: new Date().toISOString(),
        status: 'pending',
        // Form data
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim().toLowerCase(),
        companyName: companyName.trim(),
        companyWebsite: (companyWebsite || '').trim(),
        govtId: (govtId || '').trim(),
        industry: industry === 'Other' ? (industryOther || 'Other').trim() : industry,
        agentType,
        agentDescription: agentDescription.trim(),
        businessBenefit: businessBenefit.trim(),
        callVolume: callVolume || '',
        languages: parsedLanguages,
        languagesOther: (languagesOther || '').trim(),
        documentsText: (documentsText || '').trim(),
        additionalRequirements: (additionalRequirements || '').trim(),
        gstNumber: (gstNumber || '').trim(),
        uploadedFiles
    };

    // ── Save to proposals file ───────────────────────────────────────────────
    const proposals = readProposals();
    proposals.push(proposal);
    const saved = writeProposals(proposals);

    if (!saved) {
        return res.status(500).json({
            success: false,
            message: 'We could not save your proposal due to a server error. Please try again.'
        });
    }

    // ── Send emails (non-blocking — save always succeeds first) ─────────────
    const teamEmail = process.env.EMAIL_USER || 'Reach@takeremo.com';
    const langList = parsedLanguages.length ? parsedLanguages.join(', ') : 'Not specified';
    const gstLine = proposal.gstNumber ? `<tr><td style="padding:6px 8px;color:#64748B;font-weight:600;">GST Number</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.gstNumber)}</td></tr>` : '';
    const govtIdLine = proposal.govtId ? `<tr><td style="padding:6px 8px;color:#64748B;font-weight:600;">Govt / Business ID</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.govtId)}</td></tr>` : '';

    const summaryTableRows = `
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;">Full Name</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.fullName)}</td></tr>
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;">Company</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.companyName)}</td></tr>
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;">Phone</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.phone)}</td></tr>
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;">Email</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.email)}</td></tr>
        ${govtIdLine}
        ${gstLine}
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;">Industry</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.industry)}</td></tr>
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;">Agent Type</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.agentType)}</td></tr>
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;">Company Website</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.companyWebsite || 'Not provided')}</td></tr>
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;">Expected Call Volume</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.callVolume || 'Not specified')}</td></tr>
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;">Preferred Languages</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(langList)}</td></tr>
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;vertical-align:top;">Agent Requirements</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.agentDescription)}</td></tr>
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;vertical-align:top;">Business Benefits</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.businessBenefit)}</td></tr>
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;vertical-align:top;">Required Documents</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.documentsText || 'None specified')}</td></tr>
        <tr><td style="padding:6px 8px;color:#64748B;font-weight:600;vertical-align:top;">Additional Requirements</td><td style="padding:6px 8px;color:#0F172A;">${escapeHtml(proposal.additionalRequirements || 'None')}</td></tr>
    `;

    const baseEmailStyle = `font-family:Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;background:#fff;`;
    const headerStyle = `background:#061A45;padding:28px 32px;border-radius:10px 10px 0 0;`;
    const bodyStyle = `padding:28px 32px;`;
    const footerStyle = `background:#F8FAFC;padding:18px 32px;border-top:1px solid #E2E8F0;border-radius:0 0 10px 10px;`;

    const userEmailHtml = `
    <div style="${baseEmailStyle}">
        <div style="${headerStyle}">
            <h1 style="color:#fff;margin:0;font-size:1.4rem;">Your Agent Remo Proposal Has Been Received!</h1>
            <p style="color:#93C5FD;margin:6px 0 0;">TakeRemo · AI Calling. Human Conversations. Real Results.</p>
        </div>
        <div style="${bodyStyle}">
            <p style="color:#0F172A;">Hi <strong>${escapeHtml(proposal.fullName)}</strong>,</p>
            <p style="color:#475569;">Thank you for choosing TakeRemo!</p>
            <p style="color:#475569;">We have successfully received your proposal for building your AI employee. Our team will review your business requirements and get in touch with you to discuss the next steps.</p>
            <h3 style="color:#061A45;border-bottom:2px solid #FF2B20;padding-bottom:8px;">Your Submission Summary</h3>
            <table style="width:100%;border-collapse:collapse;font-size:0.9rem;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
                ${summaryTableRows}
            </table>
            <div style="background:#FFF5F5;border-left:4px solid #FF2B20;padding:16px 20px;margin:24px 0;border-radius:0 8px 8px 0;">
                <strong style="color:#061A45;font-size:1rem;">What happens next?</strong>
                <p style="color:#475569;margin:8px 0 0;font-size:0.9rem;line-height:1.5;">Our team will review your proposal and contact you within 1–2 business days to understand your requirements and discuss how Agent Remo can help your business.</p>
            </div>
            <p style="color:#475569;">Thank you for your interest in TakeRemo.</p>
            <p style="color:#475569;"><strong>Team TakeRemo</strong><br><em>AI Calling. Human Conversations. Real Results.</em></p>
        </div>
        <div style="${footerStyle}">
            <p style="color:#94A3B8;font-size:0.8rem;margin:0;">© ${new Date().getFullYear()} TakeRemo. All rights reserved. | Proposal ID: ${proposalId}</p>
        </div>
    </div>`;

    const teamEmailHtml = `
    <div style="${baseEmailStyle}">
        <div style="${headerStyle}">
            <h1 style="color:#fff;margin:0;font-size:1.4rem;">New Agent Proposal Received</h1>
            <p style="color:#93C5FD;margin:6px 0 0;">${escapeHtml(proposal.companyName)} — ${escapeHtml(proposal.agentType)}</p>
        </div>
        <div style="${bodyStyle}">
            <p style="color:#0F172A;"><strong>Proposal ID:</strong> ${proposalId}</p>
            <p style="color:#0F172A;"><strong>Submitted:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
            <h3 style="color:#061A45;border-bottom:2px solid #FF2B20;padding-bottom:8px;">Proposal Details</h3>
            <table style="width:100%;border-collapse:collapse;font-size:0.9rem;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
                ${summaryTableRows}
                ${uploadedFiles.length ? `<tr><td style="padding:6px 8px;color:#64748B;font-weight:600;">Uploaded Files</td><td style="padding:6px 8px;color:#0F172A;">${uploadedFiles.map(f => escapeHtml(f.originalName)).join(', ')}</td></tr>` : ''}
            </table>
        </div>
        <div style="${footerStyle}">
            <p style="color:#94A3B8;font-size:0.8rem;margin:0;">User Account: ${escapeHtml(user.email)} · Proposal ID: ${proposalId}</p>
        </div>
    </div>`;

    // Send both emails concurrently — don't wait to respond to user
    let userEmailResult = { success: false };
    let teamEmailResult = { success: false };

    try {
        [userEmailResult, teamEmailResult] = await Promise.all([
            sendEmail({
                to: proposal.email,
                subject: 'Your Agent Remo Proposal Has Been Received – TakeRemo',
                html: userEmailHtml,
                replyTo: teamEmail
            }),
            sendEmail({
                to: teamEmail,
                subject: `New Agent Proposal – ${proposal.companyName} – ${proposal.agentType}`,
                html: teamEmailHtml
            })
        ]);
    } catch (e) {
        console.error('[UserRoutes] Email send error:', e.message);
    }

    const emailNote = userEmailResult.success
        ? "We've also sent a confirmation email with your submitted details to your email address."
        : "Your proposal was saved successfully, but we couldn't send the confirmation email right now. Our team can still review your submission.";

    return res.status(201).json({
        success: true,
        proposalId,
        message: 'Your proposal has been submitted successfully!',
        emailNote,
        emailSent: userEmailResult.success
    });
});

// ============================================================================
// GET /api/user/proposals  — Current user's proposals only
// ============================================================================
router.get('/proposals', (req, res) => {
    const proposals = readProposals()
        .filter(p => p.userId === req.user.id)
        .map(p => ({
            id: p.id,
            status: p.status,
            submittedAt: p.submittedAt,
            companyName: p.companyName,
            agentType: p.agentType,
            industry: p.industry
        }))
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    return res.json({ success: true, data: proposals });
});

export default router;
