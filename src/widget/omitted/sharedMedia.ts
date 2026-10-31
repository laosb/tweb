import noop from '@helpers/noop';

// Chat keeps one of these per peer, even though the widget has no profile column.
export default class WidgetSharedMediaTab {
  peerId: PeerId;
  threadId: number;
  noProfile = true;
  isLoaded = false;
  peerChanged = false;
  container = document.createElement('div');
  scrollable = {container: this.container, onScroll: noop};
  private destroyed = false;

  setPeer(peerId: PeerId, threadId?: number) {
    if(this.peerId === peerId && this.threadId === threadId) return false;
    this.peerId = peerId;
    this.threadId = threadId;
    this.peerChanged = true;
    this.isLoaded = false;
    return true;
  }

  fillProfileElements() {
    const {peerId, threadId} = this;
    return Promise.resolve(() => {
      if(!this.destroyed && this.peerId === peerId && this.threadId === threadId) this.isLoaded = true;
    });
  }

  async ensureLoaded() { (await this.fillProfileElements())(); }
  whenLoaded() { return Promise.resolve(); }
  loadSidebarMedia() { return Promise.resolve(); }
  setSearchTab() { return Promise.resolve(); }
  setLoadMutex() {}
  init() { return this.ensureLoaded(); }
  open() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  destroy() { this.destroyed = true; this.container.remove(); }
  static open() { return Promise.resolve(); }
}
