import LLMService from './llm_service.js';

/**
 * services/question_planner.js
 * 
 * Generates tailored, non-redundant conversational question plans from extracted JD
 * criteria or campaign knowledge bases.
 * 
 * Rules:
 * 1. Role-specific: SAP Consultant asks about SAP modules; MERN asks about React/Node.
 * 2. Non-repetitive: Each question has an ID and maps to a target field.
 * 3. Compact & conversational: Sentences are crisp and phone-ready.
 * 4. Closing rule: Always includes a final stage where the AI asks if the caller has any questions.
 */

export class QuestionPlanner {
    /**
     * Generates a tailored recruitment screening question plan.
     * @param {object} jdCriteria - Structured output from PDFService.parseRecruitmentJD
     * @returns {Promise<Array<object>>} Ordered list of screening questions
     */
    static async generateRecruitmentPlan(jdCriteria) {
        const title = jdCriteria.job_title || 'Software Engineer';
        const skills = (jdCriteria.required_skills || []).join(', ');
        const exp = jdCriteria.min_experience_years || 3;
        const location = jdCriteria.work_arrangement || 'our primary office';
        const noticeMax = jdCriteria.max_notice_period_days || 30;

        const prompt = `You are a conversational AI voice agent designer.
Create a natural, concise, phone-based screening interview plan for:
- Role: ${title}
- Required Skills: ${skills || 'Core role skills'}
- Minimum Experience: ${exp} years
- Work Arrangement / Location: ${location}
- Maximum Acceptable Notice Period: ${noticeMax} days

Design 5 to 6 conversational questions that Remo will ask the candidate.
Rules:
1. One question at a time. Natural phone phrasing.
2. Must include:
   - Availability check ("Do you have a couple of minutes to talk?")
   - Overall relevant experience in ${title}
   - Technical hands-on experience with ${skills}
   - Notice period and current employment status
   - Comfort with location (${location})
   - Final wrap-up question: "Before we wrap up, do you have any questions for me?"
3. Never use generic or robotic templates.

Return ONLY a valid JSON array matching this format:
[
  {
    "id": "q_availability",
    "stage": "AVAILABILITY",
    "text": "Hi, do you have a couple of minutes to discuss this opportunity?",
    "field_to_collect": "is_available",
    "mandatory": true
  },
  {
    "id": "q_experience",
    "stage": "EXPERIENCE",
    "text": "Could you share a brief overview of your experience as a ${title}?",
    "field_to_collect": "experience_summary",
    "mandatory": true
  },
  {
    "id": "q_technical_skills",
    "stage": "SKILLS",
    "text": "How hands-on have you been with ${skills || 'the core technical stack'} in your recent projects?",
    "field_to_collect": "technical_skills",
    "mandatory": true
  },
  {
    "id": "q_notice_period",
    "stage": "LOGISTICS",
    "text": "What is your official notice period, or are you available to join immediately?",
    "field_to_collect": "notice_period_days",
    "mandatory": true
  },
  {
    "id": "q_location",
    "stage": "LOGISTICS",
    "text": "Are you comfortable with the ${location} work arrangement?",
    "field_to_collect": "location_preference",
    "mandatory": false
  },
  {
    "id": "q_candidate_questions",
    "stage": "CANDIDATE_QUESTIONS",
    "text": "Before we wrap up, do you have any questions for me about the role or the company?",
    "field_to_collect": "candidate_inquiry",
    "mandatory": false
  }
]`;

        const res = await LLMService.generate({
            systemPrompt: 'You produce clean JSON arrays of conversational voice interview questions.',
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 1000,
            jsonMode: true,
            timeoutMs: 8000
        });

        if (Array.isArray(res.parsedJson) && res.parsedJson.length >= 3) {
            return res.parsedJson;
        }

        // Deterministic fallback plan
        return [
            {
                id: "q_availability",
                stage: "AVAILABILITY",
                text: "Hi, do you have a couple of minutes to talk about the role?",
                field_to_collect: "is_available",
                mandatory: true
            },
            {
                id: "q_experience",
                stage: "EXPERIENCE",
                text: `How many years of professional experience do you have with ${title}?`,
                field_to_collect: "experience_years",
                mandatory: true
            },
            {
                id: "q_skills",
                stage: "SKILLS",
                text: `Could you highlight your recent hands-on work with ${skills || 'the core technologies'}?`,
                field_to_collect: "skills_detail",
                mandatory: true
            },
            {
                id: "q_notice_period",
                stage: "LOGISTICS",
                text: "What is your current notice period, or are you serving it right now?",
                field_to_collect: "notice_period_days",
                mandatory: true
            },
            {
                id: "q_location",
                stage: "LOGISTICS",
                text: `Are you comfortable with ${location}?`,
                field_to_collect: "location_preference",
                mandatory: false
            },
            {
                id: "q_candidate_questions",
                stage: "CANDIDATE_QUESTIONS",
                text: "Before we wrap up, do you have any questions for me about the team or position?",
                field_to_collect: "candidate_inquiry",
                mandatory: false
            }
        ];
    }

    /**
     * Generates a tailored outbound sales qualification question plan grounded in document knowledge.
     */
    static generateSalesPlan(salesKnowledge = {}) {
        const prod = salesKnowledge.product_name || 'our IT & software development services';
        const isDefaultPlan = !salesKnowledge.product_name; // no product given: the built-in IT / software plan
        const cta = salesKnowledge.call_to_action || (isDefaultPlan ? 'schedule a brief 15-minute technical discovery session' : 'schedule a quick 15-minute walkthrough');
        const features = Array.isArray(salesKnowledge.key_features) && salesKnowledge.key_features.length ? salesKnowledge.key_features.slice(0, 2).join(' or ') : '';

        const introText = isDefaultPlan
            ? "Do you have a quick moment to speak about your current software or engineering initiatives?"
            : `Do you have a quick moment to speak about your initiatives regarding ${prod}?`;

        const discoveryText = isDefaultPlan
            ? "Are you currently looking to build new custom software, modernize existing systems, or scale up your engineering team?"
            : `Are you currently exploring solutions for ${prod}${features ? `, such as ${features}` : ''}?`;

        const ctaText = isDefaultPlan
            ? `Would it be helpful to ${cta} with our senior solutions architect this week?`
            : `Would it be helpful to ${cta} with our team this week?`;

        const questionsText = isDefaultPlan
            ? "Do you have any specific technical questions about our delivery model or past case studies?"
            : `Do you have any specific questions about ${prod} or our implementation timeline?`;

        return [
            {
                id: "q_sales_intro",
                stage: "INTRODUCTION",
                text: introText,
                field_to_collect: "interest_level",
                mandatory: true
            },
            {
                id: "q_sales_discovery",
                stage: "DISCOVERY",
                text: discoveryText,
                field_to_collect: "pain_point",
                mandatory: true
            },
            {
                id: "q_sales_timeline",
                stage: "QUALIFICATION",
                text: "What timeline are you targeting for kick-off on these projects?",
                field_to_collect: "project_timeline",
                mandatory: false
            },
            {
                id: "q_sales_cta",
                stage: "NEXT_STEPS",
                text: ctaText,
                field_to_collect: "demo_agreement",
                mandatory: true
            },
            {
                id: "q_sales_questions",
                stage: "PROSPECT_QUESTIONS",
                text: questionsText,
                field_to_collect: "prospect_inquiry",
                mandatory: false
            }
        ];
    }

    /**
     * Generates a tailored customer support diagnostic question plan grounded in document knowledge.
     */
    static generateSupportPlan(supportKnowledge = {}) {
        const prod = supportKnowledge.product_name || 'customer support';
        const isDefaultPlan = !supportKnowledge.product_name || supportKnowledge.product_name.includes('TakeRemo'); // no product given: the built-in generic plan
        const diagStep = Array.isArray(supportKnowledge.troubleshooting_steps) && supportKnowledge.troubleshooting_steps.length ? supportKnowledge.troubleshooting_steps[0] : null;

        return [
            {
                id: "q_support_greeting",
                stage: "ISSUE_IDENTIFICATION",
                text: isDefaultPlan 
                    ? "Could you describe the issue or error you are currently encountering?"
                    : `Could you describe the issue you are experiencing with ${prod}?`,
                field_to_collect: "issue_description",
                mandatory: true
            },
            {
                id: "q_support_diagnostic",
                stage: "DIAGNOSTIC",
                text: diagStep && diagStep.diagnostics
                    ? `To troubleshoot this, ${diagStep.diagnostics}. What do you see?`
                    : "When did this issue begin, and does it happen consistently or intermittently?",
                field_to_collect: "reproduction_frequency",
                mandatory: true
            },
            {
                id: "q_support_resolution",
                stage: "RESOLUTION",
                text: diagStep && diagStep.resolution
                    ? `Have you tried to ${diagStep.resolution}?`
                    : "Have you tried refreshing the session or restarting the service?",
                field_to_collect: "troubleshooting_attempted",
                mandatory: false
            },
            {
                id: "q_support_wrapup",
                stage: "CLOSING",
                text: supportKnowledge.closing_note || "Is there anything else I can help you with today?",
                field_to_collect: "additional_needs",
                mandatory: false
            }
        ];
    }

    /**
     * Appointment-setting plan: purpose, day, time, name, then a read-back confirmation.
     */
    static generateAppointmentPlan(knowledge = {}) {
        const company = knowledge.company_name || 'our team';
        const services = Array.isArray(knowledge.services_offered) && knowledge.services_offered.length
            ? ` (for example ${knowledge.services_offered.slice(0, 3).join(', ')})`
            : '';
        return [
            {
                id: "q_appt_purpose",
                stage: "PURPOSE",
                text: `What would you like to book with ${company}${services}?`,
                field_to_collect: "appointment_purpose",
                mandatory: true
            },
            {
                id: "q_appt_date",
                stage: "PREFERRED_DATE",
                text: "Which day would suit you best?",
                field_to_collect: "preferred_date",
                mandatory: true
            },
            {
                id: "q_appt_time",
                stage: "PREFERRED_TIME",
                text: knowledge.working_hours
                    ? `What time works for you? We are open ${knowledge.working_hours}.`
                    : "What time works best for you?",
                field_to_collect: "preferred_time",
                mandatory: true
            },
            {
                id: "q_appt_name",
                stage: "CONTACT_DETAILS",
                text: "May I have your name for the booking?",
                field_to_collect: "caller_name",
                mandatory: true
            },
            {
                id: "q_appt_confirm",
                stage: "CONFIRMATION",
                text: knowledge.closing_note || "Let me repeat the details back to confirm. Is there anything else I can help you with?",
                field_to_collect: "confirmation",
                mandatory: false
            }
        ];
    }

    /**
     * Receptionist plan: who is calling and why, answer from the document, take a message if needed.
     */
    static generateReceptionistPlan(knowledge = {}) {
        const company = knowledge.company_name || 'our team';
        return [
            {
                id: "q_recep_reason",
                stage: "REASON_FOR_CALL",
                text: `How may I help you with ${company} today?`,
                field_to_collect: "reason_for_call",
                mandatory: true
            },
            {
                id: "q_recep_name",
                stage: "CALLER_DETAILS",
                text: "May I have your name, please?",
                field_to_collect: "caller_name",
                mandatory: false
            },
            {
                id: "q_recep_callback",
                stage: "MESSAGE",
                text: knowledge.message_policy
                    ? "I'll pass that to our team. What is the best number and time for a callback?"
                    : "What is the best number and time for our team to call you back?",
                field_to_collect: "callback_number",
                mandatory: false
            },
            {
                id: "q_recep_wrapup",
                stage: "CLOSING",
                text: knowledge.closing_note || "Is there anything else I can help you with?",
                field_to_collect: "additional_needs",
                mandatory: false
            }
        ];
    }

    /**
     * Picks the right plan for a work type (used when a campaign document is read).
     */
    static async generatePlanFor(service, extracted = {}) {
        const s = String(service || 'recruitment').toLowerCase();
        if (s === 'sales') return this.generateSalesPlan(extracted);
        if (s === 'support') return this.generateSupportPlan(extracted);
        if (s === 'appointment') return this.generateAppointmentPlan(extracted);
        if (s === 'receptionist') return this.generateReceptionistPlan(extracted);
        return this.generateRecruitmentPlan(extracted);
    }
}

export default QuestionPlanner;
