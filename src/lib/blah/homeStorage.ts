import type {BlahConfig} from '@config/blah';
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

async function hasUnboundCache(slot: number) {
  const sessionKeys = new RegExp('^(?:t_)?(?:account' + slot + (slot === 1 ? '|dc\\d+_auth_key|user_auth' : '') + ')$');
  let populated = typeof localStorage !== 'undefined' && Object.keys(localStorage).some((key) =>
    sessionKeys.test(key) && /userId|auth_key|^"[a-f0-9]{512}"$/.test(localStorage.getItem(key) || ''));
  const hasHome = (await Promise.all([1, 2, 3, 4].map((id) => stored('home:' + id)))).some(Boolean);
  for(const {name} of await indexedDB.databases()) {
    if(!/^(tweb|telegram)(-|$)/.test(name)) continue;
    const account = /-account-(\d+)$/.exec(name);
    if(account ? +account[1] !== slot : hasHome) continue;
    populated ||= await new Promise<boolean>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const names = Array.from(db.objectStoreNames).filter((store) =>
          /^(users|chats|messages)(?:__encrypted)?$/.test(store) || (!hasHome && store === 'localStorage__encrypted'));
        if(!names.length) { db.close(); resolve(false); return; }
        const tx = db.transaction(names);
        let found = false;
        for(const store of names) {
          const count = tx.objectStore(store).count();
          count.onsuccess = () => { found ||= count.result > 0; };
        }
        tx.oncomplete = () => { db.close(); resolve(found); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }
  return populated;
}

/** Fail before loading upstream caches, including old number/email installations. */
export async function bindHomeStorage(binding: BlahConfig['home'], slot = 1) {
  await migrateHomeStorage();
  return exclusively(async() => {
    const home = binding && JSON.stringify(binding);
    const previous = await stored<string>('home:' + slot);
    if(previous && (!home || previous === home)) return;
    if(previous || await hasUnboundCache(slot)) {
      throw new Error('This account slot contains another Blah home or legacy account. Use a fresh account slot.');
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
      for(const prefix of ['home:', 'dc-profile:', 'slot:']) {
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
