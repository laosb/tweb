import '@helpers/peerIdPolyfill';
import type {Updates} from '@layer';
import {beforeEach, expect, it, vi} from 'vitest';
const mock = vi.hoisted(() => ({store: new Map<string, any>(), account: '', save: vi.fn(), diem: vi.fn(), publication: vi.fn(), verify: vi.fn()}));
vi.mock('@config/blah', () => ({getBlahConfig: () => ({home: {identity: 'home'}})}));
vi.mock('@lib/blah/identity', () => ({
  identityAction: async() => ({identity: {id: 'resource', account: mock.account}}),
  publicationPending: mock.publication,
  withResourceIdentity: async(_slot: number, _id: string, action: (...args: any[]) => unknown) =>
    action({}, {account: mock.account, domains: ['news.example.org'], profile: [1]}, mock.save)
}));
vi.mock('@lib/blah/runtime', () => ({diemClient: async() => ({verifyProfile: mock.verify}), verifySignature: vi.fn()}));
vi.mock('@lib/blah/wasm', () => ({diem: mock.diem}));
vi.mock('@lib/blah/vault', () => ({stored: async(key: string, value?: unknown) => {
  if(value !== undefined) mock.store.set(key, value);
  return mock.store.get(key);
}}));
import {chatIdentityAction, ChatIdentityChange} from '@lib/blah/chatIdentity';

const chat = {_: 'channel', id: 25, title: 'News', pFlags: {creator: true}};
const updates = {_: 'updates', chats: [chat], users: [], updates: []} as Updates.updates;
function managers() {
  return {
    apiManager: {invokeApi: vi.fn().mockResolvedValue(updates)},
    apiUpdatesManager: {processUpdateMessage: vi.fn()},
    appChatsManager: {getChat: () => chat, getChannelInput: (id: number) => ({_: 'inputChannel', channel_id: id, access_hash: '1'}),
      getChannelInputPeer: (id: number) => ({_: 'inputPeerChannel', channel_id: id, access_hash: '1'}),
      onChatUpdated: vi.fn(), editTitle: vi.fn(), editAbout: vi.fn(), editPhoto: vi.fn()},
    appUsersManager: {getUserInput: (id: number) => ({_: 'inputUser', user_id: id})},
    appPeersManager: {getInputPeerById: (id: number) => ({_: 'inputPeerChannel', channel_id: -id})},
    appProfileManager: {modifyCachedFullChat: vi.fn()}
  };
}
function bind(manager: ReturnType<typeof managers>, change: ChatIdentityChange) {
  return chatIdentityAction(1, manager as any, {action: 'bind', id: 'resource', change});
}
beforeEach(() => {
  mock.store.clear(); mock.store.set('metadata:resource', {kind: 'channel'}); mock.account = '';
  mock.publication.mockReset().mockResolvedValue(false);
  mock.save.mockReset().mockImplementation(async(info) => { mock.account = info.account; });
  mock.diem.mockReset().mockImplementation(async(_op, _secret, extra) => extra);
  mock.verify.mockReset().mockResolvedValue({kind: 'channel', id: 'resource', home: {dc: 'home'}});
});

it('claims a bound chat for self with an empty password, its own proof and processed updates', async() => {
  const manager = managers();
  mock.store.set('metadata:resource', {kind: 'channel', chatId: 25});
  await chatIdentityAction(1, manager as any, {action: 'claim', id: 'resource'});
  expect(manager.apiManager.invokeApi).toHaveBeenCalledWith('messages.editChatCreator', {
    peer: {_: 'inputPeerChannel', channel_id: 25, access_hash: '1'},
    user_id: {_: 'inputUserSelf'}, password: {_: 'inputCheckPasswordEmpty'}
  }, {blahResourceIdentity: 'resource', ignoreErrors: true, rawError: true});
  expect(manager.apiUpdatesManager.processUpdateMessage).toHaveBeenCalledWith(updates);
  expect(mock.diem).not.toHaveBeenCalled();
});

it('rejects an unattached identity before attempting a claim', async() => {
  const manager = managers();
  await expect(chatIdentityAction(1, manager as any, {action: 'claim', id: 'resource'})).rejects.toThrow('bound chat');
  expect(manager.apiManager.invokeApi).not.toHaveBeenCalled();
});

it('routes all channel creation flags through resource proof and processes updates', async() => {
  const manager = managers();
  const options = {title: 'News', about: 'Description', megagroup: true, address: 'Somewhere', geo_point: {_: 'inputGeoPoint', lat: 1, long: 2}} as const;
  const result = await bind(manager, {action: 'createChannel', options});
  expect(manager.apiManager.invokeApi).toHaveBeenCalledWith('channels.createChannel', options, {blahResourceIdentity: 'resource', ignoreErrors: true, rawError: true});
  expect(manager.apiUpdatesManager.processUpdateMessage).toHaveBeenCalledWith(updates);
  expect(result.result).toEqual({chatId: 25, missingInvitees: []});
  expect(mock.diem).toHaveBeenCalledWith('account', {}, {account: '25'}, 1, 'channel');
});

it('numbers a createChat migration with the supergroup id, preserving missing invitees', async() => {
  const manager = managers();
  const migrated = {...updates, chats: [{...chat, id: 99}, {_: 'chat', id: 8, pFlags: {deactivated: true}, migrated_to: {_: 'inputChannel', channel_id: 25}}, chat]};
  manager.apiManager.invokeApi.mockResolvedValue({updates: migrated, missing_invitees: [{user_id: 7}]} as any);
  const result = await bind(manager, {action: 'createChat', title: 'Group', userIds: [7]});
  expect(result.result).toEqual({chatId: 25, missingInvitees: [{user_id: 7}]});
  expect(mock.diem).toHaveBeenCalledWith('account', {}, {account: '25'}, 1, 'channel');
  expect(manager.apiManager.invokeApi).toHaveBeenCalledOnce();
});

it.each(['title', 'about', 'photo', 'toggle'] as const)('wraps the first %s edit and sends remaining fields normally', async(field) => {
  const manager = managers();
  const photo = {_: 'inputFile', id: '1', parts: 1, name: 'photo', md5_checksum: ''} as const;
  const change: ChatIdentityChange = {action: 'edit', chatId: 25, title: 'News',
    ...(field === 'title' ? {changedTitle: 'New', about: 'Text', photo} : field === 'about' ? {about: 'Text', photo} : field === 'photo' ? {photo} : {})};
  await bind(manager, change);
  const method = field === 'about' ? 'messages.editChatAbout' : field === 'photo' ? 'channels.editPhoto' : 'channels.editTitle';
  expect(manager.apiManager.invokeApi).toHaveBeenCalledWith(method, expect.anything(), expect.objectContaining({blahResourceIdentity: 'resource'}));
  expect(manager.apiManager.invokeApi).toHaveBeenCalledOnce();
  expect(manager.appChatsManager.editAbout).toHaveBeenCalledTimes(field === 'title' ? 1 : 0);
  expect(manager.appChatsManager.editPhoto).toHaveBeenCalledTimes(field === 'title' || field === 'about' ? 1 : 0);
});

it('accepts CHAT_NOT_MODIFIED only after confirming the same channel identity', async() => {
  const manager = managers();
  manager.apiManager.invokeApi.mockRejectedValueOnce({type: 'CHAT_NOT_MODIFIED'}).mockResolvedValueOnce([{id: '25', profile: [1]}] as any);
  expect((await bind(manager, {action: 'edit', chatId: 25, title: 'News'})).result.chatId).toBe(25);
  expect(mock.verify).toHaveBeenCalled();
});

it('rejects a no-op without its own identity binding', async() => {
  const manager = managers();
  manager.apiManager.invokeApi.mockRejectedValueOnce({type: 'CHAT_NOT_MODIFIED'}).mockResolvedValueOnce([{id: '25', profile: [1]}] as any);
  mock.verify.mockResolvedValue({kind: 'channel', id: 'other', home: {dc: 'home'}});
  await expect(bind(manager, {action: 'edit', chatId: 25, title: 'News'})).rejects.toMatchObject({type: 'CHAT_NOT_MODIFIED'});
  expect(mock.diem).not.toHaveBeenCalled();
});

it.each([true, 'network'])('does not send an RPC when publication is %s', async(failure) => {
  const manager = managers();
  if(failure === true) mock.publication.mockResolvedValue(true);
  else mock.publication.mockRejectedValue(new Error('CORS'));
  await expect(bind(manager, {action: 'createChannel', options: {title: 'News', about: ''}})).rejects.toThrow(failure === true ? 'BLAH_PROFILE_NOT_PUBLISHED' : 'BLAH_PUBLICATION_CHECK_FAILED');
  expect(manager.apiManager.invokeApi).not.toHaveBeenCalled();
});

it('resumes after numbering failure without creating a second chat', async() => {
  const manager = managers();
  const change: ChatIdentityChange = {action: 'createChannel', options: {title: 'News', about: ''}};
  mock.diem.mockRejectedValueOnce(new Error('Could not save'));
  await expect(bind(manager, change)).rejects.toThrow('Could not save');
  expect(mock.store.get('metadata:resource')).toMatchObject({chatId: 25, title: 'News'});
  expect((await bind(manager, change)).result.chatId).toBe(25);
  expect(manager.apiManager.invokeApi).toHaveBeenCalledOnce();
});


it('resumes pending numbering and applies newly edited fields without another proof', async() => {
  const manager = managers();
  mock.diem.mockRejectedValueOnce(new Error('Could not save'));
  await expect(bind(manager, {action: 'edit', chatId: 25, title: 'News', changedTitle: 'First title'})).rejects.toThrow('Could not save');
  await bind(manager, {action: 'edit', chatId: 25, title: 'News', changedTitle: 'Second title'});
  expect(manager.apiManager.invokeApi).toHaveBeenCalledOnce();
  expect(manager.appChatsManager.editTitle).toHaveBeenCalledWith(25, 'Second title');
  expect(mock.store.get('metadata:resource').title).toBe('Second title');
});
