import type {WidgetConfig} from '@/widget/config';
import {WidgetTransport} from '@/widget/transport';

// Compiled only by test-widget.mjs into a temporary directory. This is a second
// client for the disposable support account, never part of the widget bundle.
let transport: WidgetTransport;
(window as any).widgetTestDriver = {
  async connect(config: WidgetConfig, token: string) {
    transport = new WidgetTransport(config, '', undefined, () => {});
    await transport.call('auth.importBotAuthorization', {flags: 0, api_id: config.apiId, api_hash: config.apiHash, bot_auth_token: token});
  },
  async reply(id: number, text: string) {
    const dialogs = await transport.call('messages.getDialogs', {
      offset_date: 0, offset_id: 0, offset_peer: {_: 'inputPeerEmpty'}, limit: 100, hash: '0'
    });
    if(dialogs._ === 'messages.dialogsNotModified') throw new Error('No customer dialog');
    const user = dialogs.users.find((user) => user._ === 'user' && user.id === id);
    if(user?._ !== 'user') throw new Error('Customer not in support dialogs');
    return transport.call('messages.sendMessage', {
      peer: {_: 'inputPeerUser', user_id: id, access_hash: user.access_hash}, message: text, random_id: String(Date.now())
    });
  }
};
