import ChatSelection from '@components/chat/selection';
import ChatContextMenu from '@components/chat/contextMenu';
import ChatTopbar from '@components/chat/topbar';

export function restrictMessageSelection() {
  const selection = ChatSelection.prototype;
  const contextMenu = ChatContextMenu.prototype as any;
  const targets = [
    [selection, 'attachListeners'], [selection, 'toggleMid'],
    [selection, 'toggleSelection'], [selection, 'toggleElementCheckbox'],
    [selection, 'enterReportSelection'], [contextMenu, 'setButtons'],
    [ChatTopbar.prototype, 'constructUtils']
  ] as const;
  for(const [object, key] of targets) {
    if(typeof((object as any)[key]) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  }

  // No drag/touch listeners. Click and keyboard paths use the instance's
  // toggleByElement, which stops when toggleMid returns false. Keep
  // canSelectBubble intact: hover and quick reactions also use it.
  selection.attachListeners = () => {};
  selection.toggleMid = selection.toggleSelection = selection.toggleElementCheckbox = () => false;
  selection.enterReportSelection = () => {};

  // These menus offer selection while isSelecting is false, so their existing
  // predicates cannot hide the entry points for a disabled controller.
  const setButtons = contextMenu.setButtons;
  contextMenu.setButtons = function(this: any) {
    const result = setButtons.call(this);
    this.buttons = this.buttons.filter((button: {text: string}) => button.text !== 'Message.Context.Select');
    return result;
  };
  const constructUtils = ChatTopbar.prototype.constructUtils;
  ChatTopbar.prototype.constructUtils = function(this: ChatTopbar) {
    const result = constructUtils.call(this);
    (this as any).menuButtons = (this as any).menuButtons.filter((button: {text: string}) => button.text !== 'Chat.Menu.SelectMessages');
    return result;
  };
}
