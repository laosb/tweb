import type {Message} from '@layer';
import {isExcludedService, widgetReceivedMessage} from '@/widget/receivedContent';

it.each(['Photo', 'Document', 'Poll', 'ToDo', 'Unsupported', 'Empty'])('keeps DC media %s unchanged', type => {
  const message = {_: 'message', media: {_: 'messageMedia' + type}} as Message;
  expect(widgetReceivedMessage(message)).toBe(message);
});

it.each(['CustomAction', 'ScreenshotTaken', 'SetMessagesTTL', 'PinMessage', 'TodoAppendTasks',
  'TodoCompletions', 'PollAppendAnswer', 'PollDeleteAnswer', 'Empty', 'HistoryClear'])('keeps service %s unchanged', type => {
  const message = {_: 'messageService', action: {_: 'messageAction' + type}} as Message;
  expect(isExcludedService(message)).toBe(false);
  expect(widgetReceivedMessage(message)).toBe(message);
});

it.each(['StarGift', 'StarGiftUnique', 'StarGiftPurchaseOffer', 'GiftPremium', 'GiftCode', 'GiftStars',
  'GiftTon', 'GiveawayLaunch', 'GiveawayResults', 'PhoneCall', 'ConferenceCall', 'SuggestBirthday',
  'SuggestProfilePhoto', 'NoForwardsRequest', 'SetChatTheme', 'SetChatWallPaper', 'GameScore'])('replaces service %s without reading its payload', type => {
  const message = {_: 'messageService', id: 42, mid: 42, date: 100, peerId: 1,
    action: {_: 'messageAction' + type}, pFlags: {out: true}} as unknown as Message;
  expect(isExcludedService(message)).toBe(true);
  const result = widgetReceivedMessage(message) as Message.message;
  expect(result).toMatchObject({_: 'message', id: 42, mid: 42, date: 100, peerId: 1,
    pFlags: {out: true}, media: {_: 'messageMediaUnsupported'}});
  expect(message._).toBe('messageService');
});

it.each(['Game', 'Giveaway', 'GiveawayResults', 'Contact', 'Geo', 'GeoLive', 'Venue',
  'Invoice', 'PaidMedia', 'Story', 'Dice', 'WebPage'])('replaces media %s and removes special-renderer inputs', type => {
  const message = {_: 'message', media: {_: 'messageMedia' + type}, message: 'caption', grouped_id: '1',
    rich_message: {}, reply_markup: {}, totalEntities: []} as unknown as Message;
  const result = widgetReceivedMessage(message) as Message.message;
  expect(result.media._).toBe('messageMediaUnsupported');
  expect(result.rich_message).toBeUndefined();
  expect(result.grouped_id).toBeUndefined();
  expect(result.reply_markup).toBeUndefined();
  expect(result.message).toBe('');
  expect((message as Message.message).message).toBe('caption');
});

it('keeps client placeholders and ordinary text', () => {
  for(const message of [{_: 'messageService'}, {_: 'message', message: 'hello'}] as Message[]) {
    expect(widgetReceivedMessage(message)).toBe(message);
  }
});

it('preserves channel service reply targets but falls back for the same event in a private chat', () => {
  const action = {_: 'messageActionChatEditTitle', title: 'Group title'};
  const target = {_: 'messageService', peerId: -123, action} as Message;
  expect(widgetReceivedMessage(target)).toBe(target);
  const privateMessage = {...target, peerId: 123} as Message;
  expect((widgetReceivedMessage(privateMessage) as Message.message).media._).toBe('messageMediaUnsupported');
});

it('drops an unexpected fact-check renderer and preserves supported rich content', () => {
  const base = {_: 'message', message: 'text', rich_message: {blocks: []}} as unknown as Message;
  expect(widgetReceivedMessage(base)).toBe(base);
  const result = widgetReceivedMessage({...base, factcheck: {}} as Message) as Message.message;
  expect(result.factcheck).toBeUndefined();
  expect(result.media._).toBe('messageMediaUnsupported');
});

it.each(['ChatJoinedYou', 'ChatLeaveYou', 'ChannelEditPhoto'])('keeps manager-normalized reply action %s', type => {
  const message = {_: 'messageService', peerId: -123, action: {_: 'messageAction' + type}} as unknown as Message;
  expect(widgetReceivedMessage(message)).toBe(message);
});

it('falls back for a story reply header before following its reference', () => {
  const message = {_: 'message', message: 'text', reply_to: {_: 'messageReplyStoryHeader'}} as unknown as Message;
  const result = widgetReceivedMessage(message) as Message.message;
  expect(result.media._).toBe('messageMediaUnsupported');
  expect(result.reply_to).toBeUndefined();
  expect(result.fwd_from).toBeUndefined();
});
