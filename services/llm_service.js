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
        return (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
    }

    static getGeminiApiKey() {
        return '';
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
        return 'disabled';
    }

    static getActiveProvider() {
        return 'claude';
    }

    /**
     * Executes a completion using Anthropic Claude exclusively.
     * 
     * @param {object} params
     * @param {string} params.systemPrompt - High-priority system instructions
     * @param {Array<{role: string, content: string}>} params.messages - Conversation history
     * @param {number} [params.maxTokens=300] - Max tokens to generate
     * @param {number} [params.temperature=0.3] - Sampling temperature
     * @param {number} [params.timeoutMs=4500] - Hard network timeout
     * @param {boolean} [params.jsonMode=false] - Hint to return parsed JSON
     * @returns {Promise<{text: string, parsedJson?: object, provider: string, model: string, latencyMs: number, fallback: boolean, error?: string}>}
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

        if (!claudeKey) {
            const err = 'ANTHROPIC_API_KEY is not set in environment or .env file.';
            console.error(`[LLMService] Configuration Error: ${err}`);
            return {
                text: '',
                parsedJson: null,
                provider: 'none',
                model: 'none',
                latencyMs: 0,
                fallback: true,
                error: err
            };
        }

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
            console.error(`[LLMService] Claude API error: ${claudeErr.message}`);
            const elapsed = Math.round(performance.now() - startTime);
            return {
                text: '',
                parsedJson: null,
                provider: 'claude',
                model: this.getClaudeModel(),
                latencyMs: elapsed,
                fallback: true,
                error: claudeErr.message
            };
        }

        const elapsed = Math.round(performance.now() - startTime);
        return {
            text: '',
            parsedJson: null,
            provider: 'none',
            model: 'none',
            latencyMs: elapsed,
            fallback: true,
            error: 'Claude returned empty response.'
        };
    }

    /**
     * Executes a completion with token streaming and early extraction of spoken_response.
     * When onSpokenSentence callback is passed, sentences are dispatched to TTS as soon as completed.
     */
    static async generateStream({
        systemPrompt = '',
        messages = [],
        maxTokens = 110,
        temperature = 0.2,
        timeoutMs = 5000,
        jsonMode = true,
        onToken = null,
        onSpokenSentence = null
    }) {
        const startTime = performance.now();
        const claudeKey = this.getClaudeApiKey();

        if (claudeKey) {
            try {
                const claudeModel = this.getClaudeModel();
                const claudeResult = await this._callClaudeStream({
                    apiKey: claudeKey,
                    model: claudeModel,
                    systemPrompt,
                    messages,
                    maxTokens,
                    temperature,
                    timeoutMs,
                    onToken,
                    onSpokenSentence
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
                        firstTokenMs: claudeResult.firstTokenMs,
                        emittedSentences: claudeResult.emittedSentences || [],
                        fallback: false
                    };
                }
            } catch (claudeErr) {
                console.warn(`[LLMService] Claude streaming error (${claudeErr.message}). Triggering fallback...`);
            }
        }

        // Automatic fallback to non-streaming generate
        return await this.generate({
            systemPrompt,
            messages,
            maxTokens,
            temperature,
            timeoutMs,
            jsonMode
        });
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
     * Streams Claude Haiku completion with early extraction of spoken dialogue.
     */
    static async _callClaudeStream({
        apiKey,
        model,
        systemPrompt,
        messages,
        maxTokens,
        temperature,
        timeoutMs,
        onToken = null,
        onSpokenSentence = null
    }) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let streamTimer = null;

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
                messages: claudeMessages,
                stream: true
            };
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

            // The reply stream gets its own deadline: a stream that stalls must never keep the call waiting forever.
            streamTimer = setTimeout(() => controller.abort(), timeoutMs);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let sseBuffer = '';
            let fullText = '';
            let spokenBuffer = '';
            let inSpokenQuote = false;
            let emittedSentences = [];
            let firstTokenMs = null;
            const startTime = performance.now();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                sseBuffer += decoder.decode(value, { stream: true });
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr === '[DONE]') break;

                    try {
                        const event = JSON.parse(jsonStr);
                        if (event.type === 'content_block_delta' && event.delta?.text) {
                            const chunk = event.delta.text;
                            if (firstTokenMs === null) {
                                firstTokenMs = Math.round(performance.now() - startTime);
                            }
                            fullText += chunk;
                            if (typeof onToken === 'function') {
                                try { onToken(chunk, firstTokenMs); } catch (_) {}
                            }

                            if (!inSpokenQuote) {
                                const match = fullText.match(/"spoken_response"\s*:\s*"/);
                                if (match) {
                                    inSpokenQuote = true;
                                    const startIdx = fullText.indexOf(match[0]) + match[0].length;
                                    spokenBuffer = fullText.slice(startIdx);
                                }
                            } else {
                                const endQuoteIdx = chunk.indexOf('"');
                                if (endQuoteIdx !== -1) {
                                    spokenBuffer += chunk.slice(0, endQuoteIdx);
                                    inSpokenQuote = false;
                                    const remaining = spokenBuffer.trim();
                                    if (remaining.length > 0 && typeof onSpokenSentence === 'function') {
                                        emittedSentences.push(remaining);
                                        try { onSpokenSentence(remaining, emittedSentences.length === 1, true); } catch (_) {}
                                    }
                                } else {
                                    spokenBuffer += chunk;
                                    const sentenceMatch = spokenBuffer.match(/^([\s\S]+?[.?!])\s+([\s\S]*)$/);
                                    if (sentenceMatch) {
                                        const sentence = sentenceMatch[1].trim();
                                        spokenBuffer = sentenceMatch[2];
                                        if (sentence.length > 0 && typeof onSpokenSentence === 'function') {
                                            emittedSentences.push(sentence);
                                            try { onSpokenSentence(sentence, emittedSentences.length === 1, false); } catch (_) {}
                                        }
                                    }
                                }
                            }
                        }
                    } catch (_) {}
                }
            }

            return {
                text: fullText,
                firstTokenMs: firstTokenMs || Math.round(performance.now() - startTime),
                emittedSentences
            };
        } finally {
            clearTimeout(timer);
            if (streamTimer) clearTimeout(streamTimer);
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
