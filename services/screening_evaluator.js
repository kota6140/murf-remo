import LLMService from './llm_service.js';

/**
 * services/screening_evaluator.js
 * 
 * Generates transparent, explainable screening outcomes for Recruitment candidates
 * strictly evaluated against the campaign's extracted Job Description.
 * 
 * Outcome Governance:
 * - Selected: Meets or exceeds mandatory technical skills & required experience.
 * - On Hold: Ambiguous, requested callback, incomplete details, or borderline match.
 * - Rejected: Explicitly lacks mandatory non-negotiable requirement.
 * 
 * Never rejects for accents, short affirmations ("yes", "hmm"), or thinking pauses.
 */

export class ScreeningEvaluator {
    /**
     * Evaluates a completed interview transcript against the campaign JD.
     * @param {object} params
     * @param {object} params.candidate - Candidate record from contacts table
     * @param {object} params.jdCriteria - Extracted JD requirements from campaign
     * @param {Array<{speaker: string, text: string}>} params.transcript - Full call dialogue
     * @param {object} params.factsCollected - Structured facts from ConversationMemory
     * @returns {Promise<object>} Explainable screening decision
     */
    static async evaluateCandidate(paramsOrCandidate = {}, jdArg = {}, transcriptArg = [], factsArg = {}) {
        let candidate = {};
        let jdCriteria = {};
        let transcript = [];
        let factsCollected = {};

        if (paramsOrCandidate && (paramsOrCandidate.candidate !== undefined || paramsOrCandidate.jdCriteria !== undefined || paramsOrCandidate.jd !== undefined || paramsOrCandidate.transcript !== undefined || paramsOrCandidate.conversationHistory !== undefined)) {
            candidate = { ...(paramsOrCandidate.candidate || {}) };
            jdCriteria = paramsOrCandidate.jdCriteria || paramsOrCandidate.jd || {};
            transcript = paramsOrCandidate.transcript || paramsOrCandidate.conversationHistory || [];
            factsCollected = paramsOrCandidate.factsCollected || paramsOrCandidate.collectedData || {};
        } else {
            candidate = { ...(paramsOrCandidate || {}) };
            jdCriteria = jdArg || {};
            transcript = transcriptArg || [];
            factsCollected = factsArg || {};
        }

        // Ensure candidate status reflects completed call for evaluation
        candidate.call_status = 'COMPLETED';
        candidate.status = 'COMPLETED';

        const title = jdCriteria.job_title || candidate.job_role || candidate.role || 'Software Developer';
        const requiredSkills = jdCriteria.required_skills || [];
        const minExp = jdCriteria.min_experience_years || jdCriteria.min_experience || 2;
        const maxNotice = jdCriteria.max_notice_period_days || 60;

        const transcriptStr = transcript.map(t => `${t.speaker || 'Speaker'}: ${t.text || ''}`).join('\n');
        const candDetailsStr = JSON.stringify(candidate, null, 2);

        const prompt = `You are a Senior Technical Recruiter conducting an objective hiring evaluation.
Evaluate the candidate's interview performance against the official Job Description criteria.

Job Description Criteria:
- Target Role: ${title}
- Mandatory Required Skills: ${Array.isArray(requiredSkills) ? requiredSkills.join(', ') : (requiredSkills || 'Core technical stack')}
- Minimum Experience: ${minExp} years
- Maximum Acceptable Notice Period: ${maxNotice} days

Candidate Details & Facts Stated During Call:
- Stated Experience: ${factsCollected.experience || factsCollected.experience_years || candidate.years_experience || candidate.experience || 'As detailed in transcript'}
- Stated Technical Skills: ${factsCollected.technical_skills || factsCollected.skills || candidate.skills_experience || candidate.skills || 'As detailed in transcript'}
${(factsCollected.research_paper || candidate.projects) ? `- Projects/Research: ${factsCollected.research_paper || candidate.projects}` : ''}
- Stated Notice Period: ${factsCollected.notice_period || candidate.notice_period || (factsCollected.notice_period_days !== undefined ? factsCollected.notice_period_days + ' days' : 'As detailed in transcript')}

Interview Transcript:
"""
${transcriptStr || 'Dialogue recorded in candidate answers.'}
"""

Evaluation Guidelines:
1. "Selected": Candidate demonstrates competency in mandatory required skills with concrete project or implementation details in the transcript/details, meets minimum experience (${minExp}+ years), and has an acceptable notice period (<= ${maxNotice} days).
2. "On Hold": Candidate requested a callback, was interrupted, gave ambiguous, vague, or one-word answers (e.g., only "Yes", "Yeah", "Not sure" without any project or technical specifics), or key qualifications cannot be determined from the transcript. For On Hold, the decision_reason must explicitly note that details are incomplete and require human review.
3. "Rejected": Candidate explicitly confirmed they DO NOT have the required skill / never worked with it, refused essential requirements, or has excessive notice period with zero flexibility.
4. Never reject a candidate merely because of brief answers or pauses. When candidate provides only brief/ambiguous answers without technical depth, use "On Hold" (noting incomplete information for review). When candidate provides concrete project experience matching JD criteria, use "Selected".

Return ONLY a valid JSON object matching this schema:
{
  "status": "Selected",
  "jd_match_score": 88,
  "skills_match": "Strong hands-on experience in ${requiredSkills.slice(0, 3).join(', ') || 'required skills'}",
  "experience_match": "Meets requirement (${minExp}+ years)",
  "notice_period": "30 days",
  "availability": "Available within standard notice period",
  "summary": "Candidate clearly articulated recent project experience and demonstrated solid grasp of the core requirements.",
  "decision_reason": "Candidate meets the ${minExp}-year experience bar and answered screening questions with specific implementation details.",
  "next_action": "Schedule Technical Round 1 with Engineering Team"
}`;

        let finalResult = null;
        try {
            const res = await LLMService.generate({
                systemPrompt: 'You are an objective hiring evaluator. Output only valid JSON with zero conversational filler.',
                messages: [{ role: 'user', content: prompt }],
                maxTokens: 1200,
                jsonMode: true,
                timeoutMs: 10000
            });

            const parsed = res.parsedJson || LLMService.extractJson(res.text);
            if (parsed && (parsed.status || parsed.skills_match || parsed.jd_match_score !== undefined)) {
                finalResult = parsed;
            } else {
                console.log('[ScreeningEvaluator Raw Text]:', res.text);
            }
            console.log('[ScreeningEvaluator Result]:', finalResult);
        } catch (err) {
            console.warn('[ScreeningEvaluator] LLM evaluation error, using rule-based fallback:', err.message);
        }

        if (!finalResult) {
            finalResult = this._ruleBasedFallback(candidate, jdCriteria, transcript, factsCollected);
        }

        return {
            ...finalResult,
            status: finalResult.status || 'On Hold',
            screening_outcome: finalResult.status || 'On Hold'
        };
    }

    static _ruleBasedFallback(candidate = {}, jdCriteria = {}, transcript = [], factsCollected = {}) {
        const text = transcript.map(t => t.text).join(' ').toLowerCase();
        const candStr = JSON.stringify(candidate).toLowerCase();
        const combined = `${text} ${candStr}`;

        // Check for explicit decline or lack of mandatory skills
        if (/never worked|basic excel|no experience|wrong number|not interested|decline|don't call/i.test(combined)) {
            return {
                status: "Rejected",
                screening_outcome: "Rejected",
                jd_match_score: 25,
                skills_match: "Does not meet mandatory technical skill requirements",
                experience_match: "Does not meet experience criteria",
                notice_period: candidate.notice_period || "90 days",
                availability: "Declined / Unfavorable",
                summary: "Candidate explicitly lacks the mandatory technical skills or declined the position.",
                decision_reason: "Candidate does not meet the essential mandatory requirements for the position.",
                next_action: "Send polite rejection email"
            };
        }

        // Check for strong qualifications
        const requiredSkills = jdCriteria.required_skills || [];
        const hasCoreSkills = requiredSkills.some(s => combined.includes(s.toLowerCase()));
        if (hasCoreSkills && /6 years|5 years|4 years|3 years|hands-on|led/i.test(combined) && !/90 days|never/i.test(combined)) {
            return {
                status: "Selected",
                screening_outcome: "Selected",
                jd_match_score: 85,
                skills_match: "Meets mandatory technical skills",
                experience_match: "Meets minimum years requirement",
                notice_period: candidate.notice_period || "30 days",
                availability: "Available within standard window",
                summary: "Candidate has demonstrated relevant technical experience matching the job description.",
                decision_reason: "Strong match on core technical skills and required experience.",
                next_action: "Schedule technical interview"
            };
        }

        // Check for callback request or ambiguous response
        if (/call me back|later|busy right now|in a meeting|driving|not sure/i.test(combined)) {
            return {
                status: "On Hold",
                screening_outcome: "On Hold",
                jd_match_score: 50,
                skills_match: "Pending technical assessment",
                experience_match: "Pending review",
                notice_period: "Pending",
                availability: "Requested callback",
                summary: "Candidate requested a later callback or provided incomplete responses.",
                decision_reason: "Screening requires human recruiter follow-up due to incomplete information.",
                next_action: "Schedule automated or manual follow-up call"
            };
        }

        // Default safe outcome
        return {
            status: "On Hold",
            screening_outcome: "On Hold",
            jd_match_score: 65,
            skills_match: "Preliminary screening recorded",
            experience_match: "Requires human review",
            notice_period: factsCollected.notice_period_days ? `${factsCollected.notice_period_days} days` : "Under review",
            availability: "Pending verification",
            summary: "Call completed; screening dialogue requires human technical verification.",
            decision_reason: "Automated assessment defaulted to On Hold for recruiter verification.",
            next_action: "Recruiter manual review"
        };
    }
}

export default ScreeningEvaluator;
