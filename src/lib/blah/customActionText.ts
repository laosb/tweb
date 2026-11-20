import type {Message, SponsoredMessage} from '@layer';

/**
 * A custom service action's text (`messageActionCustomAction`): the one service line that is the
 * sender's own words, so it is selected and copied like a message's text. Kept out of the chat
 * components so that they stay as close to upstream as possible.
 */
export function getCustomActionText(message: Message | SponsoredMessage) {
  const action = (message as Message.messageService)?.action;
  return action?._ === 'messageActionCustomAction' ? action.message : undefined;
}

/** Copies a custom service action like a message: its text set as the message's own */
export function asCopyableMessage<T extends Message | SponsoredMessage>(message: T): T {
  const text = getCustomActionText(message);
  return text ? {...message, message: text, entities: []} as T : message;
}
