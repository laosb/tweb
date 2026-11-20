import type AppMediaViewer from '@components/mediaViewer';
import type {ButtonMenuItemOptionsVerifiable} from '@components/buttonMenu';

/** Applied to the upstream viewer as the deferred chunk delivers it (src/widget/deferred/mediaViewer.ts). */
export function restrictMediaViewer(Viewer: typeof AppMediaViewer) {
  const viewer = Viewer.prototype as any;
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
  viewer.setBtnMenuToggle = function(buttons: ButtonMenuItemOptionsVerifiable[], menuOnly: ButtonMenuItemOptionsVerifiable[] = []) {
    const allowed = (button: ButtonMenuItemOptionsVerifiable) => !['forward', 'user', 'flag'].includes(button.icon);
    return setBtnMenuToggle.call(this, buttons.filter(allowed), menuOnly.filter(allowed));
  };
}
