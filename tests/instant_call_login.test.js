/**
 * tests/instant_call_login.test.js
 *
 * The landing page's "Get instant call" needs a signed-in visitor:
 *  - POST /api/demo/instant without a valid session answers 401 and never starts a call.
 *  - The "come back here after login" path (AuthClient.isSafeNext) only accepts same-site paths.
 */
process.env.SKIP_TTS_PRECACHE = '1';

import assert from 'assert';
import fs from 'fs';
import vm from 'vm';
import http from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';

let total = 0;
let failed = 0;
async function test(name, fn) {
    total++;
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const { default: demoRouter } = await import('../routes/demo.js');
const { default: PlivoService } = await import('../services/plivo_service.js');

let calls = 0;
PlivoService.initiateOutboundCall = async () => { calls++; return { success: true, callUuid: 'x' }; };

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/demo', demoRouter);
const server = http.createServer(app).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const post = (headers = {}) => fetch(`${base}/api/demo/instant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ phone: '9876543210' })
});

await test('A visitor who is not signed in gets 401 and no call is placed', async () => {
    const res = await post();
    assert.strictEqual(res.status, 401);
    assert.strictEqual((await res.json()).success, false);
    assert.strictEqual(calls, 0);
});

await test('A broken or forged session token is refused too', async () => {
    const res = await post({ Cookie: 'agent_hari_token=not-a-real-token' });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(calls, 0);
});

// Load auth-client.js without a browser to reach AuthClient.isSafeNext.
const source = fs.readFileSync(new URL('../auth-client.js', import.meta.url), 'utf8');
const sandbox = { document: { addEventListener() {} }, window: {}, fetch() {}, console };
vm.createContext(sandbox);
vm.runInContext(`${source}\nthis.AuthClient = AuthClient;`, sandbox);
const { AuthClient } = sandbox;

await test('The return path accepts the instant-call section and other same-site paths', () => {
    for (const p of ['/#instant-call-demo', '/', '/dashboard', '/user-dashboard?tab=calls']) {
        assert.strictEqual(AuthClient.isSafeNext(p), true, `${p} should be allowed`);
    }
});

await test('The return path rejects other sites, protocol-relative links and non-strings', () => {
    for (const p of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'dashboard', '', null, undefined, '/a\r\nSet-Cookie: x=1']) {
        assert.strictEqual(AuthClient.isSafeNext(p), false, `${String(p)} should be rejected`);
    }
});

console.log(`\n${total - failed}/${total} passed`);
process.exitCode = failed ? 1 : 0;
server.closeAllConnections();
server.close();
