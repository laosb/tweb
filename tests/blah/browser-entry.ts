import blah, {setBlahConfig} from '@config/blah';
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode';
DeferredIsUsingPasscode.resolveDeferred(false);
// Two independent homes in one realm exercise the shared-worker custody boundary.
setBlahConfig(1, blah);
setBlahConfig(2, {...blah, home: {domain: 'other.example.org', identity: 'cd'.repeat(32), generation: '2'}});
export {identityAction, bindIdentity, numberIdentity, withIdentity} from '@lib/blah/identity';
export {requireAccountBinding, prepareAccountStorage} from '@lib/blah/accountStorage';
export {default as accounts} from '@lib/accounts/accountController';
export {diem} from '@lib/blah/wasm';
export {stored, unseal, passwordKey, decode} from '@lib/blah/vault';
