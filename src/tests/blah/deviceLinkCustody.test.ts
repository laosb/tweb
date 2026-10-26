import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {IdentitySecret} from '@lib/blah/wasm';

const mock = vi.hoisted(() => ({store: new Map<string, any>(), files: new Map<number, any>(), grants: new Map<number, any>(), respond: vi.fn(), next: 0,
  events: [] as string[], diem: vi.fn(), fetch: vi.fn(), destroy: vi.fn(), transaction: vi.fn()}));
vi.mock('@config/blah', () => ({ensureBlahConfig: async() => {},
  getBlahConfig: () => ({home: {identity: '0a0b', generation: '1', domain: 'dc.example.org'}})}));
vi.mock('@lib/blah/homeStorage', () => ({bindHomeStorage: vi.fn(), requireHomeStorage: vi.fn()}));
vi.mock('@lib/blah/accountStorage', () => ({requireAccountBinding: vi.fn()}));
vi.mock('@lib/blah/discovery', () => ({dcDomain: (value: string) => value}));
vi.mock('@lib/blah/vault', async(importOriginal) => ({...await importOriginal<object>(),
  exclusively: (action: () => Promise<unknown>) => action(),
  stored: async(key: string, value?: unknown) => {
    if(value !== undefined) mock.store.set(key, value);
    return mock.store.get(key);
  },
  storeEntries: mock.transaction,
  identityIDs: async() => [...mock.store.keys()].filter(key => key.startsWith('identity:')).map(key => key.slice(9))
}));
vi.mock('@lib/blah/wasm', () => ({diem: mock.diem}));
vi.mock('@lib/blah/runtime', () => ({verifySignature: vi.fn(), diemClient: async() => ({
  verifyProfile: async() => ({kind: 'user', home: {dc: '0a0b', epoch: '1', account: '42'}}),
  keyFiles: {create: async(password: string) => {
    let last: number;
    return {
      seal: async(secret: IdentitySecret | Uint8Array) => {
        mock.events.push('seal');
        const id = last = ++mock.next;
        mock.files.set(id, {password, secret: structuredClone(secret instanceof Uint8Array ? mock.grants.get(secret[0]) : secret)});
        return new Uint8Array([id]);
      },
      open: async(file: Uint8Array) => structuredClone(mock.files.get(file[0]).secret),
      respondToDeviceLink: (input: unknown) => mock.respond(input, mock.files.get(last).secret),
      destroy: mock.destroy
    };
  }}
})}));

import {certifyLinkedDevice, identityAction, installLinkedIdentity, linkedAccountIdentity, respondToLinkedDevice, withIdentity} from '@lib/blah/identity';

function secret(identityKey = true): IdentitySecret {
  return {domain: 'alice.example.org', profile: 'AQ==', device: {privateKey: 'N private', publicKey: 'N public'},
    ...(identityKey ? {identity: {privateKey: 'identity private', publicKey: 'identity public'}} : {}),
    publisher: 'https://profiles.example.org/alice', token: 'publisher token', publicationPending: true,
    renewal: {profileDays: 60, deviceDays: 90, autoRenew: false}};
}
const info = () => ({id: 'alice', namespace: 'alice-at-home', account: '42', profile: [1], domains: ['alice.example.org'],
  devices: [{id: 'N', key: [1], current: true, notBefore: Date.now() / 1000, expiresAt: Date.now() / 1000 + 10000}],
  notBefore: Date.now() / 1000, expiresAt: Date.now() / 1000 + 10000, proof: [] as number[]});

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mock.store.clear(); mock.files.clear(); mock.grants.clear(); mock.next = 0; mock.events.length = 0;
  mock.transaction.mockImplementation(async(entries: [string, unknown][]) => {
    mock.events.push('commit');
    entries.forEach(([key, value]) => mock.store.set(key, value));
  });
  mock.diem.mockImplementation(async(operation: string) => {
    if(operation === 'addDevice') {
      mock.events.push('certify');
      return {...info(), profile: [2], devices: [...info().devices, {id: 'third', key: [3]}]};
    }
    return info();
  });
  mock.fetch.mockImplementation(async() => {
    mock.events.push('publish');
    const stored = mock.files.get(mock.store.get('identity:alice')[0]).secret;
    expect(stored.profile).toBe('Ag==');
    expect(stored.publicationPending).toBe(true);
    return {ok: true};
  });
  vi.stubGlobal('fetch', mock.fetch);
});

afterEach(async() => {
  await identityAction(1, {action: 'lock'});
  await identityAction(2, {action: 'lock'});
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('device-link durable custody', () => {
  it.each([false, true])('installs device custody (identity transfer: %s) and slot binding in one commit', async(transfer) => {
    mock.grants.set(99, secret(transfer));
    await installLinkedIdentity(1, new Uint8Array([99]), 'local password', () => true);
    expect(mock.transaction).toHaveBeenCalledOnce();
    expect(mock.store.get('slot:1')).toBe('alice-at-home');
    expect(mock.store.get('metadata:alice')).toMatchObject({kind: 'user', namespace: 'alice-at-home'});
    const file = mock.files.get(mock.store.get('identity:alice')[0]);
    expect(file.password).toBe('local password');
    expect(file.secret.publicationPending).toBe(false);
    expect(!!file.secret.identity).toBe(transfer);
    await withIdentity(1, async(value) => expect(value.device.privateKey).toBe('N private'));
    expect(await linkedAccountIdentity(1)).toMatchObject({id: 'alice', unlocked: true});
    await expect(linkedAccountIdentity(2)).rejects.toMatchObject({type: 'BLAH_LINK_APPROVAL_REQUIRED'});
  });

  it('does not persist or leave unlocked key material when cancelled before the transaction', async() => {
    await expect(installLinkedIdentity(1, secret(), 'password', () => false)).rejects.toMatchObject({type: 'BLAH_LINK_CANCELLED'});
    expect(mock.transaction).not.toHaveBeenCalled();
    expect(mock.store.size).toBe(0);
    expect(mock.destroy).toHaveBeenCalledOnce();
  });

  it('destroys the password session if durable storage fails', async() => {
    mock.transaction.mockRejectedValue(new Error('Quota exceeded'));
    await expect(installLinkedIdentity(1, secret(), 'password', () => true)).rejects.toThrow('Quota exceeded');
    expect(mock.destroy).toHaveBeenCalledOnce();
    await expect(withIdentity(1, async() => {})).rejects.toThrow('Unlock');
  });

  it('refuses an existing identity or a slot bound to a different identity', async() => {
    mock.store.set('slot:1', 'another-identity');
    await expect(installLinkedIdentity(1, secret(), 'password', () => true)).rejects.toMatchObject({type: 'DEVICE_LINK_INVALID'});
    expect(mock.transaction).not.toHaveBeenCalled();
    mock.store.clear();
    await installLinkedIdentity(1, secret(), 'password', () => true);
    const original = mock.store.get('identity:alice');
    await expect(installLinkedIdentity(1, secret(), 'password', () => true)).rejects.toMatchObject({type: 'BLAH_LINK_IDENTITY_EXISTS'});
    expect(mock.store.get('identity:alice')).toBe(original);
  });

  it('saves the certified revision before publishing, and only clears pending after success', async() => {
    await installLinkedIdentity(1, secret(), 'password', () => true);
    mock.events.length = 0;
    const result = await certifyLinkedDevice(1, 'alice', new Uint8Array([3]));
    expect(result.manualPublication).toBe(false);
    expect(mock.events).toEqual(['certify', 'seal', 'commit', 'publish', 'seal', 'commit']);
    expect(mock.files.get(mock.store.get('identity:alice')[0]).secret.publicationPending).toBe(false);
  });

  it('retains a failed published revision durably and does not report approval', async() => {
    await installLinkedIdentity(1, secret(), 'password', () => true);
    mock.fetch.mockResolvedValue({ok: false, status: 503});
    await expect(certifyLinkedDevice(1, 'alice', new Uint8Array([3]))).rejects.toThrow('503');
    expect(mock.files.get(mock.store.get('identity:alice')[0]).secret).toMatchObject({profile: 'Ag==', publicationPending: true});
  });

  it('passes only portable custody settings to the response session after publication', async() => {
    await installLinkedIdentity(1, secret(), 'password', () => true);
    mock.store.set('hosting:alice', {domain: 'hosting.example.org', held: ['alice'], proofs: {alice: [1]},
      pending: {profile: [2], via: 'alice', labels: ['alice']}, unclaimed: 'another'});
    // This test uses a separate publisher, so the local hosted-name snapshot is
    // only portable metadata; it must never travel as an in-flight operation.
    await withIdentity(1, async(_secret, info, save) => {
      await save(info, false);
      await respondToLinkedDevice(1, {parameter: 'code', request: new Uint8Array([17]),
        profile: new Uint8Array(info.profile), domain: 'alice.example.org', transferIdentity: true});
    }, true, false);
    const [input, saved] = mock.respond.mock.calls[0];
    expect(input).not.toHaveProperty('metadata');
    expect(saved.publicationPending).toBe(false);
    expect(saved.hosting).toEqual({domain: 'hosting.example.org', held: ['alice'], proofs: {alice: [1]}});
    expect(saved).toMatchObject({publisher: 'https://profiles.example.org/alice', token: 'publisher token',
      renewal: {profileDays: 60, deviceDays: 90, autoRenew: false}});
  });

  it('requires explicit manual publication when no publisher is configured', async() => {
    const value = secret();
    delete value.publisher;
    await installLinkedIdentity(1, value, 'password', () => true);
    expect((await certifyLinkedDevice(1, 'alice', new Uint8Array([3]))).manualPublication).toBe(true);
    expect(mock.fetch).not.toHaveBeenCalled();
  });

  it('cannot certify another device from device-only custody', async() => {
    await installLinkedIdentity(1, secret(false), 'password', () => true);
    await expect(certifyLinkedDevice(1, 'alice', new Uint8Array([3]))).rejects.toMatchObject({type: 'BLAH_LINK_APPROVAL_REQUIRED'});
    expect(mock.diem.mock.calls.some(([operation]) => operation === 'addDevice')).toBe(false);
    expect(mock.fetch).not.toHaveBeenCalled();
  });
});
