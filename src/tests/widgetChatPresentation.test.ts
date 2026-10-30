import Chat from '@components/chat/chat';
import ChatBubbles from '@components/chat/bubbles';
import PeerTitle from '@components/peerTitle';
import ChatTopbar from '@components/chat/topbar';
import {restrictChatPresentation} from '@/widget/chatRestrictions';

const upstream = vi.hoisted(() => vi.fn());
vi.mock('@components/chat/chat', () => ({default: class {
  public init() {
    const chat = this as any;
    chat.container.append(chat.topbar.container, chat.content);
  }
  public _isLikeGroup() { return false; }
  public initSearch() { upstream(); }
  public isPinnedMessagesNeeded() { return true; }
  public recomputePaddings() { upstream(); }
}}));
vi.mock('@components/chat/bubbles', () => ({default: class {
  public attachContainerListeners() {}
  public createTitle() {
    const title = new PeerTitle();
    title.update();
    return {element: title.element, title};
  }
}}));
vi.mock('@components/peerTitle', () => ({default: class {
  public element = document.createElement('a');
  public update() {
    this.element.setAttribute('href', '#123');
    this.element.tabIndex = 0;
    this.element.draggable = false;
    return Promise.resolve().then(() => { this.element.textContent = 'Updated support'; });
  }
}}));
vi.mock('@components/chat/topbar', () => ({default: class {
  public construct() { upstream(); }
  public constructUtils() { upstream(); }
  public constructPeerHelpers() { upstream(); }
  public finishPeerChange() { upstream(); }
  public setupPinnedMessageForPeer() { upstream(); }
  public revealPreparedPinnedMessage() { upstream(); }
  public setTitle() { upstream(); }
  public setFloating() { upstream(); }
}}));
beforeAll(restrictChatPresentation);
afterEach(() => vi.clearAllMocks());

it('keeps a detached lifecycle target without building UI, plates or listeners', () => {
  const topbar = Object.create(ChatTopbar.prototype);
  topbar.constructUtils();
  topbar.constructPeerHelpers();
  topbar.construct();
  topbar.finishPeerChange();
  topbar.setupPinnedMessageForPeer();
  topbar.revealPreparedPinnedMessage();
  topbar.setFloating();
  expect(topbar.container.isConnected).toBe(false);
  expect(topbar.container.childNodes).toHaveLength(0);
  expect(upstream).not.toHaveBeenCalled();
});

it('uses native group rendering and disables search and pinned messages', async() => {
  const chat = Object.create(Chat.prototype);
  expect(await chat._isLikeGroup()).toBe(true);
  expect(chat.isPinnedMessagesNeeded()).toBe(false);
  chat.initSearch();
  expect(upstream).not.toHaveBeenCalled();
});

it('clears only the top spacer after recalculating composer spacing', () => {
  const chat = Object.assign(Object.create(Chat.prototype), {
    chatPaddingTop: [vi.fn(), vi.fn()],
    bubbles: {paddingTop: document.createElement('div'), updateStickyIntersectorRootMargin: vi.fn()}
  });
  chat.recomputePaddings();
  expect(upstream).toHaveBeenCalledOnce();
  expect(chat.chatPaddingTop[1]).toHaveBeenCalledWith(0);
  expect(chat.bubbles.paddingTop.style.height).toBe('0px');
  expect(chat.bubbles.updateStickyIntersectorRootMargin).toHaveBeenCalled();
});

it('fails closed on an upstream rename', () => {
  const original = Chat.prototype.initSearch;
  try {
    Chat.prototype.initSearch = undefined;
    expect(restrictChatPresentation).toThrow('WIDGET_RESTRICTION_TARGET_MISSING: initSearch');
  } finally {
    Chat.prototype.initSearch = original;
  }
});

it('captures avatar/name navigation for touch, regular and modified clicks', () => {
  const container = document.createElement('div');
  container.innerHTML = '<div class="bubbles-group-avatar"></div><div class="name"><a class="peer-title"></a></div><div class="message"></div>';
  const bubbles = Object.assign(Object.create(ChatBubbles.prototype), {
    scrollable: {container}, listenerSetter: {add: (element: HTMLElement) => element.addEventListener.bind(element)}
  });
  bubbles.attachContainerListeners();
  for(const selector of ['.bubbles-group-avatar', '.peer-title', '.message']) {
    for(const type of ['mousedown', 'click', 'auxclick']) {
      const event = new MouseEvent(type, {bubbles: true, cancelable: true, ctrlKey: true});
      container.querySelector(selector).dispatchEvent(event);
      expect(event.defaultPrevented).toBe(selector !== '.message');
    }
  }
});

it('detaches only the topbar after upstream chat construction', () => {
  const container = document.createElement('div');
  const topbar = {container: document.createElement('div')};
  const content = document.createElement('div');
  const chat = Object.assign(Object.create(Chat.prototype), {container, topbar, content});
  chat.init();
  expect(container.children).toHaveLength(1);
  expect(container.firstChild).toBe(content);
  expect(topbar.container.parentNode).toBeNull();
});

it('keeps sender titles as text through later peer-title updates', async() => {
  const bubbles = Object.create(ChatBubbles.prototype);
  const {element, title} = bubbles.createTitle();
  for(let i = 0; i < 2; ++i) {
    const ready = title.update();
    expect(element.hasAttribute('href')).toBe(false);
    expect(element.hasAttribute('tabindex')).toBe(false);
    expect(element.hasAttribute('draggable')).toBe(false);
    await ready;
    expect(element.textContent).toBe('Updated support');
    expect(title.element).toBe(element);
  }
  const unrelated = new PeerTitle();
  await unrelated.update();
  expect(unrelated.element.hasAttribute('href')).toBe(true);
});

it.each(['init', 'createTitle', 'update'])('fails closed when %s disappears', (key) => {
  const proto = (key === 'init' ? Chat.prototype : key === 'createTitle' ? ChatBubbles.prototype : PeerTitle.prototype) as any;
  const original = proto[key];
  try {
    proto[key] = undefined;
    expect(restrictChatPresentation).toThrow('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  } finally {
    proto[key] = original;
  }
});
