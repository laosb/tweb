import PopupElementTsx from '@components/popups/indexTsx';
import appMediaPlaybackController from '@components/appMediaPlaybackController';
import appSidebarLeft from '@components/sidebarLeft';
import appSidebarRight from '@components/sidebarRight';
import appImManager from '@lib/appImManager';
import appDownloadManager from '@lib/appDownloadManager';
import getProxiedManagers from '@lib/getProxiedManagers';
import rootScope from '@lib/rootScope';
import {useAppSettings} from '@stores/appSettings';
import {unwrap} from 'solid-js/store';

let started = false;

// The upstream dialog-list startup also owns the chat's bootstrap. Keep that
// work once per tab; the actual downloads/IM controllers own their listeners.
export function startWidgetDialogs() {
  if(started) return;
  started = true;
  const managers = getProxiedManagers();
  PopupElementTsx.MANAGERS = rootScope.managers = managers;

  const [settings, setSettings] = useAppSettings();
  appMediaPlaybackController.setPlaybackParams(unwrap(settings.playbackParams));
  setSettings('playbackParams', appMediaPlaybackController.getPlaybackParams());
  appMediaPlaybackController.addEventListener('playbackParams', (params) => {
    setSettings('playbackParams', params);
  });

  appDownloadManager.construct(managers);
  // Poll creation is omitted. Upload cancellation follows the ordinary path.
  appDownloadManager.showPollCancelConfirmation = undefined;
  appSidebarLeft.construct(managers);
  appSidebarRight.construct(managers);
  appImManager.construct(managers);
}
