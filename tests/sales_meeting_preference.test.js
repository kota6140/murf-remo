/**
 * tests/sales_meeting_preference.test.js
 *
 * Sales calls ask once whether the prospect prefers a call or an in-person meeting:
 * 1. The answer is read from the caller's own words (phone_call, in_person, either, undecided, declined)
 * 2. The fast path acknowledges it, closes the call and records it; a bare "yes" gets one clarification
 * 3. The AI cannot set or overwrite the preference, and the question is never said twice
 * 4. The call summary carries the preference, the original words, whether it was confirmed and the follow-up
 *
 * Run:  node tests/sales_meeting_preference.test.js
 */
import assert from 'assert';
import SalesState from '../services/sales_state.js';
import IntentService from '../services/intent_service.js';
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

const asked = { meeting_question_asked: true };
const answer = (text, collected = asked) => IntentService.matchIntent(text, {
    service: 'sales',
    stage: 'NEXT_STEP',
    language: 'en',
    lastQuestion: SalesState.meetingQuestion('en'),
    collectedData: collected
});

await test('the question is the agreed wording and is recognised in all three languages', () => {
    assert.strictEqual(SalesState.meetingQuestion('en'), 'Would you prefer to schedule a call with our team, or would you be more comfortable meeting with us in person?');
    for (const lang of ['en', 'hi', 'te']) assert.ok(SalesState.isMeetingQuestion(SalesState.meetingQuestion(lang)), lang);
    assert.ok(SalesState.isMeetingQuestion('Would you like a call or an in-person meeting?'));
    assert.ok(!SalesState.isMeetingQuestion('Is this a good time to talk?'));
});

await test('answers are read into the right preference', () => {
    const cases = {
        'A call would be fine.': 'phone_call',
        "I'd prefer to meet in person.": 'in_person',
        'Face to face is better': 'in_person',
        'Either works for me': 'either',
        'Both are fine': 'either',
        "I'm not sure yet, let me think": 'undecided',
        'Not right now.': 'declined',
        'No': 'declined',
        "I'm not interested": 'declined',
        'No calls, in person please': 'in_person',
        "I don't want a call, let's meet": 'in_person',
        'not in person, call me': 'phone_call',
        'Neither, thanks': 'declined'
    };
    for (const [text, expected] of Object.entries(cases)) {
        assert.strictEqual(SalesState.detectMeetingPreference(text), expected, text);
    }
});

await test('an answer that does not say anything is never turned into a preference', () => {
    for (const text of ['', 'yes', 'okay', 'what do you mean', "I'm in a meeting", 'who is this', 'a call first and then in person']) {
        assert.strictEqual(SalesState.detectMeetingPreference(text), null, `"${text}"`);
    }
});

await test('Hindi and Telugu answers are understood', () => {
    assert.strictEqual(SalesState.detectMeetingPreference('फोन पर बात कर लेंगे'), 'phone_call');
    assert.strictEqual(SalesState.detectMeetingPreference('आमने सामने मुलाकात ठीक रहेगी'), 'in_person');
    assert.strictEqual(SalesState.detectMeetingPreference('ఫోన్ కాల్ చాలు'), 'phone_call');
});

await test('a phone-call answer is acknowledged, recorded and the call closes', () => {
    const r = answer('A call would be fine.');
    assert.ok(r.matched);
    assert.ok(r.spoken_response.startsWith('Perfect. Our team will reach out to coordinate the call and share the details with you.'));
    assert.ok(r.spoken_response.includes('Have a great day'));
    assert.strictEqual(r.should_end_call, true);
    assert.strictEqual(r.extracted_fields.meeting_preference, 'phone_call');
    assert.strictEqual(r.extracted_fields.meeting_preference_raw, 'A call would be fine.');
    assert.strictEqual(r.extracted_fields.meeting_preference_confirmed, true);
    assert.strictEqual(r.classification, 'Meeting Requested');
});

await test('in person, either and declined get their own acknowledgement', () => {
    assert.ok(answer("I'd prefer to meet in person.").spoken_response.startsWith('Absolutely. Our team will reach out to coordinate the meeting'));
    assert.ok(answer('Either works for me').spoken_response.startsWith('Sounds good. Our team will reach out to coordinate the next steps'));
    const declined = answer('Not right now.');
    assert.strictEqual(declined.spoken_response, "No problem. Thank you for your time. Our team can reconnect if you'd like to explore this in the future.");
    assert.strictEqual(declined.extracted_fields.meeting_preference, 'declined');
    assert.strictEqual(declined.classification, undefined);
    assert.strictEqual(declined.should_end_call, true);
});

await test('a bare "yes" gets one clarification, then nothing more is forced', () => {
    const first = answer('Yes');
    assert.ok(first.matched && /phone call or an in-person meeting/.test(first.spoken_response));
    assert.strictEqual(first.should_end_call, false);
    assert.strictEqual(first.extracted_fields.meeting_preference, undefined);
    const again = answer('Yes', { ...asked, ...first.extracted_fields });
    assert.ok(!again.extracted_fields || again.extracted_fields.meeting_preference === undefined);
    assert.ok(!again.matched || !/in-person/.test(again.spoken_response), 'the clarification is not repeated');
});

await test('before the question is asked, or after it is answered, nothing is recorded', () => {
    const before = answer('A call would be fine.', {});
    assert.ok(!before.extracted_fields || before.extracted_fields.meeting_preference === undefined);
    const done = { ...asked, ...SalesState.meetingFields('in_person', 'in person') };
    const after = answer('actually a call is better', done);
    assert.ok(!after.extracted_fields || after.extracted_fields.meeting_preference === undefined);
});

await test('"do not call" still wins over the meeting answer', () => {
    const r = answer('Do not call me again');
    assert.strictEqual(r.reason, 'do_not_call');
});

await test('the AI cannot set or overwrite the preference', () => {
    const confirmed = { ...asked, ...SalesState.meetingFields('in_person', "I'd prefer to meet in person.") };
    const kept = SalesState.filterAiFields(confirmed, {
        meeting_preference: 'phone_call',
        meeting_preference_raw: 'x',
        meeting_preference_confirmed: false,
        follow_up_action: 'x',
        followup_preference: 'email',
        timeline: 'next month'
    });
    assert.deepStrictEqual(kept, { timeline: 'next month' });
});

await test('the question is marked as asked, and its repeat is held back', () => {
    const q = SalesState.meetingQuestion('en');
    assert.deepStrictEqual(SalesState.noteSpokenReply({}, q), { meeting_question_asked: true });
    assert.strictEqual(SalesState.noteSpokenReply({}, 'Is this a good time?'), null);
    // first re-ask is the one allowed clarification, the next is held back
    assert.strictEqual(SalesState.wouldRepeatMeetingQuestion(asked, q), false);
    const clarified = { ...asked, meeting_clarification_asked: true };
    assert.strictEqual(SalesState.wouldRepeatMeetingQuestion(clarified, q), true);
    assert.strictEqual(SalesState.wouldRepeatMeetingQuestion({ ...asked, ...SalesState.meetingFields('phone_call', 'call') }, q), true);
});

await test('the question comes up only once the discovery questions are done', () => {
    const done = { service_needed: 'website', project_description: 'portal', tech_preference: 'Team recommendation', additional_info: 'none' };
    assert.ok(SalesState.needsMeetingQuestion(done));
    assert.ok(!SalesState.needsMeetingQuestion({ service_needed: 'website' }));
    assert.ok(!SalesState.needsMeetingQuestion({ ...done, meeting_question_asked: true }));
    assert.ok(!SalesState.needsMeetingQuestion({ ...done, call_outcome: 'Not Interested' }));
    assert.ok(SalesState.buildPromptBlock(done).includes(SalesState.meetingQuestion('en')));
    assert.ok(SalesState.buildPromptBlock(asked).includes('NEVER ask the call-or-in-person question again'));
    assert.ok(SalesState.buildPromptBlock({ meeting_preference: 'in_person' }).includes('Do NOT ask about a call or an in-person meeting again'));
});

await test('the sales AI prompt tells the AI to ask it once and not to record it', async () => {
    let seen = null;
    const realGenerate = LLMService.generate;
    LLMService.generate = async (args) => {
        seen = args;
        return { text: '{"spoken_response":"Sure.","extracted_fields":{}}', provider: 't', model: 't' };
    };
    try {
        await GeminiService.generateReply('sales', { name: 'Priya' }, [{ speaker: 'REMO', text: 'Hello' }], 'nothing else', {
            service_needed: 'website', project_description: 'portal', tech_preference: 'Team recommendation', additional_info: 'none'
        }, { currentStage: 'ADDITIONAL_INFO' });
    } finally {
        LLMService.generate = realGenerate;
    }
    assert.ok(seen.systemPrompt.includes(SalesState.meetingQuestion('en')));
    assert.ok(seen.systemPrompt.includes('Never record or guess it yourself'));
});

await test('the summary carries the preference, the original words, confirmation and follow-up', () => {
    const collected = { service_needed: 'a website', ...SalesState.meetingFields('in_person', "I'd prefer to meet in person.") };
    const s = SalesState.composeSalesSummary(collected, { classification: 'Meeting Requested', summary: 'Caller wants a website.' });
    assert.ok(s.startsWith('Caller wants a website.'));
    assert.ok(s.includes('Sales Lead Summary'));
    assert.ok(s.includes('Interest: Interested in a website.'));
    assert.ok(s.includes('Meeting Preference: In-person meeting.'));
    assert.ok(s.includes('Original Response: "I\'d prefer to meet in person."'));
    assert.ok(s.includes('Preference Confirmed: Yes.'));
    assert.ok(s.includes('Follow-up Action: Sales team to contact the prospect to coordinate an in-person meeting and share the details.'));
    const call = SalesState.composeSalesSummary(SalesState.meetingFields('phone_call', 'a call'), {});
    assert.ok(call.includes('Meeting Preference: Phone call.'));
    assert.ok(call.includes('coordinate a call and share the details'));
});

await test('a question that was never answered is not_specified and unconfirmed', () => {
    const f = SalesState.finalizeMeetingFields({ meeting_question_asked: true });
    assert.deepStrictEqual(f, {
        meeting_preference: 'not_specified',
        meeting_preference_raw: null,
        meeting_preference_confirmed: false,
        follow_up_action: 'Sales team to follow up with the prospect to confirm their preferred meeting format.'
    });
    const s = SalesState.composeSalesSummary({}, { summary: 'Short call.' });
    assert.ok(s.includes('Meeting Preference: Not specified.'));
    assert.ok(s.includes('Preference Confirmed: No.'));
    assert.ok(!s.includes('Original Response'));
    // an invalid value from anywhere is not kept
    assert.strictEqual(SalesState.finalizeMeetingFields({ meeting_preference: 'zoom' }).meeting_preference, 'not_specified');
});

await test('a stored preference survives finalizing unchanged', () => {
    const stored = SalesState.meetingFields('either', 'whichever is easier');
    const f = SalesState.finalizeMeetingFields(stored);
    assert.strictEqual(f.meeting_preference, 'either');
    assert.strictEqual(f.meeting_preference_raw, 'whichever is easier');
    assert.strictEqual(f.meeting_preference_confirmed, true);
});

console.log(`\n${passed}/${total} sales meeting preference tests passed\n`);
process.exit(passed === total ? 0 : 1);
