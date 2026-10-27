import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db, { utcNow, ensureCampaignSchema } from './db.js';
import DocumentService from './document_service.js';
import PDFService from './pdf_service.js';
import QuestionPlanner from './question_planner.js';
import ExcelService from './excel_service.js';
import CallQueueWorker from './call_queue_worker.js';
import VoiceRegistry from './voice_registry.js';

const UPLOAD_DIR = path.resolve('data/uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * services/campaign_service.js
 * 
 * Persistent Multi-Campaign Management Engine.
 * Supports isolated Recruitment (PDF JD + Excel), Outbound Sales, and Support campaigns
 * with per-campaign question planning, call queuing, and live telemetry tracking.
 */
export class CampaignService {
    static _campaignContextCache = new Map();

    /**
     * Retrieves structured campaign document context from memory cache or database.
     * Guarantees the document is the source of truth, parsed once and cached per campaign version.
     */
    static async getCampaignContext(campaignId) {
        if (!campaignId) return null;
        if (this._campaignContextCache.has(campaignId)) {
            return this._campaignContextCache.get(campaignId);
        }

        await ensureCampaignSchema();
        const camp = await db.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
        if (!camp) return null;

        let extracted = null;
        if (camp.extracted_data) {
            try {
                extracted = typeof camp.extracted_data === 'string' ? JSON.parse(camp.extracted_data) : camp.extracted_data;
            } catch (e) {
                extracted = { raw: camp.extracted_data };
            }
        } else if (camp.pdf_path && fs.existsSync(camp.pdf_path)) {
            try {
                const buffer = fs.readFileSync(camp.pdf_path);
                extracted = await DocumentService.parseCampaignDocument(buffer, camp.pdf_filename || 'document.pdf', camp.service || 'recruitment');
                const plan = await QuestionPlanner.generatePlanFor(camp.service || 'recruitment', extracted);
                const now = utcNow();
                await db.run('UPDATE campaigns SET extracted_data = ?, question_plan = ?, updated_at = ? WHERE id = ?', [
                    JSON.stringify(extracted),
                    JSON.stringify(plan),
                    now,
                    campaignId
                ]);
            } catch (extErr) {
                console.error(`[CampaignService] Error parsing document for campaign ${campaignId}:`, extErr.message);
                throw new Error(`The campaign document could not be processed: ${extErr.message}. Please upload a readable document.`);
            }
        }

        let questionPlan = [];
        if (camp.question_plan) {
            try {
                questionPlan = typeof camp.question_plan === 'string' ? JSON.parse(camp.question_plan) : camp.question_plan;
            } catch {}
        }

        let config = {};
        if (camp.config) {
            try {
                config = typeof camp.config === 'string' ? JSON.parse(camp.config) : camp.config;
            } catch {}
        }

        const primaryLanguage = camp.primary_language || config.primary_language || 'en-IN';
        const primaryLocale = camp.primary_locale || config.primary_locale || primaryLanguage;
        const voiceKey = VoiceRegistry.normalizeVoiceKey(camp.voice_id || config.voice_id || 'pooja');
        const voiceProvider = camp.voice_provider || config.voice_provider || 'murf';
        const voiceModel = camp.voice_model || config.voice_model || 'falcon-2.1';

        const context = {
            id: camp.id,
            name: camp.name,
            service: camp.service,
            description: camp.description,
            extracted_data: extracted,
            question_plan: questionPlan,
            config,
            primary_language: primaryLanguage,
            primary_locale: primaryLocale,
            voice_id: voiceKey,
            voice_provider: voiceProvider,
            voice_model: voiceModel,
            pdf_filename: camp.pdf_filename,
            pdf_path: camp.pdf_path,
            batch_id: camp.batch_id,
            version: `${camp.id}_${camp.updated_at || camp.created_at || Date.now()}`
        };

        this._campaignContextCache.set(campaignId, context);
        return context;
    }

    /**
     * Invalidates the campaign memory cache (e.g. after document replacement, update, or deletion).
     */
    static invalidateCampaignContext(campaignId = null) {
        if (!campaignId) {
            this._campaignContextCache.clear();
            return;
        }
        this._campaignContextCache.delete(campaignId);
    }
    /**
     * Creates a new campaign in DRAFT status.
     */
    static async createCampaign({
        name,
        service = 'recruitment',
        description = '',
        primary_language,
        primary_locale,
        voice_id,
        voice_provider,
        voice_model,
        config = {},
        extracted_data = null,
        question_plan = null,
        ownerUserId = null
    }) {
        await ensureCampaignSchema();
        const id = `camp_${crypto.randomBytes(8).toString('hex')}`;
        const now = utcNow();
        const validService = ['recruitment', 'sales', 'support', 'appointment', 'receptionist'].includes(service.toLowerCase())
            ? service.toLowerCase()
            : 'recruitment';

        const rawVoice = voice_id || config.voice_id || 'pooja';
        const voiceKey = VoiceRegistry.normalizeVoiceKey(rawVoice);
        const primaryLocale = VoiceRegistry.normalizeLocale(primary_locale || config.primary_locale || primary_language || config.primary_language || 'en-IN');
        const primaryLanguage = primary_language || config.primary_language || primaryLocale;
        const voiceProvider = voice_provider || config.voice_provider || 'murf';
        const voiceModel = voice_model || config.voice_model || 'falcon-2.1';

        // Validate voice & locale combination
        const validation = VoiceRegistry.validateVoiceAndLocale(voiceKey, primaryLocale);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        const initialConfig = JSON.stringify({
            ai_model: config.ai_model || 'claude-haiku-5-5',
            voice_id_english: config.voice_id_english || process.env.ELEVENLABS_VOICE_ID_SId || '0muxiGNHAVvmM1qWRtyV',
            voice_id_telugu: config.voice_id_telugu || process.env.ELEVENLABS_VOICE_ID_TELUGU || process.env.ELEVENLABS_VOICE_ID_CHAITRA || process.env.ELEVENLABS_VOICE_ID_SId || '0muxiGNHAVvmM1qWRtyV',
            screening_strictness: config.screening_strictness || 'standard',
            retry_policy: config.retry_policy || { max_attempts: 1, retry_unanswered: false },
            primary_language: primaryLanguage,
            primary_locale: primaryLocale,
            voice_id: voiceKey,
            voice_provider: voiceProvider,
            voice_model: voiceModel,
            ...config
        });

        const initialExtracted = extracted_data ? JSON.stringify(extracted_data) : null;
        const initialPlan = question_plan ? JSON.stringify(question_plan) : null;

        await db.run(`
            INSERT INTO campaigns (
                id, name, service, description, status, config, extracted_data, question_plan,
                primary_language, primary_locale, voice_id, voice_provider, voice_model,
                owner_user_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, name.trim(), validService, (description || '').trim(), initialConfig, initialExtracted, initialPlan,
            primaryLanguage, primaryLocale, voiceKey, voiceProvider, voiceModel,
            ownerUserId, now, now
        ]);

        return this.getCampaign(id, ownerUserId);
    }

    /**
     * Retrieves a single campaign by ID with live contact & outcome metrics.
     */
    static async getCampaign(id, ownerUserId = null) {
        await ensureCampaignSchema();
        const ownerWhere = ownerUserId ? ' AND (owner_user_id = ? OR owner_user_id IS NULL)' : '';
        const params = ownerUserId ? [id, ownerUserId] : [id];

        const campaign = await db.get(`SELECT * FROM campaigns WHERE id = ?${ownerWhere}`, params);
        if (!campaign) return null;

        // Parse JSON fields safely
        try { campaign.extracted_data = JSON.parse(campaign.extracted_data); } catch { campaign.extracted_data = null; }
        try { campaign.question_plan = JSON.parse(campaign.question_plan); } catch { campaign.question_plan = []; }
        try { campaign.config = JSON.parse(campaign.config); } catch { campaign.config = {}; }

        // Backward-compatible safe defaults for language & voice
        campaign.primary_language = campaign.primary_language || campaign.config?.primary_language || 'en-IN';
        campaign.primary_locale = campaign.primary_locale || campaign.config?.primary_locale || campaign.primary_language;
        campaign.voice_id = VoiceRegistry.normalizeVoiceKey(campaign.voice_id || campaign.config?.voice_id || 'pooja');
        campaign.voice_provider = campaign.voice_provider || campaign.config?.voice_provider || 'murf';
        campaign.voice_model = campaign.voice_model || campaign.config?.voice_model || 'falcon-2.1';

        // Recalculate live stats from contacts table
        const stats = await db.get(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN validation_status = 'VALID' THEN 1 ELSE 0 END) as valid,
                SUM(CASE WHEN validation_status = 'INVALID' THEN 1 ELSE 0 END) as invalid,
                SUM(CASE WHEN call_status = 'PENDING' AND validation_status = 'VALID' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN call_status IN ('CALLING', 'in-progress') THEN 1 ELSE 0 END) as in_progress,
                SUM(CASE WHEN call_status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN call_status IN ('FAILED', 'UNANSWERED') THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN classification LIKE '%Selected%' OR classification LIKE '%Shortlisted%' THEN 1 ELSE 0 END) as selected_cnt,
                SUM(CASE WHEN classification LIKE '%Rejected%' THEN 1 ELSE 0 END) as rejected_cnt,
                SUM(CASE WHEN classification LIKE '%Hold%' THEN 1 ELSE 0 END) as on_hold_cnt
            FROM contacts
            WHERE campaign_id = ? OR (batch_id = ? AND batch_id IS NOT NULL AND batch_id != '')
        `, [id, campaign.batch_id || '']);

        if (stats && Number(stats.total) > 0) {
            campaign.total_contacts = Number(stats.total) || 0;
            campaign.valid_contacts = Number(stats.valid) || 0;
            campaign.invalid_contacts = Number(stats.invalid) || 0;
            campaign.pending_calls = Number(stats.pending) || 0;
            campaign.inprogress_calls = Number(stats.in_progress) || 0;
            campaign.completed_calls = Number(stats.completed) || 0;
            campaign.failed_calls = Number(stats.failed) || 0;
            campaign.selected_count = Number(stats.selected_cnt) || 0;
            campaign.rejected_count = Number(stats.rejected_cnt) || 0;
            campaign.on_hold_count = Number(stats.on_hold_cnt) || 0;
        }

        return campaign;
    }

    /**
     * Lists all campaigns belonging to an owner.
     */
    static async listCampaigns(ownerUserId = null, { service = null, status = null } = {}) {
        await ensureCampaignSchema();
        const conditions = [];
        const params = [];

        if (ownerUserId) {
            conditions.push('(owner_user_id = ? OR owner_user_id IS NULL)');
            params.push(ownerUserId);
        }
        if (service) {
            conditions.push('service = ?');
            params.push(service.toLowerCase());
        }
        if (status) {
            conditions.push('status = ?');
            params.push(status.toUpperCase());
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = await db.all(`SELECT * FROM campaigns ${whereClause} ORDER BY created_at DESC`, params);

        return rows.map(r => {
            let extracted = null;
            let plan = [];
            let config = {};
            try { extracted = JSON.parse(r.extracted_data); } catch {}
            try { plan = JSON.parse(r.question_plan); } catch {}
            try { config = JSON.parse(r.config); } catch {}
            return {
                ...r,
                extracted_data: extracted,
                question_plan: plan,
                config
            };
        });
    }

    /**
     * Updates an existing campaign's configuration, JD requirements, or name.
     */
    static async updateCampaign(id, updateData, ownerUserId = null) {
        await ensureCampaignSchema();
        const campaign = await this.getCampaign(id, ownerUserId);
        if (!campaign) throw new Error('Campaign not found.');

        const now = utcNow();
        const name = updateData.name !== undefined ? updateData.name.trim() : campaign.name;
        const description = updateData.description !== undefined ? updateData.description.trim() : campaign.description;
        const status = updateData.status !== undefined ? updateData.status.toUpperCase() : campaign.status;

        const extractedData = updateData.extracted_data !== undefined
            ? JSON.stringify(updateData.extracted_data)
            : JSON.stringify(campaign.extracted_data);

        const questionPlan = updateData.question_plan !== undefined
            ? JSON.stringify(updateData.question_plan)
            : JSON.stringify(campaign.question_plan);

        const rawVoice = updateData.voice_id !== undefined ? updateData.voice_id : (updateData.config?.voice_id !== undefined ? updateData.config.voice_id : campaign.voice_id);
        const voiceKey = VoiceRegistry.normalizeVoiceKey(rawVoice || 'pooja');

        const rawLocale = updateData.primary_locale !== undefined ? updateData.primary_locale : (updateData.config?.primary_locale !== undefined ? updateData.config.primary_locale : (updateData.primary_language !== undefined ? updateData.primary_language : campaign.primary_locale));
        const primaryLocale = VoiceRegistry.normalizeLocale(rawLocale || 'en-IN');

        const primaryLanguage = updateData.primary_language !== undefined ? updateData.primary_language : (updateData.config?.primary_language !== undefined ? updateData.config.primary_language : (campaign.primary_language || primaryLocale));

        // If voice or locale are explicitly updated, validate
        if (updateData.voice_id !== undefined || updateData.primary_locale !== undefined || updateData.primary_language !== undefined || updateData.config?.voice_id !== undefined || updateData.config?.primary_locale !== undefined) {
            const validation = VoiceRegistry.validateVoiceAndLocale(voiceKey, primaryLocale);
            if (!validation.valid) {
                throw new Error(validation.error);
            }
        }

        const voiceProvider = updateData.voice_provider || updateData.config?.voice_provider || campaign.voice_provider || 'murf';
        const voiceModel = updateData.voice_model || updateData.config?.voice_model || campaign.voice_model || 'falcon-2.1';

        const config = JSON.stringify({
            ...campaign.config,
            ...(updateData.config || {}),
            primary_language: primaryLanguage,
            primary_locale: primaryLocale,
            voice_id: voiceKey,
            voice_provider: voiceProvider,
            voice_model: voiceModel
        });

        await db.run(`
            UPDATE campaigns SET
                name = ?, description = ?, status = ?, extracted_data = ?, question_plan = ?, config = ?,
                primary_language = ?, primary_locale = ?, voice_id = ?, voice_provider = ?, voice_model = ?,
                updated_at = ?
            WHERE id = ?
        `, [
            name, description, status, extractedData, questionPlan, config,
            primaryLanguage, primaryLocale, voiceKey, voiceProvider, voiceModel,
            now, id
        ]);

        this.invalidateCampaignContext(id);

        return this.getCampaign(id, ownerUserId);
    }

    /**
     * Attaches and extracts a Job Description or Knowledge Base document (PDF or Word) to the campaign.
     */
    static async attachDocument(campaignId, fileBuffer, originalName, ownerUserId = null) {
        await ensureCampaignSchema();
        const campaign = await this.getCampaign(campaignId, ownerUserId);
        if (!campaign) throw new Error('Campaign not found.');

        const ext = path.extname(originalName || '').toLowerCase();
        if (!['.pdf', '.docx', '.doc'].includes(ext)) {
            throw new Error(`Unsupported document format "${ext}". Supported formats are PDF (.pdf) and Microsoft Word (.docx, .doc).`);
        }

        const safeFilename = `camp_${campaignId}_${Date.now()}_${originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = path.join(UPLOAD_DIR, safeFilename);
        fs.writeFileSync(filePath, fileBuffer);

        // Clean up previous document file if replacing
        if (campaign.pdf_path && campaign.pdf_path !== filePath && fs.existsSync(campaign.pdf_path)) {
            try { fs.unlinkSync(campaign.pdf_path); } catch (e) {}
        }

        let extracted = null;
        let questionPlan = [];

        console.log(`[CampaignService] Parsing ${campaign.service.toUpperCase()} document (${ext}) for campaign: ${campaign.name}...`);
        extracted = await DocumentService.parseCampaignDocument(fileBuffer, originalName, campaign.service);

        questionPlan = await QuestionPlanner.generatePlanFor(campaign.service, extracted);

        const now = utcNow();
        await db.run(`
            UPDATE campaigns SET
                pdf_filename = ?, pdf_path = ?, extracted_data = ?, question_plan = ?, updated_at = ?
            WHERE id = ?
        `, [originalName, filePath, JSON.stringify(extracted), JSON.stringify(questionPlan), now, campaignId]);

        this.invalidateCampaignContext(campaignId);

        return {
            campaignId,
            pdfFilename: originalName,
            documentFilename: originalName,
            documentType: extracted.document_type || DocumentService.getDocumentType(originalName),
            extractedData: extracted,
            questionPlan
        };
    }

    /**
     * Backward-compatible alias for attachDocument.
     */
    static async attachPdf(campaignId, fileBuffer, originalName, ownerUserId = null) {
        return this.attachDocument(campaignId, fileBuffer, originalName, ownerUserId);
    }

    /**
     * Removes an attached document and its extracted instructions from a campaign.
     */
    static async removeDocument(campaignId, ownerUserId = null) {
        await ensureCampaignSchema();
        const campaign = await this.getCampaign(campaignId, ownerUserId);
        if (!campaign) throw new Error('Campaign not found.');

        if (campaign.pdf_path && fs.existsSync(campaign.pdf_path)) {
            try { fs.unlinkSync(campaign.pdf_path); } catch (e) {}
        }

        const now = utcNow();
        await db.run(`
            UPDATE campaigns SET
                pdf_filename = NULL, pdf_path = NULL, extracted_data = NULL, question_plan = NULL, updated_at = ?
            WHERE id = ?
        `, [now, campaignId]);

        this.invalidateCampaignContext(campaignId);

        return { success: true, campaignId, message: 'Attached document removed.' };
    }

    /**
     * Attaches and validates an Excel candidate or lead spreadsheet to the campaign.
     */
    static async attachExcel(campaignId, fileObj, originalName, ownerUserId = null) {
        await ensureCampaignSchema();
        const campaign = await this.getCampaign(campaignId, ownerUserId);
        if (!campaign) throw new Error('Campaign not found.');

        const ext = path.extname(originalName).toLowerCase();
        if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
            throw new Error('Only Excel (.xlsx, .xls) and CSV (.csv) files are supported.');
        }

        // Process upload through ExcelService with the campaign's service type
        const processResult = await ExcelService.parseAndValidateUpload(fileObj, originalName, campaign.service || 'recruitment');
        const batchId = processResult.fileId;

        // Clean up previous excel file if replacing
        if (campaign.excel_path && campaign.excel_path !== processResult.filePath && fs.existsSync(campaign.excel_path)) {
            try { fs.unlinkSync(campaign.excel_path); } catch (e) {}
        }

        // Clear any old pending queued items for this campaign
        await db.run(`DELETE FROM call_queue WHERE campaign_id = ? AND status = 'QUEUED'`, [campaignId]);

        // Associate batch and its contacts with this campaign
        const now = utcNow();
        await db.run(`UPDATE batches SET campaign_id = ?, owner_user_id = ?, updated_at = ? WHERE id = ?`, [campaignId, ownerUserId, now, batchId]);
        await db.run(`UPDATE contacts SET campaign_id = ?, owner_user_id = ?, updated_at = ? WHERE batch_id = ?`, [campaignId, ownerUserId, now, batchId]);

        // Update campaign record: ready to continue/start calling
        const status = ['DRAFT', 'COMPLETED', 'ARCHIVED', 'PAUSED'].includes(campaign.status) ? 'READY' : campaign.status;
        await db.run(`
            UPDATE campaigns SET
                excel_filename = ?, excel_path = ?, batch_id = ?, status = ?,
                total_contacts = ?, valid_contacts = ?, invalid_contacts = ?, pending_calls = ?, updated_at = ?
            WHERE id = ?
        `, [
            originalName,
            processResult.filePath || '',
            batchId,
            status,
            processResult.totalRows || 0,
            processResult.validRows || 0,
            processResult.invalidRows || 0,
            processResult.validRows || 0,
            now,
            campaignId
        ]);

        return {
            campaignId,
            batchId,
            excelFilename: originalName,
            ...processResult
        };
    }

    /**
     * Campaigns page quick launch (upload a sheet, then Start Calling): gives the sheet a campaign that holds
     * the uploaded document's facts and question plan, so the calls on that sheet use the document.
     * If the sheet already belongs to a campaign, that campaign's document is replaced.
     */
    static async attachQuickLaunchDocument({ batchId, service, filename, extractedData, questionPlan, ownerUserId = null }) {
        await ensureCampaignSchema();
        const batch = await db.get('SELECT * FROM batches WHERE id = ?', [batchId]);
        if (!batch) throw new Error('That contact sheet was not found. Upload it again.');

        const now = utcNow();
        const plan = Array.isArray(questionPlan) ? questionPlan : [];
        const docName = String(filename || 'document').slice(0, 255);

        if (batch.campaign_id) {
            await db.run(
                'UPDATE campaigns SET pdf_filename = ?, extracted_data = ?, question_plan = ?, updated_at = ? WHERE id = ?',
                [docName, JSON.stringify(extractedData), JSON.stringify(plan), now, batch.campaign_id]);
            return { campaignId: batch.campaign_id };
        }

        const campaign = await this.createCampaign({
            name: `Quick launch - ${batch.filename}`,
            service,
            description: 'Started from the Campaigns page with an uploaded document.',
            extracted_data: extractedData,
            question_plan: plan,
            ownerUserId
        });
        await db.run(`
            UPDATE campaigns SET
                pdf_filename = ?, excel_filename = ?, batch_id = ?, status = 'READY',
                total_contacts = ?, valid_contacts = ?, invalid_contacts = ?, pending_calls = ?, updated_at = ?
            WHERE id = ?
        `, [docName, batch.filename, batchId, batch.total_rows || 0, batch.valid_rows || 0, batch.invalid_rows || 0, batch.valid_rows || 0, now, campaign.id]);
        await db.run('UPDATE batches SET campaign_id = ?, updated_at = ? WHERE id = ?', [campaign.id, now, batchId]);
        await db.run('UPDATE contacts SET campaign_id = ?, updated_at = ? WHERE batch_id = ?', [campaign.id, now, batchId]);
        return { campaignId: campaign.id };
    }

    /**
     * Starts or resumes calling for a campaign.
     */
    static async startCampaign(campaignId, ownerUserId = null) {
        await ensureCampaignSchema();
        const campaign = await this.getCampaign(campaignId, ownerUserId);
        if (!campaign) throw new Error('Campaign not found.');

        // Validate voice & locale combination before starting
        const voiceKey = campaign.voice_id || campaign.config?.voice_id || 'pooja';
        const locale = campaign.primary_locale || campaign.config?.primary_locale || 'en-IN';
        const voiceVal = VoiceRegistry.validateVoiceAndLocale(voiceKey, locale);
        if (!voiceVal.valid) {
            throw new Error(`Cannot launch campaign: ${voiceVal.error}`);
        }

        if (!campaign.batch_id) {
            throw new Error('Please upload an Excel contact sheet before starting the campaign.');
        }

        if (campaign.service === 'recruitment' && !campaign.pdf_filename && (!campaign.extracted_data || Object.keys(campaign.extracted_data).length === 0)) {
            throw new Error('Please upload a Job Description document (PDF or Word) before starting a recruitment screening campaign.');
        }

        const now = utcNow();

        // Enqueue valid pending contacts specifically for this campaign
        await db.run(`UPDATE batches SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?`, [now, campaign.batch_id]);
        await db.run(`UPDATE campaigns SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?`, [now, campaignId]);

        const contacts = await db.all(`
            SELECT id, service, phone FROM contacts 
            WHERE batch_id = ? AND validation_status = 'VALID' AND call_status = 'PENDING'
        `, [campaign.batch_id]);

        if (contacts.length === 0) {
            // Check if there are already queued items
            const activeQueue = await db.get(`SELECT COUNT(*) as cnt FROM call_queue WHERE batch_id = ? AND status = 'QUEUED'`, [campaign.batch_id]);
            if (activeQueue && Number(activeQueue.cnt) > 0) {
                CallQueueWorker._startLoop();
                return { success: true, queuedCount: Number(activeQueue.cnt), status: 'IN_PROGRESS', message: 'Campaign calling loop resumed.' };
            }
            throw new Error('No pending valid contacts available to call in this campaign.');
        }

        await db.transaction(async (trx) => {
            for (const c of contacts) {
                const queueId = `q_${Math.random().toString(36).substring(2, 9)}`;
                await trx.run(`
                    INSERT IGNORE INTO call_queue (id, batch_id, contact_id, service, campaign_id, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?)
                `, [queueId, campaign.batch_id, c.id, campaign.service, campaignId, now, now]);
            }
        });

        // Trigger worker loop
        CallQueueWorker._startLoop();

        return {
            success: true,
            campaignId,
            status: 'IN_PROGRESS',
            queuedCount: contacts.length,
            message: `Campaign "${campaign.name}" initialized. Dispatched ${contacts.length} calls to sequential queue.`
        };
    }

    /**
     * Pauses an active campaign.
     */
    static async pauseCampaign(campaignId, ownerUserId = null) {
        await ensureCampaignSchema();
        const campaign = await this.getCampaign(campaignId, ownerUserId);
        if (!campaign) throw new Error('Campaign not found.');

        const now = utcNow();
        await db.run(`UPDATE campaigns SET status = 'PAUSED', updated_at = ? WHERE id = ?`, [now, campaignId]);
        if (campaign.batch_id) {
            await db.run(`UPDATE batches SET status = 'PAUSED', updated_at = ? WHERE id = ?`, [now, campaign.batch_id]);
        }

        return { success: true, campaignId, status: 'PAUSED', message: `Campaign "${campaign.name}" paused.` };
    }

    /**
     * Resumes a paused campaign.
     */
    static async resumeCampaign(campaignId, ownerUserId = null) {
        await ensureCampaignSchema();
        const campaign = await this.getCampaign(campaignId, ownerUserId);
        if (!campaign) throw new Error('Campaign not found.');

        if (campaign.batch_id) {
            try {
                return await this.startCampaign(campaignId, ownerUserId);
            } catch (err) {
                // If no pending contacts to enqueue, still transition state to ACTIVE
            }
        }
        const now = utcNow();
        await db.run(`UPDATE campaigns SET status = 'ACTIVE', updated_at = ? WHERE id = ?`, [now, campaignId]);
        return { success: true, campaignId, status: 'ACTIVE', message: `Campaign "${campaign.name}" resumed.` };
    }

    /**
     * Duplicates a campaign configuration (name, service, JD requirements, question plan, config)
     * WITHOUT duplicating call results or re-dialing existing contacts.
     */
    static async duplicateCampaign(campaignId, ownerUserId = null) {
        await ensureCampaignSchema();
        const original = await this.getCampaign(campaignId, ownerUserId);
        if (!original) throw new Error('Original campaign not found.');

        const newId = `camp_${crypto.randomBytes(8).toString('hex')}`;
        const now = utcNow();
        const copyName = `${original.name} (Copy)`;

        await db.run(`
            INSERT INTO campaigns (
                id, name, service, description, status,
                pdf_filename, pdf_path, extracted_data, question_plan, config,
                owner_user_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            newId,
            copyName,
            original.service,
            original.description,
            original.pdf_filename,
            original.pdf_path,
            JSON.stringify(original.extracted_data),
            JSON.stringify(original.question_plan),
            JSON.stringify(original.config),
            ownerUserId,
            now,
            now
        ]);

        return this.getCampaign(newId, ownerUserId);
    }

    /**
     * Archives a campaign.
     */
    static async archiveCampaign(campaignId, ownerUserId = null) {
        await ensureCampaignSchema();
        const campaign = await this.getCampaign(campaignId, ownerUserId);
        if (!campaign) throw new Error('Campaign not found.');

        const now = utcNow();
        await db.run(`UPDATE campaigns SET status = 'ARCHIVED', updated_at = ? WHERE id = ?`, [now, campaignId]);
        return { success: true, campaignId, status: 'ARCHIVED', message: `Campaign "${campaign.name}" archived.` };
    }

    /**
     * Permanently deletes a campaign and cleans up associated batches, contacts, call queue,
     * conversations, transcripts, and disk files.
     */
    static async deleteCampaign(campaignId, ownerUserId = null) {
        await ensureCampaignSchema();
        const campaign = await this.getCampaign(campaignId, ownerUserId);
        if (!campaign) throw new Error('Campaign not found.');

        // 1. Delete campaign document from disk
        if (campaign.pdf_path && fs.existsSync(campaign.pdf_path)) {
            try { fs.unlinkSync(campaign.pdf_path); } catch (e) {
                console.warn(`[CampaignService] Could not remove pdf file: ${e.message}`);
            }
        }

        // 2. Delete campaign excel file from disk
        if (campaign.excel_path && fs.existsSync(campaign.excel_path)) {
            try { fs.unlinkSync(campaign.excel_path); } catch (e) {
                console.warn(`[CampaignService] Could not remove excel file: ${e.message}`);
            }
        }

        // 3. Delete files for all batches associated with this campaign
        try {
            const batches = await db.all(`
                SELECT id, original_path FROM batches 
                WHERE campaign_id = ? OR (id = ? AND ? != '')
            `, [campaignId, campaign.batch_id || '', campaign.batch_id || '']);
            for (const b of (batches || [])) {
                if (b.original_path && fs.existsSync(b.original_path)) {
                    try { fs.unlinkSync(b.original_path); } catch {}
                }
            }
        } catch (e) {}

        // 4. Remove queued calls
        await db.run(`
            DELETE FROM call_queue 
            WHERE campaign_id = ? OR (batch_id = ? AND batch_id IS NOT NULL AND batch_id != '')
        `, [campaignId, campaign.batch_id || '']);

        // 5. Remove transcript messages for campaign conversations
        await db.run(`
            DELETE FROM transcript_messages 
            WHERE conversation_id IN (
                SELECT id FROM conversations WHERE campaign_id = ?
            )
        `, [campaignId]);

        // 6. Remove conversations
        await db.run(`DELETE FROM conversations WHERE campaign_id = ?`, [campaignId]);

        // 7. Remove contacts
        await db.run(`
            DELETE FROM contacts 
            WHERE campaign_id = ? OR (batch_id = ? AND batch_id IS NOT NULL AND batch_id != '')
        `, [campaignId, campaign.batch_id || '']);

        // 8. Remove batches
        await db.run(`
            DELETE FROM batches 
            WHERE campaign_id = ? OR (id = ? AND id IS NOT NULL AND id != '')
        `, [campaignId, campaign.batch_id || '']);

        // 9. Remove campaign record itself
        await db.run(`DELETE FROM campaigns WHERE id = ?`, [campaignId]);
        this.invalidateCampaignContext(campaignId);

        console.log(`[CampaignService] Permanently deleted campaign "${campaign.name}" (${campaignId}).`);

        return {
            success: true,
            campaignId,
            message: `Campaign "${campaign.name}" and all associated data have been permanently deleted.`
        };
    }
}

export default CampaignService;
