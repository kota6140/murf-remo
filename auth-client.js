/**
 * Agent Hari — Client-Side Authentication Manager
 * Handles API calls, state management, form validations, and navigation updates.
 */

const AuthClient = {
  /**
   * Fetch current authenticated user from /api/auth/me
   */
  async getCurrentUser() {
    try {
      const res = await fetch('/api/auth/me', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        credentials: 'include'
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.success ? data.user : null;
    } catch (err) {
      console.warn('[AUTH] Could not fetch current user:', err);
      return null;
    }
  },

  /**
   * Register new user
   */
  async signup(payload) {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Signup failed.');
    }
    return data;
  },

  /**
   * POST JSON helper used by the OTP steps
   */
  async postJson(url, payload, fallbackMessage) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok || !data.success) {
      const err = new Error(data.message || fallbackMessage);
      err.expired = !!data.expired;
      err.notRegistered = !!data.notRegistered;
      err.retryAfterSec = data.retryAfterSec;
      throw err;
    }
    return data;
  },

  verifySignup(payload) {
    return this.postJson('/api/auth/signup/verify', payload, 'Verification failed.');
  },

  resendSignup(payload) {
    return this.postJson('/api/auth/signup/resend', payload, 'Could not resend the code.');
  },

  /**
   * "Resend code" button with a countdown
   */
  startResendTimer(btn, seconds = 45) {
    if (!btn) return;
    if (btn._timer) clearInterval(btn._timer);
    let left = seconds;
    btn.disabled = true;
    btn.textContent = `Resend code in ${left}s`;
    btn._timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(btn._timer);
        btn.disabled = false;
        btn.textContent = 'Resend code';
      } else {
        btn.textContent = `Resend code in ${left}s`;
      }
    }, 1000);
  },

  /**
   * Keep a code input to digits only
   */
  bindDigitsOnly(input) {
    if (!input) return;
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
    });
  },

  /**
   * Login user
   */
  async login(payload) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Login failed.');
    }
    return data;
  },

  /**
   * Logout user
   */
  async logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        credentials: 'include'
      });
    } catch (err) {
      console.warn('[AUTH] Logout request error:', err);
    }
    window.location.href = '/signin';
  },

  /**
   * Request password reset link
   */
  async forgotPassword(payload) {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Could not process request.');
    }
    return data;
  },

  /**
   * Reset password with token
   */
  async resetPassword(payload) {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Password reset failed.');
    }
    return data;
  },  /**
   * Submit onboarding details
   */
  async completeOnboarding(payload) {
    const res = await fetch('/api/auth/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Could not complete onboarding.');
    }
    return data;
  },

  /**
   * Update profile from dashboard
   */
  async updateProfile(payload) {
    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Could not update profile.');
    }
    return data;
  },

  /**
   * Show alert on form
   */
  showAlert(containerId, message, type = 'error') {
    const container = document.getElementById(containerId);
    if (!container) return;

    let iconSvg = '';
    if (type === 'error') {
      iconSvg = '<svg class="auth-alert-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="16"/></svg>';
    } else if (type === 'success') {
      iconSvg = '<svg class="auth-alert-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    } else {
      iconSvg = '<svg class="auth-alert-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }

    container.innerHTML = `
      <div class="auth-alert auth-alert-${type}">
        ${iconSvg}
        <span>${message}</span>
      </div>
    `;
    container.style.display = 'block';
  },

  clearAlert(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = '';
      container.style.display = 'none';
    }
  },

  /**
   * "Come back here after login": only same-site paths are accepted. The page is kept in sessionStorage
   * so it survives sign up and onboarding as well as sign in.
   */
  isSafeNext(path) {
    return typeof path === 'string' && /^\/(?![\/\\])/.test(path) && !/[\r\n]/.test(path);
  },

  setNext(path) {
    if (!this.isSafeNext(path)) return;
    try { sessionStorage.setItem('authNext', path); } catch (e) { /* storage blocked */ }
  },

  takeNext() {
    try {
      const path = sessionStorage.getItem('authNext');
      sessionStorage.removeItem('authNext');
      return this.isSafeNext(path) ? path : null;
    } catch (e) {
      return null;
    }
  }
};

// ============================================================================
// DOM Initialization & Event Handlers
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {

  // 1. Check & Setup Navigation on Public Website
  const mainNavActions = document.getElementById('main-nav-actions');
  if (mainNavActions) {
    const user = await AuthClient.getCurrentUser();
    if (user) {
      const destination = user.profileCompleted ? '/dashboard' : '/onboarding';
      mainNavActions.innerHTML = `
        <a href="${destination}" class="btn btn-outline btn-sm" id="nav-dashboard-btn">
          <span>Dashboard</span>
        </a>
        <button class="btn btn-secondary btn-sm" id="nav-logout-btn">
          <span>Logout</span>
        </button>
      `;

      const logoutBtn = document.getElementById('nav-logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
          e.preventDefault();
          AuthClient.logout();
        });
      }
    } else {
      // Unauthenticated state: Ensure links go to dedicated routes
      mainNavActions.innerHTML = `
        <a href="/signin" class="btn btn-outline btn-sm" id="nav-signin-btn">
          <span>Login</span>
        </a>
        <a href="/signup" class="btn btn-primary btn-sm btn-glow" id="nav-signup-btn">
          <span>Create Account</span>
        </a>
      `;
    }
  }

  // 1b. Remember where to send the visitor after sign in / sign up (e.g. /signin?next=%2F%23instant-call-demo)
  if (document.getElementById('signin-form') || document.getElementById('signup-form')) {
    const nextParam = new URLSearchParams(window.location.search).get('next');
    if (nextParam) AuthClient.setNext(nextParam);
  }

  // 2. Google OAuth UI Button Handler (Placeholder Only)
  const googleBtn = document.getElementById('btn-google-auth');
  if (googleBtn) {
    googleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      AuthClient.showAlert('auth-alert-container', 'Google authentication will be available soon.', 'info');
    });
  }

  // 3. Password Toggle Handlers
  document.querySelectorAll('.btn-toggle-pwd').forEach(btn => {
    btn.addEventListener('click', () => {
      const inputId = btn.getAttribute('data-target');
      const input = document.getElementById(inputId);
      if (!input) return;

      if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
      } else {
        input.type = 'password';
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
      }
    });
  });

  // 4. Signup Form Handler
  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      AuthClient.clearAlert('auth-alert-container');

      const name = document.getElementById('signup-name').value.trim();
      const email = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      const confirmPassword = document.getElementById('signup-confirm-password').value;
      const submitBtn = signupForm.querySelector('button[type="submit"]');

      // Client-side validations
      if (!name || name.length < 2) {
        AuthClient.showAlert('auth-alert-container', 'Please enter your full name (at least 2 characters).');
        return;
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        AuthClient.showAlert('auth-alert-container', 'Please enter a valid email address.');
        return;
      }
      if (!password || password.length < 6) {
        AuthClient.showAlert('auth-alert-container', 'Password must contain at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        AuthClient.showAlert('auth-alert-container', 'Passwords do not match. Please verify your password.');
        return;
      }

      // Submit: step 1 emails a verification code
      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="auth-spinner"></span> <span>Sending code...</span>`;

      try {
        const result = await AuthClient.signup({ name, email, password, confirmPassword });
        showSignupOtpStep(result.email || email, result.message);
      } catch (err) {
        AuthClient.showAlert('auth-alert-container', err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    });

    // ---- Step 2: verify the emailed code ----
    const otpForm = document.getElementById('otp-form');
    const otpInput = document.getElementById('otp-input');
    const otpResendBtn = document.getElementById('otp-resend');
    const otpChangeBtn = document.getElementById('otp-change');
    let pendingEmail = '';
    AuthClient.bindDigitsOnly(otpInput);

    function toggleSignupSteps(showOtp) {
      signupForm.style.display = showOtp ? 'none' : '';
      otpForm.style.display = showOtp ? '' : 'none';
      const divider = document.querySelector('.auth-divider');
      const googleBtn2 = document.getElementById('btn-google-auth');
      if (divider) divider.style.display = showOtp ? 'none' : '';
      if (googleBtn2) googleBtn2.style.display = showOtp ? 'none' : '';
      const headline = document.querySelector('.auth-headline');
      const subtitle = document.querySelector('.auth-subtitle');
      if (headline) headline.textContent = showOtp ? 'Verify your email' : 'Create your TakeRemo account';
      if (subtitle && showOtp) subtitle.textContent = `Enter the 6-digit code we emailed to ${pendingEmail}.`;
      if (subtitle && !showOtp) subtitle.textContent = 'Start building conversations that move your business forward.';
    }

    function showSignupOtpStep(email, message) {
      pendingEmail = email;
      toggleSignupSteps(true);
      AuthClient.showAlert('auth-alert-container', message || `We sent a 6-digit code to ${email}.`, 'success');
      otpInput.value = '';
      otpInput.focus();
      AuthClient.startResendTimer(otpResendBtn, 45);
    }

    otpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      AuthClient.clearAlert('auth-alert-container');
      const otp = otpInput.value.trim();
      const btn = otpForm.querySelector('button[type="submit"]');

      if (!/^\d{6}$/.test(otp)) {
        AuthClient.showAlert('auth-alert-container', 'Please enter the 6-digit code.');
        return;
      }

      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="auth-spinner"></span> <span>Verifying...</span>`;

      try {
        const result = await AuthClient.verifySignup({ email: pendingEmail, otp });
        AuthClient.showAlert('auth-alert-container', 'Email verified! Preparing workspace...', 'success');
        setTimeout(() => {
          if (result.user && result.user.profileCompleted) {
            const isAdmin = (result.user.role || 'user').toLowerCase() === 'admin';
            window.location.href = AuthClient.takeNext() || (isAdmin ? '/dashboard' : '/user-dashboard');
          } else {
            window.location.href = '/onboarding';
          }
        }, 600);
      } catch (err) {
        AuthClient.showAlert('auth-alert-container', err.message);
        btn.disabled = false;
        btn.innerHTML = originalText;
        if (err.expired) {
          // Code is burned: let the user request a new one right away
          otpResendBtn.disabled = false;
          otpResendBtn.textContent = 'Resend code';
        }
      }
    });

    otpResendBtn.addEventListener('click', async () => {
      AuthClient.clearAlert('auth-alert-container');
      otpResendBtn.disabled = true;
      try {
        const res = await AuthClient.resendSignup({ email: pendingEmail });
        AuthClient.showAlert('auth-alert-container', res.message, 'success');
        otpInput.value = '';
        otpInput.focus();
        AuthClient.startResendTimer(otpResendBtn, 45);
      } catch (err) {
        AuthClient.showAlert('auth-alert-container', err.message);
        if (err.expired) {
          // The pending signup is gone (server restarted or timed out): start over
          setTimeout(() => { toggleSignupSteps(false); AuthClient.clearAlert('auth-alert-container'); }, 1800);
        } else if (err.retryAfterSec) {
          AuthClient.startResendTimer(otpResendBtn, err.retryAfterSec);
        } else {
          otpResendBtn.disabled = false;
        }
      }
    });

    otpChangeBtn.addEventListener('click', () => {
      AuthClient.clearAlert('auth-alert-container');
      toggleSignupSteps(false);
    });
  }

  // 5. Signin Form Handler
  const signinForm = document.getElementById('signin-form');
  if (signinForm) {
    if (new URLSearchParams(window.location.search).get('notice') === 'register') {
      AuthClient.showAlert('auth-alert-container', 'This email is not registered. Please register first using "Create Account" below.', 'info');
    }
    signinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      AuthClient.clearAlert('auth-alert-container');

      const email = document.getElementById('signin-email').value.trim();
      const password = document.getElementById('signin-password').value;
      const submitBtn = signinForm.querySelector('button[type="submit"]');

      if (!email || !password) {
        AuthClient.showAlert('auth-alert-container', 'Please fill in both email and password.');
        return;
      }

      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="auth-spinner"></span> <span>Logging in...</span>`;

      try {
        const result = await AuthClient.login({ email, password });
        AuthClient.showAlert('auth-alert-container', 'Logged in successfully! Redirecting...', 'success');
        setTimeout(() => {
          if (result.user && result.user.profileCompleted) {
            const isAdmin = (result.user.role || 'user').toLowerCase() === 'admin';
            window.location.href = AuthClient.takeNext() || (isAdmin ? '/dashboard' : '/user-dashboard');
          } else {
            window.location.href = '/onboarding';
          }
        }, 600);
      } catch (err) {
        AuthClient.showAlert('auth-alert-container', err.message);
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    });
  }

  // 6. Forgot Password: step 1 (email a code) + step 2 (code and new password)
  const forgotForm = document.getElementById('forgot-password-form');
  const resetOtpForm = document.getElementById('reset-otp-form');
  if (forgotForm && resetOtpForm) {
    const resetOtpInput = document.getElementById('reset-otp');
    const resetResendBtn = document.getElementById('reset-resend');
    const resetChangeBtn = document.getElementById('reset-change');
    const subtitle = document.getElementById('forgot-subtitle');
    const headline = document.querySelector('.auth-headline');
    let resetEmail = '';
    AuthClient.bindDigitsOnly(resetOtpInput);

    function toggleResetSteps(showOtp) {
      forgotForm.style.display = showOtp ? 'none' : '';
      resetOtpForm.style.display = showOtp ? '' : 'none';
      if (headline) headline.textContent = showOtp ? 'Enter your code' : 'Forgot your password?';
      if (subtitle) {
        subtitle.textContent = showOtp
          ? `Enter the 6-digit code sent to ${resetEmail} and choose a new password.`
          : "Enter your registered email address and we'll send you a 6-digit code to reset your password.";
      }
    }

    async function requestResetCode(email) {
      return AuthClient.postJson('/api/auth/forgot-password', { email }, 'Could not process request.');
    }

    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      AuthClient.clearAlert('auth-alert-container');

      const email = document.getElementById('forgot-email').value.trim();
      const submitBtn = forgotForm.querySelector('button[type="submit"]');

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        AuthClient.showAlert('auth-alert-container', 'Please enter your registered email address.');
        return;
      }

      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="auth-spinner"></span> <span>Sending...</span>`;

      try {
        const res = await requestResetCode(email);
        resetEmail = res.email || email.toLowerCase();
        toggleResetSteps(true);
        AuthClient.showAlert('auth-alert-container', res.message, 'success');
        resetOtpInput.value = '';
        resetOtpInput.focus();
        AuthClient.startResendTimer(resetResendBtn, 45);
      } catch (err) {
        if (err.notRegistered) {
          // Not registered: send them to the sign-in page with a "register first" notice
          window.location.href = '/signin?notice=register';
          return;
        }
        AuthClient.showAlert('auth-alert-container', err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    });

    resetOtpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      AuthClient.clearAlert('auth-alert-container');

      const otp = resetOtpInput.value.trim();
      const newPassword = document.getElementById('reset-new-password').value;
      const confirmPassword = document.getElementById('reset-confirm-password').value;
      const submitBtn = resetOtpForm.querySelector('button[type="submit"]');

      if (!/^\d{6}$/.test(otp)) {
        AuthClient.showAlert('auth-alert-container', 'Please enter the 6-digit code.');
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        AuthClient.showAlert('auth-alert-container', 'New password must contain at least 6 characters.');
        return;
      }
      if (newPassword !== confirmPassword) {
        AuthClient.showAlert('auth-alert-container', 'Passwords do not match.');
        return;
      }

      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="auth-spinner"></span> <span>Resetting Password...</span>`;

      try {
        await AuthClient.postJson('/api/auth/reset-password', { email: resetEmail, otp, newPassword, confirmPassword }, 'Password reset failed.');
        AuthClient.showAlert('auth-alert-container', 'Password updated successfully! Redirecting to login...', 'success');
        setTimeout(() => { window.location.href = '/signin'; }, 1500);
      } catch (err) {
        AuthClient.showAlert('auth-alert-container', err.message);
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        if (err.expired) {
          resetResendBtn.disabled = false;
          resetResendBtn.textContent = 'Resend code';
        }
      }
    });

    resetResendBtn.addEventListener('click', async () => {
      AuthClient.clearAlert('auth-alert-container');
      resetResendBtn.disabled = true;
      try {
        const res = await requestResetCode(resetEmail);
        AuthClient.showAlert('auth-alert-container', res.message, 'success');
        resetOtpInput.value = '';
        resetOtpInput.focus();
        AuthClient.startResendTimer(resetResendBtn, 45);
      } catch (err) {
        AuthClient.showAlert('auth-alert-container', err.message);
        resetResendBtn.disabled = false;
      }
    });

    resetChangeBtn.addEventListener('click', () => {
      AuthClient.clearAlert('auth-alert-container');
      toggleResetSteps(false);
    });
  }

  // 8. Protected Account Page Handler (/account)
  const accountContainer = document.getElementById('account-protected-page');
  if (accountContainer) {
    const user = await AuthClient.getCurrentUser();
    if (!user) {
      // Unauthenticated: Redirect to /signin immediately
      window.location.href = '/signin';
      return;
    }

    // Populate user details
    const userNameEl = document.getElementById('acc-user-name');
    const userEmailEl = document.getElementById('acc-user-email');
    const userInitialEl = document.getElementById('acc-user-avatar');

    if (userNameEl) userNameEl.textContent = user.name;
    if (userEmailEl) userEmailEl.textContent = user.email;
    if (userInitialEl) {
      const parts = user.name.trim().split(' ');
      const initials = parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0][0].toUpperCase();
      userInitialEl.textContent = initials;
    }

    // Logout button handler
    const accountLogoutBtn = document.getElementById('btn-account-logout');
    if (accountLogoutBtn) {
      accountLogoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        AuthClient.logout();
      });
    }
  }

});
