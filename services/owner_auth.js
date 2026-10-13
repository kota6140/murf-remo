/**
 * Owner (company admin) authentication for the /admin panel.
 *
 * Credentials live ONLY in .env (ADMIN_EMAIL / ADMIN_PASSWORD). The .env file is
 * re-read on every check, so editing it takes effect immediately with no restart,
 * and any session issued under the old credentials is invalidated automatically.
 * This is fully separate from the normal customer accounts in users.json.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(__dirname, '..', '.env');

export const OWNER_COOKIE = 'takeremo_owner_session';
export const SESSION_HOURS = 8;

export function getOwnerCredentials() {
    let fileEnv = {};
    try { fileEnv = dotenv.parse(fs.readFileSync(ENV_FILE)); } catch { /* no .env file: use process env */ }
    const email = (fileEnv.ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
    const password = fileEnv.ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '';
    return { email, password };
}

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

export function checkOwnerLogin(email, password) {
    const creds = getOwnerCredentials();
    if (!creds.email || !creds.password) return false; // not configured => login disabled
    const emailOk = safeEqual((email || '').trim().toLowerCase(), creds.email);
    const passOk = safeEqual(password || '', creds.password);
    return emailOk && passOk;
}

const secret = () => `${getJwtSecret()}::owner-panel`;
const fingerprint = (c) =>
    crypto.createHmac('sha256', secret()).update(`${c.email}\n${c.password}`).digest('hex').slice(0, 24);

export function signOwnerToken() {
    return jwt.sign({ role: 'owner', fp: fingerprint(getOwnerCredentials()) }, secret(), {
        algorithm: 'HS256',
        expiresIn: `${SESSION_HOURS}h`
    });
}

export function verifyOwnerToken(token) {
    try {
        const creds = getOwnerCredentials();
        if (!creds.email || !creds.password || !token) return null;
        const p = jwt.verify(token, secret(), { algorithms: ['HS256'] });
        if (p.role !== 'owner' || p.fp !== fingerprint(creds)) return null;
        return { email: creds.email };
    } catch {
        return null;
    }
}

export function ownerCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: SESSION_HOURS * 3600 * 1000,
        path: '/'
    };
}

export function requireOwner(req, res, next) {
    const owner = verifyOwnerToken(req.cookies?.[OWNER_COOKIE]);
    if (!owner) return res.status(401).json({ success: false, message: 'Admin sign-in required.' });
    req.owner = owner;
    next();
}

// ── Brute-force protection (in-memory, per IP) ──────────────────────────────
const attempts = new Map();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

export function loginLockRemaining(ip) {
    const a = attempts.get(ip);
    if (!a || !a.lockedUntil) return 0;
    if (a.lockedUntil <= Date.now()) { attempts.delete(ip); return 0; }
    return a.lockedUntil - Date.now();
}
export function recordLoginFail(ip) {
    const a = attempts.get(ip) || { fails: 0, lockedUntil: 0 };
    a.fails += 1;
    if (a.fails >= MAX_FAILS) a.lockedUntil = Date.now() + LOCK_MS;
    attempts.set(ip, a);
}
export function clearLoginFails(ip) { attempts.delete(ip); }
