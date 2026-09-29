import blah, {setBlahConfig} from '@config/blah';
// Two independent homes in one realm exercise the shared-worker custody boundary.
setBlahConfig(1, blah);
setBlahConfig(2, {...blah, home: {domain: 'other.example.org', identity: 'cd'.repeat(32), generation: '2'}});
export {identityAction, bindIdentity, numberIdentity, withIdentity, requireAccountBinding} from '@lib/blah/identity';
export {diem} from '@lib/blah/wasm';
export {stored, unseal, passwordKey, decode} from '@lib/blah/vault';
