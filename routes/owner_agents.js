/**
 * Owner panel: agents. Mounted by routes/owner.js (already behind requireOwner).
 *
 *   GET    /agents                     every agent, with the admin it is assigned to
 *   POST   /agents                     create an agent (any number of them)
 *   PUT    /agents/:id                 edit name, number, work type, greeting, instructions, voice, on/off
 *   DELETE /agents/:id
 *   PUT    /agents/:id/assign          { userId }  give the agent to an admin (null = unassign)
 *   PUT    /users/:id/agents           { agentIds } make exactly these agents belong to the admin
 */
import express from 'express';
import { readUsers } from '../users_store.js';
import AgentService, { AgentError } from '../services/agent_service.js';

const router = express.Router();
const fail = (res, code, message) => res.status(code).json({ success: false, message });

const route = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (e) {
        if (e instanceof AgentError) return fail(res, e.statusCode, e.message);
        console.error('[OWNER_AGENTS]', e);
        fail(res, 500, 'Something went wrong with agents. Check that the database is reachable.');
    }
};

const adminUser = (id) => readUsers().find((u) => u.id === id && (u.role || '').toLowerCase() === 'admin');

function view(a, users) {
    const u = a.assigned_user_id ? users.find((x) => x.id === a.assigned_user_id) : null;
    return { ...AgentService.publicView(a), assignedName: u ? u.name : '', assignedEmail: u ? u.email : '' };
}

router.get('/agents', route(async (req, res) => {
    const users = readUsers();
    const agents = await AgentService.list();
    res.json({ success: true, agents: agents.map((a) => view(a, users)) });
}));

router.post('/agents', route(async (req, res) => {
    const body = req.body || {};
    if (body.assignedUserId && !adminUser(body.assignedUserId)) return fail(res, 400, 'Agents can only be given to admin accounts.');
    const agent = await AgentService.create(body);
    res.status(201).json({ success: true, agent: view(agent, readUsers()) });
}));

router.put('/agents/:id', route(async (req, res) => {
    const agent = await AgentService.update(req.params.id, req.body || {});
    res.json({ success: true, agent: view(agent, readUsers()) });
}));

router.delete('/agents/:id', route(async (req, res) => {
    await AgentService.remove(req.params.id);
    res.json({ success: true });
}));

router.put('/agents/:id/assign', route(async (req, res) => {
    const userId = (req.body || {}).userId || null;
    if (userId && !adminUser(userId)) return fail(res, 400, 'Agents can only be given to admin accounts.');
    const agent = await AgentService.assign(req.params.id, userId);
    res.json({ success: true, agent: view(agent, readUsers()) });
}));

router.put('/users/:id/agents', route(async (req, res) => {
    if (!adminUser(req.params.id)) return fail(res, 400, 'Agents can only be given to admin accounts.');
    const ids = (req.body || {}).agentIds;
    if (!Array.isArray(ids)) return fail(res, 400, 'agentIds must be a list.');
    const mine = await AgentService.setAgentsForUser(req.params.id, ids);
    res.json({ success: true, agents: mine.map((a) => view(a, readUsers())) });
}));

export default router;
