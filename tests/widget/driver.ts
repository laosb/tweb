import type {InputPeer, MessageEntity, TextWithEntities} from '@layer';
import type {WidgetConfig} from '@/widget/config';
import {WidgetTransport} from './transport';
import {Output, BufferTarget, WebMOutputFormat, CanvasSource} from 'mediabunny';

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
  history,
  async read(id: number) {
    return transport.call('messages.readHistory', {peer: await customer(id), max_id: 0});
  },
  async mediaBytes(id: number, caption: string) {
    const resultHistory = await history(id);
    if(resultHistory._ === 'messages.messagesNotModified') throw new Error('Missing history');
    const message = resultHistory.messages.find((message) => message._ === 'message' && message.message === caption);
    if(message?._ !== 'message') throw new Error('Missing message');
    const media = message.media;
    const file = media?._ === 'messageMediaPhoto' ? media.photo : media?._ === 'messageMediaDocument' ? media.document : undefined;
    if(!file || file._ === 'photoEmpty' || file._ === 'documentEmpty') throw new Error('Missing media');
    const result = await transport.call('upload.getFile', {location: {
      _: file._ === 'photo' ? 'inputPhotoFileLocation' : 'inputDocumentFileLocation',
      id: file.id, access_hash: file.access_hash, file_reference: file.file_reference,
      thumb_size: file._ === 'photo' ? file.sizes[file.sizes.length - 1].type : ''
    }, offset: '0', limit: 1024 * 1024});
    if(result._ !== 'upload.file') throw new Error('Unexpected CDN redirect');
    return Array.from(result.bytes);
  },
  async videoFixture() {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const source = new CanvasSource(canvas, {codec: 'vp9', bitrate: 100_000});
    const output = new Output({format: new WebMOutputFormat(), target: new BufferTarget()});
    output.addVideoTrack(source, {frameRate: 10});
    await output.start();
    const context = canvas.getContext('2d');
    for(let i = 0; i < 10; ++i) {
      context.fillStyle = i % 2 ? '#235347' : '#347852';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await source.add(i / 10, 0.1);
    }
    await output.finalize();
    return Array.from(new Uint8Array(output.target.buffer));
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

async function history(id: number) {
  return transport.call('messages.getHistory', {peer: await customer(id), offset_id: 0, offset_date: 0,
    add_offset: 0, limit: 100, max_id: 0, min_id: 0, hash: '0'});
}
