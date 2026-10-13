import db from './db.js';
import { readUsers } from '../users_store.js';
import { CallQueueWorker } from './call_queue_worker.js';

export default class AdminService {
    static async getDashboardStats(ownerId = null) {
        // ownerId: count only the contact sheets (and calls) uploaded by / assigned to this admin
        const mine = ownerId ? ` WHERE batch_id IN (SELECT id FROM batches WHERE owner_user_id = ?)` : '';
        const mineAnd = ownerId ? ` AND batch_id IN (SELECT id FROM batches WHERE owner_user_id = ?)` : '';
        const mineParams = ownerId ? [ownerId] : [];
        let userCount = 0;
        try {
            userCount = ownerId ? 1 : readUsers().length; // an admin only sees their own account
        } catch (e) {}

        const contactsRow = (await db.get(`
            SELECT
                COUNT(*) as total_contacts,
                SUM(CASE WHEN call_status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_calls,
                SUM(CASE WHEN call_status IN ('CALLING', 'in-progress') THEN 1 ELSE 0 END) as active_calls,
                SUM(CASE WHEN call_status IN ('FAILED', 'UNANSWERED') THEN 1 ELSE 0 END) as failed_calls,
                SUM(CASE WHEN call_status = 'PENDING' AND validation_status = 'VALID' THEN 1 ELSE 0 END) as pending_calls,
                SUM(CASE WHEN call_status = 'SKIPPED' OR validation_status = 'INVALID' THEN 1 ELSE 0 END) as skipped_calls,
                SUM(CASE WHEN service = 'recruitment' THEN 1 ELSE 0 END) as rec_count,
                SUM(CASE WHEN service = 'sales' THEN 1 ELSE 0 END) as sales_count,
                SUM(CASE WHEN service = 'support' THEN 1 ELSE 0 END) as support_count,
                SUM(CASE WHEN classification LIKE '%Accepted%' OR classification LIKE '%Shortlisted%' THEN 1 ELSE 0 END) as accepted_count,
                SUM(CASE WHEN classification LIKE '%Rejected%' THEN 1 ELSE 0 END) as rejected_count,
                SUM(CASE WHEN classification LIKE '%Hold%' THEN 1 ELSE 0 END) as on_hold_count,
                SUM(duration_seconds) as total_duration
            FROM contacts${mine}
        `, mineParams)) || {};

        const dbTotalContacts = Number(contactsRow.total_contacts) || 0;
        const dbCompleted = Number(contactsRow.completed_calls) || 0;
        const dbActive = Number(contactsRow.active_calls) || 0;
        const dbFailed = Number(contactsRow.failed_calls) || 0;
        const dbPending = Number(contactsRow.pending_calls) || 0;
        const dbSkipped = Number(contactsRow.skipped_calls) || 0;
        const dbRec = Number(contactsRow.rec_count) || 0;
        const dbSales = Number(contactsRow.sales_count) || 0;
        const dbSupport = Number(contactsRow.support_count) || 0;
        const dbAccepted = Number(contactsRow.accepted_count) || 0;
        const dbRejected = Number(contactsRow.rejected_count) || 0;
        const dbOnHold = Number(contactsRow.on_hold_count) || 0;
        const dbDuration = Number(contactsRow.total_duration) || 0;

        const totalCalls = dbCompleted + dbActive + dbFailed;
        const activeCalls = dbActive;
        const completedCalls = dbCompleted;

        const servicesData = {};
        for (const s of ['recruitment', 'sales', 'support']) {
            const sRow = (await db.get(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN validation_status = 'VALID' THEN 1 ELSE 0 END) as valid,
                    SUM(CASE WHEN validation_status = 'INVALID' THEN 1 ELSE 0 END) as invalid,
                    SUM(CASE WHEN call_status = 'PENDING' AND validation_status = 'VALID' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN call_status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN call_status IN ('FAILED', 'UNANSWERED') THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN call_status IN ('CALLING', 'in-progress') THEN 1 ELSE 0 END) as in_progress,
                    SUM(CASE WHEN call_status = 'SKIPPED' THEN 1 ELSE 0 END) as skipped
                FROM contacts
                WHERE service = ?${mineAnd}
            `, [s, ...mineParams])) || {};

            const latestBatch = await db.get(`
                SELECT filename, status, updated_at
                FROM batches
                WHERE service = ?${ownerId ? ' AND owner_user_id = ?' : ''}
                ORDER BY created_at DESC
                LIMIT 1
            `, ownerId ? [s, ownerId] : [s]);

            servicesData[s] = {
                total: Number(sRow.total) || 0,
                valid: Number(sRow.valid) || 0,
                invalid: Number(sRow.invalid) || 0,
                pending: Number(sRow.pending) || 0,
                completed: Number(sRow.completed) || 0,
                failed: Number(sRow.failed) || 0,
                inProgress: Number(sRow.in_progress) || 0,
                skipped: Number(sRow.skipped) || 0,
                latestFile: latestBatch ? latestBatch.filename : null,
                batchStatus: latestBatch ? latestBatch.status : "NO_BATCH",
                updatedAt: latestBatch ? latestBatch.updated_at : null
            };
        }

        let queueStatus = { active: false, queueLength: 0 };
        try {
            queueStatus = await CallQueueWorker.getQueueStatus(null, ownerId);
        } catch (e) {}

        const hoursSaved = Math.round(((dbDuration / 3600.0) + (dbCompleted * 0.15)) * 10) / 10;
        const avgSec = dbCompleted ? Math.round(dbDuration / dbCompleted) : 0;
        const avgCallDuration = `${String(Math.floor(avgSec / 60)).padStart(2, '0')}:${String(avgSec % 60).padStart(2, '0')}`;

        const sentimentRow = (await db.get(`
            SELECT COUNT(*) AS total, SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) AS positive
            FROM conversations${ownerId ? ` WHERE owner_user_id = ? OR contact_id IN (SELECT id FROM contacts WHERE batch_id IN (SELECT id FROM batches WHERE owner_user_id = ?))` : ''}
        `, ownerId ? [ownerId, ownerId] : [])) || {};
        const sentimentTotal = Number(sentimentRow.total) || 0;
        const satisfactionRate = sentimentTotal ? Math.round((Number(sentimentRow.positive) / sentimentTotal) * 1000) / 10 : null;

        return {
            totalUsers: userCount,
            totalContacts: dbTotalContacts,
            totalCalls,
            activeCalls,
            completedCalls,
            failedCalls: dbFailed,
            pendingCalls: dbPending,
            skippedCalls: dbSkipped,
            recruitmentCalls: servicesData.recruitment.completed + servicesData.recruitment.inProgress,
            salesCalls: servicesData.sales.completed + servicesData.sales.inProgress,
            supportCalls: servicesData.support.completed + servicesData.support.inProgress,
            acceptedCount: dbAccepted,
            rejectedCount: dbRejected,
            onHoldCount: dbOnHold,
            hoursSaved,
            avgCallDuration,
            satisfactionRate,
            services: servicesData,
            queue: queueStatus
        };
    }

    static getUsers(page = 1, limit = 10, search = "", status = "") {
        const mockUsers = [
            { id: "usr_adm_001", name: "Sarah Jenkins", email: "sarah.j@apexsystems.com", company: "Apex Systems Group", role: "admin", services: ["recruitment", "sales"], totalCalls: 84, activeCalls: 2, lastActivity: "2026-10-05T10:15:00Z", status: "active" },
            { id: "usr_adm_002", name: "David Miller", email: "david.m@cloudcorp.io", company: "CloudCorp Logistics", role: "admin", services: ["sales"], totalCalls: 62, activeCalls: 1, lastActivity: "2026-10-05T09:42:00Z", status: "active" },
            { id: "usr_adm_003", name: "Priya Sharma", email: "priya.s@talentbridge.co", company: "TalentBridge Staffing", role: "admin", services: ["recruitment"], totalCalls: 115, activeCalls: 3, lastActivity: "2026-10-05T10:04:00Z", status: "active" },
            { id: "usr_adm_004", name: "Marcus Vance", email: "marcus.v@healthreach.org", company: "HealthReach Network", role: "admin", services: ["support"], totalCalls: 41, activeCalls: 0, lastActivity: "2026-10-04T16:20:00Z", status: "active" },
            { id: "usr_adm_005", name: "Elena Rostova", email: "elena.r@fintechscale.com", company: "FinTech Scale", role: "admin", services: ["sales", "support"], totalCalls: 28, activeCalls: 1, lastActivity: "2026-10-05T08:50:00Z", status: "active" },
            { id: "usr_adm_006", name: "Jordan Lee", email: "jordan.lee@retailautomate.com", company: "Retail Automate", role: "user", services: ["support"], totalCalls: 12, activeCalls: 0, lastActivity: "2026-10-03T11:10:00Z", status: "inactive" }
        ];

        try {
            const realUsers = readUsers();
            for (const ru of realUsers) {
                if (!mockUsers.find(u => u.email.toLowerCase() === (ru.email || "").toLowerCase())) {
                    mockUsers.push({
                        id: ru.id,
                        name: ru.name || "User",
                        email: ru.email || "",
                        company: ru.companyName || "Score Labs Workspace",
                        role: ru.role || "admin",
                        services: ["recruitment", "sales", "support"],
                        totalCalls: 8,
                        activeCalls: 0,
                        lastActivity: ru.updatedAt || ru.createdAt,
                        status: ru.profileCompleted ? "active" : "pending"
                    });
                }
            }
        } catch (e) {}

        let filtered = mockUsers;
        if (search) {
            const q = search.trim().toLowerCase();
            filtered = filtered.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.company.toLowerCase().includes(q));
        }

        if (status) {
            const s = status.trim().toLowerCase();
            filtered = filtered.filter(u => u.status.toLowerCase() === s);
        }

        const totalCount = filtered.length;
        const p = Math.max(parseInt(page, 10) || 1, 1);
        const l = Math.max(Math.min(parseInt(limit, 10) || 10, 100), 1);
        const totalPages = Math.max(Math.ceil(totalCount / l), 1);

        const startIdx = (p - 1) * l;
        const endIdx = startIdx + l;
        const paginatedUsers = filtered.slice(startIdx, endIdx);

        return {
            users: paginatedUsers,
            data: paginatedUsers,
            pagination: {
                page: p,
                limit: l,
                totalCount,
                total: totalCount,
                totalPages,
                hasMore: p < totalPages
            }
        };
    }
}
