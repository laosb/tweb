import {createResourceProfileLookup, verifyResourceProfile} from '@lib/blah/resourceProfiles';
import type {PeerResourceProfile} from '@lib/blah/resourceProfileTypes';

import type {ProfileInfo} from '@blahdiem/diem';
import {verifySignature} from '@lib/blah/runtime';

const mocks = vi.hoisted(() => ({verify: vi.fn(), home: vi.fn()}));
vi.mock('@lib/blah/runtime', () => ({diemClient: async() => ({verifyProfile: mocks.verify}), verifySignature: vi.fn()}));
vi.mock('@config/blah', () => ({getBlahConfig: (slot: number) => ({home: mocks.home(slot)})}));
const verified: ProfileInfo = {
  id: 'ab'.repeat(32), kind: 'user', generation: '1', revision: '1', notBefore: '1', expiresAt: '2',
  lapsed: false, domains: ['alice.example.org', 'also.example.org'], home: {dc: 'cd'.repeat(32), account: '2', epoch: '1'}
};
const identity = {identityId: verified.id, domains: verified.domains, lapsed: false, kind: 'user'};
beforeEach(() => {
  mocks.verify.mockReset().mockResolvedValue(verified);
  mocks.home.mockReset().mockReturnValue({identity: verified.home.dc});
});

const missing: PeerResourceProfile = {status: 'missing', homeDomain: 'dc.example.org'};
const ids = (...values: number[]) => values as PeerId[];

afterEach(() => vi.useRealTimers());

it('batches concurrent lookups and collapses duplicates while preserving output order', async() => {
  const present: PeerResourceProfile = {status: 'present', profile: {_: 'blah.resourceProfile', id: '2', profile: new Uint8Array([42])}};
  const load = vi.fn(async() => [missing, present]);
  const get = createResourceProfileLookup(load);
  const first = get(1, ids(1, 2, 1));
  const second = get(1, ids(2));
  expect(await first).toEqual([missing, {status: 'present', identity}, missing]);
  expect(await second).toEqual([{status: 'present', identity}]);
  expect(mocks.verify).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledExactlyOnceWith(1, ids(1, 2));
});

it('limits batches to 100 resources', async() => {
  const load = vi.fn(async(_slot: number, peers: PeerId[]) => peers.map(() => missing));
  const get = createResourceProfileLookup(load);
  expect(await get(1, Array.from({length: 201}, (_, i) => i + 1) as PeerId[])).toHaveLength(201);
  expect(load.mock.calls.map(([, peers]) => peers.length)).toEqual([100, 100, 1]);
});

it('caches omissions for five minutes and then refreshes', async() => {
  vi.useFakeTimers({toFake: ['Date']});
  const load = vi.fn(async() => [missing]);
  const get = createResourceProfileLookup(load);
  await get(1, ids(1));
  await get(1, ids(1));
  expect(load).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 5 * 60_000);
  await get(1, ids(1));
  expect(load).toHaveBeenCalledTimes(2);
});

it('invalidates on account switches, including switching back', async() => {
  const load = vi.fn(async() => [missing]);
  const get = createResourceProfileLookup(load);
  await get(1, ids(1));
  await get(2, ids(1));
  await get(1, ids(1));
  expect(load.mock.calls).toEqual([[1, ids(1)], [2, ids(1)], [1, ids(1)]]);
});

it('does not turn failed requests into cached omissions', async() => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([missing]);
  const get = createResourceProfileLookup(load);
  await expect(get(1, ids(1))).rejects.toThrow('offline');
  expect(await get(1, ids(1))).toEqual([missing]);
  expect(load).toHaveBeenCalledTimes(2);
});

it('keeps in-flight results isolated across account switches', async() => {
  let finish: (value: PeerResourceProfile[]) => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
  .mockResolvedValue([undefined]);
  const get = createResourceProfileLookup(load);
  const old = get(1, ids(1));
  await Promise.resolve();
  expect(await get(2, ids(1))).toEqual([undefined]);
  finish([missing]);
  expect(await old).toEqual([missing]);
  expect(await get(2, ids(1))).toEqual([undefined]);
});

it.each(['user', 'bot', 'channel', 'stickerSet'] as const)('accepts the expected %s kind and preserves signed fields', async(kind) => {
  mocks.verify.mockResolvedValue({...verified, kind});
  const bytes = new Uint8Array([42]);
  expect(await verifyResourceProfile(2, kind === 'bot' ? 'user' : kind, '2', bytes)).toEqual({...identity, kind});
  expect(mocks.home).toHaveBeenCalledWith(2);
  expect(mocks.verify).toHaveBeenCalledWith(bytes, expect.any(Number), {verify: verifySignature});
});

it.each([
  ['user', 'channel'], ['user', 'dc'], ['channel', 'user'], ['channel', 'bot'], ['stickerSet', 'channel']
] as const)('rejects %s lookups with a %s profile', async(expected, kind) => {
  mocks.verify.mockResolvedValue({...verified, kind});
  expect(await verifyResourceProfile(1, expected, '2', new Uint8Array())).toBeUndefined();
});

it.each(['3', null])('rejects an own-home account mismatch (%s)', async(account) => {
  mocks.verify.mockResolvedValue({...verified, home: {...verified.home, account}});
  expect(await verifyResourceProfile(1, 'user', '2', new Uint8Array())).toBeUndefined();
});

it('accepts a foreign home with a different account namespace, but still checks kind', async() => {
  mocks.verify.mockResolvedValue({...verified, home: {...verified.home, dc: 'ef'.repeat(32), account: '999'}});
  expect(await verifyResourceProfile(1, 'user', '2', new Uint8Array())).toEqual(identity);
  expect(await verifyResourceProfile(1, 'channel', '2', new Uint8Array())).toBeUndefined();
});

it('accepts lapsed profiles', async() => {
  mocks.verify.mockResolvedValue({...verified, lapsed: true});
  expect(await verifyResourceProfile(1, 'user', '2', new Uint8Array())).toEqual({...identity, lapsed: true});
});

it('requires both the slot home binding and a profile home', async() => {
  mocks.home.mockReturnValueOnce(undefined);
  expect(await verifyResourceProfile(1, 'user', '2', new Uint8Array())).toBeUndefined();
  expect(mocks.verify).not.toHaveBeenCalled();
  mocks.verify.mockResolvedValue({...verified, home: null});
  expect(await verifyResourceProfile(1, 'user', '2', new Uint8Array())).toBeUndefined();
});

it('binds to the requested peer, never the untrusted resource envelope ID', async() => {
  const get = createResourceProfileLookup(async() => [{status: 'present',
    profile: {_: 'blah.resourceProfile', id: '2', profile: new Uint8Array([42])}}]);
  expect(await get(1, ids(3))).toEqual([undefined]);
});

it('treats verifier errors as unknown, preserving other results and omissions', async() => {
  mocks.verify.mockRejectedValueOnce(new Error('invalidSignature')).mockResolvedValueOnce({...verified, kind: 'channel'});
  const get = createResourceProfileLookup(async() => [
    {status: 'present', profile: {_: 'blah.resourceProfile', id: '2', profile: new Uint8Array([42])}},
    {status: 'present', profile: {_: 'blah.resourceProfile', id: '2', profile: new Uint8Array([43])}},
    missing
  ]);
  expect(await get(1, ids(2, -2, -3))).toEqual([undefined, {status: 'present', identity: {...identity, kind: 'channel'}}, missing]);
});
