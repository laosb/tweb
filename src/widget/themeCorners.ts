// Only emit rules for set values: upstream keeps each surface's individual default.
const CORNERS: [name: string, selectors: string][] = [
  // These override inline geometry or !important circles; the rest is mapped in
  // scripts/widget-theme-css.ts, retaining the upstream fallback at each declaration.
  ['composer-radius', '.chat-input-wrapper, .btn-send'],
  ['media-radius', '.quote-like, .reply-media, .document-ico, .media-viewer-album-thumbs button'],
  ['avatar-radius', '.avatar'],
  ['pill-radius', '.bubble.service .bubble-content, .bubble.is-date .bubble-content, .bubbles-go-down, .bubbles-corner-button']
];

export function widgetCornerRules(computed: CSSStyleDeclaration) {
  return CORNERS.map(([name, selectors]) => {
    const value = computed.getPropertyValue('--widget-' + name).trim();
    if(!value) return '';
    const selector = selectors.split(', ').map(selector => 'body.blah-widget ' + selector).join(', ');
    return `${selector} { border-radius: ${value} !important; }`;
  }).join('\n');
}
