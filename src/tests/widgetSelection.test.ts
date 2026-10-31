import ListenerSetter from '@helpers/listenerSetter';
import '@helpers/peerIdPolyfill';
import ChatSelection from '@/widget/omitted/selection';
import {ChatType} from '@components/chat/chatType';
import ChatContextMenu from '@components/chat/contextMenu';
import {restrictMessageSelection} from '@/widget/selectionRestrictions';

vi.mock('@components/chat/contextMenu', () => ({default: class {
  public buttons: {text: string}[];
  public setButtons() {
    this.buttons = [{text: 'Message.Context.Select'}, {text: 'Reply'}];
  }
}}));
beforeAll(() => restrictMessageSelection());
afterEach(() => document.body.replaceChildren());

it('blocks gestures, click/keyboard mutations, forced selection and report selection', async() => {
  const peerId = (1 as UserId).toPeerId(false);
  const root = document.createElement('div');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.dataset.mid = '104';
  bubble.dataset.peerId = String(peerId);
  root.append(bubble);
  document.body.append(root);
  const selection = new ChatSelection({type: ChatType.Chat});
  const listeners = new ListenerSetter();
  const add = vi.spyOn(listeners, 'add');
  selection.attachListeners(root, listeners);
  expect(add).not.toHaveBeenCalled();
  bubble.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0}));
  bubble.dispatchEvent(new MouseEvent('mousemove', {bubbles: true}));
  document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
  bubble.dispatchEvent(new Event('touchstart', {bubbles: true}));
  bubble.dispatchEvent(new Event('touchend', {bubbles: true}));

  // Shift/ctrl-click and the keyboard selection action converge on this method.
  await selection.toggleByElement(bubble);
  selection.toggleMid(peerId, 104);
  selection.toggleSelection(true, true);
  selection.enterReportSelection({option: new Uint8Array([1])});
  selection.toggleElementCheckbox(bubble, true);
  expect(selection.isSelecting).toBe(false);
  expect(selection.isReportSelection).toBe(false);
  expect(selection.getSelectedMids()).toEqual([]);
  expect(root.querySelector('.checkbox-field, .is-selecting, .selection-wrapper')).toBeNull();
  expect(selection.canSelectBubble(bubble)).toBe(true);
});

it('removes only the selection entry from the context menu', () => {
  const context = Object.create(ChatContextMenu.prototype);
  context.setButtons();
  expect(context.buttons).toEqual([{text: 'Reply'}]);
});

it('fails at startup if an upstream entry point disappears', () => {
  const original = (ChatContextMenu.prototype as any).setButtons;
  try {
    (ChatContextMenu.prototype as any).setButtons = undefined;
    expect(restrictMessageSelection).toThrow('WIDGET_RESTRICTION_TARGET_MISSING: setButtons');
  } finally {
    (ChatContextMenu.prototype as any).setButtons = original;
  }
});

it.each(['is-date', 'is-outgoing', 'is-error', 'bubble-first', 'avoid-selection'])(
  'keeps the hover predicate excluding %s', className => {
    const selection = new ChatSelection({type: ChatType.Chat});
    const bubble = document.createElement('div');
    expect(selection.canSelectBubble(bubble)).toBe(true);
    bubble.classList.add(className);
    expect(selection.canSelectBubble(bubble)).toBe(false);
  }
);

it('retains event lifecycle, service and ephemeral bubble predicates', async() => {
  const selection = new ChatSelection({type: ChatType.Chat});
  const listener = vi.fn();
  selection.addEventListener('toggle', listener);
  const bubble = document.createElement('div');
  bubble.className = 'bubble service is-ephemeral';
  expect(selection.canSelectBubble(bubble)).toBe(true);
  selection.enterReportSelection({option: new Uint8Array([1])});
  selection.toggleByElement(bubble);
  expect(listener).not.toHaveBeenCalled();
  expect(selection.isMidSelected(1, 104)).toBe(false);
  expect(await selection.getSelectedMessages()).toEqual([]);
  selection.cleanup();
  selection.removeEventListener('toggle', listener);
  expect(selection.selectedMids.size).toBe(0);
  expect(selection.length()).toBe(0);
  for(const type of [ChatType.Logs, ChatType.Welcome]) {
    expect(new ChatSelection({type}).canSelectBubble(bubble)).toBe(false);
  }
});
