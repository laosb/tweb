import {expect, it, vi} from 'vitest';
import {create, state} from './identityFixture';
const clear = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@lib/sessionStorage', () => ({default: {localStorageProxy: clear}}));
vi.mock('@lib/commonStateStorage', () => ({default: {clear}}));
vi.mock('@lib/encryptedStorageLayer', () => ({default: {getInstance: () => ({clear})}}));
vi.mock('@lib/files/cacheStorage', () => ({default: {deleteAllStorages: clear}}));
vi.mock('@appManagers/appStoragesManager', () => ({AppStoragesManager: {clearAllStoresForAccount: clear}}));
vi.mock('@lib/rootScope', () => ({default: {dispatchEvent: clear}}));
vi.mock('@lib/blah/homeStorage', () => ({bindHomeStorage: vi.fn(), clearAccountCaches: vi.fn()}));
import {ApiManager} from '@appManagers/apiManager';

it('forgot-passcode force logout deletes every account slot but preserves chat custody and home pins', async() => {
  for(const slot of [1, 2, 3, 4]) {
    await create(slot);
    state.store.set('slot:' + slot, 'identity');
  }
  const chat = await create(1, 'channel');
  state.store.set('home:1', 'public-home');
  await ApiManager.forceLogOutAll();
  for(const slot of [1, 2, 3, 4]) {
    expect(state.store.has('custody:slot:' + slot)).toBe(false);
    expect(state.store.has('slot:' + slot)).toBe(false);
    expect(state.store.has('enrollment:' + slot)).toBe(false);
  }
  expect(state.store.has('custody:chat:' + chat.identity.id)).toBe(true);
  expect(state.store.get('home:1')).toBe('public-home');
  expect(clear).toHaveBeenCalledWith('logging_out', {});
});
