import cancelEvent from '@helpers/dom/cancelEvent';
import {allowsWidgetAnchor, isWidgetExternalUrl} from '@/widget/linkPolicy';

// Captions, reply/quote headers, service text, rich pages, polls/checklists and
// composer previews also render anchors outside the bubbles' delegated guard.
export function restrictRenderedLinks(document: Document) {
  const guard = (event: MouseEvent | KeyboardEvent) => {
    if(event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
    const anchor = (event.target as Element)?.closest?.('a');
    if(!anchor) return;
    const href = anchor.getAttribute('href') || '';
    const peer = anchor.matches('.follow, .mention, [data-follow]') || /^#-?\d+$/.test(href);
    const callback = anchor.dataset.callback || anchor.getAttribute('onclick')?.split('(')[0];
    const protocol = callback?.startsWith('tg_') ? 'tg' : undefined;
    const name = protocol ? callback.slice(3) : callback;
    const internal = href && !isWidgetExternalUrl(anchor.href) && !/^(tel:|mailto:)/i.test(href);
    const modified = event instanceof MouseEvent && (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey);
    if(peer || callback && !allowsWidgetAnchor(name, protocol, anchor.href) ||
      internal && (modified || !callback && !href.startsWith('#'))) {
      cancelEvent(event);
      event.stopImmediatePropagation();
    }
  };
  const events = ['mousedown', 'click', 'auxclick', 'keydown'] as const;
  for(const type of events) document.addEventListener(type, guard, true);
  return () => {
    for(const type of events) document.removeEventListener(type, guard, true);
  };
}
