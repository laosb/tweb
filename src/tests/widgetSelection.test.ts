vi.hoisted(() => {
  vi.stubGlobal('Worker', class Worker {});
  vi.stubGlobal('IntersectionObserver', class IntersectionObserver {
    public observe() {}
    public unobserve() {}
    public disconnect() {}
  });
  vi.stubGlobal('CSS', {supports: () => false});
});

vi.mock('@components/button', () => ({default: () => document.createElement('button')}));
vi.mock('@components/buttonIcon', () => ({default: () => document.createElement('button')}));
vi.mock('@components/checkboxField', () => ({
  default: class CheckboxField {
    public input = document.createElement('input');
    public label = document.createElement('span');

    constructor() {
      this.label.classList.add('checkbox-field');
      this.input.type = 'checkbox';
      this.input.classList.add('checkbox-field-input');
      this.label.append(this.input);
    }
  }
}));
vi.mock('@components/popups/deleteMessages', () => ({default: class PopupDeleteMessages {}}));
vi.mock('@components/popups/forward', () => ({default: vi.fn()}));
vi.mock('@components/popups/reportAd', () => ({showSelectedMessagesReport: vi.fn()}));
vi.mock('@components/singleTransition', () => ({
  default: ({element, className, forwards}: {
    element: HTMLElement,
    className: string,
    forwards: boolean
  }) => element.classList.toggle(className, forwards)
}));
vi.mock('@components/popups/sendNow', () => ({default: class PopupSendNow {}}));
vi.mock('@components/appNavigationController', () => ({
  default: {
    pushItem: vi.fn(),
    removeByType: vi.fn()
  }
}));
vi.mock('@environment/touchSupport', () => ({default: false}));
vi.mock('@lib/langPack', () => ({
  default: {format: (key: string) => key},
  i18n: (key: string) => document.createTextNode(key),
  _i18n: vi.fn()
}));
vi.mock('@helpers/dom/clickEvent', () => ({attachClickEvent: vi.fn()}));
vi.mock('@helpers/dom/attachContextMenuListener', () => ({attachContextMenuListener: vi.fn()}));
vi.mock('@lib/appImManager', () => ({default: {}}));
vi.mock('@components/popups', () => ({
  default: class PopupElement {
    public static createPopup = vi.fn();
  }
}));
vi.mock('@environment/standalone', () => ({default: false}));
vi.mock('@components/toast', () => ({toastNew: vi.fn()}));
vi.mock('@components/confirmationPopup', () => ({default: vi.fn()}));
vi.mock('@components/chat/controlPlate', () => ({default: () => document.createElement('div')}));

import ListenerSetter from '@helpers/listenerSetter';
import '@helpers/peerIdPolyfill';
import ChatSelection from '@components/chat/selection';
import ChatContextMenu from '@components/chat/contextMenu';
import ChatTopbar from '@components/chat/topbar';
import {restrictMessageSelection} from '@/widget/selectionRestrictions';

vi.mock('@components/chat/contextMenu', () => ({default: class {
  public buttons: {text: string}[];
  public setButtons() {
    this.buttons = [{text: 'Message.Context.Select'}, {text: 'Reply'}];
  }
}}));
vi.mock('@components/chat/topbar', () => ({default: class {
  public menuButtons: {text: string}[];
  public constructUtils() {
    this.menuButtons = [{text: 'Chat.Menu.SelectMessages'}, {text: 'Search'}];
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
  const bubbles = {getBubbleGroupedItems: (): HTMLElement[] => []};
  const selection = new ChatSelection({bubbles} as any, bubbles as any, {} as any, {} as any);
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

it('removes only the selection entry from each menu', () => {
  const context = Object.create(ChatContextMenu.prototype);
  context.setButtons();
  expect(context.buttons).toEqual([{text: 'Reply'}]);
  const topbar = Object.create(ChatTopbar.prototype);
  topbar.constructUtils();
  expect(topbar.menuButtons).toEqual([{text: 'Search'}]);
});

it('fails at startup if an upstream entry point disappears', () => {
  const original = ChatSelection.prototype.enterReportSelection;
  try {
    ChatSelection.prototype.enterReportSelection = undefined;
    expect(restrictMessageSelection).toThrow('WIDGET_RESTRICTION_TARGET_MISSING: enterReportSelection');
  } finally {
    ChatSelection.prototype.enterReportSelection = original;
  }
});
