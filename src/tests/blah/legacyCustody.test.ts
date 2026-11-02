import {IDBFactory} from 'fake-indexeddb';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';

beforeEach(() => {
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', {configurable: true, value: {request: (name: string, action: () => Promise<unknown>) => {
    const result = (queues.get(name) || Promise.resolve()).then(action);
    queues.set(name, result.catch(() => {}));
    return result;
  }}});
});
afterEach(() => vi.unstubAllGlobals());
it('discards old password custody and marks its slots for logout while retaining managed sessions and public pins', async() => {
  const indexedDB = new IDBFactory(); vi.stubGlobal('indexedDB', indexedDB); vi.resetModules();
  const old = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open('blah-browser-identities-v2', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vault');
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve) => {
    const tx = old.transaction('vault', 'readwrite'); const store = tx.objectStore('vault');
    store.put(new Uint8Array([1, 2]), 'identity:alice'); store.put('alice-at-home', 'slot:1');
    store.put('managed-account', 'slot:2'); store.put('public-home', 'home:1');
    store.put({domain: 'dc.example.org'}, 'dc-profile:1'); tx.oncomplete = () => resolve();
  });
  old.close();
  const {stored} = await import('@lib/blah/vault');
  expect(await stored('reset-slot:1')).toBe(true); expect(await stored('slot:1')).toBeUndefined();
  expect(await stored('slot:2')).toBe('managed-account'); expect(await stored('home:1')).toBe('public-home');
  expect(await stored('identity:alice')).toBeUndefined();
  expect((await indexedDB.databases()).map((db) => db.name)).not.toContain('blah-browser-identities-v2');
});

it('recovers blocked discard after the old tab closes, including a caller already taking custody access', async() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const old = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open('blah-browser-identities-v2', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vault');
    request.onsuccess = () => resolve(request.result);
  });
  const {stored, exclusively} = await import('@lib/blah/vault');
  await expect(exclusively(() => stored('slot:2'))).rejects.toThrow('Close older Blah tabs');
  old.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await expect(exclusively(() => stored('slot:2', 'managed-account'))).resolves.toBe('managed-account');
  expect((await indexedDB.databases()).some((db) => db.name === 'blah-browser-identities-v2')).toBe(false);
});
