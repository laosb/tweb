import ChatBubbles from '@components/chat/bubbles';
import {isRichMessageButtonTarget} from '@components/chat/bubbles/richMessage';
import cancelEvent from '@helpers/dom/cancelEvent';

export function restrictPacks() {
  const bubbles = ChatBubbles.prototype as any;
  for(const key of ['attachContainerListeners', 'openEmojiPackByTarget']) {
    if(typeof(bubbles[key]) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  }
  bubbles.openEmojiPackByTarget = (): undefined => undefined;
  const attach = bubbles.attachContainerListeners;
  bubbles.attachContainerListeners = function() {
    const result = attach.call(this);
    // Poll-option stickers and custom emoji otherwise look up their document/pack
    // before reaching the popup. Capture clicks, preserving rich-button links.
    const onPackClick = (event: Event) => {
      const target = event.target as Element;
      if(target.closest('a') || isRichMessageButtonTarget(target)) return;
      if(target.closest('.custom-emoji, .poll-option-sticker') ||
        target.closest('.media-sticker-wrapper')?.closest('.bubble.sticker')) cancelEvent(event);
    };
    for(const type of ['click', 'auxclick']) this.listenerSetter.add(this.scrollable.container)(type, onPackClick, {capture: true});
    return result;
  };
}
