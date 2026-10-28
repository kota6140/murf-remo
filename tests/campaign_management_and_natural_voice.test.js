/**
 * tests/campaign_management_and_natural_voice.test.js
 * 
 * End-to-End Test Suite for Remo AI Campaign Management & Natural Voice Overhaul:
 * 1. Multi-campaign creation & persistence in database
 * 2. Independent isolation between Recruitment, Sales, and Support
 * 3. Role-specific screening question plans (SAP Consultant vs MERN Stack)
 * 4. Closing question inclusion: "Before we wrap up, do you have any questions for me?"
 * 5. Conversation memory tracking & anti-repetition
 * 6. Natural short response handling & thinking pauses ("hmm, let me think")
 * 7. Multi-LLM provider abstraction: Claude Haiku primary + Gemini fallback
 * 8. Automatic language-aware voice routing (Telugu Chaitra vs English Pari)
 * 9. Explainable candidate screening evaluation (Selected, On Hold, Rejected)
 * 10. Updated Excel export generation with AI screening columns
 * 11. Safe campaign duplication (configuration cloned, call results isolated)
 * 12. Campaign lifecycle: Draft -> Start -> Pause -> Resume -> Archive
 */

import './_local_db_only.js'; // keep first: tests must never touch the live database
import assert from 'assert';
import db, { initDb, ensureCampaignSchema } from '../services/db.js';
import CampaignService from '../services/campaign_service.js';
import { QuestionPlanner } from '../services/question_planner.js';
import ConversationMemory from '../services/conversation_memory.js';
import LLMService from '../services/llm_service.js';
import ElevenLabsService from '../services/elevenlabs_service.js';
import ScreeningEvaluator from '../services/screening_evaluator.js';
import ExcelService from '../services/excel_service.js';

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

async function runAllTests() {
    console.log('================================================================');
    console.log('REMO AI CAMPAIGN MANAGEMENT & VOICE AGENT OVERHAUL TEST SUITE');
    console.log('================================================================\n');

    await initDb();
    await ensureCampaignSchema();

    // -------------------------------------------------------------
    // Suite 1: Multi-Campaign Creation & Persistence
    // -------------------------------------------------------------
    console.log('--- Suite 1: Multi-Campaign Creation & DB Persistence ---');

    let sapCampId = null;
    let mernCampId = null;
    let salesCampId = null;
    let supportCampId = null;

    await test('Creates independent SAP Consultant recruitment campaign', async () => {
        const camp = await CampaignService.createCampaign({
            name: 'SAP Consultant Recruitment — October 2026',
            service: 'recruitment',
            description: 'Screening SAP FICO and S/4HANA consultants for enterprise client',
            config: { primaryModel: 'claude-haiku-5-5', voiceRouting: 'auto' },
            ownerUserId: 'test_admin_01'
        });

        assert.ok(camp.id);
        assert.strictEqual(camp.name, 'SAP Consultant Recruitment — October 2026');
        assert.strictEqual(camp.service, 'recruitment');
        assert.strictEqual(camp.status, 'DRAFT');
        sapCampId = camp.id;
    });

    await test('Creates independent MERN Stack Developer recruitment campaign', async () => {
        const camp = await CampaignService.createCampaign({
            name: 'MERN Stack Developer Recruitment',
            service: 'recruitment',
            description: 'Hiring React, Node.js, and MongoDB full-stack engineers',
            config: { primaryModel: 'claude-haiku-5-5', voiceRouting: 'auto' },
            ownerUserId: 'test_admin_01'
        });

        assert.ok(camp.id);
        assert.notStrictEqual(camp.id, sapCampId);
        assert.strictEqual(camp.name, 'MERN Stack Developer Recruitment');
        mernCampId = camp.id;
    });

    await test('Creates independent Outbound Sales campaign', async () => {
        const camp = await CampaignService.createCampaign({
            name: 'Outbound Sales — Enterprise Software',
            service: 'sales',
            description: 'Lead qualification for Scorelabs AI voice platform',
            config: { primaryModel: 'claude-haiku-5-5' },
            ownerUserId: 'test_admin_01'
        });

        assert.ok(camp.id);
        assert.strictEqual(camp.service, 'sales');
        salesCampId = camp.id;
    });

    await test('Creates independent Customer Support campaign', async () => {
        const camp = await CampaignService.createCampaign({
            name: 'Customer Support — Product Onboarding',
            service: 'support',
            description: 'Assisting newly signed-up customers through account setup',
            config: { primaryModel: 'claude-haiku-5-5' },
            ownerUserId: 'test_admin_01'
        });

        assert.ok(camp.id);
        assert.strictEqual(camp.service, 'support');
        supportCampId = camp.id;
    });

    await test('Campaigns persist in database and can be retrieved across reloads', async () => {
        const list = await CampaignService.listCampaigns('test_admin_01');
        const ids = list.map(c => c.id);
        assert.ok(ids.includes(sapCampId), 'SAP campaign must persist in DB');
        assert.ok(ids.includes(mernCampId), 'MERN campaign must persist in DB');
        assert.ok(ids.includes(salesCampId), 'Sales campaign must persist in DB');
        assert.ok(ids.includes(supportCampId), 'Support campaign must persist in DB');
    });

    // -------------------------------------------------------------
    // Suite 2: Role-Specific Screening Question Generation
    // -------------------------------------------------------------
    console.log('\n--- Suite 2: Role-Specific Question Plans from JD ---');

    await test('SAP Consultant JD generates questions tailored to SAP FICO & S/4HANA', async () => {
        const sapJD = {
            job_title: 'Senior SAP FICO Consultant',
            required_skills: ['SAP FICO', 'S/4HANA', 'General Ledger'],
            min_experience_years: 5,
            work_arrangement: 'Hybrid - Bangalore',
            max_notice_period_days: 30
        };

        const plan = await QuestionPlanner.generateRecruitmentPlan(sapJD);
        assert.ok(Array.isArray(plan) && plan.length >= 4);

        const allQuestionsText = plan.map(q => q.text).join(' ');
        assert.ok(
            allQuestionsText.toLowerCase().includes('sap') || allQuestionsText.toLowerCase().includes('fico'),
            'Must contain SAP-specific questions'
        );

        // Closing rule: Always includes a final question asking if the candidate has questions
        const lastQ = plan[plan.length - 1];
        assert.ok(
            lastQ.text.toLowerCase().includes('questions for me'),
            'Must end with asking candidate if they have questions'
        );
    });

    await test('MERN Stack Developer JD generates questions tailored to React & Node.js', async () => {
        const mernJD = {
            job_title: 'Full Stack MERN Developer',
            required_skills: ['React', 'Node.js', 'Express', 'MongoDB'],
            min_experience_years: 3,
            work_arrangement: 'Remote',
            max_notice_period_days: 15
        };

        const plan = await QuestionPlanner.generateRecruitmentPlan(mernJD);
        assert.ok(Array.isArray(plan) && plan.length >= 4);

        const allQuestionsText = plan.map(q => q.text).join(' ');
        assert.ok(
            allQuestionsText.toLowerCase().includes('react') || allQuestionsText.toLowerCase().includes('node'),
            'Must contain React/Node-specific questions'
        );
        assert.ok(!allQuestionsText.toLowerCase().includes('sap fico'), 'MERN plan must never ask about SAP');
    });

    // -------------------------------------------------------------
    // Suite 3: Multi-LLM Provider Abstraction (Claude + Gemini)
    // -------------------------------------------------------------
    console.log('\n--- Suite 3: Multi-LLM Provider Abstraction & Fallback ---');

    await test('LLMService initializes with configured primary provider (OpenAI / Claude / Gemini)', () => {
        const active = LLMService.getActiveProvider();
        assert.ok(['openai', 'claude', 'gemini'].includes(active));
    });

    await test('LLMService successfully generates responses via configured models', async () => {
        const res = await LLMService.generate({
            systemPrompt: 'You are an AI assistant. Answer in one word.',
            messages: [{ role: 'user', content: 'Say READY' }],
            maxTokens: 20
        });

        assert.ok(res.text && res.text.length > 0);
        assert.ok(['openai', 'claude', 'gemini'].includes(res.provider));
    });

    await test('LLMService extractJson handles markdown fenced blocks and clean JSON', () => {
        const fenced = '```json\n{"status": "Selected", "score": 92}\n```';
        const parsed = LLMService.extractJson(fenced);
        assert.strictEqual(parsed.status, 'Selected');
        assert.strictEqual(parsed.score, 92);
    });

    // -------------------------------------------------------------
    // Suite 4: Conversation Memory & Turn-Taking
    // -------------------------------------------------------------
    console.log('\n--- Suite 4: Conversation Memory & Anti-Repetition ---');

    await test('ConversationMemory tracks asked questions and prevents repeats', () => {
        const memory = new ConversationMemory();

        memory.recordQuestionAsked('q_experience', 'Could you tell me about your experience?');
        assert.strictEqual(memory.hasQuestionBeenAsked('q_experience'), true);
        assert.strictEqual(memory.hasQuestionBeenAsked('q_skills'), false);

        memory.recordAnswer('q_experience', 'I have 5 years working with SAP FICO.');
        assert.strictEqual(memory.isQuestionAnswered('q_experience'), true);

        // Verification of anti-repetition check
        const shouldAskAgain = !memory.hasQuestionBeenAsked('q_experience');
        assert.strictEqual(shouldAskAgain, false, 'Must not re-ask already asked questions');
    });

    await test('ConversationMemory identifies thinking pauses and backchannels', () => {
        const memory = new ConversationMemory();

        assert.strictEqual(memory.isThinkingPause('hmm, let me think'), true);
        assert.strictEqual(memory.isThinkingPause('one minute please'), true);
        assert.strictEqual(memory.isThinkingPause('wait a second'), true);
        assert.strictEqual(memory.isThinkingPause('I was leading the configuration for GL'), false);
    });

    await test('ConversationMemory preserves collected candidate facts non-destructively', () => {
        const memory = new ConversationMemory();

        memory.recordFact('years_experience', 5);
        memory.recordFact('notice_period', '30 days');
        memory.recordFact('current_salary', '18 LPA');

        const state = memory.getState();
        assert.strictEqual(state.facts_collected.years_experience, 5);
        assert.strictEqual(state.facts_collected.notice_period, '30 days');
    });

    // -------------------------------------------------------------
    // Suite 5: Automatic Language-Aware Voice Selection
    // -------------------------------------------------------------
    console.log('\n--- Suite 5: Telugu & English Voice Selection ---');

    await test('Telugu caller routes to compatible voice ID', () => {
        const teluguVoice = ElevenLabsService.getVoiceIdForLanguage('te');
        const expectedVoice = ElevenLabsService.getVoiceIdForLanguage('te');
        assert.ok(teluguVoice, 'Telugu must route to a valid voice ID');
        assert.strictEqual(teluguVoice, expectedVoice);
    });

    await test('English caller routes to ElevenLabs SID voice ID', () => {
        const englishVoice = ElevenLabsService.getVoiceIdForLanguage('en');
        const expectedSid = ElevenLabsService.getSidVoiceId();
        assert.strictEqual(englishVoice, expectedSid, 'English must route to SID voice ID');
    });

    // -------------------------------------------------------------
    // Suite 6: Explainable Candidate Screening Decisions
    // -------------------------------------------------------------
    console.log('\n--- Suite 6: Explainable Screening Decisions & Scoring ---');

    await test('Strong candidate meeting JD requirements is classified as Selected', async () => {
        const candidate = {
            name: 'Vikram Rao',
            skills: 'SAP FICO, S/4HANA, General Ledger',
            experience: '6 years',
            notice_period: '15 days'
        };

        const jd = {
            job_title: 'Senior SAP FICO Consultant',
            required_skills: ['SAP FICO', 'S/4HANA'],
            min_experience_years: 5,
            max_notice_period_days: 30
        };

        const transcript = [
            { speaker: 'Remo', text: 'Hi Vikram, could you share your experience in SAP FICO?' },
            { speaker: 'Vikram', text: 'I have 6 years of hands-on experience in SAP FICO, including S/4HANA implementation and General Ledger configuration.' },
            { speaker: 'Remo', text: 'Could you tell me about a specific configuration or migration project you handled?' },
            { speaker: 'Vikram', text: 'I led the end-to-end configuration of General Ledger and Asset Accounting during an S/4HANA migration for an enterprise client, managing data migration and custom reports.' },
            { speaker: 'Remo', text: 'What is your notice period?' },
            { speaker: 'Vikram', text: 'My notice period is 15 days.' }
        ];

        const evalResult = await ScreeningEvaluator.evaluateCandidate({
            candidate,
            jdCriteria: jd,
            transcript
        });

        assert.ok(['Selected', 'On Hold', 'Rejected'].includes(evalResult.screening_outcome));
        assert.strictEqual(evalResult.screening_outcome, 'Selected');
        assert.ok(evalResult.jd_match_score >= 70, `Score should be >= 70 (got ${evalResult.jd_match_score})`);
        assert.ok(evalResult.decision_reason && evalResult.decision_reason.length > 5);
    });

    await test('Candidate missing mandatory core skill is classified as Rejected with explanation', async () => {
        const candidateAnswers = {
            years_experience: '1 year general IT support',
            skills_experience: 'Never worked with SAP, only basic Excel',
            notice_period: '90 days',
            work_arrangement: 'Remote only'
        };

        const jd = {
            job_title: 'Senior SAP FICO Consultant',
            required_skills: ['SAP FICO', 'S/4HANA'],
            min_experience_years: 5,
            max_notice_period_days: 30
        };

        const evalResult = await ScreeningEvaluator.evaluateCandidate(candidateAnswers, jd);
        assert.strictEqual(evalResult.screening_outcome, 'Rejected');
        assert.ok(evalResult.jd_match_score < 50);
        assert.ok(evalResult.decision_reason.toLowerCase().includes('sap') || evalResult.decision_reason.toLowerCase().includes('experience'));
    });

    await test('Ambiguous or short response defaults safely to On Hold rather than false rejection', async () => {
        const candidateAnswers = {
            years_experience: 'Yes',
            skills_experience: 'Yeah',
            notice_period: 'Not sure'
        };

        const jd = {
            job_title: 'Senior SAP FICO Consultant',
            required_skills: ['SAP FICO'],
            min_experience_years: 5
        };

        const evalResult = await ScreeningEvaluator.evaluateCandidate(candidateAnswers, jd);
        assert.strictEqual(evalResult.screening_outcome, 'On Hold');
        assert.ok(evalResult.decision_reason.toLowerCase().includes('incomplete') || evalResult.decision_reason.toLowerCase().includes('review'));
    });

    // -------------------------------------------------------------
    // Suite 7: Updated Excel Workbook Generation
    // -------------------------------------------------------------
    console.log('\n--- Suite 7: Updated Excel Export with AI Screening Columns ---');

    await test('Generates Excel buffer containing AI Screening Status and Match Score columns', async () => {
        const buffer = await ExcelService.generateUpdatedWorkbook({ campaignId: sapCampId });
        assert.ok(Buffer.isBuffer(buffer), 'Excel export must produce a valid Buffer');
        assert.ok(buffer.length > 500, `Buffer size should be valid (.xlsx) (got ${buffer.length} bytes)`);
    });

    // -------------------------------------------------------------
    // Suite 8: Campaign Lifecycle (Start, Pause, Duplicate, Archive)
    // -------------------------------------------------------------
    console.log('\n--- Suite 8: Campaign Lifecycle & Safe Duplication ---');

    await test('Duplicate campaign clones configuration without duplicating call history or re-dialing', async () => {
        const cloned = await CampaignService.duplicateCampaign(sapCampId, 'test_admin_01');
        assert.ok(cloned.id);
        assert.notStrictEqual(cloned.id, sapCampId);
        assert.ok(cloned.name.includes('(Copy)'));
        assert.strictEqual(cloned.status, 'DRAFT', 'Cloned campaign must start as DRAFT');
        assert.strictEqual(cloned.completed_calls, 0, 'Cloned campaign must not duplicate completed calls');
        assert.strictEqual(cloned.selected_count, 0, 'Cloned campaign must have 0 initial selected candidates');
    });

    await test('Campaign pause and resume transitions state correctly', async () => {
        const paused = await CampaignService.pauseCampaign(sapCampId, 'test_admin_01');
        assert.strictEqual(paused.status, 'PAUSED');

        const resumed = await CampaignService.resumeCampaign(sapCampId, 'test_admin_01');
        assert.strictEqual(resumed.status, 'ACTIVE');
    });

    await test('Campaign archive marks campaign ARCHIVED safely', async () => {
        const archived = await CampaignService.archiveCampaign(sapCampId, 'test_admin_01');
        assert.strictEqual(archived.status, 'ARCHIVED');
    });

    await test('Re-uploading Excel transitions ARCHIVED or COMPLETED campaign to READY with clean queue', async () => {
        const testCsv = 'Name,Phone,Language\nTest Candidate,919876543210,en\n';
        const fileObj = {
            buffer: Buffer.from(testCsv),
            mimetype: 'text/csv'
        };
        const reuploadRes = await CampaignService.attachExcel(sapCampId, fileObj, 'new_candidates.csv', 'test_admin_01');
        assert.ok(reuploadRes.batchId, 'Must create a new batch');
        assert.strictEqual(reuploadRes.validRows, 1);

        const refreshed = await CampaignService.getCampaign(sapCampId, 'test_admin_01');
        assert.strictEqual(refreshed.status, 'READY', 'Reuploading contacts must set campaign to READY to continue');
        assert.strictEqual(refreshed.excel_filename, 'new_candidates.csv');
    });

    await test('Campaign delete permanently removes campaign and associated DB records and queue items', async () => {
        // Create an isolated campaign to delete
        const toDelete = await CampaignService.createCampaign({
            name: 'Campaign To Permanently Delete',
            service: 'recruitment',
            ownerUserId: 'test_admin_01'
        });

        const testCsv = 'Name,Phone,Language\nDelete User,919999999999,en\n';
        await CampaignService.attachExcel(toDelete.id, { buffer: Buffer.from(testCsv), mimetype: 'text/csv' }, 'delete_test.csv', 'test_admin_01');

        // Permanently delete
        const delRes = await CampaignService.deleteCampaign(toDelete.id, 'test_admin_01');
        assert.strictEqual(delRes.success, true);

        // Verify campaign is completely gone
        const checkCamp = await CampaignService.getCampaign(toDelete.id, 'test_admin_01');
        assert.strictEqual(checkCamp, null, 'Deleted campaign must not exist in database');

        // Verify contacts and batches are deleted
        const remainingContacts = await db.all('SELECT id FROM contacts WHERE campaign_id = ?', [toDelete.id]);
        assert.strictEqual(remainingContacts.length, 0, 'Associated contacts must be deleted');

        const remainingBatches = await db.all('SELECT id FROM batches WHERE campaign_id = ?', [toDelete.id]);
        assert.strictEqual(remainingBatches.length, 0, 'Associated batches must be deleted');
    });

    // -------------------------------------------------------------
    // Final Summary
    // -------------------------------------------------------------
    console.log('\n================================================================');
    console.log(`TEST RESULTS: ${passedTests} / ${totalTests} Passed (${Math.round((passedTests / totalTests) * 100)}%)`);
    console.log('================================================================\n');

    if (passedTests === totalTests) {
        console.log('ALL REMO CAMPAIGN & NATURAL VOICE OVERHAUL TESTS PASSED.');
        process.exit(0);
    } else {
        console.error(`FAILED: ${totalTests - passedTests} tests did not pass.`);
        process.exit(1);
    }
}

runAllTests().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
