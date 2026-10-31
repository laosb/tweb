import EventListenerBase from '@helpers/eventListenerBase';

// ChatInput wires the hidden command button's ARIA relationship to this detached node.
export default class WidgetBotCommands extends EventListenerBase<{visible: () => void, hiding: () => void}> {
  container = document.createElement('div');
  toggle() {}
  setUserId() {}
}
