import {expect, it, vi} from 'vitest';
import AppBusinessManager from '@/widget/managers/business';
import AppSeamlessLoginManager from '@/widget/managers/seamlessLogin';

it('saves profile intro stickers in the retained document manager with userFull references', () => {
  const manager = new AppBusinessManager();
  const saved = {_: 'document', id: 'saved'};
  const saveDoc = vi.fn(() => saved);
  manager.setManagersAndAccountNumber({appDocsManager: {saveDoc}} as any, 2);
  const sticker = {_: 'document', id: 'intro'};
  const intro = {_: 'businessIntro', title: 'Support', description: 'We can help', sticker} as any;
  expect(manager.saveBusinessIntro(123, intro)).toBe(intro);
  expect(intro.sticker).toBe(saved);
  expect(intro.title).toBe('Support');
  expect(intro.description).toBe('We can help');
  expect(saveDoc).toHaveBeenCalledWith(sticker, {type: 'userFull', userId: 123});
  expect(manager.saveBusinessIntro(123, undefined)).toBeUndefined();
  expect(saveDoc).toHaveBeenCalledTimes(1);
});

it('has no business review bootstrap, app-config/update listeners or account authorization requests', async() => {
  const dependency = new Proxy({}, {get(_target, method) { throw new Error('unexpected dependency ' + String(method)); }});
  for(const Manager of [AppBusinessManager, AppSeamlessLoginManager]) {
    const manager = new Manager();
    manager.setManagersAndAccountNumber({rootScope: dependency, apiUpdatesManager: dependency, apiManager: dependency} as any, 3);
    expect(manager.getAccountNumber()).toBe(3);
    expect((manager as any).after).toBeUndefined();
  }
  const business = new AppBusinessManager();
  await expect(business.resolveBusinessChatLink('unavailable')).rejects.toMatchObject({type: 'PEER_ID_INVALID'});
});

it('settles website authorization as the default URL flow without authorizing a bot or contacting MTProto', async() => {
  const manager = new AppSeamlessLoginManager();
  manager.setManagersAndAccountNumber({apiManager: new Proxy({}, {get() { throw new Error('unexpected URL authorization RPC'); }})} as any, 1);
  await expect(manager.requestUrlAuth('https://example.test', 123, 1, 0)).resolves.toEqual({_: 'urlAuthResultDefault'});
  await expect(manager.acceptUrlAuth('https://example.test', 123, 1, 0, true)).resolves.toEqual({_: 'urlAuthResultDefault'});
});

it('fails worker verification on missing methods and undefined results while recognizing exact baseline fixture errors', async() => {
  const {assertWorkerConsole} = await import('../../tests/widget/managerContracts.mjs');
  const ready = {level: 'ready', text: 'index.worker-test.js'};
  const records = (entry: {level: string, text: string}) => new Map([[0, ready], [1, entry]]);
  for(const text of ['manager[method] is not a function', 'RPC method getNewThing not found', 'Cannot read properties of undefined']) {
    expect(() => assertWorkerConsole(records({level: 'error', text}))).toThrow('worker JS/RPC contract errors');
  }
  expect(() => assertWorkerConsole(records({level: 'rejection', text: 'CODE#400 METHOD_NOT_FOUND'}))).not.toThrow();
  expect(() => assertWorkerConsole(records({level: 'rejection', text: 'new unexpected failure'}))).toThrow('worker JS/RPC contract errors');
});
