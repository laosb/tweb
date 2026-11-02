import {describe, expect, it} from 'vitest';
import {create, phrase, state} from './identityFixture';
import {identityAction, installLinkedIdentity, linkedAccountIdentity, numberIdentity, certifyLinkedDevice} from '@lib/blah/identity';
import {diemClient} from '@lib/blah/runtime';
import {openCustody} from '@lib/blah/custody';

async function grant(seed = true) {
  await create();
  await numberIdentity(1, '42');
  const current = await identityAction(1, {action: 'inspect'});
  const device = await (await diemClient()).deviceKeys.generate();
  const {identity} = await certifyLinkedDevice(1, current.identity.id, device.publicKey);
  const secret = await openCustody(1);
  return {profile: new Uint8Array(identity.profile), domain: identity.domain, device,
    seed: seed ? secret.seed : undefined};
}
describe('QR opaque custody installation', () => {
  it.each([false, true])('installs the CryptoKey and optional seed (%s) atomically before login', async(transfer) => {
    const opened = await grant(transfer);
    state.transaction.mockClear();
    await installLinkedIdentity(2, opened, () => true);
    expect(state.transaction).toHaveBeenCalledOnce();
    expect(state.store.get('slot:2')).toBe('alice-at-home');
    expect((await identityAction(2, {action: 'inspect'})).identity.holder).toBe(transfer);
    expect(state.store.get('custody:slot:2').device.privateKey.extractable).toBe(false);
    if(!transfer) {
      await expect(linkedAccountIdentity(2)).rejects.toMatchObject({type: 'BLAH_LINK_APPROVAL_REQUIRED'});
      await identityAction(2, {action: 'enterWords', phrase});
    }
    expect(await linkedAccountIdentity(2)).toMatchObject({id: '01'.repeat(32)});
  });
  it('does not persist cancelled or failed installation', async() => {
    const opened = await grant();
    await expect(installLinkedIdentity(2, opened, () => false)).rejects.toMatchObject({type: 'BLAH_LINK_CANCELLED'});
    expect(state.store.has('custody:slot:2')).toBe(false);
    state.transaction.mockRejectedValueOnce(new Error('Quota exceeded'));
    await expect(installLinkedIdentity(2, opened, () => true)).rejects.toThrow('Quota exceeded');
    expect(state.store.has('custody:slot:2')).toBe(false);
  });
  it('refuses a populated slot and a conflicting binding', async() => {
    const opened = await grant();
    await expect(installLinkedIdentity(1, opened, () => true)).rejects.toMatchObject({type: 'BLAH_LINK_IDENTITY_EXISTS'});
    state.store.set('slot:2', 'different');
    await expect(installLinkedIdentity(2, opened, () => true)).rejects.toMatchObject({type: 'DEVICE_LINK_INVALID'});
  });
});
