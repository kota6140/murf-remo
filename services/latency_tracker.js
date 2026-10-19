/**
 * services/latency_tracker.js
 * 
 * Structured, privacy-conscious performance monitoring for real-time telephone calls.
 * Records timestamps and calculates latency for each stage of the call pipeline:
 * - Call answered -> audio session ready -> first greeting played
 * - Caller speech finalization (VAD)
 * - Speech-to-Text transcription (STT)
 * - Decision making (Intent fast-path vs. Gemini LLM)
 * - Text-to-Speech synthesis (TTS) & audio dispatch
 * - Total caller-turn response latency (VAD to first playable audio)
 * 
 * Computes min, max, p50, and p95 across turns.
 */

export default class LatencyTracker {
    constructor(callId) {
        this.callId = callId;
        this.callAnsweredTime = Date.now();
        this.sessionReadyTime = null;
        this.firstGreetingStartedTime = null;
        this.firstGreetingDeliveredTime = null;

        this.turns = [];
        this.currentTurn = null;
    }

    markSessionReady() {
        this.sessionReadyTime = Date.now();
        const startupDelay = this.sessionReadyTime - this.callAnsweredTime;
        console.log(`[LATENCY] Call ${this.callId}: Session ready in ${startupDelay}ms after connect.`);
    }

    markGreetingStart() {
        this.firstGreetingStartedTime = Date.now();
    }

    markGreetingDelivered() {
        this.firstGreetingDeliveredTime = Date.now();
        const greetingDelay = this.firstGreetingDeliveredTime - this.callAnsweredTime;
        console.log(`[LATENCY] Call ${this.callId}: FIRST GREETING DELIVERED in ${greetingDelay}ms total.`);
    }

    startTurn(turnIndex = null) {
        this.currentTurn = {
            turnIndex: turnIndex !== null ? turnIndex : (this.turns.length + 1),
            turnStartTime: Date.now(),
            speechEndpointDetectedTime: null,
            vadSilenceDetectedTime: null,
            // null = not measured. A missing measurement is never reported as 0.
            vadDurationMs: null,
            sttStartTime: null,
            sttEndTime: null,
            sttDurationMs: null,
            decisionStartTime: null,
            decisionEndTime: null,
            decisionDurationMs: null,
            decisionType: 'UNKNOWN',
            ttsStartTime: null,
            ttsFirstByteTime: null,
            ttsEndTime: null,
            ttsDurationMs: null,
            isTtsCached: false,
            firstAudioSentTime: null,
            audioDispatchedTime: null,
            playbackCompletedTime: null,
            endpointToFirstAudioMs: null,
            totalTurnLatencyMs: null
        };
    }

    cancelTurn() {
        this.currentTurn = null;
    }

    markSpeechEndpointDetected() {
        if (!this.currentTurn) this.startTurn();
        this.currentTurn.speechEndpointDetectedTime = Date.now();
    }

    markVadSilence(silenceMs = 280, turnIndex = null) {
        if (!this.currentTurn) this.startTurn(turnIndex);
        this.currentTurn.vadSilenceDetectedTime = Date.now();
        this.currentTurn.speechEndpointDetectedTime = this.currentTurn.speechEndpointDetectedTime || Date.now();
        this.currentTurn.vadDurationMs = silenceMs;
    }

    markSttStart() {
        if (!this.currentTurn) this.startTurn();
        this.currentTurn.sttStartTime = Date.now();
    }

    markSttEnd(transcriptLength = 0) {
        if (!this.currentTurn || !this.currentTurn.sttStartTime) return;
        this.currentTurn.sttEndTime = Date.now();
        this.currentTurn.sttDurationMs = this.currentTurn.sttEndTime - this.currentTurn.sttStartTime;
    }

    markDecisionStart() {
        if (!this.currentTurn) this.startTurn();
        this.currentTurn.decisionStartTime = Date.now();
    }

    markLlmFirstToken() {
        if (!this.currentTurn) return;
        this.currentTurn.llmFirstTokenTime = Date.now();
        if (this.currentTurn.decisionStartTime) {
            this.currentTurn.llmFirstTokenMs = this.currentTurn.llmFirstTokenTime - this.currentTurn.decisionStartTime;
        }
    }

    markDecisionEnd(type = 'GEMINI_LLM') {
        if (!this.currentTurn || !this.currentTurn.decisionStartTime) return;
        this.currentTurn.decisionEndTime = Date.now();
        this.currentTurn.decisionDurationMs = this.currentTurn.decisionEndTime - this.currentTurn.decisionStartTime;
        this.currentTurn.decisionType = type;
    }

    markTtsStart() {
        if (!this.currentTurn) this.startTurn();
        this.currentTurn.ttsStartTime = Date.now();
    }

    markTtsFirstByte() {
        if (!this.currentTurn) return;
        this.currentTurn.ttsFirstByteTime = Date.now();
    }

    markTtsEnd(isCached = false) {
        if (!this.currentTurn || !this.currentTurn.ttsStartTime) return;
        this.currentTurn.ttsEndTime = Date.now();
        // Audio taken from the cache was not synthesised, so there is no synthesis time to report.
        this.currentTurn.ttsDurationMs = isCached ? null : (this.currentTurn.ttsEndTime - this.currentTurn.ttsStartTime);
        this.currentTurn.isTtsCached = isCached;
    }

    markFirstAudioChunkSent() {
        if (!this.currentTurn) return;
        if (!this.currentTurn.firstAudioSentTime) {
            this.currentTurn.firstAudioSentTime = Date.now();
            if (!this.currentTurn.ttsFirstByteTime) {
                this.currentTurn.ttsFirstByteTime = this.currentTurn.firstAudioSentTime;
            }
            const endpoint = this.currentTurn.speechEndpointDetectedTime || this.currentTurn.vadSilenceDetectedTime || this.currentTurn.turnStartTime;
            this.currentTurn.endpointToFirstAudioMs = this.currentTurn.firstAudioSentTime - endpoint;
        }
    }

    markAudioDispatched() {
        if (!this.currentTurn) return;
        this.currentTurn.audioDispatchedTime = Date.now();
        // No audio was sent for this turn (text-to-speech failed, or the reply was cancelled): the first-audio
        // time stays unmeasured instead of being invented from the dispatch time.

        const t = this.currentTurn;
        // From the moment the caller's silence began to the first audio of the reply sent to Plivo.
        // Only computed when both ends were really measured; otherwise it stays null.
        if (t.firstAudioSentTime && t.vadSilenceDetectedTime && typeof t.vadDurationMs === 'number') {
            t.totalTurnLatencyMs = t.vadDurationMs + (t.firstAudioSentTime - t.vadSilenceDetectedTime);
        }
        t.plivoFirstAudioDeliveryMs = t.endpointToFirstAudioMs;
        t.vadLatencyMs = t.vadDurationMs;
        t.endOfTurnDetectionMs = t.vadDurationMs;
        t.intentLatencyMs = t.decisionType.includes('INTENT') ? t.decisionDurationMs : null;
        t.llmTimeToFirstTokenMs = typeof t.llmFirstTokenMs === 'number' ? t.llmFirstTokenMs : null;
        t.ttsTimeToFirstAudioMs = (t.ttsStartTime && t.ttsFirstByteTime && !t.isTtsCached) ? (t.ttsFirstByteTime - t.ttsStartTime) : null;

        const fmt = (v) => (typeof v === 'number' ? `${v}ms` : 'n/a');
        console.log(
            `[LATENCY] Call ${this.callId} [Turn ${t.turnIndex}]: ` +
            `VAD=${fmt(t.vadDurationMs)} | ` +
            `STT=${fmt(t.sttDurationMs)} | ` +
            `Decision=${fmt(t.decisionDurationMs)} (${t.decisionType}${typeof t.llmFirstTokenMs === 'number' ? `, TTFT: ${t.llmFirstTokenMs}ms` : ''}) | ` +
            `TTS=${t.isTtsCached ? 'cached' : fmt(t.ttsDurationMs)}${t.ttsTimeToFirstAudioMs !== null ? ` (first audio ${t.ttsTimeToFirstAudioMs}ms)` : ''} | ` +
            `EndpointToFirstAudio=${fmt(t.endpointToFirstAudioMs)} | ` +
            `TOTAL=${fmt(t.totalTurnLatencyMs)}`
        );

        // Structured audit record as specified in PART 10
        console.log(`[LATENCY_STRUCTURED] ${JSON.stringify({
            callId: this.callId,
            turnId: t.turnIndex,
            decisionType: t.decisionType,
            vadLatencyMs: t.vadLatencyMs,
            sttLatencyMs: t.sttDurationMs,
            decisionLatencyMs: t.decisionDurationMs,
            llmTimeToFirstTokenMs: t.llmTimeToFirstTokenMs,
            ttsTimeToFirstAudioMs: t.ttsTimeToFirstAudioMs,
            endpointToFirstAudioMs: t.endpointToFirstAudioMs,
            totalTurnLatencyMs: t.totalTurnLatencyMs
        })}`);

        this.turns.push({ ...this.currentTurn });
        this.currentTurn = null;
    }

    getSummary() {
        const totalGreetingDelay = this.firstGreetingDeliveredTime
            ? (this.firstGreetingDeliveredTime - this.callAnsweredTime)
            : null;

        const count = this.turns.length;
        // Only turns whose total was really measured count toward the statistics.
        const latencies = this.turns
            .map(t => t.totalTurnLatencyMs)
            .filter(v => typeof v === 'number')
            .sort((a, b) => a - b);
        const measured = latencies.length;

        const p50 = measured > 0 ? latencies[Math.floor(measured * 0.5)] : null;
        const p95 = measured > 0 ? latencies[Math.min(measured - 1, Math.floor(measured * 0.95))] : null;
        const min = measured > 0 ? latencies[0] : null;
        const max = measured > 0 ? latencies[measured - 1] : null;

        const fastPathCount = this.turns.filter(t => t.decisionType && t.decisionType.includes('INTENT')).length;
        const llmCount = this.turns.filter(t => t.decisionType && (
            t.decisionType.includes('LLM') ||
            t.decisionType.includes('GEMINI') ||
            t.decisionType.includes('CLAUDE')
        )).length;

        return {
            callId: this.callId,
            turnsCount: count,
            measuredTurns: measured,
            firstGreetingDelayMs: totalGreetingDelay,
            p50Ms: p50,
            p95Ms: p95,
            minMs: min,
            maxMs: max,
            fastPathCount,
            llmCount
        };
    }

    logFinalSummary() {
        const s = this.getSummary();
        const fmt = (v) => (typeof v === 'number' ? `${v}ms` : 'n/a');
        console.log(
            `[LATENCY_REPORT] Call ${s.callId} Finalized: ` +
            `Greeting=${fmt(s.firstGreetingDelayMs)} | ` +
            `Turns=${s.turnsCount} (measured: ${s.measuredTurns}, FastPath: ${s.fastPathCount}, LLM: ${s.llmCount}) | ` +
            `p50=${fmt(s.p50Ms)} | p95=${fmt(s.p95Ms)} | Min=${fmt(s.minMs)} | Max=${fmt(s.maxMs)}`
        );
    }
}
