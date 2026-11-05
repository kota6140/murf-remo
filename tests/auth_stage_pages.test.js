/**
 * tests/auth_stage_pages.test.js
 *
 * The Login and Create Account pages got an animated look: a night-sky background that shows the five services
 * (drifting events, a live-call spotlight, service tabs) behind a glowing card. This only checks that the pages keep
 * everything auth-client.js needs, that the other auth pages keep the plain look, and that the animation respects
 * "reduce motion". Reads files only; opens no database.
 */
import assert from 'assert';
import fs from 'fs';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const signin = read('signin.html');
const signup = read('signup.html');
const css = read('auth-stage.css');
const js = read('auth-stage.js');

let total = 0;
let failed = 0;
function test(name, fn) {
    total++;
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const COMMON_IDS = ['auth-alert-container', 'btn-google-auth', 'as-chips', 'as-dots'];
const SIGNIN_IDS = ['signin-form', 'signin-email', 'signin-password'];
const SIGNUP_IDS = ['signup-form', 'signup-name', 'signup-email', 'signup-password', 'signup-confirm-password', 'otp-form', 'otp-input', 'otp-resend', 'otp-change'];

test('Both pages load the plain auth styles first, then the animated ones, and the scripts in order', () => {
    for (const html of [signin, signup]) {
        assert.ok(html.indexOf('/auth.css') > 0 && html.indexOf('/auth.css') < html.indexOf('/auth-stage.css'));
        assert.ok(html.includes('<body class="auth-body auth-stage">'));
        assert.ok(html.indexOf('/auth-client.js') < html.indexOf('/auth-stage.js'), 'auth-client first');
    }
});

test('Every element auth-client.js uses is still on the pages', () => {
    for (const id of [...COMMON_IDS, ...SIGNIN_IDS]) assert.ok(signin.includes(`id="${id}"`), `signin: ${id}`);
    for (const id of [...COMMON_IDS, ...SIGNUP_IDS]) assert.ok(signup.includes(`id="${id}"`), `signup: ${id}`);
    for (const html of [signin, signup]) {
        for (const cls of ['auth-headline', 'auth-subtitle', 'auth-divider', 'btn-toggle-pwd', 'btn-auth-primary']) {
            assert.ok(html.includes(`class="${cls}`) || html.includes(` ${cls}"`) || html.includes(`${cls} `), cls);
        }
        assert.strictEqual((html.match(/class="auth-headline"/g) || []).length, 1);
        assert.strictEqual((html.match(/class="auth-subtitle"/g) || []).length, 1);
    }
    assert.ok(/id="otp-form"[^>]*style="display: none;"/.test(signup), 'the code step starts hidden');
});

test('Only the sign-in and sign-up pages get the animated look', () => {
    for (const page of ['forgot-password.html', 'onboarding.html', 'account.html']) {
        assert.ok(!read(page).includes('auth-stage'), `${page} must keep the plain look`);
    }
    assert.ok(!read('auth.css').includes('as-shell'), 'auth.css is untouched');
});

test('The page background is pure white (no dark sky, aurora or floor left)', () => {
    assert.ok(/body\.auth-stage \{[^}]*background: #FFFFFF/i.test(css), 'page is white');
    assert.ok(/\.as-bg \{[^}]*background: #FFFFFF/i.test(css), 'the background layer is white');
    for (const gone of ['#050A1A', '#070F2A', '#0B1E4D', 'as-aurora', 'as-blob', 'as-floor']) {
        assert.ok(!css.includes(gone), `${gone} must be gone from the css`);
    }
    for (const html of [signin, signup]) assert.ok(!html.includes('as-aurora') && !html.includes('as-floor'));
});

test('The logo is the one the services pages use on light backgrounds (dark text), straight on the white page', () => {
    const services = read('service.js');
    assert.ok(services.includes('src="/assets/Takeremo%20AI%20Calling%20Logo%20Transparent.png"'), 'services pages use the Transparent logo on light');
    for (const html of [signin, signup]) {
        assert.ok(html.includes('src="/assets/Takeremo%20AI%20Calling%20Logo%20Transparent.png"'));
        assert.ok(!html.includes('Logo%20Light.png'), 'the white-text logo would vanish on white');
        assert.ok(!html.includes('Calling%20Logo.png'), 'not the old logo');
    }
    assert.ok(!/\.as-logo \{[^}]*background:/.test(css), 'no box behind the logo');
});

test('Layout: logo on top, Industries card left, the form card in the middle, Services card right, highlights below', () => {
    for (const html of [signin, signup]) {
        const logo = html.indexOf('class="as-logo"');
        const left = html.indexOf('id="as-industries"');
        const card = html.indexOf('<main class="auth-card">');
        const right = html.indexOf('id="as-services"');
        const bottom = html.indexOf('id="as-features"');
        assert.ok(logo > 0 && left > logo && card > left && right > card && bottom > right, 'order: logo, industries, card, services, highlights');
        assert.ok(/class="as-panel as-panel-left" id="as-industries"/.test(html) && /class="as-panel as-panel-right" id="as-services"/.test(html));
        assert.ok(/<section class="as-features" id="as-features"/.test(html));
    }
    assert.ok(/\.as-panel-left \{ grid-column: 1; grid-row: 2/.test(css) && /\.as-panel-right \{ grid-column: 3; grid-row: 2/.test(css));
    assert.ok(/\.as-formcol \{[^}]*grid-column: 2; grid-row: 2/.test(css));
    assert.ok(/\.as-logo \{[^}]*grid-column: 1 \/ -1/.test(css) && /\.as-features \{ grid-column: 1 \/ -1; grid-row: 3/.test(css));
});

test('The cards hold the items from the design: 10 industry tiles, 5 service rows, 5 highlights', () => {
    const section = (from, to) => js.slice(js.indexOf(from), js.indexOf(to));
    const ind = section('const INDUSTRIES = [', 'const SERVICE_LIST');
    for (const name of ['Healthcare & Hospitals', 'Banking & Finance', 'Retail & E' + String.fromCharCode(0x2011) + 'commerce', 'Manufacturing & Industrial', 'Education & EdTech',
        'Real Estate & Construction', 'Travel & Hospitality', 'IT & Technology', 'Insurance', 'and many more...']) {
        assert.ok(ind.includes(`name: '${name}'`), name);
    }
    assert.strictEqual((ind.match(/name: '/g) || []).length, 10);
    const svc = section('const SERVICE_LIST = [', '// Bottom row');
    for (const name of ['Customer Support Automation', 'Tele Sales & Lead Generation', 'Recruitment Calling', 'Bulk Calling Campaigns', 'Call Intelligence & Analytics']) {
        assert.ok(svc.includes(`name: '${name}'`), name);
    }
    assert.strictEqual((svc.match(/name: '/g) || []).length, 5);
    assert.ok(svc.includes("sub: 'Handle queries, provide instant responses'") && svc.includes("sub: 'Record, transcribe, summarize & get insights'"), 'one-line descriptions');
    const feat = section('const FEATURES = [', 'const rand');
    for (const name of ['One-Click Campaigns', 'Up to 20,000 Calls/Day', 'Call Recording & Transcription', 'AI Insights & Reports', 'Secure & Reliable']) {
        assert.ok(feat.includes(`name: '${name}'`), name);
    }
    assert.strictEqual((feat.match(/name: '/g) || []).length, 5);
    // the cards have a header (icon, title, one-line subtitle) like the design
    assert.ok(js.includes("'Industries We Serve', 'Powering conversations across every industry.'"));
    assert.ok(js.includes("'Our Services', 'AI-powered calling solutions for your business.'"));
});

test('Each list lights one item at a time (cycling, and on hover), using colour and glow, not movement', () => {
    assert.ok(js.includes("els.forEach((el, k) => el.classList.toggle('is-on', k === state.idx))"));
    assert.ok(js.includes('setInterval') && js.includes("addEventListener('pointerenter'"));
    assert.ok(js.includes('visibilitychange'), 'pauses in a hidden tab');
    assert.strictEqual((js.match(/cycle\(\[/g) || []).length, 3, 'industries, services and highlights each cycle');
    for (const sel of ['.as-tile.is-on, .as-row.is-on', '.as-feature.is-on']) {
        const rule = css.match(new RegExp(sel.replace(/\./g, '\\.') + ' \\{[^}]*\\}'))[0];
        assert.ok(/box-shadow/.test(rule) && !/transform/.test(rule), rule);
    }
    assert.ok(!/\.as-(item|tile|row|feature)[a-z-]*:hover/.test(css), 'no hover movement on cards or icons');
});

test('The background keeps drifting services and particles, and the card keeps its glow', () => {
    for (const k of ['@keyframes as-rise', '@keyframes as-twinkle', '@keyframes as-angle', '@keyframes as-shine']) assert.ok(css.includes(k), k);
    assert.ok(js.includes('buildBackground') && js.includes('buildSidePanels') && js.includes('staggerCard'));
    const block = js.slice(js.indexOf('const SERVICES = ['), js.indexOf('// Icons'));
    for (const key of ['recruitment', 'sales', 'support', 'appointment', 'receptionist']) assert.ok(block.includes(`key: '${key}'`), key);
});

test('The button is the bright logo red with a shine, and the card does not tilt or move on hover', () => {
    assert.ok(/\.btn-auth-primary \{[^}]*background: #FC2415/.test(css));
    assert.ok(css.includes('.btn-auth-primary::after'));
    assert.ok(!/\.auth-card:hover/.test(css), 'no card hover movement');
    assert.ok(!/(\.as-ico|\.as-logo)[^{]*:hover/.test(css), 'no icon hover movement');
});

test('Reduce-motion turns the movement off', () => {
    assert.ok(css.includes('prefers-reduced-motion: reduce'));
    assert.ok(js.includes("matchMedia('(prefers-reduced-motion: reduce)')"));
});

test('The phone layout fits (16px inputs stop iOS zoom), and the page script is valid', () => {
    assert.ok(/@media \(max-width: 520px\)[\s\S]*font-size: 16px/.test(css));
    new Function(js);
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
