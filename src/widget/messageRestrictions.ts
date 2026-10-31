import ChatBubbles, {FullMid, makeFullMid, splitFullMid} from '@components/chat/bubbles';
import ChatContextMenu from '@components/chat/contextMenu';
import ChatInput from '@components/chat/input';
import {AppSidebarLeft} from '@components/sidebarLeft';
import contextMenuController from '@helpers/contextMenuController';
import idleController from '@helpers/idleController';
import I18n from '@lib/langPack';
import {SITE_HASHTAGS} from '@lib/richTextProcessor';
import uiNotificationsManager from '@lib/uiNotificationsManager';
import type {Message} from '@layer';
import {widgetReceivedMessage} from '@/widget/receivedContent';
import isPinServiceMessage from '@/widget/isPinServiceMessage';

const MENU_KEYS = new Set(['VoiceChat.OpenProfile', 'SavedMusic.AddToProfile', 'SavedMusic.RemoveFromProfile']);
const MENU_ICONS = new Set(['pin', 'unpin', 'forward', 'search', 'tag_filter']);

export function restrictMessageActions() {
  const bubbles = ChatBubbles.prototype as any;
  const contextMenu = ChatContextMenu.prototype as any;
  const input = ChatInput.prototype as any;
  const targets = [
    [contextMenu, 'setButtons'], [bubbles, 'renderMessage'], [bubbles, 'getHistory1'],
    [bubbles, 'isHistoryNeverDrawn'], [bubbles, '_renderNewMessage'], [input, 'initMessagesForward'],
    [input, 'constructForwardElements'], [AppSidebarLeft.prototype, 'initSearch'],
    [contextMenuController, 'openBtnMenu'], [uiNotificationsManager, 'buildNotification']
  ] as const;
  for(const [object, key] of targets) {
    if(typeof((object as any)[key]) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  }
  if(typeof(SITE_HASHTAGS.Telegram) !== 'string') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: SITE_HASHTAGS.Telegram');

  const setButtons = contextMenu.setButtons;
  contextMenu.setButtons = function() {
    const result = setButtons.call(this);
    this.buttons = this.buttons.filter((button: {icon: string, text?: string}) => !MENU_ICONS.has(button.icon) && !MENU_KEYS.has(button.text));
    return result;
  };

  input.initMessagesForward = input.constructForwardElements = (): undefined => undefined;
  AppSidebarLeft.prototype.initSearch = () => ({open() {}, openWithPeerId() {}, openWithArchive() {}, close() {}});
  // Both hashtags and cashtags become ordinary text, including in reactive message bodies.
  SITE_HASHTAGS.Telegram = '';

  const renderMessage = bubbles.renderMessage;
  bubbles.renderMessage = async function(options: {message: Message, bubble: HTMLElement}) {
    // Let safeRenderMessage discard the skeleton and record its skipped mid. No
    // grouping, date separator or unread observer is created for this message.
    if(isPinServiceMessage(options.message)) return;
    const message = widgetReceivedMessage(options.message);
    const result = await renderMessage.call(this, message === options.message ? options : {...options, message});
    if(options.message._ === 'message' && options.message.views) {
      options.bubble.querySelector('.bubble-beside-button.forward')?.remove();
    }
    return result;
  };

  const renderNewMessage = bubbles._renderNewMessage;
  bubbles._renderNewMessage = function(message: Message, ...args: unknown[]) {
    if(!isPinServiceMessage(message)) return renderNewMessage.call(this, message, ...args);
    const atBottom = this.scrolledDown && this.scrollable.loadedAll.bottom;
    const middleware = this.getMiddleware();
    return renderNewMessage.call(this, message, ...args).then((result: unknown) => {
      // A hidden last message has no unread observer. Use the normal bottom-read
      // path, preserving focus, peer changes and the upstream suspicious-peer hold.
      if(atBottom) idleController.getFocusPromise().then(() => {
        if(middleware() && this.scrolledDown && this.scrollable.loadedAll.bottom) this.onScrolledAllDown();
      });
      return result;
    });
  };

  // Pagination normally starts at a visible bubble. Advance across adjacent
  // skipped pins so a whole page of them cannot keep fetching the same slice.
  const getHistory1 = bubbles.getHistory1;
  bubbles.getHistory1 = function(maxId: FullMid, reverse?: boolean, ...args: unknown[]) {
    let mid = maxId && splitFullMid(maxId).mid;
    if(!mid && !this.getRenderedLength() && this.skippedMids.size) {
      const mids = [...this.skippedMids as Set<FullMid>]
      .filter((fullMid) => isPinServiceMessage(this.chat.getMessage(fullMid)))
      .map((fullMid) => splitFullMid(fullMid).mid);
      if(mids.length) mid = reverse ? Math.min(...mids) : Math.max(...mids);
    }
    const found = mid && this.chat.getHistoryStorage().history.findSlice(mid);
    if(found) {
      const step = reverse ? 1 : -1;
      for(let i = found.index + step; i >= 0 && i < found.slice.length; i += step) {
        const next = found.slice[i];
        if(!this.skippedMids.has(makeFullMid(this.peerId, next)) || !isPinServiceMessage(this.chat.getMessage(next))) break;
        mid = next;
      }
      maxId = makeFullMid(this.peerId, mid);
    }
    return getHistory1.call(this, maxId, reverse, ...args);
  };

  const isHistoryNeverDrawn = bubbles.isHistoryNeverDrawn;
  bubbles.isHistoryNeverDrawn = function() {
    if(isHistoryNeverDrawn.call(this)) return true;
    const {history} = this.chat.getHistoryStorage();
    let hasPin = false;
    const hidden = history.slice.every((mid: number) => {
      if(isPinServiceMessage(this.chat.getMessage(mid))) return hasPin = true;
      return this.skippedMids.has(makeFullMid(this.peerId, mid));
    });
    return hasPin && hidden;
  };

  const buildNotification = uiNotificationsManager.buildNotification;
  uiNotificationsManager.buildNotification = function(payload) {
    if('message' in payload && isPinServiceMessage(payload.message)) return Promise.resolve(false);
    return buildNotification.call(this, payload);
  };

  // A formatted date's reminder forwards the message to Saved Messages. Its
  // menu is local to appImManager, so filter the stable i18n key at menu opening.
  const openBtnMenu = contextMenuController.openBtnMenu;
  contextMenuController.openBtnMenu = function(element, ...args) {
    for(const text of element.querySelectorAll<HTMLElement>('.btn-menu-item-text')) {
      if((I18n.weakMap.get(text) as I18n.IntlElement)?.key === 'Chat.Send.SetReminder') text.closest('.btn-menu-item')?.remove();
    }
    return openBtnMenu.call(this, element, ...args);
  };
}
