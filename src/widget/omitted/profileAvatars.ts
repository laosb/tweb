export const SHOW_NO_AVATAR = true;
export default class WidgetProfileAvatars {
  container = document.createElement('div');
  info = document.createElement('div');
  setPeer() { return Promise.resolve(); }
  init() {}
  cleanup() {}
  destroy() { this.container.remove(); }
}
