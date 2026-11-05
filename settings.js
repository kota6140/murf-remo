// settings.js — the admin Settings page (profile form, calling minutes, sign out)
(function () {
  const $ = (id) => document.getElementById(id);
  const FIELDS = { name: 'st-name', companyName: 'st-company', phone: 'st-phone', jobTitle: 'st-job' };

  let baseline = {};
  let saving = false;

  const initials = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '··';
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  };

  function toast(message, isError) {
    const el = $('st-toast');
    el.textContent = message;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function showAlert(message, kind) {
    const box = $('st-alert');
    if (!message) { box.hidden = true; box.textContent = ''; return; }
    box.className = 'st-alert ' + kind;
    box.textContent = message;
    box.hidden = false;
  }

  const current = () => Object.fromEntries(Object.entries(FIELDS).map(([key, id]) => [key, $(id).value.trim()]));

  function renderHero(values, animate) {
    const heroName = $('st-hero-name');
    heroName.classList.remove('st-skel');
    heroName.textContent = values.name || 'Your profile';
    const bits = [values.jobTitle, values.companyName].filter(Boolean);
    $('st-hero-sub').textContent = bits.length ? bits.join(' · ') : 'Add your company details below';
    const avatar = $('st-avatar');
    const next = initials(values.name);
    if (avatar.textContent !== next) {
      avatar.textContent = next;
      if (animate) { avatar.classList.remove('pop'); void avatar.offsetWidth; avatar.classList.add('pop'); }
    }
  }

  function isDirty() {
    const now = current();
    return Object.keys(FIELDS).some((k) => now[k] !== (baseline[k] || ''));
  }

  function refreshButtons() {
    const dirty = isDirty();
    $('st-save').disabled = !dirty || saving;
    $('st-discard').disabled = !dirty || saving;
    $('st-dirty').classList.toggle('show', dirty && !saving);
  }

  function validate() {
    const rules = {
      'st-name': (v) => v.length >= 2,
      'st-company': (v) => v.length >= 2,
      'st-phone': (v) => /^[0-9+()\-\s]+$/.test(v) && v.replace(/\D/g, '').length >= 8 && v.replace(/\D/g, '').length <= 15
    };
    let firstBad = null;
    Object.entries(rules).forEach(([id, ok]) => {
      const input = $(id);
      const good = ok(input.value.trim());
      const wrap = input.closest('.st-field');
      wrap.classList.remove('invalid');
      if (!good) {
        void wrap.offsetWidth; // restart the shake
        wrap.classList.add('invalid');
        if (!firstBad) firstBad = input;
      }
    });
    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  function countUp(el, to, decimals) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !isFinite(to)) { el.textContent = isFinite(to) ? to.toFixed(decimals) : '—'; return; }
    const start = performance.now();
    const dur = 1200;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = (to * eased).toFixed(decimals);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async function loadMinutes() {
    try {
      const res = await AdminClient.request('/api/admin/minutes');
      const m = res && res.minutes;
      if (!m) return;
      const ring = $('st-ring');
      if (m.unlimited) {
        $('st-min-left').textContent = '∞';
        $('st-min-total').textContent = 'Unlimited';
        $('st-min-used').textContent = (m.usedMinutes || 0) + ' min';
        $('st-min-status').textContent = 'Active';
        ring.style.setProperty('--p', 100);
        ring.classList.add('good');
        return;
      }
      const total = Number(m.allottedMinutes) || 0;
      const left = Math.max(0, Number(m.remainingMinutes) || 0);
      const pct = total ? Math.round((left / total) * 100) : 0;
      countUp($('st-min-left'), left, left % 1 ? 1 : 0);
      $('st-min-total').textContent = total ? total + ' min' : 'None yet';
      $('st-min-used').textContent = (Number(m.usedMinutes) || 0) + ' min';
      $('st-min-status').textContent = !total ? 'No minutes assigned' : m.exhausted ? 'Finished' : pct <= 10 ? 'Running low' : 'Active';
      ring.classList.toggle('low', !!total && (m.exhausted || pct <= 10));
      ring.classList.toggle('good', !!total && !m.exhausted && pct > 10);
      requestAnimationFrame(() => setTimeout(() => ring.style.setProperty('--p', pct), 150));
    } catch (e) {
      $('st-min-status').textContent = 'Unavailable';
    }
  }

  // The sidebar behaves like the dashboard's: collapse (remembered), tooltips when collapsed, phone drawer.
  function setupSidebar() {
    const KEY = 'agentRemo_sidebarCollapsed'; // same key as the dashboard, so both pages stay in step
    const sidebar = $('dash-sidebar');
    const backdrop = $('mobile-sidebar-backdrop');
    const tip = document.createElement('div');
    tip.className = 'sidebar-floating-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);
    const hideTip = () => tip.classList.remove('visible');

    document.querySelectorAll('#dash-sidebar [data-tooltip]').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        if (document.body.classList.contains('sidebar-collapsed') && window.innerWidth > 820) {
          const rect = el.getBoundingClientRect();
          tip.textContent = el.getAttribute('data-tooltip');
          tip.style.top = `${rect.top + rect.height / 2}px`;
          tip.style.left = `${rect.right + 10}px`;
          tip.classList.add('visible');
        }
      });
      el.addEventListener('mouseleave', hideTip);
    });

    const setCollapsed = (collapsed) => {
      document.body.classList.toggle('sidebar-collapsed', collapsed);
      try { localStorage.setItem(KEY, collapsed ? 'true' : 'false'); } catch (e) { /* storage may be blocked */ }
      hideTip();
    };
    try {
      if (localStorage.getItem(KEY) === 'true' && window.innerWidth > 820) document.body.classList.add('sidebar-collapsed');
    } catch (e) { /* storage may be blocked */ }
    $('sidebar-toggle-btn').addEventListener('click', (e) => {
      e.preventDefault();
      setCollapsed(!document.body.classList.contains('sidebar-collapsed'));
    });

    const openDrawer = () => { sidebar.classList.add('mobile-open'); backdrop.classList.add('active'); document.body.style.overflow = 'hidden'; };
    const closeDrawer = () => { sidebar.classList.remove('mobile-open'); backdrop.classList.remove('active'); document.body.style.overflow = ''; };
    $('mobile-toggle-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.contains('mobile-open') ? closeDrawer() : openDrawer();
    });
    backdrop.addEventListener('click', closeDrawer);
    document.querySelectorAll('#dash-sidebar .sidebar-nav-item').forEach((item) => {
      item.addEventListener('click', () => { if (window.innerWidth <= 820) closeDrawer(); });
    });

    // The workspace card is the settings entry on the dashboard; here we are already on Settings
    const card = $('sidebar-company-card');
    card.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    // Scheduled Calls is not built yet (the dashboard shows a notice for it too)
    $('sidebar-scheduled-btn').addEventListener('click', () => toast('Scheduled Calls is coming soon.'));
  }

  // Sidebar and header details (name, company, counts), the same ones the dashboard shows
  function fillShell(user) {
    const company = user.companyName || 'TakeRemo Workspace';
    $('sidebar-comp-name').textContent = company;
    $('sidebar-comp-icon').textContent = company.slice(0, 2).toUpperCase();
    $('user-header-name').textContent = user.name || '';
    $('user-header-company').textContent = company;
    $('user-header-avatar').textContent = initials(user.name);
  }

  async function loadNavCounts() {
    try {
      const stats = await AdminClient.getDashboard();
      if (stats) $('nav-users-count').textContent = stats.totalUsers ?? 0;
    } catch (e) { /* the badge just stays at 0 */ }
    try {
      const res = await AdminClient.getAgents();
      $('nav-agents-count').textContent = Array.isArray(res.agents) ? res.agents.length : 0;
    } catch (e) { /* the badge just stays at 0 */ }
  }

  async function init() {
    setupSidebar();
    const user = await AuthClient.getCurrentUser();
    if (!user) { window.location.href = '/signin'; return; }
    if (user.role && String(user.role).toLowerCase() !== 'admin') { window.location.href = '/user-dashboard'; return; }
    if (!user.profileCompleted) { window.location.href = '/onboarding'; return; }

    baseline = { name: user.name || '', companyName: user.companyName || '', phone: user.phone || '', jobTitle: user.jobTitle || '' };
    $('st-email').value = user.email || '';
    $('st-chip-email-text').textContent = user.email || '—';
    Object.entries(FIELDS).forEach(([key, id]) => { $(id).value = baseline[key]; });
    renderHero(baseline, false);
    fillShell(user);
    $('st-main').removeAttribute('aria-busy');
    refreshButtons();
    loadMinutes();
    loadNavCounts();

    Object.values(FIELDS).forEach((id) => {
      $(id).addEventListener('input', () => {
        $(id).closest('.st-field').classList.remove('invalid');
        renderHero(current(), id === 'st-name');
        refreshButtons();
      });
    });

    $('st-discard').addEventListener('click', () => {
      Object.entries(FIELDS).forEach(([key, id]) => { $(id).value = baseline[key]; $(id).closest('.st-field').classList.remove('invalid'); });
      renderHero(baseline, true);
      showAlert('');
      refreshButtons();
    });

    $('st-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saving || !isDirty()) return;
      showAlert('');
      if (!validate()) return;

      const btn = $('st-save');
      saving = true;
      btn.classList.add('is-saving');
      refreshButtons();
      try {
        const values = current();
        await AuthClient.updateProfile(values);
        baseline = { ...values };
        renderHero(baseline, true);
        fillShell({ ...values });
        btn.classList.remove('is-saving');
        btn.classList.add('is-saved');
        toast('Profile saved');
        setTimeout(() => btn.classList.remove('is-saved'), 1700);
      } catch (err) {
        btn.classList.remove('is-saving');
        showAlert(err.message || 'Could not save your changes. Please try again.', 'error');
        toast('Could not save', true);
      } finally {
        saving = false;
        refreshButtons();
      }
    });

    $('st-logout').addEventListener('click', () => AuthClient.logout());

    window.addEventListener('beforeunload', (e) => {
      if (isDirty() && !saving) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
