import ChatContextMenu from '@components/chat/contextMenu';

export function restrictMessageSelection() {
  const contextMenu = ChatContextMenu.prototype as any;
  if(typeof(contextMenu.setButtons) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: setButtons');

  // The inert controller cannot hide a menu offered while isSelecting is false.
  const setButtons = contextMenu.setButtons;
  contextMenu.setButtons = function() {
    const result = setButtons.call(this);
    this.buttons = this.buttons.filter((button: {text: string}) => button.text !== 'Message.Context.Select');
    return result;
  };
}
