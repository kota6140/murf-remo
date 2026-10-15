import DocumentService from './document_service.js';

/**
 * services/pdf_service.js
 * 
 * Backward-compatible wrapper around unified DocumentService.
 * Seamlessly supports PDF (.pdf), Microsoft Word (.docx), and legacy Word (.doc).
 */
export class PDFService extends DocumentService {
    // Inherits extractText, parseRecruitmentJD, parseSalesKnowledge, parseSupportKnowledge, parseCampaignDocument
}

export default PDFService;

