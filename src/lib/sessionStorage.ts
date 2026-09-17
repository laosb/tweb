import type {DcId, DcAuthKey, DcServerSalt} from '@types';
import {MOUNT_CLASS_TO} from '@config/debug';

import type {AppInstance} from '@lib/singleInstance';
import type {UserAuth} from '@appManagers/constants';
import LocalStorageController from '@lib/localStorage';
import {AccountSessionData} from '@lib/accounts/types';


type StorageValues = {
  state_id: number,

  account1: AccountSessionData,
  account2: AccountSessionData,
  account3: AccountSessionData,
  account4: AccountSessionData,

  // @deprecated the passcode key is handed over in window.sessionStorage now
  // (@lib/passcode/keyHandoff) — kept only so old, on-disk values can be purged
  encryption_key?: string,

  server_time_offset: number,
  xt_instance: AppInstance,
  kz_version: 'K' | 'Z',
  tgme_sync: {
    canRedirect: boolean,
    ts: number
  },
  k_build: number,

  // auth options
  number_of_accounts?: number, // When the storage is encrypted
  previous_account?: number, // only for back button when logging in to another account
  current_account?: number, // 1 if not set
  should_animate_auth?: number,
  should_animate_main?: number
}

/**
 * @deprecated use these keys only for going to and from 'A' (a.k.a. 'Z') version
 */
type DeprecatedStorageValues = Record<DcAuthKey | DcServerSalt | `dc${DcId}_hash`, string> & {
  dc: DcId,
  user_auth: UserAuth,

  auth_key_fingerprint: string // = dc${App.baseDcId}_auth_key.slice(0, 8)
};

const sessionStorage = new LocalStorageController<StorageValues & DeprecatedStorageValues>([
  'account1',
  'account2',
  'account3',
  'account4',
  'auth_key_fingerprint',
  'user_auth',
  'dc'
]);

MOUNT_CLASS_TO.appStorage = sessionStorage;
export default sessionStorage;
