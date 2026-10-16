import db, { utcNow } from './db.js';
import PlivoService from './plivo_service.js';
import ExotelService from './exotel_service.js';
import AgentService from './agent_service.js';

export class CallQueueWorker {
    static isPaused = false;
    // Admins who paused their own queue (their calls are skipped; everyone else's keep going).
    static pausedOwners = new Set();
    static isRunning = false;
    static activeLoop = null;

    static async getQueueStatus(batchId = null, ownerId = null) {
        try {
            let activeCount = 0;
            if (batchId) {
                const row = await db.get("SELECT COUNT(*) as cnt FROM call_queue WHERE status = 'QUEUED' AND batch_id = ?", [batchId]);
                activeCount = row ? Number(row.cnt) : 0;
            } else if (ownerId) {
                const row = await db.get("SELECT COUNT(*) as cnt FROM call_queue WHERE status = 'QUEUED' AND batch_id IN (SELECT id FROM batches WHERE owner_user_id = ?)", [ownerId]);
                activeCount = row ? Number(row.cnt) : 0;
            } else {
                const row = await db.get("SELECT COUNT(*) as cnt FROM call_queue WHERE status = 'QUEUED'");
                activeCount = row ? Number(row.cnt) : 0;
            }
            let active = this.isRunning;
            let paused = this.isPaused;
            if (ownerId) {
                const busy = await db.get("SELECT COUNT(*) as cnt FROM call_queue WHERE status = 'IN_PROGRESS' AND batch_id IN (SELECT id FROM batches WHERE owner_user_id = ?)", [ownerId]);
                active = activeCount > 0 || Number(busy ? busy.cnt : 0) > 0;
                paused = this.isPaused || this.pausedOwners.has(ownerId);
            }
            return {
                isPaused: paused,
                queueLength: activeCount,
                active
            };
        } catch (e) {
            console.error('[CallQueueWorker] getQueueStatus error:', e);
            return { isPaused: this.isPaused, queueLength: 0, active: this.isRunning };
        }
    }

    // With an ownerId only that admin's calls are paused/resumed; without one it is the whole system.
    static pauseQueue(ownerId = null) {
        if (ownerId) this.pausedOwners.add(ownerId);
        else this.isPaused = true;
    }

    static resumeQueue(ownerId = null) {
        if (ownerId) this.pausedOwners.delete(ownerId);
        else this.isPaused = false;
        this._startLoop();
    }

    static async recoverStaleJobs() {
        const now = utcNow();
        try {
            // A call whose conversation was already saved had finished before the restart. Keep it completed;
            // only calls that were genuinely mid-call are interrupted.
            await db.run("UPDATE call_queue SET status = 'COMPLETED', updated_at = ? WHERE status = 'IN_PROGRESS' AND contact_id IN (SELECT contact_id FROM conversations)", [now]);
            await db.run("UPDATE contacts SET call_status = 'COMPLETED', updated_at = ? WHERE call_status IN ('CALLING', 'in-progress') AND id IN (SELECT contact_id FROM conversations)", [now]);
            await db.run("UPDATE call_queue SET status = 'FAILED', updated_at = ? WHERE status = 'IN_PROGRESS'", [now]);
            await db.run("UPDATE contacts SET call_status = 'FAILED', error_details = 'Call interrupted by server restart', updated_at = ? WHERE call_status IN ('CALLING', 'in-progress')", [now]);
            await db.run("UPDATE call_queue SET status = 'CANCELLED', updated_at = ? WHERE status = 'QUEUED'", [now]);
            await db.run("UPDATE batches SET status = 'CANCELLED', updated_at = ? WHERE status = 'IN_PROGRESS'", [now]);
        } catch (e) {
            console.error('[CallQueueWorker] recoverStaleJobs error:', e);
        }
    }

    static async cancelQueue(batchId, ownerId = null) {
        const now = utcNow();
        try {
            if (ownerId && batchId) {
                const own = await db.get('SELECT id FROM batches WHERE id = ? AND owner_user_id = ?', [batchId, ownerId]);
                if (!own) return;
            }
            if (ownerId && !batchId) {
                const scope = 'batch_id IN (SELECT id FROM batches WHERE owner_user_id = ?)';
                await db.run(`UPDATE call_queue SET status = 'CANCELLED', updated_at = ? WHERE ${scope} AND status IN ('QUEUED', 'IN_PROGRESS')`, [now, ownerId]);
                await db.run(`UPDATE contacts SET call_status = 'CANCELLED', updated_at = ? WHERE ${scope} AND call_status IN ('PENDING', 'CALLING', 'in-progress')`, [now, ownerId]);
                await db.run("UPDATE batches SET status = 'CANCELLED', updated_at = ? WHERE owner_user_id = ? AND status IN ('READY', 'IN_PROGRESS')", [now, ownerId]);
            } else if (batchId) {
                await db.run("UPDATE call_queue SET status = 'CANCELLED', updated_at = ? WHERE batch_id = ? AND status IN ('QUEUED', 'IN_PROGRESS')", [now, batchId]);
                await db.run("UPDATE contacts SET call_status = 'CANCELLED', updated_at = ? WHERE batch_id = ? AND call_status IN ('PENDING', 'CALLING', 'in-progress')", [now, batchId]);
                await db.run("UPDATE batches SET status = 'CANCELLED', updated_at = ? WHERE id = ?", [now, batchId]);
            } else {
                await db.run("UPDATE call_queue SET status = 'CANCELLED', updated_at = ? WHERE status IN ('QUEUED', 'IN_PROGRESS')", [now]);
                await db.run("UPDATE contacts SET call_status = 'CANCELLED', updated_at = ? WHERE call_status IN ('PENDING', 'CALLING', 'in-progress')", [now]);
                await db.run("UPDATE batches SET status = 'CANCELLED', updated_at = ? WHERE status IN ('READY', 'IN_PROGRESS')", [now]);
            }
        } catch (e) {
            console.error('[CallQueueWorker] cancelQueue error:', e);
        }
    }

    static async enqueueBatch(batchId) {
        const now = utcNow();
        try {
            await db.run("UPDATE batches SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?", [now, batchId]);
            const contacts = await db.all("SELECT id, service FROM contacts WHERE batch_id = ? AND validation_status = 'VALID' AND call_status = 'PENDING'", [batchId]);

            await db.transaction(async (trx) => {
                for (const c of contacts) {
                    const queueId = `q_${Math.random().toString(36).substring(2, 9)}`;
                    await trx.run(
                        "INSERT IGNORE INTO call_queue (id, batch_id, contact_id, service, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                        [queueId, batchId, c.id, c.service, now, now]
                    );
                }
            });

            this._startLoop();
            return { queuedCount: contacts.length };
        } catch (e) {
            console.error('[CallQueueWorker] enqueueBatch error:', e);
            return { queuedCount: 0 };
        }
    }

    static _startLoop() {
        if (this.isRunning || this.isPaused) return;
        this.isRunning = true;
        this._processNext();
    }

    static async _processNext() {
        if (this.isPaused) {
            this.isRunning = false;
            return;
        }

        let nextJob = null;
        try {
            const pausedOwners = [...this.pausedOwners];
            const skipPaused = pausedOwners.length
                ? ` AND cq.batch_id NOT IN (SELECT id FROM batches WHERE owner_user_id IN (${pausedOwners.map(() => '?').join(',')}))`
                : '';
            nextJob = await db.get(`
                SELECT cq.id as queue_id, cq.contact_id, cq.batch_id, c.phone, c.name, c.service
                FROM call_queue cq
                JOIN contacts c ON cq.contact_id = c.id
                WHERE cq.status = 'QUEUED'${skipPaused}
                ORDER BY cq.priority DESC, cq.created_at ASC
                LIMIT 1
            `, pausedOwners);

            if (!nextJob) {
                // Queue is empty, mark finished batches as COMPLETED
                const now = utcNow();
                await db.run(`
                    UPDATE batches SET status = 'COMPLETED', updated_at = ? 
                    WHERE status = 'IN_PROGRESS' AND id NOT IN (SELECT DISTINCT batch_id FROM call_queue WHERE status IN ('QUEUED', 'IN_PROGRESS'))
                `, [now]);

                this.isRunning = false;
                return;
            }

            // Mark as IN_PROGRESS
            const now = utcNow();
            await db.run("UPDATE call_queue SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?", [now, nextJob.queue_id]);
            await db.run("UPDATE contacts SET call_status = 'CALLING', started_at = ?, updated_at = ? WHERE id = ?", [now, now, nextJob.contact_id]);

        } catch (e) {
            console.error('[CallQueueWorker] Fetch next job error:', e);
            this.isRunning = false;
            return;
        }

        let result;
        const usePlivo = PlivoService.isConfigured();

        if (usePlivo) {
            console.log(`[QUEUE] Initiating outbound Plivo call to ${nextJob.phone} for service ${nextJob.service}...`);
            try {
                const contactRecord = await db.get("SELECT * FROM contacts WHERE id = ?", [nextJob.contact_id]) || nextJob;
                // The admin's own agent decides the number the call comes from (no agent = shared number).
                const agent = await AgentService.resolveForContact(contactRecord).catch((agentErr) => {
                    console.warn('[QUEUE] Agent lookup failed, using the shared number:', agentErr.message);
                    return null;
                });
                if (agent && !contactRecord.agent_id) {
                    await db.run('UPDATE contacts SET agent_id = ? WHERE id = ?', [agent.id, nextJob.contact_id]).catch(() => {});
                }
                result = await PlivoService.initiateOutboundCall(contactRecord, nextJob.service, { agent });
            } catch (plivoErr) {
                console.error('[QUEUE] Plivo dispatch error:', plivoErr);
                result = { success: false, error: plivoErr.message };
            }
        } else {
            console.log(`[QUEUE] Plivo not configured. Initiating real Exotel call to ${nextJob.phone} for service ${nextJob.service}...`);
            try {
                result = await ExotelService.initiateOutboundCall(nextJob.phone, nextJob.contact_id);
            } catch (exoErr) {
                console.error(`[QUEUE] Exotel dialing error:`, exoErr);
                result = { success: false, error: exoErr.message };
            }
        }

        try {
            const now = utcNow();
            const sid = result.callUuid || result.callSid;

            if (result.success && sid) {
                await db.run(
                    "UPDATE contacts SET provider_call_id = ?, call_status = 'CALLING', started_at = ?, updated_at = ? WHERE id = ?",
                    [sid, now, now, nextJob.contact_id]
                );
                console.log(`[QUEUE] Outbound call connected via ${usePlivo ? 'Plivo' : 'Exotel'}! ID: ${sid}`);
            } else {
                console.warn(`[QUEUE] Dispatch failed: ${result.error}`);
                await db.run(
                    "UPDATE contacts SET call_status = 'FAILED', error_details = ?, updated_at = ? WHERE id = ?",
                    [result.error || 'Dispatch rejected', now, nextJob.contact_id]
                );
                await db.run(
                    "UPDATE call_queue SET status = 'FAILED', updated_at = ? WHERE id = ?",
                    [now, nextJob.queue_id]
                );
            }
        } catch (err) {
            console.error(`[QUEUE] Error logging dial result for ${nextJob.phone}:`, err);
            const now = utcNow();
            await db.run(
                "UPDATE contacts SET call_status = 'FAILED', error_details = ?, updated_at = ? WHERE id = ?",
                [err.message, now, nextJob.contact_id]
            );
            await db.run(
                "UPDATE call_queue SET status = 'FAILED', updated_at = ? WHERE id = ?",
                [now, nextJob.queue_id]
            );
        }

        // Wait before dialing next item in the queue
        setTimeout(() => {
            this._processNext();
        }, 8000);
    }
}

CallQueueWorker.recoverStaleJobs().catch(e => console.error('[CallQueueWorker] Startup recovery error:', e));

export default CallQueueWorker;

