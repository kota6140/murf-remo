import crypto from 'crypto';
import db, { utcNow, getDbEngine } from './db.js';

/**
 * services/agent_service.js
 *
 * Multi-agent support. The owner creates any number of agents. Each agent has a Plivo
 * phone number, a work type, its own greeting and instructions, and an optional ElevenLabs
 * voice. Several agents can share one number. Agents are assigned to admins: one admin can
 * have many agents and one agent can be given to several admins (table agent_admins).
 *
 * Outgoing calls use the chosen agent's number as caller ID. Incoming calls to a number are
 * answered by that number's default agent (inbound_default), else its oldest active agent,
 * and belong to that agent's main admin (assigned_user_id).
 */

export const AGENT_SERVICES = ['recruitment', 'sales', 'support', 'appointment', 'receptionist'];

// Work types that have no contact-sheet campaigns of their own. When one of these agents takes a call
// (incoming or outgoing) the call is handled as that work type.
export const AGENT_ONLY_SERVICES = ['appointment', 'receptionist'];

export class AgentError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

const COLUMNS = 'id, name, phone_number, service, greeting, instructions, voice_id, assigned_user_id, created_by_user_id, status, inbound_default, created_at, updated_at';

let schemaReady = null;
export function ensureAgentSchema() {
    if (!schemaReady) {
        schemaReady = (async () => {
            const engine = await getDbEngine();
            // Same table options as the rest of the MySQL schema, so Telugu/Hindi greetings are stored correctly.
            const tableOptions = engine === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
            await db.run(`CREATE TABLE IF NOT EXISTS agents (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                phone_number VARCHAR(32) NOT NULL,
                service VARCHAR(32) NOT NULL DEFAULT 'recruitment',
                greeting TEXT,
                instructions TEXT,
                voice_id VARCHAR(64),
                assigned_user_id VARCHAR(64),
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                created_at VARCHAR(64) NOT NULL,
                updated_at VARCHAR(64) NOT NULL
            )${tableOptions}`);
            // One agent can be given to several admins. assigned_user_id on the agent stays as the "main" admin
            // (the first one), which owns incoming calls.
            await db.run(`CREATE TABLE IF NOT EXISTS agent_admins (
                agent_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NOT NULL,
                created_at VARCHAR(64) NOT NULL,
                PRIMARY KEY (agent_id, user_id)
            )${tableOptions}`);
            // Phone numbers the owner has approved; an admin can only build agents on these.
            let firstTime = false;
            try { await db.get('SELECT 1 FROM approved_numbers LIMIT 1'); } catch { firstTime = true; }
            if (firstTime) {
                await db.run(`CREATE TABLE IF NOT EXISTS approved_numbers (
                    phone_number VARCHAR(32) PRIMARY KEY,
                    label VARCHAR(255),
                    created_at VARCHAR(64) NOT NULL
                )${tableOptions}`);
            }
            const addColumns = [
                ['agents', 'created_by_user_id', 'VARCHAR(64) NULL'],
                ['agents', 'inbound_default', 'INTEGER NOT NULL DEFAULT 0'],
                ['contacts', 'agent_id', 'VARCHAR(64) NULL'],
                ['batches', 'agent_id', 'VARCHAR(64) NULL'],
                ['campaigns', 'agent_id', 'VARCHAR(64) NULL'],
                ['conversations', 'agent_id', 'VARCHAR(64) NULL'],
                ['conversations', 'direction', 'VARCHAR(16) NULL']
            ];
            for (const [table, column, type] of addColumns) {
                try {
                    await db.get(`SELECT ${column} FROM ${table} LIMIT 1`);
                } catch {
                    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).catch(() => {});
                }
            }
            // The first time the list exists, the numbers the owner's agents already use are approved.
            if (firstTime) {
                await db.run(`INSERT INTO approved_numbers (phone_number, label, created_at)
                    SELECT DISTINCT phone_number, '', MIN(created_at) FROM agents GROUP BY phone_number`).catch(() => {});
            }
            // Agents made before several admins were allowed keep their admin.
            await db.run(`INSERT INTO agent_admins (agent_id, user_id, created_at)
                SELECT a.id, a.assigned_user_id, a.created_at FROM agents a
                WHERE a.assigned_user_id IS NOT NULL AND a.assigned_user_id != ''
                AND NOT EXISTS (SELECT 1 FROM agent_admins x WHERE x.agent_id = a.id AND x.user_id = a.assigned_user_id)`).catch(() => {});
        })().catch((e) => { schemaReady = null; throw e; });
    }
    return schemaReady;
}

/** Digits only, Indian numbers get the 91 prefix. The same form Plivo reports in From/To. */
export function normalizeNumber(phone) {
    let clean = String(phone || '').trim().replace(/[\s\-()]/g, '');
    if (clean.startsWith('+')) clean = clean.slice(1);
    if (/^0[6-9]\d{9}$/.test(clean)) clean = '91' + clean.slice(1);
    else if (/^[6-9]\d{9}$/.test(clean)) clean = '91' + clean;
    return clean;
}

// Small read cache so the voice session can load its agent without delaying the greeting.
const cache = new Map();
const CACHE_MS = 30 * 1000;
const forget = (id) => { if (id) cache.delete(id); };

function present(row, adminIds = null) {
    if (!row) return null;
    let ids = adminIds || (row.assigned_user_id ? [row.assigned_user_id] : []);
    // The main admin (assigned_user_id) always comes first.
    if (row.assigned_user_id && ids.includes(row.assigned_user_id)) ids = [row.assigned_user_id, ...ids.filter((u) => u !== row.assigned_user_id)];
    return { ...row, status: row.status || 'active', inbound_default: Number(row.inbound_default) ? 1 : 0, admin_ids: ids };
}

/** Admins of each agent, oldest first (the first one is the agent's main admin). */
async function adminsOf(agentIds) {
    const map = new Map();
    if (!agentIds.length) return map;
    const rows = await db.all(
        `SELECT agent_id, user_id FROM agent_admins WHERE agent_id IN (${agentIds.map(() => '?').join(',')}) ORDER BY created_at, user_id`, agentIds);
    for (const r of rows) {
        if (!map.has(r.agent_id)) map.set(r.agent_id, []);
        map.get(r.agent_id).push(r.user_id);
    }
    return map;
}

async function presentAll(rows) {
    const map = await adminsOf(rows.map((r) => r.id));
    return rows.map((r) => present(r, map.get(r.id) || []));
}

const last10 = (n) => String(n || '').slice(-10);

/** The admins named in a request body: assignedUserIds (list) and/or the older single assignedUserId. */
function adminIdsFrom(body = {}) {
    const list = Array.isArray(body.assignedUserIds) ? body.assignedUserIds : [];
    if (body.assignedUserId) list.push(body.assignedUserId);
    return [...new Set(list.map((u) => String(u || '').trim()).filter(Boolean))];
}

/** How much text an agent's greeting and instructions can hold (the owner panel shows the same numbers). */
export const AGENT_LIMITS = { greeting: 1000, instructions: 6000 };

/** Rejects text over the limit instead of cutting it off, so part of an owner's instructions is never lost silently. */
function limitedText(value, subject, max) {
    const text = value.trim();
    if (text.length > max) {
        throw new AgentError(`${subject} too long: ${text.length.toLocaleString('en-US')} characters. The limit is ${max.toLocaleString('en-US')} characters (about ${Math.floor(max / 6).toLocaleString('en-US')} words).`);
    }
    return text;
}

export function cleanFields(body, { requireAll }) {
    const f = {};
    if (typeof body.name === 'string') f.name = body.name.trim();
    if (typeof body.phoneNumber === 'string') f.phone_number = normalizeNumber(body.phoneNumber);
    if (typeof body.service === 'string') f.service = body.service.trim().toLowerCase();
    if (typeof body.greeting === 'string') f.greeting = limitedText(body.greeting, 'The greeting is', AGENT_LIMITS.greeting);
    if (typeof body.instructions === 'string') f.instructions = limitedText(body.instructions, 'The instructions are', AGENT_LIMITS.instructions);
    if (typeof body.voiceId === 'string') f.voice_id = body.voiceId.trim().slice(0, 64);
    if (typeof body.status === 'string') f.status = body.status === 'disabled' ? 'disabled' : 'active';

    if (requireAll || f.name !== undefined) {
        if (!f.name || f.name.length < 2) throw new AgentError('Agent name is required (at least 2 characters).');
    }
    if (requireAll || f.phone_number !== undefined) {
        if (!/^\d{8,15}$/.test(f.phone_number || '')) throw new AgentError('Enter the agent phone number with country code, for example +91 80 1234 5678.');
    }
    if (requireAll && !f.service) f.service = 'recruitment';
    if (f.service !== undefined && !AGENT_SERVICES.includes(f.service)) {
        throw new AgentError('Work type must be recruitment, sales, support, appointment or receptionist.');
    }
    return f;
}

export default class AgentService {
    static async list({ userId = null, activeOnly = false } = {}) {
        await ensureAgentSchema();
        const where = [];
        const params = [];
        // An admin's agents: the ones the owner gave them and the ones they created themselves.
        if (userId) { where.push('(id IN (SELECT agent_id FROM agent_admins WHERE user_id = ?) OR created_by_user_id = ?)'); params.push(userId, userId); }
        if (activeOnly) where.push("status = 'active'");
        const rows = await db.all(
            `SELECT ${COLUMNS} FROM agents ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`, params);
        return presentAll(rows);
    }

    static async get(id, { fresh = false } = {}) {
        if (!id) return null;
        const hit = cache.get(id);
        if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.agent;
        await ensureAgentSchema();
        const row = await db.get(`SELECT ${COLUMNS} FROM agents WHERE id = ?`, [id]);
        const agent = row ? (await presentAll([row]))[0] : null;
        cache.set(id, { agent, at: Date.now() });
        return agent;
    }

    /**
     * Any number of agents may share one phone number (same or different work types, same or different admins).
     * body.assignedUserIds (list) or body.assignedUserId gives the agent to admins; body.inboundDefault makes it
     * the agent that answers incoming calls on its number.
     */
    static async create(body) {
        await ensureAgentSchema();
        const f = cleanFields(body || {}, { requireAll: true });
        const now = utcNow();
        const id = `agt_${crypto.randomBytes(6).toString('hex')}`;
        const adminIds = adminIdsFrom(body);
        // An admin's own agent always belongs to that admin (they are its main admin).
        const creator = body.createdByUserId ? String(body.createdByUserId) : null;
        if (creator && !adminIds.includes(creator)) adminIds.unshift(creator);
        await db.run(
            `INSERT INTO agents (id, name, phone_number, service, greeting, instructions, voice_id, assigned_user_id, created_by_user_id, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, f.name, f.phone_number, f.service, f.greeting || '', f.instructions || '', f.voice_id || '',
                adminIds[0] || null, creator, f.status || 'active', now, now]);
        await this._writeAdmins(id, adminIds);
        if (body.inboundDefault === true || body.inboundDefault === 'on' || body.inboundDefault === 'true') await this.setInboundDefault(id);
        return this.get(id, { fresh: true });
    }

    static async update(id, body) {
        await ensureAgentSchema();
        const existing = await this.get(id, { fresh: true });
        if (!existing) throw new AgentError('Agent not found.', 404);
        const f = cleanFields(body || {}, { requireAll: false });
        const keys = Object.keys(f);
        if (keys.length) {
            const sets = keys.map((k) => `${k} = ?`).join(', ');
            await db.run(`UPDATE agents SET ${sets}, updated_at = ? WHERE id = ?`, [...keys.map((k) => f[k]), utcNow(), id]);
        }
        if (body && body.inboundDefault !== undefined) {
            const on = body.inboundDefault === true || body.inboundDefault === 'on' || body.inboundDefault === 'true';
            if (on) await this.setInboundDefault(id);
            else await db.run('UPDATE agents SET inbound_default = 0, updated_at = ? WHERE id = ?', [utcNow(), id]);
        }
        forget(id);
        return this.get(id, { fresh: true });
    }

    /** This agent answers incoming calls on its number; the other agents on that number stop being the default. */
    static async setInboundDefault(id) {
        const agent = await this.get(id, { fresh: true });
        if (!agent) throw new AgentError('Agent not found.', 404);
        const rows = await db.all('SELECT id, phone_number FROM agents');
        for (const r of rows) {
            if (r.id !== id && last10(r.phone_number) === last10(agent.phone_number)) {
                await db.run('UPDATE agents SET inbound_default = 0 WHERE id = ?', [r.id]);
                forget(r.id);
            }
        }
        await db.run('UPDATE agents SET inbound_default = 1, updated_at = ? WHERE id = ?', [utcNow(), id]);
        forget(id);
    }

    /** Replaces the agent's admins with this list (the first is the main admin). */
    static async _writeAdmins(id, userIds) {
        await db.run('DELETE FROM agent_admins WHERE agent_id = ?', [id]);
        const now = utcNow();
        for (const u of userIds) {
            await db.run('INSERT INTO agent_admins (agent_id, user_id, created_at) VALUES (?, ?, ?)', [id, u, now]);
        }
        await db.run('UPDATE agents SET assigned_user_id = ?, updated_at = ? WHERE id = ?', [userIds[0] || null, now, id]);
        forget(id);
    }

    static async remove(id) {
        await ensureAgentSchema();
        const existing = await this.get(id, { fresh: true });
        if (!existing) throw new AgentError('Agent not found.', 404);
        await db.run('DELETE FROM agents WHERE id = ?', [id]);
        await db.run('DELETE FROM agent_admins WHERE agent_id = ?', [id]).catch(() => {});
        // Contacts that were stamped with this agent fall back to the admin's default agent.
        await db.run('UPDATE contacts SET agent_id = NULL WHERE agent_id = ?', [id]).catch(() => {});
        await db.run('UPDATE batches SET agent_id = NULL WHERE agent_id = ?', [id]).catch(() => {});
        await db.run('UPDATE campaigns SET agent_id = NULL WHERE agent_id = ?', [id]).catch(() => {});
        forget(id);
    }

    // ── numbers the owner approved for admins ──

    static async listApprovedNumbers() {
        await ensureAgentSchema();
        return db.all('SELECT phone_number, label, created_at FROM approved_numbers ORDER BY created_at, phone_number');
    }

    static async isApprovedNumber(phoneNumber) {
        const n = normalizeNumber(phoneNumber);
        if (!n) return false;
        const rows = await this.listApprovedNumbers();
        return rows.some((r) => r.phone_number === n || last10(r.phone_number) === last10(n));
    }

    static async addApprovedNumber(phoneNumber, label = '') {
        await ensureAgentSchema();
        const n = normalizeNumber(phoneNumber);
        if (!/^\d{8,15}$/.test(n)) throw new AgentError('Enter the phone number with country code, for example +91 80 1234 5678.');
        if (await this.isApprovedNumber(n)) throw new AgentError('That number is already approved.');
        await db.run('INSERT INTO approved_numbers (phone_number, label, created_at) VALUES (?, ?, ?)',
            [n, String(label || '').trim().slice(0, 255), utcNow()]);
        return this.listApprovedNumbers();
    }

    /** Takes a number off the approved list. Agents already on it keep working; admins just cannot pick it for new ones. */
    static async removeApprovedNumber(phoneNumber) {
        await ensureAgentSchema();
        await db.run('DELETE FROM approved_numbers WHERE phone_number = ?', [normalizeNumber(phoneNumber)]);
        return this.listApprovedNumbers();
    }

    // ── an admin's own agents ──

    /** Admin creates an agent: only on an approved number, and only for themselves. Never sets a voice, default or other admins. */
    static async createForAdmin(userId, body = {}) {
        const f = cleanFields(body, { requireAll: true });
        if (!(await this.isApprovedNumber(f.phone_number))) {
            throw new AgentError('Pick one of the phone numbers approved for your account.', 403);
        }
        return this.create({
            name: body.name, phoneNumber: body.phoneNumber, service: body.service,
            greeting: body.greeting, instructions: body.instructions, status: body.status,
            createdByUserId: userId
        });
    }

    /** Admin edits an agent they created or one the owner gave them (name, number, work type, greeting, instructions, on/off). */
    static async updateForAdmin(userId, id, body = {}) {
        const existing = await this.get(id, { fresh: true });
        if (!existing || !(existing.created_by_user_id === userId || (existing.admin_ids || []).includes(userId))) {
            throw new AgentError('You can only change your own agents or agents given to you.', 403);
        }
        const allowed = {};
        for (const k of ['name', 'phoneNumber', 'service', 'greeting', 'instructions', 'status']) {
            if (body[k] !== undefined) allowed[k] = body[k];
        }
        // The number only has to be approved when it is being changed.
        if (typeof allowed.phoneNumber === 'string' && normalizeNumber(allowed.phoneNumber) !== existing.phone_number
            && !(await this.isApprovedNumber(allowed.phoneNumber))) {
            throw new AgentError('Pick one of the phone numbers approved for your account.', 403);
        }
        return this.update(id, allowed);
    }

    static async removeForAdmin(userId, id) {
        const existing = await this.get(id, { fresh: true });
        if (!existing || existing.created_by_user_id !== userId) {
            throw new AgentError('You can only delete agents you created.', 403);
        }
        return this.remove(id);
    }

    /** Gives an agent to one admin only (or takes it back with userId = null). */
    static async assign(id, userId) {
        return this.setAdmins(id, userId ? [userId] : []);
    }

    /** Gives an agent to exactly these admins (the first is the main admin that owns incoming calls). */
    static async setAdmins(id, userIds) {
        await ensureAgentSchema();
        const existing = await this.get(id, { fresh: true });
        if (!existing) throw new AgentError('Agent not found.', 404);
        await this._writeAdmins(id, adminIdsFrom({ assignedUserIds: userIds || [] }));
        return this.get(id, { fresh: true });
    }

    /** Makes exactly this list of agents belong to the admin. Other admins keep the agents they already share. */
    static async setAgentsForUser(userId, agentIds) {
        await ensureAgentSchema();
        const wanted = new Set((agentIds || []).map(String));
        const all = await this.list();
        for (const a of all) {
            const mine = a.admin_ids.includes(userId);
            if (wanted.has(a.id) && !mine) await this.setAdmins(a.id, [...a.admin_ids, userId]);
            else if (!wanted.has(a.id) && mine) await this.setAdmins(a.id, a.admin_ids.filter((u) => u !== userId));
        }
        return this.list({ userId });
    }

    static async releaseUser(userId) {
        await ensureAgentSchema();
        const mine = await this.list({ userId });
        for (const a of mine) await this.setAdmins(a.id, a.admin_ids.filter((u) => u !== userId));
        cache.clear();
    }

    /**
     * Incoming calls: which agent answers the number that was dialled? Several agents can share a number:
     * the one marked as the incoming-call default, otherwise the oldest active one.
     */
    static async findByNumber(dialled) {
        const num = normalizeNumber(dialled);
        if (!num) return null;
        await ensureAgentSchema();
        const rows = await db.all(`SELECT ${COLUMNS} FROM agents WHERE status = 'active' ORDER BY created_at, id`);
        let onNumber = rows.filter((r) => r.phone_number === num);
        if (!onNumber.length) onNumber = rows.filter((r) => last10(r.phone_number) === last10(num));
        const chosen = onNumber.find((r) => Number(r.inbound_default)) || onNumber[0];
        if (!chosen) return null;
        const agent = (await presentAll([chosen]))[0];
        cache.set(agent.id, { agent, at: Date.now() });
        return agent;
    }

    /**
     * Outgoing calls: which agent should this admin's call use?
     * - an explicit agentId must be one of the admin's active agents
     * - otherwise the admin's first active agent whose work type matches the campaign
     * - no matching agent, or an admin with no agents: the shared number (returns null)
     */
    static async resolveForOutbound(ownerId, { service = '', agentId = '' } = {}) {
        if (!ownerId) return null;
        const mine = await this.list({ userId: ownerId, activeOnly: true });
        if (!mine.length) {
            if (agentId) throw new AgentError('That agent is not assigned to you.', 403);
            return null;
        }
        if (agentId) {
            const picked = mine.find((a) => a.id === agentId);
            if (!picked) throw new AgentError('That agent is not assigned to you, or it is switched off.', 403);
            return picked;
        }
        const wanted = String(service || '').toLowerCase();
        return mine.find((a) => a.service === wanted) || null;
    }

    /** Remember the agent on a contact sheet and all of its contacts before calling starts. */
    static async stampBatch(batchId, agent) {
        if (!batchId) return;
        await ensureAgentSchema();
        const id = agent ? agent.id : null;
        await db.run('UPDATE batches SET agent_id = ? WHERE id = ?', [id, batchId]);
        await db.run("UPDATE contacts SET agent_id = ? WHERE batch_id = ? AND call_status = 'PENDING'", [id, batchId]);
    }

    /** Picks the agent for one queued contact at dial time. */
    static async resolveForContact(contact) {
        if (!contact) return null;
        await ensureAgentSchema();
        if (contact.agent_id) {
            const stamped = await this.get(contact.agent_id);
            if (stamped && stamped.status === 'active') return stamped;
        }
        let ownerId = contact.owner_user_id || contact.ownerId || '';
        if (!ownerId && contact.batch_id) {
            const b = await db.get('SELECT owner_user_id FROM batches WHERE id = ?', [contact.batch_id]);
            ownerId = b && b.owner_user_id ? b.owner_user_id : '';
        }
        return this.resolveForOutbound(ownerId, { service: contact.service });
    }

    /** Does this agent's work type decide how the call is handled (instead of the contact sheet's type)? */
    static decidesService(agent, direction = 'outbound') {
        return Boolean(agent && agent.service && (direction === 'inbound' || AGENT_ONLY_SERVICES.includes(agent.service)));
    }

    /** Fills {name}, {role}, {company} and {agent} in an agent greeting. */
    static renderGreeting(template, vars = {}) {
        return String(template || '')
            .replace(/\{(name|role|company|agent)\}/gi, (_, k) => {
                const v = vars[k.toLowerCase()];
                return v ? String(v) : '';
            })
            .replace(/\s{2,}/g, ' ')
            .replace(/\s+([,.!?])/g, '$1')
            .trim();
    }

    /**
     * Opening for an agent that has no greeting of its own: it names only the agent, never a company.
     */
    static neutralOpening(agentName, { name = '', lang = 'en', inbound = false } = {}) {
        const agent = String(agentName || '').trim() || 'Remo';
        const who = String(name || '').trim();
        const l = String(lang || 'en').toLowerCase();
        if (inbound) {
            if (l === 'te') return `కాల్ చేసినందుకు ధన్యవాదాలు, నేను ${agent} మాట్లాడుతున్నాను. నేను మీకు ఎలా సహాయపడగలను?`;
            if (l === 'hi') return `कॉल करने के लिए धन्यवाद, मैं ${agent} बोल रहा हूँ। मैं आपकी कैसे सहायता कर सकता हूँ?`;
            return `Thank you for calling, this is ${agent}. How may I help you today?`;
        }
        if (l === 'te') {
            return `${who ? `నమస్కారం, నేను ${who} గారితో మాట్లాడుతున్నానా? ` : 'నమస్కారం, '}నేను ${agent} మాట్లాడుతున్నాను. ఇప్పుడు మాట్లాడటానికి మంచి సమయమేనా?`;
        }
        if (l === 'hi') {
            return `${who ? `नमस्ते, क्या मैं ${who} से बात कर रहा हूँ? ` : 'नमस्ते, '}मैं ${agent} बोल रहा हूँ। क्या अभी बात करने का सही समय है?`;
        }
        return who
            ? `Hello, am I speaking with ${who}? This is ${agent}. Is now a good time to talk?`
            : `Hi, this is ${agent}. Is now a good time to talk?`;
    }

    /** What an admin may see about their agents (no other admin's data). */
    static publicView(a) {
        return {
            id: a.id, name: a.name, phoneNumber: a.phone_number, service: a.service,
            greeting: a.greeting || '', instructions: a.instructions || '', voiceId: a.voice_id || '',
            assignedUserId: a.assigned_user_id || null, assignedUserIds: a.admin_ids || [],
            createdByUserId: a.created_by_user_id || null,
            inboundDefault: Boolean(a.inbound_default), status: a.status,
            createdAt: a.created_at, updatedAt: a.updated_at
        };
    }
}

ensureAgentSchema().catch((e) => console.error('[AgentService] schema:', e.message));
