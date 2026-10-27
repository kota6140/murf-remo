(() => {
    'use strict';
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const STATUS_LABEL = { pending: 'Pending', in_review: 'In review', approved: 'Approved', rejected: 'Rejected' };
    const state = { users: [], subs: [], demos: [], agents: [], stats: null, tab: 'overview', editingId: null, editingAgentId: null, openSubId: null, openDemoId: null };

    // ── helpers ─────────────────────────────────────────────────────────────
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtDate = (iso) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
    const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

    function toast(msg, isErr) {
        const t = $('#toast');
        t.textContent = msg; t.classList.toggle('err', !!isErr); t.classList.add('show');
        clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
    }

    async function api(path, opts = {}) {
        const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
        if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
        const res = await fetch('/api/owner' + path, init);
        let data = {};
        try { data = await res.json(); } catch { /* non-JSON */ }
        if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('Your session ended. Please sign in again.'); }
        if (!res.ok || data.success === false) throw new Error(data.message || 'Request failed.');
        return data;
    }

    const openEl = (el) => { el.hidden = false; };
    const closeEl = (el) => { el.hidden = true; };
    document.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) {
            const host = e.target.closest('.drawer, .modal');
            if (host) closeEl(host);
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') $$('.drawer:not([hidden]), .modal:not([hidden])').forEach(closeEl);
    });

    function confirmDialog({ title, text, okLabel = 'Delete', extraLabel }) {
        return new Promise((resolve) => {
            const m = $('#confirmModal');
            $('#confirmTitle').textContent = title;
            $('#confirmText').textContent = text;
            $('#confirmOk').textContent = okLabel;
            const extra = $('#confirmExtra'), box = $('#confirmExtraBox');
            extra.hidden = !extraLabel; box.checked = false;
            if (extraLabel) $('span', extra).textContent = extraLabel;
            openEl(m);
            const done = (val) => { closeEl(m); $('#confirmOk').onclick = null; obs.disconnect(); resolve(val); };
            $('#confirmOk').onclick = () => done({ ok: true, extra: box.checked });
            const obs = new MutationObserver(() => { if (m.hidden) done({ ok: false }); });
            obs.observe(m, { attributes: true, attributeFilter: ['hidden'] });
        });
    }

    // ── auth / view switching ───────────────────────────────────────────────
    function showLogin() { closeEl($('#appView')); openEl($('#loginView')); $('#loginPassword').value = ''; }
    async function showApp(email) {
        closeEl($('#loginView')); openEl($('#appView'));
        $('#ownerEmail').textContent = email || '';
        await refreshAll();
    }

    $('#loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#loginBtn'), err = $('#loginError');
        err.hidden = true; btn.disabled = true; btn.textContent = 'Signing in…';
        try {
            const d = await api('/login', { method: 'POST', body: { email: $('#loginEmail').value, password: $('#loginPassword').value } });
            await showApp(d.email);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
        finally { btn.disabled = false; btn.textContent = 'Sign in'; }
    });

    $('#logoutBtn').addEventListener('click', async () => {
        try { await api('/logout', { method: 'POST' }); } catch { /* ignore */ }
        showLogin();
    });

    // ── tabs ────────────────────────────────────────────────────────────────
    function setTab(name) {
        state.tab = name;
        $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
        $$('.tab').forEach(t => { t.hidden = t.id !== 'tab-' + name; });
        if (name === 'calls') loadCs();
    }
    $$('.nav-btn').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $$('[data-refresh]').forEach(b => b.addEventListener('click', () => refreshAll().then(() => toast('Refreshed'))));

    async function refreshAll() {
        try {
            const [s, u, f, dm, ag] = await Promise.all([api('/stats'), api('/users'), api('/submissions'), api('/demo-requests'), api('/agents').catch(() => ({ agents: state.agents }))]);
            state.stats = s.stats; state.users = u.users; state.subs = f.submissions; state.demos = dm.requests; state.agents = ag.agents;
            renderAll();
        } catch (e) { toast(e.message, true); }
    }

    function renderAll() {
        $('#navSubCount').textContent = state.subs.length;
        $('#navUserCount').textContent = state.users.length;
        $('#navAgentCount').textContent = state.agents.length;
        renderStats(); renderRecent(); renderSubs(); renderDemos(); renderUsers(); renderAgents();
    }

    // ── overview ────────────────────────────────────────────────────────────
    function renderStats() {
        const s = state.stats; if (!s) return;
        const tiles = [
            ['Total users', s.totalUsers], ['Filled the form', s.usersWhoSubmitted], ['Form submissions', s.totalSubmissions],
            ['New (24h)', s.newSubmissions24h], ['Pending review', s.byStatus.pending || 0], ['In review', s.byStatus.in_review || 0],
            ['Approved', s.byStatus.approved || 0], ['Rejected', s.byStatus.rejected || 0],
            ['Profiles completed', s.profilesCompleted], ['Suspended accounts', s.disabledUsers]
        ];
        $('#statGrid').innerHTML = tiles.map(([l, v]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
    }

    function subTableHtml(rows, emptyMsg) {
        if (!rows.length) return `<tbody><tr><td class="empty">${esc(emptyMsg)}</td></tr></tbody>`;
        return `<thead><tr><th>Submitted</th><th>Name</th><th>Company</th><th>Agent type</th><th>Phone</th><th>Status</th></tr></thead><tbody>` +
            rows.map(p => `<tr class="click" data-sub="${esc(p.id)}" tabindex="0">
                <td>${esc(fmtDate(p.submittedAt))}</td>
                <td>${esc(p.fullName)}<div class="sub">${esc(p.email)}</div></td>
                <td>${esc(p.companyName)}<div class="sub">${esc(p.industry)}</div></td>
                <td>${esc(p.agentType)}</td><td>${esc(p.phone)}</td>
                <td><span class="pill ${esc(p.status)}">${esc(STATUS_LABEL[p.status] || p.status)}</span></td></tr>`).join('') + '</tbody>';
    }

    function renderRecent() { $('#recentTable').innerHTML = subTableHtml(state.subs.slice(0, 5), 'No form submissions yet.'); }

    // ── submissions ─────────────────────────────────────────────────────────
    function renderSubs() {
        const q = $('#subSearch').value.trim().toLowerCase(), st = $('#subStatus').value;
        const rows = state.subs.filter(p =>
            (!st || p.status === st) &&
            (!q || [p.fullName, p.email, p.companyName, p.phone, p.agentType, p.industry].some(v => (v || '').toLowerCase().includes(q))));
        $('#subTable').innerHTML = subTableHtml(rows, state.subs.length ? 'No submissions match your filters.' : 'No form submissions yet.');
    }
    $('#subSearch').addEventListener('input', renderSubs);
    $('#subStatus').addEventListener('change', renderSubs);

    function onSubOpen(e) {
        if (e.type === 'keydown' && e.key !== 'Enter') return;
        const tr = e.target.closest('tr[data-sub]'); if (tr) openSubmission(tr.dataset.sub);
    }
    ['#subTable', '#recentTable'].forEach(s => { $(s).addEventListener('click', onSubOpen); $(s).addEventListener('keydown', onSubOpen); });

    function openSubmission(id) {
        const p = state.subs.find(x => x.id === id); if (!p) return;
        state.openSubId = id;
        const row = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '';
        const files = (p.uploadedFiles || []).map(f =>
            `<a href="/api/owner/submissions/${encodeURIComponent(p.id)}/files/${encodeURIComponent(f.storedName)}">${esc(f.originalName)}</a> <span class="muted small">(${fmtSize(f.size)})</span>`).join('');
        $('#drawerTitle').textContent = p.fullName || 'Submission';
        $('#drawerBody').innerHTML = `
            <div><h4>Review</h4>
                <label>Status <select id="dStatus">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                <label style="margin-top:10px">Internal note <textarea id="dNote" rows="3" maxlength="2000" placeholder="Visible to admins only">${esc(p.adminNote || '')}</textarea></label>
                <div class="modal-actions"><button class="btn danger sm" id="dDelete">Delete submission</button><button class="btn primary sm" id="dSave">Save review</button></div>
            </div>
            <div><h4>Contact</h4><dl class="kv">${row('Full name', p.fullName)}${row('Email', p.email)}${row('Phone', p.phone)}${row('Company', p.companyName)}${row('Website', p.companyWebsite)}${row('Govt / Reg. ID', p.govtId)}${row('GST', p.gstNumber)}${row('Account', p.accountExists ? p.accountEmail : 'Account deleted')}${row('Submitted', fmtDate(p.submittedAt))}</dl></div>
            <div><h4>Agent request</h4><dl class="kv">${row('Industry', p.industry)}${row('Agent type', p.agentType)}${row('Description', p.agentDescription)}${row('Business benefit', p.businessBenefit)}${row('Call volume', p.callVolume)}${row('Languages', [...(p.languages || []), p.languagesOther].filter(Boolean).join(', '))}${row('Documents (text)', p.documentsText)}${row('Additional needs', p.additionalRequirements)}</dl></div>
            ${files ? `<div><h4>Uploaded files</h4><div class="file-list">${files}</div></div>` : ''}`;
        openEl($('#drawer'));
    }

    $('#drawerBody').addEventListener('click', async (e) => {
        const id = state.openSubId;
        if (e.target.id === 'dSave') {
            try {
                const d = await api('/submissions/' + encodeURIComponent(id), { method: 'PATCH', body: { status: $('#dStatus').value, adminNote: $('#dNote').value } });
                const i = state.subs.findIndex(x => x.id === id); state.subs[i] = { ...state.subs[i], ...d.submission };
                await refreshAll(); toast('Review saved');
            } catch (ex) { toast(ex.message, true); }
        }
        if (e.target.id === 'dDelete') {
            const r = await confirmDialog({ title: 'Delete this submission?', text: 'The form and any uploaded files will be permanently removed.' });
            if (!r.ok) return;
            try { await api('/submissions/' + encodeURIComponent(id), { method: 'DELETE' }); closeEl($('#drawer')); await refreshAll(); toast('Submission deleted'); }
            catch (ex) { toast(ex.message, true); }
        }
    });

    // ── 60-second demo requests ─────────────────────────────────────────────
    const DEMO_LABEL = { new: 'New', contacted: 'Contacted', demo_done: 'Demo done', not_interested: 'Not interested' };
    const DEMO_SOURCE = { 'instant-call': 'Instant call box', 'demo-form': 'Demo form' };
    const demoSource = (d) => d.source === 'instant-call' ? 'instant-call' : 'demo-form';
    const DEMO_PILL = { new: 'pending', contacted: 'in_review', demo_done: 'approved', not_interested: 'rejected' };

    function renderDemos() {
        $('#navDemoCount').textContent = state.demos.length;
        const q = $('#demoSearch').value.trim().toLowerCase(), st = $('#demoStatus').value, src = $('#demoSource').value;
        const rows = state.demos.filter(d =>
            (!st || d.status === st) &&
            (!src || demoSource(d) === src) &&
            (!q || [d.name, d.email, d.company, d.phone, d.useCase, d.notes].some(v => (v || '').toLowerCase().includes(q))));
        $('#demoTable').innerHTML = !rows.length
            ? `<tbody><tr><td class="empty">${state.demos.length ? 'No requests match your filters.' : 'No one has filled the demo form yet.'}</td></tr></tbody>`
            : `<thead><tr><th>Submitted</th><th>Name</th><th>Company</th><th>Phone</th><th>Use case</th><th>From</th><th>Status</th></tr></thead><tbody>` +
            rows.map(d => `<tr class="click" data-demo="${esc(d.id)}" tabindex="0">
                <td>${esc(fmtDate(d.submittedAt))}</td>
                <td>${d.name ? `${esc(d.name)}<div class="sub">${esc(d.email)}</div>` : '<span class="muted">Phone number only</span>'}</td>
                <td>${esc(d.company || '—')}</td><td>${esc(d.phone)}</td><td>${esc(d.useCase || '—')}</td>
                <td>${esc(DEMO_SOURCE[demoSource(d)])}</td>
                <td><span class="pill ${DEMO_PILL[d.status] || ''}">${esc(DEMO_LABEL[d.status] || d.status)}</span></td></tr>`).join('') + '</tbody>';
    }
    $('#demoSearch').addEventListener('input', renderDemos);
    $('#demoStatus').addEventListener('change', renderDemos);
    $('#demoSource').addEventListener('change', renderDemos);

    function onDemoOpen(e) {
        if (e.type === 'keydown' && e.key !== 'Enter') return;
        const tr = e.target.closest('tr[data-demo]'); if (tr) openDemo(tr.dataset.demo);
    }
    $('#demoTable').addEventListener('click', onDemoOpen);
    $('#demoTable').addEventListener('keydown', onDemoOpen);

    function openDemo(id) {
        const d = state.demos.find(x => x.id === id); if (!d) return;
        state.openDemoId = id;
        const row = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '';
        $('#demoDrawerTitle').textContent = d.name || d.phone || 'Demo request';
        $('#demoDrawerBody').innerHTML = `
            <div><h4>Follow-up</h4>
                <label>Status <select id="ddStatus">${Object.entries(DEMO_LABEL).map(([k, v]) => `<option value="${k}" ${k === d.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                <label style="margin-top:10px">Internal note <textarea id="ddNote" rows="3" maxlength="2000" placeholder="Visible to admins only">${esc(d.adminNote || '')}</textarea></label>
                <div class="modal-actions"><button class="btn danger sm" id="ddDelete">Delete request</button><button class="btn primary sm" id="ddSave">Save</button></div>
            </div>
            <div><h4>Details they filled in</h4><dl class="kv">${row('Full name', d.name)}${row('Work email', d.email)}${row('Phone', d.phone)}${row('Company', d.company)}${row('Primary use case', d.useCase)}${row('Notes', d.notes)}${row('Came from', DEMO_SOURCE[demoSource(d)])}${row('Submitted', fmtDate(d.submittedAt))}${demoSource(d) === 'demo-form' ? row('Confirmation email', d.confirmationSent ? 'Sent' : 'Not sent') : ''}</dl></div>`;
        openEl($('#demoDrawer'));
    }

    $('#demoDrawerBody').addEventListener('click', async (e) => {
        const id = state.openDemoId;
        if (e.target.id === 'ddSave') {
            try {
                await api('/demo-requests/' + encodeURIComponent(id), { method: 'PATCH', body: { status: $('#ddStatus').value, adminNote: $('#ddNote').value } });
                await refreshAll(); toast('Saved');
            } catch (ex) { toast(ex.message, true); }
        }
        if (e.target.id === 'ddDelete') {
            const r = await confirmDialog({ title: 'Delete this request?', text: 'The details will be permanently removed.' });
            if (!r.ok) return;
            try { await api('/demo-requests/' + encodeURIComponent(id), { method: 'DELETE' }); closeEl($('#demoDrawer')); await refreshAll(); toast('Request deleted'); }
            catch (ex) { toast(ex.message, true); }
        }
    });

    // ── users ───────────────────────────────────────────────────────────────
    function renderUsers() {
        const q = $('#userSearch').value.trim().toLowerCase(), f = $('#userFilter').value;
        const rows = state.users.filter(u =>
            (!q || [u.name, u.email, u.companyName, u.phone].some(v => (v || '').toLowerCase().includes(q))) &&
            (!f || (f === 'submitted' && u.submissionCount > 0) || (f === 'not_submitted' && !u.submissionCount) ||
                (f === 'disabled' && u.disabled) || (f === 'admin' && u.role === 'admin')));
        $('#userTable').innerHTML = !rows.length
            ? `<tbody><tr><td class="empty">${state.users.length ? 'No users match your filters.' : 'No users yet.'}</td></tr></tbody>`
            : `<thead><tr><th>User</th><th>Company</th><th>Role</th><th>Form</th><th>Status</th><th>Joined</th><th></th></tr></thead><tbody>` +
            rows.map(u => `<tr>
                <td>${esc(u.name)}<div class="sub">${esc(u.email)}</div></td>
                <td>${esc(u.companyName || '—')}<div class="sub">${esc(u.phone || '')}</div></td>
                <td><span class="pill ${u.role === 'admin' ? 'in_review' : ''}">${u.role === 'admin' ? 'Admin' : 'User'}</span></td>
                <td>${u.submissionCount ? `<span class="pill ok">Filled (${u.submissionCount})</span>` : '<span class="pill">Not yet</span>'}</td>
                <td>${u.disabled ? '<span class="pill bad">Suspended</span>' : '<span class="pill ok">Active</span>'}</td>
                <td>${esc(fmtDate(u.createdAt))}</td>
                <td class="actions">
                    ${u.role === 'admin' ? `<button class="btn sm primary" data-ws-open="${esc(u.id)}">Calls &amp; chats</button>` : ''}
                    <button class="btn sm" data-edit="${esc(u.id)}">Edit</button>
                    <button class="btn sm" data-role="${esc(u.id)}">${u.role === 'admin' ? 'Make user' : 'Make admin'}</button>
                    <button class="btn sm" data-toggle="${esc(u.id)}">${u.disabled ? 'Reactivate' : 'Suspend'}</button>
                    <button class="btn sm danger" data-del="${esc(u.id)}">Delete</button>
                </td></tr>`).join('') + '</tbody>';
    }
    $('#userSearch').addEventListener('input', renderUsers);
    $('#userFilter').addEventListener('change', renderUsers);

    $('#userTable').addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.edit) return openUserForm(b.dataset.edit);
        if (b.dataset.wsOpen) return openWorkspace(b.dataset.wsOpen);
        const u = state.users.find(x => x.id === (b.dataset.toggle || b.dataset.del || b.dataset.role)); if (!u) return;
        try {
            if (b.dataset.role) {
                const toAdmin = u.role !== 'admin';
                const r = await confirmDialog({
                    title: toAdmin ? `Give ${u.name} admin access?` : `Remove admin access from ${u.name}?`,
                    text: toAdmin ? 'They will be able to use the admin dashboard (calls, uploads, queue) on their next page load.'
                        : 'They will lose admin dashboard access and go back to the regular user dashboard.',
                    okLabel: toAdmin ? 'Make admin' : 'Make user'
                });
                if (!r.ok) return;
                await api('/users/' + encodeURIComponent(u.id), { method: 'PUT', body: { role: toAdmin ? 'admin' : 'user' } });
                await refreshAll(); toast(toAdmin ? 'Admin access granted' : 'Admin access removed');
            } else if (b.dataset.toggle) {
                await api('/users/' + encodeURIComponent(u.id), { method: 'PUT', body: { disabled: !u.disabled } });
                await refreshAll(); toast(u.disabled ? 'Account reactivated' : 'Account suspended');
            } else {
                const r = await confirmDialog({
                    title: `Delete ${u.name}?`, text: `${u.email} will lose access immediately. This cannot be undone.`,
                    extraLabel: u.submissionCount ? `Also delete their ${u.submissionCount} form submission(s)` : ''
                });
                if (!r.ok) return;
                await api('/users/' + encodeURIComponent(u.id) + (r.extra ? '?deleteSubmissions=1' : ''), { method: 'DELETE' });
                await refreshAll(); toast('User deleted');
            }
        } catch (ex) { toast(ex.message, true); }
    });

    function openUserForm(id) {
        const form = $('#userForm'), u = id ? state.users.find(x => x.id === id) : null;
        state.editingId = id || null; form.reset(); $('#userFormError').hidden = true;
        $('#userModalTitle').textContent = u ? 'Edit user' : 'Add user';
        const pw = form.elements.password;
        pw.required = !u; pw.placeholder = u ? 'Leave blank to keep current password' : 'Min. 6 characters';
        $('#pwLabel').firstChild.textContent = u ? 'New password' : 'Password *';
        if (u) for (const el of form.elements) if (el.name && el.name !== 'password') el.value = u[el.name] ?? '';
        renderUserAgents(u);
        openEl($('#userModal')); form.elements.name.focus();
    }

    // Agent tick-boxes inside the user form (only for admins): ticked agents belong to this admin.
    function renderUserAgents(u) {
        const box = $('#userAgentsBox'), isAdmin = $('#userForm').elements.role.value === 'admin';
        box.hidden = !isAdmin;
        if (!isAdmin) return;
        const mine = new Set((u ? state.agents.filter(a => a.assignedUserId === u.id) : []).map(a => a.id));
        $('#userAgentsList').innerHTML = state.agents.length
            ? state.agents.map(a => {
                const other = a.assignedUserId && (!u || a.assignedUserId !== u.id);
                return `<label class="check"><input type="checkbox" name="agentIds" value="${esc(a.id)}" ${mine.has(a.id) ? 'checked' : ''}>
                    <span>${esc(a.name)} <span class="muted small">${esc(fmtNumber(a.phoneNumber))} · ${esc(SERVICE_LABEL[a.service] || a.service)}${other ? ` · now with ${esc(a.assignedName || 'another admin')}` : ''}</span></span></label>`;
            }).join('')
            : '<div class="muted small">No agents yet. Add one on the Agents tab.</div>';
    }
    $('#userForm').elements.role.addEventListener('change', () => renderUserAgents(state.editingId ? state.users.find(x => x.id === state.editingId) : null));
    $('#addUserBtn').addEventListener('click', () => openUserForm(null));

    $('#userForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target, err = $('#userFormError'), btn = $('#userSaveBtn');
        const fd = new FormData(form);
        const agentIds = fd.getAll('agentIds');
        const body = Object.fromEntries(fd.entries());
        delete body.agentIds;
        if (!body.password) delete body.password;
        err.hidden = true; btn.disabled = true;
        try {
            const saved = state.editingId
                ? await api('/users/' + encodeURIComponent(state.editingId), { method: 'PUT', body })
                : await api('/users', { method: 'POST', body });
            if (body.role === 'admin' && !$('#userAgentsBox').hidden && saved.user) {
                await api('/users/' + encodeURIComponent(saved.user.id) + '/agents', { method: 'PUT', body: { agentIds } });
            }
            closeEl($('#userModal')); await refreshAll(); toast(state.editingId ? 'User updated' : 'User added');
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
        finally { btn.disabled = false; }
    });

    // ── agents: any number of them, each with its own number, behaviour and admin ──
    const SERVICE_LABEL = { recruitment: 'Recruitment', sales: 'Sales', support: 'Support', appointment: 'Appointment setting', receptionist: 'Receptionist' };
    const fmtNumber = (n) => n ? '+' + String(n).replace(/^\+/, '') : '—';

    function renderAgents() {
        const q = $('#agentSearch').value.trim().toLowerCase(), f = $('#agentFilter').value;
        const rows = state.agents.filter(a =>
            (!q || [a.name, a.phoneNumber, a.assignedName, a.assignedEmail, a.service].some(v => (v || '').toLowerCase().includes(q))) &&
            (!f || (f === 'unassigned' && !a.assignedUserId) || (f === 'disabled' && a.status === 'disabled') || a.service === f));
        $('#agentTable').innerHTML = !rows.length
            ? `<tbody><tr><td class="empty">${state.agents.length ? 'No agents match your filters.' : 'No agents yet. Click "+ Add agent" to create the first one.'}</td></tr></tbody>`
            : `<thead><tr><th>Agent</th><th>Phone number</th><th>Work type</th><th>Given to admin</th><th>Status</th><th></th></tr></thead><tbody>` +
            rows.map(a => `<tr>
                <td>${esc(a.name)}<div class="sub">${a.instructions ? 'Has its own instructions' : 'Standard behaviour'}${a.greeting ? ' · own greeting' : ''}${a.voiceId ? ' · own voice' : ''}</div></td>
                <td>${esc(fmtNumber(a.phoneNumber))}</td>
                <td>${esc(SERVICE_LABEL[a.service] || a.service)}</td>
                <td>${a.assignedUserId ? `${esc(a.assignedName || 'Admin')}<div class="sub">${esc(a.assignedEmail)}</div>` : '<span class="owner-none">Not given to anyone</span>'}</td>
                <td>${a.status === 'disabled' ? '<span class="pill bad">Switched off</span>' : '<span class="pill ok">On</span>'}</td>
                <td class="actions">
                    <button class="btn sm" data-agent-edit="${esc(a.id)}">Edit</button>
                    <button class="btn sm danger" data-agent-del="${esc(a.id)}">Delete</button>
                </td></tr>`).join('') + '</tbody>';
    }
    $('#agentSearch').addEventListener('input', renderAgents);
    $('#agentFilter').addEventListener('change', renderAgents);

    function openAgentForm(id) {
        const form = $('#agentForm'), a = id ? state.agents.find(x => x.id === id) : null;
        state.editingAgentId = id || null; form.reset(); $('#agentFormError').hidden = true;
        $('#agentModalTitle').textContent = a ? 'Edit agent' : 'Add agent';
        $('#agentAdminSelect').innerHTML = '<option value="">Not given to anyone yet</option>' +
            state.users.filter(u => u.role === 'admin' && !u.disabled).map(u => `<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.email)})</option>`).join('');
        if (a) {
            form.elements.name.value = a.name; form.elements.phoneNumber.value = fmtNumber(a.phoneNumber).replace('—', '');
            form.elements.service.value = a.service; form.elements.assignedUserId.value = a.assignedUserId || '';
            form.elements.voiceId.value = a.voiceId || ''; form.elements.status.value = a.status || 'active';
            form.elements.greeting.value = a.greeting || ''; form.elements.instructions.value = a.instructions || '';
        }
        openEl($('#agentModal')); form.elements.name.focus();
    }
    $('#addAgentBtn').addEventListener('click', () => openAgentForm(null));

    $('#agentForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('#agentFormError'), btn = $('#agentSaveBtn');
        const body = Object.fromEntries(new FormData(e.target).entries());
        const assignTo = body.assignedUserId || null;
        err.hidden = true; btn.disabled = true;
        try {
            if (state.editingAgentId) {
                delete body.assignedUserId;
                await api('/agents/' + encodeURIComponent(state.editingAgentId), { method: 'PUT', body });
                const cur = state.agents.find(x => x.id === state.editingAgentId);
                if ((cur && cur.assignedUserId || null) !== assignTo) {
                    await api('/agents/' + encodeURIComponent(state.editingAgentId) + '/assign', { method: 'PUT', body: { userId: assignTo } });
                }
            } else {
                await api('/agents', { method: 'POST', body: { ...body, assignedUserId: assignTo } });
            }
            closeEl($('#agentModal')); await refreshAll(); toast(state.editingAgentId ? 'Agent updated' : 'Agent added');
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
        finally { btn.disabled = false; }
    });

    $('#agentTable').addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.agentEdit) return openAgentForm(b.dataset.agentEdit);
        const a = state.agents.find(x => x.id === b.dataset.agentDel); if (!a) return;
        const r = await confirmDialog({
            title: `Delete ${a.name}?`,
            text: `${fmtNumber(a.phoneNumber)} will stop being answered by this agent, and ${a.assignedName || 'its admin'} will no longer be able to use it. Past calls are kept.`
        });
        if (!r.ok) return;
        try { await api('/agents/' + encodeURIComponent(a.id), { method: 'DELETE' }); await refreshAll(); toast('Agent deleted'); }
        catch (ex) { toast(ex.message, true); }
    });

    // ── admin workspace: conversations / call history / scheduled calls / contact sheets ──
    const ws = { userId: null, tab: 'conversations' };
    const fmtDur = (s) => { s = Number(s) || 0; return s ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : '—'; };
    const cap = (v) => esc(String(v || '—').replace(/[_-]/g, ' '));
    const statusPill = (v) => {
        const k = String(v || '').toLowerCase();
        const cls = ['completed', 'approved'].includes(k) ? 'ok'
            : ['failed', 'cancelled', 'unanswered'].includes(k) ? 'bad'
            : ['queued', 'calling', 'in-progress', 'in_progress'].includes(k) ? 'in_review' : '';
        return `<span class="pill ${cls}">${cap(v)}</span>`;
    };
    const tbl = (head, rows, empty) => rows.length
        ? `<div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
        : `<div class="table-wrap"><div class="empty">${esc(empty)}</div></div>`;

    const wsUserCell = () => {
        const u = state.users.find(x => x.id === ws.userId);
        return u ? `<td>${esc(u.name)}<div class="sub">${esc(u.email)}</div></td>` : '<td></td>';
    };

    function openWorkspace(userId) {
        const u = state.users.find(x => x.id === userId); if (!u) return;
        ws.userId = userId;
        $('#wsTitle').textContent = u.name;
        $('#wsSub').textContent = `${u.email}${u.companyName ? ' · ' + u.companyName : ''}`;
        openEl($('#wsDrawer')); setWsTab('conversations');
    }

    function setWsTab(tab) {
        ws.tab = tab;
        $$('.ws-tab').forEach(b => b.classList.toggle('active', b.dataset.ws === tab));
        loadWs();
    }
    $$('.ws-tab').forEach(b => b.addEventListener('click', () => setWsTab(b.dataset.ws)));

    async function loadWs() {
        const body = $('#wsBody'), uid = encodeURIComponent(ws.userId), tab = ws.tab;
        body.innerHTML = '<div class="muted">Loading…</div>';
        try {
            const d = await api(`/users/${uid}/${tab}`);
            if (tab !== ws.tab) return;
            if (tab === 'conversations') renderWsConversations(d.conversations);
            if (tab === 'calls') renderWsCalls(d.calls);
            if (tab === 'scheduled') renderWsScheduled(d.scheduled);
            if (tab === 'batches') await renderWsBatches(d.batches);
        } catch (e) { body.innerHTML = `<div class="alert">${esc(e.message)}</div>`; }
    }

    function renderWsConversations(list) {
        $('#wsBody').innerHTML = tbl(['Started', 'Contact', 'Service', 'Status', 'Duration', 'Outcome', 'Admin', ''],
            list.map(c => `<tr class="click" data-conv="${esc(c.id)}" tabindex="0">
                <td>${esc(fmtDate(c.started_at))}</td><td>${esc(c.contact_name)}<div class="sub">${esc(c.phone)}</div></td>
                <td>${cap(c.service)}</td><td>${statusPill(c.status)}</td><td>${fmtDur(c.duration_seconds)}</td>
                <td>${cap(c.classification)}</td>${wsUserCell()}<td class="actions"><button class="btn sm danger" data-conv-del="${esc(c.id)}">Delete</button></td></tr>`),
            'No conversations for this admin yet. Assign conversations or contact sheets under the "Assign data" tab.');
    }

    async function openConversation(id) {
        const body = $('#wsBody'); body.innerHTML = '<div class="muted">Loading…</div>';
        try {
            const d = await api('/conversations/' + encodeURIComponent(id));
            body.innerHTML = convDetailHtml(d, 'wsBack', 'Back to conversations');
        } catch (e) { body.innerHTML = `<div class="alert">${esc(e.message)}</div>`; }
    }

    function renderWsCalls(list) {
        $('#wsBody').innerHTML = tbl(['When', 'Contact', 'Service', 'Status', 'Duration', 'Outcome', 'Admin', 'Notes'],
            list.map(c => `<tr><td>${esc(fmtDate(c.started_at))}</td><td>${esc(c.name)}<div class="sub">${esc(c.phone)}</div></td>
                <td>${cap(c.service)}</td><td>${statusPill(c.call_status)}</td><td>${fmtDur(c.duration_seconds)}</td>
                <td>${cap(c.classification || c.call_outcome)}</td>${wsUserCell()}<td>${esc(c.error_details || c.summary || '')}</td></tr>`),
            'No calls have been made for this admin yet.');
    }

    function renderWsScheduled(list) {
        $('#wsBody').innerHTML = `<div class="ws-note">There is no date/time scheduling yet. This lists calls that are waiting in the queue to be dialled.</div>
            <div class="ws-bar"><span class="muted">${list.length} call(s) waiting</span>${list.some(x => x.status === 'QUEUED') ? '<button class="btn sm danger" id="wsCancelAll">Cancel all queued</button>' : ''}</div>` +
            tbl(['Queued', 'Contact', 'Service', 'Status', 'Contact sheet', 'Admin', ''],
                list.map(q => `<tr><td>${esc(fmtDate(q.created_at))}</td><td>${esc(q.name)}<div class="sub">${esc(q.phone)}</div></td>
                    <td>${cap(q.service)}</td><td>${statusPill(q.status)}</td><td>${esc(q.batch_file)}</td>${wsUserCell()}
                    <td class="actions">${q.status === 'QUEUED' ? `<button class="btn sm" data-q-cancel="${esc(q.id)}">Cancel</button>` : ''}</td></tr>`),
                'Nothing is waiting in the queue for this admin.');
    }

    async function renderWsBatches(mine) {
        const [batchRes, convRes] = await Promise.all([api('/batches'), api('/conversations-unassigned')]);
        const free = batchRes.batches.filter(b => !b.owner_user_id);
        const freeConvs = convRes.conversations.map(c => `<tr><td>${esc(fmtDate(c.started_at))}</td><td>${esc(c.contact_name)}<div class="sub">${esc(c.phone)}</div></td><td>${cap(c.service)}</td><td>${statusPill(c.status)}</td>
            <td class="actions"><button class="btn sm primary" data-c-assign="${esc(c.id)}">Assign to this admin</button></td></tr>`);
        const mineRows = mine.map(b => `<tr><td>${esc(b.filename)}</td><td>${cap(b.service)}</td><td>${statusPill(b.status)}</td><td>${esc(b.valid_rows)} / ${esc(b.total_rows)}</td><td>${esc(fmtDate(b.created_at))}</td>${wsUserCell()}
            <td class="actions"><button class="btn sm" data-b-unassign="${esc(b.id)}">Unassign</button></td></tr>`);
        const freeRows = free.map(b => `<tr><td>${esc(b.filename)}</td><td>${cap(b.service)}</td><td>${statusPill(b.status)}</td><td>${esc(b.conversation_count)} chat(s)</td><td>${esc(fmtDate(b.created_at))}</td>
            <td class="actions"><button class="btn sm primary" data-b-assign="${esc(b.id)}">Assign to this admin</button></td></tr>`);
        $('#wsBody').innerHTML = `<div class="ws-note">Call history and queued calls are linked to an admin through their contact sheets (uploaded Excel/CSV files). Conversations can be assigned directly or come with a contact sheet.</div>
            <div><h4>Contact sheets of this admin</h4>${tbl(['File', 'Service', 'Status', 'Valid / total', 'Uploaded', 'Admin', ''], mineRows, 'None assigned yet.')}</div>
            <div><h4>Unassigned contact sheets</h4>${tbl(['File', 'Service', 'Status', 'Conversations', 'Uploaded', ''], freeRows, 'Every contact sheet is already assigned.')}</div>
            <div><h4>Unassigned conversations</h4>${tbl(['Started', 'Contact', 'Service', 'Status', ''], freeConvs, 'Every conversation is already assigned.')}</div>`;
    }

    $('#wsBody').addEventListener('click', async (e) => {
        const t = e.target;
        try {
            if (t.id === 'wsBack') return loadWs();
            if (t.dataset.convDel) {
                const r = await confirmDialog({ title: 'Delete this conversation?', text: 'The conversation and its transcript will be permanently removed.' });
                if (!r.ok) return;
                await api('/conversations/' + encodeURIComponent(t.dataset.convDel), { method: 'DELETE' });
                toast('Conversation deleted'); return loadWs();
            }
            const convRow = t.closest('tr[data-conv]');
            if (convRow && !t.closest('button')) return openConversation(convRow.dataset.conv);
            if (t.dataset.qCancel) { await api(`/queue/${encodeURIComponent(t.dataset.qCancel)}/cancel`, { method: 'POST' }); toast('Call cancelled'); return loadWs(); }
            if (t.id === 'wsCancelAll') {
                const r = await confirmDialog({ title: 'Cancel all queued calls?', text: 'Every call still waiting in the queue for this admin will be cancelled. Calls already in progress are not affected.', okLabel: 'Cancel calls' });
                if (!r.ok) return;
                const d = await api(`/users/${encodeURIComponent(ws.userId)}/scheduled/cancel-all`, { method: 'POST' });
                toast(`${d.cancelled} call(s) cancelled`); return loadWs();
            }
            if (t.dataset.cAssign) {
                await api(`/conversations/${encodeURIComponent(t.dataset.cAssign)}/owner`, { method: 'PUT', body: { userId: ws.userId } });
                toast('Conversation assigned'); return loadWs();
            }
            if (t.dataset.bAssign || t.dataset.bUnassign) {
                const id = t.dataset.bAssign || t.dataset.bUnassign;
                await api(`/batches/${encodeURIComponent(id)}/owner`, { method: 'PUT', body: { userId: t.dataset.bAssign ? ws.userId : null } });
                toast(t.dataset.bAssign ? 'Contact sheet assigned' : 'Contact sheet unassigned'); return loadWs();
            }
        } catch (ex) { toast(ex.message, true); }
    });
    $('#wsBody').addEventListener('keydown', (e) => {
        const tr = e.target.closest && e.target.closest('tr[data-conv]');
        if (e.key === 'Enter' && tr) openConversation(tr.dataset.conv);
    });

    // ── "Calls & data" section: everything across all admins ──────────────────
    const cs = { tab: 'conversations', rows: [] };
    const CS_STATUS = {
        conversations: [['', 'All statuses'], ['completed', 'Completed'], ['in-progress', 'In progress'], ['failed', 'Failed']],
        calls: [['', 'All statuses'], ['completed', 'Completed'], ['failed', 'Failed'], ['unanswered', 'Unanswered'], ['calling', 'Calling'], ['skipped', 'Skipped'], ['cancelled', 'Cancelled']],
        scheduled: [['', 'All statuses'], ['queued', 'Queued'], ['in_progress', 'In progress']],
        sheets: [['', 'All statuses'], ['ready', 'Ready'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']]
    };

    // Call recording: player, download and the "available until" notice (recordings are deleted 30 days after the call).
    function recordingHtml(rec) {
        if (!rec) return '';
        let body = '<div class="muted">No recording is available for this call.</div>';
        if (rec.available) {
            body = `<audio controls preload="none" src="${esc(rec.audio_url)}" style="width:100%"></audio>
                <div class="muted"><a href="${esc(rec.download_url)}" download>Download</a>${rec.expires_at ? ` · Available until ${esc(fmtDate(rec.expires_at))}` : ''}</div>`;
        } else if (rec.status === 'expired') {
            body = `<div class="muted">Recording expired (${esc(rec.retention_days)}-day limit)</div>`;
        }
        return `<div><h4>Call recording</h4>${body}</div>`;
    }

    function convDetailHtml(d, backId, backLabel) {
        const c = d.conversation;
        const row = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '';
        return `<div><button class="btn sm" id="${backId}">&larr; ${esc(backLabel)}</button></div>
            <dl class="kv">${row('Contact', c.contact_name)}${row('Phone', c.phone)}${row('Service', String(c.service || '').replace(/_/g, ' '))}${row('Status', c.status)}${row('Started', fmtDate(c.started_at))}${row('Duration', fmtDur(c.duration_seconds))}${row('Language', c.language)}${row('Sentiment', c.sentiment)}${row('Outcome', c.classification)}${row('Summary', c.summary)}${row('Contact sheet', c.batch_file)}</dl>
            ${recordingHtml(d.recording)}
            <div><h4>Transcript</h4>${d.transcript.length ? `<div class="chat">${d.transcript.map(m => {
                const agent = !/^(user|customer|candidate|caller|human)/i.test(m.speaker || '');
                return `<div class="bubble ${agent ? 'agent' : 'user'}"><small>${esc(m.speaker)}</small>${esc(m.text)}</div>`;
            }).join('')}</div>` : '<div class="muted">No transcript was recorded.</div>'}</div>`;
    }

    const adminUsers = () => state.users.filter(u => u.role === 'admin');

    function fillCsFilters() {
        const ownerSel = $('#csOwner'), keep = ownerSel.value;
        const ids = new Set(adminUsers().map(u => u.id));
        cs.rows.forEach(r => { if (r.owner_user_id) ids.add(r.owner_user_id); });
        const opts = [['', 'All admins'], ['__none', 'Unassigned']];
        state.users.filter(u => ids.has(u.id)).forEach(u => opts.push([u.id, u.name]));
        ownerSel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
        ownerSel.value = opts.some(o => o[0] === keep) ? keep : '';
    }

    function fillStatusFilter() {
        $('#csStatus').innerHTML = CS_STATUS[cs.tab].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    }

    async function loadCs() {
        const body = $('#csBody'), tab = cs.tab;
        body.innerHTML = '<div class="muted">Loading…</div>';
        try {
            const d = tab === 'sheets' ? await api('/batches') : await api('/all/' + tab);
            if (tab !== cs.tab) return;
            cs.rows = tab === 'sheets' ? d.batches : d.rows;
            fillCsFilters();
            renderCs();
        } catch (e) { body.innerHTML = `<div class="alert">${esc(e.message)}</div>`; }
    }

    const ownerPick = (attr, id, current) => {
        const opts = adminUsers().slice();
        if (current && !opts.some(u => u.id === current)) {
            const u = state.users.find(x => x.id === current); if (u) opts.push(u);
        }
        return `<select class="owner-pick" ${attr}="${esc(id)}" aria-label="Assign to admin"><option value="">Unassigned</option>${opts.map(u => `<option value="${esc(u.id)}" ${u.id === current ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`;
    };
    const ownerLabel = (r) => {
        if (!r.owner_name) return '<span class="owner-none">Unassigned</span>';
        const u = state.users.find(x => x.id === r.owner_user_id);
        return esc(r.owner_name) + (u ? `<div class="sub">${esc(u.email)}</div>` : '');
    };

    function renderCs() {
        const q = $('#csSearch').value.trim().toLowerCase(), own = $('#csOwner').value, st = $('#csStatus').value;
        const statusOf = (r) => String(cs.tab === 'calls' ? r.call_status : r.status || '').toLowerCase().replace('-', '_');
        const rows = cs.rows.filter(r =>
            (!own || (own === '__none' ? !r.owner_user_id : r.owner_user_id === own)) &&
            (!st || statusOf(r) === st.replace('-', '_')) &&
            (!q || [r.contact_name, r.name, r.phone, r.filename, r.batch_file, r.service, r.owner_name].some(v => (v || '').toLowerCase().includes(q))));
        const count = `<div class="muted small" style="margin-bottom:8px">${rows.length} of ${cs.rows.length} shown</div>`;
        const none = 'Nothing here yet.';
        let html;
        if (cs.tab === 'conversations') {
            html = tbl(['Started', 'Contact', 'Service', 'Status', 'Duration', 'Admin', ''], rows.map(c => `<tr class="click" data-cconv="${esc(c.id)}" tabindex="0">
                <td>${esc(fmtDate(c.started_at))}</td><td>${esc(c.contact_name)}<div class="sub">${esc(c.phone)}</div></td><td>${cap(c.service)}</td><td>${statusPill(c.status)}</td><td>${fmtDur(c.duration_seconds)}</td>
                <td>${ownerPick('data-own-conv', c.id, c.owner_user_id)}${c.owner_via_sheet ? `<div class="sub">via ${esc(c.owner_via_sheet)}</div>` : ''}</td>
                <td class="actions"><button class="btn sm danger" data-cconv-del="${esc(c.id)}">Delete</button></td></tr>`), none);
        } else if (cs.tab === 'calls') {
            html = tbl(['When', 'Contact', 'Service', 'Status', 'Duration', 'Outcome', 'Admin', 'Notes'], rows.map(c => `<tr>
                <td>${esc(fmtDate(c.started_at))}</td><td>${esc(c.name)}<div class="sub">${esc(c.phone)}</div></td><td>${cap(c.service)}</td><td>${statusPill(c.call_status)}</td><td>${fmtDur(c.duration_seconds)}</td>
                <td>${cap(c.classification || c.call_outcome)}</td><td>${ownerLabel(c)}<div class="sub">${esc(c.batch_file || '')}</div></td><td>${esc(c.error_details || c.summary || '')}</td></tr>`), none);
        } else if (cs.tab === 'scheduled') {
            html = `<div class="ws-note" style="margin-bottom:10px">There is no date/time scheduling yet. This lists calls waiting in the queue to be dialled.</div>` +
                tbl(['Queued', 'Contact', 'Service', 'Status', 'Contact sheet', 'Admin', ''], rows.map(q2 => `<tr>
                <td>${esc(fmtDate(q2.created_at))}</td><td>${esc(q2.name)}<div class="sub">${esc(q2.phone)}</div></td><td>${cap(q2.service)}</td><td>${statusPill(q2.status)}</td>
                <td>${esc(q2.batch_file || '')}</td><td>${ownerLabel(q2)}</td>
                <td class="actions">${q2.status === 'QUEUED' ? `<button class="btn sm" data-cq-cancel="${esc(q2.id)}">Cancel</button>` : ''}</td></tr>`), 'Nothing is waiting in the queue.');
        } else {
            html = `<div class="ws-note" style="margin-bottom:10px">Pick an admin on a contact sheet to link it, and all its calls, to them. New uploads are linked to the uploader automatically.</div>` +
                tbl(['File', 'Service', 'Status', 'Valid / total', 'Conversations', 'Uploaded', 'Admin'], rows.map(b => `<tr>
                <td>${esc(b.filename)}</td><td>${cap(b.service)}</td><td>${statusPill(b.status)}</td><td>${esc(b.valid_rows)} / ${esc(b.total_rows)}</td><td>${esc(b.conversation_count)}</td>
                <td>${esc(fmtDate(b.created_at))}</td><td>${ownerPick('data-own-batch', b.id, b.owner_user_id)}</td></tr>`), none);
        }
        $('#csBody').innerHTML = count + html;
    }

    $$('.cs-tab').forEach(b => b.addEventListener('click', () => {
        cs.tab = b.dataset.cs;
        $$('.cs-tab').forEach(x => x.classList.toggle('active', x === b));
        fillStatusFilter(); loadCs();
    }));
    $('#csSearch').addEventListener('input', renderCs);
    $('#csOwner').addEventListener('change', renderCs);
    $('#csStatus').addEventListener('change', renderCs);
    $('#callsRefresh').addEventListener('click', () => refreshAll().then(loadCs));
    fillStatusFilter();

    async function openCsConversation(id) {
        const body = $('#csBody'); body.innerHTML = '<div class="muted">Loading…</div>';
        try {
            body.innerHTML = convDetailHtml(await api('/conversations/' + encodeURIComponent(id)), 'csBack', 'Back to conversations');
        } catch (e) { body.innerHTML = `<div class="alert">${esc(e.message)}</div>`; }
    }

    $('#csBody').addEventListener('click', async (e) => {
        const t = e.target;
        try {
            if (t.id === 'csBack') return loadCs();
            if (t.dataset.cconvDel) {
                const r = await confirmDialog({ title: 'Delete this conversation?', text: 'The conversation and its transcript will be permanently removed.' });
                if (!r.ok) return;
                await api('/conversations/' + encodeURIComponent(t.dataset.cconvDel), { method: 'DELETE' });
                toast('Conversation deleted'); return loadCs();
            }
            if (t.dataset.cqCancel) {
                await api(`/queue/${encodeURIComponent(t.dataset.cqCancel)}/cancel`, { method: 'POST' });
                toast('Call cancelled'); return loadCs();
            }
            const row = t.closest('tr[data-cconv]');
            if (row && !t.closest('button, select')) return openCsConversation(row.dataset.cconv);
        } catch (ex) { toast(ex.message, true); }
    });
    $('#csBody').addEventListener('keydown', (e) => {
        const tr = e.target.closest && e.target.closest('tr[data-cconv]');
        if (e.key === 'Enter' && tr && e.target === tr) openCsConversation(tr.dataset.cconv);
    });
    $('#csBody').addEventListener('change', async (e) => {
        const sel = e.target;
        if (!sel.matches('select.owner-pick')) return;
        const userId = sel.value || null;
        try {
            if (sel.dataset.ownConv) {
                await api(`/conversations/${encodeURIComponent(sel.dataset.ownConv)}/owner`, { method: 'PUT', body: { userId } });
            } else {
                await api(`/batches/${encodeURIComponent(sel.dataset.ownBatch)}/owner`, { method: 'PUT', body: { userId } });
            }
            toast(userId ? 'Assigned' : 'Unassigned');
            await loadCs();
        } catch (ex) { toast(ex.message, true); loadCs(); }
    });

    // ── boot ────────────────────────────────────────────────────────────────
    (async () => {
        try { const d = await api('/me'); await showApp(d.email); } catch { showLogin(); }
    })();
})();
