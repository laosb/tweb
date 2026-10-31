import wrapMessageActionText from '@components/wrappers/messageActionTextNew?widget-original';
import I18n, {i18n} from '@lib/langPack';
import {isExcludedService} from '@/widget/receivedContent';
import isPinServiceMessage from '@/widget/isPinServiceMessage';

if(typeof(wrapMessageActionText) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: wrapMessageActionTextNew');

// Reply previews can point at a hidden service message too. Keep all other
// formatting and error handling in the upstream wrapper.
const wrap: typeof wrapMessageActionText = (options) => {
  if(isPinServiceMessage(options.message)) return Promise.resolve(options.plain ? '' : document.createElement('span')) as any;
  // Blah reports screenshots, but upstream has no localized action formatter.
  if(isExcludedService(options.message) || (options.message._ === 'messageService' && options.message.action?._ === 'messageActionScreenshotTaken')) return Promise.resolve(options.plain ? I18n.format('UnsupportedMessageTitle', true) : i18n('UnsupportedMessageTitle')) as any;
  return wrapMessageActionText(options) as any;
};
export default wrap;
