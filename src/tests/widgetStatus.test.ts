import ChatBubbles from '@components/chat/bubbles';
import ChatContextMenu from '@components/chat/contextMenu';
import ChatTopbar from '@/widget/omitted/topbar';
import {restrictChatStatus} from '@/widget/statusRestrictions';

const original = vi.hoisted(() => ({render: vi.fn(), verify: vi.fn()}));
vi.mock('@components/chat/bubbles', () => ({default: class {
  public setBubbleSendingStatus() {}
}}));
vi.mock('@components/chat/contextMenu', () => ({default: class {
  public setButtons() {
    (this as any).buttons = [{localName: 'views', verify: original.verify}, {text: 'Reply'}];
  }
}}));
beforeAll(() => {
  (ChatBubbles.prototype as any).setBubbleSendingStatus = original.render;
  restrictChatStatus();
});
afterEach(() => vi.clearAllMocks());

it.each(['sending', 'sent', 'read', 'error', undefined])('renders %s without revealing reads', (state) => {
  const bubbles = Object.create(ChatBubbles.prototype);
  const bubble = document.createElement('div');
  for(const first of [true, false]) {
    bubbles.setBubbleSendingStatus(bubble, state, first);
    expect(original.render).toHaveBeenLastCalledWith(bubble, state === 'read' ? 'sent' : state, first);
    expect(original.render.mock.contexts[original.render.mock.contexts.length - 1]).toBe(bubbles);
  }
});

it('removes seen-by/read-date entries before their predicates can request data', () => {
  const menu = Object.create(ChatContextMenu.prototype);
  menu.setButtons();
  expect(menu.buttons).toEqual([{text: 'Reply'}]);
  expect(original.verify).not.toHaveBeenCalled();
});

it('never creates the status lifecycle', () => {
  const topbar = Object.create(ChatTopbar.prototype);
  expect(topbar.createStatus()).toBeUndefined();
});

it('fails loudly when an upstream target is renamed', () => {
  const original = (ChatContextMenu.prototype as any).setButtons;
  try {
    (ChatContextMenu.prototype as any).setButtons = undefined;
    expect(restrictChatStatus).toThrow('WIDGET_RESTRICTION_TARGET_MISSING: setButtons');
  } finally {
    (ChatContextMenu.prototype as any).setButtons = original;
  }
});
