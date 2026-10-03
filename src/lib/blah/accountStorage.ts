import blah, {getBlahConfig} from '@config/blah';
import AccountController from '@lib/accounts/accountController';
import type {ActiveAccountNumber} from '@lib/accounts/types';
import {bindHomeStorage, clearAccountCaches} from '@lib/blah/homeStorage';
import {exclusively, stored, storeEntries} from '@lib/blah/vault';
import sessionStorage from '@lib/sessionStorage';
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode';

/** Called after passcode unlock, before reading account state or using transport keys. */
export async function requireAccountBinding(slot: ActiveAccountNumber) {
  if(!blah?.discovery && !blah?.home) return false;
  await bindHomeStorage(getBlahConfig(slot)?.home, slot);
  return exclusively(async() => {
    const signedIn = !!(await AccountController.get(slot)).userId;
    if(!await stored('reset-slot:' + slot) && (!signedIn || await stored('slot:' + slot))) return false;

    // Keep the reset durable until both caches and (possibly encrypted) credentials are gone.
    // Identity ciphertext and other slots never participate in session cleanup.
    await storeEntries([['reset-slot:' + slot, true], ['slot:' + slot, null]]);
    await clearAccountCaches(slot);
    await AccountController.update(slot, {}, true);
    await sessionStorage.localStorageProxy('delete', `account${slot}`);
    if(slot === 1) {
      await AccountController.updateStorageForLegacy(null);
      await sessionStorage.delete('auth_key_fingerprint');
    }
    await sessionStorage.set({number_of_accounts: await AccountController.getTotalAccounts()});
    if(await DeferredIsUsingPasscode.isUsingPasscode()) await sessionStorage.encryptedStorageProxy('reEncrypt');
    await stored('reset-slot:' + slot, null);
    return true;
  });
}

export async function prepareAccountStorage() {
  if(!blah?.discovery && !blah?.home) return;
  for(const slot of [1, 2, 3, 4] as const) {
    await requireAccountBinding(slot);
  }
}
