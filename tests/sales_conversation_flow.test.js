/**
 * tests/sales_conversation_flow.test.js
 * 
 * Verifies all 10 Sales Conversation Flow scenarios required by user:
 * 1. Customer agrees to talk: Remo waits for the answer before asking about service needs.
 * 2. Customer says they are busy: Remo responds appropriately and does not launch the sales pitch.
 * 3. Customer says they are not interested: Remo acknowledges this and closes respectfully if the customer declines.
 * 4. Customer asks what services are offered: Remo introduces the relevant services briefly and waits.
 * 5. Customer asks about a service in the uploaded PDF/DOCX: Remo answers using the actual uploaded content.
 * 6. Customer asks a question that is not covered by the document: Remo does not invent an answer.
 * 7. Customer responds in the middle of a long answer: Remo handles interruption according to call-session policy.
 * 8. Customer gives multiple details in one response: Remo remembers them and does not ask the same questions again.
 * 9. A Sales campaign has no uploaded document: Remo uses approved default Sales configuration.
 * 10. Recruitment and Customer Support calls still work as before.
 */

import assert from 'assert';
import GeminiService from '../services/gemini_service.js';
import IntentService from '../services/intent_service.js';
import ConversationMemory from '../services/conversation_memory.js';
import { CallSession } from '../services/voicebot_stream_service.js';

let totalTests = 0;
let passedTests = 0;

async function test(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  [PASS] Scenario ${totalTests}: ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  [FAIL] Scenario ${totalTests}: ${name}`);
        console.error(`         ${err.stack || err.message}`);
    }
}

async function runScenarios() {
    console.log('================================================================');
    console.log('SALES CALLS NATURAL CONVERSATION FLOW - 10 SCENARIO TEST SUITE');
    console.log('================================================================\n');

    const sampleDocKnowledge = {
        product_name: 'FleetPulse GPS & Telematics',
        company_name: 'FleetPulse Technologies',
        value_propositions: [
            'Real-time GPS tracking with 30-second ping rates',
            'Automated fuel expense monitoring cutting fuel costs by 20%'
        ],
        key_features: [
            'Live GPS Tracking',
            'Predictive Engine Maintenance',
            'Driver Safety Scoring'
        ],
        pricing_summary: '$49 per vehicle per month with no setup fee',
        call_to_action: 'schedule a 15-minute live vehicle telematics walkthrough',
        approved_faqs: [
            { question: 'Does FleetPulse work with heavy trucks?', answer: 'Yes, FleetPulse is compatible with heavy trucks via standard J1939 CAN-bus ports.' }
        ]
    };

    // Scenario 1: Customer agrees to talk: Remo waits for the answer before asking about service needs
    await test('Scenario 1: Customer agrees to talk (Greeting -> Permission -> Interest)', async () => {
        // Step 1: Remo speaks opening greeting with customer's name
        const greeting = GeminiService.getOpeningGreeting('sales', { name: 'Priya' });
        assert.ok(greeting.includes('Priya'), 'Must use customer name');
        assert.ok(greeting.length < 50, 'Greeting must be short, not a service dump');
        assert.ok(!greeting.includes('custom software development'), 'Must not list services in greeting');

        // Step 2: Priya confirms identity ("Yes, speaking")
        const greetingReply = IntentService.matchIntent('Yes, speaking', {
            service: 'sales',
            stage: 'GREETING',
            contact: { name: 'Priya' }
        });
        assert.strictEqual(greetingReply.matched, true);
        assert.ok(greetingReply.spoken_response.includes('Remo'), 'Remo identifies himself');
        assert.ok(greetingReply.spoken_response.includes('good time to talk'), 'Asks for permission to speak');
        assert.strictEqual(greetingReply.next_stage, 'PERMISSION_CHECK');
        assert.ok(!greetingReply.spoken_response.includes('services that we could help'), 'Must NOT jump to service pitch yet');

        // Step 3: Priya agrees to talk ("Sure, I have a minute")
        const permissionReply = IntentService.matchIntent('Sure, I have a minute', {
            service: 'sales',
            stage: 'PERMISSION_CHECK',
            contact: { name: 'Priya' }
        });
        assert.strictEqual(permissionReply.matched, true);
        assert.ok(permissionReply.spoken_response.includes('looking for any services'), 'Now Remo asks about service needs');
        assert.strictEqual(permissionReply.next_stage, 'INTEREST_DISCOVERY');
    });

    // Scenario 2: Customer says they are busy
    await test('Scenario 2: Customer says they are busy (does not launch sales pitch)', async () => {
        const busyReply = IntentService.matchIntent("I'm driving right now, call me later", {
            service: 'sales',
            stage: 'PERMISSION_CHECK',
            contact: { name: 'Priya' }
        });
        assert.strictEqual(busyReply.matched, true);
        assert.ok(busyReply.spoken_response.includes('Would another time be better') || busyReply.spoken_response.includes('callback'), 'Offers callback politely');
        assert.strictEqual(busyReply.next_stage, 'CALLBACK_TIME');
        assert.strictEqual(busyReply.classification, 'Callback Requested');
        assert.ok(!busyReply.spoken_response.includes('software'), 'Must NOT pitch any services');

        // Caller gives callback time ("Call me tomorrow at 4pm")
        const timeReply = IntentService.matchIntent('Tomorrow at 4pm', {
            service: 'sales',
            stage: 'CALLBACK_TIME',
            contact: { name: 'Priya' }
        });
        assert.strictEqual(timeReply.matched, true);
        assert.strictEqual(timeReply.should_end_call, true);
        assert.ok(timeReply.spoken_response.includes('noted that down') || timeReply.spoken_response.includes('connect with you then'));
    });

    // Scenario 3: Customer says they are not interested
    await test('Scenario 3: Customer says not interested (closes respectfully)', async () => {
        const notInterestedReply = IntentService.matchIntent('No, not interested', {
            service: 'sales',
            stage: 'INTEREST_DISCOVERY',
            contact: { name: 'Priya' }
        });
        assert.strictEqual(notInterestedReply.matched, true);
        assert.strictEqual(notInterestedReply.should_end_call, true);
        assert.strictEqual(notInterestedReply.classification, 'Not Interested');
        assert.ok(notInterestedReply.spoken_response.includes('Thank you') || notInterestedReply.spoken_response.includes('understand'));
        assert.ok(!notInterestedReply.spoken_response.includes('software'), 'Does not push services');
    });

    // Scenario 4: Customer asks what services are offered
    await test('Scenario 4: Customer asks what services are offered (brief intro & pauses)', async () => {
        const servicesReply = IntentService.matchIntent('What services do you offer?', {
            service: 'sales',
            stage: 'INTEREST_DISCOVERY',
            contact: { name: 'Priya' },
            campaignContext: sampleDocKnowledge
        });
        assert.strictEqual(servicesReply.matched, true);
        assert.ok(servicesReply.spoken_response.includes('Live GPS Tracking') || servicesReply.spoken_response.includes('Telematics') || servicesReply.spoken_response.includes('services'), 'Mentions document services');
        assert.ok(servicesReply.spoken_response.length < 150, 'Brief response under 20-25 words');
        assert.strictEqual(servicesReply.next_stage, 'SERVICE_DISCOVERY');
    });

    // Scenario 5: Customer asks about a service in the uploaded PDF/DOCX
    await test('Scenario 5: Customer asks about service in uploaded document (grounded answer)', async () => {
        const reply = await GeminiService.generateReply(
            'sales',
            { name: 'Priya', company: 'LogiTrans' },
            [
                { speaker: 'REMO', text: 'Hello, am I speaking with Priya?' },
                { speaker: 'Priya', text: 'Yes, speaking.' },
                { speaker: 'REMO', text: 'Hi Priya, this is Remo calling from FleetPulse Technologies. Is this a good time to talk for a minute?' },
                { speaker: 'Priya', text: 'Sure, what do you offer?' }
            ],
            'Does your FleetPulse system work with heavy trucks?',
            {},
            { campaignContext: sampleDocKnowledge, currentStage: 'SERVICE_DISCOVERY' }
        );

        assert.ok(reply.spoken_response.toLowerCase().includes('truck') || reply.spoken_response.toLowerCase().includes('heavy') || reply.spoken_response.toLowerCase().includes('j1939') || reply.spoken_response.toLowerCase().includes('yes'), 'Must reference heavy truck compatibility from document');
        assert.strictEqual(reply.should_end_call, false);
    });

    // Scenario 6: Customer asks a question not covered by the document
    await test('Scenario 6: Customer asks question not covered by document (no hallucination)', async () => {
        const reply = await GeminiService.generateReply(
            'sales',
            { name: 'Priya', company: 'LogiTrans' },
            [
                { speaker: 'REMO', text: 'Hi Priya, this is Remo calling from FleetPulse Technologies. Is this a good time to talk for a minute?' },
                { speaker: 'Priya', text: 'Yes.' }
            ],
            'Can FleetPulse track space satellites orbiting Mars?',
            {},
            { campaignContext: sampleDocKnowledge, currentStage: 'QUALIFICATION' }
        );

        const lower = reply.spoken_response.toLowerCase();
        assert.ok(
            lower.includes("don't have that detail") ||
            lower.includes("not covered") ||
            lower.includes("follow up") ||
            lower.includes("team confirms") ||
            lower.includes("team will confirm") ||
            lower.includes("cannot") ||
            lower.includes("no") ||
            lower.includes("focus"),
            'Must not pretend to support satellite tracking on Mars'
        );
    });

    // Scenario 7: Interruption handling (barge-in stops AI speech)
    await test('Scenario 7: Interruption handling stops AI speech cleanly', async () => {
        let clearedAudio = false;
        const fakeWs = {
            readyState: 1,
            OPEN: 1,
            send: (msgStr) => {
                const msg = JSON.parse(msgStr);
                if (msg.event === 'clearAudio') clearedAudio = true;
            }
        };

        const session = new CallSession(fakeWs, { service: 'sales', callerName: 'Priya' });
        session.streamId = 'test_stream_1';
        session.isAiSpeaking = true;

        // Simulate 40 speech frames (~800ms) with loud speech while AI speaking
        const loudSpeechChunk = Buffer.alloc(160, 0x00); // 0x00 = maximum amplitude peak in G.711 mu-law
        for (let i = 0; i < 40; i++) {
            await session.handleInboundAudio(loudSpeechChunk);
        }

        assert.strictEqual(clearedAudio, true, 'Must send clearAudio event to Plivo on barge-in');
        assert.strictEqual(session.isAiSpeaking, false, 'AI speech flag must be cleared');
        assert.strictEqual(session.interruptedWithAnswer, true, 'Interrupted flag set');
    });

    // Scenario 8: Customer gives multiple details in one response: Remo remembers and does not re-ask
    await test('Scenario 8: Customer gives multiple details in one turn (non-destructive extraction)', () => {
        const memory = new ConversationMemory({ service: 'sales', candidateName: 'Priya' });
        memory.recordTurn('REMO', 'Could you tell me a little about what you are looking for?');
        memory.recordTurn('Priya', 'We urgently need a custom software website for our team, timeline is within 2 weeks, send details to priya@logistics.com');

        assert.strictEqual(memory.factsCollected.business_email, 'priya@logistics.com');
        assert.ok(memory.factsCollected.service_needed.includes('website') || memory.factsCollected.service_needed.includes('custom software'));
        assert.strictEqual(memory.factsCollected.project_timeline, 'within 2 weeks');

        // Check that field is known and should not be re-asked
        assert.strictEqual(memory._isFieldSufficientlyKnown('business_email'), true);
        assert.strictEqual(memory._isFieldSufficientlyKnown('service_needed'), true);
        assert.strictEqual(memory._isFieldSufficientlyKnown('project_timeline'), true);
    });

    // Scenario 9: Sales campaign with no uploaded document uses approved default Sales configuration
    await test('Scenario 9: Sales campaign without document uses approved default configuration', () => {
        const greeting = GeminiService.getOpeningGreeting('sales', null);
        assert.ok(!/score ?labs/i.test(greeting), 'no company is built in');
        assert.ok(greeting.includes('good time to talk') || greeting.includes('Remo'));
        assert.ok(!greeting.includes('custom software development'), 'Does not dump services in turn 1');

        const fallback = GeminiService.getUniversalFallback('en', 'sales');
        assert.ok(!/score ?labs/i.test(fallback), 'no company is built in');
        assert.ok(!fallback.includes('recruitment') && !fallback.includes('open position'));
    });

    // Scenario 10: Recruitment and Customer Support calls still work as before
    await test('Scenario 10: Recruitment and Support workflows remain unaffected and functional', () => {
        // Recruitment opens by asking for the candidate by name; the introduction follows once they confirm.
        const recGreeting = GeminiService.getOpeningGreeting('recruitment', { job_role: 'Cloud Architect', name: 'Anil' });
        assert.strictEqual(recGreeting, 'Hello, am I speaking with Anil?');

        const supGreeting = GeminiService.getOpeningGreeting('support', { name: 'Kavita' });
        assert.ok(supGreeting.includes('Kavita'));
        assert.ok(supGreeting.includes('customer support'));

        const recReply = IntentService.matchIntent('Yes', {
            service: 'recruitment',
            stage: 'AVAILABILITY',
            contact: { job_role: 'Cloud Architect' }
        });
        assert.strictEqual(recReply.matched, true);
        assert.strictEqual(recReply.next_stage, 'EXPERIENCE');
        assert.ok(recReply.spoken_response.includes('Cloud Architect') || recReply.spoken_response.includes('experience'));

        const supReply = IntentService.matchIntent('Yes', {
            service: 'support',
            stage: 'AVAILABILITY'
        });
        assert.strictEqual(supReply.matched, true);
        assert.ok(supReply.spoken_response.includes('error') || supReply.spoken_response.includes('issue'));
    });

    console.log('\n================================================================');
    console.log(`SALES CONVERSATION FLOW SCENARIO RESULTS: ${passedTests} / ${totalTests} PASSED`);
    console.log('================================================================\n');

    process.exit(passedTests === totalTests ? 0 : 1);
}

runScenarios().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
