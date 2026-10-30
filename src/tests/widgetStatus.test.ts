import ChatBubbles from '@components/chat/bubbles';
import ChatContextMenu from '@components/chat/contextMenu';
import ChatTopbar from '@components/chat/topbar';
import {restrictChatStatus} from '@/widget/statusRestrictions';

const original = vi.hoisted(() => ({render: vi.fn(), status: vi.fn(), verify: vi.fn()}));
vi.mock('@components/chat/bubbles', () => ({default: class {
  public setBubbleSendingStatus() {}
}}));
vi.mock('@components/chat/contextMenu', () => ({default: class {
  public setButtons() {
    (this as any).buttons = [{localName: 'views', verify: original.verify}, {text: 'Reply'}];
  }
}}));
vi.mock('@components/chat/topbar', () => ({default: class {
  public createStatus() { return original.status(); }
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
  expect(original.status).not.toHaveBeenCalled();
});

it('fails loudly when an upstream target is renamed', () => {
  const original = (ChatTopbar.prototype as any).createStatus;
  try {
    (ChatTopbar.prototype as any).createStatus = undefined;
    expect(restrictChatStatus).toThrow('WIDGET_RESTRICTION_TARGET_MISSING: createStatus');
  } finally {
    (ChatTopbar.prototype as any).createStatus = original;
  }
});
