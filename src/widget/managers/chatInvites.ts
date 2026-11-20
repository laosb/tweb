import type Original from '@appManagers/appChatInvitesManager';
import {AppManager} from '@appManagers/manager';
import unavailable from '@/widget/managers/unavailable';

type Contract = Pick<Original, 'checkChatInvite' | 'requestChatJoinWebView' | 'reloadPendingJoinRequests'>;

// Invite links do nothing in the widget, and the customer administers no chat
// whose join requests could change.
export default class AppChatInvitesManager extends AppManager implements Contract {
  public checkChatInvite(..._args: Parameters<Contract['checkChatInvite']>): ReturnType<Contract['checkChatInvite']> {
    return unavailable();
  }

  public requestChatJoinWebView(..._args: Parameters<Contract['requestChatJoinWebView']>): ReturnType<Contract['requestChatJoinWebView']> {
    return unavailable();
  }

  public reloadPendingJoinRequests(..._args: Parameters<Contract['reloadPendingJoinRequests']>): ReturnType<Contract['reloadPendingJoinRequests']> {
    return Promise.resolve();
  }
}
