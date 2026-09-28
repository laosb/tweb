import {render} from 'solid-js/web';
import type rootScope from '@lib/rootScope';
import IdentityPanel from '@lib/blah/IdentityPanel';
import styles from '@lib/blah/identity.module.scss';
import createFocusTrap from '@helpers/dom/focusTrap';
import appNavigationController, {NavigationItem} from '@components/appNavigationController';
import overlayCounter from '@helpers/overlayCounter';

export function installIdentityButton(managers: typeof rootScope.managers) {
  const button = document.createElement('button');
  button.textContent = 'Browser identity';
  button.className = styles.launcher;
  button.onclick = () => {
    const dialog = document.createElement('dialog');
    dialog.className = styles.dialog;
    dialog.setAttribute('aria-label', 'Manage Blah identities');
    document.body.append(dialog);
    const dispose = render(() => <>
      <h2>Manage Blah identities</h2>
      <IdentityPanel action={(request) => managers.appAccountManager.blahIdentity(request)} />
      <button onClick={() => dialog.close()}>Close</button>
    </>, dialog);
    const focus = createFocusTrap(dialog);
    const navigation: NavigationItem = {type: 'popup', noBlurOnPop: true, onPop: () => dialog.close()};
    appNavigationController.pushItem(navigation);
    overlayCounter.isOverlayActive = true;
    dialog.addEventListener('close', () => {
      appNavigationController.removeItem(navigation);
      overlayCounter.isOverlayActive = false;
      focus.deactivate();
      dispose();
      dialog.remove();
    }, {once: true});
    dialog.showModal();
    focus.activate(button);
  };
  document.body.append(button);
}
