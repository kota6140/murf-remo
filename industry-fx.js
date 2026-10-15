/* ==========================================================================
   TakeRemo — /industry/<key> motion.
   1) A one-of-a-kind canvas scene per industry in the hero.
   2) The live call card typing in the hero.
   3) Before/After rows wiped in colour as you scroll.
   4) The call timeline with a travelling signal.
   5) The sample call playing in a chat.
   ========================================================================== */
(() => {
  'use strict';
  const P = window.IND_PAGE;
  if (!P) return;
  const { slug, D } = P;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TAU = Math.PI * 2;
  const C = D.color.split(',').map(Number);
  const rgba = (a, k = 1) => `rgba(${Math.min(255, C[0] * k) | 0},${Math.min(255, C[1] * k) | 0},${Math.min(255, C[2] * k) | 0},${a})`;

  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const G = (u, m, w) => Math.exp(-(((u - m) / w) ** 2));
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };

  /* ----------------------------------------------------------- 1. scenes */
  const scenes = {};

  // healthcare: a heartbeat, with a pulse that ripples out of the cross on every beat
  scenes.healthcare = (g, W, H, t, st) => {
    const cx = W / 2, cy = H * 0.3, bpm = 1.05, L = W * 0.46, x0 = W * 0.5;
    st.rip = st.rip || [];
    const bi = Math.floor(t * bpm + x0 / L - 0.32 + 1000);
    if (bi !== st.bi) { st.bi = bi; st.rip.push(t); }
    st.rip = st.rip.filter((s) => t - s < 2.4);
    st.rip.forEach((s) => {
      const k = (t - s) / 2.4;
      g.strokeStyle = rgba((1 - k) * 0.55, 1.2); g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, lerp(34, W * 0.4, ease(k)), 0, TAU); g.stroke();
    });
    const last = st.rip[st.rip.length - 1];
    const pulse = last !== undefined ? 1 + 0.14 * Math.exp(-(t - last) * 5) : 1;
    const S = W * 0.07 * pulse;
    const halo = g.createRadialGradient(cx, cy, 0, cx, cy, S * 3.2);
    halo.addColorStop(0, rgba(0.5, 1.2)); halo.addColorStop(1, rgba(0));
    g.fillStyle = halo; g.fillRect(cx - S * 4, cy - S * 4, S * 8, S * 8);
    g.fillStyle = rgba(1, 1.1);
    rr(g, cx - S * 0.34, cy - S, S * 0.68, S * 2, S * 0.2); g.fill();
    rr(g, cx - S, cy - S * 0.34, S * 2, S * 0.68, S * 0.2); g.fill();
    // ECG
    const base = H * 0.56;
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(0, base + (i - 3) * H * 0.07); g.lineTo(W, base + (i - 3) * H * 0.07); g.stroke(); }
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, rgba(0)); grad.addColorStop(0.55, rgba(0.9, 1.2)); grad.addColorStop(1, rgba(1, 1.4));
    g.strokeStyle = grad; g.lineWidth = 3; g.lineJoin = 'round'; g.beginPath();
    for (let x = 0; x <= W; x += 3) {
      const u = (((x / L + t * bpm) % 1) + 1) % 1;
      const f = 0.12 * G(u, 0.16, 0.04) - 0.14 * G(u, 0.29, 0.012) + G(u, 0.32, 0.012) - 0.28 * G(u, 0.355, 0.014) + 0.22 * G(u, 0.58, 0.05);
      const y = base - f * H * 0.17;
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  };

  // recruitment: six candidates are scored, re-rank themselves, and the top two get shortlisted
  scenes.recruitment = (g, W, H, t, st) => {
    const T = 6.4, cyc = Math.floor(t / T), s = t % T;
    if (st.cyc !== cyc) {
      const r = rng(cyc * 7 + 3);
      st.cyc = cyc;
      st.sc = Array.from({ length: 6 }, () => 42 + Math.floor(r() * 56));
      const order = st.sc.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]);
      st.rank = []; order.forEach((o, k) => { st.rank[o[1]] = k; });
    }
    const names = ['P', 'V', 'A', 'R', 'S', 'M'];
    const x0 = W * 0.07, rw = W * 0.86, top = H * 0.04, rh = H * 0.088, gap = H * 0.017;
    const sorted = ease(clamp((s - 1.7) / 1.3)), pick = ease(clamp((s - 3.3) / 0.5));
    const fade = 1 - clamp((s - 5.8) / 0.5), fin = clamp(s / 0.3);
    for (let i = 0; i < 6; i++) {
      const slot = lerp(i, st.rank[i], sorted);
      const y = top + slot * (rh + gap), win = st.rank[i] < 2;
      const hot = win ? pick : 0;
      const al = fade * fin * (win ? 1 : 1 - pick * 0.5);
      g.save(); g.globalAlpha = al;
      g.fillStyle = hot > 0 ? rgba(0.1 + 0.14 * hot, 1.1) : 'rgba(255,255,255,0.06)';
      rr(g, x0, y, rw, rh, 14); g.fill();
      g.strokeStyle = hot > 0 ? rgba(0.4 + 0.6 * hot, 1.2) : 'rgba(255,255,255,0.14)'; g.lineWidth = 1.4;
      if (hot > 0) { g.shadowColor = rgba(1); g.shadowBlur = 18 * hot; }
      rr(g, x0, y, rw, rh, 14); g.stroke(); g.shadowBlur = 0;
      // avatar
      g.fillStyle = rgba(0.25 + (i % 3) * 0.1, 1.15); g.beginPath(); g.arc(x0 + rh * 0.56, y + rh / 2, rh * 0.3, 0, TAU); g.fill();
      g.fillStyle = '#fff'; g.font = `700 ${rh * 0.34}px "Outfit", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(names[i], x0 + rh * 0.56, y + rh / 2 + 1);
      // name line + score bar
      g.fillStyle = 'rgba(255,255,255,0.3)'; rr(g, x0 + rh * 1.1, y + rh * 0.22, rw * 0.2, rh * 0.14, 4); g.fill();
      const bx = x0 + rh * 1.1, bw = rw - rh * 1.1 - rh * 2.3, by = y + rh * 0.55;
      g.fillStyle = 'rgba(255,255,255,0.1)'; rr(g, bx, by, bw, rh * 0.2, 5); g.fill();
      const grow = ease(clamp((s - 0.2 - i * 0.12) / 1.0)), v = st.sc[i] * grow;
      g.fillStyle = rgba(1, win && hot > 0 ? 1.35 : 1.1); rr(g, bx, by, Math.max(0, bw * (v / 100)), rh * 0.2, 5); g.fill();
      // score
      g.fillStyle = '#fff'; g.font = `700 ${rh * 0.36}px "JetBrains Mono", monospace`; g.textAlign = 'right';
      g.fillText(String(Math.round(v)), x0 + rw - rh * 1.15, y + rh / 2 + 1);
      // shortlist tick
      if (hot > 0) {
        const cx = x0 + rw - rh * 0.55, cy = y + rh / 2, k = 0.5 + hot * 0.5;
        g.fillStyle = rgba(1, 1.15); g.beginPath(); g.arc(cx, cy, rh * 0.3 * k, 0, TAU); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(cx - rh * 0.12 * k, cy); g.lineTo(cx - rh * 0.03 * k, cy + rh * 0.1 * k); g.lineTo(cx + rh * 0.14 * k, cy - rh * 0.1 * k); g.stroke();
      }
      g.restore();
    }
    g.textBaseline = 'alphabetic';
  };

  // sales: a radar sweeps the market and lights up every lead
  scenes.sales = (g, W, H, t, st) => {
    const cx = W / 2, cy = H * 0.35, R = Math.min(W * 0.44, H * 0.34);
    if (!st.b) { const r = rng(5); st.b = Array.from({ length: 18 }, () => ({ a: r() * TAU, d: 0.22 + r() * 0.74 })); }
    g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { g.beginPath(); g.arc(cx, cy, (R * i) / 4, 0, TAU); g.stroke(); }
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    const sw = (t * 1.1) % TAU;
    for (let i = 0; i < 44; i++) {
      const k = i / 44, a0 = sw - k * 1.25, a1 = sw - (k - 0.03) * 1.25;
      g.fillStyle = rgba((1 - k) * 0.28, 1.1);
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1 + 0.02); g.closePath(); g.fill();
    }
    g.strokeStyle = rgba(0.95, 1.3); g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(sw) * R, cy + Math.sin(sw) * R); g.stroke();
    st.b.forEach((o, i) => {
      const diff = (((sw - o.a) % TAU) + TAU) % TAU;
      const glow = Math.exp(-diff * 1.5);
      const x = cx + Math.cos(o.a) * R * o.d, y = cy + Math.sin(o.a) * R * o.d;
      g.fillStyle = rgba(0.3 + glow * 0.7, 1.2); g.shadowColor = rgba(1); g.shadowBlur = glow * 16;
      g.beginPath(); g.arc(x, y, 3 + glow * 5, 0, TAU); g.fill(); g.shadowBlur = 0;
      if (i % 2 === 0 && diff < 1.3) {
        g.strokeStyle = rgba((1 - diff / 1.3) * 0.7, 1.2); g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, 8 + diff * 22, 0, TAU); g.stroke();
      }
    });
    g.fillStyle = rgba(1, 1.1); g.beginPath(); g.arc(cx, cy, 6, 0, TAU); g.fill();
  };

  // education: a web of ideas; knowledge pulses travel along it
  scenes.education = (g, W, H, t, st) => {
    if (!st.n) {
      const r = rng(23);
      st.n = [{ x: 0.5, y: 0.32, s: 1 }];
      for (let i = 0; i < 26; i++) st.n.push({ x: 0.08 + r() * 0.84, y: 0.05 + r() * 0.58, s: 0.4 + r() * 0.5 });
      st.e = [];
      st.n.forEach((a, i) => {
        st.n.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, (a.y - b.y) * 1.1) })).filter((o) => o.j !== i).sort((p, q) => p.d - q.d).slice(0, 2)
          .forEach((o) => { if (!st.e.some((e) => (e[0] === i && e[1] === o.j) || (e[0] === o.j && e[1] === i))) st.e.push([i, o.j, r()]); });
      });
    }
    const pos = st.n.map((n, i) => [W * n.x + Math.sin(t * 0.6 + i) * 7, H * n.y + Math.cos(t * 0.5 + i * 1.7) * 7]);
    g.lineWidth = 1.2;
    st.e.forEach(([i, j, off]) => {
      g.strokeStyle = rgba(0.2, 1.1);
      g.beginPath(); g.moveTo(pos[i][0], pos[i][1]); g.lineTo(pos[j][0], pos[j][1]); g.stroke();
      const u = (t * 0.32 + off) % 1;
      g.fillStyle = rgba(1, 1.4); g.shadowColor = rgba(1); g.shadowBlur = 10;
      g.beginPath(); g.arc(lerp(pos[i][0], pos[j][0], u), lerp(pos[i][1], pos[j][1], u), 2.8, 0, TAU); g.fill(); g.shadowBlur = 0;
    });
    st.n.forEach((n, i) => {
      const [x, y] = pos[i], br = 0.6 + 0.4 * Math.sin(t * 1.6 + i);
      g.fillStyle = rgba(0.2 + 0.2 * br); g.beginPath(); g.arc(x, y, (6 + n.s * 9) * (1 + 0.1 * br), 0, TAU); g.fill();
      g.fillStyle = rgba(1, 1.15); g.beginPath(); g.arc(x, y, 2.5 + n.s * 3.5, 0, TAU); g.fill();
    });
    const [cx, cy] = pos[0], k = (t * 0.6) % 1;
    g.strokeStyle = rgba((1 - k) * 0.7, 1.3); g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, 14 + k * 70, 0, TAU); g.stroke();
  };

  // real estate: a skyline that builds itself, lights switching on, a pin on the tallest tower
  scenes.realestate = (g, W, H, t, st) => {
    if (!st.bd) {
      const r = rng(41);
      st.bd = Array.from({ length: 9 }, () => ({ h: 0.2 + r() * 0.3, ph: r() * 9, w: 0.088 }));
      st.top = st.bd.reduce((m, b, i, a) => (b.h > a[m].h ? i : m), 0);
    }
    const base = H * 0.66, gap = W * 0.012, w = W * 0.088, x0 = (W - (w * 9 + gap * 8)) / 2;
    const gl = g.createLinearGradient(0, base - H * 0.5, 0, base);
    gl.addColorStop(0, rgba(0)); gl.addColorStop(1, rgba(0.2, 1.1));
    g.fillStyle = gl; g.fillRect(0, base - H * 0.5, W, H * 0.5);
    st.bd.forEach((b, i) => {
      const grow = ease(clamp((t - 0.2 - i * 0.12) / 1.3)), h = b.h * H * grow, x = x0 + i * (w + gap), y = base - h;
      const f = g.createLinearGradient(0, y, 0, base);
      f.addColorStop(0, 'rgba(26,32,64,0.96)'); f.addColorStop(1, 'rgba(10,14,32,0.96)');
      g.fillStyle = f; rr(g, x, y, w, h, 4); g.fill();
      g.strokeStyle = rgba(0.5, 1.2); g.lineWidth = 1.2; rr(g, x, y, w, h, 4); g.stroke();
      const cols = 3, rows = Math.floor(h / 20);
      for (let rI = 0; rI < rows; rI++) for (let cI = 0; cI < cols; cI++) {
        const lit = Math.sin(t * 0.7 + b.ph + rI * 1.7 + cI * 2.3) > 0.25;
        g.fillStyle = lit ? 'rgba(255,214,140,0.9)' : 'rgba(255,255,255,0.07)';
        g.fillRect(x + 8 + cI * ((w - 16) / cols), y + 10 + rI * 20, (w - 16) / cols - 5, 10);
      }
    });
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(0, base, W, 2);
    // the pin
    const tb = st.bd[st.top], px = x0 + st.top * (w + gap) + w / 2, py = base - tb.h * H - 36 + Math.sin(t * 3) * 6;
    const k = (t * 0.8) % 1;
    g.strokeStyle = rgba((1 - k) * 0.7, 1.3); g.lineWidth = 2;
    g.beginPath(); g.ellipse(px, base - tb.h * H - 4, 12 + k * 40, 4 + k * 12, 0, 0, TAU); g.stroke();
    g.fillStyle = rgba(1, 1.2); g.shadowColor = rgba(1); g.shadowBlur = 16;
    g.beginPath(); g.arc(px, py - 10, 13, Math.PI * 0.85, Math.PI * 0.15, false); g.lineTo(px, py + 18); g.closePath(); g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(px, py - 10, 5, 0, TAU); g.fill();
  };

  // support: tickets float up, fill with progress and flip to resolved
  scenes.support = (g, W, H, t, st) => {
    if (!st.k) { const r = rng(7); st.k = Array.from({ length: 9 }, (_, i) => ({ lane: i % 4, v: 0.07 + r() * 0.05, off: r(), wd: 0.9 + r() * 0.2 })); }
    const cw = W * 0.19, ch = H * 0.1;
    st.k.forEach((o) => {
      const k = (t * o.v + o.off) % 1, y = H * 0.7 - k * H * 0.78;
      const x = W * 0.07 + o.lane * (W * 0.225) + Math.sin(t + o.off * 9) * 6;
      const done = k > 0.52, a = clamp(k / 0.08) * (1 - clamp((k - 0.86) / 0.12));
      const sc = done ? 1 + 0.07 * Math.exp(-(k - 0.52) * 30) : 1;
      g.save(); g.globalAlpha = a; g.translate(x + cw / 2, y + ch / 2); g.scale(sc, sc); g.translate(-cw / 2, -ch / 2);
      g.fillStyle = done ? rgba(0.28, 1.1) : 'rgba(255,255,255,0.08)';
      rr(g, 0, 0, cw, ch, 12); g.fill();
      g.strokeStyle = done ? rgba(0.95, 1.2) : 'rgba(255,255,255,0.2)'; g.lineWidth = 1.5; rr(g, 0, 0, cw, ch, 12); g.stroke();
      g.fillStyle = done ? rgba(1, 1.2) : 'rgba(200,210,235,0.5)'; g.beginPath(); g.arc(14, ch / 2, 7, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)'; rr(g, 30, ch * 0.3, cw * 0.5 * o.wd, 5, 3); g.fill(); rr(g, 30, ch * 0.55, cw * 0.34, 5, 3); g.fill();
      if (done) {
        g.strokeStyle = '#fff'; g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(cw - 26, ch / 2); g.lineTo(cw - 19, ch / 2 + 7); g.lineTo(cw - 8, ch / 2 - 7); g.stroke();
      } else {
        g.fillStyle = 'rgba(255,255,255,0.12)'; rr(g, 30, ch - 12, cw - 44, 4, 2); g.fill();
        g.fillStyle = rgba(1, 1.2); rr(g, 30, ch - 12, (cw - 44) * clamp(k / 0.5), 4, 2); g.fill();
      }
      g.restore();
    });
    g.font = '700 13px "JetBrains Mono", monospace'; g.textAlign = 'right';
    g.fillStyle = rgba(1, 1.3); g.fillText('QUEUE  0', W - 14, 24);
  };

  // finance: a document is scanned line by line, then stamped verified
  scenes.finance = (g, W, H, t, st) => {
    const dw = W * 0.38, dh = H * 0.58, x = W / 2 - dw / 2, y = H * 0.05, T = 5.4, s = t % T;
    g.fillStyle = 'rgba(255,255,255,0.06)'; rr(g, x, y, dw, dh, 16); g.fill();
    g.strokeStyle = rgba(0.6, 1.2); g.lineWidth = 1.5; rr(g, x, y, dw, dh, 16); g.stroke();
    const by = y + clamp(s / 3.1) * dh, rows = 10, r = rng(3);
    for (let i = 0; i < rows; i++) {
      const ly = y + 34 + i * ((dh - 56) / rows), lw = (dw - 56) * (i === 0 ? 0.5 : 0.55 + r() * 0.45);
      const scanned = ly < by && s < 4.9;
      g.fillStyle = scanned ? rgba(0.85, 1.2) : 'rgba(255,255,255,0.18)';
      rr(g, x + 28, ly, lw, 7, 4); g.fill();
    }
    if (s < 3.4) {
      const bg = g.createLinearGradient(0, by - 54, 0, by);
      bg.addColorStop(0, rgba(0)); bg.addColorStop(1, rgba(0.45, 1.2));
      g.fillStyle = bg; g.fillRect(x - 10, by - 54, dw + 20, 54);
      g.fillStyle = '#fff'; g.shadowColor = rgba(1); g.shadowBlur = 18; g.fillRect(x - 14, by - 1, dw + 28, 2.5); g.shadowBlur = 0;
    }
    if (s > 3.2 && s < 5) {
      const k = clamp((s - 3.2) / 0.45), sc = 0.4 + ease(k) * 0.6 + Math.sin(k * Math.PI) * 0.16, a = 1 - clamp((s - 4.6) / 0.4);
      g.save(); g.globalAlpha = a; g.translate(x + dw * 0.8, y + dh * 0.78); g.rotate(-0.2); g.scale(sc, sc);
      g.fillStyle = rgba(0.95, 1.1); g.shadowColor = rgba(1); g.shadowBlur = 24;
      g.beginPath(); g.moveTo(0, -42); g.lineTo(36, -28); g.lineTo(32, 10); g.quadraticCurveTo(24, 34, 0, 46); g.quadraticCurveTo(-24, 34, -32, 10); g.lineTo(-36, -28); g.closePath(); g.fill(); g.shadowBlur = 0;
      g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(-14, 0); g.lineTo(-4, 11); g.lineTo(15, -12); g.stroke();
      g.restore();
    }
  };

  // automotive: an endless road, a car's tail lights and streaks of speed
  scenes.automotive = (g, W, H, t, st) => {
    if (!st.s) { const r = rng(17); st.s = Array.from({ length: 26 }, () => ({ a: r() * TAU, v: 0.25 + r() * 0.5, o: r() })); }
    const hx = W / 2, hy = H * 0.26, yb = H * 0.7, rw = W * 0.9;
    const sun = g.createRadialGradient(hx, hy, 0, hx, hy, W * 0.4);
    sun.addColorStop(0, rgba(0.5, 1.2)); sun.addColorStop(1, rgba(0));
    g.fillStyle = sun; g.fillRect(0, 0, W, yb);
    g.fillStyle = 'rgba(14,20,42,0.9)';
    g.beginPath(); g.moveTo(hx - 8, hy); g.lineTo(hx + 8, hy); g.lineTo(hx + rw / 2, yb); g.lineTo(hx - rw / 2, yb); g.closePath(); g.fill();
    g.strokeStyle = rgba(0.9, 1.2); g.lineWidth = 2;
    [-1, 1].forEach((sd) => { g.beginPath(); g.moveTo(hx + sd * 8, hy); g.lineTo(hx + sd * rw / 2, yb); g.stroke(); });
    const n = 9, mv = (t * 0.55) % 1;
    for (let i = 0; i < n; i++) {
      const s1 = (i + mv) / n, s2 = s1 + 0.5 / n;
      const y1 = hy + (yb - hy) * s1 * s1, y2 = hy + (yb - hy) * s2 * s2, w1 = 1 + 13 * s1, w2 = 1 + 13 * s2;
      g.fillStyle = `rgba(255,255,255,${0.2 + 0.55 * s1})`;
      g.beginPath(); g.moveTo(hx - w1 / 2, y1); g.lineTo(hx + w1 / 2, y1); g.lineTo(hx + w2 / 2, y2); g.lineTo(hx - w2 / 2, y2); g.closePath(); g.fill();
    }
    st.s.forEach((o) => {
      const k = (t * o.v + o.o) % 1, d0 = k * k * 0.9;
      const x1 = hx + Math.cos(o.a) * W * 0.5 * d0, y1 = hy + Math.sin(o.a) * H * 0.3 * d0 + d0 * 30;
      const x2 = hx + Math.cos(o.a) * W * 0.5 * (d0 + 0.05), y2 = hy + Math.sin(o.a) * H * 0.3 * (d0 + 0.05) + (d0 + 0.05) * 30;
      g.strokeStyle = rgba(k * 0.6, 1.4); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    });
    // the car, seen from behind
    const cw = W * 0.28, cx = hx, by = H * 0.655 + Math.sin(t * 17) * 1.2, ch = cw * 0.22;
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.ellipse(cx, by + 4, cw * 0.55, 8, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(40,48,86,1)'; rr(g, cx - cw * 0.26, by - ch * 1.75, cw * 0.52, ch * 1.0, 16); g.fill();
    g.fillStyle = 'rgba(12,18,38,0.95)'; rr(g, cx - cw * 0.2, by - ch * 1.62, cw * 0.4, ch * 0.7, 10); g.fill();
    const bodyG = g.createLinearGradient(0, by - ch, 0, by);
    bodyG.addColorStop(0, 'rgba(58,68,112,1)'); bodyG.addColorStop(1, 'rgba(28,34,66,1)');
    g.fillStyle = bodyG; rr(g, cx - cw / 2, by - ch * 1.05, cw, ch * 1.05, 14); g.fill();
    g.strokeStyle = rgba(0.7, 1.2); g.lineWidth = 1.5; rr(g, cx - cw / 2, by - ch * 1.05, cw, ch * 1.05, 14); g.stroke();
    [-1, 1].forEach((sd) => {
      const lx = cx + sd * cw * 0.36;
      g.fillStyle = rgba(0.35, 1.2); g.beginPath(); g.ellipse(lx, by - ch * 0.62, cw * 0.14, ch * 0.5, 0, 0, TAU); g.fill();
      g.fillStyle = '#FF5A3C'; g.shadowColor = '#FF5A3C'; g.shadowBlur = 20; rr(g, lx - cw * 0.085, by - ch * 0.76, cw * 0.17, ch * 0.28, 5); g.fill(); g.shadowBlur = 0;
      g.fillStyle = '#0A0F22'; rr(g, cx + sd * cw * 0.34 - cw * 0.07, by - ch * 0.12, cw * 0.14, ch * 0.3, 5); g.fill();
    });
    g.fillStyle = 'rgba(255,255,255,0.75)'; rr(g, cx - cw * 0.09, by - ch * 0.36, cw * 0.18, ch * 0.2, 3); g.fill();
  };

  function initScene() {
    const wrap = $('#ip-scene'), cv = $('#ip-canvas');
    if (!wrap || !cv || !scenes[slug]) return;
    const g = cv.getContext('2d');
    let W = 0, H = 0, visible = true; const st = {};
    function resize() {
      const r = wrap.getBoundingClientRect(); W = r.width; H = r.height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) draw(3.2);
    }
    function draw(t) { g.clearRect(0, 0, W, H); g.lineCap = 'round'; scenes[slug](g, W, H, t, st); }
    const t0 = performance.now();
    function loop(now) { if (visible) draw((now - t0) / 1000); requestAnimationFrame(loop); }
    resize();
    window.addEventListener('resize', resize);
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(wrap);
    if (reduce) draw(3.2); else requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------- 2. live card */
  function initLive() {
    const wave = $('#ip-wave'), say = $('#ip-live-say');
    if (!wave || !say) return;
    wave.innerHTML = Array.from({ length: 30 }, (_, k) => `<i style="--k:${k}"></i>`).join('');
    const lines = D.dialogue.filter((d) => d[0] === 'r').map((d) => d[1]);
    if (reduce) { say.textContent = lines[0]; return; }
    (async function run() {
      for (let i = 0; ; i = (i + 1) % lines.length) {
        say.textContent = '';
        for (const ch of lines[i]) { say.textContent += ch; await sleep(24); }
        await sleep(2400);
      }
    })();
  }

  /* ------------------------------------------- 3 + 4. scroll-driven bits */
  function initScroll() {
    const rows = $$('.ip-row'), tl = $('#ip-tl'), steps = $$('.ip-step');
    let ticking = false;
    function update() {
      ticking = false;
      const vh = window.innerHeight;
      rows.forEach((row) => {
        const r = row.getBoundingClientRect();
        const p = clamp((vh * 0.84 - r.top) / (vh * 0.34));
        row.style.setProperty('--p', p.toFixed(3));
        row.classList.toggle('run', p > 0.01 && p < 0.995);
      });
      if (tl) {
        const r = tl.getBoundingClientRect();
        const y = vh * 0.55 - r.top;
        const fill = clamp(y - 28, 0, tl.offsetHeight - 56);
        tl.style.setProperty('--fill', fill.toFixed(1) + 'px');
        steps.forEach((s) => s.classList.toggle('on', y >= s.offsetTop + 28));
      }
    }
    const on = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    update();
  }

  /* ----------------------------------------------------------- 5. the chat */
  function initChat() {
    const chat = $('#ip-chat'), phone = $('#ip-phone'), btn = $('#ip-replay');
    if (!chat) return;
    let token = 0;
    const add = (who, text) => {
      const d = document.createElement('div');
      d.className = 'ip-msg ' + who;
      d.innerHTML = `<small>${who === 'r' ? 'Remo' : 'Caller'}</small>${text}`;
      chat.appendChild(d);
    };
    async function play() {
      const my = ++token;
      chat.innerHTML = '';
      for (const [who, text] of D.dialogue) {
        if (my !== token) return;
        if (reduce) { add(who, text); continue; }
        const dots = document.createElement('div');
        dots.className = 'ip-msg ' + who + ' ip-typing'; dots.innerHTML = '<i></i><i></i><i></i>';
        chat.appendChild(dots);
        await sleep(who === 'r' ? 1000 : 650);
        if (my !== token) return;
        dots.remove(); add(who, text);
        await sleep(Math.min(2300, 700 + text.length * 22));
      }
    }
    btn.addEventListener('click', play);
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { play(); io.disconnect(); } }, { threshold: 0.35 });
      io.observe(phone);
    } else play();
  }

  initScene();
  initLive();
  initScroll();
  initChat();
})();
