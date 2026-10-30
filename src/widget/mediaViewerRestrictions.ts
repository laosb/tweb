import AppMediaViewer from '@components/mediaViewer';
import type {ButtonMenuItemOptionsVerifiable} from '@components/buttonMenu';

export function restrictMediaViewer() {
  const viewer = AppMediaViewer.prototype as any;
  for(const key of ['setMessageActionVisibility', 'setBtnMenuToggle']) {
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
}
