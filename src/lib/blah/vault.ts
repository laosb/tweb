import encode from '@helpers/bytes/bytesToBase64';
import decode from '@helpers/string/base64ToBytes';

export {encode, decode};
const databaseName = 'blah-device-custody-v1';
let database: Promise<IDBDatabase>;
let epoch: number;

function open() {
  return database ??= initialize().catch((error) => { database = undefined; throw error; });
}

async function initialize() {
  return lock('blah-account-storage', async() => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Blah tabs to open identity storage.'));
    });
    db.onversionchange = () => { db.close(); database = undefined; };
    try {
      await discardOldCustody(db);
      const request = db.transaction('vault').objectStore('vault').get('account-epoch');
      const current = await new Promise<number>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || 0);
        request.onerror = () => reject(request.error);
      });
      epoch ??= current;
      return db;
    }
    catch(error) { db.close(); throw error; }
  });
}

/** Preserve public home pins and managed sessions; retire all password-file custody. */
async function discardOldCustody(db: IDBDatabase) {
  const name = 'blah-browser-identities-v2';
  if(!(await indexedDB.databases()).some((entry) => entry.name === name)) return;
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const copied = await new Promise<boolean>((resolve, reject) => {
      const request = db.transaction('vault').objectStore('vault').get('legacy-discarded');
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
    if(!copied && old.objectStoreNames.contains('vault')) {
      const entries = await new Promise<[string, unknown][]>((resolve, reject) => {
        const tx = old.transaction('vault');
        const store = tx.objectStore('vault');
        const keys = store.getAllKeys();
        const values = store.getAll();
        tx.oncomplete = () => resolve(keys.result.map((key, i) => [String(key), values.result[i]]));
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('vault', 'readwrite');
        const store = tx.objectStore('vault');
        for(const [key, value] of entries) {
          if(/^(home(?::[1-4])?|dc-profile(?::[1-4])?|dc-domain:.+|reset-slot:[1-4])$/.test(key)) store.put(value, key);
          if(/^slot:[1-4]$/.test(key) && value) {
            if(value === 'managed-account') store.put(value, key);
            else store.put(true, 'reset-' + key);
          }
        }
        store.put(true, 'legacy-discarded');
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    }
  } finally { old.close(); }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close older Blah tabs to discard their identity storage.'));
  });
}

export async function stored<T>(key: string, value?: T): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('vault', value === undefined ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('vault');
    const request = value === undefined ? store.get(key) : store.put(value, key);
    transaction.oncomplete = () => resolve(value === undefined ? request.result : value);
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

export async function storeEntries(entries: [string, unknown][]) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('vault', 'readwrite');
    const store = transaction.objectStore('vault');
    for(const [key, value] of entries) {
      if(value === null) store.delete(key);
      else store.put(value, key);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

export async function identityIDs(): Promise<string[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('vault').objectStore('vault').getAllKeys();
    request.onsuccess = () => resolve(request.result.filter((k) => String(k).startsWith('custody:chat:')).map((k) => String(k).slice(13)));
    request.onerror = () => reject(request.error);
  });
}

function lock<T>(name: string, action: () => Promise<T>): Promise<T> {
  if(!navigator.locks) throw new Error('This browser needs Web Locks for safe identity storage.');
  return navigator.locks.request(name, action);
}

export async function exclusively<T>(action: () => Promise<T>): Promise<T> {
  // Initialization uses a separate lock, before taking the custody lock.
  await open();
  return lock('blah-identity-vault', action);
}

/** Reject a second removal from a context whose account slots have already moved. */
export async function assertAccountEpoch() {
  if((await stored<number>('account-epoch') || 0) !== epoch || await stored('account-relocation')) throw Object.assign(new Error('Account slots moved. Reload Blah to continue.'), {type: 'BLAH_ACCOUNT_MOVED'});
}

/** Serialize relocation, logout and legacy discard; ordinary account writers stay upstream. */
export async function serializeAccountStorage<T>(action: () => Promise<T>) {
  await open();
  return lock('blah-account-storage', action);
}
