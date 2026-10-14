/**
 * Owner admin panel API  —  mounted at /api/owner
 *
 *   POST   /login | /logout     GET /me
 *   GET    /stats
 *   GET    /users               POST /users
 *   PUT    /users/:id           DELETE /users/:id[?deleteSubmissions=1]
 *   GET    /submissions         GET /submissions/:id
 *   PATCH  /submissions/:id     DELETE /submissions/:id
 *   GET    /submissions/:id/files/:stored
 *
 * "Submissions" are the agent-proposal forms customers fill in from their dashboard.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import {
    OWNER_COOKIE, ownerCookieOptions, requireOwner, checkOwnerLogin, signOwnerToken,
    loginLockRemaining, recordLoginFail, clearLoginFails, getOwnerCredentials
} from '../services/owner_auth.js';
import {
    readUsers, publicUser, adminCreateUser, adminUpdateUser, deleteUser, UserStoreError
} from '../users_store.js';
import { readProposals, writeProposals, UPLOADS_DIR } from '../proposals_store.js';
import { readDemoRequests, writeDemoRequests } from '../demo_store.js';
import ownerCalls from './owner_calls.js';

const router = express.Router();
const STATUSES = ['pending', 'in_review', 'approved', 'rejected'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

const fail = (res, code, message) => res.status(code).json({ success: false, message });
const handle = (res, e) => {
    if (e instanceof UserStoreError) return fail(res, e.statusCode, e.message);
    console.error('[OWNER]', e);
    return fail(res, 500, 'Something went wrong.');
};

// ── Auth ────────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
    const ip = clientIp(req);
    const wait = loginLockRemaining(ip);
    if (wait > 0) {
        return fail(res, 429, `Too many failed attempts. Try again in ${Math.ceil(wait / 60000)} minute(s).`);
    }
    const { email, password } = req.body || {};
    if (!getOwnerCredentials().password) {
        return fail(res, 503, 'Admin login is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env.');
    }
    if (!checkOwnerLogin(email, password)) {
        recordLoginFail(ip);
        return fail(res, 401, 'Invalid admin email or password.');
    }
    clearLoginFails(ip);
    res.cookie(OWNER_COOKIE, signOwnerToken(), ownerCookieOptions());
    return res.json({ success: true, email: getOwnerCredentials().email });
});

router.post('/logout', (req, res) => {
    res.clearCookie(OWNER_COOKIE, { path: '/' });
    res.json({ success: true });
});

router.get('/me', requireOwner, (req, res) => res.json({ success: true, email: req.owner.email }));

router.use(requireOwner);
router.use(ownerCalls);

// ── Helpers ─────────────────────────────────────────────────────────────────
function userRow(u, proposals) {
    const mine = proposals.filter(p => p.userId === u.id);
    return {
        ...publicUser(u),
        submissionCount: mine.length,
        lastSubmissionAt: mine.reduce((m, p) => (p.submittedAt > m ? p.submittedAt : m), '') || null
    };
}

function cleanUserFields(body, { requireAll }) {
    const f = {};
    for (const k of ['name', 'email', 'phone', 'companyName', 'jobTitle', 'companySize', 'industry']) {
        if (typeof body[k] === 'string') f[k] = body[k].trim();
    }
    if (body.role !== undefined) f.role = body.role === 'admin' ? 'admin' : 'user';
    if (typeof body.disabled === 'boolean') f.disabled = body.disabled;
    if (requireAll || f.name !== undefined) {
        if (!f.name || f.name.length < 2) return { error: 'Name is required (at least 2 characters).' };
    }
    if (requireAll || f.email !== undefined) {
        if (!f.email || !EMAIL_RE.test(f.email)) return { error: 'A valid email address is required.' };
    }
    return { fields: f };
}

const validPassword = (p) => typeof p === 'string' && p.length >= 6;

// ── Stats ───────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
    const users = readUsers();
    const proposals = readProposals();
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
    proposals.forEach(p => { byStatus[p.status] = (byStatus[p.status] || 0) + 1; });
    const submitters = new Set(proposals.map(p => p.userId));
    res.json({
        success: true,
        stats: {
            totalUsers: users.length,
            activeUsers: users.filter(u => !u.disabled).length,
            disabledUsers: users.filter(u => u.disabled).length,
            profilesCompleted: users.filter(u => u.profileCompleted).length,
            usersWhoSubmitted: users.filter(u => submitters.has(u.id)).length,
            totalSubmissions: proposals.length,
            newSubmissions24h: proposals.filter(p => new Date(p.submittedAt).getTime() > dayAgo).length,
            byStatus
        }
    });
});

// ── Users ───────────────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
    const proposals = readProposals();
    const rows = readUsers()
        .map(u => userRow(u, proposals))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ success: true, users: rows });
});

router.post('/users', async (req, res) => {
    try {
        const body = req.body || {};
        const { fields, error } = cleanUserFields(body, { requireAll: true });
        if (error) return fail(res, 400, error);
        if (!validPassword(body.password)) return fail(res, 400, 'Password must be at least 6 characters.');
        const user = adminCreateUser(fields, await bcrypt.hash(body.password, 12));
        res.status(201).json({ success: true, user: userRow(user, readProposals()) });
    } catch (e) { handle(res, e); }
});

router.put('/users/:id', async (req, res) => {
    try {
        const body = req.body || {};
        const { fields, error } = cleanUserFields(body, { requireAll: false });
        if (error) return fail(res, 400, error);
        let hash = null;
        if (body.password) {
            if (!validPassword(body.password)) return fail(res, 400, 'Password must be at least 6 characters.');
            hash = await bcrypt.hash(body.password, 12);
        }
        const user = adminUpdateUser(req.params.id, fields, hash);
        res.json({ success: true, user: userRow(user, readProposals()) });
    } catch (e) { handle(res, e); }
});

function removeFiles(proposal) {
    for (const f of proposal.uploadedFiles || []) {
        try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(f.storedName))); } catch { /* already gone */ }
    }
}

router.delete('/users/:id', (req, res) => {
    try {
        deleteUser(req.params.id);
        let removed = 0;
        if (req.query.deleteSubmissions === '1') {
            const all = readProposals();
            const keep = all.filter(p => p.userId !== req.params.id);
            all.filter(p => p.userId === req.params.id).forEach(removeFiles);
            removed = all.length - keep.length;
            if (removed) writeProposals(keep);
        }
        res.json({ success: true, removedSubmissions: removed });
    } catch (e) { handle(res, e); }
});

// ── Submissions (agent proposal forms) ──────────────────────────────────────
router.get('/submissions', (req, res) => {
    const usersById = new Map(readUsers().map(u => [u.id, u]));
    const rows = readProposals()
        .map(p => ({ ...p, accountExists: usersById.has(p.userId), accountEmail: usersById.get(p.userId)?.email || null }))
        .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
    res.json({ success: true, submissions: rows });
});

router.get('/submissions/:id', (req, res) => {
    const p = readProposals().find(x => x.id === req.params.id);
    if (!p) return fail(res, 404, 'Submission not found.');
    res.json({ success: true, submission: p });
});

router.patch('/submissions/:id', (req, res) => {
    const all = readProposals();
    const p = all.find(x => x.id === req.params.id);
    if (!p) return fail(res, 404, 'Submission not found.');
    const { status, adminNote } = req.body || {};
    if (status !== undefined) {
        if (!STATUSES.includes(status)) return fail(res, 400, 'Invalid status.');
        p.status = status;
    }
    if (typeof adminNote === 'string') p.adminNote = adminNote.trim().slice(0, 2000);
    p.reviewedAt = new Date().toISOString();
    writeProposals(all);
    res.json({ success: true, submission: p });
});

router.delete('/submissions/:id', (req, res) => {
    const all = readProposals();
    const p = all.find(x => x.id === req.params.id);
    if (!p) return fail(res, 404, 'Submission not found.');
    removeFiles(p);
    writeProposals(all.filter(x => x.id !== p.id));
    res.json({ success: true });
});

// ── 60-second demo requests (public website form) ───────────────────────────
const DEMO_STATUSES = ['new', 'contacted', 'demo_done', 'not_interested'];

router.get('/demo-requests', (req, res) => {
    const rows = readDemoRequests().sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
    res.json({ success: true, requests: rows });
});

router.patch('/demo-requests/:id', (req, res) => {
    const all = readDemoRequests();
    const r = all.find(x => x.id === req.params.id);
    if (!r) return fail(res, 404, 'Demo request not found.');
    const { status, adminNote } = req.body || {};
    if (status !== undefined) {
        if (!DEMO_STATUSES.includes(status)) return fail(res, 400, 'Invalid status.');
        r.status = status;
    }
    if (typeof adminNote === 'string') r.adminNote = adminNote.trim().slice(0, 2000);
    r.reviewedAt = new Date().toISOString();
    writeDemoRequests(all);
    res.json({ success: true, request: r });
});

router.delete('/demo-requests/:id', (req, res) => {
    const all = readDemoRequests();
    if (!all.some(x => x.id === req.params.id)) return fail(res, 404, 'Demo request not found.');
    writeDemoRequests(all.filter(x => x.id !== req.params.id));
    res.json({ success: true });
});

router.get('/submissions/:id/files/:stored', (req, res) => {
    const p = readProposals().find(x => x.id === req.params.id);
    const file = p?.uploadedFiles?.find(f => f.storedName === req.params.stored);
    if (!file) return fail(res, 404, 'File not found.');
    const full = path.join(UPLOADS_DIR, path.basename(file.storedName));
    if (!fs.existsSync(full)) return fail(res, 404, 'File is no longer on disk.');
    res.download(full, file.originalName);
});

export default router;
