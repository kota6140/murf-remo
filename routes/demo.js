/**
 * routes/demo.js
 * Public "Book a demo" form on the landing page.
 * POST /api/demo/request  -> validates the form, then emails the visitor a confirmation
 * that lists every field they filled in.
 */

import express from 'express';
import crypto from 'crypto';
import { sendEmail, escapeHtml } from '../services/email_service.js';
import { addDemoRequest, readDemoRequests, writeDemoRequests } from '../demo_store.js';

const router = express.Router();

export const USE_CASES = {
    recruitment: 'Recruitment Screening & Interview Scheduling',
    sales: 'Sales Outreach & Lead Qualification',
    support: 'Customer Support & Issue Resolution',
    appointment: 'Appointment Setting & Reminders',
    receptionist: 'AI Receptionist & Call Handling',
    omnichannel: 'Enterprise Voice Operations'
};

// ---- Abuse protection: this endpoint sends mail to whatever address is typed in ----
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 6;
const MAX_PER_EMAIL = 3;
const hits = new Map(); // key -> [timestamps]

function tooMany(key, limit) {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= limit) {
        hits.set(key, recent);
        return true;
    }
    recent.push(now);
    hits.set(key, recent);
    return false;
}

setInterval(() => {
    const now = Date.now();
    for (const [key, list] of hits) {
        const recent = list.filter((t) => now - t < WINDOW_MS);
        if (recent.length) hits.set(key, recent); else hits.delete(key);
    }
}, 10 * 60 * 1000).unref();

// ---- Validation ----
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function validateDemoRequest(body = {}) {
    const name = clean(body.name, 80);
    const email = clean(body.email, 120).toLowerCase();
    const company = clean(body.company, 100);
    const phone = clean(body.phone, 24);
    const useCaseKey = clean(body.useCase, 24);
    // notes may span several lines, so only trim control characters, not newlines
    const notes = String(body.notes ?? '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]+/g, ' ').trim().slice(0, 600);

    if (name.length < 2) return { error: 'Please enter your full name.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Please enter a valid work email address.' };
    if (company.length < 2) return { error: 'Please enter your company name.' };
    const digits = phone.replace(/\D/g, '');
    if (!/^[0-9+()\-\s]+$/.test(phone) || digits.length < 8 || digits.length > 15) {
        return { error: 'Please enter a valid phone number (8 to 15 digits).' };
    }
    if (!Object.prototype.hasOwnProperty.call(USE_CASES, useCaseKey)) return { error: 'Please choose a primary use case.' };

    return { value: { name, email, company, phone, useCaseKey, useCase: USE_CASES[useCaseKey], notes } };
}

// ---- Email ----
export function buildConfirmationEmail(f, when = new Date()) {
    const submittedAt = when.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    }) + ' IST';

    const rows = [
        ['Full name', f.name],
        ['Work email', f.email],
        ['Company', f.company],
        ['Phone number', f.phone],
        ['Primary use case', f.useCase]
    ];
    if (f.notes) rows.push(['Notes', f.notes]);
    rows.push(['Submitted', submittedAt]);

    const rowHtml = rows.map(([label, value], i) => `
        <tr>
          <td style="padding:12px 16px;width:38%;font-size:13px;color:#64748B;border-top:${i ? '1px solid #E8ECF2' : '0'};vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#0F172A;border-top:${i ? '1px solid #E8ECF2' : '0'};vertical-align:top;white-space:pre-line;">${escapeHtml(value)}</td>
        </tr>`).join('');

    const html = `
<div style="background:#F4F6FA;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:18px;overflow:hidden;border:1px solid #E8ECF2;">
    <div style="background:#060B18;padding:28px 32px;">
      <div style="font-size:22px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">take<span style="background:#FC2415;border-radius:8px;padding:1px 8px;margin-left:2px;">remo</span></div>
      <div style="margin-top:6px;font-size:12px;color:#94A3B8;">AI Calling. Human Conversations. Real Results.</div>
    </div>
    <div style="padding:32px;">
      <h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;color:#0F172A;">Thanks ${escapeHtml(f.name.split(' ')[0])}, we've got your request.</h1>
      <p style="margin:0 0 22px;font-size:14.5px;line-height:1.6;color:#475569;">
        Our team will reach out on the number below to set up your live Remo demo. Here is a copy of what you sent us:
      </p>
      <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border:1px solid #E8ECF2;border-radius:12px;background:#F8FAFC;border-collapse:separate;">
        ${rowHtml}
      </table>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#64748B;">
        Something not right? Just reply to this email and we'll fix it. If you didn't ask for this demo, you can safely ignore this message.
      </p>
    </div>
    <div style="padding:18px 32px;background:#F8FAFC;border-top:1px solid #E8ECF2;font-size:12px;color:#94A3B8;">
      Team TakeRemo &middot; AI employees for conversations that move business forward.
    </div>
  </div>
</div>`;

    const text = [
        `Thanks ${f.name.split(' ')[0]}, we've got your request.`,
        '',
        'Our team will reach out on the number below to set up your live Remo demo. Here is a copy of what you sent us:',
        '',
        ...rows.map(([label, value]) => `${label}: ${value}`),
        '',
        "Something not right? Just reply to this email. If you didn't ask for this demo, you can ignore this message.",
        '',
        'Team TakeRemo'
    ].join('\n');

    return { subject: "We've received your TakeRemo demo request", html, text };
}

// ---- POST /api/demo/request ----
router.post('/request', async (req, res) => {
    // Hidden honeypot field: real visitors never fill it. Pretend success so bots learn nothing.
    if (clean(req.body && req.body.website, 200)) {
        return res.status(200).json({ success: true, email: '' });
    }

    const parsed = validateDemoRequest(req.body);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
    const fields = parsed.value;

    // Only well-formed submissions count towards the limits, so typos never lock anyone out
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (tooMany(`ip:${ip}`, MAX_PER_IP)) {
        return res.status(429).json({ success: false, message: 'Too many requests from your connection. Please try again in a little while.' });
    }

    if (tooMany(`email:${fields.email}`, MAX_PER_EMAIL)) {
        return res.status(429).json({ success: false, message: 'We already have recent requests from this email. Please check your inbox (and spam folder).' });
    }

    // Save the lead first so the admin panel has it even if the confirmation email fails
    let saved = null;
    try {
        saved = addDemoRequest({
            id: crypto.randomUUID(),
            source: 'demo-form',
            name: fields.name,
            email: fields.email,
            company: fields.company,
            phone: fields.phone,
            useCaseKey: fields.useCaseKey,
            useCase: fields.useCase,
            notes: fields.notes,
            submittedAt: new Date().toISOString(),
            status: 'new',
            adminNote: '',
            confirmationSent: false
        });
    } catch (e) {
        console.error('[Demo] Could not save demo request:', e.message);
    }

    const mail = buildConfirmationEmail(fields);
    const result = await sendEmail({ to: fields.email, subject: mail.subject, html: mail.html, text: mail.text });

    if (saved && result.success) {
        try {
            const all = readDemoRequests();
            const row = all.find((x) => x.id === saved.id);
            if (row) { row.confirmationSent = true; writeDemoRequests(all); }
        } catch { /* flag is cosmetic */ }
    }

    if (!result.success) {
        console.error('[Demo] Confirmation email failed for a demo request');
        return res.status(502).json({
            success: false,
            message: "We couldn't send your confirmation email right now. Please check the address and try again in a moment."
        });
    }

    console.log(`[Demo] Request received from ${fields.company} (${fields.useCaseKey}); confirmation sent.`);
    return res.status(200).json({ success: true, email: fields.email, message: 'Confirmation email sent.' });
});

// ---- POST /api/demo/instant ----
// The "Get instant call" box on the landing page: the visitor only types a mobile number.
// We just record it so the team can see it in the admin panel under 60-sec demo requests.
router.post('/instant', (req, res) => {
    if (clean(req.body && req.body.website, 200)) return res.status(200).json({ success: true });

    const digits = String(req.body?.phone ?? '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(digits)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (tooMany(`ip:${ip}`, MAX_PER_IP)) {
        return res.status(429).json({ success: false, message: 'Too many requests from your connection. Please try again in a little while.' });
    }

    try {
        const phone = `+91 ${digits}`;
        const all = readDemoRequests();
        const dayAgo = Date.now() - WINDOW_MS;
        // The same number pressed twice in an hour is one lead, not two
        const dup = all.some((x) => x.source === 'instant-call' && x.phone === phone && new Date(x.submittedAt).getTime() > dayAgo);
        if (!dup) {
            addDemoRequest({
                id: crypto.randomUUID(),
                source: 'instant-call',
                name: '',
                email: '',
                company: '',
                phone,
                useCaseKey: '',
                useCase: '',
                notes: '',
                submittedAt: new Date().toISOString(),
                status: 'new',
                adminNote: '',
                confirmationSent: false
            });
            console.log('[Demo] Instant-call number received.');
        }
        return res.status(200).json({ success: true });
    } catch (e) {
        console.error('[Demo] Could not save instant-call number:', e.message);
        return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

export default router;
