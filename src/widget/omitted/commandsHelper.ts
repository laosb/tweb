// Unlike inline autocomplete, the command caller reads a boolean result.
export default class WidgetCommandsHelper {
  constructor(..._args: unknown[]) {}
  hidden = true;
  addSibling() {}
  toggle() {}
  toggleListNavigation() {}
  checkQuery(..._args: unknown[]) { return Promise.resolve(false); }
}
