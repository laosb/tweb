import '@helpers/peerIdPolyfill';
import SlicedArray from '@helpers/slicedArray';
import ChatBubbles, {makeFullMid} from '@components/chat/bubbles';
import ChatContextMenu from '@components/chat/contextMenu';
import uiNotificationsManager from '@lib/uiNotificationsManager';
import {restrictMessageActions} from '@/widget/messageRestrictions';
import wrapAction from '@/widget/omitted/messageActionText';
import I18n from '@lib/langPack';
import contextMenuController from '@helpers/contextMenuController';

const original = vi.hoisted(() => ({render: vi.fn(), history: vi.fn(), notify: vi.fn(), action: vi.fn(), focus: vi.fn(() => Promise.resolve())}));
vi.mock('@helpers/idleController', () => ({default: {getFocusPromise: original.focus}}));
vi.mock('@components/wrappers/messageActionTextNew?widget-original', () => ({default: (options: any) => original.action(options)}));
vi.mock('@components/chat/bubbles', async() => ({
  ...await import('@appManagers/utils/messages/fullMid'),
  default: class {
    public renderMessage(options: any) { return original.render(options); }
    public getHistory1(...args: unknown[]) { return original.history(...args); }
    public isHistoryNeverDrawn() { return false; }
    public _renderNewMessage() { return Promise.resolve(); }
  }
}));
vi.mock('@components/chat/contextMenu', () => ({default: class {
  public setButtons() {
    (this as any).buttons = ['pin', 'unpin', 'forward', 'search', 'tag_filter', 'copy', 'reply'].map(icon => ({icon})).concat([{icon: 'user', text: 'VoiceChat.OpenProfile'}] as any);
  }
}}));
vi.mock('@components/chat/input', () => ({default: class {
  public initMessagesForward() {}
  public constructForwardElements() {}
}}));
vi.mock('@components/sidebarLeft', () => ({AppSidebarLeft: class {
  public initSearch() {}
}}));
vi.mock('@helpers/contextMenuController', () => ({default: {openBtnMenu() {}}}));
vi.mock('@lib/langPack', () => ({default: {weakMap: new WeakMap(), format: (key: string) => key},
  i18n: (key: string) => Object.assign(document.createElement('span'), {textContent: key})}));
vi.mock('@lib/richTextProcessor', () => ({SITE_HASHTAGS: {Telegram: 'tg://search_hashtag?hashtag={1}'}}));
vi.mock('@lib/uiNotificationsManager', () => ({default: {buildNotification: (payload: any) => original.notify(payload)}}));

beforeAll(restrictMessageActions);
afterEach(() => vi.clearAllMocks());

const peerId = (42 as UserId).toPeerId();
const pin = (mid: number) => ({_: 'messageService', mid, peerId, action: {_: 'messageActionPinMessage'}});

function historyFixture(slices: number[][], pins: number[], rendered = 1) {
  const history = new SlicedArray<number>();
  slices.forEach(slice => history.insertSlice(slice));
  return Object.assign(Object.create(ChatBubbles.prototype), {
    peerId,
    skippedMids: new Set(pins.map(mid => makeFullMid(peerId, mid))),
    getRenderedLength: () => rendered,
    chat: {
      getHistoryStorage: () => ({history}),
      getMessage: (mid: number | string) => {
        mid = typeof(mid) === 'string' ? +mid.split('_')[1] : mid;
        return pins.includes(mid) ? pin(mid) : {_: 'message', mid, peerId};
      }
    }
  });
}

it('crosses a page of hidden pins in either direction without crossing a visible message', () => {
  const mids = Array.from({length: 42}, (_, i) => 100 - i);
  const bubbles = historyFixture([mids], mids.slice(1, -1));
  bubbles.getHistory1(makeFullMid(peerId, 100), true, undefined, undefined, true);
  expect(original.history).toHaveBeenLastCalledWith(makeFullMid(peerId, 60), true, undefined, undefined, true);
  bubbles.getHistory1(makeFullMid(peerId, 59), false, true);
  expect(original.history).toHaveBeenLastCalledWith(makeFullMid(peerId, 99), false, true);
});

it('advances an entirely hidden first page, but never crosses a hole in storage', () => {
  const bubbles = historyFixture([[100, 99], [70, 69]], [100, 99, 70, 69], 0);
  bubbles.getHistory1(makeFullMid(peerId, 0), true);
  expect(original.history).toHaveBeenLastCalledWith(makeFullMid(peerId, 69), true);
  bubbles.getHistory1(makeFullMid(peerId, 100), true);
  expect(original.history).toHaveBeenLastCalledWith(makeFullMid(peerId, 99), true);
  bubbles.getHistory1(makeFullMid(peerId, 70), false, true);
  expect(original.history).toHaveBeenLastCalledWith(makeFullMid(peerId, 70), false, true);
});

it('does not skip a pin that has not been processed by this history view', () => {
  const bubbles = historyFixture([[100, 99, 98]], [99, 98]);
  bubbles.skippedMids.delete(makeFullMid(peerId, 99));
  bubbles.getHistory1(makeFullMid(peerId, 100), true);
  expect(original.history).toHaveBeenLastCalledWith(makeFullMid(peerId, 100), true);
});

it('treats an entirely hidden history as empty, without hiding ordinary messages', () => {
  expect(historyFixture([[4, 3]], [4, 3], 0).isHistoryNeverDrawn()).toBe(true);
  expect(historyFixture([[4, 3]], [4], 0).isHistoryNeverDrawn()).toBe(false);
});

it('skips pin rendering before date grouping and unread observers, and removes beside forwarding', async() => {
  const bubbles = Object.create(ChatBubbles.prototype);
  const bubble = document.createElement('div');
  expect(await bubbles.renderMessage({message: pin(4), bubble})).toBeUndefined();
  expect(original.render).not.toHaveBeenCalled();
  const message = {_: 'message', views: 1, fwd_from: {from_id: {_: 'peerUser', user_id: 1}}};
  original.render.mockImplementation(async() => {
    bubble.innerHTML = '<div class="forwarded">Forwarded from</div><button class="bubble-beside-button forward"></button>';
    return {bubble, message};
  });
  expect(await bubbles.renderMessage({message, bubble})).toEqual({bubble, message});
  expect(bubble.querySelector('.forwarded').textContent).toBe('Forwarded from');
  expect(bubble.querySelector('.forward')).toBeNull();
});

it('keeps synthetic service placeholders without an action', async() => {
  const bubbles = Object.create(ChatBubbles.prototype);
  const options = {message: {_: 'messageService', pFlags: {}}, bubble: document.createElement('div')};
  await bubbles.renderMessage(options);
  expect(original.render).toHaveBeenCalledWith(options);
});

it('removes menu variants by stable icon before verification', () => {
  const menu = Object.create(ChatContextMenu.prototype);
  menu.setButtons();
  expect(menu.buttons).toEqual([{icon: 'copy'}, {icon: 'reply'}]);
});

it('never builds a notification for a pin, but keeps ordinary notifications', async() => {
  await uiNotificationsManager.buildNotification({message: pin(4)} as any);
  expect(original.notify).not.toHaveBeenCalled();
  const payload = {message: {_: 'message'}} as any;
  await uiNotificationsManager.buildNotification(payload);
  expect(original.notify).toHaveBeenCalledWith(payload);
});

it('reads a live hidden tail only at the bottom, after focus, while still in the same view', async() => {
  const bubbles = Object.assign(Object.create(ChatBubbles.prototype), {
    scrolledDown: true,
    scrollable: {loadedAll: {bottom: true}},
    getMiddleware: () => () => current,
    onScrolledAllDown: vi.fn()
  });
  let current = true, focused: () => void;
  original.focus.mockImplementation(() => new Promise<void>(resolve => focused = resolve));
  await bubbles._renderNewMessage(pin(4));
  expect(bubbles.onScrolledAllDown).not.toHaveBeenCalled();
  focused();
  await Promise.resolve();
  expect(bubbles.onScrolledAllDown).toHaveBeenCalledOnce();
  await bubbles._renderNewMessage(pin(5));
  current = false;
  focused();
  await Promise.resolve();
  expect(bubbles.onScrolledAllDown).toHaveBeenCalledOnce();
  current = true;
  bubbles.scrolledDown = false;
  await bubbles._renderNewMessage(pin(6));
  expect(bubbles.onScrolledAllDown).toHaveBeenCalledOnce();
  original.focus.mockImplementation(() => Promise.resolve());
});

it('also hides pin service text inside reply previews', async() => {
  expect(await wrapAction({message: pin(4), plain: true} as any)).toBe('');
  expect((await wrapAction({message: pin(4) as any, plain: false})).textContent).toBe('');
  expect(original.action).not.toHaveBeenCalled();
  const options = {message: {_: 'messageService', action: {_: 'messageActionCustomAction', message: 'Hello'}}} as any;
  await wrapAction(options);
  expect(original.action).toHaveBeenCalledWith(options);
});

it('removes the date reminder forwarding action while keeping copy date', () => {
  const menu = document.createElement('div');
  for(const key of ['Chat.Send.SetReminder', 'FormattedDate.CopyDate']) {
    const item = document.createElement('div'), text = document.createElement('span');
    item.className = 'btn-menu-item';
    text.className = 'btn-menu-item-text';
    I18n.weakMap.set(text, {key} as any);
    item.append(text);
    menu.append(item);
  }
  contextMenuController.openBtnMenu(menu);
  expect(menu.children).toHaveLength(1);
  expect((I18n.weakMap.get(menu.firstElementChild.firstElementChild as HTMLElement) as I18n.IntlElement).key).toBe('FormattedDate.CopyDate');
});

it.each(['renderMessage', 'getHistory1', 'isHistoryNeverDrawn'])('fails closed if %s disappears upstream', key => {
  const prototype = ChatBubbles.prototype as any;
  const value = prototype[key];
  try {
    prototype[key] = undefined;
    expect(restrictMessageActions).toThrow('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  } finally {
    prototype[key] = value;
  }
});

it('uses a kept fallback for excluded service previews and supported screenshot events', async() => {
  for(const type of ['messageActionStarGift', 'messageActionPhoneCall', 'messageActionScreenshotTaken']) {
    const message = {_: 'messageService', action: {_: type}} as any;
    expect(await wrapAction({message, plain: true})).toBe('UnsupportedMessageTitle');
    expect((await wrapAction({message})).textContent).toBe('UnsupportedMessageTitle');
  }
  expect(original.action).not.toHaveBeenCalled();
});
