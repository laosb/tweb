import type {NewMediaPopupHandle} from '@components/popups/newMedia';
import noop from '@helpers/noop';

type Module = typeof import('@components/popups/newMedia');
let loading: Promise<Module>, loaded: Module;
// Shown but still loading: files, Stars and drops wait for the upstream popup.
let pending: NewMediaPopupHandle;

const load = () => loading ??= import('@components/popups/newMedia?widget-original').then((module) => loaded = module, (error) => {
  loading = undefined;
  throw error;
});

export function getCurrentNewMediaPopup() {
  return pending ?? loaded?.getCurrentNewMediaPopup();
}

export const canSendNewMedia: Module['canSendNewMedia'] = (...args) => load().then((module) => module.canSendNewMedia(...args));

/** The attachment preview, shown once the upstream popup arrives from the deferred chunk. */
export default function showNewMediaPopup(...args: Parameters<Module['default']>): NewMediaPopupHandle {
  const shown = load().then((module) => module.default(...args));
  const forward = <K extends keyof NewMediaPopupHandle>(key: K) => (...values: Parameters<NewMediaPopupHandle[K]>) => {
    shown.then((popup) => (popup[key] as (...values: Parameters<NewMediaPopupHandle[K]>) => void)(...values), noop);
  };
  const handle: NewMediaPopupHandle = {
    addFiles: forward('addFiles'),
    setStarsAmount: forward('setStarsAmount'),
    appendDrops: forward('appendDrops'),
    hide: forward('hide')
  };
  pending = handle;
  shown.finally(() => {
    if(pending === handle) pending = undefined;
  }).catch(noop);
  return handle;
}
