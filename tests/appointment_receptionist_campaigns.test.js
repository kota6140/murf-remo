/**
 * tests/appointment_receptionist_campaigns.test.js
 *
 * Campaign support for the appointment-setting and receptionist work types:
 * 1. Contact sheets upload under the new services and recognise appointment columns
 * 2. Start-calling queues the sheet (without dialling in this test)
 * 3. The Excel report has the right columns for each work type
 * 4. Business documents are read into services, hours, booking rules, FAQs (AI result and plain-text fallback)
 * 5. Question plans exist for both and use the document's facts
 * 6. Campaigns can be created for both and a document attached
 * 7. The call prompt carries the campaign document's facts
 * 8. The old work types still behave as before
 *
 * Run:  USE_LOCAL_DB=true node tests/appointment_receptionist_campaigns.test.js
 * It uses the local SQLite database and removes every row and file it creates.
 */
process.env.USE_LOCAL_DB = 'true';
process.env.PLIVO_AUTH_ID = '';
process.env.PLIVO_AUTH_TOKEN = '';

import assert from 'assert';
import fs from 'fs';
import * as xlsx from 'xlsx';
import ExcelJS from 'exceljs';
import db, { initDb, ensureCampaignSchema } from '../services/db.js';
import ExcelService, { cellToText } from '../services/excel_service.js';
import AppointmentService from '../services/appointment_service.js';
import ReceptionistService from '../services/receptionist_service.js';
import SalesService from '../services/sales_service.js';
import DocumentService from '../services/document_service.js';
import QuestionPlanner from '../services/question_planner.js';
import CampaignService from '../services/campaign_service.js';
import CallQueueWorker from '../services/call_queue_worker.js';
import GeminiService from '../services/gemini_service.js';
import LLMService from '../services/llm_service.js';

let total = 0;
let passed = 0;
async function test(name, fn) {
    total++;
    try {
        await fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        console.error(`  FAIL ${name}\n       ${e.message}`);
    }
}

const OWNER = 'usr_test_campaign_owner';
const batchIds = [];
const campaignIds = [];
const files = [];

const csv = (rows) => Buffer.from(rows.map((r) => r.join(',')).join('\n'));

await initDb();
await ensureCampaignSchema();
// Never dial in a test: with the queue paused, starting a campaign only fills the queue
CallQueueWorker.isPaused = true;

async function cleanup() {
    for (const id of batchIds) {
        const b = await db.get('SELECT original_path FROM batches WHERE id = ?', [id]);
        if (b && b.original_path) files.push(b.original_path);
        await db.run('DELETE FROM call_queue WHERE batch_id = ?', [id]);
        await db.run('DELETE FROM contacts WHERE batch_id = ?', [id]);
        await db.run('DELETE FROM batches WHERE id = ?', [id]);
    }
    for (const id of campaignIds) {
        const c = await db.get('SELECT pdf_path FROM campaigns WHERE id = ?', [id]);
        if (c && c.pdf_path) files.push(c.pdf_path);
        await db.run('DELETE FROM campaigns WHERE id = ?', [id]);
    }
    for (const f of files) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
    // Uploads that fail validation are still saved to disk by the upload code; remove this test's rejected file.
    const uploads = new URL('../data/uploads/', import.meta.url);
    for (const name of fs.readdirSync(uploads)) {
        if (name.endsWith('_nophone.csv')) { try { fs.unlinkSync(new URL(name, uploads)); } catch { /* ignore */ } }
    }
}

console.log('\nAppointment-setting and receptionist campaigns');

let apptBatch;
await test('an appointment sheet uploads and its appointment columns are recognised', async () => {
    const buf = csv([
        ['Name', 'Phone Number', 'Appointment Date', 'Preferred Time', 'Purpose'],
        ['Asha Rao', '9876500001', '2026-11-03', '4 PM', 'Teeth cleaning'],
        ['Ravi Kumar', '9876500002', '2026-11-04', '10 AM', 'Check-up'],
        ['Bad Row', 'abc', '', '', '']
    ]);
    const res = await AppointmentService.validateAndProcessUpload({ buffer: buf }, 'appts.csv');
    batchIds.push(res.fileId);
    apptBatch = res;
    assert.strictEqual(res.service, 'appointment');
    assert.strictEqual(res.validRows, 2);
    assert.strictEqual(res.invalidRows, 1);
    const b = await db.get('SELECT service FROM batches WHERE id = ?', [res.fileId]);
    assert.strictEqual(b.service, 'appointment');
    const c = await db.get("SELECT service, extra_data FROM contacts WHERE batch_id = ? AND name = 'Asha Rao'", [res.fileId]);
    assert.strictEqual(c.service, 'appointment');
    const extra = JSON.parse(c.extra_data);
    assert.strictEqual(extra.appointment_date, '2026-11-03');
    assert.strictEqual(extra.appointment_time, '4 PM');
    assert.strictEqual(extra.appointment_purpose, 'Teeth cleaning');
});

await test('a real .xlsx with date and time cells is read as the right day and time', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.addRow(['Name', 'Phone', 'Appointment Date', 'Appointment Time']);
    ws.addRow(['Xlsx Person', '9876500044', new Date(Date.UTC(2026, 10, 3)), new Date(Date.UTC(1899, 11, 30, 16, 30))]);
    const res = await AppointmentService.validateAndProcessUpload({ buffer: Buffer.from(await wb.xlsx.writeBuffer()) }, 'dates.xlsx');
    batchIds.push(res.fileId);
    const c = await db.get("SELECT extra_data FROM contacts WHERE batch_id = ? AND name = 'Xlsx Person'", [res.fileId]);
    const extra = JSON.parse(c.extra_data);
    assert.strictEqual(extra.appointment_date, '2026-11-03', 'the date');
    assert.strictEqual(extra.appointment_time, '16:30', 'the time');
});

let recepBatch;
await test('a receptionist follow-up sheet uploads under the receptionist service', async () => {
    const res = await ReceptionistService.validateAndProcessUpload({ buffer: csv([['Name', 'Mobile'], ['Meena', '9876500003']]) }, 'followups.csv');
    batchIds.push(res.fileId);
    recepBatch = res;
    assert.strictEqual(res.service, 'receptionist');
    assert.strictEqual(res.validRows, 1);
});

await test('a bad file is refused with a clear message', async () => {
    await assert.rejects(() => AppointmentService.validateAndProcessUpload({ buffer: Buffer.from('x') }, 'notes.txt'), /Invalid file format/);
    await assert.rejects(() => AppointmentService.validateAndProcessUpload({ buffer: csv([['Name', 'Email'], ['A', 'a@b.c']]) }, 'nophone.csv'), /Phone/);
});

await test('start calling queues the sheet (queue paused, so nothing is dialled)', async () => {
    const res = await AppointmentService.startCallingCampaign(apptBatch.fileId);
    assert.strictEqual(res.status, 'CALLING_STARTED');
    assert.strictEqual(res.service, 'appointment');
    const q = await db.get("SELECT COUNT(*) AS n FROM call_queue WHERE batch_id = ? AND service = 'appointment'", [apptBatch.fileId]);
    assert.strictEqual(Number(q.n), 2);
    await assert.rejects(() => ReceptionistService.startCallingCampaign('no_such_batch_id_xyz'), /not found/);
});

await test('date and time cells become readable text, not Excel serial numbers', async () => {
    assert.strictEqual(cellToText(new Date(2026, 10, 3)), '2026-11-03');
    assert.strictEqual(cellToText(new Date(2026, 10, 3, 16, 0)), '2026-11-03 16:00');
    assert.strictEqual(cellToText(new Date(1899, 11, 30, 16, 30)), '16:30');
    // CSV "2026-11-03" is read as midnight UTC; Excel dates arrive a few seconds early
    assert.strictEqual(cellToText(new Date(Date.UTC(2026, 10, 3))), '2026-11-03');
    assert.strictEqual(cellToText(new Date(2026, 10, 2, 23, 59, 50)), '2026-11-03');
    assert.strictEqual(cellToText(new Date(2026, 10, 3, 16, 29, 50)), '2026-11-03 16:30');
    assert.strictEqual(cellToText('  4 PM '), '4 PM');
    assert.strictEqual(cellToText(9876543210), '9876543210');
    assert.strictEqual(cellToText(new Date('invalid')), 'Invalid Date');
});

const headersOf = async (service, batchId) => {
    const buf = await ExcelService.generateUpdatedWorkbook({ service, batchId });
    const wb = xlsx.read(Buffer.from(buf), { type: 'buffer' });
    return xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0];
};

await test('the Excel report has appointment columns, receptionist columns, and unchanged recruitment columns', async () => {
    const appt = await headersOf('appointment', apptBatch.fileId);
    assert.ok(appt.includes('Appointment Outcome') && appt.includes('Preferred Date') && appt.includes('Preferred Time'), appt.join('|'));
    const recep = await headersOf('receptionist', recepBatch.fileId);
    assert.ok(recep.includes('Reason For Call') && recep.includes('Callback Number') && recep.includes('Message Taken'), recep.join('|'));
    const rec = await headersOf('recruitment', null);
    assert.ok(rec.includes('AI Screening Status') && rec.includes('JD Match Score'));
});

const realExtract = DocumentService.extractText;
const realGenerate = LLMService.generate;
const DOC_TEXT = 'Company: Smile Dental Clinic\nWorking Hours: Mon-Sat 9am to 6pm\nLocation: 12 MG Road\nServices: Check-up, Teeth cleaning, Root canal';
DocumentService.extractText = async () => ({ text: DOC_TEXT, fileType: 'PDF', charCount: DOC_TEXT.length, wordCount: 20 });

await test('documents are read into business facts (AI result)', async () => {
    LLMService.generate = async () => ({
        provider: 'test',
        parsedJson: {
            company_name: 'Smile Dental Clinic', business_type: 'Dental clinic', services_offered: ['Check-up', 'Cleaning'],
            working_hours: 'Mon-Sat 9am to 6pm', location: '12 MG Road', booking_rules: '30-minute slots',
            approved_faqs: [{ question: 'Insurance?', answer: 'Most providers.' }], opening_greeting: 'Hello, this is Remo calling from Smile Dental Clinic.'
        }
    });
    const appt = await DocumentService.parseCampaignDocument(Buffer.from('x'), 'info.pdf', 'appointment');
    assert.strictEqual(appt.company_name, 'Smile Dental Clinic');
    assert.deepStrictEqual(appt.services_offered, ['Check-up', 'Cleaning']);
    assert.strictEqual(appt.booking_rules, '30-minute slots');
    assert.deepStrictEqual(appt.departments_and_contacts, []);
    const recep = await DocumentService.parseCampaignDocument(Buffer.from('x'), 'info.pdf', 'receptionist');
    assert.strictEqual(recep.working_hours, 'Mon-Sat 9am to 6pm');
});

await test('documents are still read when the AI is unavailable (plain-text fallback)', async () => {
    LLMService.generate = async () => ({ provider: 'none' });
    const appt = await DocumentService.parseCampaignDocument(Buffer.from('x'), 'info.pdf', 'appointment');
    assert.strictEqual(appt.company_name, 'Smile Dental Clinic');
    assert.strictEqual(appt.working_hours, 'Mon-Sat 9am to 6pm');
    assert.deepStrictEqual(appt.services_offered, ['Check-up', 'Teeth cleaning', 'Root canal']);
    assert.ok(/book your appointment/.test(appt.opening_greeting));
    const recep = await DocumentService.parseCampaignDocument(Buffer.from('x'), 'info.pdf', 'receptionist');
    assert.ok(recep.message_policy && /front desk/.test(recep.opening_greeting));
});

await test('question plans exist for both and use the document facts', async () => {
    const apptPlan = await QuestionPlanner.generatePlanFor('appointment', { company_name: 'Smile Dental Clinic', working_hours: 'Mon-Sat 9am to 6pm', services_offered: ['Check-up'] });
    assert.ok(apptPlan.length >= 4 && apptPlan.every((q) => q.id && q.stage && q.text));
    assert.ok(apptPlan.some((q) => q.text.includes('Mon-Sat 9am to 6pm')));
    assert.ok(apptPlan[0].text.includes('Smile Dental Clinic'));
    const recepPlan = await QuestionPlanner.generatePlanFor('receptionist', { company_name: 'Smile Dental Clinic' });
    assert.ok(recepPlan.length >= 3 && recepPlan[0].stage === 'REASON_FOR_CALL');
    // old work types unchanged
    assert.strictEqual((await QuestionPlanner.generatePlanFor('sales', {}))[0].id, 'q_sales_intro');
    assert.strictEqual((await QuestionPlanner.generatePlanFor('support', {}))[0].id, 'q_support_greeting');
});

await test('campaigns can be created for both services, and a document attached', async () => {
    const c1 = await CampaignService.createCampaign({ name: 'TEST Dental bookings', service: 'appointment', ownerUserId: OWNER });
    const c2 = await CampaignService.createCampaign({ name: 'TEST Front desk', service: 'receptionist', ownerUserId: OWNER });
    campaignIds.push(c1.id, c2.id);
    assert.strictEqual(c1.service, 'appointment');
    assert.strictEqual(c2.service, 'receptionist');
    const r = await CampaignService.attachDocument(c1.id, Buffer.from('%PDF-1.4 test'), 'clinic.pdf', OWNER);
    assert.ok(r.questionPlan.length >= 4);
    const saved = await CampaignService.getCampaign(c1.id, OWNER);
    assert.strictEqual(saved.extracted_data.company_name, 'Smile Dental Clinic');
    assert.ok(Array.isArray(saved.question_plan) && saved.question_plan.length >= 4);
});

await test('the call prompt carries the campaign document facts', async () => {
    const realCall = LLMService.generate;
    let captured = null;
    LLMService.generate = async (opts) => { captured = opts; return { text: JSON.stringify({ spoken_response: 'Sure.', detected_language: 'en', should_end_call: false, extracted_fields: {}, classification: 'Appointment Booked', call_summary: 'ok' }), provider: 'test', model: 'test' }; };
    try {
        const ctx = { company_name: 'Smile Dental Clinic', business_type: 'Dental clinic', services_offered: ['Check-up', 'Cleaning'], working_hours: 'Mon-Sat 9am to 6pm', booking_rules: 'Cancel 4 hours before', approved_faqs: [{ question: 'Insurance?', answer: 'Most providers.' }] };
        await GeminiService.generateReply('appointment', { name: 'Asha' }, [{ speaker: 'REMO', text: 'Hi' }], 'Friday', {}, { campaignContext: ctx });
        assert.ok(captured.systemPrompt.includes('Mon-Sat 9am to 6pm'));
        assert.ok(captured.systemPrompt.includes('Cancel 4 hours before'));
        assert.ok(captured.systemPrompt.includes('Most providers.'));
        assert.ok(captured.systemPrompt.includes('Smile Dental Clinic'));
        await GeminiService.generateReply('receptionist', { name: 'Caller' }, [{ speaker: 'REMO', text: 'Hi' }], 'Open Sunday?', {}, { campaignContext: { ...ctx, message_policy: 'Team calls back next working day' } });
        assert.ok(captured.systemPrompt.includes('Team calls back next working day'));
        // no document: the prompt still works
        await GeminiService.generateReply('appointment', { name: 'Asha' }, [{ speaker: 'REMO', text: 'Hi' }], 'Friday', {}, {});
        assert.ok(captured.systemPrompt.includes('APPOINTMENT SETTING WORKFLOW'));
    } finally { LLMService.generate = realCall; }
});

await test('the campaign document opening greeting is used for outgoing calls', async () => {
    const out = GeminiService.getOpeningGreeting('appointment', { name: 'Asha', direction: 'outbound', campaignContext: { opening_greeting: 'Hello, this is Remo calling from Smile Dental Clinic about your booking.' } });
    assert.ok(out.includes('Asha') && out.includes('Smile Dental Clinic'), out);
    const inb = GeminiService.getOpeningGreeting('appointment', { company: 'Smile Dental Clinic', direction: 'inbound', campaignContext: { opening_greeting: 'Hello, this is Remo calling from X about your booking.' } });
    assert.ok(inb.startsWith('Thank you for calling'), inb);
});

await test('old work types still upload and plan as before', async () => {
    const res = await SalesService.validateAndProcessUpload({ buffer: csv([['Lead Name', 'Phone', 'Company'], ['Tom', '9876500009', 'Acme']]) }, 'leads.csv');
    batchIds.push(res.fileId);
    assert.strictEqual(res.service, 'sales');
    assert.strictEqual(res.validRows, 1);
    const sc = await CampaignService.createCampaign({ name: 'TEST Sales', service: 'sales', ownerUserId: OWNER });
    campaignIds.push(sc.id);
    assert.strictEqual(sc.service, 'sales');
    const bad = await CampaignService.createCampaign({ name: 'TEST Unknown', service: 'banking', ownerUserId: OWNER });
    campaignIds.push(bad.id);
    assert.strictEqual(bad.service, 'recruitment', 'unknown types still fall back to recruitment');
});

DocumentService.extractText = realExtract;
LLMService.generate = realGenerate;
await cleanup();
console.log(`\n${passed}/${total} appointment / receptionist campaign tests passed\n`);
process.exit(passed === total ? 0 : 1);
