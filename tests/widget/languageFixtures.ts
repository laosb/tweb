import type {Document, Message, MessageAction, MessageMedia} from '@layer';
import wrapMessageForReply from '@components/wrappers/messageForReply';
import wrapMessageActionText from '@components/wrappers/messageActionTextNew';
import wrapRichText from '@lib/richTextProcessor/wrapRichText';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import rootScope from '@lib/rootScope';

// Synthetic received content goes through the same wrappers as bubbles/replies.
// Imported only by the harness transform, never by the shipping widget.
export async function renderPreviews(base: Message.message) {
  const managers = bindManagersToSession(rootScope.managers);
  const panel = document.createElement('div');
  panel.id = 'widget-language-fixtures';
  const add = (content: Node | string) => {
    const row = document.createElement('div');
    row.append(content);
    panel.append(row);
  };
  const media: MessageMedia[] = [
    {_: 'messageMediaPhoto', pFlags: {}},
    {_: 'messageMediaPhoto', pFlags: {}, ttl_seconds: 10},
    {_: 'messageMediaUnsupported'},
    ...(['voice', 'round', 'video'] as const).map(type => ({
      _: 'messageMediaDocument' as const, pFlags: {[type]: true}, ttl_seconds: 10
    }))
  ];
  media.push({...base.media, ttl_seconds: 10} as MessageMedia);
  for(const type of ['voice', 'round', 'video']) {
    const document = {_: 'document', id: '0', access_hash: '0', file_reference: [], date: base.date,
      mime_type: 'application/octet-stream', size: 0, dc_id: 1, attributes: [], type} as Document.document;
    media.push({_: 'messageMediaDocument', pFlags: {}, document, ttl_seconds: 10});
  }
  for(const item of media) {
    for(const out of [false, true]) {
      const message = {...base, message: '', media: item, pFlags: {...base.pFlags, out: out || undefined}};
      add(await wrapMessageForReply({message, managers}));
    }
  }
  const actions: MessageAction[] = [
    {_: 'messageActionHistoryClear'},
    {_: 'messageActionCustomAction', message: 'Application service text'},
    {_: 'messageActionScreenshotTaken'},
    ...[0, 1, 2, 60, 3600, 86400, 604800, 2592000, 31536000].map(period => ({_: 'messageActionSetMessagesTTL' as const, period}))
  ];
  for(const action of actions) {
    for(const out of [false, true]) {
      const message = {...base, _: 'messageService', action, pFlags: {...base.pFlags, out: out || undefined},
        fromId: out ? rootScope.myId : base.peerId} as Message.messageService;
      add(await wrapMessageActionText({message, managers}));
    }
  }
  const now = Math.floor(Date.now() / 1000);
  for(const delta of [0, 5, 120, 7200, 172800, 1209600, 5184000, 63072000]) {
    for(const sign of [-1, 1]) {
      add(wrapRichText('date', {entities: [{_: 'messageEntityFormattedDate', offset: 0, length: 4,
        date: now + delta * sign, pFlags: {relative: true}}]}));
    }
  }
  document.body.append(panel);
  const text = panel.textContent;
  panel.remove();
  return {rows: panel.childElementCount, text};
}

export function addTextEntities(mid: number) {
  const bubble = document.querySelector(`.bubble[data-mid="${mid}"]`);
  const panel = document.createElement('div');
  panel.id = 'widget-language-links';
  panel.append(wrapRichText('date', {entities: [{_: 'messageEntityFormattedDate', offset: 0, length: 4,
    date: Math.floor(Date.now() / 1000) + 86400, pFlags: {relative: true}}]}));
  panel.append(document.createElement('br'));
  panel.append(wrapRichText('Different destination', {entities: [{_: 'messageEntityTextUrl', offset: 0, length: 21,
    url: 'https://widget-coverage.invalid/path'}]}));
  bubble.querySelector('.message').append(panel);
}

// Deliberately payload-free: interception must happen before special renderers
// dereference gifts, games, web-page attributes, call metadata or contact cards.
const excludedMedia = ['Game', 'Giveaway', 'GiveawayResults', 'Contact', 'Geo', 'GeoLive',
  'Venue', 'Invoice', 'PaidMedia', 'Story', 'Dice', 'WebPage'];
const excludedActions = ['StarGift', 'StarGiftUnique', 'StarGiftPurchaseOffer', 'GiftPremium',
  'GiftCode', 'GiftStars', 'GiftTon', 'PrizeStars', 'GiveawayLaunch', 'GiveawayResults',
  'PhoneCall', 'ConferenceCall', 'SuggestBirthday', 'SuggestProfilePhoto', 'NoForwardsRequest',
  'SetChatTheme', 'SetChatWallPaper', 'GameScore', 'PaymentSent'];
const excludedMetadata = [{factcheck: {}}, {reply_to: {_: 'messageReplyStoryHeader'}}];
export function excludedMessages() {
  return excludedMedia.length + excludedActions.length + excludedMetadata.length;
}

export async function renderExcluded(mid: number, index: number) {
  const {chat} = (window as any).appImManager;
  const base = chat.getMessage(mid);
  const message = index >= excludedMedia.length + excludedActions.length ? {
    ...base, ...excludedMetadata[index - excludedMedia.length - excludedActions.length]
  } : index < excludedMedia.length ? {
    ...base, media: {_: 'messageMedia' + excludedMedia[index]}
  } : {
    ...base, _: 'messageService', media: undefined,
    action: {_: 'messageAction' + excludedActions[index - excludedMedia.length]}
  };
  await chat.bubbles.safeRenderMessage({message, bubble: chat.bubbles.getBubble(chat.peerId, mid)});
  return wrapMessageForReply({message, managers: chat.managers, plain: true});
}

export async function restoreMessage(mid: number) {
  const {chat} = (window as any).appImManager;
  await chat.bubbles.safeRenderMessage({message: chat.getMessage(mid), bubble: chat.bubbles.getBubble(chat.peerId, mid)});
}
