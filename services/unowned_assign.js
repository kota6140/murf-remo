/**
 * One-time helper: gives every campaign, contact sheet, contact and conversation that has no owner
 * to one admin. Admins only see rows they own, so rows without an owner would otherwise be visible
 * to nobody except the owner panel.
 *
 * Safe to run twice: it only touches rows whose owner is empty. Rows that already belong to another
 * admin (directly or through their contact sheet) are left alone.
 */

import { db, ensureOwnerColumns, ensureCampaignSchema } from './db.js';
import { findUserByEmail } from '../users_store.js';

const NO_OWNER = "(owner_user_id IS NULL OR owner_user_id = '')";
const OWNED_BATCH_IDS = "SELECT id FROM batches WHERE owner_user_id IS NOT NULL AND owner_user_id != ''";

const TARGETS = [
    {
        name: 'conversations',
        where: `${NO_OWNER} AND (contact_id IS NULL OR contact_id = ''
            OR contact_id NOT IN (SELECT id FROM contacts WHERE batch_id IN (${OWNED_BATCH_IDS})))`
    },
    {
        name: 'contacts',
        where: `${NO_OWNER} AND (batch_id IS NULL OR batch_id = '' OR batch_id NOT IN (${OWNED_BATCH_IDS}))`
    },
    { name: 'batches', where: NO_OWNER },
    { name: 'campaigns', where: NO_OWNER }
];

/**
 * Counts (and, with apply, updates) the unowned rows for one admin id.
 * @returns {Promise<Record<string, number>>} rows found per table
 */
export async function assignUnownedRows(adminId, { apply = false } = {}) {
    const counts = {};
    for (const t of TARGETS) {
        const row = await db.get(`SELECT COUNT(*) AS n FROM ${t.name} WHERE ${t.where}`);
        counts[t.name] = Number(row?.n) || 0;
    }

    if (apply) {
        for (const t of TARGETS) {
            if (counts[t.name] > 0) {
                await db.run(`UPDATE ${t.name} SET owner_user_id = ? WHERE ${t.where}`, [adminId]);
            }
        }
    }
    return counts;
}

/**
 * @param {string} email   email of the admin who receives the rows
 * @param {{apply?: boolean}} options   apply=false only counts (dry run)
 * @returns {Promise<{adminId: string, counts: Record<string, number>, applied: boolean}>}
 */
export async function assignUnownedToAdmin(email, { apply = false } = {}) {
    const admin = findUserByEmail(String(email || '').trim().toLowerCase());
    if (!admin) throw new Error(`No user found with email ${email}.`);
    if ((admin.role || 'user').trim().toLowerCase() !== 'admin') {
        throw new Error(`${email} is not an admin account.`);
    }

    await ensureOwnerColumns();
    await ensureCampaignSchema();

    const counts = await assignUnownedRows(admin.id, { apply });
    return { adminId: admin.id, counts, applied: apply };
}
