import {beforeEach, afterEach, describe, expect, it, vi} from 'vitest';
import type {IdentityInfo, IdentitySecret} from '@lib/blah/wasm';

const mock = vi.hoisted(() => ({store: new Map<string, any>(), files: new Map<number, any>(), profiles: new Map<number, any>(),
  next: 0, created: 0, paper: vi.fn(), diem: vi.fn(), published: vi.fn()}));
vi.mock('@config/blah', () => ({default: {home: {}}, ensureBlahConfig: async() => {},
  getBlahConfig: () => ({home: {identity: 'home', generation: '1'}})}));
vi.mock('@lib/blah/homeStorage', () => ({bindHomeStorage: async() => {}}));
vi.mock('@lib/blah/accountStorage', () => ({requireAccountBinding: vi.fn()}));
vi.mock('@lib/blah/profile', async(importOriginal) => ({...await importOriginal<object>(), fetchProfile: mock.published}));
vi.mock('@lib/blah/vault', async(importOriginal) => {
  let queue = Promise.resolve();
  return {...await importOriginal<object>(),
    exclusively: (action: () => Promise<any>) => {
      const result = queue.then(action);
      queue = result.catch(() => {});
      return result;
    },
    stored: async(key: string, value?: unknown) => {
      if(value !== undefined) mock.store.set(key, value);
      return mock.store.get(key);
    },
    storeEntries: async(entries: [string, unknown][]) => { entries.forEach(([key, value]) => mock.store.set(key, value)); },
    identityIDs: async() => [...mock.store.keys()].filter((key) => key.startsWith('identity:')).map((key) => key.slice(9))
  };
});
vi.mock('@lib/blah/runtime', () => {
  const session = (password: string) => ({
    seal: async(secret: IdentitySecret) => {
      const id = ++mock.next;
      mock.files.set(id, {secret: structuredClone(secret), password});
      return new Uint8Array([id]);
    },
    open: async(file: Uint8Array) => structuredClone(mock.files.get(file[0]).secret),
    destroy: vi.fn()
  });
  return {verifySignature: vi.fn(), diemClient: async() => ({
    generateSigningKey: async() => ({privateKey: 'secret', publicKey: 'public'}),
    paperKeys: {generate: mock.paper, restore: async() => ({key: {privateKey: 'paper-secret', publicKey: 'paper-public'}})},
    verifyProfile: async(profile: Uint8Array) => ({kind: mock.profiles.get(profile[0]).kind}),
    keyFiles: {
      create: async(password: string) => {
        if(!password) throw new Error('Password required');
        return session(password);
      },
      unlock: async(file: Uint8Array, password: string) => {
        const saved = mock.files.get(file[0]);
        if(saved.password !== password) throw new Error('Wrong password');
        return {session: session(password), contents: structuredClone(saved.secret)};
      },
      inspect: (file: Uint8Array) => ({id: mock.profiles.get(atob(mock.files.get(file[0]).secret.profile).charCodeAt(0)).id})
    }
  })};
});
vi.mock('@lib/blah/wasm', () => ({diem: mock.diem}));
import {bindIdentity, chatIdentityForId, identityAction, withIdentity, withResourceIdentity} from '@lib/blah/identity';

beforeEach(() => {
  vi.useFakeTimers();
  mock.store.clear(); mock.files.clear(); mock.profiles.clear(); mock.next = 0; mock.created = 0;
  mock.paper.mockReset().mockResolvedValue({phrase: Array(24).fill('word').join(' '), device: [42]});
  mock.diem.mockReset().mockImplementation(async(operation: string, secret: IdentitySecret, extra = {}, _slot: number, kind = 'user') => {
    let info: IdentityInfo & {kind: string};
    if(operation === 'create') {
      const n = ++mock.created;
      info = {id: 'id' + n, namespace: 'namespace' + n, kind, profile: [n], domains: [secret.domain],
        devices: [{id: 'browser', key: [1], current: true, notBefore: Date.now() / 1000, expiresAt: Date.now() / 1000 + 10_000}],
        account: '', proof: [], notBefore: Date.now() / 1000, expiresAt: Date.now() / 1000 + 10_000};
      mock.profiles.set(n, info);
    } else info = mock.profiles.get(atob(secret.profile).charCodeAt(0));
    if(info.kind !== kind && !(info.kind === 'dc' && kind === 'user')) throw new Error('Wrong kind');
    if(operation === 'addDevice') info.devices.push({id: 'paper', key: [42], current: false, notBefore: info.notBefore, expiresAt: info.expiresAt});
    if(operation === 'renew') {
      info.notBefore = Date.now() / 1000; info.expiresAt = info.notBefore + 10_000;
      info.devices.forEach((device) => { device.notBefore = info.notBefore; device.expiresAt = info.expiresAt; });
    }
    return {...info, ...extra};
  });
});
afterEach(async() => {
  await identityAction(1, {action: 'lock'});
  await identityAction(2, {action: 'lock'});
  vi.useRealTimers();
});
const create = (kind: 'user' | 'channel', extra = {}) => identityAction(1, {action: 'create', kind,
  domain: kind === 'user' ? 'alice.example.org' : 'news.alice.example.org', password: 'x', ...extra});

describe('channel custody', () => {
  it('finds only held, bound chat identities and reports slot-local locks and expiry', async() => {
    const {identity: user} = await create('user');
    mock.store.set('metadata:' + user.id, {kind: 'user', chatId: 25});
    expect(await chatIdentityForId(1, 25)).toBeUndefined();
    const {identity} = await create('channel');
    expect(await chatIdentityForId(1, 25)).toBeUndefined();
    mock.store.set('metadata:' + identity.id, {kind: 'channel', chatId: 25});
    expect(await chatIdentityForId(1, 25)).toMatchObject({id: identity.id, domain: identity.domain, locked: false});
    expect(await chatIdentityForId(2, 25)).toMatchObject({id: identity.id, locked: true});
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(await chatIdentityForId(1, 25)).toMatchObject({id: identity.id, locked: true});
    expect(await chatIdentityForId(1, 99)).toBeUndefined();
    mock.store.set('metadata:' + identity.id, {kind: 'channel', chatId: 25, home: 'other:1'});
    expect(await chatIdentityForId(1, 25)).toBeUndefined();
  });

  it.each(['user', 'channel'] as const)('detects a paper %s from its verified hosted profile and stores device-only custody', async(kind) => {
    const {identity} = await create(kind);
    mock.profiles.get(identity.profile[0]).account = '25';
    await identityAction(1, {action: 'lock'});
    mock.store.clear();
    mock.published.mockResolvedValue(new Uint8Array(identity.profile));
    const imported = await identityAction(1, {action: 'paper', domain: identity.domain, password: 'new password', phrase: 'words',
      kind: kind === 'user' ? 'channel' : 'user'});
    expect(imported.identity.kind).toBe(kind);
    const use = kind === 'channel' ? (action: any) => withResourceIdentity(1, identity.id, action) : (action: any) => withIdentity(1, action);
    await use(async(secret: IdentitySecret) => {
      expect(secret.identity).toBeUndefined();
      expect(secret.device.privateKey).toBe('paper-secret');
    });
    expect(mock.store.get('metadata:' + identity.id)).toMatchObject({kind, ...(kind === 'channel' ? {chatId: 25} : {})});
    expect((await identityAction(1, {action: 'list'})).ids).toEqual(kind === 'channel' ? [] : [identity.id]);
    if(kind === 'channel') expect(await chatIdentityForId(1, 25)).toMatchObject({id: identity.id, locked: false});
    expect(mock.store.has('slot:1')).toBe(false);
    for(const action of ['renew', 'addDevice'] as const) {
      await expect(identityAction(1, {action, id: identity.id, device: 'AAAA'})).rejects.toThrow('Only a device that holds the identity key');
    }
    const profile = mock.profiles.get(identity.profile[0]);
    profile.notBefore = Date.now() / 1000 - 9000;
    profile.expiresAt = Date.now() / 1000 + 1000;
    mock.diem.mockClear();
    await identityAction(1, {action: 'inspect', id: identity.id});
    expect(mock.diem.mock.calls.some(([operation]) => operation === 'renew')).toBe(false);
  });

  it('reuses a cancelled attempt and returns its default paper words only once', async() => {
    const first = await create('channel', {attempt: 'form'});
    expect(first.paperKey.phrase.split(' ')).toHaveLength(24);
    await identityAction(1, {action: 'lock', id: first.identity.id});
    const again = await create('channel', {attempt: 'form'});
    expect(again.identity.id).toBe(first.identity.id);
    expect(again.paperKey).toBeUndefined();
    expect(mock.created).toBe(1);
    expect(mock.paper).toHaveBeenCalledOnce();
    await expect(create('channel', {attempt: 'form', domain: 'different.example.org'})).rejects.toThrow('original domain');
    expect(mock.created).toBe(1);
  });

  it('serializes concurrent preparation of the same attempt', async() => {
    const [first, second] = await Promise.all([create('channel', {attempt: 'form'}), create('channel', {attempt: 'form'})]);
    expect(first.identity.id).toBe(second.identity.id);
    expect(mock.created).toBe(1);
  });

  it('keeps sign-in candidates, namespace binding and user signer separate', async() => {
    const user = await create('user');
    await bindIdentity(1);
    const binding = mock.store.get('slot:1');
    const channel = await create('channel');
    expect((await identityAction(1, {action: 'list'})).ids).toEqual([user.identity.id]);
    expect((await identityAction(1, {action: 'list', kind: 'channel'})).ids).toEqual([channel.identity.id]);
    expect(await withIdentity(1, async(_secret, info) => info.id)).toBe(user.identity.id);
    expect(await withResourceIdentity(1, channel.identity.id, async(_secret, info) => info.id)).toBe(channel.identity.id);
    expect(mock.store.get('slot:1')).toBe(binding);
    expect((await identityAction(1, {action: 'suggestDomain'})).domain).toBe('alice.example.org');
    await identityAction(1, {action: 'lock', id: channel.identity.id});
    expect(await withIdentity(1, async(_secret, info) => info.id)).toBe(user.identity.id);
  });

  it.each(['user', 'dc', 'channel'])('classifies an imported sealed %s profile into the correct custody path', async(profileKind) => {
    const kind = profileKind === 'channel' ? 'channel' : 'user';
    const {identity} = await create(kind);
    // HostedProfile accepts DC operator profiles through kind: 'user'.
    mock.profiles.get(identity.profile[0]).kind = profileKind;
    const {backup} = await identityAction(1, {action: 'backup', id: identity.id});
    await identityAction(1, {action: 'lock', id: identity.id});
    mock.store.delete('identity:' + identity.id);
    mock.store.delete('metadata:' + identity.id);
    mock.diem.mockClear();
    const restored = await identityAction(1, {action: 'restore', backup, password: 'x'});
    expect(restored.identity.kind).toBe(kind);
    expect(mock.diem).toHaveBeenCalledWith('inspect', expect.anything(), {}, 1, kind);
    expect((await identityAction(1, {action: 'list'})).ids).toEqual(kind === 'user' ? [identity.id] : []);
    expect((await identityAction(1, {action: 'list', kind: 'channel'})).ids).toEqual(kind === 'channel' ? [identity.id] : []);
    expect(mock.store.has('slot:1')).toBe(false);
  });

  it('isolates slots and locks resources after 15 minutes despite background maintenance', async() => {
    const channel = await create('channel');
    await expect(withResourceIdentity(2, channel.identity.id, async() => {})).rejects.toThrow('Unlock');
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    await expect(withResourceIdentity(1, channel.identity.id, async() => {})).rejects.toThrow('Unlock');
  });

  it('uses channel renewal and publication without touching user custody', async() => {
    const channel = await create('channel');
    const profile = mock.profiles.get(channel.identity.profile[0]);
    profile.notBefore = Date.now() / 1000 - 9000;
    profile.expiresAt = Date.now() / 1000 + 1000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.diem).toHaveBeenCalledWith('renew', expect.anything(), {}, 1, 'channel');
    mock.published.mockResolvedValue(new Uint8Array(channel.identity.profile));
    expect((await identityAction(1, {action: 'publication', id: channel.identity.id})).publication.pending).toBe(false);
    mock.published.mockResolvedValue(undefined);
    expect((await identityAction(1, {action: 'publication', id: channel.identity.id})).publication.pending).toBe(true);
    mock.published.mockRejectedValue(new Error('Network failed'));
    await expect(identityAction(1, {action: 'publication', id: channel.identity.id})).rejects.toThrow('Network failed');
  });
});
