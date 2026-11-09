/**
 * Promise tracking and auto-callback.
 *
 * After every call REMO keeps the commitments made on it ("call me tomorrow at 5", "will send the resume by
 * Friday", "wants pricing on WhatsApp"). A callback with a time is dialled again by itself when it falls due;
 * the other promises are listed so nobody forgets them and show up as overdue when their date passes.
 *
 * Safety rules for the automatic call: only inside calling hours, never to someone who asked not to be called,
 * never for an admin whose minutes are finished, at most MAX_ATTEMPTS tries, and the admin can cancel or call now.
 */
import db, { utcNow, getDbEngine, ensureOwnerColumns } from './db.js';
import MinutesService from './minutes_service.js';

const MAX_ATTEMPTS = 2;
const RETRY_MINUTES = 30;
const STALE_CALL_MINUTES = 15;
const MIN_CONNECTED_SECONDS = 5;
const KINDS = ['callback', 'caller_action', 'agent_action'];

const num = (name, fallback, min, max) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
};
// Minutes ahead of UTC for the callers' clock (India = 330).
const tzOffsetMin = () => num('PROMISE_TZ_OFFSET_MIN', 330, -720, 840);
const startHour = () => num('PROMISE_CALL_START_HOUR', 9, 0, 23);
const endHour = () => num('PROMISE_CALL_END_HOUR', 20, 1, 24);
// Automatic callbacks allowed to one number in 24 hours.
// A safety net against loops, not a limit on real requests: each call already makes at most one callback.
const maxAutoPerDay = () => num('PROMISE_MAX_AUTO_PER_DAY', 5, 1, 10);

const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const DAY_PARTS = { morning: 10, subah: 10, udayam: 10, afternoon: 15, dopahar: 15, evening: 18, shaam: 18, sayantram: 18, night: 20, raat: 20, tonight: 20, noon: 12 };

let schemaReady = null;
export function ensurePromiseSchema() {
    if (!schemaReady) {
        schemaReady = (async () => {
            await ensureOwnerColumns();
            const engine = await getDbEngine();
            const tableOptions = engine === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
            await db.run(`CREATE TABLE IF NOT EXISTS call_promises (
                id VARCHAR(64) PRIMARY KEY,
                conversation_id VARCHAR(64),
                contact_id VARCHAR(64),
                owner_user_id VARCHAR(64),
                agent_id VARCHAR(64),
                service VARCHAR(32),
                phone VARCHAR(64) NOT NULL,
                contact_name VARCHAR(255),
                kind VARCHAR(24) NOT NULL DEFAULT 'callback',
                promise_text TEXT,
                due_text VARCHAR(255),
                due_at VARCHAR(64),
                auto_call INTEGER NOT NULL DEFAULT 0,
                status VARCHAR(16) NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                callback_contact_id VARCHAR(64),
                note TEXT,
                created_at VARCHAR(64) NOT NULL,
                updated_at VARCHAR(64) NOT NULL,
                done_at VARCHAR(64)
            )${tableOptions}`);
        })().catch((e) => { schemaReady = null; throw e; });
    }
    return schemaReady;
}

const newId = () => `prm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// ---------------------------------------------------------------- time reading

/**
 * Reads "tomorrow at 5 pm", "in 2 hours", "Friday morning", "kal shaam" ... into a moment in time.
 * Returns { dueMs, exact } or null when the words give no time at all. exact = a clock time was spoken.
 */
export function parseDue(text, nowMs = Date.now(), offsetMin = tzOffsetMin()) {
    const t = String(text || '').toLowerCase().replace(/\b([ap])\.m\b\.?/g, '$1m').replace(/[,.](?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    const shift = offsetMin * 60000;

    // Relative: "in 2 hours", "after 30 minutes", "in half an hour", "in a week"
    let m = t.match(/\b(?:in|after|within)\s+(?:about\s+|around\s+)?(half an|half a|\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/);
    if (m) {
        const unit = m[2][0] === 'm' ? 60000 : m[2][0] === 'h' ? 3600000 : m[2][0] === 'd' ? 86400000 : 604800000;
        const n = m[1].startsWith('half') ? 0.5 : (/^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUMBERS[m[1]]);
        if (n > 0) return { dueMs: nowMs + n * unit, exact: true };
    }

    const local = new Date(nowMs + shift);
    let dayOffset = null;
    if (/\bday after tomorrow\b|\bparso\b/.test(t)) dayOffset = 2;
    else if (/\btomorrow\b|\btmrw\b|\bkal\b|\brepu\b/.test(t)) dayOffset = 1;
    else if (/\btoday\b|\btonight\b|\baaj\b|\bivala\b|\bee roju\b/.test(t)) dayOffset = 0;
    else if (/\bnext week\b/.test(t)) dayOffset = 7;
    else {
        for (const [name, idx] of Object.entries(WEEKDAYS)) {
            if (new RegExp(`\\b${name}\\b`).test(t)) {
                let diff = (idx - local.getUTCDay() + 7) % 7;
                if (diff === 0) diff = 7;
                dayOffset = diff;
                break;
            }
        }
    }

    // Clock time: "5 pm", "5:30 pm", "17:30", "at 5", "noon", "evening"
    let hour = null;
    let minute = 0;
    let exact = false;
    m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?!\w)/);
    if (m) {
        hour = Number(m[1]) % 12 + (m[3][0] === 'p' ? 12 : 0);
        minute = Number(m[2] || 0);
        exact = true;
    } else if ((m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/))) {
        hour = Number(m[1]);
        minute = Number(m[2]);
        exact = true;
    } else if ((m = t.match(/\b(?:at|around|by|after|before)\s+(\d{1,2})(?!\d|\s*(?:minutes?|mins?|hours?|days?))/))) {
        let h = Number(m[1]);
        if (h >= 1 && h <= 12) {
            // A bare "at 5" in a calling conversation means business hours: 1-7 is the afternoon.
            if (h <= 7) h += 12;
            else if (h === 12) h = 12;
            hour = h;
            exact = true;
        }
    }
    if (hour === null) {
        for (const [word, h] of Object.entries(DAY_PARTS)) {
            if (new RegExp(`\\b${word}\\b`).test(t)) { hour = h; break; }
        }
    }
    if (hour === null && dayOffset === null) return null;
    if (hour === null) hour = 10;
    if (hour > 23 || minute > 59) return null;

    const base = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute, 0, 0);
    let dueLocal = base + (dayOffset || 0) * 86400000;
    // "at 5 pm" with no day, already gone today -> tomorrow. A day part alone ("evening") that is gone -> tomorrow.
    if (dayOffset === null && dueLocal <= local.getTime()) dueLocal += 86400000;
    if (dayOffset === 0 && dueLocal <= local.getTime() && !/\b(now|asap)\b/.test(t)) dueLocal += 86400000;
    return { dueMs: dueLocal - shift, exact };
}

/** True when the callers' clock is inside the hours we are allowed to ring people. */
export function insideCallingHours(ms = Date.now(), offsetMin = tzOffsetMin()) {
    const h = new Date(ms + offsetMin * 60000).getUTCHours();
    return h >= startHour() && h < endHour();
}

/** The next moment (at or after ms) that is inside calling hours. */
export function nextCallingTime(ms, offsetMin = tzOffsetMin()) {
    if (insideCallingHours(ms, offsetMin)) return ms;
    const shift = offsetMin * 60000;
    const local = new Date(ms + shift);
    let day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), startHour(), 0, 0, 0);
    if (day + shift <= ms) day += 86400000;
    return day - shift;
}

// ---------------------------------------------------------------- finding promises in a call

const EXTRACT_PROMPT = `You read a finished phone call between an AI agent (Remo) and a person, and list the promises made on it.
Return JSON only: {"promises":[{"kind":"callback"|"caller_action"|"agent_action","text":"short plain sentence","when":"the time words exactly as spoken, or empty"}]}
- callback: the person asked to be called again, or the agent promised to call back.
- caller_action: the person promised to do something (send a resume, reply, decide, pay).
- agent_action: the agent or company promised to do something (send pricing on WhatsApp, email details, book a visit).
Only real, specific commitments. No promise means {"promises":[]}. At most 4. Keep the person's language in "when".`;

// In a saved call the AI is "REMO" and the caller is labelled with their own name (or "Caller").
function isAgentLine(m) {
    return /^(remo|ai|agent|assistant)$/i.test(String((m && m.speaker) || '').trim());
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿఀ-౿]+/g, ' ').trim();

/**
 * What the PERSON said, minus echoes: when the phone line plays Remo's own words back, the speech reader hears
 * them as the caller. A longer "caller" line that is the same as (or inside) something Remo said is dropped.
 */
export function personTexts(history) {
    const list = (history || []).filter(Boolean);
    const agent = list.filter(isAgentLine).map((m) => norm(m.text)).filter((a) => a.length >= 12);
    return list
        .filter((m) => !isAgentLine(m))
        .map((m) => String(m.text || ''))
        .filter((t) => {
            const n = norm(t);
            if (!n) return false;
            return !(n.length >= 12 && agent.some((a) => a.includes(n) || n.includes(a)));
        });
}

// What a voicemail greeting or a phone company recording says. A machine never asks for a callback.
const VOICEMAIL_PATTERNS = [
    /\bleave (?:a |your |me a |us a )?(?:short |brief |detailed )?(?:message|number|name|details)\b/,
    /\bafter the (?:beep|tone)\b/,
    /\bvoice ?mail\b/,
    /\bmail ?box\b/,
    /\bat the (?:beep|tone)\b/,
    /\bnot available (?:right now|at the moment|to (?:take|answer))\b/,
    /\bunable to (?:take|answer) your call\b/,
    /\bmissed your call\b.*\b(?:leave|message|meeting|number)\b/,
    /\b(?:meeting|busy) or (?:on )?another call\b/,
    /\bperson you (?:are|have) (?:calling|called|dialled|dialed)\b/,
    /\bnumber you (?:have )?(?:dialled|dialed|called)\b/,
    /\b(?:switched off|out of coverage|not reachable|out of the service area)\b/,
    /\brecord your message\b/
];

/** True when the "person" on the call was a voicemail greeting or a network recording. */
export function looksLikeVoicemail(history) {
    return personTexts(history).some((t) => {
        const n = norm(t);
        return VOICEMAIL_PATTERNS.some((re) => re.test(n));
    });
}

function transcriptText(history) {
    return (history || []).map((m) => `${isAgentLine(m) ? 'Remo' : 'Person'}: ${m.text}`).join('\n').slice(0, 6000);
}

export class PromiseService {
    /** Replaced by tests. Returns [{kind,text,when}] read from the transcript by the AI. */
    static async llmExtract(history) {
        if (!history || history.length < 2) return [];
        const { default: LLMService } = await import('./llm_service.js');
        const res = await LLMService.generate({
            systemPrompt: EXTRACT_PROMPT,
            messages: [{ role: 'user', content: transcriptText(history) }],
            maxTokens: 400,
            temperature: 0,
            timeoutMs: 9000,
            jsonMode: true
        });
        const list = res && res.parsedJson && Array.isArray(res.parsedJson.promises) ? res.parsedJson.promises : [];
        return list;
    }

    /**
     * Works out the promises of one finished call. Pure: no database. The callback the caller asked for in the
     * extracted fields is trusted first (it has the caller's own words); the AI list adds the rest.
     */
    static async collect({ collectedData = {}, classification = '', history = [], summary = '', nowMs = Date.now() }) {
        const data = collectedData || {};
        if (data.opt_out === true || /do not call/i.test(String(classification || ''))) return [];
        // A voicemail greeting or network recording is not a person: it promises nothing and asks for no callback.
        if (looksLikeVoicemail(history)) return [];
        const out = [];
        const callbackWords = [data.callback_time, data.best_time_to_call].map((v) => String(v || '').trim()).find((v) => v && !/^(not_specified|none|n\/a|unknown)$/i.test(v));
        const wantsCallback = !!callbackWords || /callback requested/i.test(String(classification || ''));
        if (wantsCallback) {
            let words = callbackWords || '';
            let when = words ? parseDue(words, nowMs) : null;
            // The call did not record a time: read it from what the caller said (latest first), then from the summary.
            if (!when) {
                // Only short lines: a time request is a few words, a long "line" is a recording or noise.
                const said = personTexts(history).filter((t) => t.length <= 200).reverse();
                for (const line of [...said, String(summary || '')]) {
                    const found = line ? parseDue(line, nowMs) : null;
                    if (found) { when = found; words = line.trim().slice(0, 120); break; }
                }
            }
            out.push({
                kind: 'callback',
                text: words ? `Call back: ${words}` : 'Call back (no time was given)',
                dueText: words,
                dueMs: when ? when.dueMs : null,
                exact: !!when
            });
        }
        let ai = [];
        try { ai = await PromiseService.llmExtract(history); } catch (e) { console.warn('[Promises] AI read skipped:', e.message); }
        for (const p of ai.slice(0, 4)) {
            const kind = KINDS.includes(p && p.kind) ? p.kind : null;
            const text = String((p && p.text) || '').trim().slice(0, 300);
            if (!kind || !text) continue;
            const when = p.when ? parseDue(p.when, nowMs) : null;
            if (kind === 'callback') {
                // Already have a callback: only borrow the AI's time when ours had none.
                const mine = out.find((o) => o.kind === 'callback');
                if (mine && mine.dueMs === null && when) {
                    mine.dueMs = when.dueMs;
                    mine.exact = true;
                    mine.dueText = String(p.when || '').slice(0, 200);
                    mine.text = `Call back: ${mine.dueText}`;
                }
                if (mine) continue;
            }
            out.push({ kind, text, dueText: String(p.when || '').slice(0, 200), dueMs: when ? when.dueMs : null, exact: !!when });
        }
        // However many times the person said "call me ...", one call gives ONE callback. The same wish worded as
        // a note ("arrange a callback on Monday") is not listed again beside it.
        if (out.some((o) => o.kind === 'callback')) {
            return out.filter((o) => o.kind === 'callback' || !/\bcall(?:ing)?\s+(?:you\s+|him\s+|her\s+|them\s+|me\s+)?back\b|\bcallback\b|\bcall\s+(?:you|him|her|them|me)\b/i.test(o.text));
        }
        return out;
    }

    /** Saves the promises of one finished call. Never throws into the call-saving code. */
    static async captureForCall({ conversationId, contactId, ownerId, agentId, service, phone, contactName, collectedData, classification, history, summary, nowMs = Date.now() }) {
        try {
            if (!phone) return [];
            await ensurePromiseSchema();
            const found = await PromiseService.collect({ collectedData, classification, history, summary, nowMs });
            const saved = [];
            // Was this call itself a promised callback? Then "call me later" with no real time is not a new promise:
            // that is how one number could be rung again and again.
            let isCallbackCall = false;
            if (contactId) {
                const own = await db.get('SELECT batch_id FROM contacts WHERE id = ?', [contactId]).catch(() => null);
                isCallbackCall = !!(own && /^cbk_/.test(String(own.batch_id || '')));
            }
            for (const p of found) {
                if (p.kind === 'callback' && isCallbackCall && p.dueMs === null) continue;
                // A callback without a spoken time is tried the next morning; other promises without a date stay undated.
                let dueMs = p.dueMs;
                if (p.kind === 'callback') {
                    if (dueMs === null) dueMs = nowMs + 86400000;
                    dueMs = Math.max(dueMs, nowMs + 60000);
                    dueMs = nextCallingTime(dueMs);
                }
                const now = utcNow();
                if (p.kind === 'callback') {
                    // One waiting callback per number: a newer request moves the waiting one instead of adding another.
                    const waiting = await db.get(
                        "SELECT id FROM call_promises WHERE kind = 'callback' AND status = 'pending' AND SUBSTR(phone, -10) = ? ORDER BY created_at DESC LIMIT 1",
                        [last10(phone)]
                    );
                    if (waiting) {
                        await db.run(
                            'UPDATE call_promises SET conversation_id = ?, promise_text = ?, due_text = ?, due_at = ?, attempts = 0, updated_at = ? WHERE id = ?',
                            [conversationId || null, p.text, p.dueText || '', new Date(dueMs).toISOString(), now, waiting.id]
                        );
                        saved.push({ id: waiting.id, kind: 'callback', phone: String(phone), due_at: new Date(dueMs).toISOString(), merged: true });
                        continue;
                    }
                }
                const row = {
                    id: newId(), conversation_id: conversationId || null, contact_id: contactId || null,
                    owner_user_id: ownerId || null, agent_id: agentId || null, service: service || null,
                    phone: String(phone), contact_name: contactName || '', kind: p.kind, promise_text: p.text,
                    due_text: p.dueText || '', due_at: dueMs === null ? null : new Date(dueMs).toISOString(),
                    auto_call: p.kind === 'callback' ? 1 : 0
                };
                await db.run(
                    `INSERT INTO call_promises (id, conversation_id, contact_id, owner_user_id, agent_id, service, phone, contact_name, kind, promise_text, due_text, due_at, auto_call, status, attempts, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
                    [row.id, row.conversation_id, row.contact_id, row.owner_user_id, row.agent_id, row.service, row.phone, row.contact_name, row.kind, row.promise_text, row.due_text, row.due_at, row.auto_call, now, now]
                );
                saved.push(row);
            }
            if (saved.length) console.log(`[Promises] ${saved.length} promise(s) saved for ${conversationId}`);
            return saved;
        } catch (e) {
            console.warn('[Promises] Could not save promises:', e.message);
            return [];
        }
    }

    // ------------------------------------------------------------ listing and changes (dashboard)

    static async list(ownerId, { status = '', kind = '', page = 1, limit = 25 } = {}) {
        await ensurePromiseSchema();
        const where = ['owner_user_id = ?'];
        const params = [ownerId];
        if (status === 'open') where.push("status IN ('pending', 'queued', 'calling')");
        else if (status) { where.push('status = ?'); params.push(status); }
        if (kind) { where.push('kind = ?'); params.push(kind); }
        const size = Math.min(100, Math.max(1, Number(limit) || 25));
        const offset = (Math.max(1, Number(page) || 1) - 1) * size;
        const total = await db.get(`SELECT COUNT(*) AS n FROM call_promises WHERE ${where.join(' AND ')}`, params);
        const rows = await db.all(
            `SELECT * FROM call_promises WHERE ${where.join(' AND ')} ORDER BY (due_at IS NULL), due_at ASC, created_at DESC LIMIT ${size} OFFSET ${offset}`,
            params
        );
        const now = Date.now();
        return {
            total: Number(total ? total.n : 0),
            items: rows.map((r) => PromiseService.view(r, now))
        };
    }

    static async counts(ownerId) {
        await ensurePromiseSchema();
        const rows = await db.all('SELECT status, due_at FROM call_promises WHERE owner_user_id = ?', [ownerId]);
        const now = Date.now();
        const open = rows.filter((r) => ['pending', 'queued', 'calling'].includes(r.status));
        return {
            open: open.length,
            overdue: open.filter((r) => r.due_at && Date.parse(r.due_at) < now - 3600000).length,
            done: rows.filter((r) => r.status === 'done').length,
            missed: rows.filter((r) => r.status === 'missed').length
        };
    }

    static view(r, now = Date.now()) {
        const open = ['pending', 'queued', 'calling'].includes(r.status);
        return {
            id: r.id, conversationId: r.conversation_id, kind: r.kind, text: r.promise_text, dueText: r.due_text || '',
            dueAt: r.due_at, autoCall: !!Number(r.auto_call), status: r.status, attempts: Number(r.attempts || 0),
            name: r.contact_name, phone: r.phone, service: r.service, note: r.note || '',
            overdue: open && !!r.due_at && Date.parse(r.due_at) < now - (r.auto_call ? 3600000 : 0),
            createdAt: r.created_at, doneAt: r.done_at
        };
    }

    static async getOwned(ownerId, id) {
        await ensurePromiseSchema();
        return db.get('SELECT * FROM call_promises WHERE id = ? AND owner_user_id = ?', [id, ownerId]);
    }

    /** action: done | cancel | reopen | reschedule (needs dueAt) | auto (turns the automatic call on/off). */
    static async update(ownerId, id, { action, dueAt, autoCall } = {}) {
        const row = await PromiseService.getOwned(ownerId, id);
        if (!row) return null;
        const now = utcNow();
        if (action === 'done') await db.run("UPDATE call_promises SET status = 'done', done_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
        else if (action === 'cancel') await db.run("UPDATE call_promises SET status = 'cancelled', updated_at = ? WHERE id = ?", [now, id]);
        else if (action === 'reopen') await db.run("UPDATE call_promises SET status = 'pending', attempts = 0, done_at = NULL, updated_at = ? WHERE id = ?", [now, id]);
        else if (action === 'reschedule') {
            const ms = Date.parse(dueAt);
            if (!Number.isFinite(ms)) { const e = new Error('Choose a valid date and time.'); e.status = 400; throw e; }
            await db.run("UPDATE call_promises SET due_at = ?, status = 'pending', attempts = 0, updated_at = ? WHERE id = ?", [new Date(ms).toISOString(), now, id]);
        } else if (action === 'auto') {
            if (row.kind !== 'callback') { const e = new Error('Only callbacks can be dialled automatically.'); e.status = 400; throw e; }
            await db.run('UPDATE call_promises SET auto_call = ?, updated_at = ? WHERE id = ?', [autoCall ? 1 : 0, now, id]);
        } else { const e = new Error('Unknown action.'); e.status = 400; throw e; }
        return PromiseService.view(await PromiseService.getOwned(ownerId, id));
    }

    // ------------------------------------------------------------ the automatic callback

    /**
     * True when the person asked not to be called AFTER the callback was promised. Their latest word wins: an
     * old "do not call" from an earlier call does not block a callback they asked for later (sinceIso = when
     * they asked). Without sinceIso any "do not call" blocks.
     */
    static async isDoNotCall(phone, sinceIso = '') {
        const tail = last10(phone);
        if (!tail) return false;
        const later = (stamp) => !sinceIso || String(stamp || '') > sinceIso;
        const rows = await db.all(
            "SELECT phone, created_at FROM conversations WHERE classification = 'Do Not Call' ORDER BY created_at DESC LIMIT 500"
        ).catch(() => []);
        if (rows.some((r) => last10(r.phone) === tail && later(r.created_at))) return true;
        const contacts = await db.all("SELECT phone, updated_at FROM contacts WHERE classification = 'Do Not Call' LIMIT 500").catch(() => []);
        return contacts.some((r) => last10(r.phone) === tail && later(r.updated_at));
    }

    /** Puts one callback into the normal call queue (a fresh contact in the owner's "Callbacks" batch). */
    static async queueCallback(row, nowMs = Date.now()) {
        const now = new Date(nowMs).toISOString();
        const batchId = `cbk_${String(row.owner_user_id || 'shared').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40)}`;
        const service = row.service || 'recruitment';
        const existing = await db.get('SELECT id FROM batches WHERE id = ?', [batchId]);
        if (!existing) {
            await db.run(
                `INSERT INTO batches (id, service, filename, original_path, status, total_rows, valid_rows, invalid_rows, created_at, updated_at, owner_user_id)
                 VALUES (?, ?, 'Callbacks (promised)', NULL, 'IN_PROGRESS', 0, 0, 0, ?, ?, ?)`,
                [batchId, service, now, now, row.owner_user_id || null]
            );
        } else {
            await db.run("UPDATE batches SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?", [now, batchId]);
        }
        const contactId = `cnt_cb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const raw = JSON.stringify({ name: row.contact_name, phone: row.phone, callback_for: row.promise_text });
        await db.run(
            `INSERT INTO contacts (id, batch_id, service, row_index, raw_data, name, phone, preferred_language, notes, extra_data, validation_status, validation_errors, call_status, updated_at, owner_user_id)
             VALUES (?, ?, ?, 0, ?, ?, ?, 'en', ?, '{}', 'VALID', '[]', 'PENDING', ?, ?)`,
            [contactId, batchId, service, raw, row.contact_name || 'Caller', row.phone, `Promised callback: ${row.promise_text}`, now, row.owner_user_id || null]
        );
        if (row.agent_id) await db.run('UPDATE contacts SET agent_id = ? WHERE id = ?', [row.agent_id, contactId]).catch(() => {});
        await db.run(
            "INSERT INTO call_queue (id, batch_id, contact_id, service, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, 'QUEUED', 5, ?, ?)",
            [`q_${Math.random().toString(36).slice(2, 9)}`, batchId, contactId, service, now, now]
        );
        const { default: CallQueueWorker } = await import('./call_queue_worker.js');
        CallQueueWorker._startLoop();
        return contactId;
    }

    /** One pass: dial what is due and settle what was dialled. Safe to call every minute. */
    static async processDue(nowMs = Date.now()) {
        await ensurePromiseSchema();
        const result = { dialled: 0, retried: 0, done: 0, missed: 0, blocked: 0, cancelled: 0, deferred: 0 };

        // 1) Settle calls that were dialled earlier.
        const calling = await db.all("SELECT * FROM call_promises WHERE status IN ('queued', 'calling')");
        for (const p of calling) {
            const ct = p.callback_contact_id ? await db.get('SELECT call_status, duration_seconds, updated_at FROM contacts WHERE id = ?', [p.callback_contact_id]) : null;
            const stamp = new Date(nowMs).toISOString();
            const age = nowMs - Date.parse(p.updated_at || stamp);
            let outcome = null;
            if (!ct) outcome = 'failed';
            else if (ct.call_status === 'COMPLETED') outcome = Number(ct.duration_seconds || 0) >= MIN_CONNECTED_SECONDS ? 'connected' : 'failed';
            else if (['FAILED', 'CANCELLED', 'SKIPPED'].includes(ct.call_status)) outcome = 'failed';
            else if (age > STALE_CALL_MINUTES * 60000) outcome = 'failed';
            if (!outcome) continue;
            if (outcome === 'connected') {
                await db.run("UPDATE call_promises SET status = 'done', done_at = ?, note = ?, updated_at = ? WHERE id = ?", [stamp, 'Called back and spoke to them.', stamp, p.id]);
                result.done++;
            } else if (Number(p.attempts) >= MAX_ATTEMPTS) {
                await db.run("UPDATE call_promises SET status = 'missed', note = ?, updated_at = ? WHERE id = ?", [`Not reached after ${p.attempts} tries.`, stamp, p.id]);
                result.missed++;
            } else {
                const retryAt = nextCallingTime(nowMs + RETRY_MINUTES * 60000);
                await db.run("UPDATE call_promises SET status = 'pending', due_at = ?, note = ?, updated_at = ? WHERE id = ?", [new Date(retryAt).toISOString(), `Not answered, trying again.`, stamp, p.id]);
                result.retried++;
            }
        }

        // 2) Dial what is due, inside calling hours only.
        if (!insideCallingHours(nowMs)) return result;
        const { default: CallQueueWorker } = await import('./call_queue_worker.js');
        const due = await db.all(
            "SELECT * FROM call_promises WHERE status = 'pending' AND kind = 'callback' AND auto_call = 1 AND due_at IS NOT NULL AND due_at <= ? ORDER BY due_at ASC LIMIT 20",
            [new Date(nowMs).toISOString()]
        );
        for (const p of due) {
            const stamp = new Date(nowMs).toISOString();
            if (CallQueueWorker.isPaused || (p.owner_user_id && CallQueueWorker.pausedOwners.has(p.owner_user_id))) continue;
            if (await PromiseService.isDoNotCall(p.phone, p.created_at)) {
                await db.run("UPDATE call_promises SET status = 'cancelled', note = ?, updated_at = ? WHERE id = ?", ['They asked not to be called.', stamp, p.id]);
                result.cancelled++;
                continue;
            }
            if (p.owner_user_id && await MinutesService.isExhausted(p.owner_user_id)) {
                await db.run("UPDATE call_promises SET status = 'blocked', note = ?, updated_at = ? WHERE id = ?", ['Assigned calling minutes are finished.', stamp, p.id]);
                result.blocked++;
                continue;
            }
            // A call to the same number is already waiting or running: do not ring twice.
            const busy = await db.get(
                "SELECT cq.id FROM call_queue cq JOIN contacts c ON c.id = cq.contact_id WHERE cq.status IN ('QUEUED', 'IN_PROGRESS') AND SUBSTR(c.phone, -10) = ? LIMIT 1",
                [last10(p.phone)]
            );
            if (busy) continue;
            // At most PROMISE_MAX_AUTO_PER_DAY automatic callbacks per number in 24 hours (a retry of the same
            // promise does not count). Over the limit the callback waits for the window to pass; it is not lost.
            const sinceIso = new Date(nowMs - 86400000).toISOString();
            const recent = await db.all(
                "SELECT updated_at FROM contacts WHERE batch_id LIKE 'cbk%' AND SUBSTR(phone, -10) = ? AND id != ? AND call_status IN ('PENDING', 'CALLING', 'COMPLETED') AND updated_at >= ? ORDER BY updated_at DESC",
                [last10(p.phone), p.callback_contact_id || '', sinceIso]
            ).catch(() => []);
            if (recent.length >= maxAutoPerDay()) {
                const freeAt = nextCallingTime(Date.parse(recent[0].updated_at) + 86400000);
                await db.run("UPDATE call_promises SET due_at = ?, note = ?, updated_at = ? WHERE id = ?", [new Date(freeAt).toISOString(), 'Already called back today; waiting before the next automatic call.', stamp, p.id]);
                result.deferred++;
                continue;
            }
            // Claim it first, in one step. If a second runner (the live server and a local one share this database)
            // sees the same due callback, only the one whose UPDATE changes a row may queue the call.
            const claim = await db.run("UPDATE call_promises SET status = 'queued', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'", [stamp, p.id]);
            if (!claim || !claim.changes) continue;
            try {
                const contactId = await PromiseService.queueCallback(p, nowMs);
                await db.run("UPDATE call_promises SET callback_contact_id = ?, note = NULL, updated_at = ? WHERE id = ?", [contactId, stamp, p.id]);
                result.dialled++;
            } catch (e) {
                console.warn('[Promises] Could not queue the callback:', e.message);
                await db.run("UPDATE call_promises SET status = 'pending', attempts = attempts - 1, updated_at = ? WHERE id = ? AND callback_contact_id IS NULL", [stamp, p.id]).catch(() => {});
            }
        }
        return result;
    }

    /** Every minute. Does nothing in tests (they call processDue themselves). */
    static start() {
        if (PromiseService.timer) return;
        const tick = () => PromiseService.processDue().catch((e) => console.warn('[Promises] tick failed:', e.message));
        PromiseService.timer = setInterval(tick, 60000);
        if (PromiseService.timer.unref) PromiseService.timer.unref();
        setTimeout(tick, 15000).unref?.();
    }
}

export default PromiseService;
