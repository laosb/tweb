// Callers still close the shared panel when sending, opening menus or switching chats.
// No listeners, panel DOM, tabs, media fetches or button behavior are installed.
export class EmoticonsDropdown {
  private element: HTMLElement;
  getElement() {
    return this.element ??= document.createElement('div');
  }
  isActive() { return false; }
  canUseEmoji() { return false; }
  toggle() {}
  attachButtonListener() {}
  addEventListener() {}
  removeEventListener() {}
  setIgnoreMouseOut() {}
  setTextColor() {}
  onButtonClick() {}
  hideAndDestroy() {}
  destroy() {}
  onMediaClick() { return Promise.resolve(false); }
  sendDocId() { return Promise.resolve(false); }
}
export default new EmoticonsDropdown();
