// Chat still owns a topbar lifecycle target. It has no controls, plates or listeners.
export default class WidgetTopbar {
  constructor(_chat?: unknown, public appSidebarRight?: unknown, _managers?: unknown) {}
  container: HTMLDivElement;
  menuButtons: never[] = [];
  construct() { this.container = document.createElement('div'); }
  constructUtils() {}
  constructPeerHelpers() {}
  finishPeerChange() {}
  setupPinnedMessageForPeer() {}
  revealPreparedPinnedMessage() {}
  setTitle() {}
  createStatus() {}
  setFloating() {}
  onJoinClick() {}
  cleanup() {}
  destroy() { this.container?.remove(); }
}
