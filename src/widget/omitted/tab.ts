import EventListenerBase from '@helpers/eventListenerBase';
import noop from '@helpers/noop';

// Constructors stay distinct for getTab/instanceof reads. Opening never mounts UI.
export default class WidgetTab {
  container = document.createElement('div');
  scrollable = {container: this.container, onScroll: noop};
  eventListener = new EventListenerBase();
  payload: unknown;
  init(payload?: unknown) { this.payload = payload; return Promise.resolve(); }
  open() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  destroy() { this.container.remove(); this.eventListener.cleanup(); }
  getPayload() { return this.payload; }
  static getInitArgs() { return {}; }
  static getTabName() { return this.name; }
}
