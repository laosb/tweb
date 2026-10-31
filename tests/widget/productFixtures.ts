import rootScope from '@lib/rootScope';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import * as pickers from '@components/popups/pickUser';
import {getKeyboardButtonHandler, getRichPageButtonHandler} from '@components/wrappers/keyboardButton';
import {INTERNAL_LINK_TYPE} from '@lib/internalLink';
import StickerType from '@config/stickerType';
import type {Message} from '@layer';

// Harness-only direct-entry probes. Observe requests at the real manager handoff.
export async function restrictedEntries() {
  const {input} = hotReloadGuard.appImManager.chat;
  const reply = input.getReplyTo();
  await input.createReplyPicker(reply);
  await (input as any).changeReplyRecipient();
  const outcomes = await Promise.allSettled([
    pickers.showPickUser2Popup({} as any), pickers.showPickUser3Popup(), pickers.showSharingPicker2Popup(),
    pickers.showReplyPickerPopup(), pickers.showContactPickerPopup()
  ]);
  for(const type of ['inlineButtonTypeSwitchInline', 'buttonTypeRequestPeer']) {
    const options = {button: {type: {_: type, pFlags: {}}}, label: 'restricted', chat: hotReloadGuard.appImManager.chat} as any;
    if(getRichPageButtonHandler(options) || getKeyboardButtonHandler(options)) throw new Error('Restricted rich handler survived');
  }
  const {internalLinkProcessor: links, appImManager: im} = hotReloadGuard;
  for(const kind of Object.values(INTERNAL_LINK_TYPE).filter(kind => typeof(kind) === 'number')) {
    await links.processInternalLink({_: kind, domain: 'other', post: '10', channel: '99999'} as any);
  }
  for(const [key, method] of Object.entries(links)) {
    if(key.startsWith('process') && typeof(method) === 'function') {
      await method({_: INTERNAL_LINK_TYPE.MESSAGE, domain: 'other', post: '10'});
    }
  }
  await im.openUsername({userName: 'other', lastMsgId: 10});
  await im.open({peerId: (99999).toPeerId()});
  return {cancelled: outcomes.every(outcome => outcome.status === 'rejected'), waiting: !!(input as any).helperWaitingReply,
    replyUnchanged: input.getReplyTo()?.replyToMsgId === reply?.replyToMsgId};
}

let restore: () => Promise<void>;
export async function restoreMedia() { await restore?.(); restore = undefined; }

// Reuse the received WebM's real stored bytes, decorating it as peer-DC sticker
// metadata. Managed-account uploads cannot themselves mint sticker-pack metadata.
export async function renderReceivedPackMedia(mid: number, custom: boolean) {
  if(restore) throw new Error('Restore the preceding media fixture first');
  const tabManagers = rootScope.managers;
  const {chat} = hotReloadGuard.appImManager;
  const bubbles = chat.bubbles as any;
  const base = chat.getMessage(mid) as Message.message;
  if(base.media?._ !== 'messageMediaDocument' || base.media.document?._ !== 'document') throw new Error('Need received WebM');
  const doc = {...base.media.document, type: 'sticker', sticker: StickerType.WebM, animated: true, w: 160, h: 120,
    stickerEmojiRaw: '😀', stickerSetInput: {_: 'inputStickerSetID', id: '4242', access_hash: '0'},
    attributes: [...base.media.document.attributes, {_: custom ? 'documentAttributeCustomEmoji' : 'documentAttributeSticker',
      pFlags: {free: true}, alt: '😀', stickerset: {_: 'inputStickerSetID', id: '4242', access_hash: '0'}}]} as any;
  const message = {...base, message: custom ? 'Received custom emoji 😀' : '',
    entities: custom ? [{_: 'messageEntityCustomEmoji', offset: 22, length: 2, document_id: doc.id}] : [],
    media: custom ? undefined : {...base.media, document: doc}} as Message.message;
  message.totalEntities = message.entities;
  const original = bubbles.managers;
  const managers = Object.create(original);
  managers.appEmojiManager = new Proxy(original.appEmojiManager, {get(target, key) {
    if(key === 'getCustomEmojiDocuments' || key === 'getCachedCustomEmojiDocuments') return async() => [doc];
    if(key === 'getCustomEmojiDocument') return async() => doc;
    return target[key as keyof typeof target];
  }});
  bubbles.managers = managers;
  rootScope.managers = managers;
  restore = async() => {
    bubbles.managers = original;
    rootScope.managers = tabManagers;
    const bubble = bubbles.getBubble(chat.peerId, mid);
    delete bubble.message;
    await bubbles.safeRenderMessage({message: base, bubble});
    await bubbles.messagesQueuePromise;
  };
  await bubbles.safeRenderMessage({message, bubble: bubbles.getBubble(chat.peerId, mid)});
  await bubbles.messagesQueuePromise;
  const bubble = bubbles.getBubble(chat.peerId, mid);
  bubble.message = message;
  await bubbles.scrollToBubble(bubble, 'center', undefined, 0);
  return {docId: doc.id, text: message.message, peerId: rootScope.myId};
}
