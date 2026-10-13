import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import * as xlsx from 'xlsx';
import ExcelJS from 'exceljs';
import db, { utcNow } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_DIR = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.join(BASE_DIR, 'data', 'uploads');

export const COLUMN_SYNONYMS = {
    // Name
    name: ['name', 'full name', 'candidate name', 'customer name', 'contact name', 'lead name', 'client name', 'person name'],
    // Phone
    phone: ['phone', 'phone number', 'phonenumber', 'mobile', 'mobile number', 'mobilenumber', 'contact', 'contact number', 'contactno', 'cell', 'cell number', 'telephone'],
    // Email
    email: ['email', 'email address', 'mail', 'email id'],
    // Preferred language
    preferred_language: ['preferred language', 'language', 'preferred lang', 'lang'],
    // Notes
    notes: ['notes', 'remarks', 'comment', 'comments', 'additional notes', 'description'],
    // Recruitment specific
    job_role: ['job role', 'jobrole', 'role', 'position', 'designation', 'job title', 'target role'],
    education: ['education', 'qualification', 'educational qualification', 'degree', 'highest degree'],
    skills: ['skills', 'technical skills', 'key skills', 'skill set', 'technologies'],
    experience: ['experience', 'total experience', 'years of experience', 'yoe', 'work experience'],
    location: ['location', 'city', 'current location', 'residence'],
    // Sales specific
    company: ['company', 'company name', 'organization', 'org name', 'account name', 'firm'],
    product_or_service: ['product or service', 'product', 'service', 'requirement', 'offering', 'interest'],
    lead_source: ['lead source', 'source', 'channel', 'campaign source'],
    // Support specific
    customer_id: ['customer id', 'customerid', 'client id', 'account id', 'cust id', 'ticket id'],
    issue_or_query: ['issue or query', 'issue', 'query', 'problem', 'concern', 'complaint', 'subject']
};

export function normalizeColumnName(header) {
    if (!header || typeof header !== 'string') return null;
    let cleaned = header.trim().toLowerCase().replace(/[^a-z0-9]/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    for (const [standardKey, aliases] of Object.entries(COLUMN_SYNONYMS)) {
        if (aliases.includes(cleaned)) {
            return standardKey;
        }
        for (const alias of aliases) {
            if (cleaned.includes(alias)) {
                return standardKey;
            }
        }
    }
    return null;
}

export function cleanAndValidatePhone(phoneVal) {
    if (phoneVal === null || phoneVal === undefined) {
        return { isValid: false, phone: '', error: 'Phone number is empty' };
    }

    let raw = String(phoneVal).trim();
    if (!raw) {
        return { isValid: false, phone: '', error: 'Phone number is empty' };
    }

    // Handle scientific notation like 9.87654E+09
    if (/e/i.test(raw)) {
        try {
            raw = String(Math.floor(Number(raw)));
        } catch (e) {}
    }

    // Clean formatting characters
    const hasPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/g, '');

    if (!digits) {
        return { isValid: false, phone: raw, error: 'No numeric digits found in phone number' };
    }

    // 10-digit Indian numbers starting with 6,7,8,9
    if (digits.length === 10 && /^[6-9]/.test(digits)) {
        return { isValid: true, phone: `+91${digits}`, error: '' };
    }

    // 11 digits starting with 0
    if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
        return { isValid: true, phone: `+91${digits.slice(1)}`, error: '' };
    }

    // 12 digits starting with 91
    if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
        return { isValid: true, phone: `+${digits}`, error: '' };
    }

    // International numbers (10 to 15 digits)
    if (digits.length >= 10 && digits.length <= 15) {
        return { isValid: true, phone: `+${digits}`, error: '' };
    }

    return { isValid: false, phone: raw, error: `Invalid phone format: must be at least 10 digits (got '${raw}')` };
}

export default class ExcelService {
    static async parseAndValidateUpload(fileObj, filename, service = 'recruitment') {
        const cleanService = (service || 'recruitment').toLowerCase().trim();
        const validServices = ['recruitment', 'sales', 'support'];
        const targetService = validServices.includes(cleanService) ? cleanService : 'recruitment';

        const ext = path.extname(filename || '').toLowerCase();
        if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
            throw new Error(`Unsupported file format '${ext}'. Please upload .xlsx, .xls, or .csv`);
        }

        // Get file buffer
        let fileBuffer = null;
        if (Buffer.isBuffer(fileObj)) {
            fileBuffer = fileObj;
        } else if (fileObj && Buffer.isBuffer(fileObj.buffer)) {
            fileBuffer = fileObj.buffer;
        } else if (fileObj && typeof fileObj.buffer === 'string') {
            fileBuffer = Buffer.from(fileObj.buffer, 'base64');
        } else {
            throw new Error('No valid file buffer content provided for spreadsheet upload.');
        }

        // Save local copy in uploads directory
        if (!fs.existsSync(UPLOADS_DIR)) {
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
        const batchId = `batch_${targetService.slice(0, 3)}_${crypto.randomBytes(6).toString('hex')}`;
        const savedFilename = `${batchId}_${filename}`;
        const savedPath = path.join(UPLOADS_DIR, savedFilename);
        fs.writeFileSync(savedPath, fileBuffer);

        // Parse workbook using SheetJS
        let workbook;
        try {
            workbook = xlsx.read(fileBuffer, { type: 'buffer' });
        } catch (e) {
            throw new Error(`Unable to read spreadsheet: ${e.message}`);
        }

        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
            throw new Error('The uploaded spreadsheet contains no sheets.');
        }

        const worksheet = workbook.Sheets[firstSheetName];
        const rawJsonRows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        if (!rawJsonRows || rawJsonRows.length < 2) {
            throw new Error('The uploaded spreadsheet contains no data rows (minimum 1 header and 1 data row required).');
        }

        // Extract header row
        const headerRow = rawJsonRows[0].map(h => String(h || '').trim());
        const colMapping = {};
        for (const col of headerRow) {
            if (!col) continue;
            const stdKey = normalizeColumnName(col);
            if (stdKey) {
                colMapping[col] = stdKey;
            }
        }

        // Validate that Phone column is present
        const mappedStdKeys = new Set(Object.values(colMapping));
        if (!mappedStdKeys.has('phone')) {
            throw new Error(`Could not find a 'Phone Number' or 'Mobile' column in the uploaded sheet. Found columns: ${headerRow.join(', ')}`);
        }

        let nameCol = null;
        let phoneCol = null;
        for (const [orig, std] of Object.entries(colMapping)) {
            if (std === 'name' && !nameCol) nameCol = orig;
            if (std === 'phone' && !phoneCol) phoneCol = orig;
        }

        // If Name column was not explicitly matched, fallback to first non-phone column
        if (!nameCol) {
            for (const col of headerRow) {
                if (col && col !== phoneCol) {
                    nameCol = col;
                    colMapping[col] = 'name';
                    break;
                }
            }
        }

        const seenPhones = new Map();
        const validRecords = [];
        const invalidRecords = [];
        const now = utcNow();

        // Process data rows
        const dataRows = rawJsonRows.slice(1);
        for (let idx = 0; idx < dataRows.length; idx++) {
            const rowArr = dataRows[idx];
            // Check if entire row is empty
            if (rowArr.every(cell => !cell || String(cell).trim() === '')) {
                continue;
            }

            const excelRowNum = idx + 2; // Row 1 is header
            const rawDict = {};
            for (let cIdx = 0; cIdx < headerRow.length; cIdx++) {
                const headerName = headerRow[cIdx];
                if (headerName) {
                    rawDict[headerName] = rowArr[cIdx] !== undefined ? String(rowArr[cIdx]).trim() : '';
                }
            }

            const nameVal = nameCol && rawDict[nameCol] ? rawDict[nameCol].trim() : '';
            const phoneVal = phoneCol && rawDict[phoneCol] ? rawDict[phoneCol].trim() : '';

            const rowErrors = [];
            if (!nameVal) {
                rowErrors.push('Contact name is missing');
            }

            const phoneCheck = cleanAndValidatePhone(phoneVal);
            if (!phoneCheck.isValid) {
                rowErrors.push(phoneCheck.error);
            } else {
                if (seenPhones.has(phoneCheck.phone)) {
                    const firstRow = seenPhones.get(phoneCheck.phone);
                    rowErrors.push(`Duplicate phone number (already seen on row ${firstRow})`);
                } else {
                    seenPhones.set(phoneCheck.phone, excelRowNum);
                }
            }

            // Extract extra / custom attributes
            const extra = {};
            for (const [orig, val] of Object.entries(rawDict)) {
                const std = colMapping[orig];
                if (std && !['name', 'phone'].includes(std)) {
                    extra[std] = val;
                } else if (!std) {
                    extra[orig] = val;
                }
            }

            const prefLang = extra.preferred_language || 'en';
            const notes = extra.notes || '';
            const contactId = `cnt_${crypto.randomBytes(8).toString('hex')}`;

            const record = {
                id: contactId,
                row_index: excelRowNum,
                name: nameVal || `Contact (Row ${excelRowNum})`,
                phone: phoneCheck.phone || phoneVal,
                preferred_language: prefLang,
                notes: notes,
                raw: rawDict,
                extra: extra,
                errors: rowErrors
            };

            if (rowErrors.length === 0) {
                validRecords.push(record);
            } else {
                invalidRecords.push(record);
            }
        }

        const totalRows = validRecords.length + invalidRecords.length;
        if (totalRows === 0) {
            throw new Error('The uploaded spreadsheet contains no valid contact rows.');
        }

        // Store batch and contacts into Database
        await db.run(`
            INSERT INTO batches (id, service, filename, original_path, status, total_rows, valid_rows, invalid_rows, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'READY', ?, ?, ?, ?, ?)
        `, [batchId, targetService, filename, savedPath, totalRows, validRecords.length, invalidRecords.length, now, now]);

        await db.transaction(async (trx) => {
            for (const r of validRecords) {
                await trx.run(`
                    INSERT INTO contacts (
                        id, batch_id, service, row_index, raw_data, name, phone, preferred_language, notes, extra_data,
                        validation_status, validation_errors, call_status, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALID', '[]', 'PENDING', ?)
                `, [
                    r.id, batchId, targetService, r.row_index, JSON.stringify(r.raw),
                    r.name, r.phone, r.preferred_language, r.notes, JSON.stringify(r.extra),
                    now
                ]);
            }

            for (const r of invalidRecords) {
                await trx.run(`
                    INSERT INTO contacts (
                        id, batch_id, service, row_index, raw_data, name, phone, preferred_language, notes, extra_data,
                        validation_status, validation_errors, call_status, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INVALID', ?, 'SKIPPED', ?)
                `, [
                    r.id, batchId, targetService, r.row_index, JSON.stringify(r.raw),
                    r.name, r.phone, r.preferred_language, r.notes, JSON.stringify(r.extra),
                    JSON.stringify(r.errors), now
                ]);
            }
        });

        // Error summary for frontend modal
        const errorSummary = invalidRecords.slice(0, 50).map(inv => ({
            row: inv.row_index,
            name: inv.name,
            phone: inv.phone,
            errors: inv.errors
        }));

        // Preview contacts for frontend modal
        const previewContacts = validRecords.slice(0, 10).map(val => ({
            row: val.row_index,
            name: val.name,
            phone: val.phone,
            language: val.preferred_language,
            extra: val.extra
        }));

        return {
            fileId: batchId,
            fileName: filename,
            service: targetService,
            status: 'READY',
            totalRows: totalRows,
            validRows: validRecords.length,
            invalidRows: invalidRecords.length,
            errorSummary: errorSummary,
            previewContacts: previewContacts,
            columnsDetected: headerRow.filter(Boolean),
            mappedFields: colMapping
        };
    }

    static async generateUpdatedWorkbook(service, batchId = null, ownerId = null) {
        const cleanService = (service || 'recruitment').toLowerCase().trim();
        let query = 'SELECT * FROM contacts WHERE service = ?';
        const params = [cleanService];

        if (batchId) {
            query += ' AND batch_id = ?';
            params.push(batchId);
        }
        if (ownerId) {
            query += ' AND batch_id IN (SELECT id FROM batches WHERE owner_user_id = ?)';
            params.push(ownerId);
        }
        query += ' ORDER BY row_index ASC, updated_at DESC';

        const rows = await db.all(query, params);

        const workbook = new ExcelJS.Workbook();
        const sheetTitle = `${cleanService.charAt(0).toUpperCase() + cleanService.slice(1)} Report`;
        const worksheet = workbook.addWorksheet(sheetTitle);

        const baseHeaders = [
            'Row', 'Contact Name', 'Phone Number', 'Call Status', 'Provider Call ID',
            'Attempt Count', 'Started At', 'Ended At', 'Duration (Sec)',
            'Language', 'Call Outcome', 'Classification'
        ];

        let serviceHeaders = [];
        if (cleanService === 'recruitment') {
            serviceHeaders = ['Education', 'Skills', 'Experience', 'Job Role Fit', 'Availability'];
        } else if (cleanService === 'sales') {
            serviceHeaders = ['Customer Interest', 'Product Discussed', 'Objections', 'Next Action'];
        } else {
            serviceHeaders = ['Issue Category', 'Urgency', 'Resolution Status', 'Escalation Required'];
        }

        const trailingHeaders = ['Extracted Fields', 'Conversation Summary', 'Validation Errors', 'Error Details'];
        const fullHeaders = [...baseHeaders, ...serviceHeaders, ...trailingHeaders];

        worksheet.addRow(fullHeaders);

        // Header style
        const headerRow = worksheet.getRow(1);
        headerRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0F172A' }
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.height = 24;

        const thinBorder = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        for (let c = 1; c <= fullHeaders.length; c++) {
            headerRow.getCell(c).border = thinBorder;
        }

        for (const r of rows) {
            let extracted = {};
            if (r.extracted_data) {
                try { extracted = JSON.parse(r.extracted_data); } catch (e) {}
            }

            let valErrors = '';
            if (r.validation_errors) {
                try {
                    const parsed = JSON.parse(r.validation_errors);
                    valErrors = Array.isArray(parsed) ? parsed.join('; ') : String(parsed);
                } catch (e) {
                    valErrors = String(r.validation_errors);
                }
            }

            const rowData = [
                r.row_index,
                r.name,
                r.phone,
                r.call_status,
                r.provider_call_id || '',
                r.attempt_count || 0,
                r.started_at || '',
                r.ended_at || '',
                r.duration_seconds || 0,
                r.detected_language || r.preferred_language || 'en',
                r.call_outcome || '',
                r.classification || ''
            ];

            if (cleanService === 'recruitment') {
                rowData.push(
                    extracted.education || '',
                    extracted.skills || '',
                    extracted.experience || '',
                    extracted.job_role_fit || '',
                    extracted.availability || ''
                );
            } else if (cleanService === 'sales') {
                rowData.push(
                    extracted.customer_interest || '',
                    extracted.product_discussed || '',
                    extracted.objections || '',
                    extracted.next_action || ''
                );
            } else {
                rowData.push(
                    extracted.issue_category || '',
                    extracted.urgency || '',
                    extracted.resolution_status || '',
                    extracted.escalation_required ? 'Yes' : 'No'
                );
            }

            rowData.push(
                Object.keys(extracted).length ? JSON.stringify(extracted) : '',
                r.summary || '',
                valErrors,
                r.error_details || ''
            );

            const addedRow = worksheet.addRow(rowData);
            addedRow.font = { name: 'Calibri', size: 10 };
            for (let c = 1; c <= fullHeaders.length; c++) {
                addedRow.getCell(c).border = thinBorder;
            }
        }

        // Auto-fit column widths
        worksheet.columns.forEach(col => {
            let maxLen = 0;
            col.eachCell({ includeEmpty: true }, cell => {
                const val = cell.value ? String(cell.value) : '';
                if (val.length > maxLen) maxLen = val.length;
            });
            col.width = Math.min(Math.max(maxLen + 3, 12), 45);
        });

        return await workbook.xlsx.writeBuffer();
    }
}
