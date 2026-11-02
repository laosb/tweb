import type Original from '@appManagers/appSeamlessLoginManager';
import {AppManager} from '@appManagers/manager';

type Contract = Pick<Original, 'requestUrlAuth' | 'acceptUrlAuth'>;

export default class AppSeamlessLoginManager extends AppManager implements Contract {
  // External links keep their ordinary confirmation; no website authorization
  // or bot write access is granted by an embedded support conversation.
  public requestUrlAuth(..._args: Parameters<Contract['requestUrlAuth']>): ReturnType<Contract['requestUrlAuth']> {
    return Promise.resolve({_: 'urlAuthResultDefault'});
  }

  public acceptUrlAuth(..._args: Parameters<Contract['acceptUrlAuth']>): ReturnType<Contract['acceptUrlAuth']> {
    return Promise.resolve({_: 'urlAuthResultDefault'});
  }
}
