type Declaration = {
  prop: string,
  value: string,
  parent: {type: string, selector?: string},
  source?: {input: {file?: string}}
};

/** Widget-only compiled CSS: preserve each upstream default, including lazy editor styles.
 * Mapping at build time also covers CSS modules without depending on their generated names.
 * Content paint (photos, emoji, editor paint swatches) is deliberately not rewritten.
 */
export function widgetThemeDeclaration(declaration: Declaration) {
  if(/^#26962f$/i.test(declaration.value)) declaration.value = 'var(--widget-accent-color, #26962F)';
  if(declaration.prop === '--cropper-color' && /^#f0db56$/i.test(declaration.value)) {
    declaration.value = 'var(--widget-accent-color, #F0DB56)';
  }
  const file = declaration.source?.input.file || '';
  const selector = declaration.parent.type === 'rule' ? declaration.parent.selector : '';
  // Sass bundles the partial into style.scss before Vite calls PostCSS.
  const bubble = /(?:^|[\\/])_chatBubble\.scss$/.test(file) || /[\\/]scss[\\/]style\.scss$/.test(file) && /\.bubble(?:[\s.:#]|$)/.test(selector);
  if(bubble && /^--border-(?:start|end)-(?:start|end)-radius$/.test(declaration.prop)) {
    if(declaration.value === '15px') declaration.value = 'var(--widget-bubble-corner-radius, 15px)';
    else if(declaration.value === '5px') declaration.value = 'min(5px, var(--widget-bubble-corner-radius, 5px))';
    return;
  }
  if(!/^border(?:-(?:top|bottom)-(?:left|right)|-(?:start|end)-(?:start|end))?-radius$/.test(declaration.prop)) return;
  const value = declaration.value;
  if(/widget-|^(?:0(?:px|rem|%)?|inherit|initial|unset|revert)$/.test(value)) return;
  // Bubble-edge media consumes the same corners, including upstream's square joins.
  if(bubble && /^var\(--border-(?:start|end)-(?:start|end)-radius\)$/.test(value)) return;
  if(bubble && /attachment/.test(selector) && /has-plain-media-tail/.test(selector) && value === '15px') {
    declaration.value = 'var(--widget-bubble-corner-radius, 15px)';
    return;
  }
  let group = 'button'; // Small controls, code labels, dividers and their hover shapes.
  if(/avatar/i.test(selector)) group = 'avatar';
  else if(/chat-input-wrapper|btn-send\b/.test(selector)) group = 'composer';
  else if(/popup-container|media-editor__toolbar(?:[\s.:#]|$)/.test(selector)) group = 'popup';
  else if(/bubble-content/.test(selector)) return; // The existing direction-specific trio.
  else if(/service\.module\.scss$/.test(file) || /service|is-date|badge|reaction|bubbles-(?:go-down|corner)|video-time|\.time\b|progress-line|checkbox-toggle|scrollbar|range-input|tabs-underline|step-input-separator|toolbar-draggable/.test(selector)) group = 'pill';
  else if(/btn-menu(?:\s|$|:|-items)|tooltip|toast|emoji-dropdown(?:\s|$|:)|autocomplete-helper|emoji-tone-picker|zoom-container|playback|context-menu|layer-actions|action-menu/.test(selector)) group = 'menu';
  else if(/attachment|album-item|document|reply|quote|audio-thumb|media-photo|popup-photo|popup-item-media|media-viewer-mover|bubble.*(?:name|floating-part)|code/.test(selector) || /albumThumbs|videoControls/.test(file)) group = 'media';
  // Radio dots, ripple disks, playback/icon buttons, spinner rings, editor handles/swatches.
  // Avatar, composer and pill circles are explicitly customizable exceptions.
  if(/^(?:50%|100%)$/.test(value) && !/avatar|btn-send\b|bubbles-(?:go-down|corner)|badge|reaction|service|is-date/.test(selector)) return;
  declaration.value = `var(--widget-${group}-radius, ${value})`;
}
