import noop from '@helpers/noop';

const EVENTS = ['pointerdown', 'keydown', 'dragenter'];

/**
 * Deferred screens share one chunk. Fetch it at the customer's first interaction after the
 * chat appears, so the press or drop that opens one of them rarely waits for the network.
 * Facades still restrict the upstream modules at their first use.
 */
export function warmDeferredScreens() {
  const warm = () => {
    EVENTS.forEach((type) => window.removeEventListener(type, warm, true));
    import('@components/mediaViewer/index?widget-original').catch(noop);
  };
  EVENTS.forEach((type) => window.addEventListener(type, warm, {capture: true, passive: true}));
}
