/* ==========================================================================
   TakeRemo — Overview, Enterprise, Security & Compliance.
   One script, three pages (body[data-slug]). The shell (header, footer, demo form),
   scroll reveals and number counters come from service.js; everything here is page-specific:
   a one-of-a-kind canvas hero per page, plus the interactive sections.
   ========================================================================== */
(() => {
  'use strict';

  const slug = document.body.dataset.slug;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const RGB = (document.body.style.getPropertyValue('--a') || '96,140,255').trim();
  const TAU = Math.PI * 2;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rgba = (a, c = RGB) => `rgba(${c},${a})`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  /* ------------------------------------------------------- canvas stage */
  // Sizes a canvas to its host, pauses it off-screen, follows the pointer, and draws one still frame for reduced motion.
  function stage(host, draw, still = 6) {
    const cv = document.createElement('canvas');
    host.appendChild(cv);
    const g = cv.getContext('2d');
    const m = { x: 0, y: 0, tx: 0, ty: 0, in: false };
    let W = 0, H = 0, visible = true;
    const t0 = performance.now();

    const frame = (t) => {
      g.clearRect(0, 0, W, H);
      g.lineCap = 'round'; g.lineJoin = 'round';
      m.x += (m.tx - m.x) * 0.07; m.y += (m.ty - m.y) * 0.07;
      draw(g, W, H, t, m);
    };
    const resize = () => {
      const r = host.getBoundingClientRect();
      W = r.width; H = r.height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) frame(still);
    };
    const loop = (now) => { if (visible) frame((now - t0) / 1000); requestAnimationFrame(loop); };

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', (e) => {
      const r = host.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      m.in = inside;
      m.tx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      m.ty = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
    }, { passive: true });
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(host);
    resize();
    if (!reduce) requestAnimationFrame(loop);
  }

  /* small line icons, drawn on a canvas */
  function icon(g, kind, x, y, s, color = '#FFFFFF') {
    g.save(); g.translate(x, y); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = Math.max(1.6, s * 0.12);
    switch (kind) {
      case 'person': g.beginPath(); g.arc(0, -s * 0.28, s * 0.26, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, s * 0.62, s * 0.5, Math.PI * 1.12, Math.PI * 1.88); g.stroke(); break;
      case 'chart': g.beginPath(); g.moveTo(-s * 0.52, s * 0.34); g.lineTo(-s * 0.14, -s * 0.04); g.lineTo(s * 0.12, s * 0.2); g.lineTo(s * 0.5, -s * 0.34); g.stroke(); g.beginPath(); g.moveTo(s * 0.18, -s * 0.36); g.lineTo(s * 0.5, -s * 0.34); g.lineTo(s * 0.48, -s * 0.02); g.stroke(); break;
      case 'headset': g.beginPath(); g.arc(0, 0, s * 0.46, Math.PI, 0); g.stroke(); rr(g, -s * 0.58, -s * 0.04, s * 0.2, s * 0.4, s * 0.08); g.fill(); rr(g, s * 0.38, -s * 0.04, s * 0.2, s * 0.4, s * 0.08); g.fill(); g.beginPath(); g.moveTo(s * 0.48, s * 0.36); g.quadraticCurveTo(s * 0.4, s * 0.62, 0, s * 0.62); g.stroke(); break;
      case 'cal': rr(g, -s * 0.5, -s * 0.4, s, s * 0.9, s * 0.14); g.stroke(); g.beginPath(); g.moveTo(-s * 0.5, -s * 0.1); g.lineTo(s * 0.5, -s * 0.1); g.moveTo(-s * 0.22, -s * 0.56); g.lineTo(-s * 0.22, -s * 0.28); g.moveTo(s * 0.22, -s * 0.56); g.lineTo(s * 0.22, -s * 0.28); g.stroke(); g.beginPath(); g.arc(0, s * 0.24, s * 0.09, 0, TAU); g.fill(); break;
      case 'phone': g.rotate(-0.6); g.beginPath(); g.arc(0, 0, s * 0.42, Math.PI * 0.12, Math.PI * 0.88); g.lineWidth = s * 0.2; g.stroke(); g.beginPath(); g.arc(-s * 0.4, s * 0.12, s * 0.12, 0, TAU); g.arc(s * 0.4, s * 0.12, s * 0.12, 0, TAU); g.fill(); break;
      case 'lock': rr(g, -s * 0.42, -s * 0.06, s * 0.84, s * 0.62, s * 0.12); g.stroke(); g.beginPath(); g.arc(0, -s * 0.06, s * 0.26, Math.PI, 0); g.stroke(); break;
      default: break;
    }
    g.restore();
  }

  /* ====================================================== SCENE: overview */
  function overviewScene() {
    const SV = [
      { n: 'RECRUITMENT', c: '96,140,255', ev: 'Candidate shortlisted', ic: 'person' },
      { n: 'SALES', c: '252,36,21', ev: 'Meeting booked', ic: 'chart' },
      { n: 'SUPPORT', c: '16,185,129', ev: 'Issue resolved', ic: 'headset' },
      { n: 'APPOINTMENTS', c: '168,85,247', ev: 'Slot confirmed', ic: 'cal' },
      { n: 'RECEPTION', c: '34,211,238', ev: 'Message taken', ic: 'phone' }
    ];
    const r = rng(9);
    const stars = Array.from({ length: 80 }, () => ({ x: r(), y: r(), z: 0.4 + r() * 1.4, p: r() * TAU }));

    return (g, W, H, t, m) => {
      const cx = W * 0.5 + m.x * 16, cy = H * 0.5 + m.y * 11;
      const R = Math.min(W * 0.44, H * 0.4), tilt = 0.8 + m.y * 0.05;

      // far stars
      stars.forEach((s) => {
        g.fillStyle = `rgba(255,255,255,${0.12 + 0.28 * (0.5 + 0.5 * Math.sin(t * 1.2 + s.p))})`;
        g.beginPath(); g.arc(s.x * W - m.x * s.z * 6, s.y * H - m.y * s.z * 4, s.z * 0.9, 0, TAU); g.fill();
      });

      // orbit rings
      [[1.0, 0.16, 1], [0.64, 0.1, -1]].forEach(([k, a, d]) => {
        g.save(); g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 1.2; g.setLineDash([3, 9]); g.lineDashOffset = d * t * 8;
        g.beginPath(); g.ellipse(cx, cy, R * k, R * k * tilt, 0, 0, TAU); g.stroke(); g.restore();
      });

      const ev = Math.floor(t / 1.9) % 5, evP = (t % 1.9) / 1.9;
      const pos = SV.map((s, i) => {
        const a = t * 0.16 + (i * TAU) / 5 - Math.PI / 2;
        return { s, i, a, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R * tilt, depth: (Math.sin(a) + 1) / 2 };
      });

      // links and the calls travelling along them
      pos.forEach((p) => {
        const mx = (cx + p.x) / 2, my = (cy + p.y) / 2, dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1;
        const side = p.i % 2 ? 1 : -1, qx = mx + (-dy / len) * R * 0.2 * side, qy = my + (dx / len) * R * 0.2 * side;
        const lg = g.createLinearGradient(cx, cy, p.x, p.y);
        lg.addColorStop(0, rgba(0.08, p.s.c)); lg.addColorStop(1, rgba(0.38, p.s.c));
        g.strokeStyle = lg; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(qx, qy, p.x, p.y); g.stroke();
        const P = 3.4, ph = ((t + p.i * 0.68) % P) / P, outward = Math.floor((t + p.i * 0.68) / P) % 2 === 0;
        if (ph < 0.56) {
          for (let k = 0; k < 7; k++) {
            let u = clamp(ph / 0.56 - k * 0.028); if (u <= 0) continue;
            const e = ease(u), v = outward ? e : 1 - e, ix = (1 - v) * (1 - v) * cx + 2 * (1 - v) * v * qx + v * v * p.x, iy = (1 - v) * (1 - v) * cy + 2 * (1 - v) * v * qy + v * v * p.y;
            g.fillStyle = rgba((1 - k / 7) * 0.9, p.s.c); g.shadowColor = rgba(1, p.s.c); g.shadowBlur = k === 0 ? 14 : 0;
            g.beginPath(); g.arc(ix, iy, 3.4 - k * 0.3, 0, TAU); g.fill(); g.shadowBlur = 0;
          }
        }
      });

      // the core: ripples, glow, a voice ring and the orb
      const r0 = R * 0.2;
      for (let k = 0; k < 2; k++) {
        const ph = ((t * 0.42 + k * 0.5) % 1);
        g.strokeStyle = rgba((1 - ph) * 0.4); g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, lerp(r0, R * 0.92, ease(ph)), 0, TAU); g.stroke();
      }
      const halo = g.createRadialGradient(cx, cy, 0, cx, cy, r0 * 3.4);
      halo.addColorStop(0, rgba(0.55)); halo.addColorStop(0.5, rgba(0.12)); halo.addColorStop(1, rgba(0));
      g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, r0 * 3.4, 0, TAU); g.fill();
      const N = 64;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * TAU + t * 0.25, amp = Math.abs(Math.sin(t * 3.1 + k * 0.7) * Math.sin(t * 1.3 + k * 0.31));
        const l = r0 * (0.14 + 0.5 * amp);
        g.strokeStyle = rgba(0.45 + 0.5 * amp, '255,255,255'); g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * (r0 * 1.1), cy + Math.sin(a) * (r0 * 1.1)); g.lineTo(cx + Math.cos(a) * (r0 * 1.1 + l), cy + Math.sin(a) * (r0 * 1.1 + l)); g.stroke();
      }
      const orb = g.createRadialGradient(cx - r0 * 0.3, cy - r0 * 0.35, 0, cx, cy, r0);
      orb.addColorStop(0, '#FFFFFF'); orb.addColorStop(0.3, rgba(1, '255,150,110')); orb.addColorStop(1, rgba(1, '252,36,21'));
      g.fillStyle = orb; g.shadowColor = rgba(1); g.shadowBlur = 36; g.beginPath(); g.arc(cx, cy, r0 * (1 + 0.035 * Math.sin(t * 3)), 0, TAU); g.fill(); g.shadowBlur = 0;
      g.fillStyle = '#FFFFFF'; g.font = `800 ${Math.round(r0 * 0.5)}px "Outfit", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('REMO', cx, cy + 1);

      // the five jobs, back to front
      pos.sort((a, b) => a.depth - b.depth).forEach((p) => {
        const nr = (21 + p.depth * 9) * (W / 700 > 1.1 ? 1.1 : 1), flash = p.i === ev ? Math.sin(clamp(evP * 1.6) * Math.PI) : 0;
        const al = 0.55 + p.depth * 0.45;
        const glow = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, nr * (2.6 + flash));
        glow.addColorStop(0, rgba(0.38 + flash * 0.4, p.s.c)); glow.addColorStop(1, rgba(0, p.s.c));
        g.fillStyle = glow; g.beginPath(); g.arc(p.x, p.y, nr * (2.6 + flash), 0, TAU); g.fill();
        g.globalAlpha = al; g.fillStyle = '#0A1122'; g.strokeStyle = rgba(0.95, p.s.c); g.lineWidth = 2 + flash * 1.5;
        g.beginPath(); g.arc(p.x, p.y, nr, 0, TAU); g.fill(); g.stroke();
        icon(g, p.s.ic, p.x, p.y, nr * 0.85); g.globalAlpha = 1;
        g.fillStyle = `rgba(226,232,240,${0.45 + p.depth * 0.5})`; g.font = `600 ${Math.round(9 + p.depth * 2)}px "JetBrains Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
        g.fillText(p.s.n, p.x, p.y + nr + 17);
      });

      // one outcome at a time
      const p = pos.find((q) => q.i === ev);
      const a = Math.sin(clamp(evP) * Math.PI), rise = ease(evP) * 6;
      if (a > 0.02) {
        g.save(); g.globalAlpha = clamp(a * 1.6);
        g.font = '700 12px "Outfit", sans-serif'; const tw = g.measureText(p.s.ev).width, pw = tw + 40, ph = 28, px = clamp(p.x - pw / 2, 6, W - pw - 6), py = p.y - 62 - rise;
        g.fillStyle = 'rgba(8,14,32,0.92)'; g.strokeStyle = rgba(0.9, p.s.c); g.lineWidth = 1.4; rr(g, px, py, pw, ph, 14); g.fill(); g.stroke();
        g.fillStyle = `rgb(${p.s.c})`; g.beginPath(); g.arc(px + 15, py + ph / 2, 4.5, 0, TAU); g.fill();
        g.fillStyle = '#FFFFFF'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(p.s.ev, px + 27, py + ph / 2 + 1); g.restore();
      }
      g.textBaseline = 'alphabetic';
    };
  }

  /* =================================================== SCENE: enterprise */
  function enterpriseScene() {
    const TEAMS = [
      { n: 'HIRING', c: '96,140,255', ls: ['RECRUIT', 'SCREEN'], ic: ['person', 'person'], base: 128 },
      { n: 'SALES', c: '252,36,21', ls: ['LEADS', 'RENEWALS'], ic: ['chart', 'chart'], base: 341 },
      { n: 'SUPPORT', c: '16,185,129', ls: ['TECH', 'ORDERS'], ic: ['headset', 'headset'], base: 176 },
      { n: 'APPOINTMENTS', c: '168,85,247', ls: ['BOOKING', 'REMINDER'], ic: ['cal', 'cal'], base: 264 },
      { n: 'RECEPTION', c: '34,211,238', ls: ['ANSWER', 'MESSAGES'], ic: ['phone', 'phone'], base: 207 }
    ];
    const r = rng(5);
    const dust = Array.from({ length: 50 }, () => ({ x: r(), y: r(), z: 0.5 + r(), p: r() * TAU }));

    return (g, W, H, t, m) => {
      const ox = W * 0.5, oy = H * 0.13, ty = H * 0.43, ly = H * 0.79;
      const tx = (i) => W * (0.1 + i * 0.2);
      const lx = (i, j) => tx(i) + (j - 0.5) * W * 0.07;
      const active = m.in ? clamp(Math.round(((m.tx + 1) / 2) * 4 - 0.0001), 0, 4) : Math.floor(t / 3.2) % 5;

      dust.forEach((d) => { g.fillStyle = `rgba(255,255,255,${0.1 + 0.2 * (0.5 + 0.5 * Math.sin(t + d.p))})`; g.beginPath(); g.arc(d.x * W + m.x * d.z * 5, d.y * H + m.y * d.z * 4, d.z, 0, TAU); g.fill(); });

      // each team's walled-off area
      TEAMS.forEach((T, i) => {
        const on = i === active, a = on ? 1 : 0.35;
        const x = tx(i) - W * 0.093, y = ty - H * 0.085, w = W * 0.186, h = ly + H * 0.1 - y;
        g.save(); g.setLineDash([6, 8]); g.lineDashOffset = -t * 6; g.strokeStyle = rgba(0.2 + 0.4 * (on ? 1 : 0), T.c); g.lineWidth = 1.4;
        rr(g, x, y, w, h, 22); g.stroke(); g.restore();
        if (on) { const fg = g.createLinearGradient(0, y, 0, y + h); fg.addColorStop(0, rgba(0.1, T.c)); fg.addColorStop(1, rgba(0.02, T.c)); g.fillStyle = fg; rr(g, x, y, w, h, 22); g.fill(); }
        g.globalAlpha = a;
        // owner -> team
        const qx = (ox + tx(i)) / 2, qy = oy + (ty - oy) * 0.35;
        g.strokeStyle = rgba(0.35, T.c); g.lineWidth = 1.6; g.beginPath(); g.moveTo(ox, oy + 22); g.quadraticCurveTo(qx, qy, tx(i), ty - 24); g.stroke();
        for (let j = 0; j < 2; j++) { // team -> agents
          g.strokeStyle = rgba(0.3, T.c); g.lineWidth = 1.3; g.beginPath(); g.moveTo(tx(i), ty + 24); g.quadraticCurveTo(tx(i), (ty + ly) / 2, lx(i, j), ly - 18); g.stroke();
        }
        // setup pulse going down, call results coming back up
        const dp = ((t * 0.34 + i * 0.3) % 1), u = ease(dp);
        const bx = (1 - u) * (1 - u) * ox + 2 * (1 - u) * u * qx + u * u * tx(i), by = (1 - u) * (1 - u) * (oy + 22) + 2 * (1 - u) * u * qy + u * u * (ty - 24);
        g.fillStyle = '#FFFFFF'; g.shadowColor = rgba(1, T.c); g.shadowBlur = 14; g.beginPath(); g.arc(bx, by, 3.4, 0, TAU); g.fill(); g.shadowBlur = 0;
        for (let j = 0; j < 2; j++) {
          const up = ((t * 0.5 + i * 0.37 + j * 0.31) % 1), v = ease(up);
          const ux = lerp(lx(i, j), tx(i), v), uy = lerp(ly - 18, ty + 24, v);
          g.fillStyle = rgba(0.95 * (1 - Math.abs(up - 0.5) * 1.2), T.c); g.beginPath(); g.arc(ux, uy, 2.8, 0, TAU); g.fill();
        }
        // team box
        const bw = W * 0.166, bh = 48, bx0 = tx(i) - bw / 2, by0 = ty - bh / 2;
        g.fillStyle = '#0A1122'; g.strokeStyle = rgba(on ? 1 : 0.7, T.c); g.lineWidth = on ? 2.4 : 1.6; g.shadowColor = rgba(on ? 0.8 : 0.3, T.c); g.shadowBlur = on ? 22 : 8;
        rr(g, bx0, by0, bw, bh, 16); g.fill(); g.stroke(); g.shadowBlur = 0;
        g.fillStyle = '#FFFFFF'; g.font = '700 12px "Outfit", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(T.n, tx(i), by0 + 17);
        g.fillStyle = `rgb(${T.c})`; g.font = '700 11px "JetBrains Mono", monospace'; g.fillText(`${T.base + Math.floor(t * (1.4 + i * 0.5))} calls`, tx(i), by0 + 34);
        // agents
        for (let j = 0; j < 2; j++) {
          const x2 = lx(i, j), flash = 0.5 + 0.5 * Math.sin(t * 2 + i * 2 + j * 1.3);
          g.fillStyle = '#0A1122'; g.strokeStyle = rgba(0.9, T.c); g.lineWidth = 1.8; g.shadowColor = rgba(0.7 * flash, T.c); g.shadowBlur = 12 * flash;
          g.beginPath(); g.arc(x2, ly, 17, 0, TAU); g.fill(); g.stroke(); g.shadowBlur = 0;
          icon(g, T.ic[j], x2, ly, 13);
          g.fillStyle = 'rgba(203,213,225,0.9)'; g.font = '600 9px "JetBrains Mono", monospace'; g.textBaseline = 'alphabetic'; g.fillText(T.ls[j], x2, ly + 33);
        }
        g.globalAlpha = 1;
      });

      // the owner
      const rg = g.createRadialGradient(ox, oy, 0, ox, oy, 60);
      rg.addColorStop(0, rgba(0.5)); rg.addColorStop(1, rgba(0)); g.fillStyle = rg; g.beginPath(); g.arc(ox, oy, 60, 0, TAU); g.fill();
      const og = g.createLinearGradient(ox - 24, oy - 24, ox + 24, oy + 24); og.addColorStop(0, '#FFFFFF'); og.addColorStop(1, `rgb(${RGB})`);
      g.fillStyle = og; g.shadowColor = rgba(1); g.shadowBlur = 28; g.beginPath(); g.arc(ox, oy, 23 + Math.sin(t * 2.4) * 1.2, 0, TAU); g.fill(); g.shadowBlur = 0;
      icon(g, 'lock', ox, oy + 1, 20, '#0A1122');
      g.fillStyle = '#E2E8F0'; g.font = '700 10.5px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText('OWNER CONSOLE', ox, oy - 34);
    };
  }

  /* ===================================================== SCENE: security */
  function securityScene() {
    // "The sealed voice": a spoken waveform flows in from the left and is wound into a glowing sphere of
    // points that you can tilt with the pointer. Uninvited dots drift in from every side and are turned
    // away at an invisible shell, which lights up only where it is touched.
    const OK = '52,211,153', ICE = '167,243,208', RAW = '255,128,86';
    const NP = 460, GOLD = 2.39996;
    const pts = Array.from({ length: NP }, (_, i) => {
      const y = 1 - (i + 0.5) * (2 / NP), rad = Math.sqrt(1 - y * y), a = i * GOLD;
      return { x: Math.cos(a) * rad, y, z: Math.sin(a) * rad };
    });
    const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    const SLOTS = 5, PERIOD = 5.2;

    return (g, W, H, t, m) => {
      const cx = W * 0.56, cy = H * 0.5, U = Math.min(W * 0.8, H);
      const Rs = U * 0.25, Rh = U * 0.43;
      const yaw = t * 0.35 + m.x * 0.7, pit = -0.35 + m.y * 0.35;
      const cy1 = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);

      // soft glow behind the sphere
      const bg = g.createRadialGradient(cx, cy, 0, cx, cy, Rh * 1.5);
      bg.addColorStop(0, rgba(0.2, OK)); bg.addColorStop(0.5, rgba(0.05, OK)); bg.addColorStop(1, rgba(0, OK));
      g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, Rh * 1.5, 0, TAU); g.fill();

      // the voice: two thin waves that calm down and fade as they reach the sphere
      const x0 = W * 0.02, x1 = cx - Rs * 1.05, my = cy;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        for (let i = 0; i <= 90; i++) {
          const u = i / 90, x = lerp(x0, x1, u);
          const env = Math.sin(u * Math.PI * 0.5 + 0.0) * (1 - u * 0.15);
          const amp = (U * 0.13) * (1 - u * 0.8) * (0.35 + 0.65 * Math.abs(Math.sin(t * 1.3 + u * 3 + k)));
          const y = my + Math.sin(u * 14 - t * 4 + k * 1.1) * amp * (k === 0 ? 1 : 0.55) * env;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        const lg = g.createLinearGradient(x0, 0, x1, 0);
        lg.addColorStop(0, rgba(0, ICE)); lg.addColorStop(0.35, rgba(k === 0 ? 0.8 : 0.35, ICE)); lg.addColorStop(1, rgba(0.9, OK));
        g.strokeStyle = lg; g.lineWidth = k === 0 ? 2 : 1.2; g.stroke();
      }
      // a few grains of the voice being drawn into the sphere
      for (let i = 0; i < 14; i++) {
        const u = (t * 0.22 + i / 14) % 1, x = lerp(x0 + (x1 - x0) * 0.3, x1, ease(u));
        const y = my + Math.sin(i * 5.1 + t) * U * 0.05 * (1 - ease(u));
        g.fillStyle = rgba(Math.sin(u * Math.PI) * 0.9, ICE); g.beginPath(); g.arc(x, y, 1.8, 0, TAU); g.fill();
      }

      // the sphere: depth-shaded points, with a travelling band of light across its surface
      const proj = pts.map((p) => {
        const x1r = p.x * cy1 + p.z * sy, z1 = -p.x * sy + p.z * cy1;
        const y2 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
        return { x: cx + x1r * Rs, y: cy + y2 * Rs, z: z2, ky: p.y };
      }).sort((a, b) => a.z - b.z);
      const band = Math.sin(t * 0.9) * 0.9;
      proj.forEach((p) => {
        const depth = (p.z + 1) / 2, lit = Math.exp(-Math.pow((p.ky - band) * 3.2, 2));
        const a = 0.12 + depth * 0.6 + lit * 0.5;
        g.fillStyle = lit > 0.5 ? rgba(Math.min(1, a), '236,253,245') : rgba(Math.min(1, a), depth > 0.5 ? ICE : OK);
        g.beginPath(); g.arc(p.x, p.y, 0.7 + depth * 1.5 + lit * 0.8, 0, TAU); g.fill();
      });
      // a single orbiting ring, tilted with the sphere
      g.strokeStyle = rgba(0.35, ICE); g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * TAU, ox = Math.cos(a) * 1.3, oz = Math.sin(a) * 0.62, oy = Math.sin(a) * 1.15; // inclined orbit
        const xr = ox * cy1 + oz * sy, zr = -ox * sy + oz * cy1;
        const yy = oy * cp - zr * sp;
        const px = cx + xr * Rs, py = cy + yy * Rs;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();

      // the shell and the uninvited dots
      g.font = '600 10px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let shown = 0;
      for (let s = 0; s < SLOTS; s++) {
        const ph = t / PERIOD + s / SLOTS, cyc = Math.floor(ph), u = ph - cyc;
        const ang = hash(cyc * 7 + s * 13) * TAU, dist = lerp(Rh * 1.9, Rh, ease(Math.min(1, u / 0.5)));
        const ux = Math.cos(ang), uy = Math.sin(ang);
        if (u < 0.5) { // approaching
          const x = cx + ux * dist, y = cy + uy * dist;
          g.strokeStyle = rgba(0.3 * (u / 0.5), RAW); g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + ux * 16, y + uy * 16); g.stroke();
          g.fillStyle = rgba(0.95, RAW); g.shadowColor = rgba(0.9, RAW); g.shadowBlur = 8;
          g.beginPath(); g.arc(x, y, 2.6, 0, TAU); g.fill(); g.shadowBlur = 0;
        } else { // turned away: the shell lights up around the touch point and the dot breaks into sparks
          const v = (u - 0.5) / 0.5, hx = cx + ux * Rh, hy = cy + uy * Rh;
          g.lineWidth = 2;
          for (let r = 0; r < 3; r++) {
            const spread = (0.25 + v * 1.1) * (1 + r * 0.45), al = (1 - v) * (0.7 - r * 0.2);
            if (al > 0) { g.strokeStyle = rgba(al, ICE); g.beginPath(); g.arc(cx, cy, Rh + r * 1.5, ang - spread * 0.5, ang + spread * 0.5); g.stroke(); }
          }
          for (let k = 0; k < 7; k++) {
            const sa = ang + (k - 3) * 0.32, sd = v * (14 + hash(s * 9 + k + cyc) * 26);
            g.fillStyle = rgba((1 - v) * 0.9, RAW); g.beginPath(); g.arc(hx + Math.cos(sa) * sd, hy + Math.sin(sa) * sd, 1.8 * (1 - v) + 0.4, 0, TAU); g.fill();
          }
          if (v < 0.85 && shown < 1) {
            shown++; g.fillStyle = rgba(1 - v, ICE);
            g.fillText('TURNED AWAY', clamp(hx + ux * 54, 50, W - 50), clamp(hy + uy * 22, 12, H - 12));
          }
        }
      }
      // two quiet captions
      g.fillStyle = rgba(0.75, ICE); g.textAlign = 'left';
      g.fillText('VOICE IN', W * 0.04, cy - U * 0.12);
      g.textAlign = 'center'; g.fillStyle = rgba(0.6, ICE);
      g.fillText('SEALED', cx, cy + Rs + 26);
      g.textBaseline = 'alphabetic';
    };
  }

  /* =========================================================== OVERVIEW */
  const JOBS = [
    {
      key: 'recruitment', name: 'Recruitment', c: '96,140,255', href: '/service/recruitment',
      title: 'Meets every candidate the moment they apply.',
      body: 'Remo reads your job description, calls each applicant and asks the questions a recruiter would, then hands you a ranked shortlist.',
      pts: ['Reads the job description you upload', 'Asks about skills, experience and notice period', 'Scores each candidate and explains why'],
      chat: [['r', "Hi Priya, I'm calling about your Backend Engineer application. Do you have two minutes?"], ['u', 'Sure, go ahead.'], ['r', 'How many years have you worked with Node.js?'], ['u', 'About six years.']],
      out: ['Shortlisted', '94% match']
    },
    {
      key: 'sales', name: 'Sales', c: '252,36,21', href: '/service/sales',
      title: 'Calls every lead while they are still warm.',
      body: 'Remo opens a conversation, listens, handles the usual objections and books the next step, so your team only talks to people who are ready.',
      pts: ['Opens with your pitch, in a human way', 'Handles "send me details" and "we already have a vendor"', 'Books the meeting or captures the email'],
      chat: [['r', 'Hello Rahul, this is Remo from Acme. Is now a good time?'], ['u', 'Quickly, yes.'], ['r', 'Are you planning any new software projects this year?'], ['u', 'Maybe a mobile app.']],
      out: ['Meeting requested', 'Hot lead']
    },
    {
      key: 'support', name: 'Support', c: '16,185,129', href: '/service/customer-support',
      title: 'Answers with patience, escalates with context.',
      body: 'Remo learns from your support documents, walks people through the fix step by step, and passes the full story to a person when it should.',
      pts: ['Learns from your own support guide', 'Walks through fixes one step at a time', 'Escalates with the whole conversation attached'],
      chat: [['u', 'My app keeps logging me out.'], ['r', "I'm sorry about that. Which phone are you using?"], ['u', 'An Android.'], ['r', "Let's clear the app cache first. Open Settings, then Apps."]],
      out: ['Resolved', 'First call']
    },
    {
      key: 'appointment', name: 'Appointments', c: '168,85,247', href: '/service/appointment-setting',
      title: 'Fills the calendar and guards it from no-shows.',
      body: 'Remo books, reschedules and cancels by phone, in both directions, and reads the slot back before it confirms anything.',
      pts: ['Books, reschedules and cancels', 'Reads the slot back before confirming', 'Takes calls and makes calls'],
      chat: [['r', "Hello Asha, I'm calling to book your check-up. Which day suits you?"], ['u', 'Friday evening.'], ['r', "Friday at 5 PM. Shall I note that down?"], ['u', 'Yes please.']],
      out: ['Appointment booked', 'Fri · 5 PM']
    },
    {
      key: 'receptionist', name: 'Reception', c: '34,211,238', href: '/service/receptionist',
      title: 'Every call answered, day or night.',
      body: 'Remo greets callers as your front desk, answers from your own information, and takes a clear message when it should.',
      pts: ['Greets callers as your front desk', "Answers only from your information", 'Takes a message when it does not know'],
      chat: [['r', 'Thank you for calling Smile Dental. How may I help you today?'], ['u', 'Are you open on Sunday?'], ['r', "We're closed on Sundays, and open Monday to Saturday, nine to six."], ['u', 'Great, thanks.']],
      out: ['Query answered', 'No wait']
    }
  ];

  function initJobs() {
    const tabs = $('#pf-tabs'), panel = $('#pf-job');
    if (!tabs || !panel) return;
    let token = 0, current = -1, started = false;

    tabs.innerHTML = JOBS.map((j, i) => `<button type="button" class="pf-tab" role="tab" id="pf-tab-${i}" aria-selected="false" aria-controls="pf-job" style="--c:${j.c}"><i></i>${j.name}</button>`).join('');
    const btns = $$('.pf-tab', tabs);

    async function play(i) {
      const my = ++token, j = JOBS[i], chat = $('#pf-chat'), out = $('#pf-out-chip');
      if (!chat) return;
      chat.innerHTML = ''; out.classList.remove('on');
      for (const [who, text] of j.chat) {
        if (my !== token) return;
        let dots = null;
        if (!reduce) {
          dots = document.createElement('div'); dots.className = 'pf-typing'; dots.innerHTML = '<i></i><i></i><i></i>';
          if (who === 'u') dots.style.alignSelf = 'flex-end';
          chat.appendChild(dots); await sleep(who === 'r' ? 850 : 550); if (my !== token) return; dots.remove();
        }
        const d = document.createElement('div'); d.className = `pf-msg ${who}`; d.innerHTML = `<small>${who === 'r' ? 'Remo' : 'Caller'}</small>${esc(text)}`;
        chat.appendChild(d);
        if (!reduce) await sleep(Math.min(1700, 500 + text.length * 16));
      }
      if (my === token) out.classList.add('on');
    }

    function select(i, focus) {
      if (i === current) return;
      current = i; const j = JOBS[i];
      btns.forEach((b, k) => { b.classList.toggle('on', k === i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); b.tabIndex = k === i ? 0 : -1; });
      if (focus) btns[i].focus();
      panel.setAttribute('aria-labelledby', `pf-tab-${i}`);
      panel.style.setProperty('--c', j.c);
      panel.innerHTML = `
        <div class="pf-job-copy">
          <span class="pf-pill" style="--c:${j.c}">${j.name}</span>
          <h3>${j.title}</h3>
          <p>${j.body}</p>
          <ul>${j.pts.map((p) => `<li style="--c:${j.c}">${p}</li>`).join('')}</ul>
          <a class="pf-job-link" href="${j.href}" style="--c:${j.c}">Explore ${j.name} ${ARROW}</a>
        </div>
        <div class="pf-phone" style="--c:${j.c}">
          <div class="pf-phone-top"><span>Sample call</span><span class="pf-live"><i></i>Live</span></div>
          <div class="pf-chat" id="pf-chat"></div>
          <div class="pf-outcome" id="pf-out-chip"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>${esc(j.out[0])}<span>${esc(j.out[1])}</span></div>
        </div>`;
      if (started) play(i);
    }

    btns.forEach((b, i) => {
      b.addEventListener('click', () => select(i));
      b.addEventListener('keydown', (e) => {
        const k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (k) { e.preventDefault(); select((current + k + JOBS.length) % JOBS.length, true); }
      });
    });
    select(0);
    const begin = () => { if (started) return; started = true; play(current); };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { begin(); io.disconnect(); } }, { threshold: 0.3 });
      io.observe(panel);
    } else begin();
  }

  function initWays() {
    const out = $('#pf-out'), inn = $('#pf-in');
    if (!out || !inn) return;
    const people = [['Asha Rao', '+91 98•••• 0142', 'AR'], ['Ravi Kumar', '+91 99•••• 7731', 'RK'], ['Meena Iyer', '+91 90•••• 2208', 'MI'], ['Tom Bradley', '+1 312 ••• 0144', 'TB'], ['Sara Khan', '+91 97•••• 5509', 'SK']];
    out.innerHTML = people.map(([n, p, a]) => `<div class="pf-row"><span class="av">${a}</span><span class="tx">${n}<small>${p}</small></span><span class="st">Queued</span></div>`).join('');
    const rows = $$('.pf-row', out);
    const label = { '': 'Queued', dialing: 'Dialling', done: 'Completed' };
    const set = (el, cls) => { el.classList.remove('dialing', 'done'); if (cls) el.classList.add(cls); $('.st', el).textContent = label[cls || '']; };
    let step = 0;
    const tick = () => {
      const i = Math.floor(step / 2) % (rows.length + 1);
      if (i === 0 && step % 2 === 0) rows.forEach((r) => set(r, ''));
      if (i < rows.length) set(rows[i], step % 2 === 0 ? 'dialing' : 'done');
      step++;
    };
    if (reduce) { rows.forEach((r, k) => set(r, k < 3 ? 'done' : '')); } else setInterval(tick, 900);

    const calls = [['+91 98•••• 0231', 'Front Desk', 'Answered'], ['+91 90•••• 4416', 'Bookings', 'Booked Fri 5 PM'], ['+44 7••• 218 901', 'Front Desk', 'Message taken'], ['+91 99•••• 6620', 'Bookings', 'Answered'], ['+91 97•••• 1183', 'Front Desk', 'Query answered']];
    let n = 0;
    const add = () => {
      const [num, agent, res] = calls[n++ % calls.length];
      const row = document.createElement('div'); row.className = 'pf-row done';
      row.innerHTML = `<span class="av" style="background:rgba(96,140,255,.45)">IN</span><span class="tx">${num}<small>→ ${agent}</small></span><span class="st">${res}</span>`;
      inn.prepend(row);
      while (inn.children.length > 4) inn.lastChild.remove();
    };
    add(); add();
    if (!reduce) setInterval(add, 2300);
  }

  /* ========================================================== ENTERPRISE */
  function initTeams() {
    const list = $('#pf-team-list'), panel = $('#pf-panel');
    if (!list || !panel) return;
    const TEAMS = [
      { n: 'Hiring team', who: 'Talent lead', c: '96,140,255', i: 'H', agents: [['Campus hiring', 'Recruitment', '···1101', 64], ['Tech hiring', 'Recruitment', '···1102', 41], ['Interview reminders', 'Appointments', '···1103', 23]] },
      { n: 'Sales team', who: 'Sales head', c: '252,36,21', i: 'S', agents: [['Outbound leads', 'Sales', '···2201', 118], ['Renewals', 'Sales', '···2202', 76], ['Demo bookings', 'Appointments', '···2203', 39]] },
      { n: 'Customer support', who: 'Support head', c: '16,185,129', i: 'C', agents: [['Tech support', 'Support', '···5501', 87], ['Order queries', 'Support', '···5502', 63], ['Escalation callbacks', 'Support', '···5503', 24]] },
      { n: 'Appointment setting', who: 'Clinic manager', c: '168,85,247', i: 'A', agents: [['New bookings', 'Appointment setting', '···4401', 96], ['Reschedules', 'Appointment setting', '···4402', 48], ['Reminder calls', 'Appointment setting', '···4403', 131]] },
      { n: 'Receptionist', who: 'Front-office lead', c: '34,211,238', i: 'R', agents: [['Main line', 'Receptionist', '···3301', 142], ['After hours', 'Receptionist', '···3302', 57], ['Branch line', 'Receptionist', '···3303', 28]] }
    ];
    list.innerHTML = TEAMS.map((t, i) => `<button type="button" class="pf-team" role="tab" style="--c:${t.c}" aria-selected="false"><span class="dot">${t.i}</span><span><b>${t.n}</b><small>Admin · ${t.who}</small></span></button>`).join('');
    const btns = $$('.pf-team', list);
    const PH = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
    let cur = -1, auto = true, timer = null;

    function select(i) {
      if (i === cur) return; cur = i; const T = TEAMS[i];
      btns.forEach((b, k) => { b.classList.toggle('on', k === i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
      panel.style.setProperty('--c', T.c);
      panel.innerHTML = `
        <div class="pf-panel-top"><h3>${T.n}</h3><span class="pf-pill" style="--c:${T.c}">${T.agents.length} agents · ${T.agents.length} numbers</span></div>
        <div class="pf-agents">${T.agents.map(([name, type, num, calls], k) => `
          <div class="pf-agent" style="--c:${T.c};animation-delay:${k * 0.09}s">
            <span class="ic">${PH}</span>
            <span><b>${name}</b><small>${type} · +91 80 ${num}</small></span>
            <span class="ct" data-to="${calls}">0<small>calls today</small></span>
          </div>`).join('')}</div>
        <div class="pf-fence" style="--c:${T.c}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><span>This team's admin sees only these agents and their own calls, contacts and transcripts. Other teams' admins do not.</span></div>
        <p class="pf-note">Illustrative example with sample names and numbers.</p>`;
      $$('.ct', panel).forEach((el) => {
        const to = +el.dataset.to, small = el.querySelector('small').outerHTML;
        if (reduce) { el.innerHTML = to + small; return; }
        const t0 = performance.now();
        const step = (now) => { const p = clamp((now - t0) / 1100); el.innerHTML = Math.round(to * ease(p)) + small; if (p < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      });
    }
    btns.forEach((b, i) => b.addEventListener('click', () => { auto = false; clearInterval(timer); select(i); }));
    select(0);
    timer = setInterval(() => { if (auto && !reduce) select((cur + 1) % TEAMS.length); }, 5200);
  }

  function initConsole() {
    const root = $('#pf-console');
    if (!root) return;
    const TOTAL = 240, el = (id) => document.getElementById(id);
    const fill = el('pf-fill'), pct = el('pf-pct'), eta = el('pf-eta'), stateEl = el('pf-state');
    let dialed = reduce ? 150 : 0, mode = 'running';
    const btns = $$('.pf-btn2', root);

    function paint() {
      const p = Math.round((dialed / TOTAL) * 100), inprog = mode === 'running' && dialed < TOTAL ? 3 : 0;
      const done = Math.round(dialed * 0.78), failed = Math.max(0, dialed - done - inprog);
      const queued = mode === 'cancelled' ? 0 : Math.max(0, TOTAL - dialed - inprog);
      fill.style.width = p + '%';
      pct.textContent = `${p}% dialled`;
      el('k-q').textContent = queued; el('k-p').textContent = inprog; el('k-c').textContent = done; el('k-f').textContent = failed;
      const label = dialed >= TOTAL ? 'done' : mode;
      root.classList.toggle('paused', mode === 'paused'); root.classList.toggle('cancelled', mode === 'cancelled');
      stateEl.className = 'pf-state' + (mode === 'paused' ? ' paused' : mode === 'cancelled' ? ' cancelled' : '');
      stateEl.textContent = label === 'done' ? 'COMPLETED' : label.toUpperCase();
      eta.textContent = dialed >= TOTAL ? 'Every contact has been called' : mode === 'paused' ? 'Paused. Calls in progress finish first.' : mode === 'cancelled' ? 'Cancelled. Nothing else will be dialled.' : 'Remo is working through the list';
      btns.forEach((b) => b.classList.toggle('act', (b.dataset.act === 'resume' && mode === 'running') || (b.dataset.act === 'pause' && mode === 'paused') || (b.dataset.act === 'cancel' && mode === 'cancelled')));
    }
    btns.forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'pause' && mode === 'running') mode = 'paused';
      else if (a === 'resume') { if (mode === 'cancelled' || dialed >= TOTAL) dialed = 0; mode = 'running'; }
      else if (a === 'cancel') mode = 'cancelled';
      paint();
    }));
    let visible = true;
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.1 }).observe(root);
    setInterval(() => {
      if (!visible || reduce) return;
      if (mode === 'running') { dialed = Math.min(TOTAL, dialed + 1 + Math.floor(Math.random() * 3)); if (dialed >= TOTAL) { setTimeout(() => { if (mode === 'running' && dialed >= TOTAL) { dialed = 0; paint(); } }, 3200); } paint(); }
    }, 420);
    paint();
  }

  function initLine() {
    const line = $('#pf-line');
    if (!line) return;
    const steps = $$('.pf-st', line);
    const update = () => {
      const vh = window.innerHeight, r = line.getBoundingClientRect();
      const y = vh * 0.62 - r.top;
      line.style.setProperty('--fill', clamp(y, 0, r.height - 20) + 'px');
      steps.forEach((s) => s.classList.toggle('on', y >= s.offsetTop + 30));
    };
    let tick = false;
    const on = () => { if (!tick) { tick = true; requestAnimationFrame(() => { tick = false; update(); }); } };
    window.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on);
    update();
  }

  function initMarquee() {
    const host = $('#pf-marq');
    if (!host) return;
    const items = [['healthcare', 'Healthcare'], ['recruitment', 'Recruitment'], ['sales', 'Sales'], ['education', 'Education'], ['realestate', 'Real Estate'], ['support', 'Customer Support'], ['finance', 'Finance'], ['automotive', 'Automotive']];
    const html = items.map(([k, n]) => `<a href="/industry/${k}">${n}</a>`).join('');
    host.innerHTML = html + html;
  }

  /* ============================================================ SECURITY */
  const IC = {
    collect: '<path d="M4 4h16v12H5.2L4 17.2V4z"/><path d="M8 9h8M8 12h5"/>',
    transit: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    store: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    access: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    keep: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3"/>',
    cookie: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    owner: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M12 11v4M10 13h4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'
  };
  const svg = (k, s = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;

  function initJourney() {
    const rail = $('#pf-rail'), detail = $('#pf-detail'), fill = $('#pf-rail-fill'), dot = $('#pf-rail-dot');
    if (!rail || !detail) return;
    const ST = [
      { k: 'collect', n: 'Collected', h: 'What a call needs, and what you choose to upload.', p: 'Names, phone numbers, call outcomes and transcripts, plus the documents and contact sheets you upload. We also see basic technical information such as browser type and pages visited. Our Privacy Policy lists all of it.', t: 'You decide what goes in' },
      { k: 'transit', n: 'In transit', h: 'Moves over HTTPS.', p: 'TakeRemo is served over HTTPS, and in production our sign-in cookie is marked secure so browsers only send it over an encrypted connection.', t: 'Encrypted connection' },
      { k: 'store', n: 'Stored', h: 'Kept per account, passwords hashed.', p: 'Passwords are hashed with bcrypt and never stored as plain text, so we cannot read them. Each account\'s contacts, calls and transcripts are kept separate from every other account.', t: 'Hashed · Separated' },
      { k: 'access', n: 'Accessed', h: 'Access is limited by role.', p: 'An admin sees only their own contacts, calls and transcripts. A separate owner console, which TakeRemo uses to run the service, has its own credentials, short sessions, and a lock-out after repeated wrong passwords.', t: 'Role-based access' },
      { k: 'keep', n: 'Kept or removed', h: 'Yours to see, fix or delete.', p: 'You can ask to see what we hold, correct it, or have it deleted, unless the law says we must keep it. We never sell your information.', t: 'Never sold' }
    ];
    rail.insertAdjacentHTML('beforeend', ST.map((s, i) => `<button type="button" class="pf-stp" role="tab" aria-selected="false" data-i="${i}"><span class="ic">${svg(s.k, 26)}</span><b>${s.n}</b></button>`).join(''));
    const btns = $$('.pf-stp', rail);
    let cur = -1, auto = true, visible = false;

    function select(i) {
      cur = i; const s = ST[i];
      btns.forEach((b, k) => { b.classList.toggle('on', k === i); b.classList.toggle('past', k < i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
      fill.style.width = (i * 20) + '%'; dot.style.left = (10 + i * 20) + '%';
      detail.innerHTML = `<h3>${s.h}</h3><p>${s.p}</p><span class="tag">${s.t}</span>`;
    }
    btns.forEach((b) => b.addEventListener('click', () => { auto = false; select(+b.dataset.i); }));
    select(0);
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.3 }).observe(rail);
    setInterval(() => { if (auto && visible && !reduce) select((cur + 1) % ST.length); }, 4200);
  }

  function initControls() {
    const host = $('#pf-ctrls');
    if (!host) return;
    const C = [
      { k: 'key', h: 'Hashed passwords', p: 'Passwords are scrambled with bcrypt before they are saved. They are never stored in a readable form.', f: '<b>bcrypt</b> · cost factor 12' },
      { k: 'cookie', h: 'Protected sessions', p: 'You stay signed in with an HTTP-only cookie that page scripts cannot read, and it is marked secure in production.', f: 'Sessions last <b>7 days</b>' },
      { k: 'users', h: 'Accounts kept separate', p: 'Every admin sees only their own contacts, calls and transcripts. Teams never see each other\'s data.', f: '<b>Per-account</b> separation' },
      { k: 'owner', h: 'A separate owner console', p: 'The owner panel has its own credentials, short sessions, and locks after repeated failed sign-ins.', f: '<b>8-hour</b> sessions · <b>5</b> tries, then a 15-min lock' },
      { k: 'upload', h: 'Safe uploads', p: 'Only spreadsheet and document file types are accepted, and every upload has a size limit.', f: 'Max <b>25 MB</b> per file' },
      { k: 'folder', h: 'Private files stay private', p: 'Our code, settings and data folders are never served to browsers.', f: 'Blocked at the <b>web server</b>' },
      { k: 'globe', h: 'Approved sites only', p: 'Other websites cannot call our API from a visitor\'s browser. Only TakeRemo\'s own pages can.', f: '<b>Origin allow-list</b>' },
      { k: 'ban', h: 'Do-not-contact respected', p: 'When someone says "don\'t call me again", Remo ends the call politely and records the request.', f: 'Recorded as <b>Do Not Call</b>' }
    ];
    host.innerHTML = C.map((c, i) => `
      <article class="pf-ctrl sv-reveal" style="--d:${(i % 4) * 0.07}s">
        <div class="top"><span class="ic">${svg(c.k, 24)}</span><span class="pf-led"><i></i>ACTIVE</span></div>
        <h3>${c.h}</h3><p>${c.p}</p><div class="fact">${c.f}</div>
      </article>`).join('');
    $$('.pf-ctrl', host).forEach((card) => card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px'); card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }));
    revealIn($$('.pf-ctrl', host));
  }

  // Elements added after service.js has set up its scroll reveals need their own observer.
  function revealIn(els) {
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('is-in')); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }), { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
    els.forEach((e) => io.observe(e));
  }

  /* ----------------------------------------------------------------- go */
  const SCENES = { overview: overviewScene, enterprise: enterpriseScene, security: securityScene };
  const host = $('#pf-stage');
  if (host && SCENES[slug]) stage(host, SCENES[slug](), slug === 'overview' ? 7.4 : slug === 'enterprise' ? 3.6 : 9.2);

  if (slug === 'overview') { initJobs(); initWays(); }
  if (slug === 'enterprise') { initTeams(); initConsole(); initLine(); initMarquee(); }
  if (slug === 'security') { initJourney(); initControls(); }
})();
