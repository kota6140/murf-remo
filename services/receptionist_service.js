import { makeServiceCampaign } from './service_campaign_factory.js';

/** Receptionist: contact sheet upload and start-calling for outgoing follow-up calls (incoming calls need no sheet). */
export default makeServiceCampaign({
    service: 'receptionist',
    startMessage: 'Receptionist follow-up campaign initialized. REMO agent starting front-desk calls immediately.'
});
