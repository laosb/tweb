import AppMediaViewer from '@components/mediaViewer';
import rootScope from '@lib/rootScope';
import type {ButtonMenuItemOptionsVerifiable} from '@components/buttonMenu';

export function restrictMediaViewer() {
  const viewer = AppMediaViewer.prototype as any;
  for(const key of ['setMessageActionVisibility', 'setBtnMenuToggle', 'setAuthorInfo']) {
    if(typeof(viewer[key]) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  }
  const setMessageActionVisibility = viewer.setMessageActionVisibility;
  viewer.setMessageActionVisibility = function(options: object) {
    const result = setMessageActionVisibility.call(this, {...options, cantForward: true});
    // Keep the detached button for the viewer's listeners and later paging updates.
    this.buttons.forward.remove();
    return result;
  };
  const setBtnMenuToggle = viewer.setBtnMenuToggle;
  viewer.setBtnMenuToggle = function(buttons: ButtonMenuItemOptionsVerifiable[]) {
    return setBtnMenuToggle.call(this, buttons.filter((button) => button.icon !== 'forward'));
  };
  const setAuthorInfo = viewer.setAuthorInfo;
  viewer.setAuthorInfo = function(...args: unknown[]) {
    const self = args[0] === rootScope.myId;
    const promise = setAuthorInfo.apply(this, args);
    const avatar = this.author.avatarEl;
    return promise.then(() => {
      // Match the base viewer's stale-title guard when next/prev races a title load.
      if(self && this.author.avatarEl === avatar) this.author.nameEl.replaceChildren('Me');
    });
  };
}
