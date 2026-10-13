/**
 * routes/auth.js
 * Authentication routes: signup, OTP verify, login, logout, forgot-password,
 * reset-password, profile, onboarding, /me.
 *
 * Re-created to fix missing module. Preserves ALL existing business logic
 * from users_store.js and the auth middleware.
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { sendEmail, escapeHtml } from '../services/email_service.js';
import {
    findUserByEmail,
    findUserById,
    createUser,
    setResetToken,
    findUserByResetToken,
    updateUserPassword,
    updateUserProfile,
    readUsers
} from '../users_store.js';
import { authenticateJwt, getJwtSecret } from '../middleware/auth.js';

const router = express.Router();

// ============================================================================
// In-memory pending signups (email → { name, hash, otp, expires })
// ============================================================================
const pendingSignups = new Map();
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 45 * 1000; // 45 seconds

function generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

// ============================================================================
// POST /api/auth/signup  — Step 1: email OTP
// ============================================================================
router.post('/signup', async (req, res) => {
    const { name, email, password, confirmPassword } = req.body || {};

    if (!name || !email || !password) {
        return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }
    if (password !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }
    const emailNorm = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
        return res.status(400).json({ success: false, message: 'Invalid email address.' });
    }

    const existing = findUserByEmail(emailNorm);
    if (existing) {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    // Resend cooldown
    const prev = pendingSignups.get(emailNorm);
    if (prev && prev.lastSent && (Date.now() - prev.lastSent) < RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - prev.lastSent)) / 1000);
        return res.status(429).json({ success: false, message: `Please wait ${wait}s before requesting another code.`, retryAfterSec: wait });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const otp = generateOtp();
    const expires = Date.now() + OTP_TTL_MS;

    pendingSignups.set(emailNorm, { name: name.trim(), hash: passwordHash, otp, expires, lastSent: Date.now() });

    // Send OTP email (non-blocking — don't fail signup if email delivery fails)
    sendEmail({
        to: emailNorm,
        subject: 'Verify Your TakeRemo Account',
        html: `
            <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
                <h2 style="color:#061A45;">Verify Your Email</h2>
                <p>Hi ${escapeHtml(name.trim())},</p>
                <p>Your TakeRemo verification code is:</p>
                <div style="font-size:2rem;font-weight:800;letter-spacing:6px;color:#FF2B20;text-align:center;padding:20px 0;">${otp}</div>
                <p style="color:#64748B;font-size:0.9rem;">This code expires in 10 minutes.</p>
                <p style="color:#64748B;font-size:0.85rem;">If you did not request this, please ignore this email.</p>
                <hr style="border:none;border-top:1px solid #E2E8F0;margin:20px 0;">
                <p style="color:#94A3B8;font-size:0.8rem;">Team TakeRemo · AI Calling. Human Conversations. Real Results.</p>
            </div>`
    }).catch(() => {});

    return res.status(200).json({
        success: true,
        message: `A 6-digit verification code has been sent to ${emailNorm}.`,
        email: emailNorm
    });
});

// ============================================================================
// POST /api/auth/signup/verify  — Step 2: verify OTP → create account
// ============================================================================
router.post('/signup/verify', async (req, res) => {
    const { email, otp } = req.body || {};
    const emailNorm = (email || '').trim().toLowerCase();
    const pending = pendingSignups.get(emailNorm);

    if (!pending) {
        return res.status(400).json({ success: false, message: 'No pending signup found. Please start signup again.', expired: true });
    }
    if (Date.now() > pending.expires) {
        pendingSignups.delete(emailNorm);
        return res.status(400).json({ success: false, message: 'Verification code has expired. Please start signup again.', expired: true });
    }
    if (String(otp).trim() !== pending.otp) {
        return res.status(400).json({ success: false, message: 'Incorrect verification code. Please try again.' });
    }

    try {
        const user = createUser(pending.name, emailNorm, pending.hash);
        pendingSignups.delete(emailNorm);

        const token = jwt.sign({ id: user.id }, getJwtSecret(), { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

        res.cookie('agent_hari_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.status(201).json({ success: true, message: 'Account created successfully!', user });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

// ============================================================================
// POST /api/auth/signup/resend
// ============================================================================
router.post('/signup/resend', async (req, res) => {
    const { email } = req.body || {};
    const emailNorm = (email || '').trim().toLowerCase();
    const pending = pendingSignups.get(emailNorm);

    if (!pending) {
        return res.status(400).json({ success: false, message: 'No pending signup found. Please start signup again.', expired: true });
    }

    const cooldown = RESEND_COOLDOWN_MS - (Date.now() - (pending.lastSent || 0));
    if (cooldown > 0) {
        const wait = Math.ceil(cooldown / 1000);
        return res.status(429).json({ success: false, message: `Please wait ${wait}s.`, retryAfterSec: wait });
    }

    const otp = generateOtp();
    pending.otp = otp;
    pending.expires = Date.now() + OTP_TTL_MS;
    pending.lastSent = Date.now();
    pendingSignups.set(emailNorm, pending);

    sendEmail({
        to: emailNorm,
        subject: 'Your New TakeRemo Verification Code',
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;"><h2 style="color:#061A45;">New Verification Code</h2><p>Your new code is:</p><div style="font-size:2rem;font-weight:800;letter-spacing:6px;color:#FF2B20;text-align:center;padding:20px 0;">${otp}</div><p style="color:#64748B;font-size:0.9rem;">This code expires in 10 minutes.</p></div>`
    }).catch(() => {});

    return res.status(200).json({ success: true, message: `A new code has been sent to ${emailNorm}.`, email: emailNorm });
});

// ============================================================================
// POST /api/auth/login
// ============================================================================
router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = findUserByEmail(email.trim().toLowerCase());
    if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash || '');
    if (!valid) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (user.disabled) {
        return res.status(403).json({ success: false, message: 'This account has been suspended. Please contact support.' });
    }

    const userRole = (user.role || 'user').trim().toLowerCase();

    const token = jwt.sign({ id: user.id }, getJwtSecret(), { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

    res.cookie('agent_hari_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(200).json({
        success: true,
        message: 'Login successful.',
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone || '',
            companyName: user.companyName || '',
            jobTitle: user.jobTitle || '',
            industry: user.industry || '',
            profileCompleted: !!user.profileCompleted,
            role: userRole
        }
    });
});

// ============================================================================
// POST /api/auth/logout
// ============================================================================
router.post('/logout', (req, res) => {
    res.clearCookie('agent_hari_token');
    return res.status(200).json({ success: true, message: 'Logged out successfully.' });
});

// ============================================================================
// GET /api/auth/me
// ============================================================================
router.get('/me', authenticateJwt, (req, res) => {
    return res.status(200).json({ success: true, user: req.user });
});

// ============================================================================
// POST /api/auth/forgot-password  — send reset OTP
// ============================================================================
const resetOtps = new Map(); // email → { otp, expires, lastSent }

router.post('/forgot-password', async (req, res) => {
    const { email } = req.body || {};
    const emailNorm = (email || '').trim().toLowerCase();

    // Always respond the same to prevent user enumeration
    const genericMsg = `If an account exists for ${emailNorm}, a 6-digit reset code has been sent.`;

    const user = findUserByEmail(emailNorm);
    if (!user) {
        return res.status(200).json({ success: true, message: genericMsg, email: emailNorm });
    }

    const prev = resetOtps.get(emailNorm);
    if (prev && (Date.now() - (prev.lastSent || 0)) < RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - prev.lastSent)) / 1000);
        return res.status(429).json({ success: false, message: `Please wait ${wait}s.`, retryAfterSec: wait });
    }

    const otp = generateOtp();
    const expires = Date.now() + OTP_TTL_MS;
    resetOtps.set(emailNorm, { otp, expires, lastSent: Date.now() });

    setResetToken(emailNorm, otp, expires);

    sendEmail({
        to: emailNorm,
        subject: 'TakeRemo Password Reset Code',
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;"><h2 style="color:#061A45;">Reset Your Password</h2><p>Hi ${escapeHtml(user.name)},</p><p>Your password reset code is:</p><div style="font-size:2rem;font-weight:800;letter-spacing:6px;color:#FF2B20;text-align:center;padding:20px 0;">${otp}</div><p style="color:#64748B;font-size:0.9rem;">This code expires in 10 minutes. If you did not request this, ignore this email.</p></div>`
    }).catch(() => {});

    return res.status(200).json({ success: true, message: genericMsg, email: emailNorm });
});

// ============================================================================
// POST /api/auth/reset-password
// ============================================================================
router.post('/reset-password', async (req, res) => {
    const { email, otp, newPassword, confirmPassword } = req.body || {};
    const emailNorm = (email || '').trim().toLowerCase();

    if (!otp || !newPassword) {
        return res.status(400).json({ success: false, message: 'Code and new password are required.' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const record = resetOtps.get(emailNorm);
    const user = findUserByResetToken(otp);

    if (!record || String(otp) !== record.otp || Date.now() > record.expires || !user) {
        return res.status(400).json({ success: false, message: 'Invalid or expired reset code.', expired: true });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    updateUserPassword(user.id, hash);
    resetOtps.delete(emailNorm);

    return res.status(200).json({ success: true, message: 'Password reset successfully.' });
});

// ============================================================================
// POST /api/auth/onboarding
// ============================================================================
router.post('/onboarding', authenticateJwt, (req, res) => {
    const { companyName, phone, jobTitle, companySize, industry } = req.body || {};
    try {
        const updated = updateUserProfile(req.user.id, { companyName, phone, jobTitle, companySize, industry });
        return res.status(200).json({ success: true, message: 'Profile completed.', user: updated });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

// ============================================================================
// PUT /api/auth/profile
// ============================================================================
router.put('/profile', authenticateJwt, (req, res) => {
    const { name, companyName, phone, jobTitle, companySize, industry } = req.body || {};
    try {
        const updated = updateUserProfile(req.user.id, { name, companyName, phone, jobTitle, companySize, industry });
        return res.status(200).json({ success: true, message: 'Profile updated.', user: updated });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

export default router;
