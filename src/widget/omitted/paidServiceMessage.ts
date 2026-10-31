import wrapUnsupportedMessagePlate from '@components/chat/bubbleParts/unsupportedMessagePlate';
import type {Message} from '@layer';

export default function addPaidServiceMessage({bubble, message}: {bubble: HTMLElement, message: Message}) {
  if(message._ === 'message' && (+message.paid_message_stars || message.repayRequest)) {
    bubble.prepend(wrapUnsupportedMessagePlate());
    return Promise.resolve();
  }
}
