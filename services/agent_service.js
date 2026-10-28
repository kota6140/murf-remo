import crypto from 'crypto';
import db, { utcNow, getDbEngine } from './db.js';

/**
 * services/agent_service.js
 *
 * Multi-agent support. The owner creates any number of agents. Each agent has its own
 * Plivo phone number, a work type (recruitment | sales | support), its own greeting and
 * instructions, and an optional ElevenLabs voice. Agents are assigned to admins; one admin
 * can have many agents, an agent belongs to at most one admin.
 *
 * Outgoing calls use the admin's agent number as caller ID. Incoming calls to an agent's
 * number are routed to that agent and its admin.
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

const COLUMNS = 'id, name, phone_number, service, greeting, instructions, voice_id, assigned_user_id, status, created_at, updated_at';

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
            const addColumns = [
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

function present(row) {
    if (!row) return null;
    return { ...row, status: row.status || 'active' };
}

function cleanFields(body, { requireAll }) {
    const f = {};
    if (typeof body.name === 'string') f.name = body.name.trim();
    if (typeof body.phoneNumber === 'string') f.phone_number = normalizeNumber(body.phoneNumber);
    if (typeof body.service === 'string') f.service = body.service.trim().toLowerCase();
    if (typeof body.greeting === 'string') f.greeting = body.greeting.trim().slice(0, 1000);
    if (typeof body.instructions === 'string') f.instructions = body.instructions.trim().slice(0, 6000);
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
        if (userId) { where.push('assigned_user_id = ?'); params.push(userId); }
        if (activeOnly) where.push("status = 'active'");
        const rows = await db.all(
            `SELECT ${COLUMNS} FROM agents ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`, params);
        return rows.map(present);
    }

    static async get(id, { fresh = false } = {}) {
        if (!id) return null;
        const hit = cache.get(id);
        if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.agent;
        await ensureAgentSchema();
        const agent = present(await db.get(`SELECT ${COLUMNS} FROM agents WHERE id = ?`, [id]));
        cache.set(id, { agent, at: Date.now() });
        return agent;
    }

    static async create(body) {
        await ensureAgentSchema();
        const f = cleanFields(body || {}, { requireAll: true });
        await this._assertNumberFree(f.phone_number, null);
        const now = utcNow();
        const id = `agt_${crypto.randomBytes(6).toString('hex')}`;
        await db.run(
            `INSERT INTO agents (id, name, phone_number, service, greeting, instructions, voice_id, assigned_user_id, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, f.name, f.phone_number, f.service, f.greeting || '', f.instructions || '', f.voice_id || '',
                body.assignedUserId || null, f.status || 'active', now, now]);
        return this.get(id, { fresh: true });
    }

    static async update(id, body) {
        await ensureAgentSchema();
        const existing = await this.get(id, { fresh: true });
        if (!existing) throw new AgentError('Agent not found.', 404);
        const f = cleanFields(body || {}, { requireAll: false });
        if (f.phone_number !== undefined) await this._assertNumberFree(f.phone_number, id);
        const keys = Object.keys(f);
        if (!keys.length) return existing;
        const sets = keys.map((k) => `${k} = ?`).join(', ');
        await db.run(`UPDATE agents SET ${sets}, updated_at = ? WHERE id = ?`, [...keys.map((k) => f[k]), utcNow(), id]);
        forget(id);
        return this.get(id, { fresh: true });
    }

    static async remove(id) {
        await ensureAgentSchema();
        const existing = await this.get(id, { fresh: true });
        if (!existing) throw new AgentError('Agent not found.', 404);
        await db.run('DELETE FROM agents WHERE id = ?', [id]);
        // Contacts that were stamped with this agent fall back to the admin's default agent.
        await db.run('UPDATE contacts SET agent_id = NULL WHERE agent_id = ?', [id]).catch(() => {});
        await db.run('UPDATE batches SET agent_id = NULL WHERE agent_id = ?', [id]).catch(() => {});
        await db.run('UPDATE campaigns SET agent_id = NULL WHERE agent_id = ?', [id]).catch(() => {});
        forget(id);
    }

    /** Gives an agent to an admin (or takes it back with userId = null). */
    static async assign(id, userId) {
        await ensureAgentSchema();
        const existing = await this.get(id, { fresh: true });
        if (!existing) throw new AgentError('Agent not found.', 404);
        await db.run('UPDATE agents SET assigned_user_id = ?, updated_at = ? WHERE id = ?', [userId || null, utcNow(), id]);
        forget(id);
        return this.get(id, { fresh: true });
    }

    /** Makes exactly this list of agents belong to the admin; the admin's other agents are released. */
    static async setAgentsForUser(userId, agentIds) {
        await ensureAgentSchema();
        const wanted = new Set((agentIds || []).map(String));
        const all = await this.list();
        for (const a of all) {
            const mine = a.assigned_user_id === userId;
            if (wanted.has(a.id) && !mine) await this.assign(a.id, userId);
            else if (!wanted.has(a.id) && mine) await this.assign(a.id, null);
        }
        return this.list({ userId });
    }

    static async releaseUser(userId) {
        await ensureAgentSchema();
        await db.run('UPDATE agents SET assigned_user_id = NULL, updated_at = ? WHERE assigned_user_id = ?', [utcNow(), userId]);
        cache.clear();
    }

    static async _assertNumberFree(phoneNumber, exceptId) {
        const rows = await db.all('SELECT id, phone_number FROM agents');
        const last10 = phoneNumber.slice(-10);
        const clash = rows.find((r) => r.id !== exceptId && (r.phone_number === phoneNumber || String(r.phone_number).slice(-10) === last10));
        if (clash) throw new AgentError('Another agent already uses this phone number.');
    }

    /** Incoming calls: which agent owns the number that was dialled? */
    static async findByNumber(dialled) {
        const num = normalizeNumber(dialled);
        if (!num) return null;
        await ensureAgentSchema();
        const rows = await db.all(`SELECT ${COLUMNS} FROM agents WHERE status = 'active'`);
        const exact = rows.find((r) => r.phone_number === num);
        const loose = exact || rows.find((r) => String(r.phone_number).slice(-10) === num.slice(-10));
        const agent = present(loose);
        if (agent) cache.set(agent.id, { agent, at: Date.now() });
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
            assignedUserId: a.assigned_user_id || null, status: a.status,
            createdAt: a.created_at, updatedAt: a.updated_at
        };
    }
}

ensureAgentSchema().catch((e) => console.error('[AgentService] schema:', e.message));
