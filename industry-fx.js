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

  // recruitment: Remo takes a screening call, a candidate card scores itself live, gets shortlisted and an interview lands in the calendar
  const RC = [
    { n: 'Priya Nair', r: 'Senior Backend Engineer', i: 'PN', sc: 94, slot: 'Tue · 10:30', rows: [['Skills match', 0.96, 'Node · Go · AWS'], ['Experience', 0.88, '7 years'], ['Notice period', 0.8, '30 days']] },
    { n: 'Arjun Mehta', r: 'Product Designer', i: 'AM', sc: 91, slot: 'Wed · 14:00', rows: [['Skills match', 0.92, 'Figma · Systems'], ['Experience', 0.8, '5 years'], ['Notice period', 0.98, 'Immediate']] },
    { n: 'Sara Khan', r: 'Data Analyst', i: 'SK', sc: 89, slot: 'Thu · 11:15', rows: [['Skills match', 0.9, 'SQL · Python · BI'], ['Experience', 0.75, '4 years'], ['Notice period', 0.9, '15 days']] },
    { n: 'Rohan Iyer', r: 'Sales Manager', i: 'RI', sc: 92, slot: 'Fri · 16:00', rows: [['Skills match', 0.93, 'B2B · SaaS'], ['Experience', 0.9, '8 years'], ['Notice period', 0.7, '45 days']] }
  ];
  scenes.recruitment = (g, W, H, t0, st) => {
    const t = Math.max(0, t0);
    const T = 8, cyc = Math.floor(t / T), s = t % T, F = '"Outfit", sans-serif', M = '"JetBrains Mono", monospace';
    const cx = W / 2, cw = W * 0.8, ch = H * 0.5, cy0 = H * 0.215, u = W / 700;
    const cardCy = cy0 + ch / 2;

    if (!st.p) {
      const r = rng(11);
      st.p = Array.from({ length: 34 }, () => ({ a: r() * TAU, v: 0.05 + r() * 0.07, o: r(), z: 0.6 + r() * 1.2 }));
      st.sp = Array.from({ length: 22 }, () => ({ a: r() * TAU, v: 60 + r() * 120, z: 1.5 + r() * 2.2 }));
    }

    /* ---- ambient: breathing glow, slow dashed orbits, applicants drifting in */
    const gl = g.createRadialGradient(cx, cardCy, 0, cx, cardCy, W * 0.62);
    gl.addColorStop(0, rgba(0.2 + 0.05 * Math.sin(t * 1.3), 1.2)); gl.addColorStop(1, rgba(0));
    g.fillStyle = gl; g.fillRect(0, 0, W, H);
    [[0.5, 0.16, 18, 1], [0.62, 0.1, 26, -1]].forEach(([k, a, d, dir]) => {
      g.save(); g.strokeStyle = rgba(a, 1.3); g.lineWidth = 1.2; g.setLineDash([d, d * 1.6]); g.lineDashOffset = dir * t * 14;
      g.beginPath(); g.ellipse(cx, cardCy, W * k, H * k * 0.78, 0, 0, TAU); g.stroke(); g.restore();
    });
    st.p.forEach((o) => {
      const k = (t * o.v + o.o) % 1, rad = lerp(0.62, 0.12, k), ang = o.a + k * 1.3;
      const x = cx + Math.cos(ang) * W * rad, y = cardCy + Math.sin(ang) * H * rad * 0.78;
      const al = Math.sin(k * Math.PI) * 0.8;
      g.fillStyle = rgba(al, 1.4); g.shadowColor = rgba(1); g.shadowBlur = 8;
      g.beginPath(); g.arc(x, y, o.z * u * 1.7, 0, TAU); g.fill(); g.shadowBlur = 0;
    });

    /* ---- one candidate card, drawn at any moment of its own timeline */
    function card(p, ss, ox, al, entering) {
      const y = cy0, pd = cw * 0.055, av = ch * 0.115;
      const enter = entering ? ease(clamp(ss / 0.9)) : 1;
      const xx = cx - cw / 2 + ox + (1 - enter) * W * 0.35;
      const A = al * (entering ? clamp(ss / 0.45) : 1);
      g.save(); g.globalAlpha = A;
      // body
      const bg = g.createLinearGradient(0, y, 0, y + ch);
      bg.addColorStop(0, 'rgba(28,38,76,0.96)'); bg.addColorStop(1, 'rgba(12,18,42,0.96)');
      g.shadowColor = rgba(0.55, 1.1); g.shadowBlur = 44 * u; g.fillStyle = bg; rr(g, xx, y, cw, ch, 24 * u); g.fill(); g.shadowBlur = 0;
      g.strokeStyle = rgba(0.5, 1.25); g.lineWidth = 1.4; rr(g, xx, y, cw, ch, 24 * u); g.stroke();
      const sh = g.createLinearGradient(xx, y, xx + cw, y + ch * 0.6);
      sh.addColorStop(0, 'rgba(255,255,255,0.1)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.fillStyle = sh; rr(g, xx, y, cw, ch, 24 * u); g.fill();

      // avatar with progress ring
      const ax = xx + pd + av, ay = y + pd + av, ring = ease(clamp((ss - 0.35) / 1.1));
      g.lineWidth = 4 * u; g.strokeStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.arc(ax, ay, av, 0, TAU); g.stroke();
      g.strokeStyle = rgba(1, 1.3); g.shadowColor = rgba(1); g.shadowBlur = 10;
      g.beginPath(); g.arc(ax, ay, av, -Math.PI / 2, -Math.PI / 2 + TAU * ring); g.stroke(); g.shadowBlur = 0;
      const ag = g.createLinearGradient(ax - av, ay - av, ax + av, ay + av);
      ag.addColorStop(0, rgba(0.9, 1.25)); ag.addColorStop(1, rgba(0.9, 0.7));
      g.fillStyle = ag; g.beginPath(); g.arc(ax, ay, av * 0.78, 0, TAU); g.fill();
      g.fillStyle = '#fff'; g.font = `700 ${av * 0.62}px ${F}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.i, ax, ay + 1);
      // name + role
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillStyle = '#fff'; g.font = `700 ${ch * 0.066}px ${F}`; g.fillText(p.n, ax + av + 16 * u, ay - av * 0.08);
      g.fillStyle = 'rgba(200,214,255,0.62)'; g.font = `400 ${ch * 0.044}px ${F}`; g.fillText(p.r, ax + av + 16 * u, ay + av * 0.62);

      // score ring: spins while Remo listens, then settles on the score
      const sr = av * 1.05, sx = xx + cw - pd - sr, sy = ay, fill = ease(clamp((ss - 3.1) / 1.2));
      g.lineWidth = 5 * u; g.strokeStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.stroke();
      if (ss < 3.1) {
        const a0 = ss * 4.2; g.strokeStyle = rgba(0.85, 1.3); g.beginPath(); g.arc(sx, sy, sr, a0, a0 + 1.5); g.stroke();
      } else {
        g.strokeStyle = rgba(1, 1.35); g.shadowColor = rgba(1); g.shadowBlur = 14;
        g.beginPath(); g.arc(sx, sy, sr, -Math.PI / 2, -Math.PI / 2 + TAU * (p.sc / 100) * fill); g.stroke(); g.shadowBlur = 0;
      }
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `700 ${sr * 0.72}px ${M}`;
      g.fillText(ss < 3.1 ? '...'.slice(0, 1 + (Math.floor(ss * 3) % 3)) : String(Math.round(p.sc * fill)), sx, sy - sr * 0.08);
      g.fillStyle = 'rgba(200,214,255,0.6)'; g.font = `600 ${sr * 0.24}px ${M}`; g.fillText('MATCH', sx, sy + sr * 0.5);

      // divider
      const dy = y + pd * 2 + av * 2 - 2;
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(xx + pd, dy, cw - pd * 2, 1);

      // criteria rows, filled one after another as the call goes on
      const top = dy + pd * 0.55, rh = (y + ch - pd * 0.7 - top) / 3, bw = cw - pd * 2;
      p.rows.forEach((row, i) => {
        const ry = top + i * rh, st0 = 1.3 + i * 0.75, k = ease(clamp((ss - st0) / 0.9)), done = ss > st0 + 0.85;
        const ty = ry + rh * 0.4;
        g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        g.fillStyle = 'rgba(214,224,255,0.72)'; g.font = `500 ${ch * 0.04}px ${F}`; g.fillText(row[0], xx + pd, ty);
        const vx = xx + pd + bw;
        g.textAlign = 'right';
        if (done) {
          const pop = ease(clamp((ss - st0 - 0.85) / 0.3)), cyy = ty - ch * 0.013;
          g.globalAlpha = A * pop; g.fillStyle = '#fff'; g.font = `600 ${ch * 0.038}px ${M}`; g.fillText(row[2], vx - 24 * u, ty);
          g.fillStyle = rgba(1, 1.2); g.beginPath(); g.arc(vx - 8 * u, cyy, 8 * u * (0.6 + 0.4 * pop), 0, TAU); g.fill();
          g.strokeStyle = '#fff'; g.lineWidth = 2 * u; g.lineCap = 'round'; g.lineJoin = 'round';
          g.beginPath(); g.moveTo(vx - 12 * u, cyy); g.lineTo(vx - 8.5 * u, cyy + 3.5 * u); g.lineTo(vx - 3.5 * u, cyy - 3.5 * u); g.stroke();
          g.globalAlpha = A;
        }
        const by = ry + rh * 0.58, bh = 7 * u;
        g.fillStyle = 'rgba(255,255,255,0.09)'; rr(g, xx + pd, by, bw, bh, bh / 2); g.fill();
        const fw = bw * row[1] * k;
        if (fw > 1) {
          const bf = g.createLinearGradient(xx + pd, 0, xx + pd + bw, 0);
          bf.addColorStop(0, rgba(0.8, 0.9)); bf.addColorStop(1, rgba(1, 1.45));
          g.fillStyle = bf; g.shadowColor = rgba(0.9); g.shadowBlur = 8; rr(g, xx + pd, by, Math.max(bh, fw), bh, bh / 2); g.fill(); g.shadowBlur = 0;
          if (k < 1) { g.fillStyle = '#fff'; g.beginPath(); g.arc(xx + pd + fw, by + bh / 2, 3.2 * u, 0, TAU); g.fill(); }
        }
      });

      // SHORTLISTED badge on the corner of the card
      const bs = ss - 4.5;
      if (bs > 0) {
        const pw = cw * 0.31, ph = ch * 0.105, k = ease(clamp(bs / 0.35)), over = 1 + Math.sin(clamp(bs / 0.35) * Math.PI) * 0.18;
        const bx = xx + cw - pw - pd * 0.7, by2 = y - ph * 0.5;
        g.save(); g.translate(bx + pw / 2, by2 + ph / 2); g.scale(k * over, k * over); g.translate(-pw / 2, -ph / 2);
        const pg = g.createLinearGradient(0, 0, pw, 0); pg.addColorStop(0, rgba(1, 1.1)); pg.addColorStop(1, rgba(1, 1.5));
        g.shadowColor = rgba(1); g.shadowBlur = 24 + 10 * Math.sin(ss * 5); g.fillStyle = pg; rr(g, 0, 0, pw, ph, ph / 2); g.fill(); g.shadowBlur = 0;
        g.strokeStyle = '#fff'; g.lineWidth = 2.4 * u; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(ph * 0.3, ph * 0.52); g.lineTo(ph * 0.42, ph * 0.66); g.lineTo(ph * 0.66, ph * 0.36); g.stroke();
        g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = `700 ${ph * 0.4}px ${M}`; g.fillText('SHORTLISTED', ph * 0.85, ph / 2 + 1);
        g.restore();
        // a small burst of sparks
        if (bs < 1.3) {
          const bx2 = bx + pw / 2, by3 = by2 + ph / 2;
          st.sp.forEach((o) => {
            const d = o.v * u * ease(clamp(bs / 1.1)), a = clamp(1 - bs / 1.3);
            g.fillStyle = rgba(a, 1.5); g.beginPath(); g.arc(bx2 + Math.cos(o.a) * d, by3 + Math.sin(o.a) * d + bs * bs * 18 * u, o.z * u * a, 0, TAU); g.fill();
          });
        }
      }

      // interview booked chip drops in under the card
      const cs = ss - 5.3;
      if (cs > 0) {
        const k = ease(clamp(cs / 0.55)), w2 = cw * 0.72, h2 = H * 0.082, px = xx + cw / 2 - w2 / 2, py = y + ch + H * 0.03 + (1 - k) * 16 * u;
        g.globalAlpha = A * k;
        g.shadowColor = rgba(0.6, 1.1); g.shadowBlur = 26 * u; g.fillStyle = 'rgba(14,22,50,0.95)'; rr(g, px, py, w2, h2, h2 / 2); g.fill(); g.shadowBlur = 0;
        g.strokeStyle = rgba(0.7, 1.3); g.lineWidth = 1.3; rr(g, px, py, w2, h2, h2 / 2); g.stroke();
        const ix = px + h2 * 0.5, iy = py + h2 / 2, is = h2 * 0.27;
        g.fillStyle = '#fff'; rr(g, ix - is, iy - is * 0.8, is * 2, is * 1.9, 5 * u); g.fill();
        g.fillStyle = rgba(1, 1.2); rr(g, ix - is, iy - is * 0.8, is * 2, is * 0.65, 5 * u); g.fill(); g.fillRect(ix - is, iy - is * 0.45, is * 2, is * 0.3);
        g.fillStyle = '#fff'; rr(g, ix - is * 0.55, iy - is * 1.05, 3 * u, is * 0.55, 1.5 * u); g.fill(); rr(g, ix + is * 0.55 - 3 * u, iy - is * 1.05, 3 * u, is * 0.55, 1.5 * u); g.fill();
        g.fillStyle = rgba(1, 1.2); [-0.55, 0, 0.55].forEach((dx) => [0.2, 0.62].forEach((dy) => g.fillRect(ix + dx * is - 2.2 * u, iy + dy * is - 2.2 * u, 4.4 * u, 4.4 * u)));
        g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = `600 ${h2 * 0.36}px ${F}`; g.fillText('Interview booked', px + h2 * 1.05, iy + 1);
        g.textAlign = 'right'; g.fillStyle = rgba(1, 1.5); g.font = `700 ${h2 * 0.34}px ${M}`; g.fillText(p.slot, px + w2 - h2 * 0.5, iy + 1);
      }
      g.restore();
      g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    }

    // queued candidates stacked behind
    [[1, 0.9, 0.32], [2, 0.8, 0.16]].forEach(([n, sc, a]) => {
      const w2 = cw * sc, y2 = cy0 - n * 11 * u + Math.sin(t * 1.2 + n) * 1.5;
      g.fillStyle = `rgba(30,42,86,${a})`; rr(g, cx - w2 / 2, y2, w2, ch, 22 * u); g.fill();
      g.strokeStyle = rgba(a * 1.3, 1.2); g.lineWidth = 1; rr(g, cx - w2 / 2, y2, w2, ch, 22 * u); g.stroke();
    });

    // the card that just finished slides away while the next one arrives
    if (cyc > 0 && s < 0.9) {
      const k = ease(clamp(s / 0.9));
      card(RC[(cyc - 1) % RC.length], 7.99, -k * W * 0.34, 1 - k, false);
    }
    card(RC[cyc % RC.length], s, 0, 1, true);

    /* ---- Remo on the call, above the card */
    const active = s > 0.35 && s < 4.5, ph = H * 0.085, pw = W * 0.5, px = cx - pw / 2, py = H * 0.05;
    if (active) {
      const gb = py + ph, ge = cy0;
      const bg2 = g.createLinearGradient(0, gb, 0, ge); bg2.addColorStop(0, rgba(0.9, 1.4)); bg2.addColorStop(1, rgba(0.2));
      g.strokeStyle = bg2; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx, gb); g.lineTo(cx, ge); g.stroke();
      for (let i = 0; i < 3; i++) {
        const k = (t * 1.2 + i / 3) % 1;
        g.fillStyle = '#fff'; g.shadowColor = rgba(1); g.shadowBlur = 8; g.globalAlpha = 1 - k * 0.7;
        g.beginPath(); g.arc(cx, lerp(gb, ge, k), 2.4 * u, 0, TAU); g.fill(); g.shadowBlur = 0; g.globalAlpha = 1;
      }
    }
    g.shadowColor = rgba(0.7, 1.1); g.shadowBlur = 30 * u; g.fillStyle = 'rgba(12,19,44,0.96)'; rr(g, px, py, pw, ph, ph / 2); g.fill(); g.shadowBlur = 0;
    g.strokeStyle = rgba(active ? 0.8 : 0.4, 1.3); g.lineWidth = 1.4; rr(g, px, py, pw, ph, ph / 2); g.stroke();
    const ox2 = px + ph * 0.62, oy2 = py + ph / 2, orb = ph * 0.3;
    if (active) {
      const k = (t * 0.9) % 1;
      g.strokeStyle = rgba((1 - k) * 0.7, 1.4); g.lineWidth = 1.6; g.beginPath(); g.arc(ox2, oy2, orb + k * ph * 0.42, 0, TAU); g.stroke();
    }
    const og = g.createRadialGradient(ox2 - orb * 0.3, oy2 - orb * 0.3, 0, ox2, oy2, orb);
    og.addColorStop(0, '#fff'); og.addColorStop(0.35, rgba(1, 1.5)); og.addColorStop(1, rgba(1, 0.8));
    g.fillStyle = og; g.shadowColor = rgba(1); g.shadowBlur = 16; g.beginPath(); g.arc(ox2, oy2, orb, 0, TAU); g.fill(); g.shadowBlur = 0;
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = '#fff'; g.font = `700 ${ph * 0.3}px ${F}`; g.fillText('Remo', ox2 + orb + 12 * u, oy2 - ph * 0.13);
    g.fillStyle = 'rgba(200,214,255,0.65)'; g.font = `500 ${ph * 0.22}px ${F}`;
    g.fillText(s < 0.35 ? 'Dialling...' : active ? 'Screening call' : 'Call complete', ox2 + orb + 12 * u, oy2 + ph * 0.2);
    // voice bars
    const nb = 13, bx0 = px + pw * 0.5;
    for (let i = 0; i < nb; i++) {
      const amp = active ? 0.2 + 0.8 * Math.abs(Math.sin(t * 6.5 + i * 0.85) * Math.sin(t * 2.7 + i * 0.4)) : 0.1;
      const bh = ph * 0.56 * amp, bx = bx0 + i * 7.5 * u;
      g.fillStyle = rgba(active ? 0.95 : 0.4, 1.4); rr(g, bx, oy2 - bh / 2, 3.4 * u, Math.max(3, bh), 2); g.fill();
    }
    // call timer
    const secs = Math.floor(clamp(s - 0.35, 0, 4.15) / 4.15 * 134), tm = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    g.textAlign = 'right'; g.fillStyle = active ? '#fff' : 'rgba(200,214,255,0.6)'; g.font = `600 ${ph * 0.27}px ${M}`; g.fillText(tm, px + pw - ph * 0.45, oy2 + 1);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  };
  scenes.recruitment.still = 5.9;

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
      if (reduce) draw(scenes[slug].still || 3.2);
    }
    function draw(t) { g.clearRect(0, 0, W, H); g.lineCap = 'round'; scenes[slug](g, W, H, t, st); }
    const t0 = performance.now();
    function loop(now) { if (visible) draw((now - t0) / 1000); requestAnimationFrame(loop); }
    resize();
    window.addEventListener('resize', resize);
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(wrap);
    if (reduce) draw(scenes[slug].still || 3.2); else requestAnimationFrame(loop);
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
