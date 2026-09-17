/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

import type {PushNotificationObject} from '@lib/serviceWorker/push';
import type {ServicePushPingTaskPayload} from '@lib/serviceWorker/serviceMessagePort';
import type {NotificationSettings} from '@lib/uiNotificationsManager';
import type {ActiveAccountNumber} from '@lib/accounts/types';
import type ServiceMessagePort from '@lib/serviceWorker/serviceMessagePort';
import {MOUNT_CLASS_TO} from '@config/debug';
import {logger} from '@lib/logger';
import I18n, {LangPackKey} from '@lib/langPack';
import {IS_MOBILE} from '@environment/userAgent';
import copy from '@helpers/object/copy';
import singleInstance from '@lib/singleInstance';
import EventListenerBase from '@helpers/eventListenerBase';
import getServerMessageId from '@appManagers/utils/messageId/getServerMessageId';
import AccountController from '@lib/accounts/accountController';
import App from '@config/app';
import apiManagerProxy from '@lib/apiManagerProxy';
import appNavigationController from '@components/appNavigationController';
import Modes from '@config/modes';
import Blah from '@config/blah';
import base64ToBytes from '@helpers/string/base64ToBytes';
import bytesCmp from '@helpers/bytes/bytesCmp';

export type PushSubscriptionNotifyType = 'init' | 'subscribe' | 'unsubscribe';
export type PushSubscriptionNotifyEvent = `push_${PushSubscriptionNotifyType}`;

export type PushSubscriptionNotify = {
  tokenType: number,
  tokenValue: string
};

const PING_PUSH_INTERVAL = 10000;

export class WebPushApiManager extends EventListenerBase<{
  push_notification_click: (n: PushNotificationObject) => void
}> {
  public isAvailable = true;
  private localNotificationsAvailable = true;
  private settings: NotificationSettings & {baseUrl?: string} = {} as any;
  private isAliveTO: any;
  private isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
  private userVisibleOnly = this.isFirefox ? false : true;
  private log = logger('PUSH-API');

  public serviceMessagePort: ServiceMessagePort<true>;

  constructor() {
    super(false);

    if(
      !('PushManager' in window) ||
      !('Notification' in window) ||
      !('serviceWorker' in navigator) ||
      Modes.noServiceWorker
    ) {
      this.log.warn('push messaging is not supported.');
      this.isAvailable = false;
      this.localNotificationsAvailable = false;
    }

    if(this.isAvailable && Notification.permission === 'denied') {
      this.log.warn('the user has blocked notifications.');
    }
  }

  public start() {
    this.setUpServiceWorkerChannel();
  }

  public setLocalNotificationsDisabled() {
    this.localNotificationsAvailable = false;
  }

  private async getValidSubscription(pushManager: PushManager) {
    const subscription = await pushManager.getSubscription();
    if(Blah && subscription) {
      const key = subscription.options.applicationServerKey;
      if(!App.pushServerKey || !key || !bytesCmp(new Uint8Array(key), base64ToBytes(App.pushServerKey))) {
        // Never register a token belonging to an earlier build's VAPID key.
        await subscription.unsubscribe();
        return;
      }
    }

    return subscription;
  }

  public getSubscription() {
    // Keep the service-worker channel available for local notifications even
    // when this Blah deployment does not offer remote push.
    if(!this.isAvailable) {
      return;
    }

    return navigator.serviceWorker.ready.then((reg) => {
      return this.getValidSubscription(reg.pushManager).then((subscription) => {
        return this.makeTokenData(subscription);
      }).catch((err) => {
        this.log.error('error during getSubscription()', err);
      });
    });
  }

  public subscribe = (): Promise<PushSubscriptionNotify | void> => {
    if(!this.isAvailable) {
      return;
    }

    this.log('subscribing');
    return navigator.serviceWorker.ready.then((reg) => {
      const existing = Blah ? this.getValidSubscription(reg.pushManager) : Promise.resolve(undefined);
      return existing.then((subscription) => {
        if(Blah && !App.pushServerKey) {
          return;
        }

        return subscription || reg.pushManager.subscribe({
          userVisibleOnly: this.userVisibleOnly,
          applicationServerKey: App.pushServerKey
        });
      }).then((subscription) => {
        this.log('subscribed');
        return this.makeTokenData(subscription);
      }).catch((e) => {
        if(Notification.permission === 'denied') {
          this.log('permission for Notifications was denied');
        } else {
          this.log('unable to subscribe to push.', e);
          if(!this.userVisibleOnly) {
            this.userVisibleOnly = true;
            return new Promise((resolve) => setTimeout(resolve, 0)).then(this.subscribe);
          }
        }
      });
    });
  }

  public unsubscribe() {
    if(!this.isAvailable) {
      return;
    }

    this.log('unsubscribing');
    return navigator.serviceWorker.ready.then((reg) => {
      return reg.pushManager.getSubscription().then((subscription) => {
        if(!subscription) {
          this.log('no subscription to unsubscribe from');
          return;
        }

        subscription.unsubscribe().then(() => {
          this.log('unsubscribed');
        }).catch((e) => {
          this.log.error('unsubscription error: ', e);
        });
      }).catch((e) => {
        this.log.error('error thrown while unsubscribing from ' +
          'push messaging.', e);
      });
    });
  }

  public isAliveNotify = async() => {
    if(!this.isAvailable || singleInstance.deactivatedReason) {
      return;
    }

    this.settings.baseUrl = (location.href || '').replace(/#.*$/, '');

    const lang: ServicePushPingTaskPayload['lang'] = {} as any;
    const ACTIONS_LANG_MAP: Record<keyof ServicePushPingTaskPayload['lang'], LangPackKey> = {
      push_action_mute1d: IS_MOBILE ? 'PushNotification.Action.Mute1d.Mobile' : 'PushNotification.Action.Mute1d',
      push_action_settings: IS_MOBILE ? 'PushNotification.Action.Settings.Mobile' : 'PushNotification.Action.Settings',
      push_message_nopreview: 'PushNotification.Message.NoPreview',
      push_message_error: 'PushNotification.Message.Refreshing'
    };

    for(const action in ACTIONS_LANG_MAP) {
      lang[action as keyof typeof ACTIONS_LANG_MAP] = I18n.format(
        ACTIONS_LANG_MAP[action as keyof typeof ACTIONS_LANG_MAP],
        true
      );
    }

    const accounts: ServicePushPingTaskPayload['accounts'] = {};
    const [userIds, keysIdsBase64] = await Promise.all([
      AccountController.getUserIds(),
      apiManagerProxy.pushSingleManager.getKeysIdsBase64()
    ]);
    userIds.forEach((userId, accountNumber) => {
      accounts[(accountNumber + 1) as ActiveAccountNumber] = userId;
    });

    const payload: ServicePushPingTaskPayload = {
      localNotifications: this.localNotificationsAvailable,
      lang: lang,
      settings: this.settings,
      accounts,
      keysIdsBase64
    };

    this.serviceMessagePort.invokeVoid('pushPing', payload);

    this.isAliveTO = setTimeout(this.isAliveNotify, PING_PUSH_INTERVAL);
  }

  public setSettings(newSettings: WebPushApiManager['settings']) {
    this.settings = copy(newSettings);
    clearTimeout(this.isAliveTO);
    this.isAliveNotify();
  }

  public hidePushNotifications() {
    if(!this.isAvailable) {
      return;
    }

    this.serviceMessagePort.invokeVoid('notificationsClear', undefined);
  }

  public setUpServiceWorkerChannel() {
    if(!this.isAvailable) {
      return;
    }

    this.serviceMessagePort.addEventListener('pushClick', (payload) => {
      if(singleInstance.deactivatedReason) {
        appNavigationController.reload();
        return;
      }

      this.dispatchEvent('push_notification_click', payload);
    });

    navigator.serviceWorker.ready.then(this.isAliveNotify);
  }

  private makeTokenData(subscription: PushSubscription): PushSubscriptionNotify {
    if(!subscription) {
      return;
    }

    const subscriptionObj: PushSubscriptionJSON & {vapid?: boolean} = subscription.toJSON();
    if(!subscriptionObj ||
      !subscriptionObj.endpoint ||
      !subscriptionObj.keys ||
      !subscriptionObj.keys.p256dh ||
      !subscriptionObj.keys.auth) {
      this.log.warn('invalid push subscription', subscriptionObj);
      this.isAvailable = false;
      throw new Error('invalid push subscription');
    }

    subscriptionObj.vapid = true;
    return {
      tokenType: 10,
      tokenValue: JSON.stringify(subscriptionObj)
    };
  }

  public ignorePushByMid(peerId: PeerId, mid: number) {
    if(!this.isAvailable) {
      return;
    }

    this.serviceMessagePort.invokeVoid('shownNotification', peerId + '_' + getServerMessageId(mid));
  }
}

const webPushApiManager = new WebPushApiManager();
MOUNT_CLASS_TO && (MOUNT_CLASS_TO.webPushApiManager = webPushApiManager);
export default webPushApiManager;
