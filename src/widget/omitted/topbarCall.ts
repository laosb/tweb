// Calls are off in the widget, so the bar above the chat for an ongoing call stays empty.
export default function createTopbarCall() {
  return {container: document.createElement('div')};
}
