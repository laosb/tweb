import encode from '@helpers/bytes/bytesToBase64';
import decode from '@helpers/string/base64ToBytes';

/** Browser custody is independent of Telegram caches and logout. Keys persist only as ciphertext; public domain labels are cached separately. */
export type SealedIdentity = {
  version: 1,
  id: string,
  salt: string,
  iv: string,
  ciphertext: string
};

export {encode, decode};
const utf8 = new TextEncoder();
const databaseName = 'blah-browser-identities-v1';
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

export async function passwordKey(password: string, salt: Uint8Array) {
  if(password.length < 12) throw new Error('Use an identity password of at least 12 characters.');
  const base = await crypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations: 600_000}, base,
    {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
}

export function validateBackup(value: SealedIdentity) {
  if(value?.version !== 1 || !/^[a-f0-9]{64}$/.test(value.id) ||
    typeof value.ciphertext !== 'string' || value.ciphertext.length > 500_000 ||
    decode(value.salt).length !== 16 || decode(value.iv).length !== 12 || decode(value.ciphertext).length < 16) {
    throw new Error('Invalid Blah identity file.');
  }
}

export async function seal(id: string, secret: unknown, key: CryptoKey, salt: string): Promise<SealedIdentity> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = utf8.encode(JSON.stringify(secret));
  try {
    const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv,
      additionalData: utf8.encode(`Blah/browser-identity/1:${id}`)}, key, bytes);
    return {version: 1, id, salt, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext))};
  } finally {
    bytes.fill(0);
  }
}

export async function unseal<T>(backup: SealedIdentity, key: CryptoKey): Promise<T> {
  validateBackup(backup);
  const bytes = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: decode(backup.iv),
    additionalData: utf8.encode(`Blah/browser-identity/1:${backup.id}`)}, key, decode(backup.ciphertext)));
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    bytes.fill(0);
  }
}
