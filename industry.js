/* ==========================================================================
   TakeRemo — /industry/<key>. Renders one industry page from industry-data.js.
   Runs before service.js so the shared header can follow the sections' themes.
   The motion lives in industry-fx.js.
   ========================================================================== */
(() => {
  'use strict';

  const slug = location.pathname.split('/').filter(Boolean).pop();
  const D = (window.IND_DATA || {})[slug];
  if (!D) { location.replace('/industries'); return; }

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
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
  const ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

  window.IND_PAGE = { slug, D, ICONS };

  // head + page colour
  document.title = `${D.name} | AI Voice Agents for ${D.name} | TakeRemo`;
  const setMeta = (sel, v) => { const m = document.querySelector(sel); if (m) m.setAttribute('content', v); };
  setMeta('meta[name="description"]', `${D.lead} See how TakeRemo's AI voice agent works for ${D.name.toLowerCase()}.`);
  setMeta('meta[property="og:title"]', `TakeRemo for ${D.name}`);
  document.body.style.setProperty('--c', D.color);
  document.body.style.setProperty('--a', D.color);
  document.body.style.setProperty('--ad', D.color);

  const words = (txt, start, em) => txt.split(' ').map((w, i) =>
    `<${em ? 'em' : 'span'} class="ip-w" style="--i:${start + i}">${w}</${em ? 'em' : 'span'}>`).join(' ');

  const others = Object.keys(window.IND_DATA).filter((k) => k !== slug);
  const nWords = D.hero[0].split(' ').length;

  const html = `
    <!-- 1. HERO (dark) -->
    <section class="ip-hero" data-theme="dark">
      <div class="ip-hero-glow" aria-hidden="true"></div>
      <div class="sv-wrap ip-hero-grid">
        <div class="ip-hero-copy">
          <nav class="ip-crumb" aria-label="Breadcrumb"><a href="/industries">All industries</a><i>/</i><span>${D.name}</span></nav>
          <h1 class="ip-h1">${words(D.hero[0], 0, false)} ${words(D.hero[1], nWords, true)}</h1>
          <p class="ip-lead">${D.lead}</p>
          <div class="ip-actions">
            <button type="button" class="sv-btn sv-btn-primary" data-open-demo>Get a live demo ${ARROW}</button>
            <a class="sv-btn sv-btn-ghost" href="#hear">Hear a sample call</a>
          </div>
        </div>
        <div class="ip-scene" id="ip-scene">
          <canvas id="ip-canvas" aria-hidden="true"></canvas>
        </div>
      </div>
    </section>

    <!-- 2. BEFORE / WITH REMO (light) -->
    <section class="ip-why" id="why" data-theme="light">
      <div class="sv-wrap">
        <header class="ip-head">
          <h2>Same business. <em>Very different day.</em></h2>
          <p>Scroll and watch Remo rewrite the day.</p>
        </header>
        <div class="ip-rows">
          ${D.pains.map((p) => `
          <div class="ip-row">
            <div class="ip-pain"><span class="ip-tag">Before</span><span class="ip-sym">${CROSS}</span><p>${p[0]}</p></div>
            <div class="ip-sol"><span class="ip-tag">With Remo</span><span class="ip-sym">${CHECK}</span><p>${p[1]}</p></div>
            <i class="ip-edge"></i>
          </div>`).join('')}
        </div>
      </div>
    </section>

    <!-- 3. HOW A CALL GOES (dark) -->
    <section class="ip-flow" id="flow" data-theme="dark">
      <div class="sv-wrap">
        <header class="ip-head ip-head-dk">
          <h2>One call. <em>Four moves.</em></h2>
          <p>Follow the signal from the first ring to the finished job.</p>
        </header>
        <div class="ip-tl" id="ip-tl">
          <i class="ip-tl-line"><b class="ip-tl-fill"></b></i>
          <i class="ip-tl-dot"></i>
          ${D.steps.map((s, i) => `
          <article class="ip-step">
            <span class="ip-node"><b>${i + 1}</b></span>
            <div class="ip-step-card"><h3>${s[0]}</h3><p>${s[1]}</p></div>
          </article>`).join('')}
        </div>
      </div>
    </section>

    <!-- 4. HEAR IT (light) -->
    <section class="ip-hear" id="hear" data-theme="light">
      <div class="sv-wrap ip-hear-grid">
        <div class="ip-hear-copy">
          <h2>Hear how it <em>sounds.</em></h2>
          <p>A real-sounding conversation, in a tone that fits ${D.name.toLowerCase()}. Sample call, not a recording.</p>
          <ul class="ip-chips">
            ${D.chips.map((c) => `<li>${CHECK}${c}</li>`).join('')}
          </ul>
        </div>
        <div class="ip-phone" id="ip-phone">
          <div class="ip-phone-top"><span class="ip-phone-ic">${ICONS[slug]}</span><div><b>Remo</b><small>${D.title}</small></div><em><i></i>Live call</em></div>
          <div class="ip-chat" id="ip-chat" aria-live="polite"></div>
          <button type="button" class="ip-replay" id="ip-replay">Replay the call</button>
        </div>
      </div>
    </section>

    <!-- 5. WHAT CHANGES (dark) -->
    <section class="ip-out" data-theme="dark">
      <div class="sv-wrap">
        <header class="ip-head ip-head-dk">
          <h2>What <em>changes.</em></h2>
        </header>
        <div class="ip-out-grid">
          ${D.outcomes.map((o, i) => `
          <div class="ip-out-card"><span class="ip-out-n">0${i + 1}</span><h3>${o[0]}</h3><p>${o[1]}</p></div>`).join('')}
        </div>
      </div>
    </section>

    <!-- 6. CTA + OTHER INDUSTRIES (light) -->
    <section class="ip-cta" data-theme="light">
      <div class="sv-wrap">
        <div class="ip-cta-card">
          <span class="ip-cta-orb" aria-hidden="true"></span>
          <h2>${D.cta}</h2>
          <p>Tell us about your calls and we'll set up a live demo.</p>
          <div class="ip-cta-actions">
            <button type="button" class="sv-btn sv-btn-primary" data-open-demo>Talk to Remo ${ARROW}</button>
            <a class="ip-ghost-btn" href="/contact">Contact us</a>
          </div>
        </div>
        <div class="ip-others">
          <h3>Explore other industries</h3>
          <div class="ip-others-row">
            ${others.map((k) => `<a href="/industry/${k}" style="--c:${window.IND_DATA[k].color}"><span>${ICONS[k]}</span>${window.IND_DATA[k].name}</a>`).join('')}
          </div>
        </div>
      </div>
    </section>`;

  document.getElementById('ip-main').innerHTML = html;
})();
