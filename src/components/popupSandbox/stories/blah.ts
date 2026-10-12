import type {ChatIdentityResponse} from '@lib/blah/chatIdentity';
import type {IdentityView} from '@lib/blah/identity';
import {defineStories} from '@components/popupSandbox/registry';

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
    let identity: IdentityView = {
      id: '123456'.padEnd(64, '0'), domain: 'alice.example.org', domains: ['alice.example.org'], publisher: '',
      renewal: {profileDays: 180, deviceDays: 180, autoRenew: true}, publicationPending: true,
      notBefore: 1877904000, namespace: '', profile: [], account: '', expiresAt: 1893456000, devices: []
    };
    showIdentityDetails({
      summary: identity, identity,
      action: async(request) => {
        if(request.action === 'domains') {
          identity = {...identity, domains: request.domains};
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
