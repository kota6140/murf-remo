import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_FILE = path.resolve(__dirname, '..', '.env');

function getDynamicEnv() {
    try {
        if (fs.existsSync(ENV_FILE)) {
            return dotenv.parse(fs.readFileSync(ENV_FILE, 'utf-8'));
        }
    } catch (_) {}
    return {};
}

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
    static getOpenAIApiKey() {
        const fileEnv = getDynamicEnv();
        return (process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY || fileEnv.OPENAI_API_KEY || fileEnv.OPEN_API_KEY || '').trim();
    }

    static getOpenAIModel() {
        const fileEnv = getDynamicEnv();
        return (process.env.OPENAI_MODEL || fileEnv.OPENAI_MODEL || 'gpt-6 luna batch 50%').trim();
    }

    static getClaudeApiKey() {
        const fileEnv = getDynamicEnv();
        return (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || fileEnv.ANTHROPIC_API_KEY || fileEnv.CLAUDE_API_KEY || '').trim();
    }

    static getGeminiApiKey() {
        const fileEnv = getDynamicEnv();
        return (process.env.GEMINI_API_KEY || fileEnv.GEMINI_API_KEY || '').trim();
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
        return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    }

    static getActiveProvider() {
        if (this.getOpenAIApiKey()) return 'openai';
        if (this.getClaudeApiKey()) return 'claude';
        if (this.getGeminiApiKey()) return 'gemini';
        return 'none';
    }

    /**
     * Executes a completion using OpenAI primary with Anthropic Claude Haiku fallback.
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
        const openAiKey = this.getOpenAIApiKey();
        const claudeKey = this.getClaudeApiKey();
        const geminiKey = this.getGeminiApiKey();

        // 1. Primary: OpenAI
        if (openAiKey) {
            const openAiModel = this.getOpenAIModel();
            try {
                const res = await this._callOpenAI({
                    apiKey: openAiKey,
                    model: openAiModel,
                    systemPrompt,
                    messages,
                    maxTokens,
                    temperature,
                    timeoutMs
                });
                const latencyMs = Math.round(performance.now() - startTime);
                if (res && res.text && res.text.trim()) {
                    let parsedJson = null;
                    if (jsonMode) {
                        parsedJson = this.extractJson(res.text);
                    }
                    return {
                        text: res.text.trim(),
                        parsedJson,
                        provider: 'openai',
                        model: openAiModel,
                        latencyMs,
                        fallback: false
                    };
                }
            } catch (openAiErr) {
                console.warn(`[LLMService] OpenAI primary error (${openAiErr.message}). Triggering Anthropic fallback...`);
            }
        }

        // 2. Fallback: Anthropic Claude Haiku 5.5
        if (claudeKey) {
            const claudeModel = this.getClaudeModel();
            try {
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
                        fallback: Boolean(openAiKey)
                    };
                }
            } catch (claudeErr) {
                console.warn(`[LLMService] Claude API error: ${claudeErr.message}`);
            }
        }

        // 3. Fallback: Gemini (if configured)
        if (geminiKey) {
            const geminiModel = this.getGeminiModel();
            try {
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
                console.warn(`[LLMService] Gemini fallback error: ${geminiErr.message}`);
            }
        }

        const elapsed = Math.round(performance.now() - startTime);
        return {
            text: '',
            parsedJson: null,
            provider: 'none',
            model: 'none',
            latencyMs: elapsed,
            fallback: true,
            error: 'All configured LLM providers failed.'
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
        const openAiKey = this.getOpenAIApiKey();
        const claudeKey = this.getClaudeApiKey();

        // 1. Primary: OpenAI Stream
        if (openAiKey) {
            try {
                const openAiModel = this.getOpenAIModel();
                const openAiResult = await this._callOpenAIStream({
                    apiKey: openAiKey,
                    model: openAiModel,
                    systemPrompt,
                    messages,
                    maxTokens,
                    temperature,
                    timeoutMs,
                    onToken,
                    onSpokenSentence
                });

                const latencyMs = Math.round(performance.now() - startTime);
                if (openAiResult && openAiResult.text && openAiResult.text.trim()) {
                    let parsedJson = null;
                    if (jsonMode) {
                        parsedJson = this.extractJson(openAiResult.text);
                    }
                    return {
                        text: openAiResult.text.trim(),
                        parsedJson,
                        provider: 'openai',
                        model: openAiModel,
                        latencyMs,
                        firstTokenMs: openAiResult.firstTokenMs,
                        emittedSentences: openAiResult.emittedSentences || [],
                        fallback: false
                    };
                }
            } catch (openAiErr) {
                console.warn(`[LLMService] OpenAI streaming error (${openAiErr.message}). Triggering Anthropic Claude fallback...`);
            }
        }

        // 2. Fallback: Anthropic Claude Haiku Stream
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
                        fallback: Boolean(openAiKey)
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
     * Direct OpenAI REST API call
     */
    static async _callOpenAI({ apiKey, model, systemPrompt, messages, maxTokens, temperature, timeoutMs }) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const openAiMessages = [];
        if (systemPrompt && systemPrompt.trim()) {
            openAiMessages.push({ role: 'system', content: systemPrompt.trim() });
        }
        for (const m of messages) {
            openAiMessages.push({
                role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
            });
        }
        if (openAiMessages.length === 0 || (openAiMessages.length === 1 && openAiMessages[0].role === 'system')) {
            openAiMessages.push({ role: 'user', content: 'Begin conversation.' });
        }

        try {
            const bodyPayload = {
                model,
                messages: openAiMessages,
                max_tokens: maxTokens
            };
            if (typeof temperature === 'number') {
                bodyPayload.temperature = temperature;
            }

            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bodyPayload),
                signal: controller.signal
            });

            clearTimeout(timer);
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 150)}`);
            }

            const data = await res.json();
            const text = data.choices?.[0]?.message?.content || '';
            return { text };
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Streams OpenAI completion with early extraction of spoken dialogue.
     */
    static async _callOpenAIStream({
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

        const openAiMessages = [];
        if (systemPrompt && systemPrompt.trim()) {
            openAiMessages.push({ role: 'system', content: systemPrompt.trim() });
        }
        for (const m of messages) {
            openAiMessages.push({
                role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
            });
        }
        if (openAiMessages.length === 0 || (openAiMessages.length === 1 && openAiMessages[0].role === 'system')) {
            openAiMessages.push({ role: 'user', content: 'Begin conversation.' });
        }

        try {
            const bodyPayload = {
                model,
                messages: openAiMessages,
                max_tokens: maxTokens,
                stream: true
            };
            if (typeof temperature === 'number') {
                bodyPayload.temperature = temperature;
            }

            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bodyPayload),
                signal: controller.signal
            });

            clearTimeout(timer);
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 150)}`);
            }

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
                        const chunk = event.choices?.[0]?.delta?.content;
                        if (chunk) {
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
