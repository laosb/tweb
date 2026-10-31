export default class WidgetPasswordMonkey {
  container = document.createElement('div');
  load() { return Promise.resolve(); }
  remove() { this.container.remove(); }
}
