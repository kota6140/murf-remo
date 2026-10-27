import MurfService from '../services/murf_service.js';
import assert from 'assert';

console.log('Testing MurfService textToSpeech:');
console.log('isConfigured:', MurfService.isConfigured());
console.log('Voice ID:', MurfService.getVoiceId());
console.log('Model ID:', MurfService.getModelId());

const text = "Hi, this is Remo calling from Scorelabs. Is now a good time to talk?";

let chunkCount = 0;
let totalBytes = 0;
const t0 = Date.now();

const buffer = await MurfService.textToSpeech(text, {
    onChunk: (chunk) => {
        chunkCount++;
        totalBytes += chunk.length;
        if (chunkCount === 1) {
            console.log(`First streaming chunk: ${chunk.length} bytes in ${Date.now() - t0}ms`);
        }
    }
});

const elapsed = Date.now() - t0;
console.log(`TTS complete in ${elapsed}ms. Total chunks: ${chunkCount}, Total bytes: ${totalBytes}`);

assert.ok(buffer && buffer.length > 0, 'Buffer must be valid');
assert.strictEqual(buffer.length, totalBytes, 'Buffer length must match streamed bytes');

// Test RAM cache hit
const t1 = Date.now();
const cached = MurfService.getCachedAudio(text);
const cacheElapsed = Date.now() - t1;
console.log(`RAM Cache Hit: ${cached ? cached.length : 0} bytes in ${cacheElapsed}ms`);
assert.ok(cached && cached.length === buffer.length, 'Cached audio must match generated buffer');
assert.ok(cacheElapsed < 5, 'RAM cache lookup must be under 5ms');

console.log('MURF SERVICE TEST PASSED SUCCESSFULLY!');
