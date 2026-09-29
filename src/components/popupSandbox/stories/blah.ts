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
