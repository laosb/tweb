import addAnchorListener from '@helpers/addAnchorListener?widget-original';
import {allowsWidgetAnchor, isWidgetExternalUrl} from '@/widget/linkPolicy';
import cancelEvent from '@helpers/dom/cancelEvent';
import setBlankToAnchor from '@lib/richTextProcessor/setBlankToAnchor';
export {UNSAFE_ANCHOR_LINK_TYPES, listenForMaskedAnchorAuxClicks} from '@helpers/addAnchorListener?widget-original';

const addWidgetAnchorListener: typeof addAnchorListener = (options) => {
  addAnchorListener(options);
  const key = (options.protocol ? options.protocol + '_' : '') + options.name;
  const handler = (window as any)[key];
  if(typeof(handler) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  (window as any)[key] = (element?: HTMLAnchorElement, event?: Event) => {
    if(!allowsWidgetAnchor(options.name, options.protocol, element?.href)) return cancelEvent(event);
    try { new URL(element.href); } catch(err) { return cancelEvent(event); }
    if(options.name === 'showMaskedAlert' && isWidgetExternalUrl(element.href)) setBlankToAnchor(element);
    return handler(element, event);
  };
};
export default addWidgetAnchorListener;
