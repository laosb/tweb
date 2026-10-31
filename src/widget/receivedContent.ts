import type {Message} from '@layer';

// BlahWireBuilder.tlMessage / messageMedia and BlahWireBuilder+Polls rebuild
// private media from files or aggregates; they never relay arbitrary TL media.
const MEDIA = new Set([
  'messageMediaEmpty', 'messageMediaUnsupported', 'messageMediaPhoto',
  'messageMediaPhotoExternal', 'messageMediaDocument', 'messageMediaPoll', 'messageMediaToDo'
]);

// Private producers: messages, historyTTL, privatePins, todo, polls and
// appServiceMessages. Empty/history-clear also cover the client's placeholders.
const ACTIONS = new Set([
  'messageActionEmpty', 'messageActionHistoryClear', 'messageActionCustomAction',
  'messageActionScreenshotTaken', 'messageActionSetMessagesTTL', 'messageActionPinMessage',
  'messageActionTodoAppendTasks', 'messageActionTodoCompletions',
  'messageActionPollAppendAnswer', 'messageActionPollDeleteAnswer'
]);

// External reply targets can be channel service messages (replyQuote.swift).
// These never turn a private received event into a supported special bubble.
const REPLY_ACTIONS = new Set([
  'messageActionChannelCreate', 'messageActionChatAddUser',
  'messageActionChatAddUsers', 'messageActionChatDeleteUser', 'messageActionChatJoinedByLink',
  'messageActionChatJoinedByRequest', 'messageActionChatEditTitle', 'messageActionChannelEditTitle',
  'messageActionChatEditPhoto', 'messageActionChatDeletePhoto', 'messageActionChatEditVideo',
  'messageActionChannelEditPhoto', 'messageActionChannelEditVideo', 'messageActionChannelDeletePhoto',
  'messageActionChatLeave',
  'messageActionChatLeaveYou', 'messageActionChatJoined', 'messageActionChatJoinedYou',
  'messageActionTopicCreate', 'messageActionTopicEdit', 'messageActionChangeCommunity',
  'messageActionPaidMessagesPrice'
]);

export function isExcludedService(message: Message) {
  return message?._ === 'messageService' && message.action && !ACTIONS.has(message.action._) &&
    !(message.peerId < 0 && REPLY_ACTIONS.has(message.action._));
}

/** A render-only copy: storage, history cursors, reactions and read state keep their IDs. */
export function widgetReceivedMessage<T extends Message>(message: T): T {
  const storyReply = message?._ !== 'messageEmpty' && message?.reply_to?._ === 'messageReplyStoryHeader';
  const excluded = storyReply || isExcludedService(message) ||
    (message?._ === 'message' && ((message.media && !MEDIA.has(message.media._)) || message.factcheck));
  if(!excluded) return message;
  return {
    ...message,
    _: 'message',
    message: '',
    media: {_: 'messageMediaUnsupported'},
    action: undefined,
    rich_message: undefined,
    factcheck: undefined,
    totalEntities: undefined,
    entities: undefined,
    reply_markup: undefined,
    reply_to: storyReply ? undefined : (message as Message.message).reply_to,
    grouped_id: undefined
  } as T;
}
