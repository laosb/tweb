import type {ChatIdentityResponse} from '@lib/blah/chatIdentity';
import type {IdentityView} from '@lib/blah/identity';
import {defineStories} from '@components/popupSandbox/registry';


function identityFixture(): IdentityView {
  return {
      id: '123456'.padEnd(64, '0'), domain: 'alice.example.org', domains: ['alice.example.org'], publisher: '',
      renewal: {profileDays: 180, deviceDays: 180, autoRenew: true}, publicationPending: true,
      notBefore: 1877904000, namespace: '', profile: [], account: '12345', expiresAt: 1893456000, devices: [],
      hosting: {dc: '1a'.repeat(32), domain: 'old.example.org', account: '12345', epoch: '1', current: false,
        slot: {dc: '2b'.repeat(32), domain: 'dc.example.org'}}
  };
}

defineStories('Blah', [{
  id: 'blah/unlock-chat-identity',
  fixtureOnly: true,
  title: 'Unlock chat identity for deletion',
  open: async() => {
    const {unlockChatIdentity} = await import('@lib/blah/chatDeletion');
    void unlockChatIdentity({id: 'abcdef'.padEnd(64, '0'), domain: 'news.alice.example.org'}, async() => ({}));
  }
}]);

defineStories('Blah', (['create', 'import'] as const).map((mode) => ({
  id: `blah/identity-${mode}`,
  fixtureOnly: true,
  title: mode === 'create' ? 'Create identity' : 'Import identity from file',
  open: async() => {
    const {default: showIdentitySetup} = await import('@lib/blah/IdentitySetup');
    showIdentitySetup({
      mode,
      action: async() => { throw new Error('Preview only: no identity keys are created.'); },
      onIdentity: () => {}
    });
  }
})));


defineStories('Blah', [{
  id: 'blah/identity-details',
  fixtureOnly: true,
  title: 'Identity details',
  open: async() => {
    const {default: showIdentityDetails} = await import('@lib/blah/IdentityDetails');
    let identity = identityFixture();
    showIdentityDetails({
      summary: identity, identity,
      action: async(request) => {
        if(request.action === 'domains') {
          identity = {...identity, domains: request.domains};
          return {identity};
        }
        if(request.action === 'home') {
          const {slot} = identity.hosting;
          const current = request.domain === slot.domain;
          identity = {...identity, account: '', hosting: {dc: current ? slot.dc : '3c'.repeat(32), domain: request.domain,
            epoch: String(Number(identity.hosting.epoch) + 1), current, slot}};
          return {identity};
        }
        if(request.action === 'inspect') return {identity};
        if(request.action === 'publication') return {publication: {profile: [], pending: true}};
        if(request.action === 'lock') return {};
        throw new Error('Preview only: no identity keys are changed.');
      },
      onIdentity: () => {}
    });
  }
}]);

defineStories('Blah', (['password', 'backups', 'numbered'] as const).map((step) => ({
  id: `blah/cross-server-${step}`,
  fixtureOnly: true,
  title: `Cross-server chat: ${step}`,
  open: async() => {
    const {default: showChatIdentitySetup} = await import('@lib/blah/ChatIdentitySetup');
    const identity: IdentityView = {
      kind: 'channel', id: 'abcdef'.padEnd(64, '0'), domain: 'news.alice.example.org', domains: ['news.alice.example.org'],
      publisher: '', renewal: {profileDays: 180, deviceDays: 180, autoRenew: true}, publicationPending: true,
      notBefore: 1877904000, namespace: '', profile: [], account: step === 'numbered' ? '25' : '', expiresAt: 1893456000, devices: []
    };
    const prepared = {identity, paperKey: {phrase: Array(24).fill('example').join(' '), device: '12345678'}};
    const numbered: ChatIdentityResponse = {identity: {...identity, account: '25'}, result: {chatId: 25, missingInvitees: []}};
    void showChatIdentitySetup({
      domain: identity.domain, attempt: 'sandbox', change: {action: 'createChannel', options: {title: 'News', about: '', broadcast: true}},
      initial: step === 'password' ? undefined : step === 'backups' ? prepared : numbered,
      action: async(request) => request.action === 'prepare' ? prepared : numbered,
      identityAction: async(request) => request.action === 'publication' ? {publication: {profile: [], pending: true}} :
        request.action === 'backup' ? {backup: []} : {}
    }).catch(() => {});
  }
})));


defineStories('Blah', (['create', 'details'] as const).map((mode) => ({
  id: `blah/hosted-${mode}`,
  fixtureOnly: true,
  title: `Hosted name: ${mode}`,
  open: async() => {
    const {default: showIdentitySetup} = await import('@lib/blah/IdentitySetup');
    const {default: showIdentityDetails} = await import('@lib/blah/IdentityDetails');
    let identity = {...identityFixture(), hostingAvailable: true};
    let locked = false;
    const action: import('@lib/blah/IdentityPanel').IdentityActions = async(request) => {
      if(request.action === 'hostingCapability') return {hostingAvailable: true};
      if(request.action === 'hostingStatus') return {unlocked: !locked};
      if(request.action === 'hostingPlan') {
        const {label} = request.hosted;
        locked = label === 'locked';
        if(label === 'offline') throw {type: 'BlahHostingUnreachable'};
        const status = label === 'taken' ? 'taken' : label === 'invalid' ? 'invalid' : 'needsProof';
        const requiredBits = label === 'slow' || locked ? 256 : label === 'proof' ? 12 : 0;
        return {hostingPlan: {label, status, requiredBits, puzzle: requiredBits ? {label, requiredBits,
          input: [...new TextEncoder().encode('diem-profile-hosting-pow-v1\0id.example\0alice\0'),
            ...Array.from({length: 32}, (_, i) => i + 1)]} : null}};
      }
      if(request.action === 'create') {
        identity = {...identity, domain: request.domain, domains: [request.domain],
          hostedNames: {domain: request.hosted.domain, held: [], proofs: {}}};
      }
      if(request.action === 'hostingClaim') {
        const {domain, label, proofs} = request.hosted;
        if(label === 'limited') throw {type: 'BlahHostingRateLimited', retryAfter: 30};
        if(label === 'lost') throw {type: 'BlahHostingTaken'};
        identity = {...identity, domains: [...new Set([...identity.domains, label + '.' + domain])], publicationPending: false,
          hostedNames: {domain, held: [label], proofs}};
      }
      if(request.action === 'domains') identity = {...identity, domains: request.domains};
      if(request.action === 'retryPublication') identity = {...identity, publicationPending: false};
      if(request.action === 'publication') return {publication: {profile: [], pending: identity.publicationPending}};
      if(request.action === 'lock') return {};
      return {identity};
    };
    if(mode === 'create') showIdentitySetup({mode, action, onIdentity: () => {}});
    else showIdentityDetails({summary: identity, identity, action, onIdentity: () => {}});
  }
})));
