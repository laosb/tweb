import blah, {getBlahConfig} from '@config/blah';
import type {ActiveAccountNumber} from '@lib/accounts/types';
import {IS_WORKER} from '@helpers/context';
import {bindHomeStorage, clearAccountCaches} from '@lib/blah/homeStorage';
import {exclusively, serializeAccountStorage, stored, storeEntries, assertAccountEpoch} from '@lib/blah/vault';
import {IDB} from '@lib/files/idb';
import rootScope from '@lib/rootScope';
import sessionStorage from '@lib/sessionStorage';
import {getDatabaseState} from '@config/databases/state';
import Modes from '@config/modes';
import AccountController from '@lib/accounts/accountController';
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode';
import {saveEncryptionKeyForHandoff} from '@lib/passcode/keyHandoff';

/** A managed account has no browser identity; this binding keeps its session across reloads. */
export async function bindManagedAccount(slot: number) {
  if(blah?.discovery || blah?.home) await exclusively(() => stored('slot:' + slot, 'managed-account'));
}

/** Called after passcode unlock, before reading account state or using transport keys. */
export async function requireAccountBinding(slot: ActiveAccountNumber, _signedIn?: boolean) {
  if(!blah?.discovery && !blah?.home) return false;
  // Finish a prior move before interpreting any slot's home or reset marker.
  let reset = await relocateAccount(slot);
  if(!reset) {
    await bindHomeStorage(getBlahConfig(slot)?.home, slot);
    reset = await relocateAccount(slot, async() => {
      const signedIn = !!(await sessionStorage.get(`account${slot}`, false))?.userId;
      if(!await stored('reset-slot:' + slot) && (!signedIn || await stored('slot:' + slot))) return false;
      return true;
    });
  }
  if(!reset) return false;
  IDB.closeDatabases();
  if(IS_WORKER) rootScope.dispatchEvent('logging_out', {accountNumber: reset});
  else rootScope.dispatchEventSingle('logging_out', {accountNumber: reset});
  // Logout reloads all tabs and rebuilds the workers with the shifted home configuration.
  return new Promise<never>(() => {});
}

export async function prepareAccountStorage() {
  if(!blah?.discovery && !blah?.home) return;
  for(const slot of [1, 2, 3, 4] as const) {
    await requireAccountBinding(slot);
  }
}

const prefixes = ['home:', 'dc-profile:', 'slot:', 'reset-slot:', 'custody:slot:', 'enrollment:'];
type Relocation = {removed: ActiveAccountNumber, destination: ActiveAccountNumber,
  source?: ActiveAccountNumber, sourceBinding?: string,
  phase: 'caches' | 'credentials' | 'vault' | 'finish'};

/** Sources remain untouched until the preceding destination is durable. Each phase can replay. */
export function relocateAccount(slot: ActiveAccountNumber, shouldRemove?: () => Promise<boolean>): Promise<ActiveAccountNumber | false> {
  return serializeAccountStorage(() => exclusively(async() => {
    let journal = await stored<Relocation>('account-relocation');
    if(!journal) {
      await assertAccountEpoch();
      if(!shouldRemove) return false;
      if(!await shouldRemove()) return false;
      AccountController.shifting = true;
      journal = {removed: slot, ...await relocationStep(slot)};
      await storeEntries([['account-relocation', journal], ['account-epoch', (await stored<number>('account-epoch') || 0) + 1]]);
    }
    AccountController.shifting = true;
    const checkpoint = async(phase: Relocation['phase']) => {
      journal = {...journal, phase};
      await stored('account-relocation', journal);
    };
    while(journal.phase !== 'finish') {
      const to = journal.destination;
      const from = journal.source;
      if(from && (await stored('slot:' + from)) !== journal.sourceBinding) throw new Error('Account relocation source changed.');
      if(journal.phase === 'caches') {
        await clearAccountCaches(to);
        await copyCaches(from, to);
        await checkpoint('credentials');
      }
      if(journal.phase === 'credentials') {
        const account = from && await sessionStorage.get(`account${from}`, false);
        await sessionStorage.localStorageProxy('delete', `account${to}`);
        await sessionStorage.delete(`account${to}`);
        if(account) {
          const update: Parameters<typeof sessionStorage.set>[0] = {};
          update[`account${to}`] = account;
          await sessionStorage.set(update);
        }
        if(to === 1) {
          await AccountController.updateStorageForLegacy(account ? {...account, userId: account.userId === undefined ? undefined : Number(account.userId)} : null);
          if(!account) await sessionStorage.delete('auth_key_fingerprint');
        }
        if(await DeferredIsUsingPasscode.isUsingPasscode()) await sessionStorage.encryptedStorageProxy('reEncrypt');
        await checkpoint('vault');
      }
      if(journal.phase === 'vault') {
        const entries: [string, unknown][] = [];
        for(const prefix of prefixes) entries.push([prefix + to, from ? await stored(prefix + from) ?? null : null]);
        journal = to === 4 ? {...journal, phase: 'finish'} : {removed: journal.removed, ...await relocationStep((to + 1) as ActiveAccountNumber)};
        // The reset marker moves with its original account, never with the destination's old slot.
        await storeEntries([...entries, ['account-relocation', journal]]);
      }
    }
    const accounts = await Promise.all(([1, 2, 3, 4] as const).map((id) => sessionStorage.get(`account${id}`, false)));
    await sessionStorage.set({number_of_accounts: accounts.filter((account) => account?.userId).length});
    if(await DeferredIsUsingPasscode.isUsingPasscode()) await saveEncryptionKeyForHandoff();
    await storeEntries([['account-relocation', null], ['account-epoch', (await stored<number>('account-epoch') || 0) + 1]]);
    return journal.removed;
  }));
}

async function relocationStep(destination: ActiveAccountNumber): Promise<Omit<Relocation, 'removed'>> {
  const source = destination < 4 ? (destination + 1) as ActiveAccountNumber : undefined;
  return {destination, source, phase: 'caches', sourceBinding: source ? await stored<string>('slot:' + source) : undefined};
}

async function copyCaches(from: ActiveAccountNumber | undefined, to: ActiveAccountNumber) {
  if(!from) return;
  const sourceName = getDatabaseState(from).name + (Modes.test ? '_test' : '');
  if(!(await indexedDB.databases()).some((db) => db.name === sourceName)) return;
  const source = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(sourceName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const names = Array.from(source.objectStoreNames);
    if(!names.length) return;
    const entries = await new Promise<[string, IDBValidKey[], unknown[]][]>((resolve, reject) => {
      const tx = source.transaction(names);
      const reads = names.map((name) => ({name, keys: tx.objectStore(name).getAllKeys(), values: tx.objectStore(name).getAll()}));
      tx.oncomplete = () => resolve(reads.map(({name, keys, values}) => [name, keys.result, values.result]));
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    const target = await IDB.create(getDatabaseState(to)).openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = target.transaction(names, 'readwrite');
      for(const [name, keys, values] of entries) {
        const store = tx.objectStore(name);
        store.clear();
        keys.forEach((key, i) => store.put(values[i], key));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { source.close(); }
}
