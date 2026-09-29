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
    const identity: IdentityView = {
      id: '123456'.padEnd(64, '0'), domain: 'alice.example.org', domains: ['alice.example.org'], publisher: '',
      renewal: {profileDays: 180, deviceDays: 180, autoRenew: true}, publicationPending: true,
      notBefore: 1877904000, namespace: '', profile: [], account: '', expiresAt: 1893456000, devices: []
    };
    showIdentityDetails({
      summary: identity, identity,
      action: async() => { throw new Error('Preview only: no identity keys are changed.'); },
      onIdentity: () => {}
    });
  }
}]);
