import {readFileSync} from 'node:fs';
import {INTERNAL_LINK_TYPE} from '@lib/internalLink';
import processor from '@lib/internalLinkProcessor';
import im from '@lib/appImManager';
import {restrictInternalLinks} from '@/widget/linkRestrictions';
import {isWidgetExternalUrl, allowsWidgetAnchor} from '@/widget/linkPolicy';
import MentionsHelper from '@/widget/omitted/mentionsHelper';
import showPickUserPopup, * as pickers from '@/widget/omitted/pickUser';
import selectRequestPeers from '@/widget/omitted/requestPeer';
import {getKeyboardButtonHandler, getRichPageButtonHandler, default as wrapButton} from '@/widget/omitted/keyboardButton';
import widgetWrapUrl from '@/widget/omitted/wrapUrl';
import addWidgetAnchorListener from '@/widget/omitted/anchorListener';
import {assertWidgetCleanupModules} from '../../scripts/widget-cleanup-guards';

const original = vi.hoisted(() => ({open: vi.fn(() => Promise.resolve(true)), op: vi.fn(), button: vi.fn(), url: vi.fn()}));
vi.mock('@lib/appImManager', () => ({default: {
  open: original.open, op: original.op, openUsername: vi.fn(), openThread: vi.fn(), openComment: vi.fn()
}}));
vi.mock('@lib/internalLinkProcessor', async() => {
  const {readFileSync} = await import('node:fs');
  const source = readFileSync('src/lib/internalLinkProcessor.ts', 'utf8');
  const methods = [...source.matchAll(/public (?:async )?(process\w+)/g)].map(match => match[1]);
  return {default: Object.fromEntries(methods.map(name => [name, vi.fn(() => { throw new Error('original link handler ran'); })]))};
});
vi.mock('@components/wrappers/keyboardButton?widget-original', () => ({
  default: original.button, getKeyboardButtonHandler: original.button, getRichPageButtonHandler: original.button
}));
vi.mock('@lib/richTextProcessor/wrapUrl?widget-original', () => ({default: original.url}));
vi.mock('@components/popups/pickUser', async() => import('@/widget/omitted/pickUser'));
vi.mock('@helpers/addAnchorListener?widget-original', () => ({
  default: (options: any) => {
    (window as any)[(options.protocol ? options.protocol + '_' : '') + options.name] = (element: HTMLAnchorElement) => options.callback({element});
  },
  UNSAFE_ANCHOR_LINK_TYPES: new Set(), listenForMaskedAnchorAuxClicks() {}
}));

beforeAll(() => restrictInternalLinks(42 as PeerId, ['Support']));
afterEach(() => vi.clearAllMocks());

it('rejects every other link kind and direct entry before looking up a peer or opening UI', async() => {
  for(const kind of Object.values(INTERNAL_LINK_TYPE).filter(value => typeof(value) === 'number')) {
    await processor.processInternalLink({_: kind, domain: 'other', post: '10', channel: '43'} as any);
  }
  for(const [name, handler] of Object.entries(processor)) {
    if(name.startsWith('process')) await handler({_: INTERNAL_LINK_TYPE.MESSAGE, domain: 'other', post: '10'});
  }
  await im.openUsername({userName: 'other', lastMsgId: 10});
  await im.open({peerId: 43 as PeerId});
  await im.op({peer: {_: 'user', id: 43} as any});
  await im.openThread({peerId: 43 as PeerId, threadId: 10, lastMsgId: 12});
  await im.openComment({peerId: 43 as PeerId, msgId: 12, commentId: 11});
  expect(original.open).not.toHaveBeenCalled();
  expect(original.op).not.toHaveBeenCalled();
});

it('admits only a positive message id in the already known support chat', async() => {
  await processor.processMessageLink({_: INTERNAL_LINK_TYPE.MESSAGE, domain: 'SUPPORT', post: '10'});
  await processor.processPrivatePostLink({_: INTERNAL_LINK_TYPE.PRIVATE_POST, channel: '42', post: '11'});
  expect(original.open.mock.calls.map(args => (args as any)[0])).toEqual([
    expect.objectContaining({peerId: 42, lastMsgId: 10}), expect.objectContaining({peerId: 42, lastMsgId: 11})
  ]);
});

it.each(['start', 'startgroup', 'startchannel', 'admin', 'text', 'thread', 'comment', 'unknown'])('rejects %s even on a support message link', async(key) => {
  await processor.processMessageLink({_: INTERNAL_LINK_TYPE.MESSAGE, domain: 'support', post: '10', [key]: ''} as any);
  expect(original.open).not.toHaveBeenCalled();
});

it.each([undefined, '', '0', '-1', '1.5', 'Infinity', '9007199254740992'])('rejects an invalid message id %s', async(post) => {
  await processor.processMessageLink({_: INTERNAL_LINK_TYPE.MESSAGE, domain: 'support', post});
  expect(original.open).not.toHaveBeenCalled();
});

it.each(['call', 'startParam', 'text', 'threadId', 'commentId'])('rejects the direct-navigation %s option before looking up support', async(key) => {
  const options = {lastMsgId: 10, [key]: 'blocked'} as any;
  await im.openUsername({userName: 'support', ...options});
  await im.open({peerId: 42 as PeerId, ...options});
  await im.op({peer: {_: 'user', id: 42} as any, ...options});
  expect(original.open).not.toHaveBeenCalled();
  expect(original.op).not.toHaveBeenCalled();
});

it.each(['https://example.org/x', 'http://example.org', 'https://t.me.evil.com/path', 'https://t.me@evil.com/x'])(
  'keeps external confirmation for %s', url => expect(isWidgetExternalUrl(url)).toBe(true)
);
it.each(['tg://join?invite=x', 'https://t.me', 'https://t.me/other/123', 'https://user:pass@t.me/x',
  'https://support.t.me/123', 'https://telegram.me/addlist/x', 'https://telesco.pe/other/123', 'ftp://example.org', 'javascript:alert(1)'])(
  'never treats %s as external', url => expect(isWidgetExternalUrl(url)).toBe(false)
);

it.each(['t.me', 'telegram.me', 'telesco.pe'].flatMap(host => [
  `https://${host}./other/123`, `https://USER:pass@${host.toUpperCase()}./other/123`,
  `https://support.${host}./123`, `https://${host.replace('.', '\u3002')}\uff0e/other/123`,
  `https://xn--bcher-kva.${host}./123`, `https://bücher.${host}./123`
]))('rejects canonicalized absolute Telegram host %s', url => {
  expect(isWidgetExternalUrl(url)).toBe(false);
  expect(allowsWidgetAnchor('showMaskedAlert', undefined, url)).toBe(false);
});

it('keeps tel/mailto, media timestamps and the parse-only message handlers, while blocking direct settings/command handlers', () => {
  expect(allowsWidgetAnchor('showMaskedAlert', undefined, 'mailto:support@example.org')).toBe(true);
  expect(allowsWidgetAnchor('showMaskedAlert', undefined, 'tel:+123456')).toBe(true);
  expect(allowsWidgetAnchor('setMediaTimestamp', undefined, '#')).toBe(true);
  expect(allowsWidgetAnchor('resolve', 'tg', 'tg://resolve?domain=support&post=10')).toBe(true);
  for(const name of ['settings', 'contacts', 'chats', 'new', 'execBotCommand', 'join', 'share', 'addstickers']) {
    expect(allowsWidgetAnchor(name, 'tg', 'tg://' + name)).toBe(false);
  }
});

it('routes ordinary and unknown URLs through the guard and never unwraps an instant-view tg link into an external one', () => {
  original.url.mockImplementation((url: string) => ({url}));
  expect(widgetWrapUrl('https://example.org').onclick).toBe('showMaskedAlert');
  expect(widgetWrapUrl('tg://unknown?x=1').onclick).toBe('showMaskedAlert');
  expect(widgetWrapUrl('mailto:support@example.org').onclick).toBeUndefined();
  original.url.mockReturnValue({url: 'https://example.org'});
  expect(widgetWrapUrl('tg://iv?url=https%3A%2F%2Fexample.org', true).url).toMatch(/^tg:/);
});

it('guards named anchor entry points before parsing/callbacks and preserves external new-window confirmation', () => {
  const callback = vi.fn();
  addWidgetAnchorListener({name: 'settings', protocol: 'tg', callback});
  const anchor = document.createElement('a');
  anchor.href = 'tg://settings/devices';
  const event = new MouseEvent('click', {cancelable: true});
  (window as any).tg_settings(anchor, event);
  expect(event.defaultPrevented).toBe(true);
  expect(callback).not.toHaveBeenCalled();
  addWidgetAnchorListener({name: 'showMaskedAlert', callback});
  anchor.href = 'https://example.org';
  (window as any).showMaskedAlert(anchor);
  expect(callback).toHaveBeenCalledOnce();
  expect(anchor.target).toBe('_blank');
  expect(anchor.rel).toContain('noopener');
  anchor.href = 'https://t.me:99999/+bad';
  (window as any).showMaskedAlert(anchor);
  expect(callback).toHaveBeenCalledOnce();
});

it('settles every cancelled picker without reading options, invoking selection or leaving a helper waiting', async() => {
  const poison = new Proxy({}, {get() { throw new Error('picker read selection options'); }}) as any;
  const results = await Promise.allSettled([
    pickers.showPickUser2Popup(poison), pickers.showPickUser3Popup(poison), pickers.showSharingPicker2Popup(poison),
    pickers.showReplyPickerPopup(poison), pickers.showContactPickerPopup(poison), selectRequestPeers(poison)
  ]);
  expect(results.every(result => result.status === 'rejected')).toBe(true);
  const close = vi.fn(), after = vi.fn();
  const handle = showPickUserPopup({onClose: close, onCloseAfterTimeout: after});
  await handle.finalize();
  handle.hide();
  expect(close).toHaveBeenCalledOnce();
  expect(after).toHaveBeenCalledOnce();
});

it('typing @ never registers a helper or accesses managers and returns a synchronous false', () => {
  const poison = new Proxy({}, {get() { throw new Error('mention lookup'); }});
  const mentions = new MentionsHelper(poison, poison, poison, poison);
  expect(mentions.checkQuery('@', 42, undefined, true, true)).toBe(false);
  expect(mentions.hidden).toBe(true);
});

it.each(['inlineButtonTypeSwitchInline', 'buttonTypeRequestPeer', 'buttonTypeRequestPhone', 'inlineButtonTypeUrlAuth'])(
  'removes %s from keyboard, rich-button and layout entry points before handler construction', type => {
    const options = {button: {type: {_: type}}, label: 'restricted'} as any;
    expect(getKeyboardButtonHandler(options)).toBeUndefined();
    expect(getRichPageButtonHandler(options)).toBeUndefined();
    expect(wrapButton(options)).toBeUndefined();
    expect(original.button).not.toHaveBeenCalled();
  }
);
it('preserves Copy and ordinary URL handlers', () => {
  getRichPageButtonHandler({button: {type: {_: 'inlineButtonTypeCopy', copy_text: '😀'}}} as any);
  getKeyboardButtonHandler({button: {type: {_: 'inlineButtonTypeUrl', url: 'https://example.org'}}} as any);
  expect(original.button).toHaveBeenCalledTimes(2);
});

it('fails on a missing or newly introduced direct link handler', () => {
  const value = processor.processJoinChatLink;
  try {
    processor.processJoinChatLink = undefined;
    expect(() => restrictInternalLinks(42 as PeerId, [])).toThrow('WIDGET_RESTRICTION_TARGET_MISSING: processJoinChatLink');
    processor.processJoinChatLink = value;
    (processor as any).processNewLink = () => {};
    expect(() => restrictInternalLinks(42 as PeerId, [])).toThrow('unchecked link handler processNewLink');
  } finally {
    processor.processJoinChatLink = value;
    delete (processor as any).processNewLink;
  }
});

it('guards picker/pack graphs while preserving the participant row and rendering graph', () => {
  for(const path of ['appSelectPeers.tsx', 'selectorSearch.tsx', 'popups/createBot/renamed.tsx', 'folderTags/newTag.tsx',
    'popups/pickUser.tsx', 'popups/stickers.tsx', 'chat/mentionsHelper.ts']) {
    expect(() => assertWidgetCleanupModules(['src/components/' + path], [])).toThrow('widget omitted feature code');
  }
  expect(() => assertWidgetCleanupModules(['src/components/dialogElement.ts', 'src/components/popups/reactedList.tsx',
    'src/components/wrappers/sticker.ts', 'src/components/wrappers/customEmoji.ts'], [])).not.toThrow();
  // ChatInput's remaining reference is type-only; the pack-menu Copy consumer is omitted.
  expect(readFileSync('src/widget/omitted/emojiTab.ts', 'utf8')).not.toContain('getEmojiFromElement');
});
