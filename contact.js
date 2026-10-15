/* TakeRemo — Contact us form. Same fields, same endpoint and same success message as the 60-second demo form. */
(() => {
  'use strict';
  const $ = (sel) => document.querySelector(sel);
  const form = $('#contact-form');
  const success = $('#contact-success');
  const errorBox = $('#contact-form-error');
  if (!form || !success) return;

  const setError = (msg) => { errorBox.textContent = msg || ''; errorBox.hidden = !msg; };
  const val = (id) => $(id).value.trim();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    const btn = $('#contact-form button[type="submit"]');
    const original = btn.innerHTML;
    const payload = {
      name: val('#contact-name'), email: val('#contact-email'), company: val('#contact-company'), phone: val('#contact-phone'),
      useCase: val('#contact-usecase'), notes: val('#contact-notes'), website: val('#contact-website')
    };
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>Sending your request…</span>';
    try {
      const res = await fetch('/api/demo/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Something went wrong. Please try again.');
      $('#contact-success-email').textContent = data.email || payload.email;
      form.reset();
      form.style.display = 'none';
      success.classList.add('visible');
    } catch (err) {
      setError(err instanceof TypeError ? "We couldn't reach the server. Please check your connection and try again." : err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  $('#contact-reset-btn').addEventListener('click', () => {
    success.classList.remove('visible');
    form.style.display = 'flex';
    setError('');
    $('#contact-name').focus();
  });
})();
