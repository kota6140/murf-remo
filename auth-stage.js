// auth-stage.js — the animated Login and Create Account pages.
// Fills the page: an "Industries We Serve" card on the left, "Our Services" on the right, a row of highlights along
// the bottom (each list lights up one item at a time), TakeRemo's services drifting softly in the background, and
// the card's parts sliding in. On sign up it also shows a password-strength bar. It never touches the forms'
// behaviour; auth-client.js still does the sign in / sign up.
(function () {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel, root) => (root || document).querySelector(sel);

  // The five services Remo handles. c is the colour (r, g, b) used for that service's drifting chips.
  const SERVICES = [
    { key: 'recruitment', word: 'Recruitment', c: '96, 140, 255', events: ['Candidate shortlisted', 'Notice period confirmed', 'Interview booked for Friday'] },
    { key: 'sales', word: 'Sales', c: '252, 36, 21', events: ['Lead qualified', 'Demo booked for 3 PM', 'Follow-up scheduled'] },
    { key: 'support', word: 'Support', c: '16, 185, 129', events: ['Ticket resolved', 'Order status shared', 'Tracking link sent'] },
    { key: 'appointment', word: 'Appointments', c: '168, 85, 247', events: ['Appointment booked', 'Reminder sent', 'Visit confirmed for 5 PM'] },
    { key: 'receptionist', word: 'Reception', c: '34, 211, 238', events: ['Call answered in 2 rings', 'Call routed to sales', 'Message taken'] }
  ];

  // Icons (24x24, stroke)
  const ICON = {
    heartPulse: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/><polyline points="6 12 9 12 11 8 13 16 15 12 18 12"/>',
    bank: '<path d="M3 21h18"/><path d="M5 21V10"/><path d="M9 21V10"/><path d="M15 21V10"/><path d="M19 21V10"/><path d="M12 3L3 9h18z"/>',
    cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
    factory: '<path d="M2 20h20"/><path d="M4 20V10l5 3V10l5 3V4h4v16"/>',
    cap: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
    plane: '<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    laptop: '<rect x="3" y="4" width="18" height="12" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
    dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    phoneCall: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/><path d="M14.05 2a9 9 0 0 1 8 7.94"/><path d="M14.05 6A5 5 0 0 1 18 10"/>',
    headset: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a8 8 0 0 1 0 12"/>',
    wave: '<line x1="4" y1="10" x2="4" y2="14"/><line x1="8" y1="6" x2="8" y2="18"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="16" y1="7" x2="16" y2="17"/><line x1="20" y1="10" x2="20" y2="14"/>',
    bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>',
    chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>',
    chevron: '<polyline points="9 18 15 12 9 6"/>'
  };

  // Left card: the industries (the last tile is "and many more...")
  const INDUSTRIES = [
    { name: 'Healthcare & Hospitals', c: '244, 63, 94', icon: ICON.heartPulse },
    { name: 'Banking & Finance', c: '59, 107, 255', icon: ICON.bank },
    { name: 'Retail & E‑commerce', c: '249, 115, 22', icon: ICON.cart }, // non-breaking hyphen keeps "E-commerce" on one line
    { name: 'Manufacturing & Industrial', c: '168, 85, 247', icon: ICON.factory },
    { name: 'Education & EdTech', c: '14, 165, 233', icon: ICON.cap },
    { name: 'Real Estate & Construction', c: '16, 185, 129', icon: ICON.building },
    { name: 'Travel & Hospitality', c: '124, 58, 237', icon: ICON.plane },
    { name: 'IT & Technology', c: '37, 99, 235', icon: ICON.laptop },
    { name: 'Insurance', c: '16, 185, 129', icon: ICON.shield },
    { name: 'and many more...', c: '148, 163, 184', icon: ICON.dots }
  ];

  // Right card: the services
  const SERVICE_LIST = [
    { name: 'Customer Support Automation', sub: 'Handle queries, provide instant responses', c: '59, 130, 246', icon: ICON.headset },
    { name: 'Tele Sales & Lead Generation', sub: 'Reach more customers, increase conversions', c: '16, 185, 129', icon: ICON.phoneCall },
    { name: 'Recruitment Calling', sub: 'Screen, schedule & follow up candidates', c: '124, 58, 237', icon: ICON.users },
    { name: 'Bulk Calling Campaigns', sub: 'Run high-volume, multi-purpose campaigns', c: '249, 115, 22', icon: ICON.megaphone },
    { name: 'Call Intelligence & Analytics', sub: 'Record, transcribe, summarize & get insights', c: '14, 165, 233', icon: ICON.wave }
  ];

  // Bottom row
  const FEATURES = [
    { name: 'One-Click Campaigns', c: '245, 158, 11', icon: ICON.bolt },
    { name: 'Up to 20,000 Calls/Day', c: '59, 130, 246', icon: ICON.phoneCall },
    { name: 'Call Recording & Transcription', c: '59, 130, 246', icon: ICON.mic },
    { name: 'AI Insights & Reports', c: '124, 58, 237', icon: ICON.chip },
    { name: 'Secure & Reliable', c: '16, 185, 129', icon: ICON.shield }
  ];

  const rand = (min, max) => min + Math.random() * (max - min);
  const svg = (inner, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

  // ---------- background: drifting service events and floating particles ----------
  function buildBackground() {
    const chips = $('#as-chips');
    const dots = $('#as-dots');
    if (chips) {
      const items = [];
      SERVICES.forEach((s) => s.events.forEach((e) => items.push({ s, e })));
      items.sort(() => Math.random() - 0.5);
      const count = window.innerWidth < 640 ? 7 : 13;
      for (let i = 0; i < count; i++) {
        const { s, e } = items[i % items.length];
        const el = document.createElement('span');
        el.className = 'as-chip';
        el.style.setProperty('--c', s.c);
        el.style.setProperty('--x', `${(i / count) * 92 + rand(-2, 3)}%`);
        el.style.setProperty('--y', `${rand(15, 85)}%`);
        const depth = [0.55, 0.7, 0.85, 1][i % 4]; // far to near
        el.style.setProperty('--d', depth);
        el.style.setProperty('--dur', `${rand(15, 26) / (0.5 + depth / 2)}s`); // far ones drift slower
        el.style.setProperty('--delay', `${-rand(0, 24)}s`);
        el.innerHTML = `<i></i><span>${e}</span> <b>${s.word}</b>`;
        chips.appendChild(el);
      }
    }
    if (dots) {
      for (let i = 0; i < 30; i++) {
        const d = document.createElement('i');
        d.className = 'as-dot';
        d.style.setProperty('--s', `${rand(2, 4)}px`);
        d.style.setProperty('--x', `${rand(0, 100)}%`);
        d.style.setProperty('--y', `${rand(0, 100)}%`);
        d.style.setProperty('--dur', `${rand(5, 11)}s`);
        d.style.setProperty('--delay', `${-rand(0, 10)}s`);
        dots.appendChild(d);
      }
    }
    // the background leans gently towards the pointer (background only; the cards and their icons stay still)
    if (!reduce && window.matchMedia('(hover: hover)').matches) {
      const bg = $('.as-bg');
      window.addEventListener('pointermove', (e) => {
        bg.style.setProperty('--mx', ((e.clientX / window.innerWidth) - 0.5).toFixed(3));
        bg.style.setProperty('--my', ((e.clientY / window.innerHeight) - 0.5).toFixed(3));
      }, { passive: true });
    }
  }

  // ---------- the lists: each item lights up in turn; hovering one lights it up too ----------
  const CYCLE_MS = 2600;
  const cyclers = [];

  // Makes a set of elements light up one at a time. 'delay' offsets the start so lists never move in step.
  function cycle(els, startAt, delay) {
    const state = { idx: -1, timer: null, hover: false };
    const light = (i) => {
      state.idx = (i + els.length) % els.length;
      els.forEach((el, k) => el.classList.toggle('is-on', k === state.idx));
    };
    state.stop = () => { if (state.timer) { clearInterval(state.timer); state.timer = null; } };
    state.start = () => {
      state.stop();
      if (!reduce) state.timer = setInterval(() => { if (!state.hover) light(state.idx + 1); }, CYCLE_MS);
    };
    els.forEach((el, k) => {
      el.addEventListener('pointerenter', () => { state.hover = true; light(k); });
      el.addEventListener('pointerleave', () => { state.hover = false; });
    });
    light(startAt);
    cyclers.push(state);
    setTimeout(state.start, delay);
  }

  function panelHead(icon, tint, title, sub) {
    return `<header class="as-panel-head"><span class="as-head-ico" style="--c:${tint}">${svg(icon, 22)}</span>` +
      `<div><h2 class="as-panel-title">${title}</h2><p class="as-panel-sub">${sub}</p></div></header>`;
  }

  function buildSidePanels() {
    const ind = $('#as-industries');
    if (ind) {
      ind.innerHTML = panelHead(ICON.layers, '59, 130, 246', 'Industries We Serve', 'Powering conversations across every industry.') +
        `<ul class="as-grid">${INDUSTRIES.map((it, k) => `<li class="as-item as-tile" style="--c:${it.c}; --i:${k}">` +
          `<span class="as-tile-ico">${svg(it.icon, 24)}</span><span class="as-tile-name">${it.name}</span></li>`).join('')}</ul>`;
      cycle([...ind.querySelectorAll('.as-item')], 1, 0);
    }
    const svc = $('#as-services');
    if (svc) {
      svc.innerHTML = panelHead(ICON.phoneCall, '252, 36, 21', 'Our Services', 'AI-powered calling solutions for your business.') +
        `<ul class="as-rows">${SERVICE_LIST.map((it, k) => `<li class="as-item as-row" style="--c:${it.c}; --i:${k}">` +
          `<span class="as-row-ico">${svg(it.icon, 22)}</span>` +
          `<span class="as-row-text"><b class="as-row-name">${it.name}</b><small class="as-row-sub">${it.sub}</small></span>` +
          `<span class="as-row-go">${svg(ICON.chevron, 16)}</span></li>`).join('')}</ul>`;
      cycle([...svc.querySelectorAll('.as-item')], 2, CYCLE_MS / 2);
    }
    const feat = $('#as-features');
    if (feat) {
      feat.innerHTML = FEATURES.map((it, k) => `<div class="as-item as-feature" style="--c:${it.c}; --i:${k}">` +
        `<span class="as-feature-ico">${svg(it.icon, 24)}</span><span class="as-feature-name">${it.name}</span></div>`).join('');
      cycle([...feat.querySelectorAll('.as-item')], 0, CYCLE_MS / 4);
    }
    // pause while the browser tab is hidden: no work in the background
    document.addEventListener('visibilitychange', () => cyclers.forEach((c) => (document.hidden ? c.stop() : c.start())));
  }

  // ---------- the card: its parts slide in one after the other ----------
  function staggerCard() {
    if (reduce) return;
    const card = $('.auth-card');
    if (!card) return;
    // only the step that is showing (the sign-up code step stays hidden until it is needed)
    const parts = card.querySelectorAll('.auth-header, .auth-form:not([style*="none"]) > .form-group, .auth-form:not([style*="none"]) > .btn-auth-primary, .auth-divider, .btn-google, .auth-footer');
    let i = 0;
    parts.forEach((el) => { el.style.setProperty('--i', i++); el.classList.add('as-seq'); });
  }

  // ---------- sign up: password strength ----------
  function strengthMeter() {
    const input = $('#signup-password');
    if (!input) return;
    const meter = document.createElement('div');
    meter.className = 'as-strength';
    meter.setAttribute('aria-hidden', 'true');
    meter.innerHTML = '<i></i><i></i><i></i><i></i><span></span>';
    input.closest('.form-group').appendChild(meter);
    const label = meter.querySelector('span');
    const names = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    input.addEventListener('input', () => {
      const v = input.value;
      let level = 0;
      if (v.length >= 6) level++;
      if (v.length >= 10) level++;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v)) level++;
      if (/[^A-Za-z0-9]/.test(v) && v.length >= 8) level++;
      meter.dataset.level = String(level);
      meter.classList.toggle('on', v.length > 0);
      label.textContent = names[level];
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildBackground();
    buildSidePanels();
    staggerCard();
    strengthMeter();
  });
})();
