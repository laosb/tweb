import encode from '@helpers/bytes/bytesToBase64';
import decode from '@helpers/string/base64ToBytes';

/** Browser custody is independent of Telegram caches and logout. Keys persist only as ciphertext; public domain labels are cached separately. */
export type SealedIdentity = Uint8Array;

export {encode, decode};
const databaseName = 'blah-browser-identities-v2';
let database: Promise<IDBDatabase>;

function open() {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vault');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Blah tabs to open identity storage.'));
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

/** Keep account moves and legacy home migration atomic within the custody store. */
export async function storeEntries(entries: [string, unknown][]) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('vault', 'readwrite');
    for(const [key, value] of entries) transaction.objectStore('vault').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

export async function identityIDs(): Promise<string[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('vault').objectStore('vault').getAllKeys();
    request.onsuccess = () => resolve(request.result.filter((k) => String(k).startsWith('identity:')).map((k) => String(k).slice(9)));
    request.onerror = () => reject(request.error);
  });
}

export function exclusively<T>(action: () => Promise<T>): Promise<T> {
  if(!navigator.locks) throw new Error('This browser needs Web Locks for safe identity storage.');
  return navigator.locks.request('blah-identity-vault', action);
}
