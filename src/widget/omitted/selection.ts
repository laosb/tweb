import EventListenerBase from '@helpers/eventListenerBase';
import {ChatType} from '@components/chat/chatType';
import type Chat from '@components/chat/chat';
import isSameMessageSelectionGroup from '@components/chat/isSameMessageSelectionGroup';

// Keep the event and predicate surface read by bubbles, menus and hover reactions.
export class AppSelection extends EventListenerBase<{toggle: (selecting: boolean) => void}> {
  constructor(..._args: unknown[]) { super(false); }

  selectedMids = new Map<PeerId, Set<number>>();
  isSelecting = false;
  isReportSelection = false;
  isScheduled = false;
  selectedText: string;

  attachListeners(..._args: unknown[]) {}
  toggleMid(..._args: unknown[]) { return false; }
  toggleSelection(..._args: unknown[]) { return false; }
  toggleElementCheckbox(..._args: unknown[]) { return false; }
  toggleByElement(..._args: unknown[]) {}
  enterReportSelection(..._args: unknown[]) {}
  updateElementSelection(..._args: unknown[]) {}
  refreshSelectionGroup(..._args: unknown[]) {}
  isMidSelected(..._args: unknown[]) { return false; }
  isElementShouldBeSelected(..._args: unknown[]) { return false; }
  getSelectedMids(): number[] { return []; }
  getSelectedMessages() { return Promise.resolve([]); }
  length() { return 0; }
  deleteSelectedMids(..._args: unknown[]) {}
  cancelSelection(..._args: unknown[]) {
    this.selectedMids.clear();
    this.selectedText = undefined;
    this.isSelecting = this.isReportSelection = false;
  }
  cleanup(..._args: unknown[]) { this.cancelSelection(); }
}

export class SearchSelection extends AppSelection {}

export default class ChatSelection extends AppSelection {
  constructor(private chat: Pick<Chat, 'type'>, ..._args: unknown[]) {
    super();
  }

  canSelectBubble(bubble: HTMLElement) {
    return bubble &&
      !bubble.classList.contains('is-date') &&
      this.chat.type !== ChatType.Logs &&
      this.chat.type !== ChatType.Welcome &&
      !(this.isReportSelection && bubble.classList.contains('service')) &&
      !bubble.classList.contains('is-outgoing') &&
      !bubble.classList.contains('is-error') &&
      !bubble.classList.contains('bubble-first') &&
      !bubble.classList.contains('avoid-selection') &&
      isSameMessageSelectionGroup(this.selectedMids, bubble.classList.contains('is-ephemeral'));
  }
}
