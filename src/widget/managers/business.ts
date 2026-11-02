import type Original from '@appManagers/appBusinessManager';
import {AppManager} from '@appManagers/manager';
import makeError from '@helpers/makeError';

type Contract = Pick<Original, 'saveBusinessIntro' | 'resolveBusinessChatLink'>;

export default class AppBusinessManager extends AppManager implements Contract {
  // Full profiles retain their intro and its sticker's normal file references.
  public saveBusinessIntro(...[userId, intro]: Parameters<Contract['saveBusinessIntro']>) {
    if(!intro) return;
    intro.sticker = this.appDocsManager.saveDoc(intro.sticker, {type: 'userFull', userId});
    return intro;
  }

  public resolveBusinessChatLink(..._args: Parameters<Contract['resolveBusinessChatLink']>): ReturnType<Contract['resolveBusinessChatLink']> {
    return Promise.reject(makeError('PEER_ID_INVALID'));
  }
}
