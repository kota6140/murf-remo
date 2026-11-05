/**
 * Calling minutes the owner gives to an admin.
 *
 * The owner sets `minutesAllotted` on the admin's account. Minutes are never unlimited: an admin with no minutes
 * assigned has 0 and cannot start campaigns or calls until the owner gives some. Minutes used = the length of the
 * admin's conversations (owned directly or through their contact sheets) made after the owner last gave minutes.
 * When the used time reaches the allotment the admin can no longer start campaigns or calls, and the call queue
 * skips their waiting contacts.
 */
import db from './db.js';
import { readUsers } from '../users_store.js';

export const MINUTES_EXHAUSTED_MESSAGE =
    'Your assigned calling minutes have finished (or none have been assigned yet). Please contact support or the owner to get more minutes.';

// Seconds of conversation per admin id: { [userId]: seconds }
async function usedSecondsByUser(userId = null) {
    const rows = await db.all(`
        SELECT COALESCE(c.owner_user_id, b.owner_user_id) AS uid, SUM(c.duration_seconds) AS secs
        FROM conversations c
        LEFT JOIN contacts ct ON c.contact_id = ct.id
        LEFT JOIN batches b ON b.id = ct.batch_id
        WHERE COALESCE(c.owner_user_id, b.owner_user_id) IS NOT NULL
        ${userId ? 'AND COALESCE(c.owner_user_id, b.owner_user_id) = ?' : ''}
        GROUP BY COALESCE(c.owner_user_id, b.owner_user_id)
    `, userId ? [userId] : []);
    const map = {};
    for (const r of rows) map[r.uid] = Number(r.secs) || 0;
    return map;
}

// The minutes the owner gave one account. Minutes are never unlimited: nothing assigned means 0.
export function allottedMinutes(user) {
    const n = Number(user && user.minutesAllotted);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

// Only calls made AFTER the owner last gave minutes count: `minutesBaseSeconds` is the account's total call time
// at that moment, and everything before it is ignored.
export function describe(user, totalSeconds) {
    const base = Number(user && user.minutesBaseSeconds) || 0;
    const usedSeconds = Math.max(0, totalSeconds - base);
    const allotted = allottedMinutes(user);
    const usedMinutes = Math.round((usedSeconds / 60) * 10) / 10;
    const remaining = Math.max(0, Math.round((allotted - usedSeconds / 60) * 10) / 10);
    return { unlimited: false, allottedMinutes: allotted, usedMinutes, usedSeconds, totalSeconds, remainingMinutes: remaining, exhausted: usedSeconds >= allotted * 60 };
}

export const MinutesService = {
    // Status for one account id.
    async statusFor(userId) {
        const user = readUsers().find(u => u.id === userId);
        if (!user) return describe(user, 0);
        const used = await usedSecondsByUser(userId);
        return describe(user, used[userId] || 0);
    },

    // Status for every given user (owner panel list): { [userId]: status }
    async statusForUsers(users) {
        const used = await usedSecondsByUser();
        return Object.fromEntries(users.map(u => [u.id, describe(u, used[u.id] || 0)]));
    },

    async isExhausted(userId) {
        if (!userId) return false;
        try { return (await this.statusFor(userId)).exhausted; }
        catch (e) { console.error('[Minutes] check failed, allowing the call:', e.message); return false; }
    }
};

// Express guard: stops an admin whose minutes are finished from starting campaigns or calls.
export async function requireMinutes(req, res, next) {
    if (!(await MinutesService.isExhausted(req.user && req.user.id))) return next();
    return res.status(403).json({ success: false, code: 'MINUTES_EXHAUSTED', message: MINUTES_EXHAUSTED_MESSAGE });
}

export default MinutesService;
