import '@helpers/peerIdPolyfill';
import {AppProfileManager} from '@appManagers/appProfileManager';

vi.mock('@config/blah', () => ({default: {}, getBlahConfig: (slot: number) => ({home: {domain: `dc${slot}.example.org`}})}));

function manager() {
  const manager = new AppProfileManager();
  const invokeApi = vi.fn().mockResolvedValue([]);
  Object.assign(manager, {
    accountNumber: 2,
    apiManager: {invokeApi},
    appUsersManager: {getUserInput: (id: number) => ({_: 'inputUser', user_id: id, access_hash: '123'})},
    appChatsManager: {
      isChannel: (id: number) => id !== 5,
      isMonoforum: (id: number) => id === 6,
      getChannelInput: (id: number) => ({_: 'inputChannel', channel_id: id, access_hash: '456'})
    }
  });
  return {manager, invokeApi};
}

it('keeps user and channel IDs separate, matches IDs instead of positions, and ignores unsolicited results', async() => {
  const {manager: profileManager, invokeApi} = manager();
  const user = {_: 'blah.resourceProfile', id: '2', profile: new Uint8Array([1])};
  const channel = {_: 'blah.resourceProfile', id: '2', profile: new Uint8Array([2])};
  invokeApi.mockResolvedValueOnce([user, {...user, id: '99'}]).mockResolvedValueOnce([channel]);
  expect(await profileManager.getBlahResourceProfiles([1, -2, 2, -3])).toEqual([
    {status: 'missing', homeDomain: 'dc2.example.org'},
    {status: 'present', profile: channel},
    {status: 'present', profile: user},
    {status: 'missing', homeDomain: 'dc2.example.org'}
  ]);
  expect(invokeApi.mock.calls).toEqual([
    ['blah.getUserProfile', {id: [1, 2].map((user_id) => ({_: 'inputUser', user_id, access_hash: '123'}))}],
    ['blah.getChannelProfile', {id: [2, 3].map((channel_id) => ({_: 'inputChannel', channel_id, access_hash: '456'}))}]
  ]);
});

it('does not classify basic groups or monoforums as missing identities', async() => {
  const {manager: profileManager, invokeApi} = manager();
  expect(await profileManager.getBlahResourceProfiles([-5, -6])).toEqual([undefined, undefined]);
  expect(invokeApi).not.toHaveBeenCalled();
});

it('never converts an RPC error to an absent identity', async() => {
  const {manager: profileManager, invokeApi} = manager();
  invokeApi.mockRejectedValue(new Error('unavailable'));
  await expect(profileManager.getBlahResourceProfiles([-1])).rejects.toThrow('unavailable');
});

it('splits direct manager requests at the server limit', async() => {
  const {manager: profileManager, invokeApi} = manager();
  await profileManager.getBlahResourceProfiles(Array.from({length: 101}, (_, i) => i + 1));
  expect(invokeApi.mock.calls.map(([, params]) => params.id.length)).toEqual([100, 1]);
});
