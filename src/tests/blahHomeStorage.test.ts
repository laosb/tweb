import {IDBFactory} from 'fake-indexeddb';

let homeStorage: typeof import('@lib/blah/homeStorage');
let vault: typeof import('@lib/blah/vault');
let accountStorage: typeof import('@lib/blah/accountStorage');
let accounts: typeof import('@lib/accounts/accountController')['default'];
const session = vi.hoisted(() => ({encrypted: new Map<string, unknown>(), passcode: false, flush: vi.fn()}));
vi.mock('@config/debug', () => ({MOUNT_CLASS_TO: {}}));
vi.mock('@lib/passcode/deferredIsUsingPasscode', () => ({default: {isUsingPasscode: async() => session.passcode}}));
vi.mock('@lib/sessionStorage', () => ({default: {
  get: async(key: string) => session.passcode && /^(account\d|user_auth|dc|auth_key_fingerprint)$/.test(key) ?
    session.encrypted.get(key) : JSON.parse(localStorage.getItem(key) || 'null'),
  set: async(values: Record<string, unknown>) => {
    for(const [key, value] of Object.entries(values)) {
      if(session.passcode && /^(account\d|user_auth|dc|auth_key_fingerprint)$/.test(key)) session.encrypted.set(key, value);
      else localStorage.setItem(key, JSON.stringify(value));
    }
  },
  delete: async(key: string) => { session.encrypted.delete(key); localStorage.removeItem(key); },
  localStorageProxy: async(_type: string, key: string) => { localStorage.removeItem(key); },
  encryptedStorageProxy: session.flush
}}));
const first = {domain: 'one.example.org', identity: 'ab'.repeat(32), generation: '1'};
const second = {domain: 'two.example.org', identity: 'cd'.repeat(32), generation: '1'};

beforeEach(async() => {
  vi.resetModules();
  vi.stubGlobal('__BLAH_CONFIG__', {discovery: true, defaultDcId: 1, dcs: []});
  session.passcode = false;
  session.encrypted.clear();
  session.flush.mockReset();
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
  accountStorage = await import('@lib/blah/accountStorage');
  accounts = (await import('@lib/accounts/accountController')).default;
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

async function cacheCount(name: string, store = 'users') {
  return new Promise<number>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(store);
      const count = tx.objectStore(store).count();
      tx.oncomplete = () => { db.close(); resolve(count.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
}

it('clears an incompatible home while preserving other slots and encrypted identity custody', async() => {
  await homeStorage.bindHomeStorage(first, 1);
  await cache('tweb-account-1');
  localStorage.setItem('account1', JSON.stringify({userId: 1, dc1_auth_key: 'a'.repeat(512)}));
  await homeStorage.bindHomeStorage(first, 2);
  await homeStorage.bindHomeStorage(second, 3);
  localStorage.setItem('account3', JSON.stringify({userId: 3, dc1_auth_key: 'b'.repeat(512)}));
  await cache('tweb-account-3');
  await vault.storeEntries([
    ['slot:1', 'identity-one'], ['slot:3', 'identity-three'],
    ['identity:one', {ciphertext: 'preserved'}], ['dc-profile:1', {domain: first.domain}]
  ]);
  expect(await homeStorage.accountsShareHome(1, 2)).toBe(true);
  expect(await homeStorage.accountsShareHome(1, 3)).toBe(false);
  await homeStorage.bindHomeStorage(second, 1);
  await accountStorage.prepareAccountStorage();
  expect(await accounts.get(1)).toEqual({});
  expect(await cacheCount('tweb-account-1')).toBe(0);
  expect(await cacheCount('tweb-account-3')).toBe(1);
  expect(await accounts.getAccountNumbers()).toEqual([3]);
  expect(await accounts.getAvailableAccount()).toBe(1);
  expect(await vault.stored('home:1')).toBe(JSON.stringify(second));
  expect(await vault.stored('dc-profile:1')).toBeNull();
  expect(await vault.stored('slot:1')).toBeNull();
  expect(await vault.stored('slot:3')).toBe('identity-three');
  expect(await vault.stored('identity:one')).toEqual({ciphertext: 'preserved'});
  expect(localStorage.getItem('number_of_accounts')).toBe('1');
  expect(await accountStorage.requireAccountBinding(1)).toBe(false);
});

it('clears unbound legacy and encrypted account caches, even beside a valid account', async() => {
  await cache('tweb-account-2', 'users__encrypted');
  await homeStorage.bindHomeStorage(first, 1);
  await homeStorage.bindHomeStorage(second, 2);
  localStorage.setItem('account3', JSON.stringify({userId: 1}));
  await homeStorage.bindHomeStorage(second, 3);
  await accountStorage.prepareAccountStorage();
  expect(await cacheCount('tweb-account-2', 'users__encrypted')).toBe(0);
  expect(await accounts.get(3)).toEqual({});
  expect(await vault.stored('home:1')).toBe(JSON.stringify(first));
});

it('clears origin-wide legacy keys and old caches so migration cannot restore the session', async() => {
  localStorage.setItem('dc1_auth_key', JSON.stringify('a'.repeat(512)));
  localStorage.setItem('dc255_auth_key', JSON.stringify('b'.repeat(512)));
  localStorage.setItem('dc255_server_salt', JSON.stringify('c'.repeat(16)));
  localStorage.setItem('user_auth', JSON.stringify({id: 1}));
  localStorage.setItem('auth_key_fingerprint', JSON.stringify('aaaaaaaa'));
  await cache('tweb', 'session');
  await cache('telegram', 'users');
  await accountStorage.prepareAccountStorage();
  for(const key of ['dc1_auth_key', 'dc255_auth_key', 'dc255_server_salt', 'user_auth', 'auth_key_fingerprint']) {
    expect(localStorage.getItem(key)).toBeNull();
  }
  expect(await cacheCount('tweb', 'session')).toBe(0);
  expect(await cacheCount('telegram', 'users')).toBe(0);
});

it('clears signed-in sessions without a Diem binding, but keeps compatible sessions and signed-out transport keys', async() => {
  for(const slot of [1, 2, 3] as const) await homeStorage.bindHomeStorage(first, slot);
  await accounts.update(1, {userId: 1, dc1_auth_key: 'a'.repeat(512)});
  await accounts.update(2, {userId: 2, dc1_auth_key: 'b'.repeat(512)});
  await accounts.update(3, {dc1_auth_key: 'c'.repeat(512)});
  await vault.stored('slot:2', 'identity-two');
  await cache('tweb-account-1', 'session');
  await accountStorage.prepareAccountStorage();
  expect(await accounts.get(1)).toEqual({});
  expect(await cacheCount('tweb-account-1', 'session')).toBe(0);
  expect(await accounts.get(2)).toMatchObject({userId: 2, dc1_auth_key: 'b'.repeat(512)});
  expect(await accounts.get(3)).toMatchObject({dc1_auth_key: 'c'.repeat(512)});
});

it('removes only the incompatible credentials from shared passcode storage after unlocking', async() => {
  await homeStorage.bindHomeStorage(first, 1);
  await homeStorage.bindHomeStorage(second, 2);
  await vault.stored('slot:2', 'identity-two');
  session.passcode = true;
  session.encrypted.set('account1', {userId: 1, dc1_auth_key: 'a'.repeat(512)});
  localStorage.setItem('account1', JSON.stringify({userId: 1, dc1_auth_key: 'old-plaintext'}));
  const preserved = {userId: 2, dc1_auth_key: 'b'.repeat(512), auth_key_fingerprint: 'bbbbbbbb', push_key: 'push'};
  session.encrypted.set('account2', preserved);
  await cache('tweb-account-1', 'session__encrypted');
  await cache('tweb-account-2', 'users__encrypted');
  await cache('tweb-common', 'session');
  await accountStorage.prepareAccountStorage();
  expect(session.encrypted.get('account1')).toEqual({});
  expect(localStorage.getItem('account1')).toBeNull();
  expect(session.encrypted.get('account2')).toEqual(preserved);
  expect(await cacheCount('tweb-account-1', 'session__encrypted')).toBe(0);
  expect(await cacheCount('tweb-account-2', 'users__encrypted')).toBe(1);
  expect(await cacheCount('tweb-common', 'session')).toBe(1);
  expect(session.flush).toHaveBeenCalledWith('reEncrypt');
});

it('retries an interrupted reset before allowing the slot to be restored', async() => {
  await homeStorage.bindHomeStorage(first, 1);
  await accounts.update(1, {userId: 1});
  const update = vi.spyOn(accounts, 'update').mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(accountStorage.prepareAccountStorage()).rejects.toThrow('Storage unavailable');
  expect(await vault.stored('reset-slot:1')).toBe(true);
  update.mockRestore();
  await accountStorage.prepareAccountStorage();
  expect(await accounts.get(1)).toEqual({});
  expect(await vault.stored('reset-slot:1')).toBeNull();
});

it('preserves test-mode sessions and unrelated databases when clearing a production slot', async() => {
  localStorage.setItem('account1', JSON.stringify({userId: 1}));
  localStorage.setItem('t_account1', JSON.stringify({userId: 2}));
  await cache('tweb-account-1');
  await cache('tweb-account-1_test');
  await cache('tweb-unrelated');
  await accountStorage.prepareAccountStorage();
  expect(await cacheCount('tweb-account-1')).toBe(0);
  expect(await cacheCount('tweb-account-1_test')).toBe(1);
  expect(await cacheCount('tweb-unrelated')).toBe(1);
  expect(localStorage.getItem('t_account1')).toBe(JSON.stringify({userId: 2}));
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
