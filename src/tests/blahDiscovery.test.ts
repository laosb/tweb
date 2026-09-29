import {generateKeyPairSync, webcrypto} from 'node:crypto';
import type {DCDiscoveryResult} from '@blahdiem/diem';

const state = vi.hoisted(() => ({storage: new Map(), verify: vi.fn(), bind: vi.fn()}));
vi.mock('@lib/blah/runtime', () => ({diemClient: async() => ({verifyDCProfile: state.verify}), verifySignature: vi.fn()}));
vi.mock('@lib/blah/homeStorage', () => ({bindHomeStorage: state.bind, migrateHomeStorage: async() => {}}));
vi.mock('@lib/blah/vault', () => ({
  stored: async(key: string, value?: unknown) => value === undefined ? state.storage.get(key) : state.storage.set(key, value),
  exclusively: async(action: () => Promise<unknown>) => action(),
  encode: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64'),
  decode: (value: string) => new Uint8Array(Buffer.from(value, 'base64'))
}));

import {checkDCUpdate, connectDC, dcDomain, fetchDCProfile, profileConfig, restoreDC, transportKey} from '@lib/blah/discovery';

const {publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const version: DCDiscoveryResult = {
  id: 'ab'.repeat(32), generation: '9007199254740993', revision: '9007199254740994', digest: 'cd'.repeat(32),
  namespaceGeneration: '9007199254740995', expiresAt: '9999999999',
  transportPublicKey: publicKey.export({format: 'pem', type: 'pkcs1'}).toString(),
  endpoints: [{host: 'dc.example.org', port: 8443, tls: true, transport: 'webSocket', path: '/mtproto/ws?route=one%2Ftwo'}]
};
const saved = {domain: 'dc.example.org', profile: 'AQID', version};
const response = (body = new Uint8Array([1, 2, 3])) => new Response(body, {headers: {'Content-Type': 'application/cbor'}});

beforeEach(() => {
  state.storage.clear();
  state.bind.mockReset();
  state.verify.mockReset().mockResolvedValue(structuredClone(version));
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async() => response()));
});
afterEach(() => vi.unstubAllGlobals());

it('accepts a bare domain or HTTPS origin, and refuses URL injection', () => {
  expect(dcDomain(' HTTPS://DC.Example.ORG/ ')).toBe(saved.domain);
  for(const value of ['http://dc.example.org', 'user@dc.example.org', 'dc.example.org:443',
    'dc.example.org/path', 'dc.example.org?x=1', 'dc.example.org#x', 'dc..example.org', '-dc.example.org']) {
    expect(() => dcDomain(value)).toThrow();
  }
});

it('fetches credential-free CBOR with no redirects and a deadline', async() => {
  await expect(fetchDCProfile(saved.domain)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  expect(fetch).toHaveBeenCalledWith('https://dc.example.org/.well-known/blah/profile.cbor', expect.objectContaining({
    credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: expect.any(AbortSignal)
  }));
});

it('bounds streamed bodies as well as content-length and rejects HTTP/type errors', async() => {
  for(const result of [new Response('', {status: 503}), new Response('html'), response(new Uint8Array(100_001)),
    new Response(new Uint8Array(0), {headers: {'Content-Type': 'application/cbor', 'Content-Length': '100001'}})]) {
    vi.mocked(fetch).mockResolvedValueOnce(result);
    await expect(fetchDCProfile(saved.domain)).rejects.toThrow();
  }
});

it('imports PKCS#1 and SPKI RSA keys through WebCrypto and rejects unsupported keys', async() => {
  const expected = {modulus: Buffer.from(publicKey.export({format: 'jwk'}).n, 'base64url').toString('hex'), exponent: '010001'};
  for(const type of ['spki', 'pkcs1'] as const) {
    expect(await transportKey(publicKey.export({format: 'pem', type}).toString())).toEqual(expected);
  }
  const small = generateKeyPairSync('rsa', {modulusLength: 1024}).publicKey.export({format: 'pem', type: 'spki'}).toString();
  await expect(transportKey(small)).rejects.toThrow('2048');
  await expect(transportKey('not a key')).rejects.toThrow();
});

it('uses only verified client TLS WebSocket endpoints and preserves the signed path/query', async() => {
  const {config} = await profileConfig(saved.domain, new Uint8Array([1]));
  expect(config.home).toEqual({domain: saved.domain, identity: version.id, generation: '9007199254740995'});
  expect(config.dcs[0].url).toBe('wss://dc.example.org:8443/mtproto/ws?route=one%2Ftwo');
  for(const endpoints of [[], [{...version.endpoints[0], tls: false}], [{...version.endpoints[0], transport: 'tcp'}],
    [{...version.endpoints[0], path: '/a/../apiws'}]]) {
    state.verify.mockResolvedValueOnce({...version, endpoints});
    await expect(profileConfig(saved.domain, new Uint8Array([1]))).rejects.toThrow();
  }
});

it('pins identities and database generations while allowing forward profile and endpoint rotation', () => {
  for(const change of [{id: 'ef'.repeat(32)}, {namespaceGeneration: '2'}, {generation: '9007199254740992'},
    {revision: '9007199254740993'}, {digest: 'ef'.repeat(32)}]) {
    expect(() => checkDCUpdate(saved, saved.domain, {...version, ...change})).toThrow();
  }
  expect(() => checkDCUpdate(saved, 'other.example.org', version)).toThrow();
  expect(() => checkDCUpdate(saved, saved.domain, {...version, revision: '9007199254740995', digest: 'ef'.repeat(32)})).not.toThrow();
});

it('persists only verified profiles after cache admission and re-verifies on worker restore', async() => {
  const selected = await connectDC('dc.example.org');
  expect(state.bind).toHaveBeenCalledWith(selected.home, 1);
  expect(state.storage.get('dc-profile:1')).toEqual(saved);
  expect(await restoreDC()).toEqual(selected);
  expect(state.verify).toHaveBeenCalledTimes(2);
});

it('leaves the saved profile intact after signature, cache or identity rejection', async() => {
  state.storage.set('dc-profile:1', saved);
  state.verify.mockRejectedValueOnce(new Error('Invalid signature'));
  await expect(connectDC(saved.domain)).rejects.toThrow('signature');
  expect(state.bind).not.toHaveBeenCalled();
  state.bind.mockRejectedValueOnce(new Error('Legacy cache'));
  await expect(connectDC(saved.domain)).rejects.toThrow('Legacy');
  state.verify.mockResolvedValueOnce({...version, id: 'ef'.repeat(32)});
  await expect(connectDC(saved.domain)).rejects.toThrow('another DC');
  expect(state.storage.get('dc-profile:1')).toEqual(saved);
});

it('keeps independent home pins and version floors for accounts sharing an origin', async() => {
  const first = await connectDC(saved.domain, 1);
  const other = {...version, id: 'ef'.repeat(32), revision: '1', digest: '12'.repeat(32),
    endpoints: [{...version.endpoints[0], host: 'other.example.org'}]};
  state.verify.mockResolvedValueOnce(other);
  const second = await connectDC('other.example.org', 2);
  expect(second.home.identity).not.toBe(first.home.identity);
  expect(state.storage.get('dc-profile:1')).toEqual(saved);
  expect(state.storage.get('dc-profile:2').domain).toBe('other.example.org');
  expect(state.bind).toHaveBeenLastCalledWith(second.home, 2);
  state.verify.mockResolvedValueOnce(other);
  expect(await restoreDC(2)).toEqual(second);
  expect(await restoreDC(1)).toEqual(first);
  await expect(connectDC('other.example.org', 1)).rejects.toThrow('another DC');
});
