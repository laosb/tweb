import blah, {setBlahConfig} from '@config/blah';
import rootScope from '@lib/rootScope';
import {requireAccountBinding, prepareAccountStorage} from '@lib/blah/accountStorage';
import type {ActiveAccountNumber} from '@lib/accounts/types';
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode';
DeferredIsUsingPasscode.resolveDeferred(false);
// Two independent homes in one realm exercise the shared-worker custody boundary.
setBlahConfig(1, blah);
setBlahConfig(2, {...blah, home: {domain: 'other.example.org', identity: 'cd'.repeat(32), generation: '2'}});
export {identityAction, bindIdentity, numberIdentity, withIdentity} from '@lib/blah/identity';
// Observe the same logout event that makes the application reload, without navigating this fixture.
export function resetAccount(slot?: ActiveAccountNumber) {
  const logout = new Promise((resolve) => rootScope.addEventListener('logging_out', resolve, {once: true}));
  return Promise.race([logout, slot ? requireAccountBinding(slot) : prepareAccountStorage()]);
}
export {default as accounts} from '@lib/accounts/accountController';
export {diem} from '@lib/blah/wasm';
export {stored, unseal, passwordKey, decode} from '@lib/blah/vault';
