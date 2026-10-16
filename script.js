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

  if (instantCallForm && instantMobileInput) {
    instantCallForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (instantTriggerBtn.disabled) return;

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

  const stopHeroVoiceSample = () => {
    if (voiceSampleTimer) clearTimeout(voiceSampleTimer);
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

      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const text = "Hello! I am Remo, your AI employee. I speak with natural cadence, listen without interrupting, and handle your calls with real human warmth.";
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 0.96;
        utter.pitch = 1.04;
        
        const voices = window.speechSynthesis.getVoices();
        const naturalVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Google') || v.name.includes('Daniel') || v.name.includes('Karen')));
        if (naturalVoice) utter.voice = naturalVoice;

        utter.onend = () => stopHeroVoiceSample();
        utter.onerror = () => stopHeroVoiceSample();
        window.speechSynthesis.speak(utter);

        voiceSampleTimer = setTimeout(() => {
          stopHeroVoiceSample();
        }, 6500);
      } else {
        voiceSampleTimer = setTimeout(() => {
          stopHeroVoiceSample();
        }, 5000);
      }
    });
  }

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

  const renderIndustry = (index) => {
    const data = industryData[indTabList[index].getAttribute('data-industry')];
    if (!data) return;
    if (indDisplayTitle) indDisplayTitle.textContent = data.title;
    if (indDisplayText) {
      // each word fades up in turn (see .ind-word in CSS)
      const words = data.text.split(' ').map((w, i) => `<span class="ind-word" style="--w:${i}">${w}</span>`).join(' ');
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
      { duration: IND_DURATION, easing: 'linear', fill: 'forwards' }
    );
    indAnim.onfinish = () => selectIndustry((indCurrent + 1) % indTabList.length);
    if (!indVisible || indHover) indAnim.pause();
  };

  const selectIndustry = (index) => {
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
    startIndProgress();
  };

  indTabList.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      if (i !== indCurrent) selectIndustry(i); else startIndProgress();
    });
  });

  if (indShowcase) {
    indShowcase.addEventListener('pointerenter', () => { indHover = true; if (indAnim) indAnim.pause(); });
    indShowcase.addEventListener('pointerleave', () => { indHover = false; if (indAnim && indVisible) indAnim.play(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        indVisible = entry.isIntersecting;
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

    // Voice clips per scene (Sarvam TTS, generated once into /assets/voices); played only while the section is on screen
    const voiceScenes = [
      [{ src: '/assets/voices/breath.wav', who: 'Remo', text: 'Hi, this is Remo. Take your time… I\'m right here, and I\'m listening.' }],
      [
        { src: '/assets/voices/cut-caller.wav', who: 'Caller', text: 'Sorry to jump in. Can I ask something quickly?' },
        { src: '/assets/voices/cut-remo.wav', who: 'Remo', text: 'Of course. Please, go ahead.' }
      ],
      [{ src: '/assets/voices/care.wav', who: 'Remo', text: 'I\'m really sorry about the trouble. Let me sort this out for you right away.' }],
      [{ src: '/assets/voices/done.wav', who: 'Remo', text: 'All done. I\'ve sent your summary on WhatsApp, confirmed the calendar invite, and updated your notes.' }]
    ];
    voiceScenes.forEach((clips) => clips.forEach((clip) => {
      clip.audio = new Audio();
      clip.audio.preload = 'metadata';
      clip.audio.src = clip.src;
    }));

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
    openModal(useCase);
  }

  const openModal = (useCase) => {
    if (demoModal) {
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
