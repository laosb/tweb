import PeerTitle from '@components/peerTitle';
import rootScope from '@lib/rootScope';

// Identity labels only: never rewrite message text, usernames, topics or explicit titles.
export function useWidgetSelfTitle() {
  const update = PeerTitle.prototype.update;
  if(typeof(update) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: update');
  PeerTitle.prototype.update = async function(...args) {
    await update.apply(this, args);
    const options = this.options;
    if(options.peerId !== rootScope.myId || !rootScope.myId || options.dialog ||
      options.username || options.threadId || options.asAllChats || options.fromName !== undefined) return;
    // Keep badges, the original node and its peer_title_edit registration.
    (this.element.querySelector('.peer-title-inner') || this.element).replaceChildren('Me');
  };
}
