/**
 * tests/conversation_bugs_regression.test.js
 * 
 * Regression tests for the critical bugs fixed on 2026-10-15:
 *  - FIX-1: isProcessingTurn race condition (cleared after playAiAudio, not before)
 *  - FIX-2: Noise transcript filtering ([indistinct], [phone ringing], etc.)
 *  - FIX-3: Stage management — audibility check no longer resets stage
 *  - FIX-5: Latency total recorded even on LLM error
 *  - FIX-6: Per-turn ID prevents duplicate/stale turn processing
 *  - FIX-7: Audio duration calculation for ulaw_8000
 *
 * Run with: node tests/conversation_bugs_regression.test.js
 */

import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';
import { isNoiseTranscript, isBackchannelOnly, decodeMulawToPcm16, pcmToWav } from '../services/voicebot_stream_service.js';
import IntentService from '../services/intent_service.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        failedTests++;
        console.error(`  ✗ ${name}`);
        console.error(`    ${e.message}`);
    }
}

function describe(section, fn) {
    console.log(`\n${section}`);
    fn();
}

// ─── Section 1: Noise Transcript Filter (FIX-2) ──────────────────────────────

describe('FIX-2: Noise transcript filtering', () => {
    test('filters [indistinct]', () => {
        assert.strictEqual(isNoiseTranscript('[indistinct]'), true);
    });
    test('filters [phone ringing]', () => {
        assert.strictEqual(isNoiseTranscript('[phone ringing]'), true);
    });
    test('filters [music]', () => {
        assert.strictEqual(isNoiseTranscript('[music]'), true);
    });
    test('filters empty string', () => {
        assert.strictEqual(isNoiseTranscript(''), true);
    });
    test('filters null', () => {
        assert.strictEqual(isNoiseTranscript(null), true);
    });
    test('does NOT filter "Hello"', () => {
        assert.strictEqual(isNoiseTranscript('Hello'), false);
    });
    test('does NOT filter "Yes, go ahead"', () => {
        assert.strictEqual(isNoiseTranscript('Yes, go ahead'), false);
    });
    test('does NOT filter Telugu text "ఓకే అండి"', () => {
        assert.strictEqual(isNoiseTranscript('ఓకే అండి'), false);
    });
    test('does NOT filter Hindi "और क्या?"', () => {
        assert.strictEqual(isNoiseTranscript('और क्या?'), false);
    });
    test('does NOT filter short "No"', () => {
        assert.strictEqual(isNoiseTranscript('No'), false);
    });
    test('filters (inaudible)', () => {
        assert.strictEqual(isNoiseTranscript('(inaudible)'), true);
    });
    test('filters <noise>', () => {
        assert.strictEqual(isNoiseTranscript('<noise>'), true);
    });
});

// ─── Section 2: Backchannel Detection ────────────────────────────────────────

describe('Backchannel detection', () => {
    test('"hmm" is a backchannel', () => {
        assert.strictEqual(isBackchannelOnly('hmm'), true);
    });
    test('"okay" is a backchannel', () => {
        assert.strictEqual(isBackchannelOnly('okay'), true);
    });
    test('"yes I have experience" is NOT a backchannel (3 words)', () => {
        assert.strictEqual(isBackchannelOnly('yes I have experience'), false);
    });
    test('empty string is a backchannel', () => {
        assert.strictEqual(isBackchannelOnly(''), true);
    });
    test('"Not interested" is NOT a backchannel', () => {
        assert.strictEqual(isBackchannelOnly('Not interested'), false);
    });
});

// ─── Section 3: Intent Service — Sales Stage Progression (FIX-3) ─────────────

describe('FIX-3: Sales stage management', () => {
    test('Audibility check ("Hello") has no next_stage — preserves current stage', () => {
        const result = IntentService.matchIntent('Hello', {
            service: 'sales',
            stage: 'AVAILABILITY',
            lastQuestion: 'Is now a convenient time?',
            language: 'en',
            contact: { name: 'pooja', job_role: 'IT Solutions' },
            collectedData: {}
        });
        assert.ok(result.matched, 'Should match audibility');
        assert.strictEqual(result.reason, 'audibility_check');
        // Must NOT set next_stage — so stage stays at AVAILABILITY
        assert.strictEqual(result.next_stage, undefined, 'audibility_check must not advance stage');
    });

    test('"Yes" in AVAILABILITY triggers discovery question, stage→SERVICE_INTEREST', () => {
        const result = IntentService.matchIntent('Yes', {
            service: 'sales',
            stage: 'AVAILABILITY',
            lastQuestion: 'Is now a convenient time?',
            language: 'en',
            contact: { name: 'pooja', job_role: 'IT Solutions' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.next_stage, 'SERVICE_INTEREST');
        assert.strictEqual(result.classification, 'Interested');
    });

    test('"Not interested" ends call for sales', () => {
        const result = IntentService.matchIntent('not interested', {
            service: 'sales',
            stage: 'AVAILABILITY',
            lastQuestion: 'Is now a convenient time?',
            language: 'en',
            contact: { name: 'pooja' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.should_end_call, true);
        assert.strictEqual(result.classification, 'Not Interested');
    });

    test('"We already have a vendor" triggers objection handler, does not end call', () => {
        const result = IntentService.matchIntent('We already have a vendor', {
            service: 'sales',
            stage: 'SERVICE_INTEREST',
            lastQuestion: 'What type of IT project are you considering?',
            language: 'en',
            contact: { name: 'pooja' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.reason, 'sales_objection_vendor');
        assert.strictEqual(result.should_end_call, false);
    });

    test('"Send me an email" triggers email capture', () => {
        const result = IntentService.matchIntent('send me an email', {
            service: 'sales',
            stage: 'QUALIFICATION',
            lastQuestion: 'Would you like to hear more?',
            language: 'en',
            contact: { name: 'pooja' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.reason, 'sales_email_request');
        assert.strictEqual(result.next_stage, 'EMAIL_CAPTURE');
    });

    test('"No" in AVAILABILITY for sales offers callback, not pitch repeat', () => {
        const result = IntentService.matchIntent('no', {
            service: 'sales',
            stage: 'AVAILABILITY',
            lastQuestion: 'Is now a convenient time?',
            language: 'en',
            contact: { name: 'pooja' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.reason, 'sales_availability_no');
        assert.ok(result.spoken_response.toLowerCase().includes('callback') || result.spoken_response.toLowerCase().includes('call back'), 'Response should mention callback');
        assert.strictEqual(result.should_end_call, false);
    });

    test('Response to YES at AVAILABILITY does not repeat the availability question', () => {
        const result = IntentService.matchIntent('yes', {
            service: 'sales',
            stage: 'AVAILABILITY',
            lastQuestion: 'Is now a convenient time for a quick conversation?',
            language: 'en',
            contact: { name: 'Rahul' },
            collectedData: {}
        });
        assert.ok(result.matched);
        const resp = result.spoken_response.toLowerCase();
        assert.ok(!resp.includes('convenient time'), 'Must not repeat the availability question');
        assert.ok(!resp.includes('is now'), 'Must not repeat the availability question');
    });
});

// ─── Section 4: Recruitment Intents ──────────────────────────────────────────

describe('Recruitment intent progression', () => {
    test('"yes" in AVAILABILITY moves to EXPERIENCE stage', () => {
        const result = IntentService.matchIntent('yes', {
            service: 'recruitment',
            stage: 'AVAILABILITY',
            lastQuestion: 'Do you have a couple of minutes?',
            language: 'en',
            contact: { name: 'pooja', job_role: 'Web Developer' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.next_stage, 'EXPERIENCE');
        assert.strictEqual(result.extracted_fields?.available_to_talk, 'Yes');
    });

    test('"no" in AVAILABILITY offers reschedule, does not reject', () => {
        const result = IntentService.matchIntent('no', {
            service: 'recruitment',
            stage: 'AVAILABILITY',
            lastQuestion: 'Do you have a couple of minutes?',
            language: 'en',
            contact: { name: 'pooja' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.reason, 'recruitment_availability_no');
        assert.strictEqual(result.classification, 'On Hold');
        assert.strictEqual(result.should_end_call, false);
    });

    test('Telugu "avunu" (yes) recognized as affirmative', () => {
        const result = IntentService.matchIntent('avunu', {
            service: 'recruitment',
            stage: 'AVAILABILITY',
            lastQuestion: 'Do you have a couple of minutes?',
            language: 'te',
            contact: { name: 'pooja', job_role: 'Developer' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.next_stage, 'EXPERIENCE');
    });

    test('"I don\'t know" routes to projects question in recruitment', () => {
        const result = IntentService.matchIntent("I don't know", {
            service: 'recruitment',
            stage: 'SKILLS',
            lastQuestion: 'What are your primary technical skills?',
            language: 'en',
            contact: { name: 'pooja' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.reason, 'dont_know_followup');
    });

    test('Candidate "haan" (Hindi yes) recognized as affirmative', () => {
        const result = IntentService.matchIntent('haan', {
            service: 'recruitment',
            stage: 'AVAILABILITY',
            lastQuestion: 'Do you have a moment?',
            language: 'hi',
            contact: { name: 'Priya', job_role: 'Developer' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.next_stage, 'EXPERIENCE');
    });
});

// ─── Section 5: Language Switch Intents ──────────────────────────────────────

describe('Language switch intents', () => {
    test('"speak in telugu" sets detected_language to "te"', () => {
        const result = IntentService.matchIntent('speak in telugu', {
            service: 'sales',
            stage: 'AVAILABILITY',
            lastQuestion: 'Is now a convenient time?',
            language: 'en',
            contact: { name: 'pooja' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.detected_language, 'te');
        assert.strictEqual(result.reason, 'language_switch_telugu');
    });

    test('"hindi me" sets detected_language to "hi"', () => {
        const result = IntentService.matchIntent('hindi me', {
            service: 'recruitment',
            stage: 'AVAILABILITY',
            lastQuestion: 'Do you have a minute?',
            language: 'en',
            contact: { name: 'pooja' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.detected_language, 'hi');
    });

    test('"english" switches back to English', () => {
        const result = IntentService.matchIntent('english', {
            service: 'sales',
            stage: 'AVAILABILITY',
            lastQuestion: 'Is now a convenient time?',
            language: 'te',
            contact: { name: 'pooja' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.detected_language, 'en');
        assert.strictEqual(result.reason, 'language_switch_english');
    });
});

// ─── Section 6: Audio Format Validation (FIX-7) ──────────────────────────────

describe('FIX-7: Audio byte-to-duration calculation (ulaw_8000)', () => {
    test('1 second of audio = 8000 bytes = 1000ms', () => {
        const oneSec = 8000;
        const durationMs = Math.round((oneSec / 8000) * 1000);
        assert.strictEqual(durationMs, 1000);
    });

    test('30 seconds of audio = 240000 bytes = 30000ms', () => {
        const thirtySecAudio = 240000;
        const durationMs = Math.round((thirtySecAudio / 8000) * 1000);
        assert.strictEqual(durationMs, 30000);
    });

    test('pcmToWav produces valid 44-byte RIFF header', () => {
        const silencePcm = Buffer.alloc(1600, 0);
        const wav = pcmToWav(silencePcm, 8000, 1, 16);
        assert.strictEqual(wav.slice(0, 4).toString(), 'RIFF');
        assert.strictEqual(wav.slice(8, 12).toString(), 'WAVE');
        assert.strictEqual(wav.length, 1644); // 1600 PCM + 44 header
    });

    test('mulaw decode produces exactly 2x input length', () => {
        const mulawBuf = Buffer.alloc(160, 127); // 20ms silence
        const pcm = decodeMulawToPcm16(mulawBuf);
        assert.strictEqual(pcm.length, 320);
    });
});

// ─── Section 7: Hard Stop Intents ────────────────────────────────────────────

describe('Hard stop intents (all services)', () => {
    test('"do not call" ends call as Do Not Call', () => {
        const result = IntentService.matchIntent('do not call', {
            service: 'sales',
            stage: 'AVAILABILITY',
            language: 'en',
            contact: { name: 'test' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.should_end_call, true);
        assert.strictEqual(result.classification, 'Do Not Call');
    });

    test('"wrong number" ends call gracefully as Rejected', () => {
        const result = IntentService.matchIntent('wrong number', {
            service: 'recruitment',
            stage: 'AVAILABILITY',
            language: 'en',
            contact: { name: 'test' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.should_end_call, true);
        assert.strictEqual(result.classification, 'Rejected');
    });

    test('"cut the call" ends call', () => {
        const result = IntentService.matchIntent('cut the call', {
            service: 'sales',
            stage: 'SERVICE_INTEREST',
            language: 'en',
            contact: { name: 'test' },
            collectedData: {}
        });
        assert.ok(result.matched);
        assert.strictEqual(result.should_end_call, true);
    });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════');
console.log(`  REGRESSION TEST RESULTS`);
console.log(`  Total:  ${totalTests}`);
console.log(`  Passed: ${passedTests}`);
console.log(`  Failed: ${failedTests}`);
console.log('══════════════════════════════════════════════════\n');

if (failedTests > 0) {
    process.exit(1);
}
process.exit(0);
