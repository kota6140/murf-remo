// Murf speech-to-text rejects a request without a model ("model is required: finch_global_1.0 or finch_indic_1.0"),
// and each model is served from its own region.
import assert from 'node:assert';
import MurfService from '../services/murf_service.js';

delete process.env.MURF_STT_MODEL;
delete process.env.MURF_STT_WS_URL;
assert.strictEqual(MurfService.getSttModel('en_IN'), 'finch_indic_1.0');
assert.strictEqual(MurfService.getSttModel('hi'), 'finch_indic_1.0');
assert.strictEqual(MurfService.getSttModel('te'), 'finch_indic_1.0');
assert.strictEqual(MurfService.getSttModel('auto'), 'finch_global_1.0');

assert.ok(MurfService.getSttWsUrl('finch_indic_1.0').includes('in.api.murf.ai'));
assert.ok(MurfService.getSttWsUrl('finch_global_1.0').includes('us-east.api.murf.ai'));

process.env.MURF_STT_MODEL = 'finch_global_1.0';
assert.strictEqual(MurfService.getSttModel('te'), 'finch_global_1.0');
delete process.env.MURF_STT_MODEL;

console.log('murf_stt_model: ok');
