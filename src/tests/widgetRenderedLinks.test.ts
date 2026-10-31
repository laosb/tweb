import {restrictRenderedLinks} from '@/widget/renderedLinkRestrictions';

let cleanup: () => void;
beforeEach(() => {cleanup = restrictRenderedLinks(document);});
afterEach(() => {cleanup(); document.body.replaceChildren();});

it.each(['media-viewer-caption', 'reply', 'quote', 'rich-message', 'instant-view', 'service', 'poll', 'checklist', 'composer-preview'])(
  'swallows peer activation before %s handlers and browser defaults', surface => {
    const container = document.createElement('div');
    container.className = surface;
    document.body.append(container);
    const activated = vi.fn();
    container.addEventListener('click', activated);
    container.addEventListener('mousedown', activated);
    container.addEventListener('auxclick', activated);
    container.addEventListener('keydown', activated);
    for(const [href, className] of [['#123', 'follow'], ['https://t.me/other', 'mention'], ['#-456', 'peer-title']]) {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.className = className;
      const child = document.createElement('span');
      anchor.append(child);
      container.replaceChildren(anchor);
      for(const event of [
        new MouseEvent('mousedown', {button: 0, bubbles: true, cancelable: true}),
        ...[{}, {ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {altKey: true}].map(options =>
          new MouseEvent('click', {...options, bubbles: true, cancelable: true})),
        new MouseEvent('auxclick', {button: 1, bubbles: true, cancelable: true}),
        new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}),
        new KeyboardEvent('keydown', {key: ' ', bubbles: true, cancelable: true})
      ]) {
        child.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }
    }
    expect(activated).not.toHaveBeenCalled();
  }
);

it('keeps external confirmation, map links, tel/mail, timestamps and primary support jumps', () => {
  for(const [href, callback] of [
    ['https://example.org', 'showMaskedAlert'], ['https://maps.google.com', ''],
    ['tel:+1234', ''], ['mailto:support@example.org', ''], ['#', 'setMediaTimestamp'],
    ['tg://privatepost?channel=42&post=10', 'tg_privatepost'], ['https://t.me/support/10', 'im'],
    ['#section', '']
  ]) {
    const anchor = document.createElement('a');
    anchor.href = href;
    if(callback) anchor.dataset.callback = callback;
    document.body.replaceChildren(anchor);
    const event = new MouseEvent('click', {bubbles: true, cancelable: true});
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
});

it('blocks denied handlers and auxiliary internal navigation outside bubbles', () => {
  for(const [href, callback] of [
    ['https://T.ME./other/123', 'showMaskedAlert'], ['tg://settings/devices', 'tg_settings'],
    ['https://t.me/other/123', 'im'], ['https://t.me./other', '']
  ]) {
    const anchor = document.createElement('a');
    anchor.href = href;
    if(callback) anchor.setAttribute('onclick', callback + '(this)');
    document.body.replaceChildren(anchor);
    const event = new MouseEvent('auxclick', {button: 1, bubbles: true, cancelable: true});
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
});
