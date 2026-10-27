/**
 * services/recording_service.js
 * Call recordings: who may hear them, how long they are kept, and how they are deleted.
 *
 * Plivo records the call. We keep the link on the conversation (and on its contact) and stream the audio
 * through our own server after a login check, so there is never a public or shareable link.
 * Every recording is deleted RETENTION_DAYS after the call ENDED, at Plivo and on our side. The
 * transcript, summary and screening result stay; only the audio goes.
 *
 * Access: an admin hears their own calls (and unassigned ones); the owner hears every call. The callers
 * (routes/admin.js, routes/owner_calls.js) decide which by passing `adminId` to findConversation().
 */
import { Readable } from 'stream';
import db, { utcNow, ensureOwnerColumns, ensureRecordingSchema } from './db.js';
import PlivoService from './plivo_service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 15000;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
const TIMESTAMP_COLUMN = { conversations: 'created_at', contacts: 'updated_at' };

const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';

export default class RecordingService {
    static RETENTION_DAYS = 30;

    // ── Links and dates ─────────────────────────────────────────────────────────
    /** Only https links on Plivo's own domain are ever stored or streamed (the proxy sends our Plivo credentials). */
    static isAllowedUrl(url) {
        try {
            const u = new URL(String(url));
            return u.protocol === 'https:' && (u.hostname === 'plivo.com' || u.hostname.endsWith('.plivo.com'));
        } catch {
            return false;
        }
    }

    /** Plivo recording links end in .../Recording/<id>.mp3 */
    static idFromUrl(url) {
        const match = /\/Recording\/([^/.?#]+)/.exec(String(url || ''));
        return match ? match[1] : '';
    }

    /** When the call ended; falls back to start + duration, then to the row's own timestamp. */
    static callEndMs(row) {
        const ended = Date.parse(row.ended_at);
        if (!Number.isNaN(ended)) return ended;
        const started = Date.parse(row.started_at);
        if (!Number.isNaN(started)) return started + (Number(row.duration_seconds) || 0) * 1000;
        const stamped = Date.parse(row.created_at || row.updated_at);
        return Number.isNaN(stamped) ? null : stamped;
    }

    /** ISO date after which the audio is gone: call end + RETENTION_DAYS (the stored stamp wins). */
    static expiryFor(row) {
        if (!isBlank(row.recording_expires_at)) return row.recording_expires_at;
        const end = this.callEndMs(row);
        return end === null ? null : new Date(end + this.RETENTION_DAYS * DAY_MS).toISOString();
    }

    /** 'available' | 'expired' | 'unavailable'. Expiry is enforced here, so it holds even before the cleanup runs. */
    static statusOf(row, now = Date.now()) {
        if (!isBlank(row.recording_deleted_at)) return 'expired';
        const expiresAt = this.expiryFor(row);
        const pastExpiry = expiresAt !== null && Date.parse(expiresAt) <= now;
        if (isBlank(row.recording_url)) return 'unavailable';
        return pastExpiry ? 'expired' : 'available';
    }

    /** Shape sent to the dashboards. basePath is '/api/admin' or '/api/owner'. */
    static describe(row, basePath) {
        const status = this.statusOf(row);
        const audio = `${basePath}/conversations/${encodeURIComponent(row.id)}/audio`;
        return {
            available: status === 'available',
            status,
            audio_url: status === 'available' ? audio : null,
            download_url: status === 'available' ? `${audio}?download=1` : null,
            expires_at: status === 'unavailable' ? null : this.expiryFor(row),
            retention_days: this.RETENTION_DAYS,
            duration_seconds: row.duration_seconds || 0
        };
    }

    // ── Finding the call ────────────────────────────────────────────────────────
    /** The contact's link is used only when it belongs to the same call (a contact can be called more than once). */
    static normalize(raw) {
        const row = { ...raw };
        const sameCall = isBlank(row.provider_call_id) || row.provider_call_id === row.contact_call_id;
        if (isBlank(row.recording_url) && isBlank(row.recording_deleted_at) && sameCall && !isBlank(row.contact_recording_url)) {
            row.recording_url = row.contact_recording_url;
            row.recording_id = row.contact_recording_id;
        }
        if (isBlank(row.provider_call_id) && !isBlank(row.contact_call_id)) row.provider_call_id = row.contact_call_id;
        return row;
    }

    /** Makes sure the owner and recording columns exist (tests replace this). */
    static async ensureSchema() {
        await ensureOwnerColumns();
        await ensureRecordingSchema();
    }

    /**
     * Loads one conversation with its recording fields. With adminId, only that admin's calls are returned:
     * the call is theirs directly or through their contact sheet, or it is unassigned (no owner on the call
     * and none on its contact sheet, as in the owner panel's "unassigned" list). Without adminId (owner), any call.
     */
    static async findConversation(convId, { adminId = null } = {}) {
        if (isBlank(convId)) return null;
        await this.ensureSchema();
        const id = String(convId).trim();
        const scope = adminId
            ? `AND (c.owner_user_id = ? OR b.owner_user_id = ?
                    OR ((c.owner_user_id IS NULL OR c.owner_user_id = '') AND (b.owner_user_id IS NULL OR b.owner_user_id = '')))`
            : '';
        const row = await db.get(`
            SELECT c.*, ct.provider_call_id AS contact_call_id, ct.recording_url AS contact_recording_url,
                   ct.recording_id AS contact_recording_id
            FROM conversations c
            LEFT JOIN contacts ct ON c.contact_id = ct.id
            LEFT JOIN batches b ON b.id = ct.batch_id
            WHERE c.id = ? ${scope}
        `, adminId ? [id, adminId, adminId] : [id]);
        return row ? this.normalize(row) : null;
    }

    /** No link saved yet (the Plivo callback may have been missed): ask Plivo for the call's recording. */
    static async lookupAtProvider(row) {
        const callUuid = row.provider_call_id;
        if (isBlank(callUuid) || !PlivoService.isConfigured()) return row;
        const found = await PlivoService.fetchRecordingByCallUuid(callUuid);
        const url = found && (found.recording_url || found.url);
        if (!this.isAllowedUrl(url)) return row;
        const recordingId = found.recording_id || this.idFromUrl(url);
        const expiresAt = this.expiryFor(row);
        await db.run('UPDATE conversations SET recording_url = ?, recording_id = ?, recording_expires_at = ? WHERE id = ?', [url, recordingId, expiresAt, row.id]).catch(() => {});
        await db.run('UPDATE contacts SET recording_url = ?, recording_id = ?, recording_expires_at = ? WHERE provider_call_id = ?', [url, recordingId, expiresAt, callUuid]).catch(() => {});
        console.log(`[Recordings] Recording link recovered from Plivo for conversation ${row.id}`);
        return { ...row, recording_url: url, recording_id: recordingId, recording_expires_at: expiresAt };
    }

    /** Fills in a missing link, unless the recording is deleted or past its expiry (then Plivo must not be asked). */
    static async resolve(row) {
        if (!isBlank(row.recording_url) || !isBlank(row.recording_deleted_at)) return row;
        const expiresAt = this.expiryFor(row);
        if (expiresAt !== null && Date.parse(expiresAt) <= Date.now()) return row;
        return this.lookupAtProvider(row);
    }

    // ── Playing and downloading ─────────────────────────────────────────────────
    static downloadName(row, contentType = '') {
        const clean = (text) => String(text || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const ext = /wav/i.test(contentType) ? 'wav' : /ogg/i.test(contentType) ? 'ogg' : 'mp3';
        const who = clean(row.contact_name) || clean(row.phone) || 'call';
        const started = Date.parse(row.started_at);
        const day = Number.isNaN(started) ? 'recording' : new Date(started).toISOString().slice(0, 10);
        return `${who}_${day}.${ext}`;
    }

    /**
     * Streams the audio to the browser (seeking works through HTTP Range). download=true sends it as a file.
     * Plivo answers a recording link with a redirect to a signed storage address; our credentials go to Plivo
     * only, never to the storage address.
     */
    static async serve(req, res, row, { download = false } = {}) {
        const resolved = await this.resolve(row);
        const status = this.statusOf(resolved);
        if (status === 'expired') {
            return res.status(410).json({ success: false, status, message: `Recording expired (${this.RETENTION_DAYS}-day limit).` });
        }
        if (status !== 'available') {
            return res.status(404).json({ success: false, status, message: 'Recording unavailable for this call.' });
        }
        if (!this.isAllowedUrl(resolved.recording_url)) {
            console.warn(`[Recordings] Refused to stream a recording link that is not a Plivo address (conversation ${resolved.id})`);
            return res.status(404).json({ success: false, status: 'unavailable', message: 'Recording unavailable for this call.' });
        }
        if (!PlivoService.isConfigured()) {
            return res.status(503).json({ success: false, message: 'Recording storage is not configured.' });
        }

        const controller = new AbortController();
        res.on('close', () => controller.abort());
        const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
        try {
            const cfg = PlivoService.getConfig();
            const headers = {};
            if (req.headers.range && !download) headers.Range = req.headers.range;

            let audioRes = await fetch(resolved.recording_url, {
                headers: { ...headers, Authorization: 'Basic ' + Buffer.from(`${cfg.authId}:${cfg.authToken}`).toString('base64') },
                redirect: 'manual',
                signal: controller.signal
            });
            if (REDIRECT_STATUSES.includes(audioRes.status)) {
                const location = audioRes.headers.get('location');
                await audioRes.body?.cancel().catch(() => {});
                if (!location || !/^https:\/\//i.test(location)) {
                    return res.status(502).json({ success: false, message: 'Failed to retrieve audio stream' });
                }
                audioRes = await fetch(location, { headers, signal: controller.signal });
            }
            clearTimeout(timer); // the timeout covers getting the first response, not the whole playback

            if (audioRes.status === 404) {
                await audioRes.body?.cancel().catch(() => {});
                return res.status(404).json({ success: false, status: 'unavailable', message: 'Recording unavailable for this call.' });
            }
            if (!audioRes.ok && audioRes.status !== 206 && audioRes.status !== 416) {
                await audioRes.body?.cancel().catch(() => {});
                console.warn(`[Recordings] Storage answered HTTP ${audioRes.status} for conversation ${resolved.id}`);
                return res.status(502).json({ success: false, message: 'Failed to retrieve audio stream' });
            }

            const contentType = audioRes.headers.get('content-type') || 'audio/mpeg';
            res.status(audioRes.status);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Accept-Ranges', audioRes.headers.get('accept-ranges') || 'bytes');
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            const contentRange = audioRes.headers.get('content-range');
            if (contentRange) res.setHeader('Content-Range', contentRange);
            const contentLength = audioRes.headers.get('content-length');
            if (contentLength) res.setHeader('Content-Length', contentLength);
            if (download) res.setHeader('Content-Disposition', `attachment; filename="${this.downloadName(resolved, contentType)}"`);

            if (!audioRes.body) return res.end();
            const body = Readable.fromWeb(audioRes.body);
            body.on('error', () => res.destroy());
            body.pipe(res);
        } catch (err) {
            if (controller.signal.aborted && res.headersSent) return res.destroy();
            console.error(`[Recordings] Error streaming audio for ${resolved.id}:`, err.message);
            if (res.headersSent) return res.destroy();
            return res.status(502).json({ success: false, message: 'Failed to retrieve audio stream' });
        } finally {
            clearTimeout(timer);
        }
    }

    // ── Saving the link ─────────────────────────────────────────────────────────
    /**
     * Stamps the expiry date on rows that have a link but no date. assumeEndedAt is used for rows whose call end
     * is not known yet (the recording callback arrives right after the call ends).
     */
    static async stampExpiry(table, where, params = [], { assumeEndedAt = null } = {}) {
        const rows = await db.all(
            `SELECT id, started_at, ended_at, duration_seconds, ${TIMESTAMP_COLUMN[table]} AS created_at FROM ${table}
             WHERE ${where} AND (recording_expires_at IS NULL OR recording_expires_at = '') LIMIT 500`, params);
        for (const r of rows) {
            const withEnd = isBlank(r.ended_at) && assumeEndedAt ? { ...r, ended_at: assumeEndedAt } : r;
            const expiresAt = this.expiryFor(withEnd);
            if (expiresAt) await db.run(`UPDATE ${table} SET recording_expires_at = ? WHERE id = ?`, [expiresAt, r.id]);
        }
    }

    /** Existing recordings get the same stamp, based on their call date. */
    static async backfillExpiry() {
        const hasLink = "((recording_url IS NOT NULL AND recording_url != '') OR (recording_id IS NOT NULL AND recording_id != ''))";
        await this.stampExpiry('conversations', hasLink);
        await this.stampExpiry('contacts', hasLink);
    }

    /**
     * Plivo's recording callback. Only the call this recording belongs to is updated (never every conversation
     * of the contact), and a link that is not a Plivo address is ignored.
     */
    static async saveFromWebhook({ callUuid = '', contactId = '', recordingUrl = '', recordingId = '' }) {
        if (!isBlank(recordingUrl) && !this.isAllowedUrl(recordingUrl)) {
            console.warn('[Recordings] Ignored a recording callback whose link is not a Plivo address');
            return { saved: false, reason: 'link_not_allowed' };
        }
        if (isBlank(recordingUrl) && isBlank(recordingId)) return { saved: false, reason: 'empty' };

        await this.ensureSchema();
        const now = utcNow();
        const sets = [];
        const values = [];
        if (!isBlank(recordingUrl)) { sets.push('recording_url = ?'); values.push(recordingUrl); }
        if (!isBlank(recordingId)) { sets.push('recording_id = ?'); values.push(recordingId); }
        const setSql = sets.join(', ');

        if (!isBlank(callUuid)) {
            await db.run(`UPDATE contacts SET ${setSql}, updated_at = ? WHERE provider_call_id = ?`, [...values, now, callUuid]);
            await db.run(`UPDATE conversations SET ${setSql} WHERE provider_call_id = ?`, [...values, callUuid]);
        }
        if (!isBlank(contactId)) {
            // A late callback for an earlier attempt must not replace the link of a newer call.
            await db.run(
                `UPDATE contacts SET ${setSql}, updated_at = ? WHERE id = ? AND (provider_call_id IS NULL OR provider_call_id = '' OR provider_call_id = ?)`,
                [...values, now, contactId, callUuid || '']);
            if (isBlank(callUuid)) {
                await db.run(
                    `UPDATE conversations SET ${setSql} WHERE contact_id = ? AND (recording_url IS NULL OR recording_url = '') AND recording_deleted_at IS NULL`,
                    [...values, contactId]);
            }
        }

        if (!isBlank(callUuid)) {
            await this.stampExpiry('conversations', 'provider_call_id = ?', [callUuid], { assumeEndedAt: now });
            await this.stampExpiry('contacts', 'provider_call_id = ?', [callUuid], { assumeEndedAt: now });
        }
        if (!isBlank(contactId)) {
            await this.stampExpiry('contacts', 'id = ?', [contactId], { assumeEndedAt: now });
        }
        console.log(`[Recordings] Recording saved (id ${recordingId || this.idFromUrl(recordingUrl) || 'n/a'}, call ${callUuid || 'n/a'})`);
        return { saved: true };
    }

    // ── Maintenance ─────────────────────────────────────────────────────────────
    /** Recordings whose callback never reached us: look them up at Plivo for calls that ended in the last hours. */
    static async reconcileMissing({ now = new Date(), minAgeMs = 5 * 60 * 1000, maxAgeMs = 6 * 60 * 60 * 1000, limit = 50 } = {}) {
        const result = { checked: 0, found: 0 };
        if (!PlivoService.isConfigured()) return result;
        await this.ensureSchema();
        const newest = new Date(now.getTime() - minAgeMs).toISOString();
        const oldest = new Date(now.getTime() - maxAgeMs).toISOString();
        const rows = await db.all(`
            SELECT * FROM conversations
            WHERE provider_call_id IS NOT NULL AND provider_call_id != ''
              AND (recording_url IS NULL OR recording_url = '') AND recording_deleted_at IS NULL
              AND ended_at IS NOT NULL AND ended_at <= ? AND ended_at >= ?
            ORDER BY ended_at DESC LIMIT ${Number(limit)}`, [newest, oldest]);
        for (const row of rows) {
            result.checked++;
            const updated = await this.lookupAtProvider(row);
            if (!isBlank(updated.recording_url)) result.found++;
        }
        return result;
    }

    /** Deletes one expired recording at Plivo. Returns false if Plivo could not do it (tried again on the next run). */
    static async deleteAtProvider(row) {
        let ids = [];
        if (!isBlank(row.recording_id)) ids = [row.recording_id];
        else if (this.idFromUrl(row.recording_url)) ids = [this.idFromUrl(row.recording_url)];
        else if (!isBlank(row.provider_call_id)) {
            ids = (await PlivoService.fetchRecordingsByCallUuid(row.provider_call_id)).map(r => r.recording_id).filter(Boolean);
        }
        for (const id of ids) {
            const result = await PlivoService.deleteRecording(id);
            if (!result.success) return false;
        }
        return true;
    }

    /** Removes the link everywhere it was saved and marks the conversation's audio as deleted. */
    static async clearLinks(row, deletedAt) {
        const conditions = [];
        const params = [];
        if (!isBlank(row.recording_url)) { conditions.push('recording_url = ?'); params.push(row.recording_url); }
        if (!isBlank(row.recording_id)) { conditions.push('recording_id = ?'); params.push(row.recording_id); }
        const where = conditions.join(' OR ');
        await db.run(`UPDATE conversations SET recording_url = NULL, recording_id = NULL, recording_deleted_at = ? WHERE ${where}`, [deletedAt, ...params]);
        await db.run(`UPDATE contacts SET recording_url = NULL, recording_id = NULL WHERE ${where}`, params);
    }

    /**
     * Daily job: deletes every recording whose expiry date has passed, at Plivo and on our side.
     * Deletion is permanent. If Plivo fails the link is kept (playback is already refused) and retried next run.
     * The log holds counts only.
     */
    static async purgeExpired({ now = new Date(), batchSize = 200 } = {}) {
        const result = { deleted: 0, failed: 0, skipped: false };
        if (!PlivoService.isConfigured()) {
            console.warn('[Recordings] Cleanup skipped: Plivo is not configured');
            result.skipped = true;
            return result;
        }
        await this.ensureSchema();
        await this.backfillExpiry();
        const iso = now.toISOString();
        for (const table of ['conversations', 'contacts']) {
            const rows = await db.all(`
                SELECT id, provider_call_id, recording_id, recording_url FROM ${table}
                WHERE ((recording_url IS NOT NULL AND recording_url != '') OR (recording_id IS NOT NULL AND recording_id != ''))
                  AND recording_expires_at IS NOT NULL AND recording_expires_at != '' AND recording_expires_at <= ?
                ORDER BY recording_expires_at ASC LIMIT ${Number(batchSize)}`, [iso]);
            for (const row of rows) {
                if (await this.deleteAtProvider(row)) {
                    await this.clearLinks(row, iso);
                    result.deleted++;
                } else {
                    result.failed++;
                }
            }
        }
        console.log(`[Recordings] Cleanup finished: ${result.deleted} deleted, ${result.failed} failed (will retry)`);
        return result;
    }

    /** Starts the daily cleanup and the half-hourly recovery of missed links. Call once at server start. */
    static startMaintenance() {
        if (this._timers) return;
        const guarded = (name, task) => {
            let running = false;
            return async () => {
                if (running) return;
                running = true;
                try { await task(); } catch (e) { console.error(`[Recordings] ${name} failed:`, e.message); } finally { running = false; }
            };
        };
        const cleanup = guarded('Cleanup', () => this.purgeExpired());
        const reconcile = guarded('Recovery', async () => {
            const found = await this.reconcileMissing();
            if (found.found) console.log(`[Recordings] Recovered ${found.found} missing recording link(s) of ${found.checked} checked`);
        });
        this._timers = [setTimeout(cleanup, 60 * 1000), setInterval(cleanup, DAY_MS), setInterval(reconcile, 30 * 60 * 1000)];
        this._timers.forEach(timer => timer.unref?.());
    }

    static stopMaintenance() {
        (this._timers || []).forEach(timer => { clearTimeout(timer); clearInterval(timer); });
        this._timers = null;
    }
}
