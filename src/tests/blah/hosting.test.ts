import {describe, expect, it} from 'vitest';
import {create, phrase, state} from './identityFixture';
import {identityAction} from '@lib/blah/identity';
import {planHostedName, portableHosting, publishHosted} from '@lib/blah/hosting';

async function publishedIdentity() {
  const {identity} = await create();
  state.published = new Uint8Array(identity.profile);
  return identity;
}

describe('profile hosting routing', () => {
  it('prefers the first domain apex even when restoring through a listed child alias', async() => {
    const identity = await publishedIdentity();
    state.published = new TextEncoder().encode(JSON.stringify({...JSON.parse(new TextDecoder().decode(state.published)),
      domains: [identity.domain, 'child.' + identity.domain]}));
    state.policy.mockResolvedValue({domain: identity.domain, apex: true});
    const restored = await identityAction(2, {action: 'restore', domain: 'child.' + identity.domain, phrase});
    expect(state.policy.mock.calls).toEqual([[identity.domain]]);
    expect(state.publish).toHaveBeenCalledWith(identity.domain, restored.identity.profile, {via: {apex: true}});
    expect(state.store.get('custody:slot:2').hosting).toEqual({domain: identity.domain, held: ['child'], proofs: {}});
  });

  it('falls through an invalid apex policy to parent child-name hosting', async() => {
    const identity = await publishedIdentity();
    state.policy.mockResolvedValueOnce({domain: 'wrong.example.org', apex: true})
      .mockResolvedValueOnce({domain: 'example.org', apex: false, names: {}});
    const restored = await identityAction(2, {action: 'restore', domain: identity.domain, phrase});
    expect(state.policy.mock.calls).toEqual([[identity.domain], ['example.org']]);
    expect(state.publish).toHaveBeenCalledWith('example.org', restored.identity.profile, {via: 'alice', proofs: {}});
    expect(state.store.get('custody:slot:2').hosting).toEqual({domain: 'example.org', held: ['alice'], proofs: {}});
  });

  it('uses manual publication when the domain is unavailable and its parent is apex-only', async() => {
    const identity = await publishedIdentity();
    state.policy.mockRejectedValueOnce({type: 'unexpectedStatus', status: 404})
      .mockResolvedValueOnce({domain: 'example.org', apex: true});
    const restored = await identityAction(2, {action: 'restore', domain: identity.domain, phrase});
    expect(state.policy.mock.calls).toEqual([[identity.domain], ['example.org']]);
    expect(restored.identity.hostedNames).toBeUndefined();
    expect(restored.identity.publicationPending).toBe(true);
    expect(state.publish).not.toHaveBeenCalled();
  });

  it('replays the exact pending apex bytes before publishing a newer revision', async() => {
    const identity = await publishedIdentity();
    const domain = identity.domain;
    const stateKey = 'hosting:' + identity.id;
    state.store.set(stateKey, {domain, held: [], proofs: {}});
    state.publish.mockRejectedValueOnce(new Error('connection lost'));
    await expect(publishHosted(identity.id, identity.profile, [domain])).rejects.toMatchObject({type: 'BlahHostingUnreachable'});
    expect(state.store.get(stateKey).pending).toEqual({profile: identity.profile, via: {apex: true}, labels: []});
    expect(portableHosting(state.store.get(stateKey), [domain])).toEqual({domain, held: [], proofs: {}});
    const next = [...identity.profile, 32]; // A different signed-byte fixture; the mocked publisher does not verify.
    await publishHosted(identity.id, next, [domain]);
    expect(state.publish.mock.calls.map(([, bytes, options]) => ({bytes, options}))).toEqual([
      {bytes: identity.profile, options: {via: {apex: true}}},
      {bytes: identity.profile, options: {via: {apex: true}}},
      {bytes: next, options: {via: {apex: true}}}
    ]);
    expect(state.store.get(stateKey).pending).toBeUndefined();
    expect(state.plan).not.toHaveBeenCalled();
  });

  it('replays existing child-name pending state with its string target and proof', async() => {
    const identity = await publishedIdentity();
    state.store.set('hosting:' + identity.id, {domain: 'example.org', held: [], proofs: {alice: [1]},
      pending: {profile: identity.profile, via: 'alice', labels: ['alice']}});
    await publishHosted(identity.id, identity.profile, identity.domains);
    expect(state.publish).toHaveBeenCalledExactlyOnceWith('example.org', identity.profile, {via: 'alice', proofs: {alice: [1]}});
  });

  it('refuses an apex-only host in the child-name chooser', async() => {
    state.policy.mockResolvedValue({domain: 'dc.example.org', apex: true});
    await expect(planHostedName('dc.example.org', 'alice', '01'.repeat(32))).rejects.toEqual({type: 'BlahHostingUnavailable'});
    expect(state.plan).not.toHaveBeenCalled();
  });
});
