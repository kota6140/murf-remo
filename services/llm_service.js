import 'dotenv/config';

/**
 * services/llm_service.js
 * 
 * Enterprise Multi-Provider LLM Abstraction with Sub-Second Claude Haiku Primary
 * and Gemini 3.1 Flash-Lite Fallback.
 * 
 * Performance & Fault-Tolerance Strategy:
 * 1. Primary: Claude Haiku (ultrafast, highly natural conversational reasoning).
 * 2. Fallback: Gemini Flash (instant failover if Claude times out, 429s, or throws).
 * 3. Bounded Latency: Strict timeouts prevent stalling live voice streams.
 * 4. Structured JSON extraction with resilient markdown/code-block stripping & repair.
 * 5. Full observability: logs provider, model, latencyMs, and fallback reasons.
 */

export class LLMService {
    static getClaudeApiKey() {
        return (process.env.CLAUDE_API_KEY || '').trim();
    }

    static getGeminiApiKey() {
        return (process.env.GEMINI_API_KEY || '').trim();
    }

    static getClaudeModel() {
        const raw = (process.env.CLAUDE_MODEL || 'claude-haiku-5-5').trim();
        const lower = raw.toLowerCase().replace(/\s+/g, '-');
        if (lower === 'haiku-5.5' || lower === 'claude-haiku-5.5' || lower === 'haiku-5-5') {
            return 'claude-haiku-5-5';
        }
        if (lower === 'haiku-4.5' || lower === 'claude-haiku-4.5' || lower === 'haiku-4-5') {
            return 'claude-haiku-4-5-20251001';
        }
        return raw;
    }

    static getGeminiModel() {
        return (process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite').trim();
    }

    static getActiveProvider() {
        if (this.getClaudeApiKey()) return 'claude';
        if (this.getGeminiApiKey()) return 'gemini';
        return 'claude';
    }

    /**
     * Executes a completion with automatic failover from Claude Haiku to Gemini Flash.
     * 
     * @param {object} params
     * @param {string} params.systemPrompt - High-priority system instructions
     * @param {Array<{role: string, content: string}>} params.messages - Conversation history
     * @param {number} [params.maxTokens=300] - Max tokens to generate
     * @param {number} [params.temperature=0.3] - Sampling temperature
     * @param {number} [params.timeoutMs=4500] - Hard network timeout per provider
     * @param {boolean} [params.jsonMode=false] - Hint to return parsed JSON
     * @returns {Promise<{text: string, parsedJson?: object, provider: string, model: string, latencyMs: number, fallback: boolean}>}
     */
    static async generate({
        systemPrompt = '',
        messages = [],
        maxTokens = 300,
        temperature = 0.3,
        timeoutMs = 4500,
        jsonMode = false
    }) {
        const startTime = performance.now();
        const claudeKey = this.getClaudeApiKey();
        const geminiKey = this.getGeminiApiKey();

        // 1. Try Claude Haiku Primary
        if (claudeKey) {
            try {
                const claudeModel = this.getClaudeModel();
                const claudeResult = await this._callClaude({
                    apiKey: claudeKey,
                    model: claudeModel,
                    systemPrompt,
                    messages,
                    maxTokens,
                    temperature,
                    timeoutMs
                });

                const latencyMs = Math.round(performance.now() - startTime);
                if (claudeResult && claudeResult.text && claudeResult.text.trim()) {
                    let parsedJson = null;
                    if (jsonMode) {
                        parsedJson = this.extractJson(claudeResult.text);
                    }
                    return {
                        text: claudeResult.text.trim(),
                        parsedJson,
                        provider: 'claude',
                        model: claudeModel,
                        latencyMs,
                        fallback: false
                    };
                }
            } catch (claudeErr) {
                console.warn(`[LLMService] Claude Haiku error (${claudeErr.message}). Triggering Gemini fallback...`);
            }
        }

        // 2. Fallback to Gemini Flash
        if (geminiKey) {
            try {
                const geminiModel = this.getGeminiModel();
                const geminiResult = await this._callGemini({
                    apiKey: geminiKey,
                    model: geminiModel,
                    systemPrompt,
                    messages,
                    maxTokens,
                    temperature,
                    timeoutMs
                });

                const latencyMs = Math.round(performance.now() - startTime);
                if (geminiResult && geminiResult.text && geminiResult.text.trim()) {
                    let parsedJson = null;
                    if (jsonMode) {
                        parsedJson = this.extractJson(geminiResult.text);
                    }
                    return {
                        text: geminiResult.text.trim(),
                        parsedJson,
                        provider: 'gemini',
                        model: geminiModel,
                        latencyMs,
                        fallback: true
                    };
                }
            } catch (geminiErr) {
                console.error(`[LLMService] Gemini Fallback error: ${geminiErr.message}.`);
            }
        }

        // 3. Both failed or unconfigured
        const elapsed = Math.round(performance.now() - startTime);
        return {
            text: '',
            parsedJson: null,
            provider: 'none',
            model: 'none',
            latencyMs: elapsed,
            fallback: true,
            error: 'All configured LLM providers were unavailable or timed out.'
        };
    }

    /**
     * Direct Claude REST API call
     */
    static async _callClaude({ apiKey, model, systemPrompt, messages, maxTokens, temperature, timeoutMs }) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        // Normalize messages to Claude format (role: user | assistant)
        const claudeMessages = messages.map(m => ({
            role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }));

        if (claudeMessages.length === 0) {
            claudeMessages.push({ role: 'user', content: 'Begin conversation.' });
        } else if (claudeMessages[0].role !== 'user') {
            claudeMessages.unshift({ role: 'user', content: 'Begin conversation.' });
        }

        try {
            const bodyPayload = {
                model,
                max_tokens: maxTokens,
                messages: claudeMessages
            };
            // Claude Haiku 5.5 / 4.5: Explicitly disable internal thinking tokens to eliminate
            // 3-4s latency overhead on real-time conversational voice calls.
            if (model.includes('haiku') || model.includes('claude')) {
                bodyPayload.thinking = { type: 'disabled' };
            }
            if (!model.includes('5-5') && typeof temperature === 'number') {
                bodyPayload.temperature = temperature;
            }
            if (systemPrompt && systemPrompt.trim()) {
                bodyPayload.system = systemPrompt.trim();
            }

            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                },
                body: JSON.stringify(bodyPayload),
                signal: controller.signal
            });

            clearTimeout(timer);
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Claude HTTP ${res.status}: ${errText.slice(0, 150)}`);
            }

            const data = await res.json();
            // Filter specifically for text content blocks (ignoring any thinking/signature blocks)
            const text = data.content?.filter(c => c.type === 'text').map(c => c.text || '').join('\n') || '';
            return { text };
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Direct Gemini REST API call
     */
    static async _callGemini({ apiKey, model, systemPrompt, messages, maxTokens, temperature, timeoutMs }) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const contents = [];
        for (const m of messages) {
            contents.push({
                role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
                parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
            });
        }

        if (contents.length === 0) {
            contents.push({ role: 'user', parts: [{ text: 'Begin conversation.' }] });
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const payload = {
            contents,
            generationConfig: {
                maxOutputTokens: maxTokens,
                temperature
            }
        };

        if (systemPrompt && systemPrompt.trim()) {
            payload.systemInstruction = {
                parts: [{ text: systemPrompt.trim() }]
            };
        }

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timer);
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 150)}`);
            }

            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return { text };
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Resiliently extracts and parses JSON from model responses.
     */
    static extractJson(rawText) {
        if (!rawText || typeof rawText !== 'string') return null;
        let cleaned = rawText.trim();

        if (cleaned.includes('```')) {
            const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
            if (match && match[1]) {
                cleaned = match[1].trim();
            }
        }

        try {
            return JSON.parse(cleaned);
        } catch (e) {
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                try {
                    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
                } catch (e2) {}
            }

            const firstBracket = cleaned.indexOf('[');
            const lastBracket = cleaned.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
                try {
                    return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
                } catch (e3) {}
            }
        }

        return null;
    }
}

export default LLMService;
