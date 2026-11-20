import type Original from '@appManagers/appAttachMenuBotsManager';
import {AppManager} from '@appManagers/manager';
import unavailable from '@/widget/managers/unavailable';

type Contract = Pick<Original, 'getAttachMenuBots' | 'onLanguageChange' | 'getAttachMenuBot' | 'getBotApp' |
  'requestWebView' | 'toggleBotInAttachMenu'>;

// Attach-menu apps and web apps are unavailable (the web-app popup is inert):
// list no bots, and do not fetch or refresh them after sign-in.
export default class AppAttachMenuBotsManager extends AppManager implements Contract {
  public getAttachMenuBots(): ReturnType<Contract['getAttachMenuBots']> {
    return [];
  }

  public onLanguageChange() {}

  public getAttachMenuBot(..._args: Parameters<Contract['getAttachMenuBot']>): ReturnType<Contract['getAttachMenuBot']> {
    return unavailable();
  }

  public getBotApp(..._args: Parameters<Contract['getBotApp']>): ReturnType<Contract['getBotApp']> {
    return unavailable();
  }

  public requestWebView(..._args: Parameters<Contract['requestWebView']>): ReturnType<Contract['requestWebView']> {
    return unavailable();
  }

  public toggleBotInAttachMenu(..._args: Parameters<Contract['toggleBotInAttachMenu']>): ReturnType<Contract['toggleBotInAttachMenu']> {
    return unavailable();
  }
}
