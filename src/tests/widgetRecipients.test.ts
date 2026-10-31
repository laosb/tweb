import ChatInput from '@components/chat/input';
import ChatBubbles from '@components/chat/bubbles';
import {restrictRecipients} from '@/widget/recipientRestrictions';
import {restrictPacks} from '@/widget/packRestrictions';

const touched = vi.hoisted(() => vi.fn());
vi.mock('@components/chat/input', () => ({default: class {
  public constructReplyElements() {
    const menu = document.createElement('div');
    const change = document.createElement('button');
    change.textContent = 'ReplyToAnotherChat';
    menu.append(change);
    const show = document.createElement('button');
    show.textContent = 'ShowMessage';
    menu.append(show);
    (this as any).replyElements = {menuContainer: menu, replyInAnother: {element: change}};
  }
  public changeReplyRecipient() { touched(); }
  public createReplyPicker() { touched(); }
}}));
vi.mock('@components/chat/bubbles', () => ({default: class {
  public attachContainerListeners() {}
  public openEmojiPackByTarget() { touched(); }
}}));
vi.mock('@components/chat/bubbles/richMessage', () => ({isRichMessageButtonTarget: () => false}));

beforeAll(() => { restrictRecipients(); restrictPacks(); });
afterEach(() => vi.clearAllMocks());

it('removes the recipient item while retaining the helper and never clears or relocates a reply', async() => {
  const input = Object.create(ChatInput.prototype) as any;
  input.constructReplyElements();
  expect(input.replyElements.menuContainer.textContent).toBe('ShowMessage');
  const reply = input.replyToMsgId = 123;
  input.helperWaitingReply = true;
  await input.changeReplyRecipient();
  await input.createReplyPicker({replyToMsgId: reply});
  expect(input.helperWaitingReply).toBe(false);
  expect(input.replyToMsgId).toBe(reply);
  expect(touched).not.toHaveBeenCalled();
});

it('blocks an emoji-pack click before its document lookup', () => {
  const bubbles = Object.create(ChatBubbles.prototype) as any;
  bubbles.openEmojiPackByTarget(new Proxy({}, {get() { throw new Error('pack target was inspected'); }}));
  expect(touched).not.toHaveBeenCalled();
});

it('captures sticker and poll-option pack clicks before delegation, keeping links and context menus', () => {
  const container = document.createElement('div');
  container.innerHTML = '<div class="bubble sticker"><div class="media-sticker-wrapper"></div></div><span class="custom-emoji"></span><span class="poll-option-sticker"></span><a><span class="custom-emoji"></span></a>';
  const bubbles = Object.assign(Object.create(ChatBubbles.prototype), {
    scrollable: {container}, listenerSetter: {add: (element: HTMLElement) => element.addEventListener.bind(element)}
  }) as any;
  bubbles.attachContainerListeners();
  for(const element of container.querySelectorAll('.media-sticker-wrapper, .custom-emoji, .poll-option-sticker')) {
    const click = new MouseEvent('click', {bubbles: true, cancelable: true});
    element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(!element.closest('a'));
    const menu = new MouseEvent('contextmenu', {bubbles: true, cancelable: true});
    element.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
  }
});

it.each(['constructReplyElements', 'changeReplyRecipient', 'createReplyPicker'])('fails closed if %s disappears', key => {
  const input = ChatInput.prototype as any;
  const original = input[key];
  try {
    input[key] = undefined;
    expect(restrictRecipients).toThrow('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  } finally {
    input[key] = original;
  }
});
