import wrapUrl from '@lib/richTextProcessor/wrapUrl?widget-original';
import {isWidgetExternalUrl} from '@/widget/linkPolicy';

export default function widgetWrapUrl(...args: Parameters<typeof wrapUrl>) {
  const result = wrapUrl(...args);
  if(/^tg:/i.test(args[0])) result.url = args[0];
  // Every external URL uses the existing confirmation. Unknown internal schemes
  // also need a handler so the browser cannot navigate around the deny guard.
  if(isWidgetExternalUrl(result.url) || !/^(tel:|mailto:)/i.test(result.url) && !result.onclick) {
    result.onclick = 'showMaskedAlert';
  }
  return result;
}
