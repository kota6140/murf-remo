import db, { ensureOwnerColumns } from './db.js';

export default class CallService {
    static _SAMPLE_CALLS = [
        {
            id: "call_101",
            callSid: "CA_89201948ba01",
            service: "recruitment",
            user: "Score Labs",
            callerNumber: "+919876543210",
            callerName: "Rahul Sharma",
            contact: "Rahul Sharma",
            phone: "+919876543210",
            direction: "outbound",
            status: "completed",
            durationSeconds: 272,
            duration: "04:32",
            startedAt: "2026-10-05T09:30:00Z",
            endedAt: "2026-10-05T09:34:32Z",
            conversationId: "conv_001",
            recordingAvailable: false
        },
        {
            id: "call_102",
            callSid: "CA_90118239ca02",
            service: "sales",
            user: "Score Labs",
            callerNumber: "+13125550144",
            callerName: "Tom Bradley",
            contact: "Tom Bradley",
            phone: "+13125550144",
            direction: "outbound",
            status: "completed",
            durationSeconds: 198,
            duration: "03:18",
            startedAt: "2026-10-05T08:15:00Z",
            endedAt: "2026-10-05T08:18:18Z",
            conversationId: "conv_002",
            recordingAvailable: false
        },
        {
            id: "call_103",
            callSid: "CA_77192038da03",
            service: "support",
            user: "Score Labs",
            callerNumber: "+12065550183",
            callerName: "Marcus Vance",
            contact: "Marcus Vance",
            phone: "+12065550183",
            direction: "outbound",
            status: "escalated",
            durationSeconds: 165,
            duration: "02:45",
            startedAt: "2026-10-04T15:20:00Z",
            endedAt: "2026-10-04T15:22:45Z",
            conversationId: "conv_003",
            recordingAvailable: false
        },
        {
            id: "call_104",
            callSid: "CA_66190284ea04",
            service: "recruitment",
            user: "TalentBridge Staffing",
            callerNumber: "+919811223344",
            callerName: "Priya Sharma",
            contact: "Priya Sharma",
            phone: "+919811223344",
            direction: "outbound",
            status: "completed",
            durationSeconds: 112,
            duration: "01:52",
            startedAt: "2026-10-04T11:45:00Z",
            endedAt: "2026-10-04T11:46:52Z",
            conversationId: "conv_004",
            recordingAvailable: false
        },
        {
            id: "call_105",
            callSid: "CA_55190284fa05",
            service: "sales",
            user: "FinTech Scale",
            callerNumber: "+19175550192",
            callerName: "Elena Rostova",
            contact: "Elena Rostova",
            phone: "+19175550192",
            direction: "outbound",
            status: "active",
            durationSeconds: 70,
            duration: "01:10",
            startedAt: "2026-10-05T10:40:00Z",
            endedAt: null,
            conversationId: "conv_005",
            recordingAvailable: false
        },
        {
            id: "call_106",
            callSid: "CA_44190284ga06",
            service: "support",
            user: "Nexus Retail",
            callerNumber: "+14155550100",
            callerName: "Jordan Lee",
            contact: "Jordan Lee",
            phone: "+14155550100",
            direction: "inbound",
            status: "missed",
            durationSeconds: 14,
            duration: "00:14",
            startedAt: "2026-10-03T14:10:00Z",
            endedAt: "2026-10-03T14:10:14Z",
            conversationId: null,
            recordingAvailable: false
        }
    ];

    static async getCalls(service = '', status = '', user = '', date = '', search = '', page = 1, limit = 10, ownerId = null) {
        const dbCalls = [];
        try {
            await ensureOwnerColumns().catch(() => {});
            let rows = [];
            try {
                rows = await db.all(`
                    SELECT c.*, b.filename as batch_name
                    FROM contacts c
                    LEFT JOIN batches b ON c.batch_id = b.id
                    WHERE c.call_status IN ('CALLING', 'COMPLETED', 'FAILED', 'UNANSWERED', 'in-progress')
                    ${ownerId ? 'AND (b.owner_user_id = ? OR c.owner_user_id = ? OR (b.owner_user_id IS NULL AND (c.owner_user_id IS NULL OR c.owner_user_id = ?)))' : ''}
                    ORDER BY c.updated_at DESC
                `, ownerId ? [ownerId, ownerId, ownerId] : []);
            } catch (errWithCol) {
                // Resilient fallback in case owner_user_id is not yet created on contacts
                rows = await db.all(`
                    SELECT c.*, b.filename as batch_name
                    FROM contacts c
                    LEFT JOIN batches b ON c.batch_id = b.id
                    WHERE c.call_status IN ('CALLING', 'COMPLETED', 'FAILED', 'UNANSWERED', 'in-progress')
                    ${ownerId ? 'AND (b.owner_user_id = ? OR b.owner_user_id IS NULL)' : ''}
                    ORDER BY c.updated_at DESC
                `, ownerId ? [ownerId] : []);
            }

            for (const r of rows) {
                const durSec = r.duration_seconds || 0;
                const durStr = `${String(Math.floor(durSec / 60)).padStart(2, '0')}:${String(durSec % 60).padStart(2, '0')}`;
                dbCalls.push({
                    id: `call_${(r.id || '').slice(0, 8)}`,
                    callSid: r.provider_call_id || `EXO_${(r.id || '').slice(0, 6)}`,
                    service: r.service,
                    user: "Score Labs",
                    callerNumber: r.phone,
                    callerName: r.name,
                    contact: r.name,
                    phone: r.phone,
                    direction: "outbound",
                    status: ['CALLING', 'in-progress'].includes(r.call_status) ? 'in-progress' : (r.call_status || '').toLowerCase(),
                    durationSeconds: durSec,
                    duration: durStr,
                    startedAt: r.started_at,
                    endedAt: r.ended_at,
                    conversationId: null,
                    recordingAvailable: false
                });
            }
        } catch (e) {
            console.error('[CallService] Error querying calls:', e);
        }

        const allCalls = [...dbCalls];
        for (const sample of (ownerId ? [] : this._SAMPLE_CALLS)) {
            if (!dbCalls.some(d => d.callerNumber === sample.callerNumber)) {
                allCalls.push(sample);
            }
        }

        let filtered = allCalls;

        if (service) {
            const sFilter = service.trim().toLowerCase();
            filtered = filtered.filter(c => (c.service || '').toLowerCase() === sFilter);
        }

        if (status) {
            const stFilter = status.trim().toLowerCase();
            filtered = filtered.filter(c => (c.status || '').toLowerCase() === stFilter);
        }

        if (user) {
            const uFilter = user.trim().toLowerCase();
            filtered = filtered.filter(c => (c.user || '').toLowerCase().includes(uFilter));
        }

        if (date) {
            const dFilter = date.trim();
            filtered = filtered.filter(c => (c.startedAt || '').startsWith(dFilter));
        }

        if (search) {
            const q = search.trim().toLowerCase();
            filtered = filtered.filter(c =>
                (c.callerNumber || '').toLowerCase().includes(q) ||
                (c.callerName || '').toLowerCase().includes(q) ||
                (c.callSid || '').toLowerCase().includes(q)
            );
        }

        const totalCount = filtered.length;
        const p = Math.max(parseInt(page, 10) || 1, 1);
        const l = Math.max(Math.min(parseInt(limit, 10) || 10, 100), 1);
        const totalPages = Math.max(Math.ceil(totalCount / l), 1);

        const startIdx = (p - 1) * l;
        const endIdx = startIdx + l;
        const paginatedItems = filtered.slice(startIdx, endIdx);

        return {
            calls: paginatedItems,
            data: paginatedItems,
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
