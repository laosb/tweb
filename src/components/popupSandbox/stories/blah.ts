import {defineStories} from '@components/popupSandbox/registry';

defineStories('Blah', [{
  id: 'blah/identitySetup',
  fixtureOnly: true,
  title: 'Create or restore an identity',
  open: async() => {
    const {default: showIdentitySetup} = await import('@lib/blah/IdentitySetup');
    showIdentitySetup({
      action: async() => { throw new Error('Preview only: no identity keys are created.'); },
      onIdentity: () => {}
    });
  }
}]);
