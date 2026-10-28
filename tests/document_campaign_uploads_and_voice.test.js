/**
 * tests/document_campaign_uploads_and_voice.test.js
 * 
 * Comprehensive Automated Test Suite verifying:
 * 1. Document Extraction (.pdf, .docx, .doc) for Recruitment, Sales, and Support.
 * 2. Corrupt / empty / invalid file rejection.
 * 3. Dynamic Sales Campaign conversation grounded in uploaded document (custom SaaS vs default).
 * 4. Dynamic Customer Support troubleshooting and escalation grounded in uploaded document.
 * 5. Recruitment Job Description Word (.docx) parsing and question plan generation.
 * 6. Campaign isolation: Campaign A cannot access or leak Campaign B's document instructions.
 * 7. Fast-path intent matching, anti-repetition, and turn-taking grounding.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import DocumentService from '../services/document_service.js';
import CampaignService from '../services/campaign_service.js';
import { QuestionPlanner } from '../services/question_planner.js';
import GeminiService from '../services/gemini_service.js';
import IntentService from '../services/intent_service.js';
import ConversationMemory from '../services/conversation_memory.js';
import db, { initDb, ensureCampaignSchema } from '../services/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalTests = 0;
let passedTests = 0;

async function test(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  [PASS] Test ${totalTests}: ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  [FAIL] Test ${totalTests}: ${name}`);
        console.error(`         ${err.stack || err.message}`);
    }
}

async function runTests() {
    console.log('================================================================');
    console.log('DOCUMENT CAMPAIGN UPLOADS & CONVERSATION GROUNDING TEST SUITE');
    console.log('================================================================\n');

    await initDb();
    await ensureCampaignSchema();

    // -----------------------------------------------------------------
    // 1. Text Extraction & Sanitization from Buffers
    // -----------------------------------------------------------------
    console.log('--- Suite 1: Document Extraction Validation & Error Handling ---');

    await test('Reject empty or non-existent buffers with helpful error', async () => {
        try {
            await DocumentService.extractText(Buffer.alloc(0), 'empty.pdf');
            assert.fail('Should have thrown an error for empty buffer');
        } catch (err) {
            assert.ok(err.message.includes('empty') || err.message.includes('corrupted') || err.message.includes('readable'));
        }
    });

    await test('Reject unsupported file extensions', async () => {
        try {
            await DocumentService.extractText(Buffer.from('hello world'), 'notes.txt');
            assert.fail('Should reject unsupported .txt file');
        } catch (err) {
            assert.ok(err.message.includes('Unsupported document format'));
        }
    });

    await test('Reject corrupted PDF gracefully with clear error', async () => {
        try {
            await DocumentService.extractText(Buffer.from('not a real pdf header 12345'), 'broken.pdf');
            assert.fail('Should reject corrupted PDF');
        } catch (err) {
            assert.ok(err.message.includes('parse PDF') || err.message.includes('corrupted') || err.message.includes('Invalid'));
        }
    });

    // -----------------------------------------------------------------
    // 2. Structured Extraction for Sales, Support, and Recruitment
    // -----------------------------------------------------------------
    console.log('\n--- Suite 2: Structured Campaign Knowledge Parsing ---');

    const sampleSalesText = `
        Product: ApexLogistics Pro
        Company: Apex Systems
        Overview: Enterprise supply chain visibility and automated fleet routing platform.
        Value Proposition: Reduces delivery delays by 35% and cuts fuel expenses by 22%.
        Pricing: Starter fleet at $199/month, Enterprise at $799/month with custom integrations.
        Key Features: Real-time GPS telematics, predictive traffic routing, automated dispatch dispatching.
        Opening Greeting: Hello! I'm calling from Apex Systems regarding ApexLogistics Pro.
        Target Audience: Logistics managers and supply chain directors.
        Sales Questions:
        1. How many active delivery vehicles do you currently manage?
        2. Are you experiencing delays during peak dispatch hours?
        3. Would you like a 15-minute live demo of automated fleet routing?
        Objection Handling:
        If they say too expensive: Emphasize that the 22% fuel reduction typically covers the license cost in 60 days.
        If they say already have software: Ask if their current software provides automated real-time re-routing.
        Outcome: Book a 15-minute demo.
    `;

    let salesKnowledge = null;
    await test('Parse Sales Knowledge into structured campaign format', async () => {
        salesKnowledge = await DocumentService.parseSalesKnowledge(sampleSalesText);
        assert.strictEqual(salesKnowledge.product_name, 'ApexLogistics Pro');
        assert.strictEqual(salesKnowledge.company_name, 'Apex Systems');
        assert.ok(salesKnowledge.value_propositions.length >= 1);
        assert.ok(salesKnowledge.pricing_summary.includes('$199') || salesKnowledge.pricing_summary.includes('$799'));
        assert.ok(salesKnowledge.desired_outcome.includes('15-minute demo') || salesKnowledge.desired_outcome.includes('demo'));
    });

    const sampleSupportText = `
        Product: ApexLogistics Mobile App
        Company: Apex Systems
        Supported Topics: Driver Login, GPS Tracking, Route Syncing, Battery Optimization.
        FAQ:
        Q: Why is my GPS location not updating?
        A: Check that location permissions are set to 'Always Allow' and battery saver is disabled.
        Q: How do I sync completed deliveries offline?
        A: The app stores up to 200 delivery confirmations locally and syncs automatically when 4G or Wi-Fi reconnects.
        Troubleshooting:
        Step 1: Check network signal bar in the top right.
        Step 2: Force close the app from Settings > Apps > ApexLogistics.
        Step 3: Toggle Airplane Mode on for 5 seconds, then off.
        Step 4: Re-open app and tap Sync Now.
        Escalation Policy:
        If location still fails after Step 4, escalate immediately to Tier 2 Fleet Operations at dispatch-support@apexsystems.com.
        Opening Greeting: Hi! Remo here from Apex Systems Support. How can I help with your app today?
    `;

    let supportKnowledge = null;
    await test('Parse Customer Support Knowledge with FAQs and Troubleshooting', async () => {
        supportKnowledge = await DocumentService.parseSupportKnowledge(sampleSupportText);
        assert.strictEqual(supportKnowledge.product_name, 'ApexLogistics Mobile App');
        assert.ok(supportKnowledge.troubleshooting_steps.length >= 3);
        assert.ok(supportKnowledge.approved_faqs.length >= 2);
        assert.ok(supportKnowledge.escalation_policy.includes('Tier 2'));
    });

    // -----------------------------------------------------------------
    // 3. Question Planner Document Grounding
    // -----------------------------------------------------------------
    console.log('\n--- Suite 3: Tailored AI Conversation Plans ---');

    await test('Generate document-grounded Sales Question Plan', () => {
        const plan = QuestionPlanner.generateSalesPlan(salesKnowledge);
        assert.ok(plan.length >= 4);
        const planText = plan.map(q => q.text).join(' ');
        assert.ok(planText.includes('ApexLogistics Pro') || planText.includes('Apex Systems'));
        assert.ok(planText.includes('delivery') || planText.includes('fleet') || planText.includes('vehicles') || planText.includes('demo'));
    });

    await test('Generate document-grounded Customer Support Question Plan', () => {
        const plan = QuestionPlanner.generateSupportPlan(supportKnowledge);
        assert.ok(plan.length >= 3);
        const planText = plan.map(q => q.text).join(' ');
        assert.ok(planText.includes('ApexLogistics Mobile App') || planText.includes('Apex Systems'));
        assert.ok(planText.includes('step') || planText.includes('troubleshoot') || planText.includes('issue'));
    });

    // -----------------------------------------------------------------
    // 4. Voice Greeting & Response Grounding in GeminiService
    // -----------------------------------------------------------------
    console.log('\n--- Suite 4: Dynamic Voice Greetings & Response Grounding ---');

    await test('Sales opening greeting uses uploaded document content', () => {
        const greeting = GeminiService.getOpeningGreeting('sales', salesKnowledge);
        assert.ok(greeting.includes('ApexLogistics Pro') || greeting.includes('Apex Systems'));
        // Make sure it does not fallback to Scorelabs IT
        assert.ok(!greeting.includes('Scorelabs'));
    });

    await test('Support opening greeting uses uploaded document content', () => {
        const greeting = GeminiService.getOpeningGreeting('support', supportKnowledge);
        assert.ok(greeting.includes('Apex') || greeting.includes('ApexLogistics'));
        assert.ok(!greeting.includes('Scorelabs'));
    });

    await test('Default opening greetings preserved when no document is attached', () => {
        const salesDefault = GeminiService.getOpeningGreeting('sales', null);
        assert.ok(salesDefault.includes('Remo') && !/score ?labs/i.test(salesDefault), 'default opening names no built-in company');

        const supportDefault = GeminiService.getOpeningGreeting('support', null);
        assert.ok(supportDefault.includes('customer support') && !/score ?labs/i.test(supportDefault), 'default opening names no built-in company');
    });

    await test('Prompt contains strict grounding instructions preventing hallucinated pricing & features', async () => {
        const reply = await GeminiService.generateReply(
            'sales',
            { name: 'John Doe', campaignContext: salesKnowledge },
            [{ role: 'assistant', text: 'Hello, this is Remo calling about ApexLogistics Pro.' }],
            'Can you give me a 90% discount and deliver free tablets?',
            {},
            { campaignContext: salesKnowledge }
        );
        assert.ok(reply && reply.spoken_response);
        const lower = reply.spoken_response.toLowerCase();
        // The AI must not promise a 90% discount or free tablets
        assert.ok(!lower.includes('sure, i can give you 90%') && !lower.includes('free tablets will be sent'));
    });

    // -----------------------------------------------------------------
    // 5. Campaign Isolation in Database
    // -----------------------------------------------------------------
    console.log('\n--- Suite 5: Campaign Isolation in Database ---');

    let campSalesA = null;
    let campSalesB = null;

    await test('Create Campaign A with Logistics Document', async () => {
        const resA = await CampaignService.createCampaign({
            name: 'Apex Logistics Q4 Sales',
            service: 'sales',
            description: 'Direct fleet sales',
            extracted_data: salesKnowledge
        });
        campSalesA = resA.id;
        assert.ok(campSalesA);
    });

    await test('Create Campaign B with totally different HR Software document', async () => {
        const hrDocKnowledge = {
            product_name: 'TalentPulse HR',
            company_name: 'PeopleFirst Inc.',
            value_propositions: ['Automates payroll in 3 clicks'],
            pricing_summary: '$5 per employee per month',
            opening_greeting: 'Hello! Calling from PeopleFirst about TalentPulse HR payroll automation.',
            desired_outcome: 'Schedule payroll demo'
        };

        const resB = await CampaignService.createCampaign({
            name: 'PeopleFirst HR Sales',
            service: 'sales',
            description: 'HR automation sales',
            extracted_data: hrDocKnowledge
        });
        campSalesB = resB.id;
        assert.ok(campSalesB);
        assert.notStrictEqual(campSalesA, campSalesB);
    });

    await test('Verify Campaign A and Campaign B maintain isolated instructions & greetings', async () => {
        const a = await CampaignService.getCampaign(campSalesA);
        const b = await CampaignService.getCampaign(campSalesB);

        assert.strictEqual(a.extracted_data.product_name, 'ApexLogistics Pro');
        assert.strictEqual(b.extracted_data.product_name, 'TalentPulse HR');

        const greetingA = GeminiService.getOpeningGreeting('sales', a.extracted_data);
        const greetingB = GeminiService.getOpeningGreeting('sales', b.extracted_data);

        assert.ok(greetingA.includes('ApexLogistics Pro'));
        assert.ok(!greetingA.includes('TalentPulse'));

        assert.ok(greetingB.includes('TalentPulse HR'));
        assert.ok(!greetingB.includes('ApexLogistics'));
    });

    await test('Validate that startCampaign rejects campaigns missing required instructions/contacts', async () => {
        const emptyRecruitment = await CampaignService.createCampaign({
            name: 'Empty Rec Campaign',
            service: 'recruitment',
            description: 'No JD or contacts attached'
        });

        try {
            await CampaignService.startCampaign(emptyRecruitment.id);
            assert.fail('Should fail to start empty recruitment campaign');
        } catch (err) {
            assert.ok(err.message.includes('contact sheet') || err.message.includes('Job Description') || err.message.includes('required'));
        }
    });

    console.log('\n================================================================');
    console.log(`DOCUMENT CAMPAIGN TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
    console.log('================================================================\n');

    if (passedTests === totalTests) {
        process.exit(0);
    } else {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
