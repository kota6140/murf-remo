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
        const now = performance.now();
        this.currentTurn = {
            turnIndex: turnIndex !== null ? turnIndex : (this.turns.length + 1),
            turnStartTime: now,
            callerSpeechStartedTime: now,
            sttSessionReadyTime: null,
            speechEndpointDetectedTime: null,
            vadSilenceDetectedTime: null,
            vadDurationMs: null,
            sttStartTime: null,
            sttFinalizeSentTime: null,
            sttEndTime: null,
            sttDurationMs: null,
            sttFinalizeDurationMs: null,
            decisionStartTime: null,
            decisionEndTime: null,
            decisionDurationMs: null,
            decisionType: 'UNKNOWN',
            llmFirstTokenTime: null,
            llmFirstTokenMs: null,
            firstSafePhraseReadyTime: null,
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

    markCallerSpeechStarted() {
        if (!this.currentTurn) this.startTurn();
        this.currentTurn.callerSpeechStartedTime = performance.now();
    }

    markSttSessionReady(connectDurationMs = null) {
        if (!this.currentTurn) return;
        this.currentTurn.sttSessionReadyTime = performance.now();
        if (typeof connectDurationMs === 'number') {
            this.currentTurn.sttConnectDurationMs = connectDurationMs;
        }
    }

    markSpeechEndpointDetected() {
        if (!this.currentTurn) this.startTurn();
        this.currentTurn.speechEndpointDetectedTime = performance.now();
    }

    markVadSilence(silenceMs = 300, turnIndex = null) {
        if (!this.currentTurn) this.startTurn(turnIndex);
        const now = performance.now();
        this.currentTurn.vadSilenceDetectedTime = now;
        this.currentTurn.speechEndpointDetectedTime = this.currentTurn.speechEndpointDetectedTime || now;
        this.currentTurn.vadDurationMs = Math.round(silenceMs);
    }

    markSttStart() {
        if (!this.currentTurn) this.startTurn();
        if (!this.currentTurn.sttStartTime) {
            this.currentTurn.sttStartTime = performance.now();
        }
    }

    markSttFinalizeSent() {
        if (!this.currentTurn) this.startTurn();
        this.currentTurn.sttFinalizeSentTime = performance.now();
        if (!this.currentTurn.sttStartTime) {
            this.currentTurn.sttStartTime = this.currentTurn.sttFinalizeSentTime;
        }
    }

    markSttEnd(transcriptLength = 0, finalizeDurationMs = null) {
        if (!this.currentTurn) return;
        const now = performance.now();
        this.currentTurn.sttEndTime = now;
        if (typeof finalizeDurationMs === 'number') {
            this.currentTurn.sttFinalizeDurationMs = Math.round(finalizeDurationMs);
        } else if (this.currentTurn.sttFinalizeSentTime) {
            this.currentTurn.sttFinalizeDurationMs = Math.max(0, Math.round(now - this.currentTurn.sttFinalizeSentTime));
        }
        if (this.currentTurn.sttStartTime) {
            this.currentTurn.sttDurationMs = Math.max(0, Math.round(now - this.currentTurn.sttStartTime));
        } else if (this.currentTurn.sttFinalizeDurationMs !== null) {
            this.currentTurn.sttDurationMs = this.currentTurn.sttFinalizeDurationMs;
        }
    }

    markDecisionStart() {
        if (!this.currentTurn) this.startTurn();
        this.currentTurn.decisionStartTime = performance.now();
    }

    markLlmFirstToken() {
        if (!this.currentTurn) return;
        if (!this.currentTurn.llmFirstTokenTime) {
            this.currentTurn.llmFirstTokenTime = performance.now();
            if (this.currentTurn.decisionStartTime) {
                this.currentTurn.llmFirstTokenMs = Math.max(0, Math.round(this.currentTurn.llmFirstTokenTime - this.currentTurn.decisionStartTime));
            }
        }
    }

    markFirstSafePhraseReady() {
        if (!this.currentTurn) return;
        if (!this.currentTurn.firstSafePhraseReadyTime) {
            this.currentTurn.firstSafePhraseReadyTime = performance.now();
            if (this.currentTurn.decisionStartTime) {
                this.currentTurn.timeToFirstSafePhraseMs = Math.max(0, Math.round(this.currentTurn.firstSafePhraseReadyTime - this.currentTurn.decisionStartTime));
            }
        }
    }

    markDecisionEnd(type = 'GEMINI_LLM') {
        if (!this.currentTurn || !this.currentTurn.decisionStartTime) return;
        this.currentTurn.decisionEndTime = performance.now();
        this.currentTurn.decisionDurationMs = Math.max(0, Math.round(this.currentTurn.decisionEndTime - this.currentTurn.decisionStartTime));
        this.currentTurn.decisionType = type;
    }

    markTtsStart() {
        if (!this.currentTurn) this.startTurn();
        // Crucial bugfix: Only set ttsStartTime once per turn so multi-sentence turns don't overwrite it with a later time
        if (!this.currentTurn.ttsStartTime) {
            this.currentTurn.ttsStartTime = performance.now();
        }
    }

    markTtsFirstByte() {
        if (!this.currentTurn) return;
        if (!this.currentTurn.ttsFirstByteTime) {
            this.currentTurn.ttsFirstByteTime = performance.now();
        }
    }

    markTtsEnd(isCached = false) {
        if (!this.currentTurn || !this.currentTurn.ttsStartTime) return;
        if (!this.currentTurn.ttsEndTime) {
            this.currentTurn.ttsEndTime = performance.now();
            this.currentTurn.ttsDurationMs = isCached ? 0 : Math.max(0, Math.round(this.currentTurn.ttsEndTime - this.currentTurn.ttsStartTime));
            this.currentTurn.isTtsCached = isCached;
        }
    }

    markFirstAudioChunkSent() {
        if (!this.currentTurn) return;
        if (!this.currentTurn.firstAudioSentTime) {
            this.currentTurn.firstAudioSentTime = performance.now();
            if (!this.currentTurn.ttsFirstByteTime) {
                this.currentTurn.ttsFirstByteTime = this.currentTurn.firstAudioSentTime;
            }
            const endpoint = this.currentTurn.speechEndpointDetectedTime || this.currentTurn.vadSilenceDetectedTime || this.currentTurn.turnStartTime;
            this.currentTurn.endpointToFirstAudioMs = Math.max(0, Math.round(this.currentTurn.firstAudioSentTime - endpoint));
        }
    }

    markAudioDispatched() {
        if (!this.currentTurn) return;
        this.currentTurn.audioDispatchedTime = performance.now();

        const t = this.currentTurn;
        if (t.firstAudioSentTime && t.vadSilenceDetectedTime && typeof t.vadDurationMs === 'number') {
            t.totalTurnLatencyMs = Math.round(t.vadDurationMs + Math.max(0, t.firstAudioSentTime - t.vadSilenceDetectedTime));
        } else if (typeof t.endpointToFirstAudioMs === 'number' && typeof t.vadDurationMs === 'number') {
            t.totalTurnLatencyMs = Math.round(t.vadDurationMs + t.endpointToFirstAudioMs);
        }

        t.plivoFirstAudioDeliveryMs = t.endpointToFirstAudioMs;
        t.vadLatencyMs = t.vadDurationMs;
        t.endOfTurnDetectionMs = t.vadDurationMs;
        t.intentLatencyMs = t.decisionType.includes('INTENT') ? t.decisionDurationMs : null;
        t.llmTimeToFirstTokenMs = typeof t.llmFirstTokenMs === 'number' ? t.llmFirstTokenMs : null;
        t.ttsTimeToFirstAudioMs = (t.ttsStartTime && t.ttsFirstByteTime) ? (t.isTtsCached ? 0 : Math.max(0, Math.round(t.ttsFirstByteTime - t.ttsStartTime))) : null;

        const fmt = (v) => (typeof v === 'number' ? `${v}ms` : 'n/a');
        const sttDetail = t.sttFinalizeDurationMs !== null ? `${t.sttDurationMs}ms (finalize: ${t.sttFinalizeDurationMs}ms)` : fmt(t.sttDurationMs);
        console.log(
            `[LATENCY] Call ${this.callId} [Turn ${t.turnIndex}]: ` +
            `VAD=${fmt(t.vadDurationMs)} | ` +
            `STT=${sttDetail} | ` +
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
            sttFinalizeLatencyMs: t.sttFinalizeDurationMs,
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
