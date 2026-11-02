import {describe, expect, it, vi} from 'vitest';
import {create, otherPhrase, phrase, state} from './identityFixture';
import {logoutIdentity} from '@lib/blah/sessions';
import {openCustody} from '@lib/blah/custody';
import {identityAction, withIdentity, withResourceIdentity, bindIdentity, removeSessionDevices, pruneSessionDevices, completeEnrollment, publish} from '@lib/blah/identity';

describe('per-slot seed custody', () => {
  it('stores a non-extractable device and wrapping key, with no plaintext seed or identity signer', async() => {
    const {identity} = await create();
    const record = state.store.get('custody:slot:1');
    expect(identity.holder).toBe(true);
    expect(record).not.toHaveProperty('seed');
    expect(record).not.toHaveProperty('identity');
    expect(record.device.privateKey.extractable).toBe(false);
    expect(record.device.privateKey.algorithm).toMatchObject({name: 'ECDSA', namedCurve: 'P-256'});
    expect(record.wrappingKey.extractable).toBe(false);
    expect(record.encryptedSeed).toHaveLength(48);
    await expect(crypto.subtle.exportKey('pkcs8', record.device.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('raw', record.wrappingKey)).rejects.toThrow();
    const secret = await openCustody(1);
    expect(secret.seed).toEqual(new Uint8Array(32).fill(1));
    secret.seed.fill(0);
  });

  it('keeps a different device for each slot, even when recovery words are the same', async() => {
    const a = await create(); const b = await create(2);
    expect(a.identity.id).toBe(b.identity.id);
    expect(a.identity.devices[0].id).not.toBe(b.identity.devices[0].id);
    await expect(create()).rejects.toThrow('already has an identity');
    await bindIdentity(1);
    expect(state.store.get('slot:1')).toBe('alice-at-home');
  });

  it('removes only the seed when downgraded and upgrades the same device with matching words', async() => {
    const {identity} = await create();
    const before = state.store.get('custody:slot:1').device.publicKey;
    expect((await identityAction(1, {action: 'removeWords'})).identity.holder).toBe(false);
    expect(state.store.get('custody:slot:1')).not.toHaveProperty('encryptedSeed');
    await expect(identityAction(1, {action: 'renew'})).rejects.toThrow('recovery words');
    await expect(identityAction(1, {action: 'words'})).rejects.toThrow('recovery words');
    await expect(identityAction(1, {action: 'enterWords', phrase: otherPhrase})).rejects.toThrow('do not match');
    const restored = await identityAction(1, {action: 'enterWords', phrase});
    expect(restored.identity.holder).toBe(true);
    expect(restored.identity.id).toBe(identity.id);
    expect(state.store.get('custody:slot:1').device.publicKey).toEqual(before);
    expect((await identityAction(1, {action: 'words'})).words).toHaveLength(24);
  });

  it('enrolls a fresh device from recovery words and refuses a different identity', async() => {
    const {identity} = await create();
    state.published = new Uint8Array(identity.profile);
    await expect(identityAction(2, {action: 'restore', domain: identity.domain, phrase: otherPhrase})).rejects.toThrow('do not match');
    expect(state.store.has('custody:slot:2')).toBe(false);
    const restored = await identityAction(2, {action: 'restore', domain: identity.domain, phrase});
    expect(restored.identity.id).toBe(identity.id);
    expect(restored.identity.devices).toHaveLength(2);
    expect(state.operation.mock.calls.some(([operation]) => operation === 'enroll')).toBe(true);
  });

  it('rejects invalid words before storing any custody', async() => {
    await expect(identityAction(1, {action: 'create', domain: 'alice.example.org', phrase: 'invalid'})).rejects.toThrow('invalidEncoding');
    expect(state.store.size).toBe(0);
  });

  it('isolates chat custody from the account signer and allows showing its words again', async() => {
    await create();
    const chat = await create(1, 'channel');
    const id = chat.identity.id;
    expect(state.store.has('custody:chat:' + id)).toBe(true);
    expect((await identityAction(1, {action: 'list'})).ids).toEqual([]);
    expect((await identityAction(1, {action: 'list', kind: 'channel'})).ids).toEqual([id]);
    expect((await identityAction(1, {action: 'words', id})).words).toHaveLength(24);
    await withResourceIdentity(1, id, async(secret) => expect(secret.domain).toBe('news.example.org'));
    await withIdentity(1, async(secret) => expect(secret.domain).toBe('alice.example.org'));
  });

  it('requires the requested profile kind when restoring a chat', async() => {
    const {identity} = await create(); state.published = new Uint8Array(identity.profile);
    await expect(identityAction(2, {action: 'restore', kind: 'channel', domain: identity.domain, phrase})).rejects.toThrow('different identity kind');
  });

  it('publishes device removal after saving the signed revision', async() => {
    const {identity} = await create();
    state.published = new Uint8Array(identity.profile);
    state.store.set('hosting:' + identity.id, {domain: 'example.org', held: ['alice'], proofs: {}});
    const restored = await identityAction(2, {action: 'restore', domain: identity.domain, phrase});
    state.published = new Uint8Array(restored.identity.profile);
    state.transaction.mockClear(); state.publish.mockClear();
    const device = restored.identity.devices[1].id;
    await removeSessionDevices(1, [Uint8Array.from(device.match(/../g), (byte) => parseInt(byte, 16))]);
    expect(state.publish).toHaveBeenCalledOnce();
    expect((await identityAction(1, {action: 'inspect'})).identity.devices).toHaveLength(1);
    expect(state.transaction.mock.invocationCallOrder[0]).toBeLessThan(state.publish.mock.invocationCallOrder[0]);
  });
  it('logout deletes only the slot custody without signing or publishing a self-removal', async() => {
    await create();
    await create(2);
    const chat = await create(1, 'channel');
    await bindIdentity(1);
    state.operation.mockClear(); state.publish.mockClear();
    await logoutIdentity(1);
    expect(state.store.has('custody:slot:1')).toBe(false);
    expect(state.store.has('custody:slot:2')).toBe(true);
    expect(state.store.has('custody:chat:' + chat.identity.id)).toBe(true);
    expect(state.store.get('slot:1')).toBe('alice-at-home');
    expect(state.operation).not.toHaveBeenCalled();
    expect(state.publish).not.toHaveBeenCalled();
  });
  it('prunes only retired devices and rechecks that list before publication', async() => {
    const {identity} = await create(); state.published = new Uint8Array(identity.profile);
    const joining = await identityAction(2, {action: 'restore', domain: identity.domain, phrase});
    state.published = new Uint8Array(joining.identity.profile);
    const retired = await identityAction(3, {action: 'restore', domain: identity.domain, phrase});
    state.published = new Uint8Array(retired.identity.profile);
    const device = Uint8Array.from(retired.identity.devices[2].id.match(/../g), (byte) => parseInt(byte, 16));
    state.store.set('hosting:' + identity.id, {domain: 'example.org', held: ['alice'], proofs: {}});
    state.publish.mockClear();
    const snapshot = vi.fn().mockResolvedValueOnce({sessions: [], retired: [device]}).mockResolvedValueOnce({sessions: [], retired: []});
    await pruneSessionDevices(1, snapshot);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(state.publish).not.toHaveBeenCalled();
    expect(JSON.parse(new TextDecoder().decode(state.published)).devices).toHaveLength(3);
    snapshot.mockResolvedValue({sessions: [], retired: [device]});
    await pruneSessionDevices(1, snapshot);
    const remaining = (await identityAction(1, {action: 'inspect'})).identity.devices.map((entry) => entry.id);
    expect(remaining).toEqual(joining.identity.devices.map((entry) => entry.id));
  });
  it('discards only a pending slot and protects completed sign-ins', async() => {
    const first = await create(); await create(2); const chat = await create(1, 'channel');
    await identityAction(1, {action: 'discardEnrollment', id: first.identity.id});
    expect(state.store.has('custody:slot:1')).toBe(false);
    expect(state.store.has('enrollment:1')).toBe(false);
    expect(state.store.has('custody:slot:2')).toBe(true);
    expect(state.store.has('custody:chat:' + chat.identity.id)).toBe(true);
    await completeEnrollment(2);
    await expect(identityAction(2, {action: 'discardEnrollment', id: first.identity.id})).rejects.toThrow('already complete');
  });
  it('publishes DC profiles through the public JSON renewal endpoint', async() => {
    const fetch = vi.fn().mockResolvedValue({ok: true, status: 204}); vi.stubGlobal('fetch', fetch);
    const bytes = new TextEncoder().encode(JSON.stringify({id: 'dc', kind: 'dc', revision: 2}));
    const profile = btoa(String.fromCharCode(...bytes));
    await publish({domain: 'dc.example.org', profile} as any, {id: 'dc', domains: ['dc.example.org'], profile: [...bytes]} as any);
    expect(fetch).toHaveBeenCalledWith(new URL('https://dc.example.org/api/v1/renewal'), expect.objectContaining({
      method: 'POST', body: JSON.stringify({profile}), headers: {'Content-Type': 'application/json'}
    }));
  });
});
