/**
 * tests/settings_page.test.js
 *
 * Admin settings (profile, company, phone, job title) used to open as a popup on the dashboard. They now have their
 * own page, /settings, that only a signed-in admin can open. Reads files only; opens no database.
 */
import assert from 'assert';
import fs from 'fs';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const dashboard = read('dashboard.html');
const server = read('server.js');
const page = read('settings.html');
const script = read('settings.js');
const css = read('settings.css');

let total = 0;
let failed = 0;
function test(name, fn) {
    total++;
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

test('/settings is served through the same admin-only check as /dashboard', () => {
    assert.ok(server.includes("app.get('/settings', sendAdminPage('settings.html'))"));
    assert.ok(server.includes("app.get('/dashboard', sendAdminPage('dashboard.html'))"));
    const guard = server.slice(server.indexOf('const sendAdminPage'), server.indexOf("app.get('/dashboard'"));
    assert.ok(guard.includes("redirect(302, '/signin')") && guard.includes("redirect(302, '/user-dashboard')"));
});

test('The dashboard has no settings popup any more; every settings entry goes to /settings', () => {
    assert.ok(!dashboard.includes('id="profile-modal"'), 'popup markup still there');
    assert.ok(!dashboard.includes('openProfileModal'));
    assert.ok(!dashboard.includes('profile-edit-form'));
    assert.ok(dashboard.includes("window.location.href = '/settings'"));
    for (const id of ['dd-profile-btn', 'sidebar-settings-btn']) assert.ok(dashboard.includes(`'${id}'`), id);
    assert.ok(dashboard.includes('<a href="/settings" class="dropdown-item"'), 'user-menu Settings is a link');
    assert.ok(!dashboard.includes('data-feature="Workspace Settings"'), 'no "coming soon" popup for Settings');
});

test('The page has the profile form fields and the email is read-only', () => {
    for (const id of ['st-name', 'st-company', 'st-phone', 'st-job', 'st-email']) assert.ok(page.includes(`id="${id}"`), id);
    assert.ok(/id="st-email"[^>]*readonly/.test(page));
    assert.ok(page.includes('href="/dashboard"'), 'a way back to the dashboard');
});

test('The page saves through the existing profile API and guards who may use it', () => {
    assert.ok(script.includes('AuthClient.updateProfile(values)'));
    assert.ok(script.includes("window.location.href = '/signin'"));
    assert.ok(script.includes("window.location.href = '/user-dashboard'"));
    assert.ok(script.includes("window.location.href = '/onboarding'"));
    assert.ok(script.includes("AdminClient.request('/api/admin/minutes')"));
    assert.ok(script.includes('AuthClient.logout()'));
});

test('Save is only possible when something changed, and unsaved changes warn before leaving', () => {
    assert.ok(script.includes("$('st-save').disabled = !dirty || saving"));
    assert.ok(script.includes('beforeunload'));
});

test('The page is animated and respects reduced motion', () => {
    for (const k of ['@keyframes st-float-a', '@keyframes st-rise', '@keyframes st-spin', '@keyframes st-sweep', '@keyframes st-shake']) {
        assert.ok(css.includes(k), k);
    }
    assert.ok(css.includes('prefers-reduced-motion: reduce'));
    assert.ok(/@media \(max-width: 600px\)/.test(css), 'phone layout');
});

test('The page uses the dashboard layout with the same sidebar sections and items', () => {
    assert.ok(page.includes('href="/dashboard.css"'));
    assert.ok(page.includes('<body class="dashboard-body">'));
    for (const cls of ['dashboard-layout', 'dash-sidebar', 'sidebar-header', 'sidebar-nav-scroller', 'sidebar-footer', 'dash-main-area', 'dash-header', 'workspace-scroll-area']) {
        assert.ok(page.includes(`class="${cls}`), cls);
    }
    // same group titles and the same entries, in the same order, as the dashboard sidebar
    const labels = (html) => {
        const side = html.slice(html.indexOf('<aside class="dash-sidebar"'), html.indexOf('</aside>'));
        return [...side.matchAll(/class="nav-group-title">([^<]+)<|class="nav-label">([^<]+)</g)].map((m) => m[1] || m[2]);
    };
    assert.deepStrictEqual(labels(page), labels(dashboard));
});

test('Sidebar items open the matching dashboard section, and Settings is the highlighted page', () => {
    for (const view of ['dashboard', 'users', 'campaigns', 'agents', 'conversations', 'calls']) {
        assert.ok(page.includes(`href="/dashboard#${view}"`), view);
        assert.ok(dashboard.includes(`id="view-${view}"`), `dashboard has no ${view} view`);
    }
    assert.ok(/<a href="\/settings" class="sidebar-nav-item active"[^>]*aria-current="page"/.test(page));
    assert.ok((page.match(/sidebar-nav-item active/g) || []).length === 1, 'only one active item');
});

test('The dashboard opens the section named in the address (#users, #campaigns, ...)', () => {
    assert.ok(dashboard.includes("const startView = (window.location.hash || '').replace('#', '')"));
    assert.ok(dashboard.includes('switchAdminView(startView)'));
});

test('The sidebar collapses (same saved setting as the dashboard), shows tooltips and works as a phone drawer', () => {
    assert.ok(script.includes("'agentRemo_sidebarCollapsed'"));
    assert.ok(dashboard.includes("'agentRemo_sidebarCollapsed'"));
    assert.ok(script.includes('sidebar-floating-tooltip') && script.includes("classList.add('mobile-open')"));
    assert.ok(script.includes('fillShell(user)') && script.includes('loadNavCounts()'));
});

test('Icons and the avatar do not move when the cursor is on the cards or on them', () => {
    assert.ok(!/\.st-card:hover\s+\.st-icon/.test(css), 'card hover must not move the icons');
    assert.ok(!/\.st-icon[^{]*:hover/.test(css) && !/\.st-avatar[^{]*:hover/.test(css), 'icon/avatar hover');
    const icon = css.match(/\.st-icon \{[^}]*\}/)[0];
    assert.ok(!/transition|transform/.test(icon), icon);
});

test('The page scripts have no syntax errors', () => {
    new Function(script);
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
