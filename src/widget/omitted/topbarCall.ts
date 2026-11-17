// Calls are off in the widget, so the bar above the chat for an ongoing call stays empty.
export function showOngoingCall(_instance: unknown) {}

export default function createTopbarCall() {
  return {container: document.createElement('div')};
}
