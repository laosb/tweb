import type {ChatIdentityResponse} from '@lib/blah/chatIdentity';
import type {IdentityActions, IdentityView} from '@lib/blah/identity';
import {defineStories} from '@components/popupSandbox/registry';

const words = Array(23).fill('abandon').concat('art');
function identityFixture(): IdentityView {
  return {id: '123456'.padEnd(64, '0'), kind: 'user', domain: 'alice.example.org', domains: ['alice.example.org'],
    holder: true, renewal: {profileDays: 180, deviceDays: 180, autoRenew: true}, publicationPending: true,
    notBefore: 1877904000, namespace: '', profile: [], account: '12345', expiresAt: 1893456000, devices: [],
    hosting: {dc: '1a'.repeat(32), domain: 'old.example.org', account: '12345', epoch: '1', current: false,
      slot: {dc: '2b'.repeat(32), domain: 'dc.example.org'}}};
}
function fixtureAction(initial = identityFixture()): IdentityActions {
  let identity = initial;
  return async(request) => {
    if(request.action === 'attempt') return {};
    if(request.action === 'generateWords' || request.action === 'words') return {words};
    if(request.action === 'domains') identity = {...identity, domains: request.domains};
    if(request.action === 'enterWords') identity = {...identity, holder: true};
    if(request.action === 'removeWords') identity = {...identity, holder: false};
    if(request.action === 'home') {
      const {slot} = identity.hosting;
      const current = request.domain === slot.domain;
      identity = {...identity, account: '', hosting: {dc: current ? slot.dc : '3c'.repeat(32), domain: request.domain,
        epoch: String(Number(identity.hosting.epoch) + 1), current, slot}};
    }
    if(request.action === 'publication') return {publication: {profile: [], pending: true}};
    if(request.action === 'hostingPlan') {
      const {label} = request.hosted;
      if(label === 'offline') throw {type: 'BlahHostingUnreachable'};
      return {hostingPlan: {label, status: label === 'taken' ? 'taken' : 'needsProof', requiredBits: 0, puzzle: null}};
    }
    if(request.action === 'hostingClaim') {
      const {domain, label, proofs} = request.hosted;
      identity = {...identity, domain: label + '.' + domain, domains: [label + '.' + domain], publicationPending: false,
        hostedNames: {domain, held: [label], proofs}};
    }
    if(request.action === 'hostingCapability') return {hostingAvailable: true};
    if(request.action === 'hostingStatus') return {available: true};
    return {identity};
  };
}

defineStories('Blah', (['holder', 'non-holder', 'hosted'] as const).map((mode) => ({
  id: mode === 'holder' ? 'blah/identity-details' : `blah/identity-${mode}`,
  fixtureOnly: true,
  title: `Blah Identity: ${mode}`,
  open: async() => {
    const {default: showIdentityDetails} = await import('@lib/blah/IdentityDetails');
    const identity = {...identityFixture(), holder: mode !== 'non-holder', hostingAvailable: mode === 'hosted'};
    showIdentityDetails({summary: identity, identity, action: fixtureAction(identity), onIdentity: () => {}});
  }
})));

defineStories('Blah', [{id: 'blah/restore-chat', title: 'Restore chat identity with recovery words', fixtureOnly: true,
  open: async() => {
    const {default: showIdentitySetup} = await import('@lib/blah/IdentitySetup');
    showIdentitySetup({action: fixtureAction({...identityFixture(), kind: 'channel'}), onIdentity: () => {}});
  }}]);

defineStories('Blah', (['words', 'publication', 'numbered', 'hosted'] as const).map((step) => ({
  id: `blah/cross-server-${step}`, fixtureOnly: true, title: `Cross-server chat: ${step}`,
  open: async() => {
    const {default: showChatIdentitySetup} = await import('@lib/blah/ChatIdentitySetup');
    const identity: IdentityView = {...identityFixture(), kind: 'channel', hosting: undefined,
      domain: 'news.alice.example.org', domains: ['news.alice.example.org'], account: step === 'numbered' ? '25' : ''};
    const numbered: ChatIdentityResponse = {identity: {...identity, account: '25'}, result: {chatId: 25, missingInvitees: []}};
    const action = fixtureAction(identity);
    void showChatIdentitySetup({domain: identity.domain, hosted: step === 'hosted', attempt: 'sandbox',
      change: {action: 'createChannel', options: {title: 'News', about: '', broadcast: true}},
      initial: step === 'numbered' ? numbered : undefined,
      action: async(request) => request.action === 'prepare' ? {identity} : numbered,
      identityAction: (request) => request.action === 'attempt' && step === 'publication' ? Promise.resolve({identity}) : action(request)}).catch(() => {});
  }
})));

defineStories('Blah', [{id: 'blah/device-link', fixtureOnly: true, title: 'Link device by QR code',
  managers: {appAccountManager: {blahDeviceLink: async(request: {action: string, link?: string}) => {
    if(request.action === 'inspect') {
      if(!request.link?.includes('&blah=')) throw {type: 'BLAH_LINK_REQUIRED'};
      return {label: 'Blah Web · New browser', id: 'alice', domain: 'alice.example.org'};
    }
    if(request.action === 'prepare') return {identity: identityFixture(), manualPublication: true};
    return {};
  }}},
  open: async() => {
    const [{default: showDeviceLinkPopup}, {default: rootScope}, {bindManagersToSession}] = await Promise.all([
      import('@lib/blah/DeviceLinkPopup'), import('@lib/rootScope'), import('@lib/accounts/bindManagersToAccount')
    ]);
    showDeviceLinkPopup({managers: bindManagersToSession(rootScope.managers)});
  }}]);
