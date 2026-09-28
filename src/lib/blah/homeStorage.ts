import type {BlahConfig} from '@config/blah';
import {exclusively, stored} from '@lib/blah/vault';

/** Fail before loading upstream caches, including old number/email installations. */
export async function bindHomeStorage(binding: BlahConfig['home']) {
  return exclusively(async() => {
    const home = JSON.stringify(binding);
    const previous = await stored<string>('home');
    if(previous === home) return;
    let populated = typeof localStorage !== 'undefined' && Object.keys(localStorage).some((key) =>
      /^(?:t_)?(?:account[1-4]|dc\d+_auth_key|user_auth)$/.test(key) &&
      /userId|auth_key|^"[a-f0-9]{512}"$/.test(localStorage.getItem(key) || ''));
    for(const {name} of await indexedDB.databases()) {
      if(!/^(tweb|telegram)(-|$)/.test(name)) continue;
      populated ||= await new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const names = Array.from(db.objectStoreNames).filter((store) =>
            /^(users|chats|messages|localStorage__encrypted|session__encrypted)$/.test(store));
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
    if(previous || populated) {
      throw new Error('This origin contains another Blah home or legacy account. Use a fresh browser origin.');
    }
    await stored('home', home);
  });
}
