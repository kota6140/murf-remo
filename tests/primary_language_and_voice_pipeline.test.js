/**
 * Primary Language & AI Voice Configuration Test Suite
 * Validates end-to-end integration:
 * - Environment variables and secrets protection
 * - Voice Registry & 7 supported primary languages
 * - Exact 4 voices (Pooja, Abhinav, Samar, Abirami)
 * - Strict compatibility matrix and rejection of invalid combinations
 * - Campaign persistence and backward compatibility
 * - Live call pipeline voice & language propagation
 * - Safe preview generation without telephony
 */

import 'dotenv/config';
import assert from 'assert';
import { VoiceRegistry } from '../services/voice_registry.js';
import MurfService from '../services/murf_service.js';
import CampaignService from '../services/campaign_service.js';
import db, { ensureCampaignSchema } from '../services/db.js';
import { CallSession } from '../services/voicebot_stream_service.js';

async function runTests() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING PRIMARY LANGUAGE & AI VOICE INTEGRATION TEST SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}`);
      console.error(err);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}`);
      console.error(err);
    }
  }

  // --------------------------------------------------------------------------
  // 1. Environment Variables & Safe Resolution
  // --------------------------------------------------------------------------
  test('1. Existing Pooja configuration loads correctly from .env without renaming', () => {
    const pooja = VoiceRegistry.getVoiceConfig('pooja');
    assert(pooja, 'Pooja voice must exist in VoiceRegistry');
    assert.strictEqual(pooja.name, 'Pooja');
    assert.strictEqual(pooja.gender, 'Female Voice');
    assert(pooja.voiceId, 'Pooja must resolve a valid voiceId');
    assert(pooja.isDefault, 'Pooja must be configured as default voice');
  });

  test('2. Abhinav, Samar, and Abirami are registered and have provider voice IDs', () => {
    const abhinav = VoiceRegistry.getVoiceConfig('abhinav');
    const samar = VoiceRegistry.getVoiceConfig('samar');
    const abirami = VoiceRegistry.getVoiceConfig('abirami');

    assert(abhinav, 'Abhinav voice must exist');
    assert.strictEqual(abhinav.gender, 'Male Voice');
    assert.strictEqual(abhinav.voiceId, 'en-IN-abhinav');

    assert(samar, 'Samar voice must exist');
    assert.strictEqual(samar.gender, 'Male Voice');
    assert.strictEqual(samar.voiceId, 'en-IN-samar');

    assert(abirami, 'Abirami voice must exist');
    assert.strictEqual(abirami.gender, 'Female Voice');
    assert.strictEqual(abirami.voiceId, 'ta-IN-abirami');
  });

  test('3. API keys and internal secrets are NEVER exposed in client-facing public config', () => {
    const publicConfig = VoiceRegistry.getPublicConfig();
    assert(publicConfig.voices && publicConfig.voices.length === 4, 'Must return exactly 4 public voices');
    assert(publicConfig.languages && publicConfig.languages.length === 7, 'Must return exactly 7 languages');

    // Convert to JSON and assert no secrets or env vars leaked
    const jsonStr = JSON.stringify(publicConfig);
    if (process.env.MURF_API_KEY) assert(!jsonStr.includes(process.env.MURF_API_KEY), 'Murf API key must never be exposed');
    if (process.env.TWILIO_AUTH_TOKEN) assert(!jsonStr.includes(process.env.TWILIO_AUTH_TOKEN), 'Twilio token must not be exposed');
    if (process.env.PLIVO_AUTH_ID) assert(!jsonStr.includes(process.env.PLIVO_AUTH_ID), 'Plivo secret must not be exposed');
    
    // Verify voice items in public config only contain safe metadata
    publicConfig.voices.forEach(v => {
      assert(v.key, 'Voice must have key');
      assert(v.name, 'Voice must have name');
      assert(v.gender, 'Voice must have gender');
      assert(Array.isArray(v.supportedLocales), 'Voice must list supportedLocales');
      assert(!v.voiceId, 'Internal provider voiceId should be hidden from public config');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Language & Voice Compatibility Matrix
  // --------------------------------------------------------------------------
  test('4. Language and Voice compatibility matrix behaves accurately', () => {
    // Telugu (te-IN)
    assert(VoiceRegistry.isLocaleSupported('pooja', 'te-IN'), 'Pooja must support Telugu');
    assert(VoiceRegistry.isLocaleSupported('samar', 'te-IN'), 'Samar must support Telugu');
    assert(VoiceRegistry.isLocaleSupported('abirami', 'te-IN'), 'Abirami must support Telugu');
    assert(!VoiceRegistry.isLocaleSupported('abhinav', 'te-IN'), 'Abhinav must NOT support Telugu');

    // English (en-IN)
    assert(VoiceRegistry.isLocaleSupported('pooja', 'en-IN'), 'Pooja must support English');
    assert(VoiceRegistry.isLocaleSupported('abhinav', 'en-IN'), 'Abhinav must support English');
    assert(VoiceRegistry.isLocaleSupported('samar', 'en-IN'), 'Samar must support English');
    assert(!VoiceRegistry.isLocaleSupported('abirami', 'en-IN'), 'Abirami must NOT support English');

    // Hindi (hi-IN) - supported by all 4
    assert(VoiceRegistry.isLocaleSupported('pooja', 'hi-IN'), 'Pooja must support Hindi');
    assert(VoiceRegistry.isLocaleSupported('abhinav', 'hi-IN'), 'Abhinav must support Hindi');
    assert(VoiceRegistry.isLocaleSupported('samar', 'hi-IN'), 'Samar must support Hindi');
    assert(VoiceRegistry.isLocaleSupported('abirami', 'hi-IN'), 'Abirami must support Hindi');

    // Malayalam (ml-IN) - Abhinav only
    assert(VoiceRegistry.isLocaleSupported('abhinav', 'ml-IN'), 'Abhinav must support Malayalam');
    assert(!VoiceRegistry.isLocaleSupported('pooja', 'ml-IN'), 'Pooja must NOT support Malayalam');

    // Rejection of unknown voice or unknown locale
    assert(!VoiceRegistry.isLocaleSupported('unknown_voice', 'en-IN'), 'Unknown voice must be rejected');
    assert(!VoiceRegistry.isLocaleSupported('pooja', 'fr-FR'), 'Unsupported locale must be rejected');
  });

  // --------------------------------------------------------------------------
  // 3. Campaign Persistence & Retrieval
  // --------------------------------------------------------------------------
  await testAsync('5. Campaign persistence preserves language and voice configuration', async () => {
    await ensureCampaignSchema();

    // Create campaign with Telugu + Pooja
    const created = await CampaignService.createCampaign({
      name: `Test Telugu Pooja ${Date.now()}`,
      service: 'recruitment',
      primary_language: 'te-IN',
      primary_locale: 'te-IN',
      voice_id: 'pooja',
      voice_provider: 'murf',
      voice_model: 'falcon-2.1'
    });

    assert(created && created.id, 'Campaign creation must succeed');
    assert.strictEqual(created.primary_language, 'te-IN');
    assert.strictEqual(created.primary_locale, 'te-IN');
    assert.strictEqual(created.voice_id, 'pooja');
    assert.strictEqual(created.voice_model, 'falcon-2.1');

    // Fetch back via getCampaign
    const fetched = await CampaignService.getCampaign(created.id);
    assert.strictEqual(fetched.primary_language, 'te-IN');
    assert.strictEqual(fetched.primary_locale, 'te-IN');
    assert.strictEqual(fetched.voice_id, 'pooja');

    // Update campaign to Hindi + Samar
    const updated = await CampaignService.updateCampaign(created.id, {
      primary_language: 'hi-IN',
      primary_locale: 'hi-IN',
      voice_id: 'samar'
    });
    assert.strictEqual(updated.primary_language, 'hi-IN');
    assert.strictEqual(updated.primary_locale, 'hi-IN');
    assert.strictEqual(updated.voice_id, 'samar');

    // Verify Campaign Context restores voice and language
    const context = await CampaignService.getCampaignContext(created.id);
    assert.strictEqual(context.primary_language, 'hi-IN');
    assert.strictEqual(context.primary_locale, 'hi-IN');
    assert.strictEqual(context.voice_id, 'samar');
  });

  await testAsync('6. Rejection of unsupported voice and language combination on campaign creation & launch', async () => {
    // Attempting to create a campaign with invalid combination (Abhinav + Telugu) must immediately reject
    let createError = null;
    try {
      await CampaignService.createCampaign({
        name: `Invalid Comb Camp ${Date.now()}`,
        service: 'recruitment',
        primary_language: 'te-IN',
        primary_locale: 'te-IN',
        voice_id: 'abhinav'
      });
    } catch (err) {
      createError = err;
    }

    assert(createError, 'Campaign creation with incompatible voice must fail');
    assert(createError.message.includes('not support') || createError.message.includes('not compatible'),
      `Error message must explain incompatibility, got: ${createError?.message}`);

    // Validation function directly rejects
    const val = VoiceRegistry.validateVoiceAndLocale('abhinav', 'te-IN');
    assert.strictEqual(val.valid, false, 'VoiceRegistry must reject Abhinav for Telugu');
  });

  await testAsync('7. Backward compatibility defaults for legacy campaigns', async () => {
    // Legacy campaign with no language or voice fields
    const legacyCamp = await CampaignService.createCampaign({
      name: `Legacy Campaign ${Date.now()}`,
      service: 'sales'
    });

    const context = await CampaignService.getCampaignContext(legacyCamp.id);
    assert.strictEqual(context.primary_language, 'en-IN', 'Default language must be en-IN');
    assert.strictEqual(context.primary_locale, 'en-IN', 'Default locale must be en-IN');
    assert.strictEqual(context.voice_id, 'pooja', 'Default voice must be Pooja');
    assert.strictEqual(context.voice_provider, 'murf', 'Default provider must be Murf');
  });

  // --------------------------------------------------------------------------
  // 4. Live Call Session Voice Resolution
  // --------------------------------------------------------------------------
  test('8. Call Session picks and resolves correct voice ID and model from Campaign Context', () => {
    // Simulate session with Telugu + Samar
    const mockSession = new CallSession('ws_mock_session');
    mockSession.campaignContext = {
      primary_language: 'te-IN',
      primary_locale: 'te-IN',
      voice_id: 'samar',
      voice_provider: 'murf',
      voice_model: 'falcon-2.1'
    };

    const resolved = mockSession.pickVoiceConfig();
    assert.strictEqual(resolved.voiceId, 'en-IN-samar', 'Must resolve to Samar voice ID');
    assert.strictEqual(resolved.model, 'falcon-2.1', 'Must resolve Falcon 2.1 model');
    assert.strictEqual(resolved.locale, 'te-IN', 'Must preserve campaign locale');
    assert.strictEqual(mockSession.pickVoiceId(), 'en-IN-samar');
  });

  // --------------------------------------------------------------------------
  // 5. Audio Preview Generation
  // --------------------------------------------------------------------------
  await testAsync('9. Audio Preview generates valid PCM WAV audio without phone calls', async () => {
    // Generate preview sample for Telugu + Pooja
    const previewText = VoiceRegistry.getPreviewText('te-IN');
    assert(previewText && previewText.length > 5, 'Preview text for Telugu must exist');

    const voiceConfig = VoiceRegistry.getVoiceConfig('pooja');
    const mulawBuffer = await MurfService.textToSpeech(previewText, {
      voiceId: voiceConfig.voiceId,
      model: voiceConfig.model,
      locale: 'te-IN'
    });

    assert(mulawBuffer && mulawBuffer.length > 0, 'Audio generation must return buffer');

    // Convert mu-law to standard 16-bit linear PCM WAV for browser playback
    const wavBuffer = VoiceRegistry.mulawBufferToPcmWav(mulawBuffer, 8000);
    assert(wavBuffer && wavBuffer.length > 44, 'WAV buffer must be created with header');
    assert.strictEqual(wavBuffer.toString('ascii', 0, 4), 'RIFF', 'WAV header must start with RIFF');
    assert.strictEqual(wavBuffer.toString('ascii', 8, 12), 'WAVE', 'WAV header format must be WAVE');
  });

  console.log('\n===============================================================');
  console.log(`📊 RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log('===============================================================\n');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
