/**
 * tests/no_hardcoded_company.test.js
 *
 * No company name is built into what Remo says. A script names a company only when the campaign
 * document (or the agent's own greeting / instructions) gives one; with none it names no company.
 * Covers the opening greetings, the "who is this" / "why are you calling" replies, the language-switch
 * replies, the AI-failure fallbacks and the document fallbacks, in English, Hindi and Telugu.
 */
process.env.SKIP_TTS_PRECACHE = '1';
process.env.DB_ENGINE = 'sqlite'; // never reach the real database from this test

import assert from 'assert';
import fs from 'fs';
import GreetingScript from '../services/greeting_script.js';
import GeminiService from '../services/gemini_service.js';
import IntentService from '../services/intent_service.js';
import DocumentService from '../services/document_service.js';

let total = 0;
let failed = 0;
async function test(name, fn) {
    total++;
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// Any spelling of the built-in company, in Latin, Devanagari and Telugu script.
const BUILT_IN = /score ?labs|स्कोर ?लैब|స్కోర్ ?ల్యాబ్స్|స్కోర్‌ల్యాబ్స్/i;
const LANGS = ['en', 'hi', 'te'];
const SERVICES = ['sales', 'recruitment', 'support', 'appointment', 'receptionist'];
const clean = (line, label) => {
    assert.ok(typeof line === 'string' && line.length > 10, `${label}: has a line`);
    assert.ok(!BUILT_IN.test(line), `${label}: must not name Scorelabs -> "${line}"`);
    assert.ok(!/\bfrom\s+(\.|,|\s)|calling from\s*[.,]/i.test(line), `${label}: no dangling "from" -> "${line}"`);
    assert.ok(!/undefined|null|\$\{/.test(line), `${label}: no template leftovers -> "${line}"`);
};

await test('Opening greetings (every work type, language, named or not, inbound or outbound) name no company', () => {
    for (const service of SERVICES) {
        for (const language of LANGS) {
            for (const name of ['', 'Ravi']) {
                for (const direction of ['outbound', 'inbound']) {
                    clean(GeminiService.getOpeningGreeting(service, { name, language, direction }), `${service}/${language}/${name || 'unnamed'}/${direction}`);
                }
            }
        }
    }
});

await test('A campaign document\'s company is still spoken in the opening', () => {
    for (const service of ['sales', 'support', 'appointment', 'receptionist']) {
        const line = GeminiService.getOpeningGreeting(service, { name: '', language: 'en', direction: 'outbound', campaignContext: { company_name: 'Axis Bank' } });
        assert.ok(line.includes('Axis Bank'), `${service}: ${line}`);
    }
    assert.ok(GreetingScript.recruitmentIntro('en', 'Java Developer', 'Axis Bank').includes('from Axis Bank'));
    assert.ok(GreetingScript.recruitmentIntro('hi', '', 'Axis Bank').includes('Axis Bank से'));
});

await test('Recruitment opening has no company by default, in all seven languages', () => {
    for (const lang of ['en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr']) {
        clean(GreetingScript.recruitmentIntro(lang, 'Java Developer', ''), `recruitment intro ${lang}`);
        clean(GreetingScript.whoIsCalling(lang), `who is calling ${lang}`);
    }
    assert.strictEqual(GreetingScript.recruitmentIntro('en', '', ''), 'Hi, this is Remo calling. Is now a good time to speak for a minute?');
    assert.strictEqual(GreetingScript.whoIsCalling('en'), 'This is Remo, an AI calling assistant. Is now a good time to talk?');
    assert.strictEqual(GreetingScript.whoIsCalling('en', 'Axis Bank'), 'This is Remo, an AI calling assistant from Axis Bank. Is now a good time to talk?');
});

await test('The AI-failure fallback lines name no company', () => {
    for (const service of SERVICES) {
        for (const language of LANGS) {
            for (const stage of ['PERMISSION_CHECK', 'QUALIFICATION', 'CLOSING', undefined]) {
                clean(GeminiService.getUniversalFallback(language, service, stage), `fallback ${service}/${language}/${stage}`);
            }
        }
    }
});

await test('Quick replies ("who is this", "why are you calling", "speak in Hindi/Telugu", "yes") name no company', () => {
    for (const service of ['sales', 'recruitment', 'support', 'appointment']) {
        for (const lang of LANGS) {
            for (const [text, stage] of [['Who is this?', 'GREETING'], ['What is this call about?', 'AVAILABILITY'], ['yes', 'GREETING'], ['yes', 'PERMISSION_CHECK']]) {
                const r = IntentService.matchIntent(text, { service, stage, language: lang, collectedData: {} });
                if (r.matched) clean(r.spoken_response, `${service}/${lang}/"${text}"/${stage}`);
            }
        }
        for (const text of ['please speak in hindi', 'telugu lo matladandi']) {
            const r = IntentService.matchIntent(text, { service, stage: 'AVAILABILITY', language: 'en', contact: { job_role: 'Java Developer' } });
            assert.ok(r.matched, `${service}: ${text}`);
            clean(r.spoken_response, `${service}/"${text}"`);
        }
    }
    const named = IntentService.matchIntent('Who is this?', { service: 'sales', stage: 'GREETING', language: 'en', campaignContext: { company_name: 'Axis Bank' } });
    assert.ok(named.spoken_response.includes('from Axis Bank'), named.spoken_response);
});

await test('Document fallbacks no longer assign a company, so none reaches the call', () => {
    const fallbacks = [
        DocumentService._fallbackJDHeuristic('Looking for a Java developer', 'jd.pdf'),
        DocumentService._fallbackSalesHeuristic('Product: Savings account', 'sales.pdf'),
        DocumentService._fallbackBusinessHeuristic('Services: checkups', '', 'appointment'),
        DocumentService._fallbackBusinessHeuristic('Services: checkups', '', 'receptionist'),
        DocumentService._fallbackSupportHeuristic('Step 1: restart', 'support.pdf')
    ];
    for (const f of fallbacks) {
        assert.ok(!BUILT_IN.test(JSON.stringify(f)), `fallback must not name Scorelabs: ${JSON.stringify(f).slice(0, 120)}`);
        assert.strictEqual(f.company_name, '', 'company stays empty when the document names none');
        if (f.opening_greeting) assert.ok(!/ from\s*[.,]/.test(f.opening_greeting), f.opening_greeting);
    }
    assert.strictEqual(DocumentService._fallbackSalesHeuristic('Company: Axis Bank\nProduct: Savings', 'x.pdf').company_name, 'Axis Bank');
});

await test('The spoken-script source files contain no built-in company at all', () => {
    for (const file of ['gemini_service', 'intent_service', 'greeting_script', 'question_planner', 'sales_state', 'voicebot_stream_service', 'document_service', 'excel_service', 'agent_service']) {
        const text = fs.readFileSync(new URL(`../services/${file}.js`, import.meta.url), 'utf8');
        const hit = text.split('\n').findIndex((l) => BUILT_IN.test(l));
        assert.strictEqual(hit, -1, `${file}.js line ${hit + 1} still names Scorelabs: ${text.split('\n')[hit]}`);
    }
});

console.log(`\n${total - failed}/${total} passed`);
process.exitCode = failed ? 1 : 0;
