import wrapMessageForReply from '@components/wrappers/messageForReply?widget-original';
import {widgetReceivedMessage} from '@/widget/receivedContent';

if(typeof(wrapMessageForReply) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: wrapMessageForReply');

const wrap: typeof wrapMessageForReply = (options) => wrapMessageForReply({
  ...options,
  message: widgetReceivedMessage(options.message as any)
}) as any;
export default wrap;
