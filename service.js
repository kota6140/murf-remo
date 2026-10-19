/* ==========================================================================
   TakeRemo — service pages. One script for all five pages:
   shell (nav / footer / demo form), reveal + counters, typed sample call,
   and a one-of-a-kind hero scene per service.
   ========================================================================== */
(() => {
  'use strict';

  const body = document.body;
  const slug = body.dataset.slug;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SERVICES = [
    { slug: 'recruitment', name: 'Recruitment', line: 'Screen & schedule candidates', rgb: '96,140,255', path: '/service/recruitment' },
    { slug: 'sales', name: 'Sales', line: 'Call & convert every lead', rgb: '252,36,21', path: '/service/sales' },
    { slug: 'customer-support', name: 'Customer Support', line: 'Resolve with empathy, 24/7', rgb: '16,185,129', path: '/service/customer-support' },
    { slug: 'appointment-setting', name: 'Appointment Setting', line: 'Fill your calendar, fewer no-shows', rgb: '168,85,247', path: '/service/appointment-setting' },
    { slug: 'receptionist', name: 'Receptionist', line: 'Every call answered, day or night', rgb: '34,211,238', path: '/service/receptionist' }
  ];
  const current = SERVICES.find((s) => s.slug === slug) || SERVICES[0];
  const RGB = current.rgb;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const rgba = (a) => `rgba(${RGB},${a})`;
  const TAU = Math.PI * 2;

  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ shell */
  const arrowSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

  function buildShell() {
    // Same header as the homepage (links point back to the homepage sections)
    const INDUSTRIES = [
      ['healthcare', 'Healthcare'], ['recruitment', 'Recruitment'], ['sales', 'Sales'], ['education', 'Education'],
      ['realestate', 'Real Estate'], ['support', 'Customer Support'], ['finance', 'Finance'], ['automotive', 'Automotive']
    ];
    const chev = '<svg class="nav-dd-chev" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 4 6 8 10 4" /></svg>';
    const dropdown = (label, menuClass, items, href) => `
      <div class="nav-dd">
        <button type="button" class="nav-link nav-dd-btn"${href ? ` data-href="${href}"` : ''} aria-haspopup="true" aria-expanded="false">${label}${chev}</button>
        <div class="nav-dd-menu ${menuClass}">${items}</div>
      </div>`;
    const serviceItems = SERVICES.map((s) => `<a href="${s.path}"><i style="--c:${s.rgb}"></i><span><b>${s.name}</b><small>${s.line}</small></span></a>`).join('');
    const industryItems = INDUSTRIES.map(([k, n]) => `<a href="/industry/${k}"><span><b>${n}</b></span></a>`).join('');
    const navLinkHtml = [
      dropdown('Services', '', serviceItems, '/our-services'),
      '<a href="/#instant-call-demo" class="nav-link">60-Sec Test</a>',
      '<a href="/#human-touch" class="nav-link">Human Touch</a>',
      '<a href="/how-it-works" class="nav-link">How It Works</a>',
      dropdown('Industries', 'nav-dd-menu--cols', industryItems, '/industries'),
      '<a href="/contact" class="nav-link">Contact Us</a>'
    ].join('');
    const mobileNavHtml = [
      `<details class="nav-acc"><summary class="nav-link">Services</summary><a href="/our-services" class="nav-link nav-sub">All Services</a>${SERVICES.map((s) => `<a href="${s.path}" class="nav-link nav-sub">${s.name}</a>`).join('')}</details>`,
      '<a href="/#instant-call-demo" class="nav-link">60-Sec Test</a>',
      '<a href="/#human-touch" class="nav-link">Human Touch</a>',
      '<a href="/how-it-works" class="nav-link">How It Works</a>',
      `<details class="nav-acc"><summary class="nav-link">Industries</summary><a href="/industries" class="nav-link nav-sub">All Industries</a>${INDUSTRIES.map(([k, n]) => `<a href="/industry/${k}" class="nav-link nav-sub">${n}</a>`).join('')}</details>`,
      '<a href="/contact" class="nav-link">Contact Us</a>'
    ].join('');
    body.insertAdjacentHTML('afterbegin', `
      <div class="sv-progress" id="sv-progress"></div>
      <header class="top-nav" id="top-nav">
        <div class="nav-container">
          <a href="/" class="nav-brand" aria-label="TakeRemo home">
            <img src="/assets/Takeremo%20AI%20Calling%20Logo%20Transparent.png" alt="TakeRemo AI Calling" class="nav-brand-logo-img nb-light">
            <img src="/assets/Takeremo%20AI%20Calling%20Logo%20Light.png" alt="" aria-hidden="true" class="nav-brand-logo-img nb-dark">
          </a>
          <nav class="nav-links">${navLinkHtml}</nav>
          <div class="nav-actions" id="main-nav-actions">
            <a href="/signin" class="btn btn-outline btn-sm" id="nav-signin-btn"><span>Login</span></a>
            <a href="/signup" class="btn btn-primary btn-sm btn-glow" id="nav-signup-btn"><span>Create Account</span></a>
            <button type="button" class="nav-menu-toggle" id="nav-menu-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-nav-panel">
              <span></span><span></span><span></span>
            </button>
          </div>
        </div>
        <nav class="mobile-nav-panel" id="mobile-nav-panel" aria-label="Mobile navigation">
          ${mobileNavHtml}
          <div class="mobile-nav-cta">
            <a href="/signin" class="btn btn-outline btn-sm">Login</a>
            <a href="/signup" class="btn btn-primary btn-sm">Create Account</a>
          </div>
        </nav>
      </header>`);

    const menuBtn = $('#nav-menu-toggle');
    const topNav = $('#top-nav');
    const setMenu = (open) => {
      topNav.classList.toggle('menu-open', open);
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    menuBtn.addEventListener('click', () => setMenu(!topNav.classList.contains('menu-open')));
    $('#mobile-nav-panel').addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
    const dd = document.createElement('script');
    dd.src = '/nav-dropdown.js?v=2';
    body.appendChild(dd);

    body.insertAdjacentHTML('beforeend', `
      <footer class="site-footer-light" id="footer">
        <div class="container footer-content-grid">
          <div class="footer-brand-col">
            <a href="/" class="footer-brand-header" aria-label="TakeRemo home">
              <img src="/assets/Takeremo%20AI%20Calling%20Logo%20Transparent.png" alt="TakeRemo AI Calling" class="footer-logo">
            </a>
            <button type="button" class="footer-cta-btn" data-open-demo>
              <span>Talk to Remo</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </button>
            <p class="footer-regions" aria-label="Regions"><span>India · US · UK · Australia · Germany</span></p>
        <div class="footer-social" aria-label="Social media">
          <a href="https://www.instagram.com/takeremo" target="_blank" rel="noopener noreferrer" aria-label="TakeRemo on Instagram"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.6" cy="6.4" r="1" fill="currentColor" stroke="none"/></svg></a>
          <a href="https://www.linkedin.com/company/take-remo/" target="_blank" rel="noopener noreferrer" aria-label="TakeRemo on LinkedIn"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>
          <a href="https://www.facebook.com/takeremo" target="_blank" rel="noopener noreferrer" aria-label="TakeRemo on Facebook"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg></a>
          <a href="https://x.com/takeremo" target="_blank" rel="noopener noreferrer" aria-label="TakeRemo on X"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
        </div>
          </div>

          <div class="footer-links-col">
            <h4 class="footer-col-title">VOICE EMPLOYEES</h4>
            <ul class="footer-links-list">
              ${SERVICES.map((s) => `<li><a href="${s.path}">${s.name}</a></li>`).join('')}
            </ul>
          </div>

          <div class="footer-links-col">
            <h4 class="footer-col-title">CAPABILITIES</h4>
            <ul class="footer-links-list">
              <li><a href="/how-it-works">How It Works</a></li>
              <li><a href="/industries">Industries</a></li>
            </ul>
          </div>

          <div class="footer-links-col">
            <h4 class="footer-col-title">EXPERIENCE</h4>
            <ul class="footer-links-list">
              <li><a href="/#instant-call-demo">60-Second Demo</a></li>
              <li><a href="/signin">Login</a></li>
              <li><a href="/signup">Create Account</a></li>
              <li><a href="#" data-open-demo>Talk to Remo</a></li>
            </ul>
          </div>

          <div class="footer-links-col">
            <h4 class="footer-col-title">PLATFORM</h4>
            <ul class="footer-links-list">
              <li><a href="/dashboard">Dashboard</a></li>
              <li><a href="/overview">Overview</a></li>
              <li><a href="/enterprise">Enterprise</a></li>
              <li><a href="/security-compliance">Security &amp; Privacy</a></li>
              <li><a href="/contact">Contact Us</a></li>
            </ul>
          </div>
        </div>

        <div class="container footer-bottom-bar">
          <p class="footer-copyright">© 2026 TakeRemo. All rights reserved. Built with precision for human-led voice operations.</p>
          <p class="footer-credit"><a href="/terms" class="footer-credit-link">Terms</a> · <a href="/privacy" class="footer-credit-link">Privacy</a> · Design and developed by <a href="https://scorelabsinc.com" target="_blank" rel="noopener" class="footer-credit-link"><strong>Scorelabs Inc</strong></a></p>
        </div>
      </footer>

      <div class="demo-modal-backdrop" id="demo-modal">
        <div class="demo-modal-dialog glow-card" role="dialog" aria-modal="true" aria-labelledby="demo-modal-title">
          <button type="button" class="modal-close-btn" id="modal-close-btn" aria-label="Close modal">×</button>
          <div class="modal-header">
            <div class="modal-badge">TakeRemo DEMO</div>
            <h3 class="modal-title" id="demo-modal-title">Experience Remo in action</h3>
            <p class="modal-subtitle">Tell us a little about you and we'll set up a live AI employee demo. You'll get a confirmation email straight away.</p>
          </div>
          <form class="modal-form" id="demo-form">
            <div class="form-row">
              <div class="form-group"><label for="demo-name">Full name <span class="req">*</span></label>
                <input type="text" id="demo-name" required minlength="2" maxlength="80" autocomplete="name" placeholder="e.g. Anand Mahindra"></div>
              <div class="form-group"><label for="demo-email">Work email <span class="req">*</span></label>
                <input type="email" id="demo-email" required maxlength="120" autocomplete="email" placeholder="name@company.com"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label for="demo-company">Company name <span class="req">*</span></label>
                <input type="text" id="demo-company" required minlength="2" maxlength="100" autocomplete="organization" placeholder="e.g. Acme Enterprises"></div>
              <div class="form-group"><label for="demo-phone">Phone number <span class="req">*</span></label>
                <input type="tel" id="demo-phone" required maxlength="24" inputmode="tel" autocomplete="tel" pattern="[0-9+()\\-\\s]{8,24}" title="Enter a valid phone number, e.g. +91 98000 00000" placeholder="+91 98000 00000"></div>
            </div>
            <div class="form-group"><label for="demo-usecase">Primary use case <span class="req">*</span></label>
              <select id="demo-usecase" required>
                <option value="recruitment">Recruitment Screening &amp; Interview Scheduling</option>
                <option value="sales">Sales Outreach &amp; Lead Qualification</option>
                <option value="support">Customer Support &amp; Issue Resolution</option>
                <option value="appointment">Appointment Setting &amp; Reminders</option>
                <option value="receptionist">AI Receptionist &amp; Call Handling</option>
                <option value="omnichannel">Enterprise Voice Operations</option>
              </select></div>
            <div class="form-group"><label for="demo-notes">Anything specific you'd like Remo to handle? <span class="opt">(optional)</span></label>
              <textarea id="demo-notes" rows="3" maxlength="600" placeholder="e.g. Screen 200 candidates a week in Hindi and English"></textarea></div>
            <div class="hp-field" aria-hidden="true"><label for="demo-website">Leave this field empty</label>
              <input type="text" id="demo-website" tabindex="-1" autocomplete="off"></div>
            <div class="form-error" id="demo-form-error" role="alert" hidden></div>
            <button type="submit" class="btn btn-primary btn-full btn-lg btn-glow"><span>Get my demo</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6" /></svg></button>
            <p class="form-fineprint">We'll only use your details to set up your demo. No spam.</p>
          </form>
          <div class="modal-success-screen" id="modal-success">
            <div class="success-icon-wrap"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg></div>
            <h4 class="success-title">Request received!</h4>
            <p class="success-desc">We've emailed a confirmation with everything you submitted to <strong id="modal-success-email"></strong>. Our team will reach out shortly to set up your demo.</p>
            <p class="success-hint">Can't see it? Check your spam folder.</p>
            <button type="button" class="btn btn-secondary btn-sm" id="modal-reset-btn">Close</button>
          </div>
        </div>
      </div>`);
  }

  /* ------------------------------------------------------------- demo form */
  function wireDemoForm() {
    const modal = $('#demo-modal');
    const form = $('#demo-form');
    const success = $('#modal-success');
    const errorBox = $('#demo-form-error');
    const select = $('#demo-usecase');
    const useCaseFor = { recruitment: 'recruitment', sales: 'sales', 'customer-support': 'support', 'appointment-setting': 'appointment', receptionist: 'receptionist' };

    const setError = (msg) => { errorBox.textContent = msg || ''; errorBox.hidden = !msg; };

    const open = () => {
      select.value = useCaseFor[slug] || 'omnichannel';
      modal.classList.add('active');
      body.style.overflow = 'hidden';
      if (form.style.display !== 'none') setTimeout(() => $('#demo-name').focus(), 60);
    };
    const close = () => {
      modal.classList.remove('active');
      body.style.overflow = '';
      setTimeout(() => { form.style.display = 'flex'; success.classList.remove('visible'); setError(''); }, 300);
    };

    $$('[data-open-demo]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); open(); }));
    $('#modal-close-btn').addEventListener('click', close);
    $('#modal-reset-btn').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('active')) close(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setError('');
      const btn = $('button[type="submit"]', form);
      const original = btn.innerHTML;
      const val = (id) => $(id).value.trim();
      const payload = {
        name: val('#demo-name'), email: val('#demo-email'), company: val('#demo-company'), phone: val('#demo-phone'),
        useCase: val('#demo-usecase'), notes: val('#demo-notes'), website: val('#demo-website')
      };
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>Sending your request…</span>';
      try {
        const res = await fetch('/api/demo/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || 'Something went wrong. Please try again.');
        $('#modal-success-email').textContent = data.email || payload.email;
        form.reset();
        form.style.display = 'none';
        success.classList.add('visible');
      } catch (err) {
        setError(err instanceof TypeError ? "We couldn't reach the server. Please check your connection and try again." : err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });
  }

  /* -------------------------------------------------------- small page bits */
  function splitWords(el) {
    let i = 0;
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const span = document.createElement('span');
            span.className = 'sv-word';
            span.style.setProperty('--i', i++);
            span.textContent = part;
            frag.appendChild(span);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1) {
          walk(child);
        }
      });
    };
    walk(el);
  }

  function fillMore() {
    const grid = $('#sv-more-grid');
    if (!grid) return;
    grid.innerHTML = SERVICES.filter((s) => s.slug !== slug).map((s, i) => `
      <a class="sv-more-card sv-reveal" style="--c:${s.rgb};--d:${i * 0.08}s" href="${s.path}">
        <span class="sv-more-arrow">${arrowSvg.replace('width="18" height="18"', 'width="22" height="22"')}</span>
        <i class="sv-more-dot"></i>
        <div><h3>${s.name}</h3><p>${s.line}</p></div>
      </a>`).join('');
  }

  function watchScroll() {
    const bar = $('#sv-progress');
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? clamp(window.scrollY / max) : 0})`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // The header follows what is behind it: dark over the dark sections, light over the light ones
  function watchHeaderTheme() {
    const nav = $('#top-nav');
    const sections = $$('main > section');
    if (!nav || !sections.length) return;
    if (body.hasAttribute('data-light-page')) return; // fully light page: the header stays light
    if (body.hasAttribute('data-dark-page')) { // sections declare data-theme; the header follows the one behind it
      const footer = $('#footer');
      const sync = () => {
        const probe = nav.offsetHeight / 2;
        let dark = window.scrollY < 2;
        if (!dark) {
          const under = sections.find((s) => { const r = s.getBoundingClientRect(); return r.top <= probe && r.bottom > probe; });
          dark = !!under && under.dataset.theme === 'dark';
          if (!under && footer && footer.getBoundingClientRect().top <= probe) dark = false;
        }
        nav.classList.toggle('nav-dark', dark);
      };
      window.addEventListener('scroll', sync, { passive: true });
      window.addEventListener('resize', sync);
      sync();
      return;
    }
    const darkSections = new Set([sections[0], sections[3], sections[sections.length - 1]].filter(Boolean));

    const update = () => {
      const probe = nav.offsetHeight / 2;
      let dark = window.scrollY < 2; // at the very top the header sits above the dark hero
      if (!dark) {
        const under = sections.find((s) => {
          const r = s.getBoundingClientRect();
          return r.top <= probe && r.bottom > probe;
        });
        dark = !!under && darkSections.has(under);
      }
      nav.classList.toggle('nav-dark', dark);
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  function runCount(el) {
    const to = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.decimals || '0', 10);
    const pre = el.dataset.prefix || '';
    const suf = el.dataset.suffix || '';
    if (reduce) { el.textContent = pre + to.toFixed(dec) + suf; return; }
    const t0 = performance.now();
    const tick = (now) => {
      const p = clamp((now - t0) / 1700);
      el.textContent = pre + (to * (1 - Math.pow(1 - p, 3))).toFixed(dec) + suf;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function observeReveals() {
    if (!('IntersectionObserver' in window)) {
      $$('.sv-reveal, .sv-steps, .sv-feature').forEach((el) => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
    $$('.sv-reveal, .sv-steps, .sv-feature').forEach((el) => io.observe(el));

    const counters = $$('[data-count]');
    counters.forEach((el) => { if (!reduce) el.textContent = (el.dataset.prefix || '') + '0' + (el.dataset.suffix || ''); });
    const cio = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        runCount(entry.target);
        cio.unobserve(entry.target);
      });
    }, { threshold: 0.5 });
    counters.forEach((el) => cio.observe(el));
  }

  /* ----------------------------------------------------- typed sample call */
  async function runCall(root) {
    const bubbles = $$('.sv-bubble', root);
    const rows = $$('.sv-data-row', root);
    const convo = $('.sv-convo', root);
    const typing = document.createElement('div');
    typing.className = 'sv-typing';
    typing.innerHTML = '<i></i><i></i><i></i>';
    convo.appendChild(typing);

    bubbles.forEach((b) => {
      const p = $('p', b);
      p.innerHTML = p.textContent.trim().split(/\s+/).map((w, i) => `<span class="sv-w" style="--w:${i}">${w}</span>`).join(' ');
    });

    for (const b of bubbles) {
      typing.classList.toggle('is-right', b.classList.contains('sv-caller'));
      convo.insertBefore(typing, b);
      typing.classList.add('is-on');
      await sleep(650 + Math.random() * 300);
      typing.classList.remove('is-on');
      b.classList.add('is-shown');
      await sleep($$('.sv-w', b).length * 38 + 650);
    }
    typing.remove();
    for (const r of rows) { r.classList.add('is-filled'); await sleep(300); }
    const saved = $('.sv-saved', root);
    if (saved) saved.classList.add('is-filled');
  }

  function wireCall() {
    const root = $('.sv-call');
    if (!root || reduce || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      runCall(root);
    }, { threshold: 0.35 });
    io.observe(root);
  }

  /* ------------------------------------------------------------ canvas stage */
  function stage(host, draw, staticT) {
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    host.appendChild(cv);
    const ctx = cv.getContext('2d');
    let w = 0, h = 0, raf = 0, on = false;
    const t0 = performance.now();

    const size = () => {
      const r = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const paint = (t) => { ctx.clearRect(0, 0, w, h); draw(ctx, t, w, h); };
    const frame = (now) => {
      raf = 0;
      if (!on || document.hidden) return;
      paint((now - t0) / 1000);
      raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf && on && !document.hidden) raf = requestAnimationFrame(frame); };

    size();
    if (reduce) {
      paint(staticT);
      new ResizeObserver(() => { size(); paint(staticT); }).observe(host);
      return;
    }
    new ResizeObserver(size).observe(host);
    new IntersectionObserver(([e]) => { on = e.isIntersecting; kick(); }, { threshold: 0.05 }).observe(host);
    document.addEventListener('visibilitychange', kick);
  }

  const mono = (px, weight = 600) => `${weight} ${px}px "JetBrains Mono", ui-monospace, monospace`;
  function label(ctx, str, x, y, { size = 11, color = '#94A3B8', align = 'left', weight = 600 } = {}) {
    ctx.font = mono(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function glow(ctx, x, y, r, a) {
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, rgba(a));
    g.addColorStop(0.4, rgba(a * 0.4));
    g.addColorStop(1, rgba(0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  /* ====================================================================
     SCENE 1 — Recruitment: "The Shortlist"
     A sonar from Remo sweeps a crowd of candidates. Each gets a call; the
     right five glide out of the crowd into a shortlist.
     ==================================================================== */
  function sceneRecruitment(host) {
    const R = rng(11);
    const N = 74, SPEED = 0.5, CYCLE = 13, SLOT_X = 0.88;
    const O = { x: 0.15, y: 0.5 };
    const cands = [];
    for (let i = 0; i < N; i++) {
      const a = R() * TAU, r = Math.sqrt(R());
      cands.push({ x: 0.55 + Math.cos(a) * r * 0.27, y: 0.5 + Math.sin(a) * r * 0.36, ph: R() * TAU, sp: 0.5 + R() });
    }
    cands.forEach((c) => { c.ct = 0.7 + Math.hypot(c.x - O.x, c.y - O.y) / SPEED; });
    [...cands.keys()].sort(() => R() - 0.5).slice(0, 5)
      .sort((a, b) => cands[a].ct - cands[b].ct)
      .forEach((ci, j) => { cands[ci].slot = j; });

    // What each of the five dots stands for, top to bottom
    const STEPS = ['Calling', 'Screening', 'Shortlisting', 'Scheduling interview', 'Follow-up'];
    const slotCand = [];
    cands.forEach((c) => { if (c.slot !== undefined) slotCand[c.slot] = c; });

    stage(host, (ctx, t, w, h) => {
      const tc = t % CYCLE;
      ctx.globalAlpha = Math.min(clamp(tc / 0.7), clamp((CYCLE - tc) / 1.2));
      const ox = O.x * w, oy = O.y * h;

      for (let j = 0; j < 5; j++) {
        const sy = (0.2 + j * 0.15) * h;
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(SLOT_X * w, sy, 12, 0, TAU); ctx.stroke();

        // Step name above its dot; lights up once that dot is filled. Kept inside the frame on narrow screens.
        const c = slotCand[j];
        const filled = c && tc >= c.ct + 0.7 + j * 0.45 + 1.5;
        const half = STEPS[j].length * 3.3 + 4;
        const lx = Math.min(SLOT_X * w, w - half);
        label(ctx, STEPS[j], lx, sy - 26, { size: 10, align: 'center', color: filled ? rgba(1) : '#94A3B8' });
      }

      [0.7, 2.4, 4.1].forEach((k0) => {
        const age = tc - k0;
        if (age > 0 && age < 2.6) {
          ctx.strokeStyle = rgba((1 - age / 2.6) * 0.5); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(ox, oy, age * SPEED * w, 0, TAU); ctx.stroke();
        }
      });

      let contacted = 0, arrived = 0;
      cands.forEach((c) => {
        const bx = c.x * w + Math.sin(t * c.sp + c.ph) * 0.006 * w;
        const by = c.y * h + Math.cos(t * c.sp * 0.8 + c.ph) * 0.006 * h;
        let x = bx, y = by, done = false;
        const hit = tc >= c.ct;
        if (hit) contacted++;
        if (hit && c.slot !== undefined) {
          const start = c.ct + 0.7 + c.slot * 0.45;
          const k = clamp((tc - start) / 1.5);
          if (k > 0) {
            const e = ease(k), sx = SLOT_X * w, sy = (0.2 + c.slot * 0.15) * h;
            const cx = lerp(bx, sx, 0.5), cy = Math.min(by, sy) - 0.1 * h;
            x = (1 - e) * (1 - e) * bx + 2 * (1 - e) * e * cx + e * e * sx;
            y = (1 - e) * (1 - e) * by + 2 * (1 - e) * e * cy + e * e * sy;
            if (k >= 1) { done = true; arrived++; }
          }
        }
        if (hit) {
          const age = tc - c.ct;
          if (age < 0.55) {
            ctx.strokeStyle = rgba((1 - age / 0.55) * 0.8); ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(bx, by, 3 + age * 22, 0, TAU); ctx.stroke();
          }
        }
        ctx.fillStyle = !hit ? 'rgba(148,163,184,0.42)' : c.slot !== undefined ? rgba(0.95) : 'rgba(148,163,184,0.2)';
        ctx.beginPath(); ctx.arc(x, y, done ? 7 : hit && c.slot !== undefined ? 3.8 : 3, 0, TAU); ctx.fill();
        if (done) {
          ctx.strokeStyle = '#06101f'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x - 0.8, y + 2.4); ctx.lineTo(x + 3.2, y - 2.4); ctx.stroke();
        }
      });

      glow(ctx, ox, oy, 46 + Math.sin(t * 2) * 4, 0.9);
      ctx.fillStyle = rgba(1); ctx.beginPath(); ctx.arc(ox, oy, 9, 0, TAU); ctx.fill();
      label(ctx, 'REMO', ox, oy + 36, { size: 10, align: 'center', color: '#E2E8F0' });
      label(ctx, `${contacted} called`, 0.07 * w, 0.93 * h, { size: 11 });
      label(ctx, `${arrived} shortlisted`, 0.93 * w, 0.93 * h, { size: 11, align: 'right', color: rgba(1) });
      ctx.globalAlpha = 1;
    }, 5.5);
  }

  /* ====================================================================
     SCENE 2 — Sales: "Speed to Lead"
     Cold leads drift slowly toward Remo. The moment they pass the gate they
     are called: they speed up, glow and stream into a booked demo.
     ==================================================================== */
  function sceneSales(host) {
    const R = rng(5);
    const SLOW = 0.06, FAST = 0.3, GATE = 0.46;
    const T1 = GATE / SLOW, T = T1 + (1 - GATE) / FAST;
    const P = 70;
    const ps = Array.from({ length: P }, (_, i) => ({ lane: (i % 9) / 4 - 1 + (R() - 0.5) * 0.12, off: R() * T, ph: R() * TAU }));
    const uOf = (tau) => (tau < T1 ? SLOW * tau : GATE + FAST * (tau - T1));
    const spread = (u) => (u < 0.3 ? 1 : u < GATE ? lerp(1, 0.1, ease((u - 0.3) / (GATE - 0.3))) : u < 0.78 ? lerp(0.1, 0.6, ease((u - GATE) / (0.78 - GATE))) : 0.6);

    stage(host, (ctx, t, w, h) => {
      const at = (u, p) => [0.06 * w + u * 0.88 * w, 0.5 * h + p.lane * 0.3 * h * spread(u) + Math.sin(u * 9 + p.ph) * 0.008 * h];
      let crossing = 0, arriving = 0;

      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
      [-1, -0.5, 0, 0.5, 1].forEach((lane) => {
        ctx.beginPath();
        for (let u = 0; u <= 1.001; u += 0.02) { const [x, y] = at(u, { lane, ph: 0 }); u === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        ctx.stroke();
      });

      ps.forEach((p) => {
        const tau = (t + p.off) % T, u = uOf(tau);
        if (Math.abs(u - GATE) < 0.02) crossing++;
        if (u > 0.93) arriving++;
        const [x, y] = at(u, p);
        if (tau < T1) {
          ctx.fillStyle = 'rgba(148,163,184,0.45)';
          ctx.beginPath(); ctx.arc(x, y, 2.4, 0, TAU); ctx.fill();
        } else {
          for (let k = 9; k >= 1; k--) {
            const tk = tau - k * 0.035;
            if (tk < T1 - 0.05) continue;
            const [tx, ty] = at(uOf(tk), p);
            ctx.fillStyle = rgba(0.7 * (1 - k / 10));
            ctx.beginPath(); ctx.arc(tx, ty, 2.6 * (1 - k / 14), 0, TAU); ctx.fill();
          }
          ctx.fillStyle = rgba(1);
          ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill();
        }
      });

      const gx = 0.06 * w + GATE * 0.88 * w, gy = 0.5 * h, gi = clamp(crossing / 2);
      glow(ctx, gx, gy, 0.14 * w, 0.35 + gi * 0.5);
      ctx.strokeStyle = rgba(0.6 + gi * 0.4); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gx, gy, 0.075 * w, 0, TAU); ctx.stroke();
      label(ctx, 'REMO CALLS', gx, gy - 0.115 * w, { size: 10, align: 'center', color: '#E2E8F0' });
      const sec = Math.floor(((t % 6) / 6) * 30);
      label(ctx, `0:${String(sec).padStart(2, '0')}`, gx, gy + 0.14 * w, { size: 20, align: 'center', color: '#FFFFFF', weight: 700 });
      label(ctx, 'speed to lead', gx, gy + 0.2 * w, { size: 10, align: 'center' });

      label(ctx, '30 MINUTES LATER', 0.07 * w, 0.09 * h, { size: 10, color: '#64748B' });
      label(ctx, '30 SECONDS', 0.93 * w, 0.09 * h, { size: 10, align: 'right', color: rgba(1) });

      const pulse = clamp(arriving / 3);
      ctx.strokeStyle = rgba(0.45 + pulse * 0.5); ctx.fillStyle = rgba(0.08 + pulse * 0.16); ctx.lineWidth = 1.5;
      roundRect(ctx, 0.66 * w, 0.84 * h, 0.28 * w, 0.075 * h, 12); ctx.fill(); ctx.stroke();
      label(ctx, 'Demo booked ✓', 0.8 * w, 0.8775 * h, { size: 11, align: 'center', color: '#FFFFFF' });
    }, 4);
  }

  /* ====================================================================
     SCENE 3 — Customer Support: "Untangle"
     A knot of phone-menu spaghetti slowly straightens into clean lines;
     calls flow straight through and land as resolved.
     ==================================================================== */
  function sceneSupport(host) {
    const R = rng(23);
    const K = 7, CYCLE = 12;
    const curves = Array.from({ length: K }, (_, i) => ({
      y: 0.2 + (i * 0.6) / (K - 1),
      t1: [0.2 + R() * 0.6, 0.05 + R() * 0.9],
      t2: [0.2 + R() * 0.6, 0.05 + R() * 0.9],
      ph: R() * TAU
    }));
    const bez = (a, b, c, d, s) => { const m = 1 - s; return m * m * m * a + 3 * m * m * s * b + 3 * m * s * s * c + s * s * s * d; };

    stage(host, (ctx, t, w, h) => {
      const tc = t % CYCLE;
      const k = tc < 1.6 ? 0 : tc < 4.6 ? ease((tc - 1.6) / 3) : tc < 8.8 ? 1 : tc < 11.6 ? 1 - ease((tc - 8.8) / 2.8) : 0;
      const ax = 0.1 * w, bx = 0.9 * w;

      curves.forEach((c, i) => {
        const ay = c.y * h, wob = (1 - k) * 0.025;
        const x1 = lerp(c.t1[0] * w + Math.sin(t * 0.9 + c.ph) * wob * w, ax + (bx - ax) / 3, k);
        const y1 = lerp(c.t1[1] * h + Math.cos(t * 0.8 + c.ph) * wob * h, ay, k);
        const x2 = lerp(c.t2[0] * w + Math.cos(t * 0.7 + c.ph) * wob * w, ax + ((bx - ax) * 2) / 3, k);
        const y2 = lerp(c.t2[1] * h + Math.sin(t * 0.9 + c.ph) * wob * h, ay, k);

        ctx.lineWidth = lerp(1.6, 2.4, k);
        ctx.strokeStyle = k > 0.5 ? rgba(lerp(0.35, 0.9, (k - 0.5) * 2)) : `rgba(148,163,184,${lerp(0.4, 0.3, k)})`;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.bezierCurveTo(x1, y1, x2, y2, bx, ay); ctx.stroke();

        ctx.fillStyle = 'rgba(148,163,184,0.5)';
        ctx.beginPath(); ctx.arc(ax, ay, 3.5, 0, TAU); ctx.fill();

        if (k > 0.85) {
          for (let j = 0; j < 2; j++) {
            const s = (t * 0.3 + i * 0.13 + j * 0.5) % 1;
            const px = bez(ax, x1, x2, bx, s), py = bez(ay, y1, y2, ay, s);
            glow(ctx, px, py, 12, 0.7);
            ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(px, py, 2.6, 0, TAU); ctx.fill();
          }
        }
        if (k > 0.6) {
          ctx.globalAlpha = clamp((k - 0.6) / 0.4);
          ctx.strokeStyle = rgba(1); ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(bx + 12, ay, 8, 0, TAU); ctx.stroke();
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(bx + 8.5, ay); ctx.lineTo(bx + 11, ay + 2.5); ctx.lineTo(bx + 15.5, ay - 3); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      });

      ctx.globalAlpha = 1 - clamp(k * 1.6);
      label(ctx, 'ON HOLD…  14:32', 0.1 * w, 0.07 * h, { size: 11, color: '#94A3B8' });
      ctx.globalAlpha = clamp((k - 0.5) * 2);
      label(ctx, 'ZERO HOLD · INSTANT ANSWER', 0.5 * w, 0.07 * h, { size: 11, align: 'center', color: rgba(1) });
      label(ctx, 'RESOLVED', 0.93 * w, 0.93 * h, { size: 11, align: 'right', color: '#E2E8F0' });
      ctx.globalAlpha = 1;
    }, 6);
  }

  /* ====================================================================
     SCENE 4 — Appointment Setting: "The Calendar Fills Itself" (DOM)
     Bookings pop into a month one by one, reminder pings ripple out, and a
     no-show is caught and instantly rebooked.
     ==================================================================== */
  function sceneAppointment(host) {
    const now = new Date();
    const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const OFFSET = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7; // Monday-first
    const DAYS_IN_MONTH = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const ROWS = Math.ceil((OFFSET + DAYS_IN_MONTH) / 7);
    host.insertAdjacentHTML('beforeend', `
      <div class="sv-cal">
        <div class="sv-cal-head"><strong>${monthLabel}</strong><span class="sv-cal-count">0 booked</span></div>
        <div class="sv-cal-dow">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span>${d}</span>`).join('')}</div>
        <div class="sv-cal-grid"></div>
      </div>`);
    const grid = $('.sv-cal-grid', host);
    const count = $('.sv-cal-count', host);
    grid.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;
    const cells = [];
    for (let i = 0; i < ROWS * 7; i++) {
      const day = i - OFFSET + 1, ok = day >= 1 && day <= DAYS_IN_MONTH;
      const el = document.createElement('i');
      el.className = 'sv-cell' + (ok ? '' : ' is-blank');
      if (ok) el.innerHTML = `<b>${day}</b><u class="sv-chip"><s></s><span></span></u>`;
      grid.appendChild(el);
      cells.push({ el, ok, weekday: i % 7 < 5 });
    }
    const days = cells.filter((c) => c.ok && c.weekday);
    const NAMES = ['PK', 'RM', 'AS', 'NJ', 'VR', 'SK', 'DT', 'MB', 'LH', 'AG', 'TS', 'KP', 'RN', 'ZA', 'FG'];
    const TIMES = ['9:00', '10:30', '11:15', '2:00', '3:30', '4:45'];
    const R = rng(3);
    const setChip = (c, name, time) => { $('.sv-chip s', c.el).textContent = name; $('.sv-chip span', c.el).textContent = time; };
    const clearAll = () => cells.forEach((c) => c.el.classList.remove('is-booked', 'is-noshow', 'is-rebooked', 'is-ping'));
    const shuffle = (arr) => arr.map((v) => [R(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

    if (reduce) {
      shuffle(days).slice(0, 15).forEach((c, i) => { setChip(c, NAMES[i], TIMES[i % TIMES.length]); c.el.classList.add('is-booked'); });
      count.textContent = '15 booked';
      return;
    }

    let active = false;
    new IntersectionObserver(([e]) => { active = e.isIntersecting; }, { threshold: 0.1 }).observe(host);
    const wait = async (ms) => { let left = ms; while (left > 0) { await sleep(100); if (active && !document.hidden) left -= 100; } };

    (async () => {
      for (;;) {
        clearAll();
        count.textContent = '0 booked';
        await wait(900);
        const order = shuffle(days).slice(0, 15);
        for (let i = 0; i < order.length; i++) {
          const c = order[i];
          setChip(c, NAMES[i], TIMES[Math.floor(R() * TIMES.length)]);
          c.el.classList.add('is-booked');
          count.textContent = `${i + 1} booked`;
          if (i > 1 && i % 3 === 2) {
            const prev = order[i - 2].el;
            prev.classList.remove('is-ping'); void prev.offsetWidth; prev.classList.add('is-ping');
          }
          if (i === 9) {
            const n = order[4];
            await wait(500);
            n.el.classList.remove('is-booked'); n.el.classList.add('is-noshow'); setChip(n, 'No-show', '—');
            await wait(1200);
            n.el.classList.remove('is-noshow'); n.el.classList.add('is-rebooked'); setChip(n, NAMES[4], '3:30');
          }
          await wait(620);
        }
        await wait(3200);
        clearAll();
        await wait(700);
      }
    })();
  }

  /* ====================================================================
     SCENE 5 — Receptionist: "The 24-Hour Dial"
     A hand sweeps a 24-hour dial (a whole day in 12 seconds). Calls ping in
     at every hour, day and night, and each one is answered instantly.
     ==================================================================== */
  function sceneReceptionist(host) {
    const CALLS = [1.2, 2.9, 4.5, 6.8, 8.4, 10.1, 12.3, 13.7, 15.4, 17.2, 19.1, 21.6, 22.9]; // hour of day
    const DAY = 12;
    const fmt = (hr) => { const hh = Math.floor(hr), mm = Math.floor((hr - hh) * 60); const h12 = hh % 12 === 0 ? 12 : hh % 12; return `${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };
    const ang = (hr) => -Math.PI / 2 + (hr / 24) * TAU;
    const R2 = rng(9);
    const stars = Array.from({ length: 28 }, () => ({ hr: (R2() * 10 + 20) % 24, off: R2(), tw: R2() * TAU }));

    stage(host, (ctx, t, w, h) => {
      const cx = w / 2, cy = h / 2 - 0.02 * h, R0 = 0.27 * w;
      const handHr = ((t % DAY) / DAY) * 24;
      const hand = ang(handHr);

      ctx.lineWidth = 0.06 * w; ctx.lineCap = 'butt';
      ctx.strokeStyle = rgba(0.13); ctx.beginPath(); ctx.arc(cx, cy, R0, ang(6), ang(20)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.beginPath(); ctx.arc(cx, cy, R0, ang(20), ang(30)); ctx.stroke();
      stars.forEach((s) => {
        const a = ang(s.hr), r = R0 + (s.off - 0.5) * 0.05 * w;
        ctx.fillStyle = `rgba(226,232,240,${0.25 + 0.35 * Math.sin(t * 2 + s.tw) ** 2})`;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.1, 0, TAU); ctx.fill();
      });

      for (let i = 0; i < 24; i++) {
        const a = ang(i), big = i % 6 === 0, r1 = R0 + 0.045 * w, r2 = r1 + (big ? 0.032 : 0.016) * w;
        ctx.strokeStyle = big ? 'rgba(226,232,240,0.7)' : 'rgba(148,163,184,0.4)'; ctx.lineWidth = big ? 2 : 1.2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
      }
      [['12 AM', 0], ['6 AM', 6], ['12 PM', 12], ['6 PM', 18]].forEach(([txt, hr]) => {
        const a = ang(hr), r = R0 + 0.115 * w;
        label(ctx, txt, cx + Math.cos(a) * r, cy + Math.sin(a) * r, { size: 10, align: 'center' });
      });

      ctx.lineWidth = 0.06 * w;
      for (let k = 0; k < 36; k++) {
        ctx.strokeStyle = rgba((1 - k / 36) * 0.4);
        ctx.beginPath(); ctx.arc(cx, cy, R0, hand - (k + 1) * 0.022, hand - k * 0.022); ctx.stroke();
      }
      ctx.strokeStyle = rgba(1); ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(hand) * 0.09 * w, cy + Math.sin(hand) * 0.09 * w); ctx.lineTo(cx + Math.cos(hand) * (R0 + 0.04 * w), cy + Math.sin(hand) * (R0 + 0.04 * w)); ctx.stroke();

      let answered = 0, flash = 0;
      CALLS.forEach((hr) => {
        const age = (((handHr - hr + 24) % 24) / 24) * DAY;
        if (hr <= handHr) answered++;
        if (age > 2.4 || age < 0) return;
        const a = ang(hr), px = cx + Math.cos(a) * R0, py = cy + Math.sin(a) * R0;
        const night = hr < 6 || hr >= 20;
        if (age < 0.5) flash = Math.max(flash, 1 - age / 0.5);
        ctx.strokeStyle = rgba(clamp(1 - age / 2.4) * 0.6); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(px, py, 6 + age * 26, 0, TAU); ctx.stroke();
        const k = clamp(age / 0.45);
        ctx.strokeStyle = rgba(0.7 * (1 - clamp((age - 0.45) / 1.2))); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(lerp(px, cx, k), lerp(py, cy, k)); ctx.stroke();
        ctx.fillStyle = night ? '#E2E8F0' : rgba(1);
        ctx.beginPath(); ctx.arc(px, py, 5, 0, TAU); ctx.fill();
        ctx.globalAlpha = clamp((2.2 - age) / 0.7);
        const lr = R0 - 0.115 * w;
        label(ctx, `${fmt(hr)}`, cx + Math.cos(a) * lr, cy + Math.sin(a) * lr - 7, { size: 10, align: 'center', color: '#FFFFFF' });
        label(ctx, 'answered', cx + Math.cos(a) * lr, cy + Math.sin(a) * lr + 7, { size: 9, align: 'center', color: rgba(1) });
        ctx.globalAlpha = 1;
      });

      glow(ctx, cx, cy, 0.12 * w + flash * 10, 0.55 + flash * 0.4);
      ctx.fillStyle = rgba(1); ctx.beginPath(); ctx.arc(cx, cy, 0.04 * w + flash * 3, 0, TAU); ctx.fill();
      label(ctx, 'REMO', cx, cy + 0.075 * w, { size: 10, align: 'center', color: '#E2E8F0' });
      label(ctx, `${answered} answered  ·  0 missed`, cx, h * 0.95, { size: 11, align: 'center', color: '#E2E8F0' });
    }, 7);
  }

  const SCENES = {
    recruitment: sceneRecruitment,
    sales: sceneSales,
    'customer-support': sceneSupport,
    'appointment-setting': sceneAppointment,
    receptionist: sceneReceptionist
  };

  /* ---------------------------------------------------------------- auth nav */
  // Same as the homepage: for a signed-in visitor, Login / Create Account become Dashboard / Logout.
  async function setupAuthNav() {
    const login = $('#nav-signin-btn');
    const signup = $('#nav-signup-btn');
    if (!login || !signup) return;

    let user = null;
    try {
      const res = await fetch('/api/auth/me', { headers: { Accept: 'application/json' }, credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        user = data.success ? data.user : null;
      }
    } catch (e) {
      return;
    }
    if (!user) return;

    const destination = user.profileCompleted ? '/dashboard' : '/onboarding';
    const logout = async (e) => {
      e.preventDefault();
      try {
        await fetch('/api/auth/logout', { method: 'POST', headers: { Accept: 'application/json' }, credentials: 'include' });
      } catch (err) { /* leave anyway */ }
      window.location.href = '/signin';
    };
    const swap = (loginEl, signupEl) => {
      loginEl.href = destination;
      loginEl.innerHTML = '<span>Dashboard</span>';
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary btn-sm';
      btn.innerHTML = '<span>Logout</span>';
      btn.addEventListener('click', logout);
      signupEl.replaceWith(btn);
      return btn;
    };

    swap(login, signup).id = 'nav-logout-btn';
    login.id = 'nav-dashboard-btn';

    // The same two buttons in the phone menu
    const cta = $('.mobile-nav-cta');
    if (cta) {
      const links = cta.querySelectorAll('a');
      if (links.length >= 2) swap(links[0], links[1]);
    }
  }

  /* ------------------------------------------------------------------- go */
  document.title = document.title || `${current.name} | TakeRemo`;
  buildShell();
  setupAuthNav();
  wireDemoForm();
  watchScroll();
  watchHeaderTheme();
  fillMore();
  const headline = $('.sv-h1');
  if (headline && !reduce) splitWords(headline);
  observeReveals();
  wireCall();
  const host = $('[data-scene]');
  if (host && SCENES[slug]) SCENES[slug](host);
})();
