/* ==========================================================================
   TakeRemo — How It Works.
   1) Hero: layered voice ribbons.
   2) Story: one cloud of particles that reshapes itself as you scroll
      (contact list > outgoing calls > sound wave > data cards > calendar > chart).
   ========================================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;

  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Run a draw loop only while the element is on screen and the tab is visible */
  function loop(host, frame) {
    let on = false, raf = 0;
    const tick = (now) => { raf = 0; if (!on || document.hidden) return; frame(now / 1000); raf = requestAnimationFrame(tick); };
    const kick = () => { if (!raf && on && !document.hidden) raf = requestAnimationFrame(tick); };
    new IntersectionObserver(([e]) => { on = e.isIntersecting; kick(); }, { threshold: 0 }).observe(host);
    document.addEventListener('visibilitychange', kick);
  }

  function fit(cv) {
    const ctx = cv.getContext('2d');
    const state = { w: 0, h: 0, ctx };
    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.w = r.width; state.h = r.height;
      cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    new ResizeObserver(size).observe(cv);
    return state;
  }

  /* ------------------------------------------------------------ 1. hero */
  function hero() {
    const cv = $('#hw-ribbons');
    if (!cv) return;
    const s = fit(cv);
    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    window.addEventListener('pointermove', (e) => { mouse.tx = e.clientX / window.innerWidth; mouse.ty = e.clientY / window.innerHeight; }, { passive: true });

    const RIBBONS = 9;
    const draw = (t) => {
      const { ctx, w, h } = s;
      mouse.x = lerp(mouse.x, mouse.tx, 0.05); mouse.y = lerp(mouse.y, mouse.ty, 0.05);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over'; // normal blending, so blue over orange never mixes into purple
      // a slow "speech" envelope so the ribbons swell and settle like a voice
      const voice = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1));
      const base = h * (0.66 + (mouse.y - 0.5) * 0.06);
      // logo colours: a lifted logo blue and the orange-red of the "remo" pill, one per ribbon (never blended)
      const ribbonGrad = (rgb) => {
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.2, `rgba(${rgb},0.95)`);
        g.addColorStop(0.8, `rgba(${rgb},0.95)`); g.addColorStop(1, `rgba(${rgb},0)`);
        return g;
      };
      const blue = ribbonGrad('62,116,255'), orange = ribbonGrad('255,98,34');
      ctx.lineCap = 'round';
      for (let k = 0; k < RIBBONS; k++) {
        const f = k / (RIBBONS - 1);
        ctx.strokeStyle = k % 2 ? orange : blue;
        ctx.globalAlpha = 0.16 + 0.5 * (1 - Math.abs(f - 0.5) * 2);
        ctx.lineWidth = 1 + (1 - Math.abs(f - 0.5) * 2) * 1.6;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 10) {
          const u = x / w;
          const edge = Math.sin(u * Math.PI);
          const amp = h * 0.16 * voice * edge;
          const y = base
            + Math.sin(u * 5.2 + t * 0.9 + k * 0.42 + (mouse.x - 0.5) * 2) * amp
            + Math.sin(u * 9.1 - t * 1.3 + k * 0.7) * amp * 0.38
            + (f - 0.5) * h * 0.1 * edge;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };
    if (reduce) { draw(2.2); new ResizeObserver(() => draw(2.2)).observe(cv); return; }
    loop(cv, draw);
  }

  /* ----------------------------------------------------------- 2. story */
  const COLORS = [[96, 140, 255], [34, 211, 238], [168, 85, 247], [96, 165, 250], [16, 185, 129], [251, 191, 36]];
  const STEPS = COLORS.length;

  /* Shapes live in a unit box: x in [-1.3, 1.3], y in [-1, 1]. Each returns a list of polylines. */
  const circle = (cx, cy, r, n = 40) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * TAU) * r, cy + Math.sin((i / n) * TAU) * r]);
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const seg = (x1, y1, x2, y2) => [[x1, y1], [x2, y2]];

  const SHAPES = [
    // 0 BRIEF: a contact list
    () => {
      const p = [rect(-0.95, -0.9, 1.9, 1.8), seg(-0.95, -0.62, 0.95, -0.62)];
      for (let i = 0; i < 5; i++) {
        const y = -0.34 + i * 0.3;
        p.push(circle(-0.7, y, 0.075, 18), seg(-0.5, y - 0.04, 0.12 + (i % 3) * 0.2, y - 0.04), seg(-0.5, y + 0.07, -0.05 + (i % 2) * 0.12, y + 0.07), seg(0.62, y, 0.8, y));
      }
      return p;
    },
    // 1 DIAL: rings travelling out of one point, with contacts on the outer ring
    (t) => {
      const p = [circle(0, 0, 0.1, 22)];
      for (let k = 0; k < 4; k++) p.push(circle(0, 0, 0.18 + ((k + (t * 0.32) % 1) / 4) * 0.82, 70));
      const a0 = t * 0.25;
      for (let i = 0; i < 10; i++) {
        const a = a0 + (i / 10) * TAU;
        p.push(seg(Math.cos(a) * 0.13, Math.sin(a) * 0.13, Math.cos(a) * 0.9, Math.sin(a) * 0.9), circle(Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0.05, 12));
      }
      return p;
    },
    // 2 TALK: a living sound wave
    (t) => {
      const p = [];
      const n = 49;
      for (let i = 0; i < n; i++) {
        const x = -1.25 + (i / (n - 1)) * 2.5;
        const env = Math.exp(-Math.pow(x / 0.85, 2));
        const h = 0.04 + 0.78 * env * (0.3 + 0.7 * Math.abs(Math.sin(t * 3.1 + i * 0.5) * Math.cos(t * 1.7 + i * 0.27)));
        p.push(seg(x, -h, x, h));
      }
      return p;
    },
    // 3 UNDERSTAND: speech in, structured fields out
    (t) => {
      const p = [];
      for (let i = 0; i < 12; i++) {
        const x = -1.25 + i * 0.075;
        const h = 0.05 + 0.2 * Math.abs(Math.sin(t * 3 + i * 0.7));
        p.push(seg(x, -h, x, h));
      }
      p.push(seg(-0.32, 0, 0.0, 0), seg(-0.1, -0.08, 0.0, 0), seg(-0.1, 0.08, 0.0, 0));
      for (let i = 0; i < 4; i++) {
        const y = -0.86 + i * 0.46;
        p.push(rect(0.12, y, 1.14, 0.36), circle(0.28, y + 0.18, 0.045, 10), seg(0.4, y + 0.11, 0.7, y + 0.11), seg(0.4, y + 0.25, 1.1, y + 0.25));
      }
      return p;
    },
    // 4 ACT: a calendar with a booked slot, and three checks
    (t) => {
      const p = [rect(-1.2, -0.78, 1.1, 1.56), seg(-1.2, -0.46, -0.1, -0.46)];
      for (let c = 1; c < 5; c++) p.push(seg(-1.2 + c * 0.22, -0.46, -1.2 + c * 0.22, 0.78));
      for (let r = 1; r < 4; r++) p.push(seg(-1.2, -0.46 + r * 0.31, -0.1, -0.46 + r * 0.31));
      const pulse = 0.05 + 0.02 * Math.sin(t * 4);
      p.push(circle(-0.65, 0.16, pulse, 12), circle(-0.65, 0.16, pulse * 2.2, 18));
      for (let i = 0; i < 3; i++) {
        const y = -0.62 + i * 0.62;
        p.push(circle(0.38, y, 0.19, 28), [[0.29, y + 0.01], [0.36, y + 0.09], [0.49, y - 0.08]], seg(0.7, y - 0.05, 1.22 - (i % 2) * 0.16, y - 0.05), seg(0.7, y + 0.09, 1.0, y + 0.09));
      }
      return p;
    },
    // 5 SEE: bars climbing with a trend line over them
    (t) => {
      const p = [seg(-1.1, 0.85, 1.1, 0.85), seg(-1.1, -0.9, -1.1, 0.85)];
      const heights = [0.3, 0.46, 0.4, 0.66, 0.82, 1.0, 1.28];
      const pts = [];
      heights.forEach((v, i) => {
        const h = v * (0.88 + 0.12 * Math.sin(t * 1.6 + i)) * 1.0;
        const x = -0.95 + i * 0.3;
        p.push(rect(x, 0.85 - h, 0.2, h), seg(x + 0.1, 0.85 - h, x + 0.1, 0.85));
        pts.push([x + 0.1, 0.85 - h - 0.14]);
      });
      p.push(pts);
      return p;
    }
  ];

  /* Turn polylines into N evenly spaced points */
  function sample(paths, n, out) {
    const segs = [];
    let total = 0;
    paths.forEach((poly) => {
      for (let i = 0; i < poly.length - 1; i++) {
        const dx = poly[i + 1][0] - poly[i][0], dy = poly[i + 1][1] - poly[i][1];
        const len = Math.hypot(dx, dy);
        if (len > 0) { segs.push([poly[i][0], poly[i][1], dx, dy, len, total]); total += len; }
      }
    });
    let j = 0;
    for (let i = 0; i < n; i++) {
      const d = ((i + 0.5) / n) * total;
      while (j < segs.length - 1 && segs[j][5] + segs[j][4] < d) j++;
      const sg = segs[j];
      const f = clamp((d - sg[5]) / sg[4]);
      out[i * 2] = sg[0] + sg[2] * f;
      out[i * 2 + 1] = sg[1] + sg[3] * f;
    }
  }

  function story() {
    const track = $('#hw-track');
    const stage = $('#hw-stage');
    const cv = $('#hw-morph');
    if (!track || !stage || !cv) return;

    const steps = $$('.hw-step');
    const readouts = $$('.hw-r', stage);
    const rail = $('#hw-rail');
    const s = fit(cv);
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    const N = narrow ? 750 : 1400;

    // rail: one dot per step, click to jump
    steps.forEach((el, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<button type="button" aria-label="Go to step ${i + 1}: ${el.dataset.label}"><i></i><span>${el.dataset.label}</span></button>`;
      $('button', li).addEventListener('click', () => {
        const max = track.offsetHeight - window.innerHeight;
        const top = track.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: top + ((i + 0.5) / STEPS) * max, behavior: reduce ? 'auto' : 'smooth' });
      });
      rail.appendChild(li);
    });
    const dots = $$('.hw-rail button');

    // particles
    const R = rng(11);
    const px = new Float32Array(N), py = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
    const k = new Float32Array(N), seed = new Float32Array(N), size = new Float32Array(N);
    const col = new Float32Array(N * 3);
    const order = Array.from({ length: N }, (_, i) => i).sort(() => R() - 0.5);
    for (let i = 0; i < N; i++) {
      const a = R() * TAU, r = 0.2 + R() * 1.1;
      px[i] = Math.cos(a) * r; py[i] = Math.sin(a) * r * 0.8;
      k[i] = 26 + R() * 44; seed[i] = R() * TAU; size[i] = 0.9 + R() * 1.5;
      col[i * 3] = COLORS[0][0]; col[i * 3 + 1] = COLORS[0][1]; col[i * 3 + 2] = COLORS[0][2];
    }
    const tgt = new Float32Array(N * 2);

    let step = -1, local = 0, shownCol = COLORS[0].slice(), stepAt = 0;
    const SETTLE_AFTER = 1.8, SETTLE_FOR = 0.9; // seconds of glowing motion, then a fade to the clean drawing

    const progress = () => {
      const r = track.getBoundingClientRect();
      const max = r.height - window.innerHeight;
      return max > 0 ? clamp(-r.top / max) : 0;
    };

    const setStep = (i, t) => {
      step = i;
      stepAt = t;
      steps.forEach((el, n) => el.classList.toggle('is-on', n === i));
      readouts.forEach((el, n) => el.classList.toggle('is-active', n === i));
      dots.forEach((d, n) => { d.classList.toggle('is-on', n === i); d.classList.toggle('is-done', n < i); });
      const c = COLORS[i].join(',');
      stage.style.setProperty('--hw-c', c);
      $('.hw-sticky').style.setProperty('--hw-c', c);
      // the reshape: a small kick so the cloud scatters before it re-forms
      if (!reduce) for (let n = 0; n < N; n++) { const a = R() * TAU, f = 0.5 + R() * 1.1; vx[n] += Math.cos(a) * f; vy[n] += Math.sin(a) * f; }
    };

    // the little read-outs under the stage follow the scroll inside each step
    const paintReadout = () => {
      const r = readouts[step];
      if (!r) return;
      $$('[data-at]', r).forEach((el) => {
        const at = parseFloat(el.dataset.at);
        el.classList.toggle('is-on', local >= at || reduce);
        const typed = $('[data-type]', el);
        if (typed) {
          const full = typed.dataset.type;
          typed.textContent = full.slice(0, Math.floor(full.length * clamp((local - at) / 0.4)));
        }
      });
      $$('[data-count]', r).forEach((el) => {
        const to = parseFloat(el.dataset.count);
        el.textContent = Math.round(to * ease(clamp(local / 0.7))).toLocaleString('en-US') + (el.dataset.suffix || '');
      });
    };

    let last = performance.now() / 1000;
    const frame = (t) => {
      const dt = Math.min(0.05, Math.max(0.001, t - last)); last = t;
      const p = progress();
      const i = Math.min(STEPS - 1, Math.floor(p * STEPS));
      local = clamp(p * STEPS - i);
      if (i !== step) setStep(i, t);
      paintReadout();

      const { ctx, w, h } = s;
      const unit = Math.min(w / 2.9, h / 2.2);
      const cx = w / 2, cy = h * 0.46;

      const paths = SHAPES[step](t);
      sample(paths, N, tgt);

      // After a few seconds the glow dies down and the particles hand over to a clean, plain drawing
      // of what they built, so the picture is easy to read.
      const settle = reduce ? 1 : clamp((t - stepAt - SETTLE_AFTER) / SETTLE_FOR);

      // fade what was drawn instead of clearing: moving particles leave short trails (none once settled)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${reduce ? 1 : lerp(0.3, 1, settle)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      const target = COLORS[step];
      shownCol[0] = lerp(shownCol[0], target[0], 0.05); shownCol[1] = lerp(shownCol[1], target[1], 0.05); shownCol[2] = lerp(shownCol[2], target[2], 0.05);
      const damp = Math.exp(-9 * dt);

      for (let n = 0; n < N; n++) {
        const q = order[n] * 2;
        const jitter = reduce ? 0 : 0.006 * (1 - settle);
        const tx = tgt[q] + Math.cos(t * 1.3 + seed[n]) * jitter;
        const ty = tgt[q + 1] + Math.sin(t * 1.1 + seed[n] * 1.7) * jitter;
        if (reduce) { px[n] = tx; py[n] = ty; }
        else {
          vx[n] = (vx[n] + (tx - px[n]) * k[n] * dt) * damp;
          vy[n] = (vy[n] + (ty - py[n]) * k[n] * dt) * damp;
          px[n] += vx[n] * dt; py[n] += vy[n] * dt;
        }
        if (settle >= 1) continue; // the physics keeps running; only the drawing is skipped
        // each dot drifts a little toward a neighbouring hue so the cloud isn't a flat colour
        const mix = 0.5 + 0.5 * Math.sin(seed[n] * 3 + px[n] * 1.4);
        const nc = COLORS[(step + 1) % STEPS];
        const r = lerp(shownCol[0], nc[0], mix * 0.35), g = lerp(shownCol[1], nc[1], mix * 0.35), b = lerp(shownCol[2], nc[2], mix * 0.35);
        const speed = Math.min(1, Math.hypot(vx[n], vy[n]) * 0.6);
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${(0.55 + speed * 0.4) * (1 - settle)})`;
        ctx.beginPath();
        ctx.arc(cx + px[n] * unit, cy + py[n] * unit, size[n] * (narrow ? 0.85 : 1) * (1 + speed * 0.5), 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      if (settle > 0) {
        ctx.globalAlpha = settle;
        ctx.strokeStyle = `rgb(${shownCol[0] | 0},${shownCol[1] | 0},${shownCol[2] | 0})`;
        ctx.lineWidth = narrow ? 2 : 2.6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        paths.forEach((poly) => {
          poly.forEach((pt, n) => {
            const x = cx + pt[0] * unit, y = cy + pt[1] * unit;
            if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };

    if (reduce) {
      const draw = () => frame(2.4);
      let ticking = false;
      const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; draw(); draw(); }); } };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      draw(); draw();
      return;
    }
    loop(track, frame);
  }

  hero();
  story();
})();
