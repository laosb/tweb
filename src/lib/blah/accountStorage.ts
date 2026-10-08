import blah, {getBlahConfig} from '@config/blah';
import AccountController from '@lib/accounts/accountController';
import type {ActiveAccountNumber} from '@lib/accounts/types';
import {AppStoragesManager} from '@appManagers/appStoragesManager';
import {IS_WORKER} from '@helpers/context';
import {bindHomeStorage, clearAccountCaches, shiftHomeStorage} from '@lib/blah/homeStorage';
import {stored, storeEntries} from '@lib/blah/vault';
import {IDB} from '@lib/files/idb';
import rootScope from '@lib/rootScope';
import sessionStorage from '@lib/sessionStorage';
import AppStorage from '@lib/storage';
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode';
import {saveEncryptionKeyForHandoff} from '@lib/passcode/keyHandoff';

/** A managed account has no browser identity; this binding keeps its session across reloads. */
export async function bindManagedAccount(slot: number) {
  if(blah?.discovery || blah?.home) await stored('slot:' + slot, 'managed-account');
}

/** Called after passcode unlock, before reading account state or using transport keys. */
export async function requireAccountBinding(slot: ActiveAccountNumber, _signedIn?: boolean) {
  if(!blah?.discovery && !blah?.home) return false;
  await bindHomeStorage(getBlahConfig(slot)?.home, slot);
  const reset = await shiftHomeStorage(slot, async() => {
    const signedIn = !!(await AccountController.get(slot)).userId;
    if(!await stored('reset-slot:' + slot) && (!signedIn || await stored('slot:' + slot))) return false;

    // Keep the reset durable until both caches and (possibly encrypted) credentials are gone.
    // Reuse logout's account moves so upstream account menus need no sparse-slot support.
    await storeEntries([['reset-slot:' + slot, true], ['slot:' + slot, null]]);
    await clearAccountCaches(slot);
    await sessionStorage.localStorageProxy('delete', `account${slot}`);
    if(slot === 1) {
      await AccountController.updateStorageForLegacy(null);
      await sessionStorage.delete('auth_key_fingerprint');
    }
    await AppStoragesManager.shiftStorages(slot);
    await AccountController.shiftAccounts(slot);
    await sessionStorage.set({number_of_accounts: await AccountController.getTotalAccounts()});
    if(await DeferredIsUsingPasscode.isUsingPasscode()) {
      await AppStorage.reEncryptEncrypted();
      await sessionStorage.encryptedStorageProxy('reEncrypt');
      await saveEncryptionKeyForHandoff();
    }
    return true;
  });
  if(!reset) return false;
  IDB.closeDatabases();
  if(IS_WORKER) rootScope.dispatchEvent('logging_out', {accountNumber: slot});
  else rootScope.dispatchEventSingle('logging_out', {accountNumber: slot});
  // Logout reloads all tabs and rebuilds the workers with the shifted home configuration.
  return new Promise<never>(() => {});
}

export async function prepareAccountStorage() {
  if(!blah?.discovery && !blah?.home) return;
  for(const slot of [1, 2, 3, 4] as const) {
    await requireAccountBinding(slot);
  }
}
