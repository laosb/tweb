import {describe, expect, it, vi} from 'vitest';
import type MTPNetworker from '@lib/mtproto/networker';
import {TLDeserialization, TLSerialization} from '@lib/mtproto/tl_utils';
import Schema from '@lib/mtproto/schema';
const mocks = vi.hoisted(() => ({diem: vi.fn(), bind: vi.fn(), number: vi.fn()}));
vi.mock('@config/blah', () => ({getBlahConfig: () => ({home: {identity: 'ab'.repeat(32)}})}));
vi.mock('@lib/blah/identity', () => ({
  bindIdentity: mocks.bind,
  numberIdentity: mocks.number,
  withIdentity: (_slot: number, action: (secret: object) => unknown) => action({})
}));
vi.mock('@lib/blah/wasm', () => ({diem: mocks.diem}));
import {invokeBlah, provenCall} from '@lib/blah/invoke';

function connection() {
  let binding = {keyID: '123', sessionID: '456'};
  const wrapApiCall = vi.fn(async(method: string, params: any) => {
    if(method === 'blah.requestIdentityChallenge') return {data: [1, 2], expires_at: 100};
    if(method === 'blah.invokeWithIdentityProof') {
      const serializer = new TLSerialization();
      params.query(serializer);
      return serializer.getBytes(true);
    }
    return true;
  });
  return {networker: {dcId: 1, wrapApiCall, getIdentityBinding: () => binding, isStopped: () => false} as unknown as MTPNetworker,
    wrapApiCall, change: () => { binding = {keyID: '999', sessionID: '777'}; }};
}

beforeEach(() => {
  mocks.bind.mockResolvedValue('alice.example.org');
  mocks.diem.mockResolvedValue({proof: [8, 9]});
  mocks.number.mockReset();
});

describe('Blah invocation boundary', () => {
  it('registers the layer-1 constructor and method IDs from Schemas/blah.tl', () => {
    const constructors = {
      'blah.identityChallenge': 0x2b2e0aab,
      'blah.resourceProfile': 0xc0d31b67
    };
    const methods = {
      'blah.requestIdentityChallenge': 0xdceefd53,
      'blah.invokeWithIdentityProof': 0x61b4c668,
      'blah.getUserProfile': 0x517800c0,
      'blah.getChannelProfile': 0x8344006d,
      'blah.getStickerSetProfile': 0xff5c6967
    };
    for(const [name, id] of Object.entries(constructors)) {
      expect(Schema.API.constructors.filter((entry) => entry.predicate === name).map((entry) => entry.id >>> 0)).toEqual([id]);
    }
    for(const [name, id] of Object.entries(methods)) {
      expect(Schema.API.methods.filter((entry) => entry.method === name).map((entry) => entry.id >>> 0)).toEqual([id]);
    }
  });

  it('writes the new proof ID and decodes resource vectors including 64-bit IDs', () => {
    const proof = new TLSerialization();
    proof.storeMethod('blah.invokeWithIdentityProof', {proof: new Uint8Array([1]), query: (serializer: TLSerialization) => {
      return serializer.storeMethod('blah.getUserProfile', {id: [{_: 'inputUserSelf'}]});
    }});
    expect(new DataView(proof.getBuffer()).getUint32(0, true)).toBe(0x61b4c668);
    const profiles = [{_: 'blah.resourceProfile', id: '9007199254740993', profile: new Uint8Array([1, 2, 3])}];
    const wire = new TLSerialization();
    wire.storeObject(profiles, 'Vector<blah.ResourceProfile>');
    expect(new TLDeserialization(wire.getBuffer()).fetchObject('Vector<blah.ResourceProfile>')).toEqual(profiles);
  });

  it('signs and transmits the identical boxed query with the live transport binding', async() => {
    const {networker, wrapApiCall} = connection();
    const result = await provenCall(1, networker, 'account.getAuthorizations', {});
    const parameters = mocks.diem.mock.calls[mocks.diem.mock.calls.length - 1][2];
    expect(parameters).toMatchObject({keyID: '123', sessionID: '456', challengeKind: 'invocation',
      challenge: [1, 2], approvedChallenge: [1, 2], expiresAt: 100});
    expect(result).toEqual(parameters.query);
    expect(wrapApiCall.mock.calls.map(([method]) => method)).toEqual(['blah.requestIdentityChallenge', 'blah.invokeWithIdentityProof']);
  });

  it('refuses a session rotation while the proof is being made', async() => {
    const {networker, change, wrapApiCall} = connection();
    mocks.diem.mockImplementationOnce(async() => { change(); return {proof: [1]}; });
    await expect(provenCall(1, networker, 'account.getAuthorizations', {})).rejects.toThrow('session changed');
    expect(wrapApiCall).toHaveBeenCalledTimes(1);
  });

  it('observes the transport only after a cold PFS challenge has established its key', async() => {
    const {networker, wrapApiCall} = connection();
    const binding = networker.getIdentityBinding;
    networker.getIdentityBinding = () => {
      expect(wrapApiCall).toHaveBeenCalledWith('blah.requestIdentityChallenge', expect.anything(), expect.anything());
      return binding();
    };
    await provenCall(1, networker, 'account.getAuthorizations', {});
  });

  it('gets a new single-use challenge for every attempt', async() => {
    const {networker, wrapApiCall} = connection();
    await provenCall(1, networker, 'account.getAuthorizations', {});
    await provenCall(1, networker, 'account.getAuthorizations', {});
    expect(wrapApiCall.mock.calls.filter(([method]) => method === 'blah.requestIdentityChallenge')).toHaveLength(2);
  });

  it('preserves synchronous enqueue of ordinary calls and refuses foreign numeric DCs', async() => {
    const {networker, wrapApiCall} = connection();
    const promise = invokeBlah(1, networker, 'help.getConfig', {}, {});
    expect(wrapApiCall).toHaveBeenCalledOnce();
    expect(await promise).toBe(true);
    networker.dcId = 2;
    expect(() => invokeBlah(1, networker, 'help.getConfig', {}, {})).toThrow('Wrong Blah home');
  });

  it('does not turn media authorization import into an interactive identity login', async() => {
    const {networker, wrapApiCall} = connection();
    wrapApiCall.mockResolvedValueOnce({_: 'auth.authorization', user: {id: 5}} as any);
    await invokeBlah(1, networker, 'auth.importAuthorization', {}, {});
    expect(mocks.number).not.toHaveBeenCalled();
  });
});
