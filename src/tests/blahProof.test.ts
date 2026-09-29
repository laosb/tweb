import {describe, expect, it, vi} from 'vitest';
import type MTPNetworker from '@lib/mtproto/networker';
import {TLSerialization} from '@lib/mtproto/tl_utils';
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
