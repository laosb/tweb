import type {InputPeer, MessageEntity, TextWithEntities} from '@layer';
import type {WidgetConfig} from '@/widget/config';
import {WidgetTransport} from './transport';

// Compiled only by test-widget.mjs into a temporary directory. This is a second
// client for the disposable support account, never part of the widget bundle.
let transport: WidgetTransport;
(window as any).widgetTestDriver = {
  async connect(config: WidgetConfig, token: string) {
    transport = new WidgetTransport(config);
    await transport.call('auth.importBotAuthorization', {flags: 0, api_id: config.apiId, api_hash: config.apiHash, bot_auth_token: token});
  },
  async reply(id: number, text: string, entities?: MessageEntity[]) {
    return transport.call('messages.sendMessage', {
      peer: await customer(id), message: text, entities, random_id: String(Date.now())
    });
  },
  async poll(id: number, question: string, answers: string[]) {
    const text = (text: string): TextWithEntities => ({_: 'textWithEntities', text, entities: []});
    return transport.call('messages.sendMedia', {
      peer: await customer(id), message: '', random_id: String(Date.now()),
      media: {_: 'inputMediaPoll', poll: {_: 'poll', id: 0, pFlags: {}, hash: 0, question: text(question),
        answers: answers.map((answer, i) => ({_: 'pollAnswer', text: text(answer), option: new Uint8Array([i])}))}}
    });
  }
};

async function customer(id: number): Promise<InputPeer> {
  const dialogs = await transport.call('messages.getDialogs', {
    offset_date: 0, offset_id: 0, offset_peer: {_: 'inputPeerEmpty'}, limit: 100, hash: '0'
  });
  if(dialogs._ === 'messages.dialogsNotModified') throw new Error('No customer dialog');
  const user = dialogs.users.find((user) => user._ === 'user' && user.id === id);
  if(user?._ !== 'user') throw new Error('Customer not in support dialogs');
  return {_: 'inputPeerUser', user_id: id, access_hash: user.access_hash};
}
