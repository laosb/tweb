import {describe, expect, it, vi} from 'vitest';
import {parseSync} from '@babel/core';
import {assertWidgetManagerCalls, assertWidgetManagerSource} from '../../scripts/widget-manager-contracts';
import {AppCallsManager} from '@/widget/managers/calls';
import {AppGroupCallsManager} from '@/widget/managers/groupCalls';

const contracts = new Map([
  ['appCallsManager', new Set<string>()],
  ['appGroupCallsManager', new Set(['saveGroupCall', 'getGroupCallFull'])]
]);
const check = (source: string) => assertWidgetManagerCalls(parseSync(source, {configFile: false}), contracts, 'test.ts');

describe('widget manager build guard', () => {
  it('checks worker ingestion, page proxies, acknowledged calls and literal access', () => {
    check('this.appGroupCallsManager.saveGroupCall(call);');
    check('rootScope.managers.acknowledged.appGroupCallsManager.getGroupCallFull(1);');
    check('managers["appGroupCallsManager"]["saveGroupCall"](call);');
    check('managers.appGroupCallsManager?.saveGroupCall(call);');
    check('const managers = {appCallsManager: new Calls(), appGroupCallsManager: new GroupCalls()};');
    expect(() => check('this.managers.appCallsManager.requestCall(1);')).toThrow('missing appCallsManager.requestCall');
    expect(() => check('rootScope.managers.acknowledged.appGroupCallsManager.getNewCallMethod();')).toThrow('missing appGroupCallsManager.getNewCallMethod');
  });

  it.each([
    'const alias = managers.appCallsManager; alias.requestCall();',
    'const {appCallsManager: alias} = managers;',
    'consume(managers.appCallsManager);',
    'managers.appCallsManager[method]();',
    'const name = "appCallsManager"; managers[name].requestCall();'
  ])('fails closed on manager aliases, escapes and dynamic methods: %s', source => {
    expect(() => check(source)).toThrow('WIDGET_MANAGER_CONTRACT:');
  });

  it('requires a fresh audit when upstream ingestion, events or lifecycle changes', () => {
    expect(() => assertWidgetManagerSource('new after() or listener', 'old hash', 'manager.ts')).toThrow('WIDGET_MANAGER_SOURCE_CHANGED');
  });
});

describe('widget call managers', () => {
  it('wires through the account base without installing call listeners, timers or caches', () => {
    const rootScope = {myId: 123, addEventListener: vi.fn(), dispatchEvent: vi.fn()};
    const apiUpdatesManager = {addMultipleEventsListeners: vi.fn()};
    const interval = vi.spyOn(globalThis, 'setInterval');
    for(const Manager of [AppCallsManager, AppGroupCallsManager]) {
      const manager = new Manager();
      manager.setManagersAndAccountNumber({rootScope, apiUpdatesManager} as any, 1);
      expect(manager.getAccountNumber()).toBe(1);
      expect((manager as any).after).toBeUndefined();
    }
    expect(rootScope.addEventListener).not.toHaveBeenCalled();
    expect(rootScope.dispatchEvent).not.toHaveBeenCalled();
    expect(apiUpdatesManager.addMultipleEventsListeners).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    interval.mockRestore();
  });

  it('accepts profile and service-message descriptors, and settles inherited entry points before any RPC', async() => {
    const manager = new AppGroupCallsManager();
    manager.setManagersAndAccountNumber({rootScope: {myId: 123}, apiManager: new Proxy({}, {
      get() { throw new Error('unexpected call RPC'); }
    })} as any, 1);
    const call = {_: 'inputGroupCall', id: '1', access_hash: '2'} as const;
    expect(manager.saveGroupCall(call)).toBe(call);
    expect(await manager.getGroupCallJoinAs(123)).toEqual({peerIds: [], defaultPeerId: 123});
    await expect(manager.saveDefaultGroupCallJoinAs(123, 123)).resolves.toBeUndefined();
    for(const promise of [
      manager.getGroupCallFull('1'), manager.createGroupCall(123),
      manager.resolveConferenceCallPreview(call), manager.fetchRtmpState(call),
      manager.fetchRtmpPart({} as any, 1)
    ]) await expect(promise).rejects.toMatchObject({type: 'GROUPCALL_INVALID'});
  });
});
