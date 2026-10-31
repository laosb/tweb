// The widget has token authentication and no local-passcode setup or screen.
export default class WidgetLockScreen {
  static getIsLocked() { return false; }
  static waitForUnlock() { return Promise.resolve(); }
  static lock() { return Promise.resolve(); }
  static lockOtherTabs() { return Promise.resolve(); }
  static unlock() {}
}
