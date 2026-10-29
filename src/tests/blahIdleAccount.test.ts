import {afterEach, expect, it, vi} from 'vitest';
import {ApiManager} from '@appManagers/apiManager';
import ApiManagerMethods from '@appManagers/apiManagerMethods';
import {AppMessagesManager} from '@appManagers/appMessagesManager';

afterEach(() => vi.useRealTimers());

it('refreshes an active config without waking unused account slots', async() => {
  vi.useFakeTimers();
  const unused = new ApiManager();
  const active = new ApiManager();
  const idleFetch = vi.spyOn(unused, 'getConfig').mockResolvedValue({} as any);
  const activeFetch = vi.spyOn(active, 'getConfig').mockResolvedValue({} as any);
  (active as any).config = {};

  await vi.advanceTimersByTimeAsync(10_000_000);

  expect(idleFetch).not.toHaveBeenCalled();
  expect(activeFetch).toHaveBeenCalledExactlyOnceWith(true);
});

it('initializes draft TTL from cached config and later events without fetching on construction', async() => {
  vi.useFakeTimers();
  const listeners = new Map<string, (...args: any[]) => any>();
  const rootScope = {
    addEventListener: (name: string, callback: (...args: any[]) => any) => listeners.set(name, callback),
    dispatchEvent: (name: string, value: unknown) => listeners.get(name)?.(value)
  };
  const manager = new AppMessagesManager() as any;
  const getAppConfig = vi.fn();
  Object.assign(manager, {
    rootScope,
    apiManager: {getAppConfig},
    apiUpdatesManager: {addMultipleEventsListeners: vi.fn()},
    appStateManager: {getState: async() => ({})}
  });
  await manager.after();
  expect(getAppConfig).not.toHaveBeenCalled();
  expect(manager.streamedMessageDraftTtl).toBe(30_000);

  const api = new ApiManager();
  Object.assign(api, {rootScope, appStateManager: {
    getState: async() => ({appConfig: {message_typing_draft_ttl: 7}})
  }});
  await (ApiManagerMethods.prototype as any).after.call(api);
  await listeners.get('managers_ready')();
  expect(manager.streamedMessageDraftTtl).toBe(7_000);
  rootScope.dispatchEvent('app_config', {message_typing_draft_ttl: 9});
  expect(manager.streamedMessageDraftTtl).toBe(9_000);
  rootScope.dispatchEvent('app_config', {message_typing_draft_ttl: -1});
  expect(manager.streamedMessageDraftTtl).toBe(30_000);
});
