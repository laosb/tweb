import ChatBubbles from '@components/chat/bubbles';
import ChatContextMenu from '@components/chat/contextMenu';
import ChatTopbar from '@components/chat/topbar';
import type {SendingStatusIconState} from '@components/sendingStatusIcon';

// Installed only by the compile-time widget entry, before opening the support chat.
export function restrictChatStatus() {
  const bubbles = ChatBubbles.prototype as any;
  const contextMenu = ChatContextMenu.prototype as any;
  const topbar = ChatTopbar.prototype as any;
  const targets = [
    [bubbles, 'setBubbleSendingStatus'], [contextMenu, 'setButtons'],
    [topbar, 'createStatus']
  ] as const;
  for(const [object, key] of targets) {
    if(typeof(object[key]) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  }

  // All bubble kinds, initial history and live read updates use this renderer.
  // Keep the underlying read cursor intact; only its presentation becomes sent.
  const setBubbleSendingStatus = bubbles.setBubbleSendingStatus;
  bubbles.setBubbleSendingStatus = function(bubble: HTMLElement, status?: SendingStatusIconState, first?: boolean) {
    return setBubbleSendingStatus.call(this, bubble, status === 'read' ? 'sent' : status, first);
  };

  // Both the private read-date item and the group seen-by/reactions item use views.
  // Remove them before verification, so opening the menu does not request read data.
  const setButtons = contextMenu.setButtons;
  contextMenu.setButtons = function() {
    const result = setButtons.call(this);
    this.buttons = this.buttons.filter((button: {localName?: string}) => button.localName !== 'views');
    return result;
  };

  // No presence requests, refresh timer or typing/user-update listeners for this line.
  topbar.createStatus = (): undefined => undefined;
}
