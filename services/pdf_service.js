import fs from 'fs';
import { createRequire } from 'module';
import LLMService from './llm_service.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

/**
 * services/pdf_service.js
 * 
 * Robust PDF Knowledge & Job Description Extraction Service.
 * - Extracts clean text from PDF buffers/files using pdf-parse.
 * - Validates readability and flags empty/scanned PDFs.
 * - Uses LLMService to extract structured, actionable criteria for screening,
 *   sales qualification, or customer support knowledge bases.
 */

export class PDFService {
    /**
     * Extracts raw text from a PDF buffer or local file path.
     * @param {Buffer|string} input - PDF buffer or file path
     * @returns {Promise<string>} Cleaned text content
     */
    static async extractText(input) {
        let buffer = input;
        if (typeof input === 'string') {
            if (!fs.existsSync(input)) {
                throw new Error(`PDF file not found at: ${input}`);
            }
            buffer = fs.readFileSync(input);
        }

        if (!Buffer.isBuffer(buffer)) {
            throw new Error('Invalid PDF input: expected Buffer or valid file path.');
        }

        let rawText = '';
        try {
            if (typeof pdfParse === 'function') {
                const parsed = await pdfParse(buffer);
                rawText = (parsed.text || '').trim();
            } else if (pdfParse && typeof pdfParse.default === 'function') {
                const parsed = await pdfParse.default(buffer);
                rawText = (parsed.text || '').trim();
            } else if (pdfParse && (pdfParse.PDFParse || typeof pdfParse === 'object')) {
                const ParserClass = pdfParse.PDFParse || pdfParse;
                const parser = new ParserClass({ data: buffer });
                const parsed = await parser.getText();
                rawText = (parsed.text || '').trim();
            } else {
                throw new Error('Unsupported pdf-parse export structure.');
            }
        } catch (parseErr) {
            console.error('[PDFService] pdf-parse failure:', parseErr);
            throw new Error(`Failed to parse PDF document: ${parseErr.message}`);
        }

        if (!rawText || rawText.length < 35) {
            throw new Error('PDF appears to be empty, encrypted, or scanned without an embedded text layer. Please upload a readable text PDF or OCR-processed document.');
        }

        // Clean redundant whitespace and normalize line breaks
        const cleanedText = rawText
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        return cleanedText;
    }

    /**
     * Extracts structured requirements from a Job Description PDF.
     * @param {Buffer|string} input - PDF buffer or path
     * @param {string} [filename='job_description.pdf']
     * @returns {Promise<object>} Structured JD criteria
     */
    static async parseRecruitmentJD(input, filename = 'job_description.pdf') {
        const text = await this.extractText(input);

        const prompt = `You are a Senior Technical Recruiter and Job Description Extraction Specialist.
Analyze the following Job Description text and extract structured recruitment criteria into strict JSON.

Rules:
1. Extract the primary job title accurately.
2. Categorize technical and domain skills into required (mandatory) vs preferred (nice to have).
3. Identify minimum years of experience required.
4. Extract location, work arrangement (Remote, Hybrid, Onsite), notice period expectations, education, and salary if mentioned.
5. Provide a crisp 2-sentence executive summary of the role.

Return ONLY a valid JSON object matching this schema:
{
  "job_title": "Senior SAP FICO Consultant",
  "company_name": "Scorelabs Inc.",
  "required_skills": ["SAP FICO", "S/4HANA", "General Ledger", "Asset Accounting"],
  "preferred_skills": ["ABAP debugging", "BAPI", "Treasury"],
  "min_experience_years": 5,
  "experience_description": "5+ years hands-on SAP FICO implementation experience",
  "education_requirements": "Bachelor's degree in Finance, CS, or related field",
  "certifications": ["SAP Certified Application Associate"],
  "work_arrangement": "Hybrid - Bangalore",
  "max_notice_period_days": 30,
  "salary_budget": "Competitive",
  "key_responsibilities": [
    "Lead end-to-end FICO configuration and data migration",
    "Engage with business stakeholders to map finance workflows"
  ],
  "role_summary": "Looking for a seasoned SAP FICO consultant with S/4HANA experience to lead finance implementation workflows."
}

Job Description Text:
"""
${text.slice(0, 10000)}
"""`;

        const llmRes = await LLMService.generate({
            systemPrompt: 'You extract job descriptions into precise, factual JSON. Do not invent criteria not present in the text.',
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 1200,
            jsonMode: true,
            timeoutMs: 12000
        });

        const extracted = llmRes.parsedJson || this._fallbackJDHeuristic(text, filename);
        extracted._raw_text_snippet = text.slice(0, 1000);
        extracted._extracted_by = llmRes.provider || 'heuristic';
        return extracted;
    }

    /**
     * Extracts sales product and objection handling knowledge from a Sales PDF.
     */
    static async parseSalesKnowledge(input, filename = 'sales_guide.pdf') {
        const text = await this.extractText(input);

        const prompt = `You are an Enterprise Sales Enablement Director.
Extract sales positioning, approved product claims, FAQs, and objection handling from the document below into strict JSON.

Return ONLY a valid JSON object matching this schema:
{
  "product_name": "Scorelabs AI Voice Automation",
  "company_name": "Scorelabs Inc.",
  "target_audience": "Mid-market and enterprise operations, HR, and sales leaders",
  "value_propositions": [
    "Sub-second voice response latency",
    "90% reduction in manual screening and qualification time"
  ],
  "key_features": [
    "Multilingual voicebot in English, Hindi, and Telugu",
    "Real-time CRM and Excel synchronization"
  ],
  "pricing_summary": "Flexible monthly tier based on concurrent lines",
  "approved_faqs": [
    { "question": "Can it integrate with our existing CRM?", "answer": "Yes, standard REST APIs and webhook feeds connect directly into your stack." }
  ],
  "objections_and_counters": [
    { "objection": "AI sounds too robotic", "counter": "We use ultra-realistic voice models with human turn-taking and natural acknowledgments." }
  ],
  "call_to_action": "Schedule a 15-minute live interactive voice demonstration"
}

Document Text:
"""
${text.slice(0, 10000)}
"""`;

        const llmRes = await LLMService.generate({
            systemPrompt: 'You extract sales product and enablement material into factual JSON.',
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 1200,
            jsonMode: true,
            timeoutMs: 12000
        });

        return llmRes.parsedJson || {
            product_name: "Scorelabs IT & Software Solutions",
            company_name: "Scorelabs Inc.",
            target_audience: "Businesses seeking software development and AI engineering",
            value_propositions: ["Custom software architecture", "Enterprise AI voice solutions"],
            key_features: ["Full-stack cloud applications", "Real-time AI voice agents"],
            pricing_summary: "Custom quote based on scope and timeline",
            approved_faqs: [],
            objections_and_counters: [],
            call_to_action: "Schedule a brief exploratory discovery session with our technical team"
        };
    }

    /**
     * Extracts diagnostic support and troubleshooting knowledge from a Support PDF.
     */
    static async parseSupportKnowledge(input, filename = 'support_guide.pdf') {
        const text = await this.extractText(input);

        const prompt = `You are a Customer Support Operations Director.
Extract support documentation, diagnostic troubleshooting steps, and escalation rules from the document below into strict JSON.

Return ONLY a valid JSON object matching this schema:
{
  "product_name": "TakeRemo Voice & Support Platform",
  "company_name": "Scorelabs Inc.",
  "supported_topics": ["Account Access", "Call Disconnects", "Audio Quality", "Billing"],
  "troubleshooting_steps": [
    { "topic": "Audio Lag", "diagnostics": "Check network connection or carrier packet loss", "resolution": "Switch from 3G to VoLTE / Wi-Fi" }
  ],
  "approved_faqs": [
    { "question": "How do I reset my password?", "answer": "Use the Forgot Password link on the login page; a 6-digit verification code will be emailed." }
  ],
  "escalation_policy": "If issue is unresolvable after 2 diagnostic steps, log high-priority ticket and offer a callback within 2 hours.",
  "closing_note": "Is there anything else I can assist you with today?"
}

Document Text:
"""
${text.slice(0, 10000)}
"""`;

        const llmRes = await LLMService.generate({
            systemPrompt: 'You extract support documentation into actionable diagnostic JSON.',
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 1200,
            jsonMode: true,
            timeoutMs: 12000
        });

        return llmRes.parsedJson || {
            product_name: "Scorelabs Support",
            company_name: "Scorelabs Inc.",
            supported_topics: ["General Inquiries", "Service Outages", "Billing"],
            troubleshooting_steps: [],
            approved_faqs: [],
            escalation_policy: "Escalate to human support specialist with ticket reference.",
            closing_note: "Is there anything else I can help you with today?"
        };
    }

    /**
     * Deterministic rule-based fallback if LLMs are offline
     */
    static _fallbackJDHeuristic(text, filename) {
        const titleMatch = text.match(/(?:Job Title|Role|Position|Title)\s*[:\-]\s*([^\n\r]+)/i);
        const expMatch = text.match(/(\d+)\+?\s*(?:years|yrs)\b/i);
        
        const cleanName = filename.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ');
        const jobTitle = titleMatch ? titleMatch[1].trim() : (cleanName || 'Software Engineer');

        return {
            job_title: jobTitle,
            company_name: "Scorelabs Inc.",
            required_skills: ["Core technical competency in required stack"],
            preferred_skills: ["Relevant industry experience"],
            min_experience_years: expMatch ? parseInt(expMatch[1], 10) : 3,
            experience_description: `${expMatch ? expMatch[1] : '3+'} years relevant industry experience`,
            education_requirements: "Bachelor's degree or equivalent practical experience",
            certifications: [],
            work_arrangement: "Full-Time",
            max_notice_period_days: 60,
            salary_budget: "Market rate",
            key_responsibilities: ["Execute job duties according to company standards"],
            role_summary: `Screening for ${jobTitle}.`
        };
    }
}

export default PDFService;
