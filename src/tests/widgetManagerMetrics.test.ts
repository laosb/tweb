import {expect, it, vi} from 'vitest';
import AppStatisticsManager from '@/widget/managers/statistics';
import AppBoostsManager from '@/widget/managers/boosts';
import {parseSync} from '@babel/core';
import {assertWidgetManagerCalls} from '../../scripts/widget-manager-contracts';

it('keeps statistics and boosts registry slots without work or account state', () => {
  const managerTrap = new Proxy({}, {get(_target, method) { throw new Error('unexpected dependency ' + String(method)); }});
  const interval = vi.spyOn(globalThis, 'setInterval');
  for(const Manager of [AppStatisticsManager, AppBoostsManager]) {
    const manager = new Manager();
    manager.setManagersAndAccountNumber({rootScope: managerTrap, apiManager: managerTrap, apiUpdatesManager: managerTrap} as any, 2);
    expect(manager.getAccountNumber()).toBe(2);
    expect((manager as any).after).toBeUndefined();
    expect((manager as any).clear).toBeUndefined();
    expect(Object.getOwnPropertyNames(Manager.prototype)).toEqual(['constructor']);
  }
  expect(interval).not.toHaveBeenCalled();
  interval.mockRestore();
});

it.each(['appStatisticsManager', 'appBoostsManager'])('rejects new page or worker consumers of %s', manager => {
  const methods = new Map([[manager, new Set<string>()]]);
  const program = parseSync(`rootScope.managers.${manager}.getNewFeature();`, {configFile: false});
  expect(() => assertWidgetManagerCalls(program, methods, 'future-consumer.ts')).toThrow('missing ' + manager + '.getNewFeature');
});
