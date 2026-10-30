// Only emit rules for set values: upstream keeps each surface's individual default.
const CORNERS: [name: string, selectors: string][] = [
  // These override inline geometry or !important circles; the rest is mapped in
  // scripts/widget-theme-css.ts, retaining the upstream fallback at each declaration.
  ['bubble-radius', '.bubble .bubble-content'],
  ['incoming-bubble-radius', '.bubble:not(.is-out) .bubble-content'],
  ['outgoing-bubble-radius', '.bubble.is-out .bubble-content'],
  ['composer-radius', '.chat-input-wrapper, .btn-send'],
  ['media-radius', '.album-item, .attachment, .quote-like, .reply-media, .document-ico, .media-viewer-album-thumbs button'],
  ['avatar-radius', '.avatar'],
  ['pill-radius', '.bubble.service .bubble-content, .bubble.is-date .bubble-content, .bubbles-go-down, .bubbles-corner-button']
];

export function widgetCornerRules(computed: CSSStyleDeclaration) {
  return CORNERS.map(([name, selectors]) => {
    const value = computed.getPropertyValue('--widget-' + name).trim();
    if(!value) return '';
    const selector = selectors.split(', ').map(selector => 'body.blah-widget ' + selector).join(', ');
    const tail = name.endsWith('bubble-radius') ? `body.blah-widget ${name === 'incoming-bubble-radius' ? '.bubble:not(.is-out)' : name === 'outgoing-bubble-radius' ? '.bubble.is-out' : '.bubble'} .bubble-tail { display: none; }` : '';
    return `${selector} { border-radius: ${value} !important; } ${tail}`;
  }).join('\n');
}
