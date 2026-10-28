import 'dotenv/config';
import crypto from 'crypto';

/**
 * services/plivo_service.js
 * Integration with Plivo Telephony Gateway:
 * - Outbound call dispatch via Plivo REST API
 * - Plivo XML generation with bidirectional Audio Streaming (<Stream>)
 * - Phone number normalization for Indian/International calling
 * - Webhook event parsing and signature verification
 */

export default class PlivoService {
    static getConfig() {
        const authId = (process.env.PLIVO_AUTH_ID || '').trim();
        const authToken = (process.env.PLIVO_AUTH_TOKEN || '').trim();
        const virtualNumber = (process.env.PLIVO_VIRTUAL_NUMBER || process.env.PLIVO_PHONE_NUMBER || '').trim();
        const serverUrl = (
            process.env.SERVER_URL ||
            process.env.PUBLIC_URL ||
            process.env.APP_URL ||
            'https://takeremo.com'
        ).trim().replace(/\/+$/, '');

        if (!authId || !authToken) {
            throw new Error('Plivo credentials (PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN) are missing in environment.');
        }

        return {
            authId,
            authToken,
            virtualNumber,
            serverUrl
        };
    }

    static isConfigured() {
        return Boolean(
            (process.env.PLIVO_AUTH_ID || '').trim() &&
            (process.env.PLIVO_AUTH_TOKEN || '').trim()
        );
    }

    /**
     * Normalizes a phone number into valid E.164 digits accepted by Plivo.
     * Handles Indian numbers (+91, 0-prefix, or 10-digit mobile) and international numbers.
     */
    static normalizePhoneNumber(phone) {
        if (!phone) return '';
        let clean = String(phone).trim().replace(/[\s\-\(\)]/g, '');

        if (clean.startsWith('+')) {
            clean = clean.slice(1);
        }

        // Indian numbers
        if (/^0[6-9]\d{9}$/.test(clean)) {
            clean = '91' + clean.slice(1);
        } else if (/^[6-9]\d{9}$/.test(clean)) {
            clean = '91' + clean;
        }

        return clean;
    }

    /**
     * Initiates an outbound telephone call using Plivo REST API.
     * @param {object} contact - Contact details (phone, id, name, service, etc.)
     * @param {string} service - 'recruitment' | 'sales' | 'support'
     * @param {object} options - Custom URLs / parameters
     * @returns {Promise<{success: boolean, callUuid?: string, callSid?: string, error?: string, raw?: object}>}
     */
    static async initiateOutboundCall(contact, service = 'recruitment', options = {}) {
        const cfg = this.getConfig();
        const targetPhone = this.normalizePhoneNumber(contact.phone || contact.callerNumber);
        // An agent's own number is the caller ID; without an agent the shared number is used.
        const agent = options.agent || null;
        let callerId = this.normalizePhoneNumber(agent && agent.phone_number ? agent.phone_number : cfg.virtualNumber);

        if (!targetPhone) {
            return { success: false, error: 'Destination phone number is missing or invalid.' };
        }

        if (!callerId) {
            console.warn('[PlivoService] PLIVO_VIRTUAL_NUMBER not set; attempting without explicit callerId');
            callerId = '918064344083';
        }

        const contactId = contact.id || `cnt_${Date.now()}`;
        const ownerId = contact.owner_user_id || contact.ownerId || '';
        const callMode = options.callMode || contact.callMode || 'STANDARD';
        const queryParams = new URLSearchParams({
            contactId: String(contactId),
            service: String(service || 'recruitment'),
            name: String(contact.name || contact.contact || 'Caller'),
            phone: String(targetPhone),
            ownerId: String(ownerId),
            role: String(contact.job_role || contact.role || ''),
            company: String(contact.company || ''),
            agentId: String(agent ? agent.id : ''),
            direction: 'outbound',
            callMode: String(callMode)
        }).toString();

        const answerUrl = options.answerUrl || `${cfg.serverUrl}/api/plivo/answer?${queryParams}`;
        const hangupUrl = options.hangupUrl || `${cfg.serverUrl}/api/plivo/hangup?${queryParams}`;
        const statusCallbackUrl = options.statusCallbackUrl || `${cfg.serverUrl}/api/plivo/status?${queryParams}`;

        const url = `https://api.plivo.com/v1/Account/${cfg.authId}/Call/`;
        const authHeader = 'Basic ' + Buffer.from(`${cfg.authId}:${cfg.authToken}`).toString('base64');

        const bodyPayload = {
            from: callerId,
            to: targetPhone,
            answer_url: answerUrl,
            answer_method: 'POST',
            hangup_url: hangupUrl,
            hangup_method: 'POST',
            callback_url: statusCallbackUrl,
            callback_method: 'POST',
            time_limit: 600
        };

        try {
            console.log(`[PlivoService] Initiating outbound call to ${targetPhone} (from ${callerId}, service: ${service}${agent ? `, agent: ${agent.name}` : ''})...`);
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bodyPayload)
            });

            const data = await res.json().catch(() => ({}));
            const isSuccess = res.ok && (
                data.message === 'async api spawned' ||
                data.message === 'call fired' ||
                Boolean(data.request_uuid) ||
                Boolean(data.call_uuid) ||
                Boolean(data.api_id)
            );

            if (isSuccess) {
                const callUuid = data.request_uuid || data.call_uuid || data.api_id || `PLV_${Date.now()}`;
                console.log(`[PlivoService] Call successfully dispatched via Plivo! UUID/ApiID: ${callUuid} (${data.message || 'success'})`);
                return {
                    success: true,
                    callUuid: callUuid,
                    callSid: callUuid,
                    status: 'CALLING',
                    provider: 'plivo',
                    raw: data
                };
            } else {
                const errMsg = data.error || data.message || `HTTP ${res.status}`;
                console.error(`[PlivoService] Plivo API rejected call to ${targetPhone}:`, errMsg);
                return {
                    success: false,
                    error: errMsg,
                    status: 'FAILED',
                    raw: data
                };
            }
        } catch (err) {
            console.error('[PlivoService] Network error dispatching Plivo call:', err.message);
            return {
                success: false,
                error: err.message,
                status: 'FAILED'
            };
        }
    }

    /**
     * Generates Plivo XML containing a bidirectional <Stream> element
     * connecting Plivo's real-time 8kHz mu-law audio to our voicebot WebSocket.
     * Optionally includes a non-blocking <Record> element to record call audio.
     */
    static generateAnswerXml(streamWsUrl, extraHeaders = '') {
        const cleanUrl = String(streamWsUrl || '')
            .trim()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const cleanHeaders = String(extraHeaders || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;');
        const headersAttr = cleanHeaders ? ` extraHeaders="${cleanHeaders}"` : '';
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream bidirectional="true" keepCallAlive="true" streamTimeout="3600" contentType="audio/x-mulaw;rate=8000"${headersAttr}>${cleanUrl}</Stream>
</Response>`.trim();
    }

    /**
     * Triggers active call recording via Plivo REST API.
     * @param {string} callUuid - Plivo Call UUID
     * @param {object} options - Options including callbackUrl
     * @returns {Promise<{success: boolean, recordingId?: string, url?: string, error?: string}>}
     */
    static async startCallRecording(callUuid, options = {}) {
        if (!callUuid || !this.isConfigured()) return { success: false, error: 'Plivo not configured or no call UUID' };
        try {
            const cfg = this.getConfig();
            const callbackUrl = options.callbackUrl || `${cfg.serverUrl}/api/plivo/recording`;
            const url = `https://api.plivo.com/v1/Account/${cfg.authId}/Call/${callUuid}/Record/`;
            const authHeader = 'Basic ' + Buffer.from(`${cfg.authId}:${cfg.authToken}`).toString('base64');
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    file_format: 'mp3',
                    time_limit: 3600,
                    callback_url: callbackUrl,
                    callback_method: 'POST'
                })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                console.log(`[PlivoService] Call recording started for ${callUuid}:`, data.recording_id || data.url);
                return { success: true, recordingId: data.recording_id, url: data.url };
            } else {
                const reason = data.error || data.message || `HTTP ${res.status}`;
                console.warn(`[PlivoService] Failed to start recording for ${callUuid} (HTTP ${res.status}):`, reason);
                return { success: false, error: reason, alreadyRecording: /already/i.test(String(reason)) };
            }
        } catch (err) {
            console.error('[PlivoService] Error starting call recording:', err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * Starts the recording, trying again if Plivo refuses it. Right after the answer webhook the call
     * may not be "in progress" at Plivo yet, so the first attempt can fail. Runs in the background.
     */
    static async startCallRecordingWithRetry(callUuid, options = {}) {
        const delaysMs = options.delaysMs || [1500, 4000];
        let result = { success: false, error: 'Recording was not attempted' };
        let attempt = 0;
        while (true) {
            attempt++;
            result = await this.startCallRecording(callUuid, options);
            if (result.success || result.alreadyRecording) return { ...result, success: true, attempts: attempt };
            if (!this.isConfigured() || attempt > delaysMs.length) break;
            await new Promise(resolve => setTimeout(resolve, delaysMs[attempt - 1]));
        }
        console.error(`[PlivoService] Call ${callUuid} could not be recorded after ${attempt} attempt(s): ${result.error}`);
        return { ...result, attempts: attempt };
    }

    /**
     * All recordings Plivo holds for a call.
     * @returns {Promise<object[]>}
     */
    static async fetchRecordingsByCallUuid(callUuid) {
        if (!callUuid || !this.isConfigured()) return [];
        try {
            const cfg = this.getConfig();
            const authHeader = 'Basic ' + Buffer.from(`${cfg.authId}:${cfg.authToken}`).toString('base64');
            const url = `https://api.plivo.com/v1/Account/${cfg.authId}/Recording/?call_uuid=${encodeURIComponent(callUuid)}`;
            const res = await fetch(url, { headers: { 'Authorization': authHeader } });
            if (!res.ok) return [];
            const data = await res.json().catch(() => ({}));
            return Array.isArray(data.objects) ? data.objects : [];
        } catch (err) {
            console.warn(`[PlivoService] Error listing recordings for ${callUuid}:`, err.message);
            return [];
        }
    }

    /**
     * Permanently deletes a recording at Plivo. A recording that is already gone counts as deleted.
     * @returns {Promise<{success: boolean, notFound?: boolean, error?: string}>}
     */
    static async deleteRecording(recordingId) {
        if (!recordingId || !this.isConfigured()) return { success: false, error: 'Plivo not configured or no recording ID' };
        try {
            const cfg = this.getConfig();
            const authHeader = 'Basic ' + Buffer.from(`${cfg.authId}:${cfg.authToken}`).toString('base64');
            const url = `https://api.plivo.com/v1/Account/${cfg.authId}/Recording/${encodeURIComponent(recordingId)}/`;
            const res = await fetch(url, { method: 'DELETE', headers: { 'Authorization': authHeader } });
            if (res.status === 404) return { success: true, notFound: true };
            if (res.ok) return { success: true };
            return { success: false, error: `HTTP ${res.status}` };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Queries Plivo API for any recordings associated with a call UUID.
     * @param {string} callUuid - Plivo Call UUID
     * @returns {Promise<object|null>} Recording object or null
     */
    static async fetchRecordingByCallUuid(callUuid) {
        if (!callUuid || !this.isConfigured()) return null;
        try {
            const cfg = this.getConfig();
            const authHeader = 'Basic ' + Buffer.from(`${cfg.authId}:${cfg.authToken}`).toString('base64');
            const url = `https://api.plivo.com/v1/Account/${cfg.authId}/Recording/?call_uuid=${encodeURIComponent(callUuid)}`;
            const res = await fetch(url, { headers: { 'Authorization': authHeader } });
            if (!res.ok) return null;
            const data = await res.json().catch(() => ({}));
            if (data && Array.isArray(data.objects) && data.objects.length > 0) {
                return data.objects[0];
            }
            return null;
        } catch (err) {
            console.warn(`[PlivoService] Error fetching recording for ${callUuid}:`, err.message);
            return null;
        }
    }

    /**
     * Queries Plivo API for a specific recording by Recording ID.
     * @param {string} recordingId - Plivo Recording ID
     * @returns {Promise<object|null>}
     */
    static async fetchRecordingById(recordingId) {
        if (!recordingId || !this.isConfigured()) return null;
        try {
            const cfg = this.getConfig();
            const authHeader = 'Basic ' + Buffer.from(`${cfg.authId}:${cfg.authToken}`).toString('base64');
            const url = `https://api.plivo.com/v1/Account/${cfg.authId}/Recording/${encodeURIComponent(recordingId)}/`;
            const res = await fetch(url, { headers: { 'Authorization': authHeader } });
            if (!res.ok) return null;
            return await res.json().catch(() => null);
        } catch (err) {
            console.warn(`[PlivoService] Error fetching recording ID ${recordingId}:`, err.message);
            return null;
        }
    }

    /**
     * Verifies Plivo webhook request authenticity using Plivo Signature.
     */
    /**
     * Immediately terminates an active call via Plivo REST API.
     * @param {string} callUuid - The Plivo Call UUID
     * @returns {Promise<{success: boolean, message?: string, error?: string}>}
     */
    static async hangupCall(callUuid) {
        if (!callUuid) return { success: false, error: 'No Call UUID provided' };
        if (!this.isConfigured()) {
            console.log(`[PlivoService] Plivo not configured; simulated hangup for CallUUID: ${callUuid}`);
            return { success: true, simulated: true };
        }
        try {
            const cfg = this.getConfig();
            const url = `https://api.plivo.com/v1/Account/${cfg.authId}/Call/${callUuid}/`;
            const authHeader = 'Basic ' + Buffer.from(`${cfg.authId}:${cfg.authToken}`).toString('base64');
            console.log(`[PlivoService] Terminating call ${callUuid} via Plivo REST API...`);
            const res = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Authorization': authHeader
                }
            });
            if (res.status === 204 || res.ok) {
                console.log(`[PlivoService] Call ${callUuid} successfully terminated via Plivo REST API.`);
                return { success: true };
            } else {
                const text = await res.text().catch(() => '');
                console.warn(`[PlivoService] Plivo hangup HTTP ${res.status}: ${text}`);
                return { success: false, error: text };
            }
        } catch (err) {
            console.error('[PlivoService] Network error during Plivo hangup:', err.message);
            return { success: false, error: err.message };
        }
    }
}
