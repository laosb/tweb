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
  if(!/^border(?:-(?:top|bottom)-(?:left|right)|-(?:start|end)-(?:start|end))?-radius$/.test(declaration.prop)) return;
  const value = declaration.value;
  if(/widget-|^(?:0(?:px|rem|%)?|inherit|initial|unset|revert)$/.test(value)) return;
  const selector = declaration.parent.type === 'rule' ? declaration.parent.selector : '';
  const file = declaration.source?.input.file || '';
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
