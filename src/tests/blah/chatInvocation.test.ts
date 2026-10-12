import {beforeEach, expect, it, vi} from 'vitest';
import type MTPNetworker from '@lib/mtproto/networker';
const mock = vi.hoisted(() => ({lookup: vi.fn(), resource: vi.fn(), diem: vi.fn()}));
vi.mock('@config/blah', () => ({getBlahConfig: () => ({home: {identity: 'home'}})}));
vi.mock('@lib/blah/identity', () => ({chatIdentityForId: mock.lookup, withResourceIdentity: mock.resource}));
vi.mock('@lib/blah/wasm', () => ({diem: mock.diem}));
import {invokeBlah} from '@lib/blah/invoke';

beforeEach(() => {
  mock.lookup.mockReset();
  mock.resource.mockReset().mockImplementation((_slot, _id, action) => action({domain: 'news.example.org'}));
  mock.diem.mockReset().mockResolvedValue({proof: [8, 9]});
});

const requests = [
  ['channels.deleteChannel', {channel: {_: 'inputChannel', channel_id: 25, access_hash: '1'}}],
  ['channels.deleteChannel', {channel: {_: 'inputChannelFromMessage', channel_id: 25, peer: {_: 'inputPeerSelf'}, msg_id: 2}}],
  ['messages.editChatCreator', {peer: {_: 'inputPeerChannel', channel_id: 25, access_hash: '1'},
    user_id: {_: 'inputUserSelf'}, password: {_: 'inputCheckPasswordEmpty'}}]
] as const;

it.each(requests)('automatically routes %s by its chat identity and refuses locked custody without sending', async(method, params) => {
  const wrapApiCall = vi.fn().mockResolvedValue({data: [1], expires_at: 100});
  const networker = {dcId: 1, wrapApiCall, getIdentityBinding: () => ({keyID: '1', sessionID: '2'}), isStopped: () => false} as unknown as MTPNetworker;
  const identity = {id: 'chat-identity', domain: 'news.example.org', locked: false};
  mock.lookup.mockResolvedValue(identity);
  await invokeBlah(1, networker, method, params, {});
  expect(mock.lookup).toHaveBeenCalledWith(1, 25);
  expect(wrapApiCall.mock.calls.map(([method]) => method)).toEqual(['blah.requestIdentityChallenge', 'blah.invokeWithIdentityProof']);
  expect(wrapApiCall).toHaveBeenLastCalledWith('blah.invokeWithIdentityProof', expect.anything(), expect.objectContaining({blahResourceIdentity: identity.id}));
  expect(mock.resource).toHaveBeenCalledWith(1, identity.id, expect.any(Function), true, false);
  wrapApiCall.mockClear();
  mock.lookup.mockResolvedValue({...identity, locked: true});
  await expect(invokeBlah(1, networker, method, params, {})).rejects.toEqual({type: 'BLAH_CHAT_IDENTITY_LOCKED', id: identity.id, domain: identity.domain});
  expect(wrapApiCall).not.toHaveBeenCalled();
  mock.lookup.mockResolvedValue(undefined);
  const options = {ignoreErrors: true} as const;
  await invokeBlah(1, networker, method, params, options);
  expect(wrapApiCall).toHaveBeenCalledExactlyOnceWith(method, params, options);
});
