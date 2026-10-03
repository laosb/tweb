import {File as NodeFile} from 'node:buffer';
import type {Message} from '@layer';
import {WidgetManager, validateAttachment} from '@/widget/manager';
import type {WidgetRPC} from '@/widget/transport';

const config = {dcId: 1, url: 'wss://dc.example/apiws', rsaKey: {modulus: 'ab'.repeat(256), exponent: '010001'}, apiId: 1, apiHash: 'aa'.repeat(16)};
const message = (id = 1, peer = 42, text = 'hello'): Message.message => ({_: 'message', id, peer_id: {_: 'peerUser', user_id: peer}, from_id: {_: 'peerUser', user_id: 10}, pFlags: {out: true}, message: text, date: 100});
const file = (bytes: string, name: string, type: string) => new NodeFile([bytes], name, {type}) as unknown as File;

function fixture() {
  const history = [message()];
  const call = vi.fn(async(method: string, _params: unknown): Promise<unknown> => {
    switch(method) {
      case 'auth.importBotAuthorization': return {_: 'auth.authorization', user: {_: 'user', id: 10, pFlags: {}}};
      case 'help.getSupport': return {user: {_: 'user', id: 42, access_hash: '12', first_name: 'Help desk', pFlags: {}}};
      case 'updates.getState': return {pts: 0};
      case 'messages.getHistory': return {_: 'messages.messages', messages: history, users: [], chats: []};
      case 'upload.saveBigFilePart': return true;
      default: return {_: 'updates', updates: []};
    }
  });
  const rpc = {call, destroy: vi.fn(), onUpdate: undefined} as unknown as WidgetRPC;
  return {manager: new WidgetManager(rpc, config), call, rpc, history};
}

it('authenticates by token and sends plain text only to the discovered support peer', async() => {
  const {manager, call} = fixture();
  await manager.authenticate('customer-token');
  expect(call.mock.calls[0]).toEqual(['auth.importBotAuthorization', {flags: 0, api_id: 1, api_hash: config.apiHash, bot_auth_token: 'customer-token'}]);
  await manager.send('@gif <b>plain text</b> 🙂', '123');
  expect(call).toHaveBeenLastCalledWith('messages.sendMessage', {
    peer: {_: 'inputPeerUser', user_id: 42, access_hash: '12'}, message: '@gif <b>plain text</b> 🙂', random_id: '123', no_webpage: true
  });
  expect(manager.supportName).toBe('Help desk');
});

it('filters unrelated conversations and reconciles edited/deleted history', async() => {
  const {manager, history, rpc} = fixture();
  await manager.authenticate('token');
  history.push(message(2, 99, 'private to somebody else'));
  await manager.history();
  expect(manager.view.map(({text}) => text)).toEqual(['hello']);
  rpc.onUpdate({_: 'updateNewMessage', message: message(3, 99)});
  expect(manager.view).toHaveLength(1);
  rpc.onUpdate({_: 'updateEditMessage', message: message(1, 42, 'edited')});
  expect(manager.view[0].text).toBe('edited');
  rpc.onUpdate({_: 'updateDeleteMessages', messages: [1]});
  expect(manager.view).toHaveLength(0);
});

it('uploads ordinary files without stickers, animations, contacts or custom entities', async() => {
  const {manager, call} = fixture();
  await manager.authenticate('token');
  await manager.send('Details', 'repeatable-id', file('hello', 'details.txt', 'text/plain'));
  const request = call.mock.calls.find(([method]) => method === 'messages.sendMedia')[1] as any;
  expect(request.peer.user_id).toBe(42);
  expect(request.random_id).toBe('repeatable-id');
  expect(request.media._).toBe('inputMediaUploadedDocument');
  expect(request.media.pFlags).toEqual({force_file: true});
  expect(request.media.attributes).toEqual([{_: 'documentAttributeFilename', file_name: 'details.txt'}]);
  expect(request.entities).toBeUndefined();
});

it.each([
  ['GIF89a', 'disguised.png', 'image/png'], ['bytes', 'animation.gif', ''],
  ['bytes', 'sticker.tgs', ''], ['bytes', 'person.vcf', 'text/vcard']
])('blocks forbidden attachments before uploading', async(bytes, name, type) => {
  await expect(validateAttachment(file(bytes, name, type))).rejects.toThrow('WIDGET_FILE_TYPE');
});

it.each([undefined, file('hello', 'details.txt', 'text/plain')])('has no send path before authentication or after session teardown', async(attachment) => {
  const {manager, call} = fixture();
  await expect(manager.send('hello', '1', attachment)).rejects.toThrow('WIDGET_CLOSED');
  expect(call).not.toHaveBeenCalled();
  await manager.authenticate('token');
  manager.destroy();
  call.mockClear();
  await expect(manager.send('hello', '1', attachment)).rejects.toThrow('WIDGET_CLOSED');
  expect(call).not.toHaveBeenCalled();
});

function documentMessage(size: number): Message.message {
  return {...message(), media: {_: 'messageMediaDocument', pFlags: {}, document: {
    _: 'document', id: '100', access_hash: '200', file_reference: new Uint8Array([1]),
    date: 100, pFlags: {}, mime_type: 'application/octet-stream', size, dc_id: 1,
    attributes: [{_: 'documentAttributeFilename', file_name: 'details.txt'}]
  }}};
}

it('downloads complete attachments in ordered parts', async() => {
  const {manager, call, history} = fixture();
  const partSize = 256 * 1024;
  history[0] = documentMessage(partSize + 5);
  await manager.authenticate('token');
  await manager.history();
  call.mockResolvedValueOnce({_: 'upload.file', bytes: new Uint8Array(partSize).fill(1)})
  .mockResolvedValueOnce({_: 'upload.file', bytes: new Uint8Array(5).fill(2)});
  const result = await manager.download(1);
  expect(result.name).toBe('details.txt');
  expect(result.photo).toBe(false);
  expect(result.blob.size).toBe(partSize + 5);
  expect(result.blob.type).toBe('application/octet-stream');
  const requests = call.mock.calls.filter(([method]) => method === 'upload.getFile').map(([, params]) => params);
  expect(requests).toEqual([0, partSize].map((offset) => ({
    location: {_: 'inputDocumentFileLocation', id: '100', access_hash: '200', file_reference: new Uint8Array([1]), thumb_size: ''},
    offset, limit: partSize
  })));
});

it.each([0, 4, 6])('rejects attachment bytes that do not match the declared size', async(length) => {
  const {manager, call, history} = fixture();
  history[0] = documentMessage(5);
  await manager.authenticate('token');
  await manager.history();
  call.mockResolvedValueOnce({_: 'upload.file', bytes: new Uint8Array(length)});
  await expect(manager.download(1)).rejects.toThrow('WIDGET_ATTACHMENT_UNAVAILABLE');
});
