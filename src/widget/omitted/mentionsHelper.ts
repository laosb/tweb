// Mentions still render as text; typing @ never searches other peers or guest bots.
export default class WidgetMentionsHelper {
  constructor(..._args: unknown[]) {}
  hidden = true;
  addSibling() {}
  toggle() {}
  checkQuery(..._args: unknown[]) { return false; }
}
