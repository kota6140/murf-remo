/* ==========================================================================
   TakeRemo — Industries.
   1) Hero: a 3D ring of the eight industries. Drag to spin (with inertia),
      it drifts on its own, and tiles fade as they turn away.
   2) The turn: eight blinds lift in industry colours as you scroll.
   3) Story: scroll the list and the live call card on the left changes with it.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    healthcare: `<svg viewBox="0 0 24 24" ${S}><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>`,
    recruitment: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
    sales: `<svg viewBox="0 0 24 24" ${S}><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>`,
    education: `<svg viewBox="0 0 24 24" ${S}><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/></svg>`,
    realestate: `<svg viewBox="0 0 24 24" ${S}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>`,
    support: `<svg viewBox="0 0 24 24" ${S}><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h3v5H4z"/><path d="M17 14h3v5h-3z"/></svg>`,
    finance: `<svg viewBox="0 0 24 24" ${S}><path d="M3 10l9-6 9 6"/><path d="M5 10v8M9 10v8M15 10v8M19 10v8"/><path d="M3 20h18"/></svg>`,
    automotive: `<svg viewBox="0 0 24 24" ${S}><path d="M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16"/><path d="M3 16h18v3H3z"/><path d="M7 19v1.5M17 19v1.5"/></svg>`
  };
  const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  // sample calls and capabilities (same wording as the homepage industries section)
  const DATA = {
    healthcare: { c: '20,184,166', title: 'HEALTHCARE & CLINICS', text: 'Hi Mrs. Gupta, this is Remo from Apollo Clinic confirming your appointment with Dr. Mehta tomorrow at 4:00 PM. Have you completed the recommended fasting for your lab panel?', chips: ['Appointment Confirmation', 'Pre-Visit Guidelines', 'Rescheduling Support', 'EHR Status Synced'] },
    recruitment: { c: '96,140,255', title: 'RECRUITMENT & STAFFING', text: 'Hi Pooja, I am Remo from the talent team. I saw your application for Senior Developer. Could you share how many years of React experience you have and your current notice period?', chips: ['Candidate Outreach', 'Skill Verification', 'Notice Period Check', 'ATS Auto-Sync'] },
    sales: { c: '252,36,21', title: 'SALES & INBOUND LEADS', text: 'Hello Vikram, this is Remo from TakeRemo. I noticed you just requested pricing for automated calling. Is this a good time to discuss your monthly lead volume?', chips: ['Sub-30s Speed-to-Lead', 'Budget & Need Discovery', 'Calendar Demo Booking', 'CRM Contact Sync'] },
    education: { c: '245,158,11', title: 'EDUCATION & EDTECH', text: 'Hello Rohit, Remo here from Greenfield University. I am following up on your application for the Data Science Master program. Would you like to schedule an advisor consultation?', chips: ['Admissions Inquiries', 'Course Eligibility Check', 'Counselor Walkthroughs', 'Fee Deadlines Reminder'] },
    realestate: { c: '168,85,247', title: 'REAL ESTATE & PROPERTY', text: 'Hi Priya, this is Remo calling from Prestige Heights regarding the 3-BHK inquiry you submitted. Are you looking to visit the property this Saturday or Sunday?', chips: ['Buyer Qualification', 'Budget & Locality Discovery', 'Site Visit Booking', 'Broker Instant Alert'] },
    support: { c: '16,185,129', title: 'CUSTOMER SUPPORT & OPERATIONS', text: 'Thank you for calling support. This is Remo. I see your order #8492 is out for delivery with Bluedart and will arrive today by 2:30 PM. I have also texted you the live tracking link.', chips: ['Zero Queue Wait Time', 'Order & Delivery Lookup', 'WhatsApp Auto-Dispatch', 'First-Call Resolution'] },
    finance: { c: '14,165,233', title: 'FINANCIAL SERVICES & BFSI', text: 'Hello Suresh, this is Remo from FinServe. I am following up regarding your KYC verification document upload for your business account. May I guide you through the remaining steps?', chips: ['KYC Document Follow-up', 'Loan Pre-Screening', 'Payment Reminders', 'Compliance-Logged Audio'] },
    automotive: { c: '249,115,22', title: 'AUTOMOTIVE DEALERSHIPS', text: 'Hi Ananya, Remo calling from Hyundai Motors. You requested a test drive for the new Creta. We have a test vehicle available tomorrow at 11:00 AM at the Indiranagar showroom.', chips: ['Test Drive Booking', 'Service Maintenance Alerts', 'Finance Eligibility Check', 'Trade-In Valuation Intake'] }
  };
  const KEYS = Object.keys(DATA);

  const wordsHtml = (text) => text.split(' ').map((w, i) => `<span class="ix-word" style="--w:${i}">${w}</span>`).join(' ');
  const chipsHtml = (chips) => chips.map((c, n) => `<span style="--n:${n}">${CHECK}${c}</span>`).join('');

  // inject the icons
  $$('[data-ic]').forEach((el) => { el.innerHTML = ICONS[el.dataset.ic] || ''; });

  /* ------------------------------------------------------------ 1. the ring */
  function initRing() {
    const wrap = $('#ix-ring');
    const inner = $('#ix-ring-in');
    if (!wrap || !inner) return;
    const tiles = $$('.ix-tile', inner);
    const N = tiles.length, STEP = 360 / N;
    let ry = -24, tilt = -8, tiltT = -8, vel = 0;
    const AUTO = reduce ? 0 : 9; // deg per second
    let dragging = false, lastX = 0, lastT = 0, moved = 0, visible = true, last = 0;

    function layout() {
      const w = tiles[0].getBoundingClientRect().width / 1; // untransformed width via offsetWidth below
      const tw = tiles[0].offsetWidth || w;
      const R = (tw / 2) / Math.tan(Math.PI / N) * 1.16;
      tiles.forEach((t, i) => { t.style.transform = `rotateY(${i * STEP}deg) translateZ(${R}px)`; });
    }

    function paint() {
      inner.style.transform = `rotateX(${tilt}deg) rotateY(${ry}deg)`;
      tiles.forEach((t, i) => {
        const a = (((i * STEP + ry) % 360) + 360) % 360;
        const f = Math.cos((a * Math.PI) / 180); // 1 = facing us
        t.style.opacity = (0.2 + 0.8 * clamp((f + 0.35) / 1.35)).toFixed(2);
        t.classList.toggle('front', f > 0.93);
      });
    }

    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible) { last = 0; return; }
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      if (!dragging) {
        ry += vel * dt;
        vel = lerp(vel, AUTO, 1 - Math.exp(-dt * 1.4));
      }
      tilt = lerp(tilt, tiltT, 1 - Math.exp(-dt * 4));
      paint();
    }

    wrap.addEventListener('pointerdown', (e) => {
      dragging = true; moved = 0; lastX = e.clientX; lastT = performance.now();
      wrap.classList.add('drag');
      try { wrap.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });
    wrap.addEventListener('pointermove', (e) => {
      const r = wrap.getBoundingClientRect();
      tiltT = -8 + ((e.clientY - r.top) / r.height - 0.5) * -14;
      if (!dragging) return;
      const dx = e.clientX - lastX, now = performance.now(), dt = Math.max(1, now - lastT) / 1000;
      moved += Math.abs(dx);
      ry += dx * 0.32;
      vel = (dx * 0.32) / dt;
      vel = clamp(vel, -220, 220);
      lastX = e.clientX; lastT = now;
      if (reduce) paint();
    });
    const end = () => { dragging = false; wrap.classList.remove('drag'); if (reduce) vel = 0; };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    wrap.addEventListener('pointerleave', () => { tiltT = -8; });
    // a drag is not a click on a tile
    wrap.addEventListener('click', (e) => { if (moved > 6) e.preventDefault(); }, true);

    window.addEventListener('resize', layout);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(wrap);
    }
    layout(); paint();
    vel = AUTO;
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------ 2. the turn (blinds) */
  function initTurn() {
    const sec = $('#turn');
    if (!sec) return;
    const blinds = $$('.ix-blind', sec);
    const phrase = $('.ix-phrase', sec);
    const copy = $('.ix-turn-copy', sec);
    const chipic = $('#ix-chipic');
    chipic.innerHTML = KEYS.map((k) => `<span class="ix-ic" style="--c:${DATA[k].c}">${ICONS[k]}</span>`).join('');
    let ticking = false;

    function update() {
      ticking = false;
      const rect = sec.getBoundingClientRect();
      const p = clamp(-rect.top / (rect.height - window.innerHeight));
      blinds.forEach((b, i) => {
        const k = clamp((p - (0.2 + i * 0.05)) / 0.34);
        b.style.transform = `translateY(${(-ease(k) * 102).toFixed(2)}%)`;
      });
      phrase.style.opacity = (1 - clamp((p - 0.04) / 0.22)).toFixed(3);
      phrase.style.transform = `scale(${(1 + clamp(p / 0.3) * 0.08).toFixed(3)})`;
      const t = clamp((p - 0.45) / 0.3);
      copy.style.opacity = t.toFixed(3);
      copy.style.transform = `translateY(${((1 - t) * 40).toFixed(1)}px)`;
      sec.dataset.theme = p > 0.6 ? 'light' : 'dark';
    }
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  /* ----------------------------------------------------------- 3. the story */
  function initStory() {
    const grid = $('#ix-story');
    if (!grid) return;
    const items = $$('.ix-item', grid);
    const card = $('#ix-card');
    const cardIc = $('#ix-card-ic');
    const cardTitle = $('#ix-card-title');
    const say = $('#ix-say-text');
    const chips = $('#ix-chips');
    const dots = $('#ix-dots');
    const wave = $('#ix-wave');
    let current = -1;

    wave.innerHTML = Array.from({ length: 34 }, (_, k) => `<i style="--k:${k}"></i>`).join('');
    dots.innerHTML = items.map((it, i) => `<button type="button" aria-label="${$('h3', it).textContent}" data-i="${i}"></button>`).join('');
    const dotBtns = $$('button', dots);
    dotBtns.forEach((b) => b.addEventListener('click', () => items[+b.dataset.i].scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })));

    // each industry links to its own page
    items.forEach((it) => {
      const l = document.createElement('a');
      l.className = 'ix-more-link'; l.href = '/industry/' + it.dataset.key;
      l.innerHTML = `Explore ${$('h3', it).textContent.split(' &')[0]} <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
      $('p', it).after(l);
    });

    // the mobile layout shows each call inside its own item
    items.forEach((it) => {
      const d = DATA[it.dataset.key];
      $('.ix-mcard', it).innerHTML = `<div>“${d.text}”</div><div class="ix-chips">${chipsHtml(d.chips)}</div>`;
    });

    function setActive(i) {
      if (i === current) return;
      current = i;
      const it = items[i], d = DATA[it.dataset.key];
      items.forEach((x, k) => x.classList.toggle('on', k === i));
      dotBtns.forEach((b, k) => b.classList.toggle('on', k === i));
      grid.style.setProperty('--c', d.c);
      cardIc.innerHTML = ICONS[it.dataset.key];
      cardTitle.textContent = d.title;
      say.innerHTML = `“${wordsHtml(d.text)}”`;
      chips.innerHTML = chipsHtml(d.chips);
    }

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) setActive(items.indexOf(e.target)); });
      }, { rootMargin: '-42% 0px -42% 0px' });
      items.forEach((it) => io.observe(it));
    }
    setActive(0);
  }

  initRing();
  initTurn();
  initStory();
})();
