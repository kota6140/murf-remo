import path from 'path';
import ExcelService from './excel_service.js';
import { CallQueueWorker } from './call_queue_worker.js';
import db, { utcNow } from './db.js';

/**
 * services/service_campaign_factory.js
 *
 * Builds the contact-sheet upload + start-calling service for a work type
 * (used by appointment setting and receptionist; same behaviour as sales_service.js).
 */
export class ServiceCampaignError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

export function makeServiceCampaign({ service, startMessage }) {
    return class ServiceCampaign {
        static ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

        static async validateAndProcessUpload(fileObj, filename) {
            if (!filename || typeof filename !== 'string') {
                throw new ServiceCampaignError('Missing or invalid file name.', 400);
            }
            const ext = path.extname(filename).toLowerCase();
            if (!this.ALLOWED_EXTENSIONS.includes(ext)) {
                throw new ServiceCampaignError(
                    `Invalid file format '${ext}'. Please upload an Excel document (.xlsx, .xls) or CSV spreadsheet.`,
                    400
                );
            }
            if (!fileObj) throw new ServiceCampaignError('Please choose a contact spreadsheet to upload.', 400);

            try {
                const result = await ExcelService.parseAndValidateUpload(fileObj, filename, service);
                return {
                    fileId: result.fileId,
                    fileName: filename,
                    records: result.validRows > 0 ? result.validRows : result.totalRows,
                    total: result.totalRows,
                    totalRows: result.totalRows,
                    validRows: result.validRows,
                    invalidRows: result.invalidRows,
                    status: 'READY',
                    service,
                    uploadedAt: utcNow(),
                    columnsDetected: result.columnsDetected || [],
                    errorSummary: result.errorSummary || [],
                    previewContacts: result.previewContacts || []
                };
            } catch (err) {
                throw new ServiceCampaignError(`Validation error: ${String(err.message || err)}`, 400);
            }
        }

        static async startCallingCampaign(fileId) {
            const cleanId = typeof fileId === 'string' ? fileId.trim() : '';
            let batch = null;
            if (cleanId) {
                // An explicit sheet must exist; never quietly call a different one.
                batch = await db.get('SELECT * FROM batches WHERE id = ?', [cleanId]);
                if (!batch) throw new ServiceCampaignError('That contact sheet was not found. Upload it again.', 404);
            } else {
                batch = await db.get("SELECT * FROM batches WHERE service = ? AND status IN ('READY', 'IN_PROGRESS') ORDER BY created_at DESC LIMIT 1", [service]);
            }
            if (!batch) throw new ServiceCampaignError('Upload a contact sheet first.', 400);

            const total = batch.valid_rows || batch.total_rows || 1;
            await CallQueueWorker.enqueueBatch(batch.id);

            return {
                status: 'CALLING_STARTED',
                fileId: batch.id,
                total,
                service,
                dispatchedAt: utcNow(),
                message: startMessage
            };
        }
    };
}
