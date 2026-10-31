import type {Message} from '@layer';

export default function isPinServiceMessage(message: Message) {
  return message?._ === 'messageService' && message.action?._ === 'messageActionPinMessage';
}
