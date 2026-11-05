/**
 * tests/book_demo_button.test.js
 *
 * The "Book a Demo" button in the index header opens a short form (name, email, phone). The request is saved with
 * source "book-demo" so the owner panel's "60-sec demo requests" section lists it, and the visitor gets a copy by
 * email. The full demo form on the page keeps working as before.
 * Pure functions and file reads; sends no email and opens no database.
 */
import assert from 'assert';
import fs from 'fs';

const { validateDemoRequest, buildConfirmationEmail, BOOK_DEMO_LABEL } = await import('../routes/demo.js');
const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

let total = 0;
let failed = 0;
function test(name, fn) {
    total++;
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const quick = { source: 'book-demo', name: 'Asha Rao', email: 'Asha@Example.com', phone: '+91 98000 00000' };

test('Book a Demo needs only name, email and phone', () => {
    const r = validateDemoRequest(quick);
    assert.ok(r.value, r.error);
    assert.strictEqual(r.value.source, 'book-demo');
    assert.strictEqual(r.value.email, 'asha@example.com');
    assert.strictEqual(r.value.company, '');
    assert.strictEqual(r.value.useCase, BOOK_DEMO_LABEL);
});

test('Book a Demo still checks the name, the email and the phone number', () => {
    assert.ok(validateDemoRequest({ ...quick, name: 'A' }).error);
    assert.ok(validateDemoRequest({ ...quick, email: 'not-an-email' }).error);
    assert.ok(validateDemoRequest({ ...quick, phone: '123' }).error);
    assert.ok(validateDemoRequest({ ...quick, phone: 'call me' }).error);
});

test('The full demo form still needs a company and a use case', () => {
    const full = { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98000 00000' };
    assert.ok(validateDemoRequest(full).error, 'company is required');
    assert.ok(validateDemoRequest({ ...full, company: 'Acme' }).error, 'use case is required');
    const ok = validateDemoRequest({ ...full, company: 'Acme', useCase: 'sales' });
    assert.ok(ok.value);
    assert.strictEqual(ok.value.source, 'demo-form');
});

test('Nobody can pick the quick form by sending a made-up source to skip the full form', () => {
    const r = validateDemoRequest({ name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98000 00000', source: 'instant-call' });
    assert.ok(r.error, 'only book-demo is quick');
});

test('The confirmation email is a copy of what they sent: name, email, phone, no empty company or use case rows', () => {
    const mail = buildConfirmationEmail(validateDemoRequest(quick).value, new Date('2026-11-04T10:00:00Z'));
    assert.ok(/received your TakeRemo demo request/.test(mail.subject));
    for (const part of ['Asha Rao', 'asha@example.com', '+91 98000 00000']) {
        assert.ok(mail.text.includes(part) && mail.html.includes(part), `missing ${part}`);
    }
    assert.ok(!/Company:/.test(mail.text) && !/Primary use case/.test(mail.text));
});

test('The full-form email still lists the company and use case', () => {
    const f = validateDemoRequest({ name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98000 00000', company: 'Acme', useCase: 'sales' }).value;
    const mail = buildConfirmationEmail(f);
    assert.ok(mail.text.includes('Company: Acme') && mail.text.includes('Primary use case: Sales Outreach'));
});

test('The header has the Book a Demo button (desktop and menu), opening the quick form', () => {
    const html = read('index.html');
    const buttons = [...html.matchAll(/<button[^>]*class="[^"]*btn-book-demo[^"]*"[^>]*>/g)].map((m) => m[0]);
    assert.strictEqual(buttons.length, 2);
    for (const b of buttons) assert.ok(b.includes('open-demo-btn') && b.includes('data-quick'), b);
    assert.ok(html.includes('id="nav-book-demo-btn"'));
});

test('The extra fields are hidden and not required in the quick form, and the page sends source book-demo', () => {
    const html = read('index.html');
    assert.strictEqual((html.match(/form-group demo-full-only/g) || []).length, 3, 'company, use case and notes');
    const js = read('script.js');
    assert.ok(js.includes("payload.source = 'book-demo'"));
    assert.ok(js.includes('setDemoQuickMode(quick)'));
    assert.ok(js.includes('field.required = false'));
    assert.ok(read('styles.css').includes('#demo-modal.demo-quick .demo-full-only { display: none; }'));
});

test('The button has the glass look and a shine animation, and respects reduced motion', () => {
    const css = read('styles.css');
    assert.ok(/\.btn-book-demo::after[^}]*animation: bd-shine/.test(css));
    assert.ok(css.includes('@keyframes bd-shine'));
    assert.ok(/backdrop-filter: blur/.test(css.slice(css.indexOf('.btn-book-demo {'))));
    assert.ok(/prefers-reduced-motion: reduce\)[^}]*\{[^}]*\.btn-book-demo/.test(css.slice(css.indexOf('@keyframes bd-glow'))));
});

test('The Book a Demo button is the bright logo red (#FC2415), not dark and not an orange blend', () => {
    const css = read('styles.css');
    const rule = css.slice(css.indexOf('.btn-book-demo {'), css.indexOf('.btn-book-demo > *'));
    assert.ok(/background:\s*#FC2415/i.test(rule), rule);
    assert.ok(!/255,\s*98,\s*58/.test(rule), 'no orange in the button background');
});

test('The index header has no "60-Sec Test" link (desktop bar or phone menu), but the section itself stays', () => {
    const html = read('index.html');
    const header = html.slice(html.indexOf('<header class="top-nav"'), html.indexOf('</header>'));
    assert.ok(!header.includes('60-Sec Test'), 'link must be gone from the header');
    assert.ok(html.includes('id="instant-call-demo"'), 'the 60-second demo section is untouched');
    assert.ok(html.includes('Try 60-Second Demo'), 'the page buttons that point to it are untouched');
});

test('The header has no sound FX button, and the Book a Demo icon does not move on hover', () => {
    const html = read('index.html');
    const nav = html.slice(html.indexOf('id="main-nav-actions"'), html.indexOf('id="nav-menu-toggle"'));
    assert.ok(!nav.includes('btn-sound-toggle') && !nav.includes('Toggle Sound FX'));
    const css = read('styles.css');
    assert.ok(!/\.btn-book-demo[^{]*\.bd-ico/.test(css), 'no rule may move the icon');
});

test('Signing in/out checks never rebuild the header buttons, so Book a Demo (and the menu button) stay', () => {
    const auth = read('auth-client.js');
    assert.ok(!auth.includes('mainNavActions.innerHTML'), 'the whole button area must not be replaced');
    assert.ok(auth.includes('swapNavButton'));
    assert.ok(read('index.html').includes('/auth-client.js?v='), 'the page asks for a fresh copy of the script');
});

test('The owner panel lists, labels and filters Book a Demo requests', () => {
    const panel = read('admin-panel.js');
    assert.ok(panel.includes("'book-demo': 'Book a Demo button'"));
    assert.ok(panel.includes("d.source === 'book-demo'"));
    assert.ok(read('admin.html').includes('<option value="book-demo">'));
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
