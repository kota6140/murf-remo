import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import LLMService from './llm_service.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

/**
 * services/document_service.js
 * 
 * Unified Document Knowledge & Instruction Extraction Service.
 * Supports:
 * - PDF documents (.pdf)
 * - Microsoft Word documents (.docx)
 * - Legacy Microsoft Word documents (.doc)
 * 
 * Extracts text, validates file readability & content size, and generates
 * structured campaign instructions and question plans for:
 * - Recruitment Screening (JDs, requirements, interview questions)
 * - Outbound Sales (Product/service specifications, pricing, scripts, objection handling)
 * - Customer Support (FAQs, diagnostic troubleshooting, escalation rules, resolution policies)
 */
export class DocumentService {
    /**
     * Determines the document extension / type.
     */
    static getDocumentType(filename = '') {
        const ext = path.extname(filename || '').toLowerCase();
        if (ext === '.pdf') return 'PDF';
        if (ext === '.docx') return 'DOCX';
        if (ext === '.doc') return 'DOC';
        return 'UNKNOWN';
    }

    static detectFileType(filename = '') {
        return this.getDocumentType(filename);
    }

    static cleanExtractedText(rawText) {
        if (!rawText) return '';
        return String(rawText)
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /**
     * Extracts clean raw text from PDF, DOCX, or DOC buffer or file.
     * @param {Buffer|string} input - Document buffer or file path
     * @param {string} [filename='document.pdf'] - Filename for type detection
     * @returns {Promise<{ text: string, fileType: string, charCount: number, wordCount: number }>}
     */
    static async extractText(input, filename = 'document.pdf') {
        let buffer = input;
        if (typeof input === 'string') {
            if (fs.existsSync(input)) {
                buffer = fs.readFileSync(input);
                if (!filename || filename === 'document.pdf') {
                    filename = path.basename(input);
                }
            } else {
                const cleaned = this.cleanExtractedText(input);
                const charCount = cleaned.length;
                const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
                return {
                    text: cleaned,
                    fileType: this.detectFileType(filename),
                    charCount,
                    wordCount
                };
            }
        }

        if (!Buffer.isBuffer(buffer)) {
            throw new Error('Invalid document input: expected Buffer or valid file path.');
        }

        if (buffer.length === 0) {
            throw new Error('The uploaded document is completely empty (0 bytes). Please upload a valid document.');
        }

        // 25 MB max document size guard
        if (buffer.length > 25 * 1024 * 1024) {
            throw new Error(`The uploaded document exceeds the 25MB limit (${(buffer.length / (1024 * 1024)).toFixed(1)}MB).`);
        }

        const ext = path.extname(filename || '').toLowerCase();
        let rawText = '';
        let fileType = 'PDF';

        if (ext === '.docx') {
            fileType = 'DOCX';
            try {
                const mammoth = (await import('mammoth')).default;
                const result = await mammoth.extractRawText({ buffer });
                rawText = (result.value || '').trim();
            } catch (docxErr) {
                console.error('[DocumentService] DOCX extraction error:', docxErr);
                throw new Error(`Failed to extract text from Word document (.docx): ${docxErr.message}`);
            }
        } else if (ext === '.doc') {
            fileType = 'DOC';
            try {
                const WordExtractor = (await import('word-extractor')).default;
                const extractor = new WordExtractor();
                const doc = await extractor.extract(buffer);
                rawText = (doc.getBody() || '').trim();
            } catch (docErr) {
                console.error('[DocumentService] Legacy DOC extraction error:', docErr);
                throw new Error(`Failed to extract text from legacy Word document (.doc): ${docErr.message}. Tip: Save as .docx or .pdf for optimal results.`);
            }
        } else if (ext === '.pdf' || (!ext && buffer.slice(0, 4).toString() === '%PDF')) {
            fileType = 'PDF';
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
            } catch (pdfErr) {
                console.error('[DocumentService] PDF extraction error:', pdfErr);
                throw new Error(`Failed to parse PDF document: ${pdfErr.message}`);
            }
        } else {
            // Attempt smart detection from header bytes
            if (buffer.slice(0, 4).toString() === '%PDF') {
                fileType = 'PDF';
                const parsed = await pdfParse(buffer);
                rawText = (parsed.text || '').trim();
            } else if (buffer.slice(0, 2).toString('hex') === '504b') { // PK zip header for docx
                fileType = 'DOCX';
                const mammoth = (await import('mammoth')).default;
                const result = await mammoth.extractRawText({ buffer });
                rawText = (result.value || '').trim();
            } else {
                throw new Error(`Unsupported document format "${ext || 'unknown'}". Supported formats are PDF (.pdf) and Microsoft Word (.docx, .doc).`);
            }
        }

        if (!rawText || rawText.replace(/\s+/g, '').length < 25) {
            throw new Error(`The uploaded ${fileType} document appears to be empty, encrypted, image-only, or contains no readable text. Please upload a readable text document or OCR-processed PDF.`);
        }

        // Clean redundant whitespace and normalize line breaks
        const cleanedText = rawText
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        const words = cleanedText.split(/\s+/).filter(Boolean);

        return {
            text: cleanedText,
            fileType,
            charCount: cleanedText.length,
            wordCount: words.length
        };
    }

    /**
     * Parses a Recruitment Job Description document (PDF, DOCX, or DOC).
     */
    static async parseRecruitmentJD(input, filename = 'job_description.pdf') {
        const { text, fileType } = await this.extractText(input, filename);

        const prompt = `You are a Senior Technical Recruiter and Job Description Extraction Specialist.
Analyze the following Job Description text and extract structured recruitment criteria into strict JSON.

Rules:
1. Extract the primary job title and company name accurately.
2. Categorize technical and domain skills into required (mandatory) vs preferred (nice to have).
3. Identify minimum years of experience required.
4. Extract location, work arrangement (Remote, Hybrid, Onsite), notice period expectations, education, and salary if mentioned.
5. Provide a crisp 2-sentence executive summary of the role.
6. If the document provides specific screening questions or an opening script, include them.

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

Document Text:
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
        extracted.document_type = fileType;
        extracted.document_filename = filename;
        extracted._raw_text_snippet = text.slice(0, 1500);
        extracted._extracted_by = llmRes.provider || 'heuristic';
        return extracted;
    }

    /**
     * Parses an Outbound Sales document (PDF, DOCX, or DOC).
     * Extracts product/service descriptions, pricing, features, scripts, and objection counters.
     */
    static async parseSalesKnowledge(input, filename = 'sales_guide.pdf') {
        const { text, fileType } = await this.extractText(input, filename);

        const prompt = `You are an Enterprise Sales Enablement Director.
Extract sales positioning, approved product/service claims, pricing, target audience, approved FAQs, and objection handling from the document below into strict JSON.

Rules:
1. Extract the EXACT product or service name described in the document (do NOT default to Scorelabs unless the document is specifically about Scorelabs).
2. Extract the company/organization name providing this product or service.
3. Extract value propositions and key features directly from the document text.
4. Extract pricing models, subscription tiers, or cost structure if mentioned (or "Custom quote" if not specified).
5. Extract objection handling: what objections might prospects raise according to this document and what are the factual counters?
6. Extract approved FAQs: question & answer pairs grounded in the document.
7. Craft a recommended natural opening greeting for a phone conversation introducing this specific offering.

Return ONLY a valid JSON object matching this schema:
{
  "product_name": "CloudFleet Enterprise Fleet Management",
  "company_name": "FleetScale Technologies",
  "target_audience": "Logistics managers, operations directors, and transport fleets",
  "opening_greeting": "Hi, this is Remo calling on behalf of FleetScale Technologies. We help logistics companies cut fuel costs and track vehicle maintenance in real time. Do you have a brief moment to talk about your fleet operations?",
  "value_propositions": [
    "Real-time GPS tracking and fuel consumption monitoring",
    "Predictive engine maintenance alerts reducing downtime by 35%"
  ],
  "key_features": [
    "Plug-and-play OBD-II telematics devices",
    "Automated driver route optimization and compliance logs"
  ],
  "pricing_summary": "Starts at $29 per vehicle per month with annual contract",
  "approved_faqs": [
    { "question": "Does it support refrigerated trailers?", "answer": "Yes, we have specialized temperature and humidity wireless sensors." }
  ],
  "objections_and_counters": [
    { "objection": "We already use GPS tracking", "counter": "Most fleets use basic GPS; our platform integrates predictive maintenance and fuel telemetry that typically saves an additional 15%." }
  ],
  "call_to_action": "Schedule a 15-minute live platform demonstration"
}

Document Text:
"""
${text.slice(0, 10000)}
"""`;

        const llmRes = await LLMService.generate({
            systemPrompt: 'You extract sales product and enablement material into factual JSON. Extract only what is in the document.',
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 1400,
            jsonMode: true,
            timeoutMs: 12000
        });

        const extracted = llmRes.parsedJson || this._fallbackSalesHeuristic(text, filename);
        extracted.desired_outcome = extracted.desired_outcome || extracted.call_to_action || "Schedule a 15-minute live platform demonstration";
        extracted.call_to_action = extracted.call_to_action || extracted.desired_outcome;
        extracted.document_type = fileType;
        extracted.document_filename = filename;
        extracted._raw_text_snippet = text.slice(0, 1500);
        extracted._extracted_by = llmRes.provider || 'heuristic';
        return extracted;
    }

    /**
     * Parses a Customer Support document (PDF, DOCX, or DOC).
     * Extracts troubleshooting procedures, FAQs, policies, and escalation guidelines.
     */
    static async parseSupportKnowledge(input, filename = 'support_guide.pdf') {
        const { text, fileType } = await this.extractText(input, filename);

        const prompt = `You are a Customer Support Operations Director.
Extract support documentation, diagnostic troubleshooting steps, approved FAQs, and escalation policies from the document below into strict JSON.

Rules:
1. Extract the product/service and company name being supported.
2. Extract supported topics/categories.
3. Extract diagnostic troubleshooting steps (issue, diagnostics, resolution steps).
4. Extract refund, return, or cancellation policies if mentioned.
5. Extract exact escalation policies (when to escalate to a human specialist, supervisor, or ticket).
6. Create an opening greeting tailored to this support context.

Return ONLY a valid JSON object matching this schema:
{
  "product_name": "Apex Internet Fiber Broadband",
  "company_name": "Apex Telecom",
  "opening_greeting": "Hello, this is Remo from Apex Telecom customer support. I am following up on your recent service ticket regarding your fiber broadband connection. Is now a convenient time to speak?",
  "supported_topics": ["Driver Login", "GPS Tracking", "Route Syncing", "Battery Optimization"],
  "troubleshooting_steps": [
    "Step 1: Check network signal bar in the top right",
    "Step 2: Force close the app from Settings > Apps > ApexLogistics",
    "Step 3: Toggle Airplane Mode on for 5 seconds, then off",
    "Step 4: Re-open app and tap Sync Now"
  ],
  "approved_faqs": [
    { "question": "Why is my GPS location not updating?", "answer": "Check that location permissions are set to Always Allow." }
  ],
  "refund_and_cancellation_policy": "Policy details if mentioned",
  "escalation_policy": "If location still fails after Step 4, escalate immediately to Tier 2 Fleet Operations.",
  "closing_note": "Is there anything else I can assist you with today regarding your service?"
}

Document Text:
"""
${text.slice(0, 10000)}
"""`;

        const llmRes = await LLMService.generate({
            systemPrompt: 'You extract support documentation into actionable diagnostic JSON. Rely strictly on facts in the document.',
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 1400,
            jsonMode: true,
            timeoutMs: 12000
        });

        const extracted = llmRes.parsedJson || this._fallbackSupportHeuristic(text, filename);
        if (!Array.isArray(extracted.troubleshooting_steps) || extracted.troubleshooting_steps.length === 0) {
            extracted.troubleshooting_steps = this._fallbackSupportHeuristic(text, filename).troubleshooting_steps;
        } else {
            // Normalize any object steps into strings
            extracted.troubleshooting_steps = extracted.troubleshooting_steps.map(s => {
                if (typeof s === 'string') return s;
                if (s && typeof s === 'object') return s.resolution || s.diagnostics || s.step || JSON.stringify(s);
                return String(s);
            });
        }
        extracted.document_type = fileType;
        extracted.document_filename = filename;
        extracted._raw_text_snippet = text.slice(0, 1500);
        extracted._extracted_by = llmRes.provider || 'heuristic';
        return extracted;
    }

    /**
     * General unified router for any service type.
     */
    static async parseCampaignDocument(input, filename, service = 'recruitment') {
        const s = String(service || 'recruitment').toLowerCase();
        if (s === 'sales') {
            return this.parseSalesKnowledge(input, filename);
        } else if (s === 'support') {
            return this.parseSupportKnowledge(input, filename);
        } else {
            return this.parseRecruitmentJD(input, filename);
        }
    }

    /**
     * Fallback heuristic for Recruitment JD
     */
    static _fallbackJDHeuristic(text, filename) {
        const titleMatch = text.match(/(?:Job Title|Role|Position|Title)\s*[:\-]\s*([^\n\r]+)/i);
        const expMatch = text.match(/(\d+)\+?\s*(?:years|yrs)\b/i);
        const cleanName = filename.replace(/\.(pdf|docx|doc)$/i, '').replace(/[_-]/g, ' ');
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

    /**
     * Fallback heuristic for Sales Knowledge
     */
    static _fallbackSalesHeuristic(text, filename) {
        const cleanName = filename.replace(/\.(pdf|docx|doc)$/i, '').replace(/[_-]/g, ' ');
        const prodMatch = text.match(/(?:Product|Service|Offering)\s*[:\-]\s*([^\n\r]+)/i);
        const compMatch = text.match(/(?:Company|Organization|Provider)\s*[:\-]\s*([^\n\r]+)/i);
        const outcomeMatch = text.match(/(?:Outcome|CTA|Call to Action|Goal)\s*[:\-]\s*([^\n\r]+)/i);
        const pricingMatch = text.match(/(?:Pricing|Price|Cost|Plans?)\s*[:\-]\s*([^\n\r]+)/i);

        const prodName = prodMatch ? prodMatch[1].trim() : (cleanName || "Scorelabs IT & Software Solutions");
        const compName = compMatch ? compMatch[1].trim() : "Scorelabs Inc.";
        const cta = outcomeMatch ? outcomeMatch[1].trim() : "Schedule a brief exploratory discovery session with our technical team";

        return {
            product_name: prodName,
            company_name: compName,
            target_audience: "Businesses seeking specialized solutions",
            opening_greeting: `Hello, this is Remo calling on behalf of ${compName} regarding ${prodName}. Is now a convenient time for a brief conversation?`,
            value_propositions: ["Custom solutions tailored to operational requirements"],
            key_features: ["Cloud-enabled platform capabilities"],
            pricing_summary: pricingMatch ? pricingMatch[1].trim() : "Custom quote based on scope and timeline",
            approved_faqs: [],
            objections_and_counters: [],
            call_to_action: cta,
            desired_outcome: cta
        };
    }

    /**
     * Fallback heuristic for Support Knowledge
     */
    static _fallbackSupportHeuristic(text, filename) {
        const cleanName = filename.replace(/\.(pdf|docx|doc)$/i, '').replace(/[_-]/g, ' ');
        const prodMatch = text.match(/(?:Product|Service|App|System)\s*[:\-]\s*([^\n\r]+)/i);
        const compMatch = text.match(/(?:Company|Organization|Provider)\s*[:\-]\s*([^\n\r]+)/i);
        const escMatch = text.match(/(?:Escalation(?:\s*Policy)?)\s*[:\-]\s*([^\n\r]+)/i);

        const steps = [];
        const stepRegex = /(?:Step\s*\d+|^\d+\.)\s*[:\-]?\s*([^\n\r]+)/gim;
        let match;
        while ((match = stepRegex.exec(text)) !== null) {
            steps.push(match[0].trim());
        }

        const prodName = prodMatch ? prodMatch[1].trim() : (cleanName || "Customer Support");
        const compName = compMatch ? compMatch[1].trim() : "Scorelabs Inc.";

        return {
            product_name: prodName,
            company_name: compName,
            opening_greeting: `Hello, this is Remo from ${compName} Support regarding ${prodName}. How can I assist you today?`,
            supported_topics: ["General Inquiries", "Service Diagnostics", "Account Access"],
            troubleshooting_steps: steps.length ? steps : ["Step 1: Verify power & network connectivity", "Step 2: Restart application", "Step 3: Clear cache"],
            approved_faqs: [
                { question: "General Inquiries", answer: "Please refer to documentation or speak with our support technician." }
            ],
            escalation_policy: escMatch ? escMatch[1].trim() : "Escalate to human support specialist if unresolved after diagnostic check.",
            closing_note: "Is there anything else I can help you with today?"
        };
    }
}

export default DocumentService;
