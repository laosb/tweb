import Chat from '@components/chat/chat';
import ChatTopbar from '@components/chat/topbar';
import ChatBubbles from '@components/chat/bubbles';
import PeerTitle from '@components/peerTitle';
import cancelEvent from '@helpers/dom/cancelEvent';
import {getWidgetInsetTop} from '@/widget/insets';

// The widget entry installs these before Chat.init. Keep the topbar object for
// cleanup and upstream references, but build no controls, plates or listeners.
export function restrictChatPresentation() {
  const chat = Chat.prototype as any;
  const bubbles = ChatBubbles.prototype as any;
  const topbar = ChatTopbar.prototype as any;
  const inertTopbar = ['constructUtils', 'constructPeerHelpers', 'finishPeerChange',
    'setupPinnedMessageForPeer', 'revealPreparedPinnedMessage', 'setTitle'];
  const targets = [
    ...inertTopbar.map((key) => [topbar, key]),
    [topbar, 'construct'], [chat, '_isLikeGroup'], [chat, 'recomputePaddings'],
    [chat, 'init'], [chat, 'initSearch'], [chat, 'isPinnedMessagesNeeded'],
    [bubbles, 'attachContainerListeners'], [bubbles, 'createTitle'], [PeerTitle.prototype, 'update']
  ];
  for(const [object, key] of targets) {
    if(typeof(object[key]) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  }
  for(const key of inertTopbar) topbar[key] = (): undefined => undefined;
  topbar.construct = function() {
    // The init wrapper detaches this before the browser paints. Cleanup still uses it.
    if(typeof(this.setFloating) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: setFloating');
    this.setFloating = (): undefined => undefined;
    this.container = document.createElement('div');
  };
  chat.initSearch = (): undefined => undefined;
  chat.isPinnedMessagesNeeded = () => false;
  chat._isLikeGroup = () => Promise.resolve(true);

  const init = chat.init;
  chat.init = function(...args: unknown[]) {
    const result = init.apply(this, args);
    if(!this.topbar?.container) throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: topbar.container');
    this.topbar.container.remove();
    return result;
  };

  // Keep the original PeerTitle node and its update registration. An anchor without
  // href or a tab stop is ordinary text to the browser and accessibility tree.
  const senderTitles = new WeakSet<HTMLElement>();
  const neutralizeTitle = (element: HTMLElement) => {
    element.removeAttribute('href');
    element.removeAttribute('tabindex');
    element.removeAttribute('draggable');
  };
  const createTitle = bubbles.createTitle;
  bubbles.createTitle = function(...args: unknown[]) {
    const result = createTitle.apply(this, args);
    senderTitles.add(result.element);
    neutralizeTitle(result.element);
    return result;
  };
  const updateTitle = PeerTitle.prototype.update;
  PeerTitle.prototype.update = function(...args) {
    // Upstream assigns href synchronously, before loading the title asynchronously.
    const result = updateTitle.apply(this, args);
    if(senderTitles.has(this.element)) neutralizeTitle(this.element);
    return result;
  };

  const attachContainerListeners = bubbles.attachContainerListeners;
  bubbles.attachContainerListeners = function() {
    const result = attachContainerListeners.call(this);
    // Touch uses mousedown; also stop regular and modified clicks before delegation.
    const onSenderClick = (event: Event) => {
      if((event.target as Element).closest('.bubbles-group-avatar, .name .peer-title')) cancelEvent(event);
    };
    for(const type of ['mousedown', 'click', 'auxclick']) {
      this.listenerSetter.add(this.scrollable.container)(type, onSenderClick, {capture: true});
    }
    return result;
  };

  const recomputePaddings = chat.recomputePaddings;
  chat.recomputePaddings = function() {
    recomputePaddings.call(this);
    const top = getWidgetInsetTop(this);
    this.chatPaddingTop[1](top);
    if(this.bubbles?.paddingTop) this.bubbles.paddingTop.style.height = top + 'px';
    this.bubbles?.updateStickyIntersectorRootMargin?.();
  };
}
