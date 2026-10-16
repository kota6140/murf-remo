import { makeServiceCampaign } from './service_campaign_factory.js';

/** Appointment setting: contact sheet upload and start-calling (the call script lives in gemini_service.js). */
export default makeServiceCampaign({
    service: 'appointment',
    startMessage: 'Appointment-setting campaign initialized. REMO agent starting booking calls immediately.'
});
