import {beforeEach, describe, expect, it, vi} from 'vitest';
import type MTPNetworker from '@lib/mtproto/networker';
import {TLDeserialization, TLSerialization} from '@lib/mtproto/tl_utils';

const mock = vi.hoisted(() => ({bind: vi.fn(), number: vi.fn(), use: vi.fn(), diem: vi.fn()}));
vi.mock('@config/blah', () => ({getBlahConfig: () => ({home: {identity: '0a0b'}})}));
vi.mock('@lib/blah/identity', () => ({bindIdentity: mock.bind, numberIdentity: mock.number, withIdentity: mock.use}));
vi.mock('@lib/blah/wasm', () => ({diem: mock.diem}));
vi.mock('@lib/blah/chatIdentity', () => ({chatIdentityAction: vi.fn()}));
vi.mock('@appManagers/blahDeviceLink', () => ({deviceLinkAction: vi.fn()}));
import {invokeBlah} from '@lib/blah/invoke';

const exportParams = {api_id: 12345, api_hash: 'hash', except_ids: [] as UserId[]};
const request = new Uint8Array([17, 1, 11]);
const response = new Uint8Array([19, 1, 22]);
const token = new Uint8Array([255, 254, 1]);

beforeEach(() => {
  vi.resetAllMocks();
  mock.bind.mockResolvedValue('alice.example.org');
  mock.use.mockImplementation((_slot, action) => action({domain: 'alice.example.org'}));
  mock.diem.mockResolvedValue({proof: [8, 9]});
});

function network(result: unknown = {_: 'auth.loginToken', token, expires: 100}) {
  const wrapApiCall = vi.fn(async(method: string) => method === 'blah.requestIdentityChallenge' ?
    {data: [1, 2], expires_at: 100} : result);
  const networker = {dcId: 1, wrapApiCall, getIdentityBinding: () => ({keyID: '1', sessionID: '2'}),
    isStopped: () => false} as unknown as MTPNetworker;
  return {networker, wrapApiCall};
}

function encoded(method: string, params: unknown) {
  const serializer = new TLSerialization();
  serializer.storeMethod(method, params);
  return serializer.getBytes(true);
}

describe('device-link MTProto proof boundary', () => {
  it('exports N request inside the device-link wrapper, without identity proof or QR secret', async() => {
    const {networker, wrapApiCall} = network();
    await invokeBlah(1, networker, 'auth.exportLoginToken', exportParams, {blahDeviceLink: request});
    expect(wrapApiCall).toHaveBeenCalledOnce();
    const [method, params] = wrapApiCall.mock.calls[0] as unknown as [string, any];
    expect(method).toBe('blah.invokeWithDeviceLink');
    expect(params.link).toEqual(request);
    const bytes = encoded(method, params);
    const reader = new TLDeserialization(bytes.buffer as ArrayBuffer);
    expect(reader.fetchInt() >>> 0).toBe(0xf7e9bfa5);
    expect(reader.fetchBytes()).toEqual(request);
    const inner = new TLSerialization();
    params.query(inner);
    expect(inner.getBytes(true)).toEqual(encoded('auth.exportLoginToken', exportParams));
    expect(mock.bind).not.toHaveBeenCalled();
    expect(mock.diem).not.toHaveBeenCalled();
  });

  it('signs the exact response-wrapped acceptance and sends those same bytes', async() => {
    const {networker, wrapApiCall} = network({_: 'authorization'});
    await invokeBlah(1, networker, 'auth.acceptLoginToken', {token}, {blahDeviceLink: response});
    expect(wrapApiCall.mock.calls.map(([method]) => method)).toEqual([
      'blah.requestIdentityChallenge', 'blah.invokeWithIdentityProof'
    ]);
    const proofInput = mock.diem.mock.calls[0][2];
    const expected = encoded('blah.invokeWithDeviceLink', {link: response,
      query: (serializer: TLSerialization) => serializer.storeMethod('auth.acceptLoginToken', {token})});
    expect(proofInput.query).toEqual(expected);
    const params = (wrapApiCall.mock.calls[1] as unknown as [string, any])[1];
    const wire = new TLSerialization();
    params.query(wire);
    expect(wire.getBytes(true)).toEqual(expected);
    expect(params.proof).toEqual(new Uint8Array([8, 9]));
  });

  it('recognizes nested loginTokenSuccess and completes the ordinary identity binding checks', async() => {
    const result = {_: 'auth.loginTokenSuccess', authorization: {_: 'auth.authorization', user: {id: 42}}};
    const {networker, wrapApiCall} = network(result);
    await expect(invokeBlah(1, networker, 'auth.exportLoginToken', exportParams, {})).resolves.toBe(result);
    expect(mock.number).toHaveBeenCalledExactlyOnceWith(1, '42');
    expect(wrapApiCall.mock.calls.map(([method]) => method)).toEqual([
      'blah.requestIdentityChallenge', 'blah.invokeWithIdentityProof',
      'blah.requestIdentityChallenge', 'blah.invokeWithIdentityProof'
    ]);
    expect(mock.diem.mock.calls[0][2].query).toEqual(encoded('auth.exportLoginToken', exportParams));
  });

  it('uses a fresh challenge and proof for each stale-profile acceptance retry', async() => {
    const {networker, wrapApiCall} = network();
    let challenge = 0;
    wrapApiCall.mockImplementation(async(method) => {
      if(method === 'blah.requestIdentityChallenge') return {data: [++challenge], expires_at: 100};
      throw {type: 'DEVICE_LINK_PROFILE_STALE'};
    });
    for(let i = 0; i < 2; ++i) {
      await expect(invokeBlah(1, networker, 'auth.acceptLoginToken', {token}, {blahDeviceLink: response}))
        .rejects.toMatchObject({type: 'DEVICE_LINK_PROFILE_STALE'});
    }
    expect(mock.diem.mock.calls.map(([, , input]) => input.challenge)).toEqual([[1], [2]]);
    expect(mock.diem.mock.calls[0][2].query).toEqual(mock.diem.mock.calls[1][2].query);
  });

  it('preserves SESSION_PASSWORD_NEEDED for the existing password continuation', async() => {
    const {networker, wrapApiCall} = network();
    const error = {type: 'SESSION_PASSWORD_NEEDED'};
    wrapApiCall.mockImplementation(async(method) => {
      if(method === 'blah.requestIdentityChallenge') return {data: [1], expires_at: 100};
      throw error;
    });
    await expect(invokeBlah(1, networker, 'auth.exportLoginToken', exportParams, {})).rejects.toBe(error);
    expect(mock.number).not.toHaveBeenCalled();
  });

  it.each(['LOGIN_TOKEN_EXPIRED', 'LOGIN_TOKEN_INVALID'])('does not retry terminal %s errors', async(type) => {
    const {networker, wrapApiCall} = network();
    wrapApiCall.mockImplementation(async(method) => {
      if(method === 'blah.requestIdentityChallenge') return {data: [1], expires_at: 100};
      throw {type};
    });
    await expect(invokeBlah(1, networker, 'auth.acceptLoginToken', {token}, {blahDeviceLink: response})).rejects.toEqual({type});
    expect(wrapApiCall).toHaveBeenCalledTimes(2);
  });

  it('refuses acceptance without a response and refuses wrapping unrelated methods', () => {
    const {networker, wrapApiCall} = network();
    expect(() => invokeBlah(1, networker, 'auth.acceptLoginToken', {token}, {})).toThrow();
    expect(() => invokeBlah(1, networker, 'help.getConfig', {}, {blahDeviceLink: request})).toThrow();
    expect(wrapApiCall).not.toHaveBeenCalled();
  });
});
