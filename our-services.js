/* ==========================================================================
   TakeRemo — Our Services.
   1) Hero: a living voice orb (audio-style bars that react to the pointer) with
      the five services orbiting it on a tilted ring.
   2) The turn: scroll-linked circle of light that grows out of the dark.
   3) Cards: reveal on scroll, 3D tilt and cursor spotlight.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const TAU = Math.PI * 2;

  document.documentElement.classList.add('sx-js');

  /* ------------------------------------------------------------ 1. the orb */
  const COL = [[96, 140, 255], [252, 36, 21], [16, 185, 129], [168, 85, 247], [34, 211, 238]];
  const INFO = [
    ['Recruitment', 'Screens candidates and books interviews'],
    ['Sales', 'Calls and qualifies every lead, instantly'],
    ['Customer Support', 'Resolves issues with empathy, 24/7'],
    ['Appointment Setting', 'Fills your calendar, cuts no-shows'],
    ['Receptionist', 'Answers every call, day or night']
  ];

  function initOrb() {
    const stage = $('#sx-stage');
    const cv = $('#sx-orb');
    if (!stage || !cv) return;
    const ctx = cv.getContext('2d');
    const nodes = $$('.sx-node', stage);
    const cap = $('#sx-caption');
    const capB = $('b', cap);
    const capS = $('small', cap);

    const N = 150;
    let W = 0, H = 0, dpr = 1;
    let t = 0, rot = 0, speed = 0.14, last = 0;
    let active = -1, hover = -1, idleAt = 0, idleIdx = 0;
    let tint = [252, 36, 21], tintAmt = 0;
    const mouse = { x: 0, y: 0, in: false, a: 0 };
    let visible = true;

    function resize() {
      const r = stage.getBoundingClientRect();
      W = r.width; H = r.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) frame(0);
    }

    function colorAt(k) {
      const f = (k / N) * 5, i = Math.floor(f) % 5, m = f - Math.floor(f);
      const a = COL[i], b = COL[(i + 1) % 5];
      return [lerp(a[0], b[0], m), lerp(a[1], b[1], m), lerp(a[2], b[2], m)];
    }

    function setActive(i) {
      if (i === active) return;
      active = i;
      if (i < 0) {
        cap.classList.remove('on');
        capB.textContent = 'Pick a voice';
        capS.textContent = 'Hover any planet around the orb';
      } else {
        cap.classList.add('on');
        cap.style.setProperty('--cc', COL[i].join(','));
        capB.textContent = INFO[i][0];
        capS.textContent = INFO[i][1];
      }
      nodes.forEach((n, k) => n.classList.toggle('hot', k === i));
    }

    nodes.forEach((n, i) => {
      n.addEventListener('pointerenter', () => { hover = i; setActive(i); });
      n.addEventListener('pointerleave', () => { hover = -1; idleAt = performance.now() + 1500; });
      n.addEventListener('focus', () => { hover = i; setActive(i); });
      n.addEventListener('blur', () => { hover = -1; idleAt = performance.now() + 1500; });
    });

    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.in = true;
      mouse.a = Math.atan2(mouse.y - r.height / 2, mouse.x - r.width / 2);
    });
    stage.addEventListener('pointerleave', () => { mouse.in = false; });

    function frame(now) {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      if (!reduce) t += dt;

      // idle: walk through the five services so the scene always tells its story
      if (hover < 0 && !reduce && now > idleAt) {
        setActive(idleIdx % 5);
        idleAt = now + 3200; idleIdx++;
      }

      const target = active >= 0 ? COL[active] : tint;
      tint = [lerp(tint[0], target[0], 0.08), lerp(tint[1], target[1], 0.08), lerp(tint[2], target[2], 0.08)];
      tintAmt = lerp(tintAmt, active >= 0 ? 0.75 : 0, 0.06);
      speed = lerp(speed, hover >= 0 ? 0.02 : 0.14, 0.05);
      if (!reduce) rot += dt * speed;

      const cx = W / 2, cy = H / 2, R = W * 0.235;
      ctx.clearRect(0, 0, W, H);

      // soft core glow
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.9);
      g.addColorStop(0, `rgba(${tint.map(Math.round).join(',')},${0.28 + tintAmt * 0.15})`);
      g.addColorStop(0.5, 'rgba(60,40,140,0.12)');
      g.addColorStop(1, 'rgba(5,11,26,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // orbit ring (tilted)
      const tilt = -0.28, rx = W * 0.44, ry = W * 0.17;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(tilt);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.stroke();
      ctx.setLineDash([2, 8]); ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.ellipse(0, 0, rx * 1.12, ry * 1.12, 0, 0, TAU); ctx.stroke();
      ctx.restore();

      // spectrum bars
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, W * 0.0058);
      const breathe = 0.86 + 0.14 * Math.sin(t * 2.1);
      for (let k = 0; k < N; k++) {
        const a = (k / N) * TAU - Math.PI / 2;
        let v = (Math.sin(a * 2 + t * 1.3) + Math.sin(a * 5 - t * 1.9) * 0.6 + Math.sin(a * 9 + t * 2.7) * 0.35) / 1.95;
        v = v * 0.5 + 0.5;
        let boost = 0;
        if (mouse.in) {
          let d = Math.abs(a - mouse.a); d = Math.min(d, TAU - d);
          boost = Math.exp(-d * d / 0.18) * 0.9;
        }
        if (active >= 0) boost += 0.25;
        const len = R * (0.1 + 0.46 * v * breathe * (1 + boost));
        const c = colorAt(k).map((x, i) => lerp(x, tint[i], tintAmt * 0.6));
        ctx.strokeStyle = `rgba(${c.map(Math.round).join(',')},0.9)`;
        const ca = Math.cos(a), sa = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(cx + ca * (R - len * 0.28), cy + sa * (R - len * 0.28));
        ctx.lineTo(cx + ca * (R + len), cy + sa * (R + len));
        ctx.stroke();
      }
      ctx.restore();

      // glass ring and dark centre
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, 0, TAU);
      const gc = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, 0, cx, cy, R * 0.9);
      gc.addColorStop(0, 'rgba(24,34,70,0.95)'); gc.addColorStop(1, 'rgba(5,11,26,0.97)');
      ctx.fillStyle = gc; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();

      // a tiny waveform inside the centre
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineWidth = Math.max(3, W * 0.008);
      const bars = 9, bw = R * 0.15;
      for (let i = 0; i < bars; i++) {
        const x = cx + (i - (bars - 1) / 2) * bw;
        const h = R * (0.1 + 0.34 * (0.5 + 0.5 * Math.sin(t * 3.2 + i * 0.9)) * (1 - Math.abs(i - 4) / 6));
        ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.4 * (h / (R * 0.44))})`;
        ctx.beginPath(); ctx.moveTo(x, cy - h); ctx.lineTo(x, cy + h); ctx.stroke();
      }
      ctx.restore();

      // orbiting services
      const cT = Math.cos(tilt), sT = Math.sin(tilt);
      nodes.forEach((n, i) => {
        const th = rot * TAU * 0.5 + (i * TAU) / 5;
        const x = rx * Math.cos(th), y = ry * Math.sin(th);
        const X = cx + x * cT - y * sT, Y = cy + x * sT + y * cT;
        const depth = Math.sin(th); // +1 is the front of the ring
        const s = 0.84 + 0.2 * depth + (i === active ? 0.1 : 0);
        n.style.transform = `translate3d(${X.toFixed(1)}px,${Y.toFixed(1)}px,0) translate(-50%,-50%) scale(${s.toFixed(3)})`;
        n.style.opacity = (0.62 + 0.38 * (depth * 0.5 + 0.5)).toFixed(2);
        n.style.zIndex = depth > 0 ? 3 : 1;
      });
    }

    function loop(now) {
      if (visible) frame(now);
      requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener('resize', resize);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) last = 0; }, { threshold: 0 }).observe(stage);
    }
    if (reduce) { frame(0); setActive(0); } else { idleAt = performance.now() + 1800; requestAnimationFrame(loop); }
  }

  /* -------------------------------------------------- 2. the turn (scroll) */
  function initTurn() {
    const sec = $('#turn');
    if (!sec) return;
    const stick = $('.sx-turn-stick', sec);
    const light = $('.sx-turn-light', sec);
    let ticking = false;

    function update() {
      ticking = false;
      const rect = sec.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const p = clamp(-rect.top / total);
      const r = ease(clamp(p / 0.62)) * 76;
      const tt = clamp((p - 0.4) / 0.28);
      stick.style.setProperty('--p', p.toFixed(4));
      light.style.setProperty('--r', r.toFixed(2) + '%');
      light.style.setProperty('--t', tt.toFixed(3));
      // the shared header follows the section behind it
      sec.dataset.theme = p > 0.58 ? 'light' : 'dark';
    }
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  /* ------------------------------------------------------------- 3. cards */
  function initCards() {
    const cards = $$('.sx-card');
    if ('IntersectionObserver' in window && !reduce) {
      const io = new IntersectionObserver((es) => {
        es.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target, i = cards.indexOf(el) % 3;
          el.style.transitionDelay = (i * 110) + 'ms';
          el.classList.add('in');
          setTimeout(() => { el.style.transitionDelay = ''; }, 1100);
          io.unobserve(el);
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
      cards.forEach((c) => io.observe(c));
    } else {
      cards.forEach((c) => c.classList.add('in'));
    }

    if (reduce || !fine) return;
    cards.forEach((c) => {
      c.addEventListener('pointermove', (e) => {
        const r = c.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        c.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        c.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        c.style.setProperty('--ry', ((px - 0.5) * 9).toFixed(2) + 'deg');
        c.style.setProperty('--rx', (-(py - 0.5) * 7).toFixed(2) + 'deg');
      });
      c.addEventListener('pointerleave', () => {
        c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg');
      });
    });
  }

  initOrb();
  initTurn();
  initCards();
})();
