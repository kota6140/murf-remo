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

    startTurn() {
        this.currentTurn = {
            turnIndex: this.turns.length + 1,
            turnStartTime: Date.now(),
            vadSilenceDetectedTime: null,
            vadDurationMs: 0,
            sttStartTime: null,
            sttEndTime: null,
            sttDurationMs: 0,
            decisionStartTime: null,
            decisionEndTime: null,
            decisionDurationMs: 0,
            decisionType: 'UNKNOWN',
            ttsStartTime: null,
            ttsEndTime: null,
            ttsDurationMs: 0,
            isTtsCached: false,
            audioDispatchedTime: null,
            totalTurnLatencyMs: 0
        };
    }

    markVadSilence(silenceMs = 360) {
        if (!this.currentTurn) this.startTurn();
        this.currentTurn.vadSilenceDetectedTime = Date.now();
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

    markTtsEnd(isCached = false) {
        if (!this.currentTurn || !this.currentTurn.ttsStartTime) return;
        this.currentTurn.ttsEndTime = Date.now();
        this.currentTurn.ttsDurationMs = isCached ? 0 : (this.currentTurn.ttsEndTime - this.currentTurn.ttsStartTime);
        this.currentTurn.isTtsCached = isCached;
    }

    markAudioDispatched() {
        if (!this.currentTurn) return;
        this.currentTurn.audioDispatchedTime = Date.now();

        const baseTime = this.currentTurn.vadSilenceDetectedTime || this.currentTurn.turnStartTime;
        this.currentTurn.totalTurnLatencyMs = this.currentTurn.audioDispatchedTime - baseTime;

        const t = this.currentTurn;
        console.log(
            `[LATENCY] Call ${this.callId} [Turn ${t.turnIndex}]: ` +
            `VAD=${t.vadDurationMs}ms | ` +
            `STT=${t.sttDurationMs}ms | ` +
            `Decision=${t.decisionDurationMs}ms (${t.decisionType}) | ` +
            `TTS=${t.ttsDurationMs}ms${t.isTtsCached ? ' (CACHED)' : ''} | ` +
            `TOTAL=${t.totalTurnLatencyMs}ms`
        );

        this.turns.push({ ...this.currentTurn });
        this.currentTurn = null;
    }

    getSummary() {
        const totalGreetingDelay = this.firstGreetingDeliveredTime
            ? (this.firstGreetingDeliveredTime - this.callAnsweredTime)
            : null;

        const count = this.turns.length;
        const latencies = this.turns
            .map(t => t.totalTurnLatencyMs)
            .sort((a, b) => a - b);

        const p50 = count > 0 ? latencies[Math.floor(count * 0.5)] : 0;
        const p95 = count > 0 ? latencies[Math.floor(count * 0.95)] : 0;
        const min = count > 0 ? latencies[0] : 0;
        const max = count > 0 ? latencies[count - 1] : 0;

        const fastPathCount = this.turns.filter(t => t.decisionType.includes('INTENT')).length;
        const llmCount = this.turns.filter(t => t.decisionType.includes('GEMINI')).length;

        return {
            callId: this.callId,
            turnsCount: count,
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
        console.log(
            `[LATENCY_REPORT] Call ${s.callId} Finalized: ` +
            `Greeting=${s.firstGreetingDelayMs || 0}ms | ` +
            `Turns=${s.turnsCount} (FastPath: ${s.fastPathCount}, LLM: ${s.llmCount}) | ` +
            `p50=${s.p50Ms}ms | p95=${s.p95Ms}ms | Min=${s.minMs}ms | Max=${s.maxMs}ms`
        );
    }
}
