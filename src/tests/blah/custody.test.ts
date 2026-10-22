import {beforeEach, afterEach, describe, expect, it, vi} from 'vitest';
import type {IdentityInfo, IdentitySecret} from '@lib/blah/wasm';

const mock = vi.hoisted(() => ({store: new Map<string, any>(), files: new Map<number, any>(), profiles: new Map<number, any>(),
  next: 0, created: 0, paper: vi.fn(), diem: vi.fn(), published: vi.fn(), hosting: undefined as any}));
vi.mock('@config/blah', () => ({default: {home: {}}, ensureBlahConfig: async() => {},
  getBlahConfig: () => ({home: {identity: 'home', generation: '1'}})}));
vi.mock('@lib/blah/homeStorage', () => ({bindHomeStorage: async() => {}}));
vi.mock('@lib/blah/accountStorage', () => ({requireAccountBinding: vi.fn()}));
vi.mock('@lib/blah/discovery', () => ({dcDomain: (value: string) => value, fetchDCProfile: async() => new Uint8Array(),
  profileConfig: async(domain: string) => ({config: {home: {domain, identity: '0a0b', generation: '2'}}})}));
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
    hosting: mock.hosting,
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
import {bindIdentity, chatIdentityForId, identityAction, numberIdentity, withIdentity, withResourceIdentity} from '@lib/blah/identity';

beforeEach(() => {
  vi.useFakeTimers();
  mock.hosting = undefined;
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

describe('user custody away from home', () => {
  it('unlocks an identity hosted on another DC but never signs for the slot with it', async() => {
    const user = await create('user');
    await bindIdentity(1);
    const other = await create('user', {domain: 'bob.example.org'});
    // Inspection at this slot's DC reports no namespace for an identity hosted elsewhere.
    mock.profiles.get(other.identity.profile[0]).namespace = '';
    await identityAction(1, {action: 'lock'});
    const unlocked = await identityAction(1, {action: 'unlock', id: other.identity.id, password: 'x'});
    expect(unlocked.identity.id).toBe(other.identity.id);
    expect((await identityAction(1, {action: 'inspect', id: other.identity.id})).identity.id).toBe(other.identity.id);
    await expect(bindIdentity(1)).rejects.toThrow('hosted on another DC');
    await identityAction(1, {action: 'unlock', id: user.identity.id, password: 'x'});
    expect(await bindIdentity(1)).toBe('alice.example.org');
  });

  it('moves the home to a verified DC and retires the slot the old hosting was signed in to', async() => {
    const user = await create('user');
    await bindIdentity(1);
    const moved = await identityAction(1, {action: 'home', id: user.identity.id, domain: 'dc2.example.org'});
    expect(mock.diem).toHaveBeenCalledWith('home', expect.anything(),
      {dc: new Uint8Array([10, 11]), dcDomain: 'dc2.example.org', generation: '2'}, 1);
    expect(moved.retired).toBe(true);
    expect(mock.store.get('dc-domain:0a0b')).toBe('dc2.example.org');
    const other = await create('user', {domain: 'bob.example.org'});
    expect((await identityAction(1, {action: 'home', id: other.identity.id, domain: 'dc2.example.org'})).retired).toBe(false);
    const operate = mock.diem.getMockImplementation();
    mock.diem.mockImplementation(async(operation: string, ...rest: unknown[]) => {
      if(operation === 'home') throw new Error('wrongHome');
      return operate(operation, ...rest);
    });
    await expect(identityAction(1, {action: 'home', id: other.identity.id, domain: 'dc2.example.org'})).rejects.toThrow('already hosted on dc2.example.org');
  });

  it('refuses to move a chat identity', async() => {
    const {identity} = await create('channel');
    await expect(identityAction(1, {action: 'home', id: identity.id, domain: 'dc2.example.org'})).rejects.toThrow('Only a user identity');
  });
});

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
    mock.hosting = undefined;
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


describe('hosted profile names', () => {
  const hosted = {domain: 'id.example', label: 'alice', proofs: {alice: [0, 1]}};
  function enableHosting() {
    mock.hosting = {
      plan: vi.fn(async() => [{label: 'alice', status: 'needsProof', requiredBits: 0, puzzle: null}]),
      publish: vi.fn(async(_domain: string, profile: number[]) => {
        const info = mock.profiles.get(profile[0]);
        const file = mock.store.get('identity:' + info.id);
        expect(mock.files.get(file[0]).secret.publicationPending).toBe(true);
        expect(atob(mock.files.get(file[0]).secret.profile).charCodeAt(0)).toBe(profile[0]);
        return {identity: info.id, revision: '1', domains: info.domains};
      })
    };
    const original = mock.diem.getMockImplementation();
    mock.diem.mockImplementation(async(operation, ...args) => {
      const info = await original(operation, ...args);
      if(['domains', 'renew', 'account', 'addDevice', 'home'].includes(operation)) {
        info.profile = [mock.profiles.size + 1];
        mock.profiles.set(info.profile[0], structuredClone(info));
      }
      return info;
    });
  }
  const claim = (id: string, extra = {}) => identityAction(1, {action: 'hostingClaim', id, hosted: {...hosted, ...extra}});
  it('hides the capability on older runtimes', async() => {
    expect(await identityAction(1, {action: 'hostingCapability'})).toEqual({hostingAvailable: false});
    const {identity} = await create('user');
    expect(identity.hostingAvailable).toBe(false);
    await expect(claim(identity.id)).rejects.toMatchObject({type: 'BlahHostingUnavailable'});
  });
  it('plans without custody and persists a created identity before solving', async() => {
    enableHosting();
    expect((await identityAction(1, {action: 'hostingPlan', hosted})).hostingPlan.status).toBe('needsProof');
    expect(mock.hosting.plan).toHaveBeenCalledWith('id.example', ['alice'], '0'.repeat(64));
    const {identity} = await create('user', {domain: 'alice.id.example', hosted});
    expect(identity.publicationPending).toBe(true);
    expect(mock.hosting.publish).not.toHaveBeenCalled();
    expect(mock.store.get('hosting:' + identity.id)).toEqual({domain: 'id.example', held: [], proofs: {}, unclaimed: 'alice'});
    await identityAction(1, {action: 'lock'});
    expect((await identityAction(1, {action: 'hostingStatus', id: identity.id})).unlocked).toBe(false);
    await expect(claim(identity.id)).rejects.toThrow('Unlock');
  });
  it('claims with supplied proofs, persists public state and publishes renewal and numbering', async() => {
    enableHosting();
    const {identity} = await create('user');
    const claimed = (await claim(identity.id)).identity;
    expect(claimed.domains).toEqual(['alice.example.org', 'alice.id.example']);
    expect(claimed.publicationPending).toBe(false);
    expect(mock.store.get('hosting:' + identity.id)).toMatchObject({domain: 'id.example', held: ['alice'], proofs: hosted.proofs});
    expect(mock.files.get(mock.store.get('identity:' + identity.id)[0]).secret.hosting).toEqual({domain: hosted.domain, held: ['alice'], proofs: hosted.proofs});
    const profile = mock.profiles.get(claimed.profile[0]);
    profile.notBefore = Date.now() / 1000 - 9000;
    profile.expiresAt = Date.now() / 1000 + 1000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.hosting.publish).toHaveBeenCalledTimes(2);
    expect(mock.hosting.publish.mock.lastCall[2].proofs).toEqual({});
    await numberIdentity(1, '42');
    expect(mock.hosting.publish).toHaveBeenCalledTimes(3);
    await identityAction(1, {action: 'home', id: identity.id, domain: 'dc2.example.org'});
    expect(mock.hosting.publish).toHaveBeenCalledTimes(4);
  });
  it.each(['user', 'channel'] as const)('exports %s claim routing and restores it without pending bytes', async(kind) => {
    enableHosting();
    const {identity} = await create(kind, {domain: 'alice.id.example', hosted});
    await claim(identity.id);
    const state = mock.store.get('hosting:' + identity.id);
    mock.store.set('hosting:' + identity.id, {...state, pending: {profile: [99], via: 'alice', labels: ['alice']}});
    const {backup} = await identityAction(1, {action: 'backup', id: identity.id});
    expect(mock.files.get(backup[0]).secret.hosting).toEqual({domain: hosted.domain, held: ['alice'], proofs: hosted.proofs});
    await identityAction(1, {action: 'lock'});
    mock.store.clear();
    const restored = await identityAction(1, {action: 'restore', backup, password: 'x'});
    expect(restored.identity.kind).toBe(kind);
    expect(restored.identity.hostedNames).toEqual({domain: hosted.domain, held: ['alice'], proofs: hosted.proofs});
    expect((await identityAction(1, {action: 'list', kind})).ids).toEqual([identity.id]);
  });
  it('merges imported claims without downgrading local held names, proofs or unanswered bytes', async() => {
    enableHosting();
    const {identity} = await create('channel', {domain: 'alice.id.example', hosted});
    await claim(identity.id);
    const {backup} = await identityAction(1, {action: 'backup', id: identity.id});
    await identityAction(1, {action: 'lock'});
    mock.store.delete('identity:' + identity.id);
    const pending = {profile: identity.profile, via: 'bob', labels: ['bob']};
    mock.store.set('hosting:' + identity.id, {domain: hosted.domain, held: ['bob'], proofs: {alice: [5]}, pending});
    mock.hosting.publish.mockRejectedValue(new TypeError('Offline'));
    await identityAction(1, {action: 'restore', backup, password: 'x'});
    expect(mock.store.get('hosting:' + identity.id)).toEqual({domain: hosted.domain, held: ['bob', 'alice'], proofs: {alice: [5]}, pending});
    await expect(identityAction(1, {action: 'restore', backup, password: 'x'})).rejects.toThrow('already exists');
  });
  it('never resurrects released held names from a stale sealed snapshot on unlock', async() => {
    enableHosting();
    const {identity} = await create('user', {domain: 'alice.id.example', hosted});
    await claim(identity.id);
    mock.store.set('hosting:' + identity.id, {domain: hosted.domain, held: [], proofs: {}});
    await identityAction(1, {action: 'lock'});
    const result = await identityAction(1, {action: 'unlock', id: identity.id, password: 'x'});
    expect(result.identity.hostedNames.held).toEqual([]);
  });
  it('claims and releases chat names through resource custody without touching the user signer', async() => {
    enableHosting();
    const {identity: user} = await create('user');
    await bindIdentity(1);
    const binding = mock.store.get('slot:1');
    const {identity} = await create('channel', {domain: 'alice.id.example', hosted, attempt: 'hosted-chat'});
    expect(identity.hostingAvailable).toBe(true);
    expect((await identityAction(1, {action: 'hostingPlan', id: identity.id, hosted})).hostingPlan.status).toBe('needsProof');
    expect((await identityAction(1, {action: 'hostingStatus', id: identity.id})).unlocked).toBe(true);
    expect((await identityAction(2, {action: 'hostingStatus', id: identity.id})).unlocked).toBe(false);
    await claim(identity.id);
    mock.hosting.publish.mockRejectedValueOnce(new TypeError('Lost numbered PUT'));
    await numberIdentity(1, '42', identity.id);
    const numbered = (await identityAction(1, {action: 'inspect', id: identity.id})).identity;
    expect(numbered.account).toBe('42');
    expect(numbered.publicationPending).toBe(true);
    const accountCalls = mock.diem.mock.calls.filter(([operation]) => operation === 'account').length;
    await identityAction(1, {action: 'retryPublication', id: identity.id});
    await numberIdentity(1, '42', identity.id);
    expect(mock.diem.mock.calls.filter(([operation]) => operation === 'account')).toHaveLength(accountCalls);
    await identityAction(1, {action: 'domains', id: identity.id, domains: ['own.example']});
    expect(mock.store.get('hosting:' + identity.id).held).toEqual([]);
    expect(await withIdentity(1, async(_secret, info) => info.id)).toBe(user.id);
    expect(mock.store.get('slot:1')).toBe(binding);
    await identityAction(1, {action: 'lock', id: identity.id});
    expect((await identityAction(1, {action: 'hostingStatus', id: identity.id})).unlocked).toBe(false);
    await expect(identityAction(1, {action: 'hostingPlan', id: identity.id, hosted})).rejects.toThrow('Unlock');
  });
  it('preserves other signed hosted names when restoring routing after import', async() => {
    enableHosting();
    const {identity} = await create('user', {domain: 'existing.id.example'});
    const {identity: claimed} = await claim(identity.id);
    expect(claimed.domains).toEqual(['existing.id.example', 'alice.id.example']);
  });
  it('releases through a still held name and uses the removed name for the last release', async() => {
    enableHosting();
    const {identity} = await create('user');
    await claim(identity.id);
    await claim(identity.id, {label: 'bob', proofs: {bob: [2]}});
    await identityAction(1, {action: 'domains', id: identity.id, domains: ['alice.example.org', 'bob.id.example']});
    expect(mock.hosting.publish.mock.lastCall[2].via).toBe('bob');
    await identityAction(1, {action: 'domains', id: identity.id, domains: ['alice.example.org']});
    expect(mock.hosting.publish.mock.lastCall[2].via).toBe('bob');
    expect(mock.store.get('hosting:' + identity.id).held).toEqual([]);
  });
  it('keeps unanswered PUT bytes and retries them before a newer revision', async() => {
    enableHosting();
    const {identity} = await create('user');
    mock.hosting.publish.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(claim(identity.id)).rejects.toMatchObject({type: 'BlahHostingUnreachable'});
    const saved = (await identityAction(1, {action: 'inspect', id: identity.id})).identity;
    expect(saved.publicationPending).toBe(true);
    expect(saved.hostedNames.pending.profile).toEqual(saved.profile);
    await identityAction(1, {action: 'renew', id: identity.id});
    expect(mock.hosting.publish.mock.calls[1][1]).toEqual(mock.hosting.publish.mock.calls[0][1]);
    expect(mock.hosting.publish.mock.calls[2][1]).not.toEqual(mock.hosting.publish.mock.calls[0][1]);
    expect((await identityAction(1, {action: 'inspect', id: identity.id})).identity.publicationPending).toBe(false);
  });
  it('reuses a cached proof when the host reports that a held name now needs proof', async() => {
    enableHosting();
    const {identity} = await create('user');
    await claim(identity.id);
    mock.hosting.publish.mockRejectedValueOnce({type: 'hostingProblem', code: 'proof-required', labels: [{label: 'alice'}]});
    await expect(identityAction(1, {action: 'renew', id: identity.id})).rejects.toMatchObject({type: 'BlahHostingProofFailed'});
    await identityAction(1, {action: 'retryPublication', id: identity.id});
    expect(mock.hosting.publish.mock.lastCall[2].proofs).toEqual(hosted.proofs);
  });
  it('reconciles an unanswered final release whose route is no longer held', async() => {
    enableHosting();
    const {identity} = await create('user');
    await claim(identity.id);
    mock.hosting.publish.mockRejectedValueOnce(new TypeError('Lost release response'));
    await expect(identityAction(1, {action: 'domains', id: identity.id, domains: ['alice.example.org']})).rejects.toMatchObject({type: 'BlahHostingUnreachable'});
    mock.hosting.publish.mockRejectedValueOnce({type: 'hostingProblem', code: 'host-not-listed'});
    const {identity: released} = await identityAction(1, {action: 'retryPublication', id: identity.id});
    expect(mock.hosting.plan).toHaveBeenCalledWith('id.example', ['alice'], identity.id);
    expect(released.hostedNames.held).toEqual([]);
    expect(released.hostedNames.pending).toBeUndefined();
    expect(released.publicationPending).toBe(false);
  });
  it('retains a refused claim and allows a replacement name, with localized structured errors', async() => {
    enableHosting();
    const {identity} = await create('user', {domain: 'alice.id.example', hosted});
    mock.hosting.publish.mockRejectedValueOnce({type: 'hostingProblem', code: 'name-taken'});
    await expect(claim(identity.id)).rejects.toMatchObject({type: 'BlahHostingTaken'});
    expect(mock.store.get('hosting:' + identity.id).pending).toBeUndefined();
    const {identity: replaced} = await claim(identity.id, {label: 'bob', proofs: {bob: [2]}});
    expect(replaced.domains).toEqual(['bob.id.example']);
    mock.hosting.publish.mockRejectedValueOnce({type: 'hostingProblem', code: 'rate-limited', retryAfter: 60});
    await expect(identityAction(1, {action: 'retryPublication', id: identity.id})).rejects.toMatchObject({type: 'BlahHostingRateLimited', retryAfter: 60});
  });
});
