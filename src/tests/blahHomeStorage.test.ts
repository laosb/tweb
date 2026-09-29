import {IDBFactory} from 'fake-indexeddb';

let homeStorage: typeof import('@lib/blah/homeStorage');
let vault: typeof import('@lib/blah/vault');
const first = {domain: 'one.example.org', identity: 'ab'.repeat(32), generation: '1'};
const second = {domain: 'two.example.org', identity: 'cd'.repeat(32), generation: '1'};

beforeEach(async() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
  let queue = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {configurable: true, value: {
    request: (_name: string, action: () => Promise<void>) => {
      const result = queue.then(action);
      queue = result.catch(() => {});
      return result;
    }
  }});
  homeStorage = await import('@lib/blah/homeStorage');
  vault = await import('@lib/blah/vault');
});
afterEach(() => vi.unstubAllGlobals());

async function cache(name: string, store = 'users') {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put({id: 1}, 1);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

it('allows same-home and cross-home accounts without admitting a different home into a populated slot', async() => {
  await homeStorage.bindHomeStorage(first, 1);
  await cache('tweb-account-1');
  localStorage.setItem('account1', JSON.stringify({userId: 1, dc1_auth_key: 'a'.repeat(512)}));
  await homeStorage.bindHomeStorage(first, 2);
  await homeStorage.bindHomeStorage(second, 3);
  expect(await homeStorage.accountsShareHome(1, 2)).toBe(true);
  expect(await homeStorage.accountsShareHome(1, 3)).toBe(false);
  await expect(homeStorage.bindHomeStorage(second, 1)).rejects.toThrow('another Blah home');
  expect(await vault.stored('home:1')).toBe(JSON.stringify(first));
});

it('rejects unbound legacy and encrypted account caches, even beside a valid account', async() => {
  await cache('tweb-account-2', 'users__encrypted');
  await homeStorage.bindHomeStorage(first, 1);
  await expect(homeStorage.bindHomeStorage(second, 2)).rejects.toThrow('legacy account');
  localStorage.setItem('account3', JSON.stringify({userId: 1}));
  await expect(homeStorage.bindHomeStorage(second, 3)).rejects.toThrow('legacy account');
});

it('checks origin-wide legacy keys before creating the first home binding', async() => {
  localStorage.setItem('dc1_auth_key', JSON.stringify('a'.repeat(512)));
  await expect(homeStorage.bindHomeStorage(first)).rejects.toThrow('legacy account');
  localStorage.clear();
  await cache('tweb-common', 'localStorage__encrypted');
  await expect(homeStorage.bindHomeStorage(first)).rejects.toThrow('legacy account');
});

it('migrates old origin pins only to occupied identity slots and the original sign-in slot', async() => {
  await vault.stored('home', JSON.stringify(first));
  await vault.stored('dc-profile', {domain: first.domain});
  await vault.stored('slot:2', 'identity-two');
  await homeStorage.migrateHomeStorage();
  expect(await vault.stored('home:1')).toBe(JSON.stringify(first));
  expect(await vault.stored('home:2')).toBe(JSON.stringify(first));
  expect(await vault.stored('home:3')).toBeUndefined();
  expect(await vault.stored('dc-profile:2')).toEqual({domain: first.domain});
  await homeStorage.bindHomeStorage(second, 3);
  await homeStorage.migrateHomeStorage();
  expect(await vault.stored('home:3')).toBe(JSON.stringify(second));
});

it('moves home, profile and identity namespace together on logout, preserving encrypted custody', async() => {
  await homeStorage.bindHomeStorage(first, 1);
  await homeStorage.bindHomeStorage(second, 2);
  await vault.stored('slot:1', 'identity-one');
  await vault.stored('slot:2', 'identity-two');
  await vault.stored('dc-profile:2', {domain: second.domain});
  await vault.stored('identity:one', {ciphertext: 'preserved'});
  await homeStorage.shiftHomeStorage(1);
  expect(await vault.stored('home:1')).toBe(JSON.stringify(second));
  expect(await vault.stored('slot:1')).toBe('identity-two');
  expect(await vault.stored('dc-profile:1')).toEqual({domain: second.domain});
  expect(await vault.stored('home:2')).toBeNull();
  expect(await vault.stored('identity:one')).toEqual({ciphertext: 'preserved'});
  await homeStorage.bindHomeStorage(first, 2);
});
