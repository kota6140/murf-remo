/**
 * TakeRemo — ENTERPRISE AI EMPLOYEE PLATFORM
 * Core Interactivity, Preserved Hero 3D Parallax & Telemetry,
 * Live 60-Second Interactive Calling Demo, Sticky Scroll-Driven Storytelling Stack,
 * Industry Switcher, & Modal Handlers
 */

document.addEventListener('DOMContentLoaded', () => {

  // ------------------------------------------------------------------------
  // A. PRESERVED HERO: DYNAMIC PHONE CLOCK & TELEMETRY TIMER
  // ------------------------------------------------------------------------
  const phoneClock = document.getElementById('phone-clock');
  const updatePhoneClock = () => {
    if (!phoneClock) return;
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    phoneClock.textContent = `${hours}:${minutes}`;
  };
  updatePhoneClock();
  setInterval(updatePhoneClock, 60000);

  // Hero Floating Mini Telemetry Timer
  const heroTelemetryTimer = document.getElementById('hero-telemetry-timer');
  let miniSeconds = 268; // 04:28
  if (heroTelemetryTimer) {
    setInterval(() => {
      miniSeconds++;
      const m = String(Math.floor(miniSeconds / 60)).padStart(2, '0');
      const s = String(miniSeconds % 60).padStart(2, '0');
      heroTelemetryTimer.textContent = `${m}:${s}`;
    }, 1000);
  }

  // ------------------------------------------------------------------------
  // B. PRESERVED HERO: LEVEL MOUSE HOVER PARALLAX
  // ------------------------------------------------------------------------
  const heroStage = document.getElementById('hero-phone-stage');
  const phone3d = document.getElementById('phone-3d');

  if (heroStage && phone3d && window.innerWidth > 992) {
    heroStage.addEventListener('mousemove', (e) => {
      const rect = heroStage.getBoundingClientRect();
      const y = e.clientY - rect.top - rect.height / 2;
      const hoverOffset = -(y / (rect.height / 2)) * 8;
      phone3d.style.transform = `translateY(${hoverOffset.toFixed(1)}px)`;
    });

    heroStage.addEventListener('mouseleave', () => {
      phone3d.style.transform = 'translateY(0)';
    });
  }

  // ------------------------------------------------------------------------
  // C. PRESERVED HERO: LIVE AI VOICE CALLING ANIMATION CYCLE
  // ------------------------------------------------------------------------
  const liveCallTimer = document.getElementById('live-call-timer');
  const speakerBadge = document.getElementById('voice-speaker-badge');
  const speakerLabel = document.getElementById('speaker-state-label');
  const trLine2 = document.getElementById('tr-line-2');
  const trText1 = document.getElementById('tr-text-1');
  const trText2 = document.getElementById('tr-text-2');

  const valExp = document.getElementById('val-exp');
  const valSkills = document.getElementById('val-skills');
  const valLoc = document.getElementById('val-loc');
  const valNotice = document.getElementById('val-notice');
  const valCtc = document.getElementById('val-ctc');

  const matchPercent = document.getElementById('match-percent');
  const darkQualCard = document.getElementById('dark-qual-card');

  const chipExp = document.getElementById('chip-exp');
  const chipSkills = document.getElementById('chip-skills');
  const chipLoc = document.getElementById('chip-loc');
  const chipAvail = document.getElementById('chip-avail');

  let callSeconds = 134; // 02:14

  if (liveCallTimer) {
    setInterval(() => {
      callSeconds++;
      const mins = String(Math.floor(callSeconds / 60)).padStart(2, '0');
      const secs = String(callSeconds % 60).padStart(2, '0');
      liveCallTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  // Design 5 Hero Command Center: Live Call Timer (02:38+)
  const callTimerDisplay = document.getElementById('call-timer-display');
  let design5Secs = 158; // 02:38
  if (callTimerDisplay) {
    setInterval(() => {
      design5Secs++;
      const m = String(Math.floor(design5Secs / 60)).padStart(2, '0');
      const s = String(design5Secs % 60).padStart(2, '0');
      callTimerDisplay.textContent = `${m}:${s}`;
    }, 1000);
  }

  // Design 5 Hero Phone Controls
  const liveMuteBtn = document.getElementById('live-mute-btn');
  if (liveMuteBtn) {
    liveMuteBtn.addEventListener('click', () => {
      liveMuteBtn.classList.toggle('active');
    });
  }

  const runLiveCallCycle = () => {
    // Stage 1: Reset to Remo Speaking
    if (speakerLabel) speakerLabel.textContent = '● AI SPEAKING';
    if (speakerBadge) {
      speakerBadge.style.background = 'rgba(37, 99, 235, 0.2)';
      speakerBadge.style.borderColor = 'rgba(96, 165, 250, 0.4)';
    }

    if (trText1) trText1.textContent = '"Hi Rahul, I\'m Remo from the recruitment team. Is this a good time to speak for a few minutes?"';
    if (trText2) trText2.textContent = '"Yes, sure."';

    // Stage 2: Candidate answers & Remo listens
    setTimeout(() => {
      if (speakerLabel) speakerLabel.textContent = '● LISTENING';
      if (speakerBadge) {
        speakerBadge.style.background = 'rgba(56, 189, 248, 0.25)';
        speakerBadge.style.borderColor = 'rgba(147, 197, 253, 0.5)';
      }

      if (trText1) trText1.textContent = '"Great. Could you tell me how many years of relevant development experience you have?"';
      if (trText2) trText2.textContent = '"I have around 3 years in React and Node.js."';
    }, 4200);

    // Stage 3: Extraction
    setTimeout(() => {
      setTimeout(() => {
        if (valExp) { valExp.className = 'ext-val ext-verified'; valExp.textContent = '3 Years ✓'; }
        if (chipExp) chipExp.classList.add('chip-active');
      }, 500);

      setTimeout(() => {
        if (valSkills) { valSkills.className = 'ext-val ext-verified'; valSkills.textContent = 'React • Node.js ✓'; }
        if (chipSkills) chipSkills.classList.add('chip-active');
      }, 1200);

      setTimeout(() => {
        if (valLoc) { valLoc.className = 'ext-val ext-verified'; valLoc.textContent = 'Hyderabad ✓'; }
        if (chipLoc) chipLoc.classList.add('chip-active');
      }, 1900);

      setTimeout(() => {
        if (valNotice) { valNotice.className = 'ext-val ext-verified'; valNotice.textContent = '30 Days ✓'; }
      }, 2600);

      setTimeout(() => {
        if (valCtc) { valCtc.className = 'ext-val ext-verified'; valCtc.textContent = '₹8.5 LPA ✓'; }
        if (chipAvail) chipAvail.classList.add('chip-active');
      }, 3300);
    }, 7800);

    // Stage 4: Qualification
    setTimeout(() => {
      if (matchPercent) {
        let p = 72;
        const rollScore = setInterval(() => {
          p += 4;
          if (p >= 92) {
            p = 92;
            clearInterval(rollScore);
          }
          matchPercent.textContent = `${p}%`;
        }, 60);
      }

      if (darkQualCard) darkQualCard.classList.add('qual-active');
    }, 12500);

    // Stage 5: Loop cycle
    setTimeout(runLiveCallCycle, 17500);
  };

  runLiveCallCycle();

  // ------------------------------------------------------------------------
  // C2. HERO VOICE ORBIT: scripted live-call story inside the phone
  //     (word-by-word captions, orb state, stage tracker, data capture, fit score, booking badge)
  // ------------------------------------------------------------------------
  (() => {
    const orbStage = document.getElementById('rp-orb-stage');
    const capBox = document.querySelector('.rp-captions');
    const capWho = document.getElementById('rp-cap-who');
    const capText = document.getElementById('rp-cap-text');
    const stateLabel = document.getElementById('rp-state-label');
    const stageItems = document.querySelectorAll('#rp-stages li');
    const chips = document.querySelectorAll('.rp-chip');
    const fitFill = document.getElementById('rp-fit-fill');
    const fitNum = document.getElementById('rp-fit-num');
    if (!orbStage || !capText) return;

    const FIT = 92;
    const story = [
      { who: 'Remo', text: 'Hi Rahul, this is Remo from the TakeRemo hiring team. Is now a good time for a quick chat?', stage: 0 },
      { who: 'Rahul', text: 'Yes, sure. Go ahead.', stage: 0 },
      { who: 'Remo', text: 'Great! How many years have you worked with React and Node?', stage: 1 },
      { who: 'Rahul', text: 'Around three years, mostly building dashboards.', stage: 1, capture: ['exp', 'skills'] },
      { who: 'Remo', text: 'Lovely. And what are your expected CTC and notice period?', stage: 2 },
      { who: 'Rahul', text: 'About 8.5 LPA, and I can join in 30 days.', stage: 2, capture: ['ctc', 'notice'] },
      { who: 'Remo', text: 'Perfect. I have booked your interview for Tuesday at 4:30 PM.', stage: 3, final: true }
    ];

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const setStage = (n) => stageItems.forEach((li, i) => li.classList.toggle('on', i <= n));
    const setCaptured = (keys) => keys.forEach((k) => {
      const chip = document.querySelector(`.rp-chip[data-key="${k}"]`);
      if (chip) chip.classList.add('on');
    });
    const setFit = (v) => {
      if (fitFill) fitFill.style.width = v + '%';
      if (fitNum) fitNum.textContent = v ? v + '%' : '--';
    };

    const resetAll = () => {
      chips.forEach((c) => c.classList.remove('on'));
      setStage(0);
      setFit(0);
    };

    const showLine = (line, instant) => {
      const speaking = line.who === 'Remo';
      orbStage.dataset.state = speaking ? 'speaking' : 'listening';
      if (stateLabel) stateLabel.textContent = speaking ? 'Remo is speaking' : 'Listening to Rahul';
      if (capBox) capBox.classList.toggle('is-caller', !speaking);
      if (capWho) capWho.textContent = line.who;

      capText.textContent = '';
      const words = line.text.split(' ').map((w) => {
        const s = document.createElement('span');
        s.className = 'w' + (instant ? ' on' : '');
        s.textContent = w + ' ';
        capText.appendChild(s);
        return s;
      });
      return words;
    };

    // Reduced motion: show the finished call, no looping
    if (reduceMotion) {
      showLine(story[story.length - 1], true);
      setStage(3);
      setCaptured(['exp', 'skills', 'ctc', 'notice']);
      setFit(FIT);
      return;
    }

    const play = async () => {
      resetAll();
      await sleep(600);
      for (const line of story) {
        setStage(line.stage);
        const words = showLine(line, false);
        for (const w of words) {
          w.classList.add('on');
          await sleep(line.who === 'Remo' ? 105 : 130);
        }
        if (line.capture) {
          await sleep(350);
          setCaptured(line.capture);
        }
        if (line.final) {
          setFit(FIT);
        }
        await sleep(line.final ? 4200 : 1100);
      }
      play();
    };

    play();
  })();

  // ------------------------------------------------------------------------
  // C3. HERO BADGES: timed morphs
  //   0s  : Lead Generation, Instant Response are visible
  //   2s  : Lead Generation -> Lead Qualified, Instant Response -> Appointment Booked,
  //         Interview Booked badge appears (early)
  //   4s  : Interview Booked -> Interview Call
  //   7s  : everything resets to the first state and the whole round repeats (loop)
  // ------------------------------------------------------------------------
  (() => {
    const lead = document.getElementById('hero-banner-lead');
    const instant = document.getElementById('hero-banner-instant');
    const booking = document.getElementById('hero-banner-booking');
    if (!lead && !instant && !booking) return;

    const ICON = {
      check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FC2415" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
      calendarCheck: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FC2415" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><polyline points="9 16 11 18 15 14"></polyline></svg>',
      phone: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FC2415" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>'
    };

    const setContent = (badge, title, sub, icon) => {
      const t = badge.querySelector('.hfb-title');
      const s2 = badge.querySelector('.hfb-subtitle');
      const box = badge.querySelector('.hfb-icon-box');
      if (t) t.textContent = title;
      if (s2) s2.textContent = sub;
      if (box && icon) box.innerHTML = icon;
    };

    // fade the old text out, swap, fade the new text in, flash the badge
    const morph = (badge, title, sub, icon, instant) => {
      if (!badge) return;
      if (instant) { setContent(badge, title, sub, icon); return; }
      badge.classList.add('hfb-swap-out');
      setTimeout(() => {
        setContent(badge, title, sub, icon);
        badge.classList.remove('hfb-swap-out');
        badge.classList.add('hfb-swap-in', 'hfb-flash');
        setTimeout(() => badge.classList.remove('hfb-swap-in', 'hfb-flash'), 1000);
      }, 280);
    };

    const FIRST = {
      lead: ['LEAD GENERATION', 'Capturing new leads', null],
      instant: ['INSTANT RESPONSE', 'No waiting', null],
      booking: ['INTERVIEW BOOKED', 'Tue · 4:30 PM', null]
    };
    // original icons, saved so the loop can restore them
    const startIcons = {};
    [['lead', lead], ['instant', instant], ['booking', booking]].forEach(([k, el]) => {
      const box = el && el.querySelector('.hfb-icon-box');
      if (box) startIcons[k] = box.innerHTML;
    });

    // the interview badge stays on screen; only its text changes
    if (booking) booking.classList.add('on');

    // step 2 (2s): Lead Qualified, Appointment Booked, Interview Booked appears
    const stepTwo = (instantly) => {
      morph(lead, 'LEAD QUALIFIED', 'Ready for a demo', ICON.check, instantly);
      morph(instant, 'APPOINTMENT BOOKED', 'Tue · 4:30 PM', ICON.calendarCheck, instantly);
    };

    // step 3 (4s): Interview Booked -> Interview Call
    const stepThree = (instantly) => {
      morph(booking, 'INTERVIEW CALL', 'Remo is dialing…', ICON.phone, instantly);
    };

    // reset: everything goes back to its first state, ready for the next round
    const resetAll = () => {
      morph(lead, FIRST.lead[0], FIRST.lead[1], startIcons.lead, false);
      morph(instant, FIRST.instant[0], FIRST.instant[1], startIcons.instant, false);
      morph(booking, FIRST.booking[0], FIRST.booking[1], startIcons.booking, false);
    };

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      stepTwo(true);
      stepThree(true);
      return;
    }

    // one round = 7s: 2s Qualified/Booked, 4s Interview Call, 7s reset, then repeat
    const ROUND_MS = 7000;
    const runRound = () => {
      setTimeout(() => stepTwo(false), 2000);
      setTimeout(() => stepThree(false), 4000);
      setTimeout(resetAll, 6600);
    };
    runRound();
    setInterval(runRound, ROUND_MS);
  })();

  // ------------------------------------------------------------------------
  // D. PRESERVED HERO PARTICLES (DASHBOARD BLUE)
  // ------------------------------------------------------------------------
  const particlesContainer = document.getElementById('particles-container');
  if (particlesContainer) {
    const particleCount = 14;
    for (let i = 0; i < particleCount; i++) {
      const p = document.createElement('div');
      p.className = 'hero-particle';
      const size = Math.random() * 3 + 2;
      const top = Math.random() * 100;
      const left = Math.random() * 100;
      const delay = Math.random() * 4;
      const duration = Math.random() * 5 + 4;
      const isCyan = Math.random() > 0.5;

      p.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        background: ${isCyan ? '#38BDF8' : '#FC2415'};
        opacity: ${Math.random() * 0.35 + 0.18};
        border-radius: 50%;
        top: ${top}%;
        left: ${left}%;
        pointer-events: none;
        box-shadow: 0 0 10px ${isCyan ? '#38BDF8' : '#FC2415'};
        animation: floatParticle ${duration}s ease-in-out infinite ${delay}s alternate;
      `;
      particlesContainer.appendChild(p);
    }

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      @keyframes floatParticle {
        0% { transform: translateY(0px) scale(0.8); }
        100% { transform: translateY(-16px) scale(1.2); }
      }
    `;
    document.head.appendChild(styleEl);
  }

  // ------------------------------------------------------------------------
  // E. ✨ THE 60-SECOND TEST: INTERACTIVE PHONE CALL (DASHBOARD BLUE)
  // ------------------------------------------------------------------------
  const instantCallForm = document.getElementById('instant-call-form');
  const instantMobileInput = document.getElementById('instant-mobile-input');
  const instantTriggerBtn = document.getElementById('btn-instant-trigger');
  const instantCallStatusPill = document.getElementById('instant-call-status-pill');
  const incomingAcceptBtn = document.getElementById('incoming-demo-accept-btn');
  const declineCallBtn = document.querySelector('.btn-decline-call');
  const btnCancelDialing = document.getElementById('btn-cancel-dialing');

  const incomingDialingScreen = document.getElementById('incoming-dialing-screen');
  const incomingScreen = document.getElementById('incoming-ringing-screen');
  const inCallScreen = document.getElementById('in-call-screen');
  const callFinishedScreen = document.getElementById('call-finished-screen');

  const inCallTimer = document.getElementById('in-call-timer');
  const inCallDialogueText = document.getElementById('in-call-dialogue-text');
  const inCallExtText = document.getElementById('in-call-ext-text');
  const btnEndCall = document.getElementById('btn-end-demo-call');
  const btnRestartCall = document.getElementById('btn-restart-demo-call');
  const callerNumberEl = document.getElementById('incoming-caller-num-display');
  const dialingNumberEl = document.getElementById('dialing-number-display');

  let activeCallTimerInterval = null;
  let dialingTimeout = null;
  let inCallSeconds = 0;

  const showDialingAnimation = (customNumber) => {
    if (incomingScreen) incomingScreen.classList.add('hidden');
    if (inCallScreen) inCallScreen.classList.remove('active');
    if (callFinishedScreen) callFinishedScreen.classList.remove('active');
    if (incomingDialingScreen) incomingDialingScreen.classList.remove('hidden');

    const maskedCallerId = '+91 80 4719 XXXX';
    if (dialingNumberEl) dialingNumberEl.textContent = maskedCallerId;
    if (callerNumberEl) callerNumberEl.textContent = maskedCallerId;

    if (instantCallStatusPill) {
      instantCallStatusPill.innerHTML = `
        <span class="live-dot-pulse pulse-blue"></span>
        <span>Dialing... Connecting via carrier interconnect to your device</span>
      `;
      instantCallStatusPill.style.background = '#EFF6FF';
      instantCallStatusPill.style.borderColor = '#BFDBFE';
      instantCallStatusPill.style.color = '#031740';
    }

    if (dialingTimeout) clearTimeout(dialingTimeout);
    dialingTimeout = setTimeout(() => {
      transitionDialingToRinging();
    }, 1800);
  };

  const transitionDialingToRinging = () => {
    if (incomingDialingScreen) incomingDialingScreen.classList.add('hidden');
    if (incomingScreen) incomingScreen.classList.remove('hidden');

    if (instantCallStatusPill) {
      instantCallStatusPill.innerHTML = `
        <span class="live-dot-pulse pulse-blue"></span>
        <span>Ringing your phone... Tap "Accept" or pick up!</span>
      `;
    }

    const phoneCard = document.querySelector('.incoming-smartphone-card');
    if (phoneCard) {
      phoneCard.style.animation = 'shakePhone 0.6s ease infinite';
    }
  };

  const cancelDialing = () => {
    if (dialingTimeout) clearTimeout(dialingTimeout);
    if (incomingDialingScreen) incomingDialingScreen.classList.add('hidden');
    if (incomingScreen) incomingScreen.classList.remove('hidden');

    const phoneCard = document.querySelector('.incoming-smartphone-card');
    if (phoneCard) phoneCard.style.animation = 'none';

    if (instantCallStatusPill) {
      instantCallStatusPill.innerHTML = `
        <span class="pulse-dot-blue" style="width:6px;height:6px;"></span>
        <span>Dialing cancelled. Enter a number or tap Accept to test again.</span>
      `;
      instantCallStatusPill.style.background = '#F8FAFC';
      instantCallStatusPill.style.borderColor = '#E2E8F0';
      instantCallStatusPill.style.color = '#475569';
    }
  };

  const startActiveCallExperience = (customNumber) => {
    if (dialingTimeout) clearTimeout(dialingTimeout);
    if (incomingDialingScreen) incomingDialingScreen.classList.add('hidden');
    if (incomingScreen) incomingScreen.classList.add('hidden');
    if (callFinishedScreen) callFinishedScreen.classList.remove('active');
    if (inCallScreen) inCallScreen.classList.add('active');

    const phoneCard = document.querySelector('.incoming-smartphone-card');
    if (phoneCard) phoneCard.style.animation = 'none';

    if (instantCallStatusPill) {
      instantCallStatusPill.innerHTML = `
        <span class="pulse-dot-blue" style="width:6px;height:6px;"></span>
        <span>Call Connected: Remo is speaking with you live</span>
      `;
      instantCallStatusPill.style.background = '#EFF6FF';
      instantCallStatusPill.style.borderColor = '#BFDBFE';
      instantCallStatusPill.style.color = '#031740';
    }

    inCallSeconds = 0;
    if (inCallTimer) inCallTimer.textContent = '00:00';
    if (activeCallTimerInterval) clearInterval(activeCallTimerInterval);
    activeCallTimerInterval = setInterval(() => {
      inCallSeconds++;
      const m = String(Math.floor(inCallSeconds / 60)).padStart(2, '0');
      const s = String(inCallSeconds % 60).padStart(2, '0');
      if (inCallTimer) inCallTimer.textContent = `${m}:${s}`;
    }, 1000);

    if (inCallDialogueText) {
      inCallDialogueText.textContent = '"Hello! I\'m Remo, your AI employee. I can screen candidates, call sales leads, or resolve customer tickets. Which workflow would you like to test right now?"';
    }
    if (inCallExtText) {
      inCallExtText.innerHTML = '<span class="pulse-dot-green" style="display:inline-block;vertical-align:middle;margin-right:5px;"></span> Live NER: Call answered in 0.3s · HD Voice interconnected';
    }
  };

  const endActiveCallExperience = () => {
    if (dialingTimeout) clearTimeout(dialingTimeout);
    if (activeCallTimerInterval) clearInterval(activeCallTimerInterval);
    if (inCallScreen) inCallScreen.classList.remove('active');
    if (incomingDialingScreen) incomingDialingScreen.classList.add('hidden');
    if (incomingScreen) incomingScreen.classList.add('hidden');
    if (callFinishedScreen) callFinishedScreen.classList.add('active');

    const durationStr = inCallTimer ? inCallTimer.textContent : '00:38';
    const finishedDuration = document.getElementById('finished-call-duration');
    if (finishedDuration) finishedDuration.textContent = durationStr;

    if (instantCallStatusPill) {
      instantCallStatusPill.innerHTML = `
        <span class="check-emerald" style="color:#FC2415;font-weight:800;">✓</span>
        <span>Call Completed · Notes saved & workflows triggered</span>
      `;
      instantCallStatusPill.style.background = '#FFFFFF';
      instantCallStatusPill.style.borderColor = '#E2E8F0';
      instantCallStatusPill.style.color = '#0F172A';
    }
  };

  const resetCallToIncoming = () => {
    if (dialingTimeout) clearTimeout(dialingTimeout);
    if (activeCallTimerInterval) clearInterval(activeCallTimerInterval);
    if (callFinishedScreen) callFinishedScreen.classList.remove('active');
    if (inCallScreen) inCallScreen.classList.remove('active');
    if (incomingDialingScreen) incomingDialingScreen.classList.add('hidden');
    if (incomingScreen) incomingScreen.classList.remove('hidden');

    if (callerNumberEl) callerNumberEl.textContent = '+91 80 4719 XXXX';
    if (dialingNumberEl) dialingNumberEl.textContent = '+91 80 4719 XXXX';

    if (instantCallStatusPill) {
      instantCallStatusPill.innerHTML = `
        <span class="pulse-dot-blue" style="width:6px;height:6px;"></span>
        <span>Ready to dial — instant call simulation</span>
      `;
      instantCallStatusPill.style.background = '#F8FAFC';
      instantCallStatusPill.style.borderColor = '#E2E8F0';
      instantCallStatusPill.style.color = '#475569';
    }
  };

  const instantCallFeedback = document.getElementById('instant-call-feedback');

  const showInstantFeedback = (text, type = 'info') => {
    if (!instantCallFeedback) return;
    instantCallFeedback.style.display = 'block';
    if (type === 'error') {
      instantCallFeedback.style.background = '#FEF2F2';
      instantCallFeedback.style.borderColor = '#FCA5A5';
      instantCallFeedback.style.color = '#B91C1C';
      instantCallFeedback.style.border = '1px solid #FCA5A5';
      instantCallFeedback.innerHTML = `⚠️ ${text}`;
    } else if (type === 'success') {
      instantCallFeedback.style.background = '#F0FDF4';
      instantCallFeedback.style.borderColor = '#86EFAC';
      instantCallFeedback.style.color = '#15803D';
      instantCallFeedback.style.border = '1px solid #86EFAC';
      instantCallFeedback.innerHTML = `✓ ${text}`;
    } else {
      instantCallFeedback.style.background = '#EFF6FF';
      instantCallFeedback.style.borderColor = '#BFDBFE';
      instantCallFeedback.style.color = '#1E40AF';
      instantCallFeedback.style.border = '1px solid #BFDBFE';
      instantCallFeedback.innerHTML = `ℹ️ ${text}`;
    }
  };

  let activeDemoPollingInterval = null;

  const pollDemoCallStatus = (callUuid) => {
    if (activeDemoPollingInterval) clearInterval(activeDemoPollingInterval);
    let polls = 0;
    activeDemoPollingInterval = setInterval(async () => {
      polls++;
      if (polls > 35) { // Max ~70 seconds of polling
        clearInterval(activeDemoPollingInterval);
        return;
      }
      try {
        const res = await fetch(`/api/demo/instant-status/${encodeURIComponent(callUuid)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data || !data.success) return;
        const status = (data.status || '').toLowerCase();
        if (status === 'in-progress' || status === 'answered') {
          showInstantFeedback('Call Connected: Remo is speaking live with you!', 'info');
          if (instantCallStatusPill) {
            instantCallStatusPill.innerHTML = `
              <span class="live-dot-pulse pulse-blue"></span>
              <span>Call Connected · Remo is delivering TakeRemo promotional demo live</span>
            `;
          }
        } else if (status === 'completed') {
          clearInterval(activeDemoPollingInterval);
          showInstantFeedback('Call Completed: Thank you for trying TakeRemo!', 'success');
          endActiveCallExperience();
        } else if (status === 'unanswered' || status === 'busy') {
          clearInterval(activeDemoPollingInterval);
          showInstantFeedback('Call Unanswered: The line was busy or not answered. Please try again.', 'error');
          cancelDialing();
        } else if (status === 'failed') {
          clearInterval(activeDemoPollingInterval);
          showInstantFeedback('Call Failed: Telephony carrier reported a connection failure.', 'error');
          cancelDialing();
        }
      } catch (pollErr) {
        // Non-fatal polling error
      }
    }, 2000);
  };

  // Instant call needs a signed-in visitor: send everyone else to sign in, then back to this section.
  const INSTANT_CALL_RETURN = '/#instant-call-demo';
  let instantLoggedIn = null; // null until /api/auth/me answers
  const sendToLoginForInstantCall = () => {
    showInstantFeedback('Please log in first to get your instant call. Taking you to sign in…', 'info');
    setTimeout(() => {
      window.location.href = `/signin?next=${encodeURIComponent(INSTANT_CALL_RETURN)}`;
    }, 900);
  };

  if (instantCallForm && instantMobileInput) {
    fetch('/api/auth/me', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then((r) => { instantLoggedIn = r.ok; })
      .catch(() => { /* unknown: the server still checks */ });

    // The click comes before the browser's own form validation, so a logged-out visitor is sent to sign in
    // even with an empty number.
    instantTriggerBtn.addEventListener('click', (e) => {
      if (instantLoggedIn === false) {
        e.preventDefault();
        sendToLoginForInstantCall();
      }
    });

    instantCallForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (instantTriggerBtn.disabled) return;
      if (instantLoggedIn === false) return sendToLoginForInstantCall();

      const rawNum = instantMobileInput.value.trim();
      const cleanDigits = rawNum.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');

      // 1. Validate mobile number
      if (!/^[6-9]\d{9}$/.test(cleanDigits)) {
        showInstantFeedback('Please enter a valid 10-digit Indian mobile number (e.g., 9876543210).', 'error');
        instantMobileInput.focus();
        return;
      }

      // 2. Prevent multiple simultaneous submissions & show "Connecting..." loading state
      const origBtnContent = instantTriggerBtn.innerHTML;
      instantTriggerBtn.disabled = true;
      instantTriggerBtn.innerHTML = `
        <span class="c-spinner" style="width:14px;height:14px;flex:none;border:2px solid #ffffff;border-top-color:transparent;border-radius:50%;display:inline-block;animation:spin 0.6s linear infinite;margin-right:6px;"></span>
        <span>Connecting...</span>
      `;

      showInstantFeedback('Connecting to carrier network and dispatching call...', 'info');

      try {
        const response = await fetch('/api/demo/instant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: cleanDigits })
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
          // Session missing or expired
          instantLoggedIn = false;
          instantTriggerBtn.innerHTML = origBtnContent;
          instantTriggerBtn.disabled = false;
          return sendToLoginForInstantCall();
        }

        if (response.ok && data.success) {
          showInstantFeedback(data.message || 'Call initiated! Your phone will ring in a few seconds.', 'success');
          showDialingAnimation(cleanDigits);

          // Poll carrier status
          if (data.callUuid) {
            pollDemoCallStatus(data.callUuid);
          }

          // Keep button disabled briefly to avoid rapid re-dialing, then restore
          setTimeout(() => {
            instantTriggerBtn.innerHTML = origBtnContent;
            instantTriggerBtn.disabled = false;
          }, 15000);
        } else {
          showInstantFeedback(data.message || 'Unable to place call at this moment. Please check your number and try again.', 'error');
          instantTriggerBtn.innerHTML = origBtnContent;
          instantTriggerBtn.disabled = false;
        }
      } catch (networkErr) {
        showInstantFeedback('Network connection error. Please try again.', 'error');
        instantTriggerBtn.innerHTML = origBtnContent;
        instantTriggerBtn.disabled = false;
      }
    });
  }

  if (btnCancelDialing) {
    btnCancelDialing.addEventListener('click', cancelDialing);
  }

  if (incomingAcceptBtn) {
    incomingAcceptBtn.addEventListener('click', () => {
      playHumanChime('connect');
      startActiveCallExperience('Direct Accept');
    });
  }

  if (declineCallBtn) {
    declineCallBtn.addEventListener('click', () => {
      if (dialingTimeout) clearTimeout(dialingTimeout);
      const phoneCard = document.querySelector('.incoming-smartphone-card');
      if (phoneCard) phoneCard.style.animation = 'none';
      if (instantCallStatusPill) {
        instantCallStatusPill.innerHTML = `<span>Call Declined. Submit a number above to try again.</span>`;
      }
    });
  }

  if (btnEndCall) btnEndCall.addEventListener('click', endActiveCallExperience);
  if (btnRestartCall) btnRestartCall.addEventListener('click', resetCallToIncoming);

  // Interactive Quick Query Chips for Visitor with sound & natural conversational typing
  const quickChips = document.querySelectorAll('.in-call-chip-btn');
  quickChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const topic = chip.getAttribute('data-topic');
      if (!inCallDialogueText) return;
      playHumanChime('click');
      quickChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      if (topic === 'recruitment') {
        inCallDialogueText.innerHTML = '<strong>Candidate Screening:</strong> "When a candidate applies, I call them within 30 seconds, introduce our company warmly, ask your exact screening questions, verify their notice period, and shortlist them straight into your ATS."';
        if (inCallExtText) {
          inCallExtText.innerHTML = '<span class="pulse-dot-green" style="display:inline-block;vertical-align:middle;margin-right:5px;"></span> Extracted: 4 Yrs Exp · 30 Days Notice · Candidate Receptive · Shortlisted';
        }
      } else if (topic === 'sales') {
        inCallDialogueText.innerHTML = '<strong>Sales Qualification:</strong> "I call inbound leads the second they submit a form, ask consultative questions about their budget and team size, and book qualified buyers straight onto your calendar."';
        if (inCallExtText) {
          inCallExtText.innerHTML = '<span class="pulse-dot-green" style="display:inline-block;vertical-align:middle;margin-right:5px;"></span> Extracted: 60 Leads/day · Urgent Need · Budget High · Demo Booked for 3 PM';
        }
      } else if (topic === 'support') {
        inCallDialogueText.innerHTML = '<strong>Customer Support:</strong> "I pick up customer calls 24/7 with zero waiting time, reassure anxious buyers, resolve delivery and order questions, and send tracking links directly to WhatsApp."';
        if (inCallExtText) {
          inCallExtText.innerHTML = '<span class="pulse-dot-green" style="display:inline-block;vertical-align:middle;margin-right:5px;"></span> Extracted: Order #8492 Located · Tracking Dispatched · Ticket Closed Successfully';
        }
      }
    });
  });

  // ------------------------------------------------------------------------
  // HUMAN TOUCH AUDIO & SYNTH ENGINE (Web Audio API + SpeechSynthesis)
  // ------------------------------------------------------------------------
  let audioCtx = null;
  let isSoundEnabled = localStorage.getItem('takeremo_sound_fx') !== 'false';

  const getAudioContext = () => {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  };

  function playHumanChime(type = 'click') {
    if (!isSoundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      if (type === 'click') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.04);
      } else if (type === 'connect') {
        // Warm 3-tone harmonic chime (C5, E5, G5)
        [523.25, 659.25, 783.99].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.07);
          gain.gain.setValueAtTime(0.08, now + idx * 0.07);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.28);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.07);
          osc.stop(now + idx * 0.07 + 0.3);
        });
      } else if (type === 'ring') {
        [0, 0.12].forEach((offset) => {
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const gain = ctx.createGain();
          osc1.frequency.setValueAtTime(440, now + offset);
          osc2.frequency.setValueAtTime(480, now + offset);
          gain.gain.setValueAtTime(0.05, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.09);
          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(ctx.destination);
          osc1.start(now + offset);
          osc2.start(now + offset);
          osc1.stop(now + offset + 0.1);
          osc2.stop(now + offset + 0.1);
        });
      }
    } catch (e) {
      // Audio graceful fallback
    }
  };

  // Sound Toggle Handlers
  const btnSoundToggle = document.getElementById('btn-sound-toggle');
  const soundIconOn = document.getElementById('sound-icon-on');
  const soundIconOff = document.getElementById('sound-icon-off');

  const updateSoundUI = () => {
    if (!btnSoundToggle) return;
    if (isSoundEnabled) {
      btnSoundToggle.classList.remove('muted');
      if (soundIconOn) soundIconOn.style.display = 'block';
      if (soundIconOff) soundIconOff.style.display = 'none';
      btnSoundToggle.title = 'Sound FX: On (Click to mute)';
    } else {
      btnSoundToggle.classList.add('muted');
      if (soundIconOn) soundIconOn.style.display = 'none';
      if (soundIconOff) soundIconOff.style.display = 'block';
      btnSoundToggle.title = 'Sound FX: Off (Click to unmute)';
    }
  };
  updateSoundUI();

  if (btnSoundToggle) {
    btnSoundToggle.addEventListener('click', () => {
      isSoundEnabled = !isSoundEnabled;
      localStorage.setItem('takeremo_sound_fx', isSoundEnabled ? 'true' : 'false');
      updateSoundUI();
      if (isSoundEnabled) playHumanChime('connect');
    });
  }

  // Hero Voice Sample Preview Player
  const btnHeroVoiceSample = document.getElementById('btn-hero-voice-sample');
  const heroVoiceVisualizer = document.getElementById('hero-voice-visualizer');
  const heroVoiceBtnText = document.getElementById('hero-voice-btn-text');
  const heroVoicePlayIcon = document.getElementById('hero-voice-play-icon');
  let isVoicePlaying = false;
  let voiceSampleTimer = null;
  // The hero sample is a female Murf voice recorded once into /assets/voices/hero.wav
  let heroVoiceAudio = null;

  const stopHeroVoiceSample = () => {
    if (voiceSampleTimer) clearTimeout(voiceSampleTimer);
    if (heroVoiceAudio) {
      heroVoiceAudio.onended = null;
      heroVoiceAudio.onerror = null;
      heroVoiceAudio.pause();
      heroVoiceAudio = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    isVoicePlaying = false;
    if (heroVoiceVisualizer) heroVoiceVisualizer.classList.remove('playing');
    if (heroVoiceBtnText) heroVoiceBtnText.textContent = "Hear Remo's Real Voice";
    if (heroVoicePlayIcon) {
      heroVoicePlayIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    }
  };

  if (btnHeroVoiceSample) {
    btnHeroVoiceSample.addEventListener('click', () => {
      if (isVoicePlaying) {
        stopHeroVoiceSample();
        return;
      }

      isVoicePlaying = true;
      playHumanChime('connect');
      if (heroVoiceVisualizer) heroVoiceVisualizer.classList.add('playing');
      if (heroVoiceBtnText) heroVoiceBtnText.textContent = "Playing Voice Sample...";
      if (heroVoicePlayIcon) {
        heroVoicePlayIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
      }

      // Browser voice, used only if the recorded clip cannot play (female voice preferred)
      const speakWithBrowserVoice = () => {
        if (!('speechSynthesis' in window)) {
          voiceSampleTimer = setTimeout(stopHeroVoiceSample, 5000);
          return;
        }
        window.speechSynthesis.cancel();
        const text = "Hello! I am Remo, your AI employee. I speak with natural cadence, listen without interrupting, and handle your calls with real human warmth.";
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 0.96;
        utter.pitch = 1.04;
        const voices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
        const female = voices.find(v => /Samantha|Zira|Aria|Jenny|Karen|Moira|Tessa|Veena|Heera|Female/i.test(v.name)) || voices.find(v => /Google|Natural/i.test(v.name));
        if (female) utter.voice = female;
        utter.onend = () => stopHeroVoiceSample();
        utter.onerror = () => stopHeroVoiceSample();
        window.speechSynthesis.speak(utter);
        voiceSampleTimer = setTimeout(stopHeroVoiceSample, 12000);
      };

      try {
        heroVoiceAudio = new Audio('/assets/voices/hero.wav');
        heroVoiceAudio.onended = () => stopHeroVoiceSample();
        heroVoiceAudio.onerror = () => { stopHeroVoiceSample(); };
        const started = heroVoiceAudio.play();
        if (started && started.catch) {
          started.catch(() => {
            // Blocked or missing file: fall back to the browser voice
            heroVoiceAudio = null;
            if (isVoicePlaying) speakWithBrowserVoice();
          });
        }
        // Safety stop in case the clip never ends
        voiceSampleTimer = setTimeout(stopHeroVoiceSample, 15000);
      } catch (_) {
        heroVoiceAudio = null;
        speakWithBrowserVoice();
      }
    });
  }

  // ------------------------------------------------------------------------
  // WELCOME VOICE: "Hey, welcome to Remo" in a female voice when someone opens the home page, and again whenever
  // the page is refreshed (a hard refresh counts as a refresh: browsers cannot tell the two apart). Opening the page
  // again by a link inside the same tab session stays quiet, and so does the Back button.
  // Browsers refuse sound that nobody asked for, so it is tried at once and, if the browser says no, it plays on the
  // visitor's first tap, click or key press. It is marked as played only when it really started, so a blocked
  // attempt is not lost. Clip: /assets/voices/welcome.wav; without it the browser's own female voice says the words.
  // Turned off with the same sound switch as the other page sounds.
  (function welcomeVoiceOnce() {
    if (!document.getElementById('btn-hero-voice-sample')) return; // home page only
    const PLAYED_KEY = 'takeremo_welcome_played';
    const WELCOME_TEXT = 'Hey, welcome to Remo.';
    const storeIn = (kind) => ({
      get: (k) => { try { return window[kind].getItem(k); } catch (e) { return null; } },
      set: (k, v) => { try { window[kind].setItem(k, v); } catch (e) { /* storage unavailable */ } }
    });
    const store = storeIn('localStorage');   // the sound switch, shared with the other page sounds
    const session = storeIn('sessionStorage'); // played in this tab already? (survives a refresh)
    if (store.get('takeremo_sound_fx') === 'false') return;

    // How this page was reached: 'navigate' (typed, link), 'reload' (refresh or hard refresh), 'back_forward'.
    let navType = 'navigate';
    try {
      const entry = window.performance.getEntriesByType('navigation')[0];
      if (entry && entry.type) navType = entry.type;
      else if (window.performance.navigation && window.performance.navigation.type === 1) navType = 'reload';
    } catch (e) { /* keep 'navigate' */ }
    if (navType === 'back_forward') return;
    if (navType === 'navigate' && session.get(PLAYED_KEY) === 'yes') return;

    let done = false;
    const markPlayed = () => { done = true; session.set(PLAYED_KEY, 'yes'); };

    const speakWithBrowserVoice = () => {
      if (!('speechSynthesis' in window)) return false;
      const utter = new SpeechSynthesisUtterance(WELCOME_TEXT);
      utter.rate = 0.96;
      utter.pitch = 1.04;
      const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
      const female = voices.find((v) => /Samantha|Zira|Aria|Jenny|Karen|Moira|Tessa|Veena|Heera|Female/i.test(v.name)) || voices.find((v) => /Google|Natural/i.test(v.name));
      if (female) utter.voice = female;
      window.speechSynthesis.speak(utter);
      markPlayed();
      return true;
    };

    const clip = new Audio('/assets/voices/welcome.wav');
    clip.preload = 'auto';
    let clipMissing = false;
    clip.addEventListener('error', () => { clipMissing = true; });

    const detach = () => {
      ['pointerdown', 'keydown', 'touchstart', 'click'].forEach((ev) => window.removeEventListener(ev, onGesture, true));
    };
    const attempt = (fromGesture) => {
      if (done) return;
      if (clipMissing) { if (fromGesture && speakWithBrowserVoice()) detach(); return; }
      let started;
      try { started = clip.play(); } catch (e) { started = null; }
      if (started && started.then) {
        started.then(() => { markPlayed(); detach(); }).catch(() => {
          // Blocked until the visitor interacts (or the clip is missing): wait for the first gesture.
          if (fromGesture) { if (speakWithBrowserVoice()) detach(); }
        });
      } else if (fromGesture) {
        if (speakWithBrowserVoice()) detach();
      }
    };
    function onGesture() { attempt(true); }

    ['pointerdown', 'keydown', 'touchstart', 'click'].forEach((ev) => window.addEventListener(ev, onGesture, true));
    attempt(false);
  })();

  // ------------------------------------------------------------------------
  // F. TakeRemo — INTERACTIVE WORKFLOW CARDS & LIVE ANALYTICS DASHBOARD
  // Cards: 01 Recruitment -> 02 Sales -> 03 Customer Support
  // Direct Tab Navigation + Smooth Fade/Slide + Animated Charts & Metrics
  // ------------------------------------------------------------------------
  const scrollSection = document.getElementById('capabilities');
  const storyCards = document.querySelectorAll('.story-card');
  const indicatorItems = document.querySelectorAll('.story-indicator-item');
  const compactDashboards = document.querySelectorAll('.compact-dashboard');

  // Sliding thumb behind the active workflow tab
  const storyBar = document.getElementById('story-progress-indicator');
  if (storyBar) {
    const moveThumb = () => {
      const active = storyBar.querySelector('.story-indicator-item.active');
      if (!active) return;
      storyBar.style.setProperty('--thumb-x', active.offsetLeft + 'px');
      storyBar.style.setProperty('--thumb-w', active.offsetWidth + 'px');
      // Mobile M / L: the tab row scrolls sideways, so keep the active tab centred
      if (window.matchMedia('(min-width: 361px) and (max-width: 480px)').matches && storyBar.scrollWidth > storyBar.clientWidth) {
        storyBar.scrollTo({ left: active.offsetLeft - (storyBar.clientWidth - active.offsetWidth) / 2, behavior: 'smooth' });
      }
    };
    new MutationObserver(moveThumb).observe(storyBar, { attributes: true, attributeFilter: ['class'], subtree: true });
    window.addEventListener('resize', moveThumb);
    window.addEventListener('load', moveThumb);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveThumb);
    moveThumb();
  }

  if (storyCards.length > 0) {
    let currentActiveIndex = 0;

    // Fast, responsive metric count-up
    const animateMetricNumber = (el, target, duration = 600) => {
      const startTime = performance.now();
      const tick = (now) => {
        const elapsed = now - startTime;
        const progress = Math.max(0, Math.min(elapsed / duration, 1));
        const ease = 1 - Math.pow(1 - progress, 3); // Smooth ease-out cubic
        const val = Math.round(target * ease);
        el.textContent = val;
        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          el.textContent = target;
        }
      };
      requestAnimationFrame(tick);
    };

    // Animate Donut progress and Center text
    const animateDonutAndCenter = (maskStroke, centerNumEl, targetVal, isFloat = false, duration = 650) => {
      const startTime = performance.now();
      const tick = (now) => {
        const elapsed = now - startTime;
        const progress = Math.max(0, Math.min(elapsed / duration, 1));
        const ease = 1 - Math.pow(1 - progress, 3);

        if (maskStroke) {
          const dashLength = (100 * ease).toFixed(1);
          maskStroke.setAttribute('stroke-dasharray', `${dashLength} 100`);
          maskStroke.style.strokeDasharray = `${dashLength} 100`;
        }

        if (centerNumEl) {
          if (isFloat) {
            const val = (targetVal * ease).toFixed(1);
            centerNumEl.textContent = val;
          } else {
            const val = Math.round(targetVal * ease);
            centerNumEl.textContent = `${val}%`;
          }
        }

        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          if (maskStroke) {
            maskStroke.setAttribute('stroke-dasharray', '100 0');
            maskStroke.style.strokeDasharray = '100 0';
          }
          if (centerNumEl) {
            centerNumEl.textContent = isFloat ? targetVal.toFixed(1) : `${targetVal}%`;
          }
        }
      };
      requestAnimationFrame(tick);
    };

    // Trigger dashboard charts & metrics animations for a specific card index
    const animateDashboard = (idx) => {
      const dash = compactDashboards[idx];
      if (!dash) return;

      dash.classList.add('dash-active');

      // 1. Metric numbers count-up
      const numbers = dash.querySelectorAll('.dash-stat-number[data-target]');
      numbers.forEach((numEl) => {
        const target = parseInt(numEl.getAttribute('data-target'), 10);
        if (!isNaN(target)) {
          numEl.textContent = '0';
          animateMetricNumber(numEl, target, 600);
        }
      });

      // 2. Bar Chart: Animate heights upward with staggered delays
      const bars = dash.querySelectorAll('.dash-bar-fill');
      bars.forEach((bar, i) => {
        const targetH = bar.getAttribute('data-height') || '60%';
        bar.style.height = '0%';
        bar.style.transition = 'none';
        
        setTimeout(() => {
          bar.style.transition = 'height 650ms cubic-bezier(0.22, 1, 0.36, 1)';
          bar.style.height = targetH;
        }, 50 + i * 40);
      });

      // 3. Donut Chart & Center Stat
      const maskStroke = dash.querySelector('.donut-mask-stroke');
      const centerStat = dash.querySelector('.donut-center-stat');
      if (maskStroke || centerStat) {
        if (maskStroke) {
          maskStroke.setAttribute('stroke-dasharray', '0 100');
          maskStroke.style.strokeDasharray = '0 100';
        }
        const targetVal = centerStat ? parseFloat(centerStat.getAttribute('data-target')) : 0;
        const isFloat = centerStat ? centerStat.getAttribute('data-float') === 'true' : false;
        setTimeout(() => {
          animateDonutAndCenter(maskStroke, centerStat, targetVal, isFloat, 700);
        }, 80);
      }

      // 4. CSAT meter fill for Customer Support
      const csatFill = dash.querySelector('.csat-meter-fill');
      if (csatFill) {
        csatFill.style.width = '0%';
        setTimeout(() => {
          csatFill.style.width = '96%';
        }, 150);
      }
    };

    // Switch visible Story Card
    const switchStoryCard = (targetIndex, triggerSound = true) => {
      if (targetIndex < 0 || targetIndex >= storyCards.length) return;
      currentActiveIndex = targetIndex;

      if (triggerSound) {
        playHumanChime('click');
      }

      // 1. Update Indicator Tab items
      indicatorItems.forEach((item, i) => {
        if (i === targetIndex) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });

      // 2. Update Story Cards visibility & 3D styling
      storyCards.forEach((card, i) => {
        if (i === targetIndex) {
          card.classList.add('active', 'card-in-front');
          card.classList.remove('card-in-back');
          card.style.opacity = '1';
          card.style.visibility = 'visible';
          card.style.pointerEvents = 'auto';
          card.style.zIndex = '10';
          card.style.transform = 'translateY(0) scale(1)';
        } else {
          card.classList.remove('active', 'card-in-front');
          card.classList.add('card-in-back');
          card.style.opacity = '0';
          card.style.visibility = 'hidden';
          card.style.pointerEvents = 'none';
          card.style.zIndex = '1';
          card.style.transform = 'translateY(16px) scale(0.98)';
        }
      });

      // 3. Trigger chart & number animations on the newly active card
      animateDashboard(targetIndex);
    };

    // Attach click handlers to indicators
    indicatorItems.forEach((item, i) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        switchStoryCard(i, true);
      });
    });

    // Keyboard Arrow navigation when section is in view
    document.addEventListener('keydown', (e) => {
      if (!scrollSection) return;
      const rect = scrollSection.getBoundingClientRect();
      const inView = rect.top < window.innerHeight * 0.8 && rect.bottom > window.innerHeight * 0.2;
      if (!inView) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        if (currentActiveIndex < storyCards.length - 1) {
          e.preventDefault();
          switchStoryCard(currentActiveIndex + 1, true);
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        if (currentActiveIndex > 0) {
          e.preventDefault();
          switchStoryCard(currentActiveIndex - 1, true);
        }
      }
    });

    // Nav anchor links (#recruitment, #sales, #support)
    document.querySelectorAll('a[href="#recruitment"], a[href="#sales"], a[href="#support"]').forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        const idx = href === '#recruitment' ? 0 : (href === '#sales' ? 1 : 2);
        switchStoryCard(idx, true);
        if (scrollSection) {
          scrollSection.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });

    // IntersectionObserver to auto-animate when section scrolls into viewport
    let hasInitializedInView = false;
    if (scrollSection && 'IntersectionObserver' in window) {
      const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !hasInitializedInView) {
            hasInitializedInView = true;
            switchStoryCard(0, false);
          }
        });
      }, { threshold: 0.2 });
      sectionObserver.observe(scrollSection);
    }

    // Initial activation
    switchStoryCard(0, false);
  }

  // ------------------------------------------------------------------------
  // G. SECTION 5: INDUSTRIES (DASHBOARD BLUE ACCENTS)
  // ------------------------------------------------------------------------
  const industryData = {
    healthcare: {
      title: 'HEALTHCARE & CLINICS',
      text: 'Hi Mrs. Gupta, this is Remo from Apollo Clinic confirming your appointment with Dr. Mehta tomorrow at 4:00 PM. Have you completed the recommended fasting for your lab panel?',
      chips: ['✓ Appointment Confirmation', '✓ Pre-Visit Guidelines', '✓ Rescheduling Support', '✓ EHR Status Synced']
    },
    recruitment: {
      title: 'RECRUITMENT & STAFFING',
      text: 'Hi Pooja, I am Remo from the talent team. I saw your application for Senior Developer. Could you share how many years of React experience you have and your current notice period?',
      chips: ['✓ Candidate Outreach', '✓ Skill Verification', '✓ Notice Period Check', '✓ ATS Auto-Sync']
    },
    sales: {
      title: 'SALES & INBOUND LEADS',
      text: 'Hello Vikram, this is Remo from TakeRemo. I noticed you just requested pricing for automated calling. Is this a good time to discuss your monthly lead volume?',
      chips: ['✓ Sub-30s Speed-to-Lead', '✓ Budget & Need Discovery', '✓ Calendar Demo Booking', '✓ CRM Contact Sync']
    },
    education: {
      title: 'EDUCATION & EDTECH',
      text: 'Hello Rohit, Remo here from Greenfield University. I am following up on your application for the Data Science Master program. Would you like to schedule an advisor consultation?',
      chips: ['✓ Admissions Inquiries', '✓ Course Eligibility Check', '✓ Counselor Walkthroughs', '✓ Fee Deadlines Reminder']
    },
    realestate: {
      title: 'REAL ESTATE & PROPERTY',
      text: 'Hi Priya, this is Remo calling from Prestige Heights regarding the 3-BHK inquiry you submitted. Are you looking to visit the property this Saturday or Sunday?',
      chips: ['✓ Buyer Qualification', '✓ Budget & Locality Discovery', '✓ Site Visit Booking', '✓ Broker Instant Alert']
    },
    support: {
      title: 'CUSTOMER SUPPORT & OPERATIONS',
      text: 'Thank you for calling support. This is Remo. I see your order #8492 is out for delivery with Bluedart and will arrive today by 2:30 PM. I have also texted you the live tracking link.',
      chips: ['✓ Zero Queue Wait Time', '✓ Order & Delivery Lookup', '✓ WhatsApp Auto-Dispatch', '✓ First-Call Resolution']
    },
    finance: {
      title: 'FINANCIAL SERVICES & BFSI',
      text: 'Hello Suresh, this is Remo from FinServe. I am following up regarding your KYC verification document upload for your business account. May I guide you through the remaining steps?',
      chips: ['✓ KYC Document Follow-up', '✓ Loan Pre-Screening', '✓ Payment Reminders', '✓ Compliance-Logged Audio']
    },
    automotive: {
      title: 'AUTOMOTIVE DEALERSHIPS',
      text: 'Hi Ananya, Remo calling from Hyundai Motors. You requested a test drive for the new Creta. We have a test vehicle available tomorrow at 11:00 AM at the Indiranagar showroom.',
      chips: ['✓ Test Drive Booking', '✓ Service Maintenance Alerts', '✓ Finance Eligibility Check', '✓ Trade-In Valuation Intake']
    }
  };

  // The sample line in each language (English is in industryData). Voice clips: /assets/voices/industries/<code>/<industry>.wav
  const IND_TEXTS = {
    te: {
      healthcare: 'నమస్కారం శ్రీమతి గుప్తా గారూ, నేను అపోలో క్లినిక్ నుండి రెమోను మాట్లాడుతున్నాను. రేపు సాయంత్రం 4 గంటలకు డాక్టర్ మెహతాతో మీ అపాయింట్‌మెంట్‌ను నిర్ధారించడానికి కాల్ చేశాను. మీ ల్యాబ్ పరీక్షకు సూచించిన ఉపవాసం పూర్తి చేశారా?',
      recruitment: 'నమస్కారం పూజ గారూ, నేను టాలెంట్ టీమ్ నుండి రెమోను. సీనియర్ డెవలపర్ పోస్టుకు మీ దరఖాస్తు చూశాను. మీకు రియాక్ట్‌లో ఎన్ని సంవత్సరాల అనుభవం ఉందో, ప్రస్తుత నోటీసు పీరియడ్ ఎంతో చెప్పగలరా?',
      sales: 'నమస్కారం విక్రమ్ గారూ, నేను టేక్‌రెమో నుండి రెమోను. ఆటోమేటెడ్ కాలింగ్ ధరల గురించి మీరు ఇప్పుడే అడిగినట్లు గమనించాను. మీ నెలవారీ లీడ్ల సంఖ్య గురించి మాట్లాడటానికి ఇది మంచి సమయమేనా?',
      education: 'నమస్కారం రోహిత్ గారూ, నేను గ్రీన్‌ఫీల్డ్ యూనివర్సిటీ నుండి రెమోను. డేటా సైన్స్ మాస్టర్స్ ప్రోగ్రామ్‌కు మీ దరఖాస్తు గురించి ఫాలో అప్ చేస్తున్నాను. అడ్వైజర్‌తో కన్సల్టేషన్ షెడ్యూల్ చేయమంటారా?',
      realestate: 'నమస్కారం ప్రియ గారూ, మీరు పంపిన 3-బీహెచ్‌కే విచారణ గురించి ప్రెస్టీజ్ హైట్స్ నుండి రెమోను మాట్లాడుతున్నాను. ఈ శనివారం లేదా ఆదివారం ఆస్తిని చూడటానికి రావాలనుకుంటున్నారా?',
      support: 'సపోర్ట్‌కు కాల్ చేసినందుకు ధన్యవాదాలు. నేను రెమోను. మీ ఆర్డర్ నంబర్ 8492 బ్లూడార్ట్ ద్వారా డెలివరీకి బయలుదేరింది, ఈరోజు మధ్యాహ్నం 2:30 లోపు చేరుతుంది. లైవ్ ట్రాకింగ్ లింక్‌ను కూడా మీకు టెక్స్ట్ చేశాను.',
      finance: 'నమస్కారం సురేష్ గారూ, నేను ఫిన్‌సర్వ్ నుండి రెమోను. మీ బిజినెస్ ఖాతా కోసం కేవైసీ ధృవీకరణ పత్రాల అప్‌లోడ్ గురించి ఫాలో అప్ చేస్తున్నాను. మిగిలిన దశల్లో మీకు మార్గనిర్దేశం చేయవచ్చా?',
      automotive: 'నమస్కారం అనన్య గారూ, నేను హ్యుందాయ్ మోటార్స్ నుండి రెమోను. మీరు కొత్త క్రెటా టెస్ట్ డ్రైవ్ కోసం అభ్యర్థించారు. రేపు ఉదయం 11 గంటలకు ఇందిరానగర్ షోరూమ్‌లో టెస్ట్ వాహనం అందుబాటులో ఉంది.'
    },
    hi: {
      healthcare: 'नमस्ते श्रीमती गुप्ता, मैं अपोलो क्लिनिक से रेमो बोल रहा हूँ। कल शाम 4 बजे डॉक्टर मेहता के साथ आपकी अपॉइंटमेंट की पुष्टि के लिए फ़ोन किया है। क्या आपने अपने लैब टेस्ट के लिए बताया गया उपवास पूरा कर लिया है?',
      recruitment: 'नमस्ते पूजा, मैं टैलेंट टीम से रेमो बोल रहा हूँ। मैंने सीनियर डेवलपर के लिए आपका आवेदन देखा है। क्या आप बता सकती हैं कि आपके पास रिएक्ट का कितने साल का अनुभव है और आपकी मौजूदा नोटिस अवधि क्या है?',
      sales: 'नमस्ते विक्रम, मैं टेकरेमो से रेमो बोल रहा हूँ। मैंने देखा कि आपने अभी ऑटोमेटेड कॉलिंग की कीमतों के बारे में पूछा है। क्या आपकी मासिक लीड संख्या पर बात करने के लिए यह सही समय है?',
      education: 'नमस्ते रोहित, मैं ग्रीनफ़ील्ड यूनिवर्सिटी से रेमो बोल रहा हूँ। डेटा साइंस मास्टर प्रोग्राम के लिए आपके आवेदन के बारे में बात करना चाहता हूँ। क्या आप किसी एडवाइज़र के साथ परामर्श तय करना चाहेंगे?',
      realestate: 'नमस्ते प्रिया, मैं प्रेस्टीज हाइट्स से रेमो बोल रहा हूँ, आपकी भेजी हुई 3-बीएचके पूछताछ के बारे में। क्या आप इस शनिवार या रविवार को प्रॉपर्टी देखने आना चाहेंगी?',
      support: 'सपोर्ट को कॉल करने के लिए धन्यवाद। मैं रेमो बोल रहा हूँ। आपका ऑर्डर नंबर 8492 ब्लूडार्ट के साथ डिलीवरी के लिए निकल चुका है और आज दोपहर 2:30 बजे तक पहुँच जाएगा। मैंने आपको लाइव ट्रैकिंग लिंक भी भेज दिया है।',
      finance: 'नमस्ते सुरेश, मैं फ़िनसर्व से रेमो बोल रहा हूँ। आपके बिज़नेस खाते के लिए केवाईसी सत्यापन दस्तावेज़ अपलोड के बारे में फ़ॉलो-अप कर रहा हूँ। क्या मैं बाकी चरणों में आपकी मदद कर सकता हूँ?',
      automotive: 'नमस्ते अनन्या, मैं ह्युंडई मोटर्स से रेमो बोल रहा हूँ। आपने नई क्रेटा के टेस्ट ड्राइव का अनुरोध किया था। कल सुबह 11 बजे इंदिरानगर शोरूम में टेस्ट गाड़ी उपलब्ध है।'
    },
    kn: {
      healthcare: 'ನಮಸ್ಕಾರ ಶ್ರೀಮತಿ ಗುಪ್ತಾ ಅವರೇ, ನಾನು ಅಪೊಲೊ ಕ್ಲಿನಿಕ್‌ನಿಂದ ರೆಮೋ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. ನಾಳೆ ಸಂಜೆ 4 ಗಂಟೆಗೆ ಡಾಕ್ಟರ್ ಮೆಹ್ತಾ ಅವರೊಂದಿಗಿನ ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢಪಡಿಸಲು ಕರೆ ಮಾಡಿದ್ದೇನೆ. ನಿಮ್ಮ ಲ್ಯಾಬ್ ಪರೀಕ್ಷೆಗೆ ಸೂಚಿಸಿದ ಉಪವಾಸವನ್ನು ಪೂರ್ಣಗೊಳಿಸಿದ್ದೀರಾ?',
      recruitment: 'ನಮಸ್ಕಾರ ಪೂಜಾ ಅವರೇ, ನಾನು ಟ್ಯಾಲೆಂಟ್ ತಂಡದಿಂದ ರೆಮೋ. ಸೀನಿಯರ್ ಡೆವಲಪರ್ ಹುದ್ದೆಗೆ ನಿಮ್ಮ ಅರ್ಜಿಯನ್ನು ನೋಡಿದೆ. ನಿಮಗೆ ರಿಯಾಕ್ಟ್‌ನಲ್ಲಿ ಎಷ್ಟು ವರ್ಷಗಳ ಅನುಭವವಿದೆ ಮತ್ತು ಈಗಿನ ನೋಟಿಸ್ ಅವಧಿ ಎಷ್ಟು ಎಂದು ತಿಳಿಸುತ್ತೀರಾ?',
      sales: 'ನಮಸ್ಕಾರ ವಿಕ್ರಮ್ ಅವರೇ, ನಾನು ಟೇಕ್‌ರೆಮೋದಿಂದ ರೆಮೋ. ನೀವು ಈಗಷ್ಟೇ ಸ್ವಯಂಚಾಲಿತ ಕರೆಗಳ ಬೆಲೆಯ ಬಗ್ಗೆ ವಿಚಾರಿಸಿದ್ದನ್ನು ಗಮನಿಸಿದೆ. ನಿಮ್ಮ ಮಾಸಿಕ ಲೀಡ್‌ಗಳ ಸಂಖ್ಯೆಯ ಬಗ್ಗೆ ಮಾತನಾಡಲು ಇದು ಸೂಕ್ತ ಸಮಯವೇ?',
      education: 'ನಮಸ್ಕಾರ ರೋಹಿತ್ ಅವರೇ, ನಾನು ಗ್ರೀನ್‌ಫೀಲ್ಡ್ ವಿಶ್ವವಿದ್ಯಾಲಯದಿಂದ ರೆಮೋ. ಡೇಟಾ ಸೈನ್ಸ್ ಮಾಸ್ಟರ್ ಕಾರ್ಯಕ್ರಮಕ್ಕೆ ನಿಮ್ಮ ಅರ್ಜಿಯ ಬಗ್ಗೆ ಫಾಲೋ ಅಪ್ ಮಾಡುತ್ತಿದ್ದೇನೆ. ಸಲಹೆಗಾರರೊಂದಿಗೆ ಸಮಾಲೋಚನೆ ನಿಗದಿಪಡಿಸಲೇ?',
      realestate: 'ನಮಸ್ಕಾರ ಪ್ರಿಯಾ ಅವರೇ, ನೀವು ಸಲ್ಲಿಸಿದ 3-ಬಿಎಚ್‌ಕೆ ವಿಚಾರಣೆಯ ಬಗ್ಗೆ ಪ್ರೆಸ್ಟೀಜ್ ಹೈಟ್ಸ್‌ನಿಂದ ರೆಮೋ ಕರೆ ಮಾಡುತ್ತಿದ್ದೇನೆ. ಈ ಶನಿವಾರ ಅಥವಾ ಭಾನುವಾರ ಆಸ್ತಿಯನ್ನು ನೋಡಲು ಬರಲು ಬಯಸುತ್ತೀರಾ?',
      support: 'ಸಪೋರ್ಟ್‌ಗೆ ಕರೆ ಮಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು. ನಾನು ರೆಮೋ. ನಿಮ್ಮ ಆರ್ಡರ್ ಸಂಖ್ಯೆ 8492 ಬ್ಲೂಡಾರ್ಟ್ ಮೂಲಕ ವಿತರಣೆಗೆ ಹೊರಟಿದೆ ಮತ್ತು ಇಂದು ಮಧ್ಯಾಹ್ನ 2:30ರೊಳಗೆ ತಲುಪುತ್ತದೆ. ಲೈವ್ ಟ್ರ್ಯಾಕಿಂಗ್ ಲಿಂಕ್ ಅನ್ನೂ ನಿಮಗೆ ಕಳುಹಿಸಿದ್ದೇನೆ.',
      finance: 'ನಮಸ್ಕಾರ ಸುರೇಶ್ ಅವರೇ, ನಾನು ಫಿನ್‌ಸರ್ವ್‌ನಿಂದ ರೆಮೋ. ನಿಮ್ಮ ವ್ಯವಹಾರ ಖಾತೆಗಾಗಿ ಕೆವೈಸಿ ಪರಿಶೀಲನೆ ದಾಖಲೆಗಳ ಅಪ್‌ಲೋಡ್ ಬಗ್ಗೆ ಫಾಲೋ ಅಪ್ ಮಾಡುತ್ತಿದ್ದೇನೆ. ಉಳಿದ ಹಂತಗಳಲ್ಲಿ ನಾನು ನಿಮಗೆ ಮಾರ್ಗದರ್ಶನ ನೀಡಲೇ?',
      automotive: 'ನಮಸ್ಕಾರ ಅನನ್ಯಾ ಅವರೇ, ನಾನು ಹ್ಯುಂಡೈ ಮೋಟಾರ್ಸ್‌ನಿಂದ ರೆಮೋ ಕರೆ ಮಾಡುತ್ತಿದ್ದೇನೆ. ನೀವು ಹೊಸ ಕ್ರೆಟಾದ ಟೆಸ್ಟ್ ಡ್ರೈವ್‌ಗೆ ವಿನಂತಿಸಿದ್ದಿರಿ. ನಾಳೆ ಬೆಳಿಗ್ಗೆ 11 ಗಂಟೆಗೆ ಇಂದಿರಾನಗರ ಶೋರೂಮ್‌ನಲ್ಲಿ ಟೆಸ್ಟ್ ವಾಹನ ಲಭ್ಯವಿದೆ.'
    },
    ml: {
      healthcare: 'നമസ്കാരം ശ്രീമതി ഗുപ്ത, ഞാൻ അപ്പോളോ ക്ലിനിക്കിൽ നിന്ന് റെമോ ആണ് വിളിക്കുന്നത്. നാളെ വൈകിട്ട് 4 മണിക്ക് ഡോക്ടർ മേത്തയുമായുള്ള നിങ്ങളുടെ അപ്പോയിന്റ്മെന്റ് ഉറപ്പാക്കാനാണ് വിളിച്ചത്. ലാബ് പരിശോധനയ്ക്ക് നിർദേശിച്ച ഉപവാസം പൂർത്തിയാക്കിയോ?',
      recruitment: 'നമസ്കാരം പൂജ, ഞാൻ ടാലന്റ് ടീമിൽ നിന്ന് റെമോ ആണ്. സീനിയർ ഡെവലപ്പർ തസ്തികയിലേക്കുള്ള നിങ്ങളുടെ അപേക്ഷ ഞാൻ കണ്ടു. റിയാക്ടിൽ നിങ്ങൾക്ക് എത്ര വർഷത്തെ പരിചയമുണ്ടെന്നും ഇപ്പോഴത്തെ നോട്ടീസ് കാലയളവ് എത്രയാണെന്നും പറയാമോ?',
      sales: 'നമസ്കാരം വിക്രം, ഞാൻ ടേക്ക്റെമോയിൽ നിന്ന് റെമോ ആണ്. ഓട്ടോമേറ്റഡ് കോളിംഗിന്റെ വില ഇപ്പോൾ ചോദിച്ചതായി ശ്രദ്ധിച്ചു. നിങ്ങളുടെ പ്രതിമാസ ലീഡ് എണ്ണത്തെക്കുറിച്ച് സംസാരിക്കാൻ ഇത് അനുയോജ്യമായ സമയമാണോ?',
      education: 'നമസ്കാരം രോഹിത്, ഞാൻ ഗ്രീൻഫീൽഡ് യൂണിവേഴ്സിറ്റിയിൽ നിന്ന് റെമോ ആണ്. ഡാറ്റാ സയൻസ് മാസ്റ്റർ പ്രോഗ്രാമിനുള്ള നിങ്ങളുടെ അപേക്ഷയെക്കുറിച്ച് ഫോളോ അപ്പ് ചെയ്യുകയാണ്. ഒരു അഡ്വൈസറുമായി കൺസൾട്ടേഷൻ ഷെഡ്യൂൾ ചെയ്യട്ടെ?',
      realestate: 'നമസ്കാരം പ്രിയ, നിങ്ങൾ സമർപ്പിച്ച 3-ബിഎച്ച്കെ അന്വേഷണത്തെക്കുറിച്ച് പ്രസ്റ്റീജ് ഹൈറ്റ്സിൽ നിന്ന് റെമോ ആണ് വിളിക്കുന്നത്. ഈ ശനിയാഴ്ചയോ ഞായറാഴ്ചയോ പ്രോപ്പർട്ടി കാണാൻ വരാൻ താൽപര്യമുണ്ടോ?',
      support: 'സപ്പോർട്ടിലേക്ക് വിളിച്ചതിന് നന്ദി. ഞാൻ റെമോ. നിങ്ങളുടെ ഓർഡർ നമ്പർ 8492 ബ്ലൂഡാർട്ട് വഴി ഡെലിവറിക്കായി പുറപ്പെട്ടു, ഇന്ന് ഉച്ചയ്ക്ക് 2:30-നകം എത്തും. ലൈവ് ട്രാക്കിംഗ് ലിങ്കും ഞാൻ നിങ്ങൾക്ക് അയച്ചിട്ടുണ്ട്.',
      finance: 'നമസ്കാരം സുരേഷ്, ഞാൻ ഫിൻസെർവിൽ നിന്ന് റെമോ ആണ്. നിങ്ങളുടെ ബിസിനസ് അക്കൗണ്ടിനായുള്ള കെവൈസി പരിശോധനാ രേഖകളുടെ അപ്‌ലോഡിനെക്കുറിച്ച് ഫോളോ അപ്പ് ചെയ്യുകയാണ്. ബാക്കി ഘട്ടങ്ങളിൽ ഞാൻ വഴികാട്ടട്ടെ?',
      automotive: 'നമസ്കാരം അനന്യ, ഞാൻ ഹ്യുണ്ടായ് മോട്ടോഴ്സിൽ നിന്ന് റെമോ ആണ് വിളിക്കുന്നത്. പുതിയ ക്രെറ്റയുടെ ടെസ്റ്റ് ഡ്രൈവ് നിങ്ങൾ ആവശ്യപ്പെട്ടിരുന്നു. നാളെ രാവിലെ 11 മണിക്ക് ഇന്ദിരാനഗർ ഷോറൂമിൽ ടെസ്റ്റ് വാഹനം ലഭ്യമാണ്.'
    },
    de: {
      healthcare: 'Guten Tag Frau Gupta, hier ist Remo von der Apollo Clinic. Ich rufe an, um Ihren Termin bei Doktor Mehta morgen um 16:00 Uhr zu bestätigen. Haben Sie die empfohlene Nüchternzeit für Ihre Laboruntersuchung eingehalten?',
      recruitment: 'Hallo Pooja, hier ist Remo vom Talent-Team. Ich habe Ihre Bewerbung als Senior Developer gesehen. Wie viele Jahre Erfahrung haben Sie mit React, und wie lang ist Ihre aktuelle Kündigungsfrist?',
      sales: 'Hallo Vikram, hier ist Remo von TakeRemo. Mir ist aufgefallen, dass Sie gerade Preise für automatisierte Anrufe angefragt haben. Passt es gerade, über Ihr monatliches Lead-Volumen zu sprechen?',
      education: 'Hallo Rohit, hier ist Remo von der Greenfield University. Ich melde mich wegen Ihrer Bewerbung für das Master-Programm Data Science. Möchten Sie einen Beratungstermin mit einem Studienberater vereinbaren?',
      realestate: 'Hallo Priya, hier ist Remo von Prestige Heights, wegen Ihrer Anfrage zur 3-BHK-Wohnung. Möchten Sie die Immobilie diesen Samstag oder Sonntag besichtigen?',
      support: 'Vielen Dank für Ihren Anruf beim Support. Hier ist Remo. Ihre Bestellung Nummer 8492 ist bei Bluedart in Zustellung und kommt heute bis 14:30 Uhr an. Den Live-Tracking-Link habe ich Ihnen auch per SMS geschickt.',
      finance: 'Hallo Suresh, hier ist Remo von FinServe. Ich melde mich wegen des Uploads Ihrer KYC-Verifizierungsdokumente für Ihr Geschäftskonto. Darf ich Sie durch die restlichen Schritte führen?',
      automotive: 'Hallo Ananya, hier ist Remo von Hyundai Motors. Sie haben eine Probefahrt mit dem neuen Creta angefragt. Morgen um 11:00 Uhr steht im Showroom in Indiranagar ein Testfahrzeug bereit.'
    },
    es: {
      healthcare: 'Hola, señora Gupta, soy Remo de Apollo Clinic. Le llamo para confirmar su cita con el doctor Mehta mañana a las 4:00 p. m. ¿Ha completado el ayuno recomendado para su análisis de laboratorio?',
      recruitment: 'Hola, Pooja, soy Remo del equipo de talento. Vi su solicitud para el puesto de desarrollador sénior. ¿Podría decirme cuántos años de experiencia tiene con React y cuál es su periodo de preaviso actual?',
      sales: 'Hola, Vikram, soy Remo de TakeRemo. Vi que acaba de solicitar precios de llamadas automatizadas. ¿Es buen momento para hablar de su volumen mensual de clientes potenciales?',
      education: 'Hola, Rohit, soy Remo de Greenfield University. Le llamo por su solicitud al máster en Ciencia de Datos. ¿Le gustaría programar una consulta con un asesor?',
      realestate: 'Hola, Priya, soy Remo de Prestige Heights, por la consulta sobre el apartamento 3-BHK que envió. ¿Quiere visitar la propiedad este sábado o domingo?',
      support: 'Gracias por llamar a soporte. Soy Remo. Su pedido número 8492 va en reparto con Bluedart y llegará hoy antes de las 2:30 p. m. También le envié por mensaje el enlace de seguimiento en vivo.',
      finance: 'Hola, Suresh, soy Remo de FinServe. Le llamo por la carga de los documentos de verificación KYC de su cuenta empresarial. ¿Puedo guiarle en los pasos restantes?',
      automotive: 'Hola, Ananya, soy Remo de Hyundai Motors. Usted solicitó una prueba de manejo del nuevo Creta. Mañana a las 11:00 a. m. tenemos un vehículo de prueba disponible en el showroom de Indiranagar.'
    }
  };

  const industryTabs = document.querySelectorAll('.ind-pill-btn, .ind-tab');
  const indDisplayTitle = document.getElementById('ind-display-title');
  const indDisplayText = document.getElementById('ind-display-text');
  const indDisplayChips = document.getElementById('ind-display-chips');
  const indDisplayCard = document.getElementById('industry-display-card');

  const indSelector = document.getElementById('industry-tabs');
  const indShowcase = document.querySelector('.industry-visual-showcase');
  const indTabList = Array.from(industryTabs);
  const indReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IND_DURATION = 7500;
  let indCurrent = Math.max(0, indTabList.findIndex((t) => t.classList.contains('active')));
  let indAnim = null;
  let indHover = false;
  let indVisible = false;

  // The active tab's underline fills like a timer; when full, the next industry opens
  const indBars = indTabList.map((tab) => {
    const bar = document.createElement('span');
    bar.className = 'ind-progress';
    tab.appendChild(bar);
    return bar;
  });

  // ---- Language + voice for the sample line ----
  // With the voice on, the line is read aloud in the chosen language (English included) and the rotation waits for
  // the clip to finish. The page opens silent: sound starts when the visitor turns the voice on or picks a language.
  let indLang = 'en';
  let indVoiceOn = false;
  let indVoiceBlocked = false; // browsers block sound until the visitor has interacted with the page
  let indPlayToken = 0;
  let indSelectToken = 0;
  let indActiveAudio = null;
  const indAudioCache = {};
  const indVoiceBtn = document.getElementById('ind-voice');
  const indLangTabs = Array.from(document.querySelectorAll('.ind-lang-tab'));

  const indKey = (index) => indTabList[index].getAttribute('data-industry');
  const indAudioFor = (lang, key) => {
    const id = `${lang}/${key}`;
    if (!indAudioCache[id]) {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = `/assets/voices/industries/${id}.wav`;
      indAudioCache[id] = audio;
    }
    return indAudioCache[id];
  };
  const indTextFor = (index) => {
    const key = indKey(index);
    if (indLang !== 'en' && IND_TEXTS[indLang] && IND_TEXTS[indLang][key]) return IND_TEXTS[indLang][key];
    return industryData[key].text;
  };
  // A clip's length is known once its metadata has loaded; never wait long on a slow connection
  const indClipReady = (audio) => new Promise((resolve) => {
    if (audio.readyState >= 1) { resolve(); return; }
    const done = () => {
      audio.removeEventListener('loadedmetadata', done);
      audio.removeEventListener('error', done);
      resolve();
    };
    audio.addEventListener('loadedmetadata', done);
    audio.addEventListener('error', done);
    setTimeout(done, 2500);
  });
  const indSetVoiceState = (state) => {
    if (!indVoiceBtn) return;
    indVoiceBtn.dataset.state = state;
    indVoiceBtn.setAttribute('aria-pressed', String(state === 'on'));
    indVoiceBtn.setAttribute('aria-label',
      state === 'on' ? 'Voice on. Click to mute' : state === 'off' ? 'Voice off. Click to hear this sample call' : 'Click to hear Remo');
    indVoiceBtn.querySelector('.ind-voice-text').textContent =
      state === 'on' ? 'Voice on' : state === 'off' ? 'Voice off' : 'Tap to hear Remo';
  };
  const stopIndVoice = () => {
    indPlayToken += 1;
    if (indActiveAudio) {
      indActiveAudio.pause();
      indActiveAudio.currentTime = 0;
      indActiveAudio = null;
    }
  };
  const playIndVoice = async (index) => {
    stopIndVoice();
    const audio = indAudioFor(indLang, indKey(index));
    if (!audio || !indVoiceOn || !indVisible || document.hidden) return;
    const token = indPlayToken;
    try {
      audio.currentTime = 0;
      indActiveAudio = audio;
      await audio.play();
    } catch (err) {
      if (token === indPlayToken && err && err.name === 'NotAllowedError') {
        indVoiceBlocked = true;
        indSetVoiceState('blocked');
      }
    }
  };
  // How long the current industry stays open: the usual time, or the clip's length plus a short breath
  const indDurationFor = (index) => {
    const audio = indVoiceOn ? indAudioFor(indLang, indKey(index)) : null;
    const seconds = audio && audio.duration;
    return seconds && isFinite(seconds) ? Math.max(IND_DURATION, seconds * 1000 + 1600) : IND_DURATION;
  };

  const renderIndustry = (index) => {
    const data = industryData[indTabList[index].getAttribute('data-industry')];
    if (!data) return;
    if (indDisplayTitle) indDisplayTitle.textContent = data.title;
    if (indDisplayText) {
      // each word fades up in turn (see .ind-word in CSS)
      const words = indTextFor(index).split(' ').map((w, i) => `<span class="ind-word" style="--w:${i}">${w}</span>`).join(' ');
      indDisplayText.setAttribute('lang', indLang);
      indDisplayText.innerHTML = `“${words}”`;
    }
    if (indDisplayChips) {
      indDisplayChips.innerHTML = data.chips.map((chip, i) => {
        const cleanText = chip.replace(/^[^a-zA-Z0-9]+/, '').trim();
        return `<span class="ind-chip" style="--c:${i}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${cleanText}</span>`;
      }).join('');
    }
    if (indDisplayCard) {
      indDisplayCard.classList.remove('is-swap');
      void indDisplayCard.offsetWidth; // restart the CSS animations
      indDisplayCard.classList.add('is-swap');
    }
  };

  const startIndProgress = () => {
    if (indAnim) indAnim.cancel();
    indAnim = null;
    if (indReduce) return;
    indAnim = indBars[indCurrent].animate(
      [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: indDurationFor(indCurrent), easing: 'linear', fill: 'forwards' }
    );
    indAnim.onfinish = () => selectIndustry((indCurrent + 1) % indTabList.length);
    if (!indVisible || indHover) indAnim.pause();
  };

  const selectIndustry = (index) => {
    if (indAnim) { indAnim.cancel(); indAnim = null; }
    indCurrent = index;
    indTabList.forEach((tab, i) => {
      tab.classList.toggle('active', i === index);
      tab.setAttribute('aria-selected', String(i === index));
    });
    // keep the active tab in view when the row scrolls sideways (phones)
    const activeTab = indTabList[index];
    if (indSelector && indSelector.scrollWidth > indSelector.clientWidth) {
      indSelector.scrollTo({ left: activeTab.offsetLeft - (indSelector.clientWidth - activeTab.offsetWidth) / 2, behavior: 'smooth' });
    }
    renderIndustry(index);
    const token = ++indSelectToken;
    const audio = indVoiceOn ? indAudioFor(indLang, indKey(index)) : null;
    if (audio) {
      // the timer starts once the clip's length is known, so the industry stays open as long as the voice
      indClipReady(audio).then(() => {
        if (token !== indSelectToken) return;
        playIndVoice(index);
        startIndProgress();
      });
    } else {
      stopIndVoice();
      startIndProgress();
    }
  };

  indTabList.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      // with the voice on, clicking the open industry reads it again
      if (i !== indCurrent || indVoiceOn) selectIndustry(i); else startIndProgress();
    });
  });

  // Language tabs: the line changes language and is read aloud (English is text only)
  const indSetLanguage = (lang) => {
    if (lang !== 'en' && !IND_TEXTS[lang]) return;
    if (lang === indLang && indVoiceOn) return; // already showing it, with the voice on
    indLang = lang;
    indLangTabs.forEach((tab) => {
      const on = tab.dataset.lang === lang;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    // Choosing a language is a request to hear it, so sound comes on even if it was muted
    indVoiceOn = true;
    indVoiceBlocked = false;
    indSetVoiceState('on');
    selectIndustry(indCurrent);
  };
  indLangTabs.forEach((tab, i) => {
    tab.addEventListener('click', () => indSetLanguage(tab.dataset.lang));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = indLangTabs[(i + (e.key === 'ArrowRight' ? 1 : indLangTabs.length - 1)) % indLangTabs.length];
      next.focus();
      indSetLanguage(next.dataset.lang);
    });
  });

  if (indVoiceBtn) {
    indVoiceBtn.addEventListener('click', () => {
      if (indVoiceBlocked) {
        indVoiceBlocked = false;
        indVoiceOn = true;
      } else {
        indVoiceOn = !indVoiceOn;
      }
      indSetVoiceState(indVoiceOn ? 'on' : 'off');
      selectIndustry(indCurrent); // restarts the line and its timer with or without the voice
    });
  }

  indSetVoiceState(indVoiceOn ? 'on' : 'off');

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopIndVoice(); else if (indVisible) playIndVoice(indCurrent);
  });

  if (indShowcase) {
    indShowcase.addEventListener('pointerenter', () => { indHover = true; if (indAnim) indAnim.pause(); });
    indShowcase.addEventListener('pointerleave', () => { indHover = false; if (indAnim && indVisible) indAnim.play(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        indVisible = entry.isIntersecting;
        if (indVisible) playIndVoice(indCurrent); else stopIndVoice();
        if (!indAnim) return;
        if (indVisible && !indHover) indAnim.play(); else indAnim.pause();
      }, { threshold: 0.4 }).observe(indShowcase);
    }
  }

  if (indTabList.length) selectIndustry(indCurrent);

  // ------------------------------------------------------------------------
  // SERVICE CARDS: Non-routing tactile buttons
  // ------------------------------------------------------------------------
  // Human Difference: calm fade-up reveal as each part scrolls into view
  const humanSection = document.getElementById('human-touch');
  if (humanSection && 'IntersectionObserver' in window) {
    const revealTargets = humanSection.querySelectorAll('.esc-item, .human-stories-header');
    humanSection.classList.add('ht-ready');
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.2, rootMargin: '0px 0px -40px 0px' });
    revealTargets.forEach((el) => revealObserver.observe(el));
  }

  // How it works: draw the timeline once, when it first scrolls into view
  const hiwSection = document.getElementById('how-it-works');
  const hiwGrid = hiwSection ? hiwSection.querySelector('.how-it-works-grid') : null;
  if (hiwGrid && 'IntersectionObserver' in window) {
    hiwSection.classList.add('hiw-ready');
    const hiwObserver = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      hiwGrid.classList.add('is-in');
      hiwObserver.disconnect();
    }, { threshold: 0.5 });
    hiwObserver.observe(hiwGrid);
  }

  // Caller stories: duplicate the cards once so the auto-scroll loops seamlessly
  const callerTrack = document.querySelector('.caller-testimonials-grid');
  if (callerTrack && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    Array.from(callerTrack.children).forEach((card) => {
      const copy = card.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      callerTrack.appendChild(copy);
    });
    callerTrack.classList.add('is-looping');
  }

  // Human Difference: the selected pillar drives the live scene; auto-rotates, pauses on hover / off-screen
  const htGrid = humanSection ? humanSection.querySelector('.human-pillars-grid') : null;
  if (htGrid) {
    const pillars = Array.from(htGrid.querySelectorAll('.human-pillar-card'));
    const scenes = Array.from(htGrid.querySelectorAll('.ht-scene'));
    const htReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const HT_MIN_DURATION = 6500;

    // Voice clips per scene, generated once into /assets/voices (English at the top level, the other languages in
    // /assets/voices/<code>/); played only while the section is on screen. A language's clips are loaded the
    // first time that language is chosen.
    const HT_TEXTS = {
      en: {
        breath: 'Hi, this is Remo. Take your time… I\'m right here, and I\'m listening.',
        'cut-caller': 'Sorry to jump in. Can I ask something quickly?',
        'cut-remo': 'Of course. Please, go ahead.',
        care: 'I\'m really sorry about the trouble. Let me sort this out for you right away.',
        done: 'All done. I\'ve sent your summary on WhatsApp, confirmed the calendar invite, and updated your notes.'
      },
      te: {
        breath: 'నమస్కారం, నేను రెమో. తొందరేమీ లేదు… నేను ఇక్కడే ఉన్నాను, శ్రద్ధగా వింటున్నాను.',
        'cut-caller': 'క్షమించండి, మధ్యలో మాట్లాడుతున్నాను. ఒక్క విషయం త్వరగా అడగవచ్చా?',
        'cut-remo': 'తప్పకుండా. దయచేసి చెప్పండి.',
        care: 'ఇబ్బంది కలిగినందుకు నిజంగా క్షమించండి. నేను వెంటనే దీన్ని పరిష్కరిస్తాను.',
        done: 'పని పూర్తయింది. మీ సారాంశాన్ని వాట్సాప్‌లో పంపాను, క్యాలెండర్ ఆహ్వానాన్ని నిర్ధారించాను, మీ నోట్స్‌ను అప్‌డేట్ చేశాను.'
      },
      hi: {
        breath: 'नमस्ते, मैं रेमो बोल रही हूँ। आप आराम से बोलिए… मैं यहीं हूँ, और ध्यान से सुन रही हूँ।',
        'cut-caller': 'माफ़ कीजिए, बीच में टोक रहा हूँ। क्या मैं जल्दी से एक बात पूछ सकता हूँ?',
        'cut-remo': 'जी ज़रूर। कृपया पूछिए।',
        care: 'परेशानी के लिए मुझे सच में खेद है। मैं इसे अभी ठीक करती हूँ।',
        done: 'काम हो गया। मैंने आपका सारांश व्हाट्सऐप पर भेज दिया है, कैलेंडर इनवाइट पक्का कर दिया है, और आपके नोट्स अपडेट कर दिए हैं।'
      },
      kn: {
        breath: 'ನಮಸ್ಕಾರ, ನಾನು ರೆಮೋ. ಆತುರವೇನಿಲ್ಲ… ನಾನು ಇಲ್ಲೇ ಇದ್ದೇನೆ, ಗಮನವಿಟ್ಟು ಕೇಳುತ್ತಿದ್ದೇನೆ.',
        'cut-caller': 'ಕ್ಷಮಿಸಿ, ಮಧ್ಯದಲ್ಲಿ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. ಒಂದು ವಿಷಯವನ್ನು ಬೇಗನೆ ಕೇಳಬಹುದೇ?',
        'cut-remo': 'ಖಂಡಿತ. ದಯವಿಟ್ಟು ಕೇಳಿ.',
        care: 'ತೊಂದರೆಗಾಗಿ ನಿಜವಾಗಿಯೂ ಕ್ಷಮಿಸಿ. ನಾನು ಇದನ್ನು ಈಗಲೇ ಸರಿಪಡಿಸುತ್ತೇನೆ.',
        done: 'ಕೆಲಸ ಮುಗಿಯಿತು. ನಿಮ್ಮ ಸಾರಾಂಶವನ್ನು ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಿದ್ದೇನೆ, ಕ್ಯಾಲೆಂಡರ್ ಆಹ್ವಾನವನ್ನು ದೃಢಪಡಿಸಿದ್ದೇನೆ, ಮತ್ತು ನಿಮ್ಮ ಟಿಪ್ಪಣಿಗಳನ್ನು ನವೀಕರಿಸಿದ್ದೇನೆ.'
      },
      ml: {
        breath: 'നമസ്കാരം, ഞാൻ റെമോ ആണ്. ധൃതിയൊന്നും വേണ്ട… ഞാൻ ഇവിടെത്തന്നെയുണ്ട്, ശ്രദ്ധയോടെ കേൾക്കുന്നുണ്ട്.',
        'cut-caller': 'ക്ഷമിക്കണം, ഇടയ്ക്ക് കയറി സംസാരിക്കുകയാണ്. ഒരു കാര്യം വേഗം ചോദിക്കാമോ?',
        'cut-remo': 'തീർച്ചയായും. ദയവായി പറഞ്ഞോളൂ.',
        care: 'ബുദ്ധിമുട്ടുണ്ടായതിൽ ശരിക്കും ക്ഷമിക്കണം. ഞാൻ ഇത് ഉടൻ തന്നെ ശരിയാക്കാം.',
        done: 'എല്ലാം കഴിഞ്ഞു. നിങ്ങളുടെ സംഗ്രഹം വാട്ട്സ്ആപ്പിൽ അയച്ചിട്ടുണ്ട്, കലണ്ടർ ക്ഷണം സ്ഥിരീകരിച്ചിട്ടുണ്ട്, നിങ്ങളുടെ കുറിപ്പുകളും പുതുക്കിയിട്ടുണ്ട്.'
      },
      de: {
        breath: 'Hallo, hier ist Remo. Nehmen Sie sich Zeit… ich bin da und höre Ihnen zu.',
        'cut-caller': 'Entschuldigung, dass ich unterbreche. Darf ich kurz etwas fragen?',
        'cut-remo': 'Natürlich. Bitte, fragen Sie.',
        care: 'Es tut mir wirklich leid für die Umstände. Ich kläre das sofort für Sie.',
        done: 'Alles erledigt. Ich habe Ihre Zusammenfassung per WhatsApp gesendet, die Kalendereinladung bestätigt und Ihre Notizen aktualisiert.'
      },
      es: {
        breath: 'Hola, soy Remo. Tómese su tiempo… estoy aquí y le estoy escuchando.',
        'cut-caller': 'Perdone que le interrumpa. ¿Puedo preguntarle algo rápidamente?',
        'cut-remo': 'Por supuesto. Adelante, por favor.',
        care: 'Lamento mucho el inconveniente. Voy a resolverlo ahora mismo.',
        done: 'Todo listo. Le envié su resumen por WhatsApp, confirmé la invitación del calendario y actualicé sus notas.'
      }
    };
    // Scenes in order; each lists its clips (the interruption scene has the caller, then Remo)
    const HT_SCENE_CLIPS = [
      [['breath', 'Remo']],
      [['cut-caller', 'Caller'], ['cut-remo', 'Remo']],
      [['care', 'Remo']],
      [['done', 'Remo']]
    ];
    const htSceneCache = {};
    const getVoiceScenes = (lang) => {
      if (!htSceneCache[lang]) {
        const dir = lang === 'en' ? '/assets/voices/' : `/assets/voices/${lang}/`;
        htSceneCache[lang] = HT_SCENE_CLIPS.map((clips) => clips.map(([name, who]) => {
          const audio = new Audio();
          audio.preload = 'metadata';
          audio.src = `${dir}${name}.wav`;
          return { src: audio.src, who, text: HT_TEXTS[lang][name], audio };
        }));
      }
      return htSceneCache[lang];
    };
    let htLang = 'en';
    let voiceScenes = getVoiceScenes(htLang);

    // Each scene lasts as long as its voice (plus a breath), never less than the minimum
    const htDurationFor = (i) => {
      const spoken = (voiceScenes[i] || []).reduce((sum, c) => {
        const d = c.audio.duration;
        return sum + (d && isFinite(d) ? d * 1000 + 450 : 0);
      }, 0);
      return Math.max(HT_MIN_DURATION, spoken + 1800);
    };
    const htBars = pillars.map((pillar) => {
      const bar = document.createElement('span');
      bar.className = 'ht-progress';
      pillar.appendChild(bar);
      pillar.setAttribute('tabindex', '0');
      return bar;
    });
    let htCurrent = 0;
    let htAnim = null;
    let htHover = false;
    let htVisible = false;

    // ---- Voice playback: starts when the section is in view, stops when it leaves ----
    const voiceBtn = document.getElementById('ht-sound');
    const caption = htGrid.querySelector('.ht-caption');
    const captionWho = htGrid.querySelector('.ht-caption-who');
    const captionText = htGrid.querySelector('.ht-caption-text');
    let voiceOn = true;
    try { voiceOn = window.localStorage.getItem('ht-voice') !== 'off'; } catch (e) { /* storage unavailable */ }
    let voiceBlocked = false; // browsers block sound until the visitor has interacted with the page
    let playToken = 0;
    let activeAudio = null;

    const setVoiceState = (state) => {
      if (!voiceBtn) return;
      voiceBtn.dataset.state = state;
      voiceBtn.setAttribute('aria-pressed', String(state === 'on'));
      voiceBtn.querySelector('.ht-sound-text').textContent =
        state === 'on' ? 'Voice on' : state === 'off' ? 'Voice off' : 'Tap to hear Remo';
      voiceBtn.setAttribute('aria-label',
        state === 'on' ? 'Voice on. Click to mute' : state === 'off' ? 'Voice off. Click to turn on' : 'Click to hear Remo');
    };

    const showCaption = (who, text) => {
      if (!caption) return;
      captionWho.textContent = who;
      captionText.textContent = text;
      caption.classList.toggle('is-long', text.length > 80);
      caption.classList.add('is-show');
    };
    const hideCaption = () => { if (caption) caption.classList.remove('is-show'); };

    const stopVoice = () => {
      playToken += 1;
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
        activeAudio = null;
      }
      hideCaption();
    };

    const playClip = (audio) => new Promise((resolve, reject) => {
      activeAudio = audio;
      audio.currentTime = 0;
      const cleanup = () => {
        audio.removeEventListener('ended', finish);
        audio.removeEventListener('pause', finish);
      };
      const finish = () => { cleanup(); resolve(); };
      audio.addEventListener('ended', finish);
      audio.addEventListener('pause', finish);
      const attempt = audio.play();
      if (attempt && attempt.catch) attempt.catch((err) => { cleanup(); reject(err); });
    });

    const playScene = async (index) => {
      stopVoice();
      if (!voiceOn || !htVisible || document.hidden) return;
      const token = playToken;
      for (const clip of voiceScenes[index]) {
        if (token !== playToken) return;
        showCaption(clip.who, clip.text);
        try {
          await playClip(clip.audio);
        } catch (err) {
          if (token === playToken && err && err.name === 'NotAllowedError') {
            voiceBlocked = true;
            setVoiceState('blocked');
          }
          hideCaption();
          return;
        }
        if (token !== playToken) return;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      if (token === playToken) hideCaption();
    };

    // The first click / key press anywhere unlocks sound; if playback was blocked, start it then
    const unlockOnGesture = (e) => {
      if (!voiceBlocked || (voiceBtn && voiceBtn.contains(e.target))) return;
      voiceBlocked = false;
      if (voiceOn) {
        setVoiceState('on');
        if (htVisible) playScene(htCurrent);
      }
    };
    ['pointerdown', 'keydown'].forEach((evt) => window.addEventListener(evt, unlockOnGesture, true));

    if (voiceBtn) {
      voiceBtn.addEventListener('click', () => {
        if (voiceBlocked) {
          voiceBlocked = false;
          voiceOn = true;
          setVoiceState('on');
          playScene(htCurrent);
        } else {
          voiceOn = !voiceOn;
          setVoiceState(voiceOn ? 'on' : 'off');
          if (voiceOn) playScene(htCurrent); else stopVoice();
        }
        try { window.localStorage.setItem('ht-voice', voiceOn ? 'on' : 'off'); } catch (e) { /* storage unavailable */ }
      });
    }
    setVoiceState(voiceOn ? 'on' : 'off');

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopVoice(); else if (htVisible) playScene(htCurrent);
    });

    const htStart = () => {
      if (htAnim) htAnim.cancel();
      htAnim = null;
      if (htReduce) return;
      htAnim = htBars[htCurrent].animate(
        [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
        { duration: htDurationFor(htCurrent), easing: 'linear', fill: 'forwards' }
      );
      htAnim.onfinish = () => htSelect((htCurrent + 1) % pillars.length);
      if (!htVisible || htHover) htAnim.pause();
    };

    const htSelect = (index) => {
      htCurrent = index;
      pillars.forEach((pillar, i) => pillar.classList.toggle('is-active', i === index));
      scenes.forEach((scene, i) => scene.classList.toggle('is-on', i === index));
      playScene(index);
      htStart();
    };

    pillars.forEach((pillar, i) => {
      pillar.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && i !== htCurrent) htSelect(i); });
      pillar.addEventListener('click', () => { if (i !== htCurrent) htSelect(i); });
      pillar.addEventListener('focus', () => { if (i !== htCurrent) htSelect(i); });
    });

    htGrid.addEventListener('pointerenter', () => { htHover = true; if (htAnim) htAnim.pause(); });
    htGrid.addEventListener('pointerleave', () => { htHover = false; if (htAnim && htVisible) htAnim.play(); });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        htVisible = entry.isIntersecting;
        if (htVisible) playScene(htCurrent); else stopVoice();
        if (!htAnim) return;
        if (htVisible && !htHover) htAnim.play(); else htAnim.pause();
      }, { threshold: 0.35 }).observe(htGrid);
    }

    // ---- Language tabs: switch the voice and the captions of all four scenes ----
    const langTabs = Array.from(document.querySelectorAll('.ht-lang-tab'));
    const htClipsReady = (clips) => Promise.all(clips.map(({ audio }) => new Promise((resolve) => {
      if (audio.readyState >= 1) { resolve(); return; }
      const done = () => {
        audio.removeEventListener('loadedmetadata', done);
        audio.removeEventListener('error', done);
        resolve();
      };
      audio.addEventListener('loadedmetadata', done);
      audio.addEventListener('error', done);
      setTimeout(done, 2500); // never wait long on a slow connection
    })));
    let htLangToken = 0;
    const htSetLanguage = async (lang) => {
      if (!HT_TEXTS[lang] || lang === htLang) return;
      const token = ++htLangToken;
      htLang = lang;
      stopVoice();
      voiceScenes = getVoiceScenes(lang);
      langTabs.forEach((tab) => {
        const on = tab.dataset.lang === lang;
        tab.classList.toggle('is-active', on);
        tab.classList.toggle('is-loading', on);
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
      });
      if (captionText) captionText.setAttribute('lang', lang);
      // Choosing a language is a request to hear it, so sound comes on even if it was muted
      voiceOn = true;
      voiceBlocked = false;
      setVoiceState('on');
      try { window.localStorage.setItem('ht-voice', 'on'); } catch (e) { /* storage unavailable */ }
      await htClipsReady(voiceScenes[htCurrent]); // so the scene lasts as long as the voice does
      if (token !== htLangToken) return;
      langTabs.forEach((tab) => tab.classList.remove('is-loading'));
      htSelect(htCurrent);
    };
    langTabs.forEach((tab, i) => {
      tab.addEventListener('click', () => htSetLanguage(tab.dataset.lang));
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = langTabs[(i + (e.key === 'ArrowRight' ? 1 : langTabs.length - 1)) % langTabs.length];
        next.focus();
        htSetLanguage(next.dataset.lang);
      });
    });

    htSelect(0);
  }

  // Service panels: one open at a time, auto-rotating (paused on hover / off-screen)
  const svcGrid = document.querySelector('.service-cards-grid');
  if (svcGrid) {
    const panels = Array.from(svcGrid.querySelectorAll('.service-card'));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const SVC_DURATION = 5500;
    const bars = panels.map((panel) => {
      const bar = document.createElement('span');
      bar.className = 'svc-progress';
      panel.appendChild(bar);
      panel.setAttribute('tabindex', '0');
      return bar;
    });
    let current = Math.max(0, panels.findIndex((p) => p.classList.contains('service-card-featured')));
    let anim = null;
    let hovering = false;
    let inView = false;

    const startProgress = () => {
      if (anim) anim.cancel();
      anim = null;
      if (reduceMotion) return;
      anim = bars[current].animate(
        [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
        { duration: SVC_DURATION, easing: 'linear', fill: 'forwards' }
      );
      anim.onfinish = () => openPanel((current + 1) % panels.length);
      if (!inView || hovering) anim.pause();
    };

    const openPanel = (index) => {
      current = index;
      panels.forEach((panel, i) => {
        panel.classList.toggle('is-open', i === index);
        panel.setAttribute('aria-expanded', String(i === index));
      });
      startProgress();
    };

    panels.forEach((panel, i) => {
      panel.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && i !== current) openPanel(i); });
      panel.addEventListener('click', () => { if (i !== current) openPanel(i); });
      panel.addEventListener('focus', () => { if (i !== current) openPanel(i); });
    });

    svcGrid.addEventListener('pointerenter', () => { hovering = true; if (anim) anim.pause(); });
    svcGrid.addEventListener('pointerleave', () => { hovering = false; if (anim && inView) anim.play(); });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        if (!anim) return;
        if (inView && !hovering) anim.play(); else anim.pause();
      }, { threshold: 0.35 }).observe(svcGrid);
    }

    openPanel(current);
  }

  const serviceCardButtons = document.querySelectorAll('.btn-service-card');
  serviceCardButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Links to a service page keep their default navigation; plain buttons stay inert
      if (!btn.getAttribute('href')) e.preventDefault();
      playHumanChime('click');
      btn.style.transform = 'scale(0.96)';
      setTimeout(() => {
        btn.style.transform = '';
      }, 140);
    });
  });

  // ------------------------------------------------------------------------
  // H. BOOK A DEMO MODAL HANDLERS
  // ------------------------------------------------------------------------
  const demoModal = document.getElementById('demo-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalResetBtn = document.getElementById('modal-reset-btn');
  const demoForm = document.getElementById('demo-form');
  const modalSuccess = document.getElementById('modal-success');
  const demoUseCaseSelect = document.getElementById('demo-usecase');
  const demoError = document.getElementById('demo-form-error');

  function attachModalListeners() {
    const openDemoBtns = document.querySelectorAll('.open-demo-btn');
    openDemoBtns.forEach(btn => {
      btn.removeEventListener('click', handleOpenModalClick);
      btn.addEventListener('click', handleOpenModalClick);
    });
  }

  function handleOpenModalClick(e) {
    e.preventDefault();
    const useCase = this.getAttribute('data-usecase') || '';
    openModal(useCase, this.hasAttribute('data-quick'));
  }

  // "Book a Demo" in the header opens the same form with only name, email and phone (the other fields are hidden
  // and not required); every other button opens the full form.
  const demoTitleEl = document.getElementById('demo-modal-title');
  const demoSubtitleEl = demoModal ? demoModal.querySelector('.modal-subtitle') : null;
  const DEMO_FULL_TEXT = {
    title: demoTitleEl ? demoTitleEl.textContent : '',
    subtitle: demoSubtitleEl ? demoSubtitleEl.textContent : ''
  };
  const setDemoQuickMode = (quick) => {
    if (!demoModal) return;
    demoModal.classList.toggle('demo-quick', quick);
    demoModal.querySelectorAll('.demo-full-only').forEach((group) => {
      group.querySelectorAll('input, select, textarea').forEach((field) => {
        if (quick) {
          if (field.required) field.dataset.wasRequired = '1';
          field.required = false;
        } else if (field.dataset.wasRequired) {
          field.required = true;
        }
      });
    });
    if (demoTitleEl) demoTitleEl.textContent = quick ? 'Book a demo with Remo' : DEMO_FULL_TEXT.title;
    if (demoSubtitleEl) {
      demoSubtitleEl.textContent = quick
        ? "Share your name, email and phone number and we'll set up your live AI employee demo. A copy of your request will be sent to your email."
        : DEMO_FULL_TEXT.subtitle;
    }
  };

  const openModal = (useCase, quick = false) => {
    if (demoModal) {
      setDemoQuickMode(quick);
      if (quick) useCase = '';
      demoModal.classList.add('active');
      document.body.style.overflow = 'hidden';
      const firstField = document.getElementById('demo-name');
      if (firstField && demoForm && demoForm.style.display !== 'none') setTimeout(() => firstField.focus(), 60);
      if (useCase && demoUseCaseSelect) {
        const option = Array.from(demoUseCaseSelect.options).find(opt => 
          opt.value.toLowerCase().includes(useCase.toLowerCase()) || 
          useCase.toLowerCase().includes(opt.value.toLowerCase())
        );
        if (option) {
          demoUseCaseSelect.value = option.value;
        }
      }
    }
  };

  const closeModal = () => {
    if (demoModal) {
      demoModal.classList.remove('active');
      document.body.style.overflow = '';
      setTimeout(() => {
        if (demoForm) demoForm.style.display = 'flex';
        if (modalSuccess) modalSuccess.classList.remove('visible');
        if (demoError) { demoError.hidden = true; demoError.textContent = ''; }
      }, 300);
    }
  };

  attachModalListeners();

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
  if (modalResetBtn) modalResetBtn.addEventListener('click', closeModal);

  if (demoModal) {
    demoModal.addEventListener('click', (e) => {
      if (e.target === demoModal) closeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && demoModal && demoModal.classList.contains('active')) {
      closeModal();
    }
  });

  if (demoForm) {
    const demoSuccessEmail = document.getElementById('modal-success-email');
    const setDemoError = (message) => {
      if (!demoError) return;
      demoError.textContent = message || '';
      demoError.hidden = !message;
    };

    demoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setDemoError('');

      const submitBtn = demoForm.querySelector('button[type="submit"]');
      const originalHtml = submitBtn.innerHTML;
      const value = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
      };
      const payload = {
        name: value('demo-name'),
        email: value('demo-email'),
        company: value('demo-company'),
        phone: value('demo-phone'),
        useCase: value('demo-usecase'),
        notes: value('demo-notes'),
        website: value('demo-website') // spam trap, should stay empty
      };
      if (demoModal && demoModal.classList.contains('demo-quick')) payload.source = 'book-demo';

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>Sending your request…</span>';

      try {
        const res = await fetch('/api/demo/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.message || 'Something went wrong. Please try again.');
        }
        if (demoSuccessEmail) demoSuccessEmail.textContent = data.email || payload.email;
        demoForm.reset();
        demoForm.style.display = 'none';
        if (modalSuccess) modalSuccess.classList.add('visible');
      } catch (err) {
        setDemoError(err instanceof TypeError
          ? "We couldn't reach the server. Please check your connection and try again."
          : err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
      }
    });
  }

  // ------------------------------------------------------------------------
  // I. GLOBAL HUMAN TOUCH: SMOOTH SECTION REVEALS & TACTILE CLICKS
  // ------------------------------------------------------------------------
  const interactiveBtns = document.querySelectorAll('.btn, .nav-link, .ind-pill-btn, .hiw-step-card');
  interactiveBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      playHumanChime('click');
    });
  });

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    const revealElements = document.querySelectorAll('.human-pillar-card, .caller-quote-card, .hiw-step-card, .ind-preview-card');
    revealElements.forEach(el => {
      el.classList.add('fade-in-up');
      revealObserver.observe(el);
    });
  }

});
