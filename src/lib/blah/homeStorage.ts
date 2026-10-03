import type {BlahConfig} from '@config/blah';
import Modes from '@config/modes';
import {exclusively, stored, storeEntries} from '@lib/blah/vault';

/** Upgrade origin-wide pins without assigning an unused slot to the old home. */
export function migrateHomeStorage() {
  return exclusively(async() => {
    const home = await stored<string>('home');
    if(!home) return;
    const profile = await stored('dc-profile');
    const entries: [string, unknown][] = [];
    for(let slot = 1; slot <= 4; slot++) {
      if(slot !== 1 && !await stored('slot:' + slot)) continue;
      entries.push(['home:' + slot, home], ['dc-profile:' + slot, profile ?? null]);
    }
    entries.push(['home', null], ['dc-profile', null]);
    await storeEntries(entries);
  });
}

function accountDatabaseSlot(name: string) {
  return /-account-(\d+)(?:_test)?$/.exec(name)?.[1];
}

function isClientDatabase(name: string) {
  return /^(tweb|telegram)(?:-(?:account-[1-4]|common))?(?:_test)?$/.test(name) &&
    name.endsWith('_test') === Modes.test;
}

function visitCache(name: string, clear = false, includeSession = false) {
  return new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const names = Array.from(db.objectStoreNames).filter((store) => clear ||
        /^(users|chats|messages)(?:__encrypted)?$/.test(store) || (includeSession && store === 'localStorage__encrypted'));
      if(!names.length) { db.close(); resolve(false); return; }
      const tx = db.transaction(names, clear ? 'readwrite' : 'readonly');
      let found = false;
      for(const store of names) {
        if(clear) tx.objectStore(store).clear();
        else {
          const count = tx.objectStore(store).count();
          count.onsuccess = () => { found ||= count.result > 0; };
        }
      }
      tx.oncomplete = () => { db.close(); resolve(found); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

/** Runs before state loading, including caches from older database layouts. */
export async function clearAccountCaches(slot: number) {
  for(const {name} of await indexedDB.databases()) {
    if(!isClientDatabase(name) || /-common(?:_test)?$/.test(name)) continue;
    const account = accountDatabaseSlot(name);
    if(account ? +account !== slot : slot !== 1) continue;
    await visitCache(name, true);
  }
}

async function hasUnboundCache(slot: number) {
  const sessionKeys = new RegExp('^' + (Modes.test ? 't_' : '') + '(?:account' + slot + (slot === 1 ? '|dc\\d+_auth_key|user_auth' : '') + ')$');
  let populated = typeof localStorage !== 'undefined' && Object.keys(localStorage).some((key) =>
    sessionKeys.test(key) && /userId|auth_key|^"[a-f0-9]{512}"$/.test(localStorage.getItem(key) || ''));
  const hasHome = (await Promise.all([1, 2, 3, 4].map((id) => stored('home:' + id)))).some(Boolean);
  for(const {name} of await indexedDB.databases()) {
    if(!isClientDatabase(name)) continue;
    const account = accountDatabaseSlot(name);
    if(account ? +account !== slot : slot !== 1 || hasHome) continue;
    populated ||= await visitCache(name, false, !hasHome);
  }
  return populated;
}

/** Mark incompatible caches before loading them; encrypted sessions are reset after unlock. */
export async function bindHomeStorage(binding: BlahConfig['home'], slot = 1) {
  await migrateHomeStorage();
  return exclusively(async() => {
    const home = binding && JSON.stringify(binding);
    const previous = await stored<string>('home:' + slot);
    if(previous && (!home || previous === home)) return;
    if(previous || (!await stored('reset-slot:' + slot) && await hasUnboundCache(slot))) {
      await storeEntries([
        ['reset-slot:' + slot, true],
        ['home:' + slot, home ?? null],
        ['dc-profile:' + slot, null],
        ['slot:' + slot, null]
      ]);
      return;
    }
    if(home) await stored('home:' + slot, home);
  });
}

/** Called only after upstream has cleared/moved the corresponding account caches. */
export async function shiftHomeStorage(upTo: number) {
  await migrateHomeStorage();
  await exclusively(async() => {
    const entries: [string, unknown][] = [];
    for(let slot = upTo; slot <= 4; slot++) {
      for(const prefix of ['home:', 'dc-profile:', 'slot:', 'reset-slot:']) {
        entries.push([prefix + slot, slot < 4 ? await stored(prefix + (slot + 1)) ?? null : null]);
      }
    }
    await storeEntries(entries);
  });
}

/** Numeric user IDs are meaningful only within the same pinned home namespace. */
export async function accountsShareHome(first: number, second: number) {
  const [a, b] = await Promise.all([stored<string>('home:' + first), stored<string>('home:' + second)]);
  return a === b;
}
